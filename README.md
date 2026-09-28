<p align="center">
  <img
    src="./docs/assets/ariadne-logo.png"
    alt="Ariadne"
    width="560"
  />
</p>

<h1 align="center">Ariadne</h1>

<p align="center">
  <strong>Find one thread. Follow it until the maze makes sense.</strong>
</p>

<p align="center">
  Static program slicing for JavaScript reverse engineering.
</p>

<p align="center">
  <img alt="JavaScript" src="https://img.shields.io/badge/JavaScript-ES2022-F7DF1E?logo=javascript&logoColor=000">
  <img alt="Node.js" src="https://img.shields.io/badge/Node.js-%E2%89%A520-339933?logo=node.js&logoColor=fff">
  <img alt="pnpm" src="https://img.shields.io/badge/pnpm-10.12.1-F69220?logo=pnpm&logoColor=fff">
  <img alt="Static Analysis" src="https://img.shields.io/badge/analysis-static-00C7B7">
  <img alt="Reverse Engineering" src="https://img.shields.io/badge/reverse-engineering-7C5CFC">
  <img alt="Status" src="https://img.shields.io/badge/status-experimental-orange">
</p>

---

## Overview

**Ariadne** is a static JavaScript slicer designed for reverse engineering.

Give Ariadne a variable and a point of interest, and it follows the lexical and data dependencies required to reconstruct the value of that variable at that exact point in the program.

Instead of manually navigating a massive or obfuscated bundle, Ariadne reduces the problem to the code that actually matters.

```text
300,000 lines of JavaScript
            │
            │  choose a target
            ▼
       ┌───────────┐
       │  Ariadne  │
       └─────┬─────┘
             │
             ▼
   relevant computation only
```

Typical use cases include:

- isolating payload decoding logic;
- understanding configuration generation;
- extracting a signature or token computation;
- reducing large obfuscated bundles;
- tracing how a value is produced;
- preparing smaller artifacts for manual analysis;
- feeding focused code to an AI-assisted reverse engineering workflow.

Ariadne currently supports classic JavaScript and classic `<script>` elements from HTML pages.

The extraction itself is **static**: Ariadne does not execute the analyzed program and does not download remote scripts.

---

## Why Ariadne?

Reverse engineering large JavaScript applications often involves a disproportionate amount of navigation work.

The interesting question is usually not:

> How does this entire bundle work?

It is:

> What produces this value?

Without tooling, answering that question often means repeatedly:

- searching for an identifier;
- finding its declaration;
- locating previous writes;
- resolving aliases;
- following function calls;
- checking scopes;
- jumping back and forth through thousands of unrelated lines.

Ariadne automates much of that work.

The goal is not to understand the whole maze at once.

The goal is to find one reliable thread and follow it.

---

## What is program slicing?

**Program slicing** is a static-analysis technique that extracts the subset of a program relevant to a particular computation.

A slicing criterion generally combines:

1. a **program location**;
2. a **value or variable of interest**.

The resulting slice contains the statements that may influence that value at the selected location.

For reverse engineering, this is particularly useful when analyzing:

- obfuscated JavaScript;
- large Webpack or application bundles;
- decoders;
- loaders;
- configuration builders;
- request-generation logic;
- client-side protocol implementations.

Instead of reasoning about everything:

```js
// tens or hundreds of thousands of lines
```

you reason about something closer to:

```js
(() => {
  function decode(value) {
    return JSON.parse(atob(value));
  }

  const result = decode(payload);
  return result;
})();
```

The resulting slice does not have to be mathematically minimal to be useful.

Its purpose is to remove enough unrelated code that the remaining computation becomes practical to inspect, debug, test, and rewrite.

---

## Static slicing

Ariadne currently performs **static slicing**.

That means the extraction is derived from:

- the AST;
- lexical scopes;
- identifier references;
- declarations;
- assignments;
- direct aliases;
- prior mutations;
- reachable initialization logic.

It does not require recording a live program execution.

This makes the extraction:

- deterministic;
- reproducible;
- usable offline;
- safe from direct execution of the analyzed source.

Static analysis also has limits. JavaScript is highly dynamic, and Ariadne deliberately refuses or leaves unresolved cases where it cannot establish a trustworthy model.

