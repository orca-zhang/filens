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
    await writeFile(path.join(root, 'skills/filens/SKILL.md'), '# FiLens\n[Read](references/reading.md)\n');
    await writeFile(path.join(root, 'skills/filens/references/reading.md'), 'Reading reference\n');

    await stageSiteDownloads(root);

    const output = path.join(root, 'apps/demo/dist/downloads');
    const html = await readFile(path.join(output, 'index.html'), 'utf8');
    assert.match(html, /github\.com\/orca-zhang\/filens\/releases\/download\/v1\.0\.0\/filens-test\.zip/);
    assert.match(html, /cdn\.jsdelivr\.net\/npm\/filens-preview@1\/dist\/split\/filens\.js/);
    assert.match(html, /registry\.npmmirror\.com\/filens-preview/);
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
