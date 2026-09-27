import { parse } from 'acorn';
import { analyze } from 'eslint-scope';

const functions = new Set(['FunctionDeclaration', 'FunctionExpression', 'ArrowFunctionExpression']);

function visit(node, callback, parent = null) {
  callback(node, parent);
  for (const value of Object.values(node)) {
    if (Array.isArray(value)) {
      for (const child of value) {
        if (child && typeof child.type === 'string') visit(child, callback, node);
      }
    } else if (value && typeof value.type === 'string') {
      visit(value, callback, node);
    }
  }
}

function contains(outer, inner) {
  return outer.start <= inner.start && inner.end <= outer.end;
}

function chooseTarget(candidates, source, near) {
  if (!candidates.length) throw new Error('Target variable not found.');
  if (near === undefined) {
    if (candidates.length === 1) return candidates[0];
    throw new Error(`Ambiguous target (${candidates.length} writes); provide a near pattern.`);
  }
  const pattern = typeof near === 'string' ? new RegExp(near, 'g') : new RegExp(near.source, near.flags.replace(/[gy]/g, '') + 'g');
  const anchors = [...source.matchAll(pattern)];
  if (!anchors.length) throw new Error('The near pattern did not match the source.');
  const distance = (node) => Math.min(...anchors.map(match =>
    Math.max(node.start - (match.index + match[0].length), match.index - node.end, 0)));
  const ranked = candidates.map(node => ({ node, distance: distance(node) })).sort((a, b) => a.distance - b.distance);
  if (ranked[1]?.distance === ranked[0].distance) throw new Error('The near pattern still leaves an ambiguous target.');
  return ranked[0].node;
}

/**
 * Lift the value immediately after the selected declaration/assignment.
 * Does not execute source. Unresolved names remain external references.
 * `near` is a RegExp (or its source string), locating the closest write.
 */
