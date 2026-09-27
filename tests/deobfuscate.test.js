import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import { runInNewContext } from 'node:vm';
import { deobfuscate, evaluateDecoder } from '../scripts/deobfuscate.js';

test('decoder mutations remain inside a fresh QuickJS environment', async () => {
  const hostPush = Array.prototype.push;
  assert.equal(await evaluateDecoder(`
    globalThis.ariadneMarker = 42;
    Array.prototype.push = () => 99;
    [].push(1);
  `), 99);
  assert.equal(globalThis.ariadneMarker, undefined);
  assert.equal(Array.prototype.push, hostPush);
  assert.deepEqual(await evaluateDecoder('[typeof ariadneMarker, [].push(1)]'), ['undefined', 1]);
  assert.deepEqual(await evaluateDecoder('[typeof process, typeof require, typeof fetch, typeof document]'),
    ['undefined', 'undefined', 'undefined', 'undefined']);
});

test('decoder evaluation interrupts nonterminating initialization', async () => {
  await assert.rejects(evaluateDecoder('while (true) {}', { timeoutMs: 20 }), error => /interrupted/i.test(error.message));
});

test('webcrack removes the actual VOE table and preserves varying runtime inputs', async () => {
  const source = await readFile(new URL('../examples/voe-lifted.js', import.meta.url), 'utf8');
  const decoded = await deobfuscate(source);
  const clean = await readFile(new URL('../examples/voe-lifted-clean.js', import.meta.url), 'utf8');
  for (const code of [decoded, clean]) {
    assert.doesNotMatch(code, /px_0_0x3bd2|px_0_0x588a|_0x47654c|parseInt/);
    assert.ok(code.length < source.length / 2);
  }
  function encode(value) {
    const inner = btoa(JSON.stringify(value)).split('').reverse().join('');
    const outer = btoa([...inner].map(char => String.fromCharCode(char.charCodeAt(0) + 3)).join(''));
    return outer.replace(/[a-z]/gi, char => {
      const start = char <= 'Z' ? 65 : 97;
      return String.fromCharCode(start + (char.charCodeAt(0) - start + 13) % 26);
    });
  }
  for (const expected of [{ title: 'Different input', count: 12 }, ['array', false, null], {}]) {
    const document = { querySelectorAll: () => [
      { textContent: 'invalid JSON' },
      { textContent: JSON.stringify([encode(expected)]) },
    ] };
    for (const code of [source, decoded, clean]) {
      const actual = runInNewContext(code, { atob, document }, { timeout: 1000 });
      assert.deepEqual(JSON.parse(JSON.stringify(actual)), expected);
    }
  }
});
