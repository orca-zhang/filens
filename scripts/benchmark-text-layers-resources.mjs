// Engineering A/B comparison; inputs, imports, serialization and checks are untimed.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { gunzipSync, gzipSync } from 'node:zlib';
import { build } from 'esbuild';
import { createServer } from 'vite';
import { chromium } from '@playwright/test';
import { createLayeredDxfFixture } from '../packages/cad/test/fixtures/resources.mjs';

const option = (name, fallback) => {
  const index = process.argv.indexOf(name);
  if (index < 0) return fallback;
  assert(process.argv[index + 1] && !process.argv[index + 1].startsWith('--'));
  return process.argv[index + 1];
};
const baselinePath = option('--baseline', 'benchmarks/frontend/2026-11-04/text-layers-resources-source-baseline.json.gz');
const output = option('--output', 'tmp/text-layers-resources-current/results.json');
const work = path.dirname(output);
await mkdir(work, { recursive: true });
const savedBytes = await readFile(baselinePath);
const baselineBytes = baselinePath.endsWith('.gz') ? gunzipSync(savedBytes) : savedBytes;
const sources = JSON.parse(baselineBytes).files;
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const result = { date: new Date().toISOString(), node: process.version, cpu: os.cpus()[0].model,
  method: 'Identical minified esbuild bundles with baseline source overrides and shared current dependencies. Two warmups and seven alternating measured runs in Chromium. Complete text-frame/document construction, synchronous CAD layer actions, or resource index construction/lookups only. Input generation, imports, DXF loading, output serialization and validation are outside timers. No builds/tests run concurrently.',
  warmups: 2, iterations: 7, baselineSha256: sha(baselineBytes), sourceSha256: {}, baselineSourceSha256: {},
  bundles: {}, dependencies: {}, cases: {}, fixtures: {}, errors: [] };
for (const [file, source] of Object.entries(sources)) {
  result.sourceSha256[file] = sha(await readFile(file));
  result.baselineSourceSha256[file] = sha(source);
}
for (const file of ['packages/core/dist/index.js', 'packages/core/dist/zip.js', 'packages/xlsx/dist/index.js']) {
  result.dependencies[file] = sha(await readFile(file));
}
for (const engine of ['baseline', 'current']) {
  const entry = path.join(work, `runtime-${engine}.mjs`);
  await build({ stdin: { resolveDir: process.cwd(), contents:
    "export { buildTextFrameFromStorage } from './packages/iwork/src/parser/helpers.ts';" +
    "export { buildParsedDocument, findParagraphIndexForCharacter, findParagraphEndIndexForCharacter } from './packages/iwork/src/parser/semantic.ts';" +
    "export { loadIwork } from './packages/iwork/src/parser/load-iwork.ts';" +
    "export { CadPreviewSession } from './packages/cad/src/preview-driver.ts';" +
    "export { createFileSetResourceIndex } from './packages/core/src/preview/resource-resolver.ts';" },
    outfile: entry, bundle: true, minify: true, platform: 'browser', format: 'esm', target: 'es2020',
    external: ['@filens/core', '@filens/core/*', '@filens/xlsx'],
    plugins: [{ name: 'comparison-sources', setup(builder) {
      builder.onLoad({ filter: /\.ts$/ }, async args => {
        const file = path.relative(process.cwd(), args.path);
        if (!(file in sources)) return;
        let contents = engine === 'baseline' ? sources[file] : await readFile(args.path, 'utf8');
        // Expose private lookups in the benchmark only, for exhaustive boundary checks.
        if (file.endsWith('/semantic.ts')) contents += '\nexport { findParagraphIndexForCharacter, findParagraphEndIndexForCharacter };';
        return { contents, loader: 'ts' };
      });
    } }] });
  const bytes = await readFile(entry);
  result.bundles[engine] = { bytes: bytes.length, gzipBytes: gzipSync(bytes).length, sha256: sha(bytes) };
}
const server = await createServer({ configFile: false, root: process.cwd(), logLevel: 'error',
  cacheDir: path.join(work, 'vite-cache'), optimizeDeps: { noDiscovery: true, include: ['fflate', 'utif'] },
  server: { host: '127.0.0.1', port: 0 } });
