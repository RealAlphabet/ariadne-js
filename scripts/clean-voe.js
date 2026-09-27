import { readFile, writeFile } from 'node:fs/promises';
import { minify } from 'terser';
import { deobfuscate } from './deobfuscate.js';

const input = new URL('../examples/voe-lifted.js', import.meta.url);
const output = new URL('../examples/voe-lifted-clean.js', import.meta.url);
const source = await readFile(input, 'utf8');
const decoded = await deobfuscate(source);
const result = await minify(decoded, {
  ecma: 2022,
  // The script's completion value is Ariadne's result, not disposable output.
  compress: {
    expression: true,
    passes: 3,
    pure_getters: false,
    sequences: false,
    conditionals: false,
    join_vars: false,
    booleans_as_integers: false,
  },
  mangle: false,
  keep_fnames: true,
  keep_classnames: true,
  format: { beautify: true, indent_level: 2, comments: false },
});
if (!result.code) throw new Error('Terser produced no code.');
await writeFile(output, `${result.code}\n`);
console.log(`voe-lifted.js: ${Buffer.byteLength(source)} bytes → voe-lifted-clean.js: ${Buffer.byteLength(result.code) + 1} bytes`);