export function liftScript(source, { variable, near } = {}) {
  if (typeof source !== 'string' || typeof variable !== 'string' || !variable) {
    throw new TypeError('Provide JavaScript source and a non-empty variable name.');
  }
  const ast = parse(source, { ecmaVersion: 2022, sourceType: 'script', ranges: true, locations: true });
  const parents = new Map();
  const nodes = [];
  const candidates = [];
  visit(ast, (node, parent) => {
    parents.set(node, parent);
    nodes.push(node);
    if (node.type === 'VariableDeclarator' && node.id.type === 'Identifier' && node.id.name === variable) candidates.push(node);
    if (node.type === 'AssignmentExpression' && node.left.type === 'Identifier' && node.left.name === variable) candidates.push(node);
  });
  const target = chooseTarget(candidates, source, near);
  const manager = analyze(ast, { ecmaVersion: 2022, sourceType: 'script', optimistic: true, directive: true });
  const references = manager.scopes.flatMap(scope => scope.references);
  const byIdentifier = new Map(references.map(reference => [reference.identifier, reference]));

  // Recreate the lexical path without invoking the original bundle/callback.
  const path = [];
  for (let node = target; node; node = parents.get(node)) path.unshift(node);
  const frames = [];
  for (const node of path) {
    if (functions.has(node.type) && (node.async || node.generator)) {
      throw new Error('Cannot lift a target from an async or generator function.');
    }
    if (node.type !== 'Program' && node.type !== 'BlockStatement') continue;
    const owner = parents.get(node);
    if (node.type === 'BlockStatement' && !functions.has(owner?.type)) {
      throw new Error('The target must be directly inside a program or function body, not conditional control flow.');
    }
    frames.push({ node, owner, units: [] });
  }
  const units = [];
  for (let index = 0; index < frames.length; index++) {
    const frame = frames[index];
    const next = frames[index + 1];
    const cutoff = next ? next.owner.start : target.end;
    function add(node, kind) {
      if (contains(node, target) && node !== target) {
        if (!next) throw new Error('Target must be a standalone declaration or assignment.');
        return;
      }
      if (next && contains(node, next.owner)) return;
      if (node.end > cutoff && node.type !== 'FunctionDeclaration') return;
      const unit = { node, kind, frame };
      units.push(unit);
      frame.units.push(unit);
    }
    function expression(node) {
      if (node.type === 'SequenceExpression') {
        for (const part of node.expressions) expression(part);
      } else {
        add(node, 'expression');
      }
    }
    for (const statement of frame.node.body) {
      if (statement.type === 'VariableDeclaration') {
        for (const declaration of statement.declarations) add(declaration, statement.kind);
      } else if (statement.type === 'ExpressionStatement') {
        expression(statement.expression);
      } else {
        add(statement, 'statement');
      }
    }
  }
  const targetUnit = units.find(unit => unit.node === target);
  if (!targetUnit) throw new Error('Target must be a standalone declaration or assignment.');
  const unitFor = node => units.find(unit => contains(unit.node, node));
  const selected = new Set();
  const bindings = new Set();
  const external = new Set();
  const pending = [];
  function select(unit) {
    if (selected.has(unit)) return;
    selected.add(unit);
    pending.push(unit);
  }
  function requireBinding(binding, identifier) {
    if (!binding) {
      external.add(identifier.name);
      return;
    }
    if (bindings.has(binding)) return;
    bindings.add(binding);
    if (!binding.defs.length) {
      throw new Error(`Cannot lift implicit binding ${binding.name} from its invocation context.`);
    }
    for (const definition of binding.defs) {
      if ([...selected].some(unit => contains(unit.node, definition.node))) continue;
      const unit = unitFor(definition.node);
      if (!unit) throw new Error(`Cannot lift binding ${binding.name}: its declaration or invocation argument is outside the extractable path.`);
      select(unit);
    }
    // Keep preceding assignments, including writes in loops/try/conditional blocks.
    for (const reference of binding.references) {
      if (!reference.isWrite()) continue;
      const unit = unitFor(reference.identifier);
      if (!unit || unit.node.type === 'FunctionDeclaration') continue;
      // A write inside a dormant function is not an initialization.
      let nested = false;
      for (let node = reference.identifier; node && node !== unit.node; node = parents.get(node)) {
        if (functions.has(node.type)) nested = true;
      }
      if (!nested) select(unit);
    }
  }
  function exposesBinding(node, seen = new Set()) {
    if (node.type === 'SpreadElement') return exposesBinding(node.argument, seen);
    if (node.type === 'MemberExpression') return exposesBinding(node.object, seen);
    if (node.type !== 'Identifier') return false;
    const binding = byIdentifier.get(node)?.resolved;
    if (!binding || seen.has(binding)) return false;
    if (bindings.has(binding)) return true;
    seen.add(binding);
    // Follow direct aliases for mutation discovery without retaining unused aliases.
    return binding.defs.some(definition => definition.node.type === 'VariableDeclarator'
      && definition.node.init && exposesBinding(definition.node.init, seen));
  }
  function hasMutation(unit) {
    let mutation = false;
    const inspectedFunctions = new Set();
    function inspectFunction(node) {
      if (inspectedFunctions.has(node)) return;
      inspectedFunctions.add(node);
      inspect(node.body);
    }
    function inspect(node) {
      // Only immediately executed expressions; retained functions are copied whole.
      if (functions.has(node.type)) return;
      if (node.type === 'CallExpression') {
        const callee = node.callee;
        if (callee.type === 'MemberExpression' && exposesBinding(callee.object)) mutation = true;
        if (node.arguments.some(argument => exposesBinding(argument))) mutation = true;
        if (functions.has(callee.type)) inspectFunction(callee);
        if (callee.type === 'Identifier') {
          const binding = byIdentifier.get(callee)?.resolved;
          for (const definition of binding?.defs ?? []) {
            if (definition.type === 'FunctionName') inspectFunction(definition.node);
            else if (functions.has(definition.node.init?.type)) inspectFunction(definition.node.init);
          }
        }
      }
      if (node.type === 'AssignmentExpression' && exposesBinding(node.left)) mutation = true;
      if (node.type === 'UpdateExpression' && exposesBinding(node.argument)) mutation = true;
      for (const value of Object.values(node)) {
        if (Array.isArray(value)) {
          for (const child of value) if (child && typeof child.type === 'string') inspect(child);
        } else if (value && typeof value.type === 'string') inspect(value);
      }
    }
    inspect(unit.node);
    return mutation;
  }

  select(targetUnit);
  for (;;) {
    while (pending.length) {
      const unit = pending.shift();
      for (const reference of references) {
        if (!contains(unit.node, reference.identifier)) continue;
        const binding = reference.resolved;
        // Parameters and locals of complete retained functions/blocks stay there.
        if (binding?.defs.some(definition => contains(unit.node, definition.node))) continue;
        if (binding?.name === 'arguments' && contains(unit.node, binding.scope.block)) continue;
        requireBinding(binding, reference.identifier);
      }
    }
    for (const unit of units) {
      if (selected.has(unit) || unit.node.type === 'FunctionDeclaration') continue;
      if (hasMutation(unit)) select(unit);
    }
    if (!pending.length) break;
  }

  // Dynamic lookup cannot be resolved statically, even with intact JS built-ins.
  for (const node of nodes) {
    const unit = [...selected].find(item => contains(item.node, node));
    if (!unit) continue;
    if (node.type === 'WithStatement') throw new Error('with is not supported in an extracted dependency.');
    if (node.type === 'CallExpression' && node.callee.type === 'Identifier' && node.callee.name === 'eval' && !byIdentifier.get(node.callee)?.resolved) {
      throw new Error('Direct eval is not supported in an extracted dependency.');
    }
    if (node.type === 'ThisExpression' || node.type === 'Super' || node.type === 'ReturnStatement') {
      let owner = parents.get(node);
      while (owner) {
        const ownsContext = functions.has(owner.type) && (node.type === 'ReturnStatement' || owner.type !== 'ArrowFunctionExpression');
        if (ownsContext) break;
        owner = parents.get(owner);
      }
      if (!owner || !contains(unit.node, owner)) throw new Error(`Cannot preserve ${node.type} from the removed invocation context.`);
    }
  }

  function render(index) {
    const frame = frames[index];
    const lines = [];
    // Retain directive prologues (notably strict mode).
    for (const statement of frame.node.body) {
      if (!statement.directive) break;
      lines.push(source.slice(statement.start, statement.end));
    }
    for (const unit of frame.units) {
      if (!selected.has(unit)) continue;
      const text = source.slice(unit.node.start, unit.node.end);
      if (['var', 'let', 'const'].includes(unit.kind)) lines.push(`${unit.kind} ${text};`);
      else if (unit.kind === 'expression') lines.push(`(${text});`);
      else lines.push(text);
    }
    if (index === frames.length - 1) lines.push(`return ${variable};`);
    else lines.push(`return ${render(index + 1)};`);
    return `(() => {\n${lines.join('\n')}\n})()`;
  }
  const code = `${render(0)};\n`;
  parse(code, { ecmaVersion: 2022 });
  return {
    code,
    externals: [...external].sort(),
    target: { variable, start: target.start, end: target.end, line: target.loc.start.line, column: target.loc.start.column },
    retained: [...selected].sort((a, b) => a.node.start - b.node.start).map(unit => ({ start: unit.node.start, end: unit.node.end })),
  };
}
