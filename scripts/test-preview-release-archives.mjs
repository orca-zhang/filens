import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import test from 'node:test';
import { packagePreviewReleaseArchives } from './preview-release-archives.mjs';

const run = (command, args) => {
  const result = spawnSync(command, args, { encoding: null });
  assert.equal(result.status, 0, result.stderr?.toString());
  return result.stdout;
};

test('keeps precompressed JavaScript optional in GitHub release archives', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'filens-preview-release-'));
  try {
    const previewDirectory = path.join(root, 'preview-dist'), releaseDirectory = path.join(root, 'release');
    for (const mode of ['split', 'all-in-one']) await mkdir(path.join(previewDirectory, mode), { recursive: true });
    await mkdir(path.join(previewDirectory, 'split', 'archive'), { recursive: true });
    await mkdir(path.join(previewDirectory, 'all-in-one', 'archive'), { recursive: true });
    await mkdir(releaseDirectory, { recursive: true });
    await writeFile(path.join(root, 'LICENSE'), 'MIT License\n');
    await writeFile(path.join(previewDirectory, 'split', 'filens.js'), 'split runtime');
    await writeFile(path.join(previewDirectory, 'split', 'archive', '7zz.wasm'), Buffer.from([0, 97, 115, 109]));
    await writeFile(path.join(previewDirectory, 'all-in-one', 'filens.js'), 'all-in-one runtime');
    await writeFile(path.join(previewDirectory, 'all-in-one', 'filens.js.gz'), Buffer.from('gzip-sidecar'));
    await writeFile(path.join(previewDirectory, 'all-in-one', 'filens.js.br'), Buffer.from('brotli-sidecar'));
    await writeFile(path.join(previewDirectory, 'all-in-one', 'archive', '7zz.wasm'), Buffer.from([0, 97, 115, 109]));
    const archives = await packagePreviewReleaseArchives({
      previewDirectory, releaseDirectory, version: '0.3.7', tag: 'v0.6.7', date: '2026-11-24',
      licensePath: path.join(root, 'LICENSE')
    });
    const splitZip = path.join(releaseDirectory, 'filens-preview-0.3.7-split.zip');
    const mainZip = path.join(releaseDirectory, 'filens-preview-0.3.7-all-in-one.zip');
    const sidecarZip = path.join(releaseDirectory, 'filens-preview-0.3.7-all-in-one-precompressed.zip');
    const mainFiles = run('unzip', ['-Z1', mainZip]).toString().trim().split('\n');
    const optionalFiles = run('unzip', ['-Z1', sidecarZip]).toString().trim().split('\n');
    assert(mainFiles.includes('filens-preview-0.3.7-all-in-one/filens.js'));
    assert(mainFiles.includes('filens-preview-0.3.7-all-in-one/archive/7zz.wasm'));
    assert(!mainFiles.some(file => /filens\.js\.(?:gz|br)$/.test(file)));
    assert(optionalFiles.includes('filens.js.gz'));
    assert(optionalFiles.includes('filens.js.br'));
    assert.equal(run('unzip', ['-p', sidecarZip, 'filens.js.gz']).toString(), 'gzip-sidecar');
    assert.equal(run('unzip', ['-p', sidecarZip, 'filens.js.br']).toString(), 'brotli-sidecar');
    assert(optionalFiles.includes('README.md'));
    assert(run('unzip', ['-p', sidecarZip, 'README.md']).toString().includes('Content-Encoding'));
    assert(run('unzip', ['-p', splitZip, 'filens-preview-0.3.7-split/filens.js']).toString().includes('split runtime'));
    assert.deepEqual(archives.map(item => item.kind), ['browser-split', 'browser-precompressed-sidecars', 'browser-all-in-one']);
    run('unzip', ['-tq', mainZip]);
    run('unzip', ['-tq', sidecarZip]);
    assert.equal((await readFile(path.join(releaseDirectory, 'filens-preview-0.3.7-all-in-one', 'filens.js'))).toString(), 'all-in-one runtime');
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