See [Limitations](#limitations).

---

## Architecture

Ariadne currently uses:

- [Acorn](https://github.com/acornjs/acorn) for JavaScript parsing;
- [eslint-scope](https://github.com/eslint/js/tree/main/packages/eslint-scope) for lexical scope and reference resolution;
- [parse5](https://parse5.js.org/) for HTML parsing;
- [webcrack](https://github.com/j4k0xb/webcrack) for optional deobfuscation and simplification;
- [QuickJS](https://github.com/justjake/quickjs-emscripten) for isolated partial evaluation used by the cleanup pipeline;
- [Terser](https://terser.org/) for expression simplification and dead-code reduction.

The pipeline is conceptually:

```text
Source
  │
  ▼
Parse AST
  │
  ▼
Resolve lexical scopes
  │
  ▼
Locate target write
  │
  ▼
Follow dependencies
  │
  ▼
Recover relevant previous mutations
  │
  ▼
Reach fixpoint
  │
  ▼
Emit static slice
  │
  ├─────────────── optional ───────────────┐
  │                                        │
  ▼                                        ▼
Raw slice                           webcrack + Terser
                                           │
                                           ▼
                                    cleaned slice
```

---

## Installation

From the repository root:

```sh
corepack pnpm@10.12.1 --filter @animeo/ariadne install --ignore-scripts
```

---

## CLI

### Slice a JavaScript file

```sh
node packages/ariadne/src/cli.js \
  packages/ariadne/fixtures/voe/loader.js \
  --variable _0x1b9c97 \
  --near 'var _0x1b9c97 = _0x469900' \
  --output /tmp/voe-lifted.js
```

### Slice an HTML page

External scripts must already be available locally and explicitly supplied to Ariadne.

```sh
node packages/ariadne/src/cli.js \
  packages/ariadne/fixtures/voe/page.html \
  --variable _0x1b9c97 \
  --script '/js/loader.a40897e.js=packages/ariadne/fixtures/voe/loader.js' \
  --output /tmp/voe-lifted.js
```

Ariadne never downloads the missing scripts itself.

---

## Selecting the target

A JavaScript identifier may be written multiple times.

For example:

```js
let value = first();

value = second();

value = third();
```

Ariadne therefore needs to know **which write** is the slicing criterion.

`--near` accepts a regular expression used to disambiguate candidate declarations or assignments.

Example:

```sh
--near 'var _0x1b9c97 = _0x469900'
```

Among writes to the same variable, Ariadne selects the candidate closest to the supplied pattern.

Ambiguous selection is treated as an error instead of silently guessing.

The observed value is the value **immediately after the selected write**.

Later writes are not part of that observation.

---

## Output

Without `--output`:

- generated JavaScript is written to `stdout`;
- analysis metadata is written to `stderr`.

The API exposes:

```js
{
  code,
  externals,
  target,
  retained,
  missingScripts
}
```

### `code`

`code` is an immediately invoked JavaScript expression that returns the target value.

Example:

```js
(() => {
  function decode(value) {
    return JSON.parse(atob(value));
  }

  const result = decode(payload);

  return result;
})();
```

The returned value may be:

- a primitive;
- an object;
- an array;
- a function.

Ariadne does not force JSON serialization and does not need to mutate a global variable to expose the result.

### `externals`

`externals` contains identifiers that could not be resolved lexically inside the retained source.

Examples include:

```text
document
atob
XMLHttpRequest
someFunctionFromAnotherScript
```

These references remain untouched in the emitted code.

They must exist if the analyst later chooses to execute the extracted result.

### `target`

`target` describes the selected observation point, including:

- identifier name;
- offsets;
- line;
- column.

### `retained`

`retained` describes source ranges kept by the slicer.

### `missingScripts`

When analyzing HTML, external `<script src>` elements that were not explicitly supplied appear in `missingScripts`.

Symbols originating from those scripts may consequently remain external.

---

## API

```js
import {
  liftHtml,
  liftScript,
} from '@animeo/ariadne';

const result = liftScript(source, {
  variable: '_0x1b9c97',
  near: /var _0x1b9c97 = _0x469900/,
});

console.log(result.code);
console.log(result.externals);
console.log(result.target);
console.log(result.retained);
```

HTML:

```js
const result = liftHtml(html, {
  variable: '_0x1b9c97',

  scripts: {
    '/js/loader.a40897e.js': loaderSource,
  },
});
```

For HTML analysis, supplied script keys correspond exactly to the original `src` attributes.

Ariadne does not resolve or fetch URLs.

---

## How the slicer works

At a high level, Ariadne performs the following steps.

### 1. Locate the target write

The selected declaration or assignment becomes the slicing criterion.

### 2. Determine its lexical environment

Ariadne resolves the lexical scope chain surrounding the target.

This is important because identical identifier names do not necessarily represent the same binding.

```js
const value = 1;

function example() {
  const value = 2;

  target = value;
}
```

Here, Ariadne correctly follows the inner `value`.

### 3. Split removable neighbors

Multiple declarations and expression sequences are split when necessary so unrelated siblings can be removed independently.

### 4. Follow references recursively

Identifiers referenced by retained code are resolved back to their reachable declarations.

Required functions are retained with their lexical contents.

### 5. Recover relevant prior state changes

A declaration alone may not represent the state observed at the target.

For example:

```js
const table = [];

table.push('hello');

const result = table[0];
```

Keeping only:

```js
const table = [];
```

would produce the wrong result.

Ariadne therefore also considers earlier operations capable of modifying retained dependencies, including:

- assignments;
- method calls;
- passing retained values to directly resolvable initializers;
- IIFEs;
- direct aliases;
- surrounding control structures required by retained operations.

### 6. Repeat until stable

Newly retained code may introduce new dependencies.

Ariadne repeats dependency discovery until no additional required units are found.

### 7. Rebuild the slice

Retained units are emitted in source order with the necessary nested closures to preserve:

- lexical shadowing;
- directives;
- local bindings.

---

## Obfuscated identifiers are preserved

Ariadne intentionally avoids automatically renaming obfuscated identifiers during cleanup.

An identifier such as:

```js
_0x469900
```

contains little semantic information, but it is often a valuable **stable reference** during reverse engineering.

It can be:

- searched globally;
- compared with the original bundle;
- referenced in notes;
- followed across analysis steps;
- used as an analyst-visible identity.

By contrast, aggressive mangling into:

```js
a
b
c
```

may make the resulting program smaller while making reverse engineering substantially harder.

Ariadne therefore prioritizes **traceability over cosmetic prettification**.

---

## Cleanup and deobfuscation

The static slice may still contain obfuscation artifacts.

For the VOE fixture, the cleaned example can be regenerated with:

```sh
corepack pnpm@10.12.1 --filter @animeo/ariadne clean:voe
```

The cleanup pipeline currently uses:

```text
Ariadne slice
     │
     ▼
  webcrack
     │
     ▼
   Terser
     │
     ▼
cleaned slice
```

### webcrack

webcrack can recognize patterns such as:

- string arrays;
- string-array rotations;
- decoder wrappers;
- constant decoding paths.

Recognized fragments may be partially evaluated.

### QuickJS isolation

Partial evaluation performed during cleanup runs inside a fresh QuickJS interpreter.

The environment has:

- no host functions;
- no DOM;
- no network;
- no module loader;
- a 2-second execution limit;
- a 32 MiB memory limit;
- a 512 KiB stack limit.

Mutations inside that temporary environment are not applied to the Node.js host.

This isolation protects the host.

It does **not** constitute a formal proof that arbitrary side effects can safely be removed.

### Terser

Three Terser passes are then used to:

- simplify expressions;
- remove dead code;
- reduce unnecessary intermediate structures.

Identifier mangling remains disabled.

The resulting artifact stays formatted and traceable back to the original source.

---

## Static analysis vs other reverse engineering techniques

Ariadne is deliberately specialized.

It complements rather than replaces other techniques.

### Manual static analysis

Traditional manual reverse engineering often starts with:

- string searches;
- symbol searches;
- reference navigation;
- call graph inspection;
- code reading.

This remains extremely powerful.

Ariadne automates part of the navigation and dependency-reduction work.

### Dynamic analysis

Runtime tools can provide:

- breakpoints;
- traces;
- runtime values;
- call stacks;
- mutation observation;
- instrumentation.

Dynamic analysis answers:

> What happened during this execution?

Static slicing asks:

> What code may contribute to this value?

Both perspectives are useful.

### Dynamic slicing

A dynamic slice is based on a particular execution trace.

It can often produce a smaller and more precise result for that execution, but requires:

- executable code;
- a reproducible environment;
- appropriate inputs;
- instrumentation.

Ariadne currently focuses on static slicing.

### Deobfuscation

Tools such as webcrack attempt to identify and simplify known obfuscation patterns.

Deobfuscation and slicing solve different problems.

Deobfuscation asks:

> Can this program be made easier to read?

Slicing asks:

> Which part of this program matters to my target?

Ariadne uses both techniques together when cleanup is requested.

### Symbolic execution

Symbolic execution can reason about program behavior over symbolic inputs rather than concrete values.

It is substantially more powerful in some scenarios, but also much more complex for highly dynamic JavaScript.

Ariadne does not currently attempt general-purpose symbolic execution.

### Emulation and sandboxed execution

Executing extracted code in a controlled runtime can be useful to:

- validate a slice;
- compare behavior;
- test hypotheses;
- inspect intermediate values.

This belongs to the planned analysis workflow rather than the static slicing core.

---

## Safety model

There are two distinct phases.

### Static extraction

`liftScript()` and `liftHtml()` do not execute supplied JavaScript.

The analyzed source is treated as data.

### Optional execution

Generated slices remain third-party code.

If an analyst later chooses to execute them, they must still be treated as untrusted.

Ariadne's extraction process is **not** a sandbox.

The QuickJS sandbox used during recognized cleanup transformations should not be interpreted as a general-purpose safe execution environment for arbitrary extracted programs.

---

## Limitations

Ariadne is a practical targeted slicer, not a complete semantic model of JavaScript.

### Current source model

Ariadne currently targets classic ES2022 JavaScript.

ES modules are rejected.

For HTML:

- scripts must be supplied in execution order;
- asynchronous loading is not modeled;
- dynamically inserted scripts are not modeled.

### Target restrictions

The target must currently be a simple declaration or standalone assignment in a supported context.

Targets inside the following constructs are rejected:

- branches;
- loops;
- lexical blocks requiring unsupported reconstruction;
- async functions;
- generators.

### Removed execution contexts

Enclosing bodies may be extracted without reproducing the original bundle or callback invocation.

Ariadne therefore rejects cases requiring unavailable contextual state such as:

- invocation-specific arguments;
- removed `this`;
- removed `arguments`;
- state established later before an asynchronous callback executes.

### Dynamic language features

Ariadne deliberately does not model arbitrary:

- direct `eval`;
- `with`;
- dynamically generated code;
- proxy behavior;
- getter side effects;
- aliases stored through arbitrary object properties;
- mutations hidden behind unresolved function calls;
- relationships between `window.x` and lexical/global bindings.

### Reachability assumption

Ariadne assumes the selected target point is reached.

It does not preserve unrelated effects whose only purpose would be to terminate or redirect execution before the target.

---

## Testing

Run the test suite with:

```sh
corepack pnpm@10.12.1 --filter @animeo/ariadne test
```

Current tests cover:

- scope resolution;
- lexical shadowing;
- cycles;
- assignments;
- prior writes;
- initialization;
- direct aliases;
- unresolved externals;
- ambiguous targets;
- HTML;
- missing scripts;
- CLI behavior;
- output equivalence on known fixtures.

---

## VOE fixture

`fixtures/voe/loader.js` is used as a real-world-inspired reverse engineering fixture.

`page.html` and `expected.json` provide a deterministic synthetic example without requiring a live media URL.

The payload was generated independently from the slicer by reversing the observed decoding pipeline:

```text
JSON
 ↓
base64
 ↓
reverse
 ↓
character shift +3
 ↓
base64
 ↓
insert ^^ markers
 ↓
ROT13
```

This allows the extraction and cleanup logic to be verified against known behavior.

---

## Project philosophy

Ariadne is built around a simple observation:

**Reverse engineering becomes easier as the known part of the program grows.**

Analysts rarely understand a large unknown program from top to bottom.

They usually begin with an anchor:

- a recognizable string;
- an interesting function;
- an API endpoint;
- a payload;
- a configuration object;
- an output value.

From that point, dependencies are explored, understood, named, simplified, and progressively turned into known territory.

Ariadne is intended to support that workflow.

```text
Unknown program
      │
      ▼
  Find an anchor
      │
      ▼
 Follow dependencies
      │
      ▼
 Understand a subsystem
      │
      ▼
 Expand known territory
```

---

## Roadmap

Ariadne is currently focused on building a reliable slicing engine before expanding into a complete reverse engineering environment.

### Short term

Planned improvements include:

- richer retained-node metadata;
- better mutation provenance;
- better direct-alias tracking;
- additional real-world fixtures;
- improved diagnostics;
- graph serialization;
- explicit explanations for why a statement was retained.

### MCP server

The next major planned component is a **Model Context Protocol server**.

The initial MCP implementation will remain deliberately simple and will not require a graphical interface.

The goal is to let an AI agent progressively operate inside an Ariadne analysis project.

Potential MCP operations include:

```text
open_project
create_slice
list_anchors
inspect_symbol
inspect_node
get_dependencies
get_prior_writes
get_externals
get_original_source
explain_retention
save_note
save_variant
```

This would allow an analyst and an AI agent to work incrementally rather than repeatedly passing large source files through a conversation.

For example, an agent could ask:

```text
Show me the dependencies of _0x469900.
```

then:

```text
Slice the value returned by _0x469900.
```

then:

```text
Show me every mutation of the retained table before the target.
```

and progressively build an understanding of the program.

---

## Differential analysis

A longer-term goal is to support controlled comparison between:

1. the original extracted computation;
2. an analyst-created simplified implementation.

Given arbitrary inputs:

```text
Input
  │
  ├────────► Original
  │              │
  │              ▼
  │           result A
  │
  └────────► Simplified
                 │
                 ▼
              result B
```

Ariadne could then report:

```text
MATCH
```

or:

```text
MISMATCH
```

and progressively locate the first observable divergence.

This would allow reverse engineers and AI agents to test hypotheses instead of relying solely on code inspection.

---

## Future work

Longer-term directions include:

- persistent analysis projects;
- semantic renaming without losing original identities;
- known / unknown / verified analysis states;
- nested slices;
- dependency graphs;
- control-flow visualization;
- graph contraction for understood subsystems;
- original ↔ simplified source mapping;
- analyst notes;
- behavioral checkpoints;
- first-divergence search;
- sandboxed differential execution;
- MCP-based AI collaboration;
- eventually, a dedicated graphical reverse engineering workbench.

A future UI could synchronize:

```text
Code
Graph
Behavior
```

so selecting a symbol or graph node reveals:

- its source;
- dependencies;
- previous writes;
- externals;
- analyst notes;
- retained reason;
- test behavior.

For now, the priority remains the core engine and an MCP interface that can expose these primitives cleanly.

---

## Non-goals

Ariadne is not intended to become:

- a universal JavaScript semantic solver;
- a complete browser emulator;
- a general-purpose sandbox;
- an automatic replacement for a reverse engineer;
- a tool that blindly rewrites identifiers until code looks prettier.

Its role is narrower:

> Reduce the maze while preserving the thread.

---

## Contributing

Contributions are welcome.

Particularly useful contributions include:

- minimal failing examples;
- scope-resolution edge cases;
- mutation edge cases;
- alias-analysis improvements;
- sanitized real-world fixtures;
- HTML script-order cases;
- performance improvements;
- MCP workflow proposals;
- documentation improvements.

When reporting a slicing bug, a reduced reproducible fixture is strongly preferred.

---

## Credits

Ariadne builds on excellent open-source work:

- [Acorn](https://github.com/acornjs/acorn)
- [eslint-scope](https://github.com/eslint/js/tree/main/packages/eslint-scope)
- [parse5](https://parse5.js.org/)
- [webcrack](https://github.com/j4k0xb/webcrack)
- [QuickJS](https://github.com/justjake/quickjs-emscripten)
- [Terser](https://terser.org/)

---

<p align="center">
  <strong>Find one thread.</strong><br>
  Follow it until the maze makes sense.
</p>