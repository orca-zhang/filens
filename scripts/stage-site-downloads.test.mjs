import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import JSZip from 'jszip';
import { stageSiteDownloads } from './stage-site-downloads.mjs';

test('stages external package links without copying release artifacts to the site', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'filens-downloads-'));
  try {
    const manifest = { tag: 'v1.0.0', components: { cli: '1', preview: '1', mobileSdk: '1' }, assets: [
      { file: 'filens-test.zip', kind: 'cli-lite', bytes: 1234, sha256: 'a'.repeat(64) },
      { file: 'preview.zip', kind: 'browser-all-in-one', bytes: 2345, sha256: 'b'.repeat(64) },
      { file: 'preview-precompressed.zip', kind: 'browser-precompressed-sidecars', bytes: 3456, sha256: 'c'.repeat(64) }
    ] };
    await mkdir(path.join(root, 'docs'));
    await mkdir(path.join(root, 'skills/filens/references'), { recursive: true });
    await writeFile(path.join(root, 'docs/preview-release-sizes.json'), JSON.stringify(manifest));
    await writeFile(path.join(root, 'docs/preview-package-sizes.json'), JSON.stringify({
      name: 'filens-preview', version: '1', file: 'filens-preview-1.tgz', bytes: 1000
    }));
    await writeFile(path.join(root, 'docs/preview-split-package-sizes.json'), JSON.stringify({
      name: 'filens-preview-split', version: '1', file: 'filens-preview-split-1.tgz', bytes: 500
    }));
    await writeFile(path.join(root, 'docs/preview-npm-validation.json'), JSON.stringify({
      name: 'filens-preview', version: '1', source: 'public registry with fresh npm cache', passed: true
    }));
    await writeFile(path.join(root, 'docs/preview-split-npm-validation.json'), JSON.stringify({
      name: 'filens-preview-split', version: '1', source: 'offline npm tarball', passed: true
    }));
    await writeFile(path.join(root, 'docs/release-v0.6.7-publication.json'), JSON.stringify({ assets: [
      { file: 'filens-1-macos-arm64-lite.tar.gz', bytes: 2000,
        publicUrl: 'https://github.com/orca-zhang/filens/releases/download/v0.6.7/filens-1-macos-arm64-lite.tar.gz' }
    ] }));
    await writeFile(path.join(root, 'skills/filens/SKILL.md'), '# FiLens\n[Read](references/reading.md)\n');
    await writeFile(path.join(root, 'skills/filens/references/reading.md'), 'Reading reference\n');

    await stageSiteDownloads(root);

    const output = path.join(root, 'apps/demo/dist/downloads');
    const html = await readFile(path.join(output, 'index.html'), 'utf8');
    assert.match(html, /github\.com\/orca-zhang\/filens\/releases\/download\/v1\.0\.0\/filens-test\.zip/);
    assert.match(html, /cdn\.jsdelivr\.net\/npm\/filens-preview@1\/dist\/split\/filens\.js/);
    assert.match(html, /npm install filens-preview@1/);
    assert.doesNotMatch(html, /filens-preview-split@1/);
    assert.match(html, /registry\.npmmirror\.com\/filens-preview/);
    assert.match(html, /releases\/download\/v0\.6\.7\/filens-1-macos-arm64-lite\.tar\.gz/);
    assert.match(html, /optional static-host sidecars/);
    assert.doesNotMatch(html, /filens\.cc\/cdn/);
    await assert.rejects(readFile(path.join(output, 'v1.0.0/filens-test.zip')), { code: 'ENOENT' });
    await assert.rejects(readFile(path.join(root, 'apps/demo/dist/cdn/filens.js')), { code: 'ENOENT' });

    const zip = await JSZip.loadAsync(await readFile(path.join(output, 'filens-skill.zip')));
    assert.equal(await zip.file('filens/references/reading.md').async('string'), 'Reading reference\n');
    assert.match(await zip.file('filens/SKILL.md').async('string'), /references\/reading\.md/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
