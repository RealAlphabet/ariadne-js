#!/usr/bin/env node
import { readFile, writeFile } from 'node:fs/promises';
import { extname } from 'node:path';
import { parseArgs } from 'node:util';
import { liftHtml, liftScript } from './index.js';

try {
  const { values, positionals } = parseArgs({
    allowPositionals: true,
    options: {
      variable: { type: 'string', short: 'v' },
      near: { type: 'string' },
      output: { type: 'string', short: 'o' },
      html: { type: 'boolean' },
      script: { type: 'string', multiple: true },
      help: { type: 'boolean', short: 'h' },
    },
  });
  if (values.help) {
    console.log(`Ariadne — follow a variable's thread through JavaScript.

ariadne <input.js|page.html> --variable <name> [--near <regex>] [--output result.js]
  --html                  Treat input as HTML (automatic for .html/.htm)
  --script <src>=<file>    Supply an external HTML script; repeat as needed

Output is a JavaScript expression returning the variable's value. It is not executed.
Unresolved identifiers and missing script URLs are reported on stderr.`);
  } else {
    if (positionals.length !== 1 || !values.variable) throw new Error('Expected one input file and --variable <name>. Use --help.');
    const source = await readFile(positionals[0], 'utf8');
    const scripts = Object.create(null);
    for (const mapping of values.script ?? []) {
      const separator = mapping.lastIndexOf('=');
      if (separator <= 0 || separator === mapping.length - 1) throw new Error('--script expects <src>=<file>.');
      scripts[mapping.slice(0, separator)] = await readFile(mapping.slice(separator + 1), 'utf8');
    }
    const options = { variable: values.variable, near: values.near, scripts };
    const html = values.html || ['.html', '.htm'].includes(extname(positionals[0]).toLowerCase());
    const result = html ? liftHtml(source, options) : liftScript(source, options);
    if (values.output) await writeFile(values.output, result.code);
    else process.stdout.write(result.code);
    console.error(JSON.stringify({ target: result.target, externals: result.externals, missingScripts: result.missingScripts }, null, 2));
  }
} catch (error) {
  console.error(`Ariadne: ${error.message}`);
  process.exitCode = 1;
}
