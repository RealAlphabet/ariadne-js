import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';
import { parse } from 'acorn';

const cwd = fileURLToPath(new URL('..', import.meta.url));

test('CLI writes runnable JS and keeps extraction metadata on stderr', async () => {
  const temporary = await mkdtemp(join(tmpdir(), 'ariadne-'));
  try {
    const output = join(temporary, 'result.js');
    const result = spawnSync(process.execPath, ['src/cli.js', 'fixtures/voe/page.html',
      '--variable', '_0x1b9c97', '--script', '/js/loader.a40897e.js=fixtures/voe/loader.js', '--output', output],
    { cwd, encoding: 'utf8' });
    assert.ifError(result.error);
    assert.equal(result.status, 0, result.stderr);
    assert.equal(result.stdout, '');
    assert.equal(JSON.parse(result.stderr).target.variable, '_0x1b9c97');
    parse(await readFile(output, 'utf8'), { ecmaVersion: 2022 });
  } finally {
    await rm(temporary, { recursive: true, force: true });
  }
});

test('CLI provides help and fails with an actionable diagnostic', () => {
  assert.match(execFileSync(process.execPath, ['src/cli.js', '--help'], { cwd, encoding: 'utf8' }), /Ariadne/);
  const result = spawnSync(process.execPath, ['src/cli.js', 'fixtures/voe/loader.js', '--variable', 'missing'], { cwd, encoding: 'utf8' });
  assert.ifError(result.error);
  assert.equal(result.status, 1);
  assert.equal(result.stdout, '');
  assert.match(result.stderr, /Target variable not found/);
});
