import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import { runInNewContext } from 'node:vm';
import { parse } from 'parse5';
import { liftHtml, liftScript } from '../src/index.js';

const fixture = name => readFile(new URL(`../fixtures/voe/${name}`, import.meta.url), 'utf8');
const loader = await fixture('loader.js');
const html = await fixture('page.html');
const expected = JSON.parse(await fixture('expected.json'));

// Minimal document for this fixture's one selector; does not run page scripts.
function documentFor(html) {
  const scripts = [];
  function walk(node) {
    if (node.tagName === 'script' && node.attrs.some(attribute => attribute.name === 'type' && attribute.value === 'application/json')) {
      scripts.push({ textContent: node.childNodes.map(child => child.value).join('') });
    }
    for (const child of node.childNodes ?? []) walk(child);
  }
  walk(parse(html));
  return {
    querySelectorAll(selector) {
      assert.equal(selector, 'script[type="application/json"]');
      return scripts;
    },
  };
}

test('the supplied VOE loader decodes a fixed synthetic payload using only the lifted computation', () => {
  const result = liftHtml(html, {
    variable: '_0x1b9c97',
    near: /var _0x1b9c97 = _0x469900/,
    scripts: { '/js/loader.a40897e.js': loader },
  });
  const actual = runInNewContext(result.code, { atob, document: documentFor(html) }, { timeout: 1000 });
  assert.deepEqual(JSON.parse(JSON.stringify(actual)), expected);
  assert.deepEqual(result.missingScripts, []);
  assert.deepEqual(result.externals, ['Array', 'JSON', 'RegExp', 'String', 'Symbol', 'TypeError', 'atob', 'document', 'parseInt']);
  assert.ok(result.code.length < loader.length / 4);
  assert.doesNotMatch(result.code, /system-feedback|\.setup\(|_0x2c4bc7|_0x473d27/);
});

test('extracts the decoder itself as a function with its lexical dependencies', () => {
  const source = loader.replace('var _0x1b9c97 = _0x469900(_0x239d18)', 'var ariadneDecoder = _0x469900; var _0x1b9c97 = _0x469900(_0x239d18)');
  const result = liftScript(source, { variable: 'ariadneDecoder' });
  assert.ok(!result.externals.includes('document'));
  const decoder = runInNewContext(result.code, { atob }, { timeout: 1000 });
  const texts = documentFor(html).querySelectorAll('script[type="application/json"]');
  const encoded = JSON.parse(texts[1].textContent)[0];
  assert.deepEqual(JSON.parse(JSON.stringify(decoder(encoded))), expected);
});

test('the checked-in lifted and deobfuscated scripts preserve the decoded completion value', async () => {
  for (const file of ['voe-lifted.js', 'voe-lifted-clean.js']) {
    const code = await readFile(new URL(`../examples/${file}`, import.meta.url), 'utf8');
    const actual = runInNewContext(code, { atob, document: documentFor(html) }, { timeout: 1000 });
    assert.deepEqual(JSON.parse(JSON.stringify(actual)), expected, file);
  }
});