await server.listen();
const origin = `http://127.0.0.1:${server.httpServer.address().port}`;
const browser = await chromium.launch();
result.browser = browser.version();
const pages = {};
const median = samples => [...samples].sort((a, b) => a - b)[Math.floor(samples.length / 2)];
const specs = [
  { name: 'iwork-styled-6000-paragraphs', kind: 'text', count: 6000 },
  { name: 'iwork-styled-single-paragraph', kind: 'text', count: 6000, single: true },
  { name: 'iwork-unstyled-6000-paragraphs', kind: 'text', count: 6000, unstyled: true },
  { name: 'iwork-styled-small', kind: 'text', count: 12, batch: 100 },
  { name: 'pages-layout-hints', kind: 'pages', count: 6000 },
  { name: 'pages-paragraph-lookups', kind: 'lookup', count: 30000, queries: 6000 },
  ...[16, 1024, 4096].map(count => ({ name: `cad-layer-actions-${count}`, kind: 'cad', count, actions: 12 })),
  { name: 'resource-index-30000', kind: 'index', count: 30000 },
  { name: 'resource-index-encoded', kind: 'index', count: 10000, encoded: true },
  { name: 'resource-index-small', kind: 'index', count: 12, batch: 100 },
  { name: 'resource-lookups-30000', kind: 'resource-read', count: 30000 }
];
try {
  for (const engine of ['baseline', 'current']) {
    const page = pages[engine] = await browser.newPage();
    page.on('pageerror', error => result.errors.push(error.message));
    await page.route(origin + '/', route => route.fulfill({ contentType: 'text/html', body: '<!doctype html>' }));
    await page.goto(origin);
    await page.evaluate(async entry => { window.lib = await import(entry); }, '/' + path.join(work, `runtime-${engine}.mjs`));
  }
  // All integer boundaries, adjacent half offsets, out-of-range and NaN behavior.
  for (const [engine, page] of Object.entries(pages)) {
    const json = await page.evaluate(() => {
      const values = [];
      for (const text of ['', '\n', 'a\n\nb\n汉字', 'one\ntwo\n']) {
        const starts = [0];
        for (let i = 0; i < text.length; i++) if (text[i] === '\n' && i + 1 < text.length) starts.push(i + 1);
        const ranges = starts.map((start, i) => ({ start, end: starts[i + 1] ?? text.length, text: '' }));
        for (const index of [-Infinity, -1, ...Array.from({ length: text.length * 2 + 3 }, (_, i) => i / 2), Infinity, NaN]) {
          values.push([window.lib.findParagraphIndexForCharacter(ranges, index), window.lib.findParagraphEndIndexForCharacter(ranges, index)]);
        }
      }
      values.push([window.lib.findParagraphIndexForCharacter([], 1), window.lib.findParagraphEndIndexForCharacter([], 1)]);
      return JSON.stringify(values);
    });
    if (engine === 'baseline') result.boundaries = { outputSha256: sha(json), cases: JSON.parse(json).length };
    else assert.equal(sha(json), result.boundaries.outputSha256, 'paragraph boundary behavior changed');
  }
  let edgeSignature;
  for (const [engine, page] of Object.entries(pages)) {
    const json = await page.evaluate(() => {
      const results = [];
      const record = (id, value) => ({ id, archiveId: 1, messageIndex: id, typeId: id, typeName: 'TSWP.StyleArchive',
        value, objectReferences: [], dataReferences: [] });
      const archive = { type: 'pages', records: {
        1: record(1, { charProperties: { bold: true, fontSize: 12 }, paraProperties: { alignment: 2 } }),
        2: record(2, { charProperties: { italic: true, fontSize: 18 }, paraProperties: { alignment: 1 } })
      }, references: { incoming: {}, outgoing: {} }, dataEntries: {}, warnings: [] };
      let seed = 12345;
      const random = count => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed % count; };
      const offsets = [-Infinity, -2, 0, 1, 2, 2.5, 3, 5, 8, 9, 10, 15, 20, 99, Infinity, NaN];
      for (let i = 0; i < 256; i++) {
        const entries = () => Array.from({ length: random(30) }, () => ({ characterIndex: offsets[random(offsets.length)],
          ...(random(3) ? { object: { identifier: 1 + random(2) } } : {}) }));
        results.push(window.lib.buildTextFrameFromStorage(archive, {
          text: ['a\n\nBCdef\n汉字😀xyz\nlast'], tableParaStyle: { entries: entries() }, tableCharStyle: { entries: entries() }
        }, { defaultParagraphStyleRef: { identifier: 1 } }));
      }
      const names = ['', 'plain.png', 'a/plain.png', 'a//b.png', './a/../b.png', '%2E%2E/name%20one.png',
        'a%2Fb.png', 'bad%ZZ.png', '汉字😀.png', 'a%3Fb%23c.png', '/root/item.png', 'C:\\root\\item.png',
        'https://host/root/item.png?x#y', 'a/%F0%28%8C%28.png', 'a/./b/../c.png'];
      for (const root of ['', 'root', '/root/', 'a', '%2E%2E']) {
        const resources = names.map((name, i) => ({ name, path: names[(i * 3) % names.length], source: `source-${i}` }));
        resources.push(resources[1]); // Duplicate entries still make basename fallback ambiguous.
        const index = window.lib.createFileSetResourceIndex(resources, { root });
        for (const name of names.flatMap(name => [name, 'other/' + name, name + '?cache#suffix'])) {
          results.push([index.read(name)?.source, index.resolve({ source: name, name: 'plain.png' })]);
        }
      }
      return JSON.stringify(results);
    });
    edgeSignature ??= sha(json);
    assert.equal(sha(json), edgeSignature, `${engine} malformed/duplicate style or resource behavior changed`);
  }
  result.edgeValidation = { outputSha256: edgeSignature, generatedStyleCases: 256, resourceRoots: 5, resourceQueries: 225 };
  for (const spec of specs) {
    const dxf = spec.kind === 'cad' ? createLayeredDxfFixture(spec.count * 2, spec.count) : undefined;
    for (const page of Object.values(pages)) await page.evaluate(async ({ spec, dxf }) => {
      window.input?.session?.destroy();
      document.body.replaceChildren();
      const record = (id, typeName, value) => ({ id, archiveId: 1, messageIndex: id, typeId: id, typeName,
        value, objectReferences: [], dataReferences: [] });
      const archive = { type: 'pages', records: {}, references: { incoming: {}, outgoing: {} }, dataEntries: {}, warnings: [] };
      if (spec.kind === 'text' || spec.kind === 'pages') {
        archive.records = Object.fromEntries([
          record(10, 'TSWP.CharacterStyleArchive', { charProperties: { bold: true } }),
          record(11, 'TSWP.CharacterStyleArchive', { charProperties: { italic: true } }),
          record(12, 'TSWP.ParagraphStyleArchive', { charProperties: { fontSize: 14 }, paraProperties: { alignment: 2 } })
        ].map(record => [record.id, record]));
        const line = 'abcdEFGHijkl';
        const text = Array(spec.count).fill(line).join(spec.single ? '' : '\n') + '\n';
        const entries = [], para = [];
        for (let i = 0; i < spec.count; i++) {
          const start = i * (line.length + (spec.single ? 0 : 1));
          para.push({ characterIndex: start, ...(i === 0 ? { object: { identifier: 12 } } : {}) });
          for (const [j, id] of [[0, 10], [4, 11], [8, undefined]]) entries.push({ characterIndex: start + j,
            ...(id ? { object: { identifier: id } } : {}) });
        }
        const storage = { text: [text], ...(spec.unstyled || spec.kind === 'pages' ? {} : {
          tableCharStyle: { entries }, tableParaStyle: { entries: para } }) };
        if (spec.kind === 'pages') {
          const pageHints = Array.from({ length: spec.count / 12 }, (_, i) => ({ targetHints: [{ range: { location: i * 12 * 13, length: 12 * 13 } }] }));
          archive.records[1] = record(1, 'TP.DocumentArchive', { bodyStorage: { identifier: 2 }, deprecatedLayoutState: { identifier: 3 },
            pageWidth: 600, pageHeight: 2000, leftMargin: 72, rightMargin: 72, topMargin: 72, bottomMargin: 72 });
          archive.records[2] = record(2, 'TSWP.StorageArchive', storage);
          archive.records[3] = record(3, 'TP.LayoutStateArchive', { sectionHints: [{ startPageIndex: 0, pageHints }] });
        }
        window.input = { archive, storage };
      } else if (spec.kind === 'lookup') {
        const ranges = Array.from({ length: spec.count }, (_, i) => ({ start: i * 13, end: (i + 1) * 13, text: 'abcdEFGHijkl' }));
        const queries = Array.from({ length: spec.queries }, (_, i) => (i * 7883) % (spec.count * 13 + 50));
        window.input = { ranges, queries };
      } else if (spec.kind === 'cad') {
        const host = document.createElement('div');
        document.body.append(host);
        const session = new window.lib.CadPreviewSession(host);
        const source = new TextEncoder().encode(dxf);
        await session.load(source, { descriptor: { source, name: 'layers.dxf', extension: 'dxf' } });
        window.input = { session, host, all: session.getState().layers.map(layer => layer.id) };
      } else {
        const resources = Array.from({ length: spec.count }, (_, i) => ({ name: `image${spec.encoded ? '%20' : '-'}${i}.png`,
          path: `scene/textures/group-${i % 32}/image${spec.encoded ? '%20' : '-'}${i}.png`, source: `resource-${i}` }));
        const queries = resources.map((resource, i) => i % 3 === 0 ? resource.path : i % 3 === 1 ? resource.path.slice(6) : `elsewhere/${resource.name}?v=1`);
        const index = window.lib.createFileSetResourceIndex(resources, { root: 'scene' });
        window.input = { resources, queries, index };
      }
    }, { spec, dxf });
    const samples = { baseline: [], current: [] };
    let expected;
    for (let iteration = 0; iteration < result.warmups + result.iterations; iteration++) {
      for (const engine of iteration % 2 ? ['current', 'baseline'] : ['baseline', 'current']) {
        const row = await pages[engine].evaluate(spec => {
          const input = window.input;
          let ms = 0, value;
          if (spec.kind === 'cad') {
            // Restore outside timing, then exercise full updates and individual toggles.
            input.session.setActiveLayers(input.all);
            value = [];
            for (let i = 0; i < spec.actions; i++) {
              const ids = i % 2 ? input.all : [...input.all.filter((_, j) => j % 3), 'unknown', input.all[0]];
              const start = performance.now();
              if (i % 3 === 0) input.session.setActiveLayers(ids);
              else input.session.toggleLayer(input.all[(i * 17) % input.all.length], i % 2 === 0);
              ms += performance.now() - start;
              value.push(input.session.getState().activeLayerIds);
            }
            value.push(input.host.innerHTML);
          } else {
            if (spec.kind === 'pages') input.archive.warnings = [];
            const start = performance.now();
            for (let i = 0; i < (spec.batch ?? 1); i++) {
              if (spec.kind === 'text') value = window.lib.buildTextFrameFromStorage(input.archive, input.storage);
              else if (spec.kind === 'pages') value = window.lib.buildParsedDocument({ archive: input.archive, media: {} });
              else if (spec.kind === 'lookup') value = input.queries.map(index => [
                window.lib.findParagraphIndexForCharacter(input.ranges, index),
                window.lib.findParagraphEndIndexForCharacter(input.ranges, index)]);
              else if (spec.kind === 'index') value = window.lib.createFileSetResourceIndex(input.resources, { root: 'scene' });
              else value = input.queries.map(name => input.index.read(name)?.source);
            }
            ms = performance.now() - start;
            if (spec.kind === 'index') value = input.queries.map(name => value.read(name)?.source);
          }
          return { ms, json: JSON.stringify(value) };
        }, spec);
        expected ??= sha(row.json);
        assert.equal(sha(row.json), expected, `${spec.name}/${engine} output changed`);
        if (iteration >= result.warmups) samples[engine].push(row.ms);
      }
    }
    result.cases[spec.name] = { ...spec, ...(dxf ? { inputSha256: sha(dxf) } : {}), outputSha256: expected,
      timings: Object.fromEntries(Object.entries(samples).map(([engine, samplesMs]) => [engine, { samplesMs, medianMs: median(samplesMs) }])) };
    console.log(JSON.stringify(result.cases[spec.name]));
    await writeFile(output, JSON.stringify(result, null, 2) + '\n');
  }
  for (const file of [
    'apps/demo/public/samples/a.pages', 'apps/demo/public/samples/a.numbers', 'apps/demo/public/samples/filens-weekend.key',
    ...['a.pages', 'a.numbers', 'a.key'].map(name => `packages/iwork/vendor/iwork-converter/testdata/${name}`)
  ]) {
    const bytes = await readFile(file);
    let expected;
    for (const [engine, page] of Object.entries(pages)) {
      const json = await page.evaluate(async ({ bytes, name }) => {
        const model = await window.lib.loadIwork(new File([new Uint8Array(bytes)], name));
        return JSON.stringify(model);
      }, { bytes: [...bytes], name: path.basename(file) });
      expected ??= sha(json);
      assert.equal(sha(json), expected, `${file}/${engine} model changed`);
    }
    result.fixtures[file] = { bytes: bytes.length, inputSha256: sha(bytes), outputSha256: expected };
  }
  assert.deepEqual(result.errors, []);
  await writeFile(output, JSON.stringify(result, null, 2) + '\n');
  console.log('PASS: all timed outputs, paragraph boundaries, CAD SVG/state and six real iWork models match.');
} finally {
  await browser.close();
  await server.close();
}
