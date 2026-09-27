import assert from 'node:assert/strict';
import { test } from 'node:test';
import { runInNewContext } from 'node:vm';
import { liftScript, liftHtml } from '../src/index.js';

const evaluate = (result, context = {}) => runInNewContext(result.code, context, { timeout: 1000 });

test('extracts transitive dependencies, preserves declaration order and drops neighboring declarators', () => {
  const result = liftScript(`
    const unused = explode(), seed = 20;
    function twice(x) { return x * 2; }
    function decode(x) { return twice(x) + 2; }
    const answer = decode(seed), player = explode();
    explode();
  `, { variable: 'answer' });
  assert.equal(evaluate(result), 42);
  assert.doesNotMatch(result.code, /explode|unused|player/);
  assert.deepEqual(result.externals, []);
});

test('preserves lexical shadowing without leaking unrelated scopes', () => {
  const result = liftScript(`
    const seed = 4;
    function outerValue() { return seed; }
    (function () {
      const seed = 10;
      function decode() { return seed + outerValue(); }
      const answer = decode();
    })();
    function unrelated() { const seed = explode(); }
  `, { variable: 'answer' });
  assert.equal(evaluate(result), 14);
  assert.doesNotMatch(result.code, /unrelated|explode/);
});

test('retains cyclic function dependencies and hoisted declarations', () => {
  const result = liftScript(`
    const answer = even(8);
    function even(n) { return n === 0 || odd(n - 1); }
    function odd(n) { return n !== 0 && even(n - 1); }
  `, { variable: 'answer' });
  assert.equal(evaluate(result), true);
});

test('retains preceding writes and control dependencies, excludes later writes', () => {
  const result = liftScript(`
    let value = 1;
    if (flag) { value = 40; }
    try { value += 2; } finally { value += 1; }
    const answer = value;
    value = 999;
  `, { variable: 'answer' });
  assert.equal(evaluate(result, { flag: true }), 43);
  assert.equal(evaluate(result, { flag: false }), 4);
  assert.deepEqual(result.externals, ['flag']);
  assert.doesNotMatch(result.code, /999/);
});

test('keeps a table rotation IIFE while splitting a sequence expression', () => {
  const result = liftScript(`
    const table = [1, 2, 3];
    (function (items) { items.push(items.shift()); })(table),
    (function () { const answer = table[0]; explode(); })();
  `, { variable: 'answer' });
  assert.equal(evaluate(result), 2);
  assert.doesNotMatch(result.code, /explode/);
});

test('keeps mutation through a direct alias and a called initializer', () => {
  const result = liftScript(`
    const table = [1, 2];
    const alias = table;
    function initialize() { rotate(); }
    function rotate() { alias.push(alias.shift()); }
    initialize();
    const answer = table[0];
  `, { variable: 'answer' });
  assert.equal(evaluate(result), 2);
});

test('keeps assignments performed by a called initializer', () => {
  const result = liftScript(`
    let value = 0;
    function initialize() { value = 42; }
    initialize();
    const answer = value;
  `, { variable: 'answer' });
  assert.equal(evaluate(result), 42);
});

test('does not execute writes in an unused function', () => {
  const result = liftScript(`
    let value = 1;
    function unused() { value = 100; }
    const answer = value;
  `, { variable: 'answer' });
  assert.equal(evaluate(result), 1);
  assert.doesNotMatch(result.code, /unused/);
});

test('disambiguates by nearest pattern and rejects ties/missing patterns', () => {
  const source = `function first() { const answer = 1; }
    function second() { /* selected */ const answer = 2; }`;
  assert.throws(() => liftScript(source, { variable: 'answer' }), /Ambiguous/);
  const pattern = /selected/g;
  pattern.lastIndex = 999;
  assert.equal(evaluate(liftScript(source, { variable: 'answer', near: pattern })), 2);
  assert.equal(pattern.lastIndex, 999);
  assert.throws(() => liftScript(source, { variable: 'answer', near: /missing/ }), /did not match/);
  assert.throws(() => liftScript(source, { variable: 'answer', near: /const answer/g }), /ambiguous/);
});

test('supports an assignment target at the selected observation point', () => {
  const result = liftScript('let answer = 1; answer = 42; answer = 100;', { variable: 'answer', near: /answer = 42/ });
  assert.equal(evaluate(result), 42);
  assert.doesNotMatch(result.code, /100/);
});

test('reports unresolved identifiers but not property names or function-local bindings', () => {
  const result = liftScript(`
    function decode(input) {
      return Native.decode(input) + arguments.length;
    }
    const answer = decode(external);
  `, { variable: 'answer' });
  assert.deepEqual(result.externals, ['Native', 'external']);
  assert.equal(evaluate(result, { Native: { decode: x => x * 2 }, external: 20 }), 41);
});

test('retains local destructuring dependencies and strict mode', () => {
  const result = liftScript(`
    'use strict';
    const { value: seed } = external;
    function decode(n) { return this === undefined ? n : 0; }
    const answer = decode(seed);
  `, { variable: 'answer' });
  assert.equal(evaluate(result, { external: { value: 42 } }), 42);
});

test('rejects unsupported dynamic lookup, invocation inputs and conditional targets', () => {
  for (const source of [
    'function run(input) { const answer = input; }',
    'function run() { const answer = arguments[0]; }',
    'function run() { const answer = this.value; }',
    'function run() { const get = () => this.value; const answer = get(); }',
    'const answer = eval("external");',
    'if (flag) { const answer = 1; }',
    'async function run() { const answer = 1; }',
  ]) assert.throws(() => liftScript(source, { variable: 'answer' }));
  assert.throws(() => liftScript('const value = 1;', { variable: 'answer' }), /not found/);
});

test('HTML parsing skips data scripts, comments and template contents', () => {
  const result = liftHtml(`
    <!-- <script>const answer = 0;</script> -->
    <template><script>const answer = 1;</script></template>
    <script type="application/json">["not JavaScript"]</script>
    <script src="/missing.js"></script>
    <script src="/loader.js"></script>
    <script>const answer = decode(external);</script>
  `, { variable: 'answer', scripts: { '/loader.js': 'function decode(value) { return value + 2; }' } });
  assert.equal(evaluate(result, { external: 40 }), 42);
  assert.deepEqual(result.missingScripts, ['/missing.js']);
  assert.deepEqual(result.externals, ['external']);
});

test('HTML input preserves script source text and can select a nested assignment', () => {
  const result = liftHtml(`<SCRIPT TYPE="text/javascript">(() => {
    const value = '&amp;'; const answer = value;
  })();</SCRIPT>`, { variable: 'answer' });
  assert.equal(evaluate(result), '&amp;');
  assert.throws(() => liftHtml('<script type="module">const answer = 1;</script>', { variable: 'answer' }), /Module scripts/);
});
