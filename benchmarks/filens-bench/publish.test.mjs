import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { cp, mkdtemp, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { JSDOM } from 'jsdom';
import JSZip from 'jszip';
import { stageFilensBench } from './publish.mjs';

const source = fileURLToPath(new URL('published/', import.meta.url));

test('publishes standalone bilingual results and a verifiable summary archive without local run files', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'filens-bench-site-'));
  try {
    const published = path.join(root, 'benchmarks/filens-bench/published');
    await cp(source, published, { recursive: true });
    const { snapshot } = JSON.parse(await readFile(path.join(published, 'latest.json'), 'utf8'));
    const dataPath = path.join(published, snapshot, 'baselines.json');
    const data = JSON.parse(await readFile(dataPath, 'utf8'));
    // Untrusted labels must stay text, and missing usage must stay unknown.
    data.baselines[0].harness = '<img src=x onerror="alert(1)">';
    data.baselines[0].metrics.allTaskTokensKnownSubtotal.stock = null;
    await writeFile(dataPath, JSON.stringify(data));
    await writeFile(path.join(published, snapshot, 'private-trace.json'), 'not public');
    await mkdir(path.join(root, 'benchmarks/filens-bench/results'), { recursive: true });
    await writeFile(path.join(root, 'benchmarks/filens-bench/results/private.json'), 'not public');

    const output = await stageFilensBench(root);
    const version = path.join(output, 'snapshots', snapshot);
    for (const [directory, file, lang] of [
      [output, 'index.html', 'zh-CN'], [output, 'en.html', 'en'],
      [version, 'index.html', 'zh-CN'], [version, 'en.html', 'en']
    ]) {
      const dom = new JSDOM(await readFile(path.join(directory, file), 'utf8'));
      const doc = dom.window.document;
      assert.equal(doc.documentElement.lang, lang);
      assert.equal(doc.querySelectorAll('tbody tr').length, data.baselines.length);
      assert.equal(doc.querySelector('tbody th').firstChild.textContent, data.baselines[0].harness);
      assert.equal(doc.querySelector('tbody img'), null);
      assert.match(doc.querySelector('tbody tr td:last-child').textContent, /— →/);
      assert.equal(doc.querySelectorAll('script').length, 0);
      for (const element of doc.querySelectorAll('a[href], img[src]')) {
        const url = element.getAttribute('href') ?? element.getAttribute('src');
        if (url.startsWith('https://') || url.startsWith('/') || url.startsWith('#')) continue;
        await readFile(path.resolve(directory, url.endsWith('/') ? `${url}index.html` : url));
      }
      dom.window.close();
    }

    const zipName = `filens-bench-${snapshot}.zip`;
    const zip = await JSZip.loadAsync(await readFile(path.join(version, zipName)));
    assert.deepEqual(Object.keys(zip.files).sort(), ['README.md', 'baselines.json', 'quality-radar.svg', 'summary.svg']);
    assert.deepEqual(JSON.parse(await zip.file('baselines.json').async('string')), data);
    const sums = (await readFile(path.join(version, 'SHA256SUMS'), 'utf8')).trim().split('\n');
    assert.equal(sums.length, 5);
    for (const line of sums) {
      const [expected, file] = line.split('  ');
      const bytes = await readFile(path.join(version, file));
      assert.equal(createHash('sha256').update(bytes).digest('hex'), expected);
    }
    assert.ok(!(await readdir(version)).some(file => file.includes('private')));
    const firstZip = await readFile(path.join(version, zipName));
    await stageFilensBench(root);
    assert.deepEqual(await readFile(path.join(version, zipName)), firstZip);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('rejects invalid snapshot paths and missing public artifacts', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'filens-bench-invalid-'));
  try {
    const published = path.join(root, 'benchmarks/filens-bench/published');
    await cp(source, published, { recursive: true });
    const latest = await readFile(path.join(published, 'latest.json'), 'utf8');
    await writeFile(path.join(published, 'latest.json'), JSON.stringify({ snapshot: '../../results' }));
    await assert.rejects(stageFilensBench(root), /Invalid public benchmark snapshot/);
    await writeFile(path.join(published, 'latest.json'), latest);
    const { snapshot } = JSON.parse(latest);
    await rm(path.join(published, snapshot, 'summary.svg'));
    await assert.rejects(stageFilensBench(root), { code: 'ENOENT' });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
