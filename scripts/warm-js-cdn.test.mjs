import assert from 'node:assert/strict';
import { test } from 'node:test';
import { cdnWarmupTargets } from './warm-js-cdn.mjs';

test('warms runtime chunks, workers and WASM while excluding compressed sidecars and documentation', () => {
  const runtime = ['dist/split/filens.js', 'dist/all-in-one/filens.js', 'dist/split/chunks/pdf.js',
    'dist/split/pdf.worker.mjs', 'dist/split/archive/7zz.wasm'];
  const excluded = ['dist/all-in-one/filens.js.br', 'dist/all-in-one/filens.js.gz', 'dist/index.d.ts',
    'dist/split/index.html', 'README.md', 'dist/split/THIRD-PARTY-NOTICES.txt'];
  const targets = cdnWarmupTargets({ version: '1.2.3', files: [...runtime, ...excluded].map(path => ({ path, bytes: 123 })) });
  assert.deepEqual(targets, runtime.map(file => ({ url: `https://filens.cc/cdn/filens-preview@1.2.3/${file.slice(5)}`, bytes: 123 })));
  assert.throws(() => cdnWarmupTargets({ version: '1.2.3', files: [{ path: runtime[0], bytes: 1 }] }), /Missing all-in-one/);
});
