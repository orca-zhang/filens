import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import test from 'node:test';

const require = createRequire(import.meta.url);
const picomatchPath = require.resolve('picomatch');

test('published repeated-extglob PoCs finish promptly, including with recursion checks disabled', () => {
  const cases = [
    { pattern: '+(*)', length: 24 },
    { pattern: '+(*a)', length: 32 },
  ];

  for (const { pattern, length } of cases) {
    const input = `${'a'.repeat(length)}/`;

    for (const options of [{}, { maxExtglobRecursion: false }]) {
      const source = `const picomatch = require(${JSON.stringify(picomatchPath)}); process.stdout.write(String(picomatch(${JSON.stringify(pattern)}, ${JSON.stringify(options)})(${JSON.stringify(input)})));`;
      const result = spawnSync(process.execPath, ['-e', source], {
        encoding: 'utf8',
        timeout: 2500,
      });

      assert.equal(result.error?.code, undefined, `${pattern} should finish before the timeout`);
      assert.equal(result.status, 0, result.stderr);
      assert.equal(result.stdout, 'false');
    }
  }
});

test('safe repeated extglobs and literal wildcard branches keep their matching behavior', () => {
  const picomatch = require('picomatch');

  assert.equal(picomatch('+(ab)')('abab'), true);
  assert.equal(picomatch('+(ab)')('abx'), false);
  assert.equal(picomatch('+([ab])')('abba'), true);
  assert.equal(picomatch('+(\\*)')('***'), true);
});
