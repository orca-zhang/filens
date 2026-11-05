// Browser comparisons of complete parsers and resource preparation stages.
// Save four dist directories and sources.json under --baseline before editing.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { gzipSync, brotliCompressSync } from 'node:zlib';
import { build } from 'esbuild';
import { createServer } from 'vite';
import { chromium } from '@playwright/test';
import JSZip from 'jszip';
import { strToU8, zipSync } from 'fflate';
import { createStyledBookFixture } from '../packages/ebook/test/fixtures/books.mjs';

const option = (name, fallback) => {
  const i = process.argv.indexOf(name);
  if (i < 0) return fallback;
  assert(process.argv[i + 1] && !process.argv[i + 1].startsWith('--'), `${name} requires a value`);
  return process.argv[i + 1];
};
const baseline = option('--baseline', 'tmp/document-resources-baseline');
const output = option('--output', 'tmp/document-resources-current/results.json');
const work = path.dirname(output);
await mkdir(work, { recursive: true });
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const sources = JSON.parse(await readFile(path.join(baseline, 'sources.json'), 'utf8')).files;
const result = { date: '2026-11-04', node: process.version, cpu: os.cpus()[0].model,
  warmupIterations: 2, measuredIterations: 7, artifacts: {}, sourceSha256: {}, cases: {} };
for (const file of Object.keys(sources)) result.sourceSha256[file] = hash(await readFile(file));
const modules = {};
for (const engine of ['baseline', 'current']) {
  const entry = path.join(work, `resources-${engine}.mjs`);
  await build({ stdin: { resolveDir: process.cwd(), contents:
    "export { rewriteCssResources } from './packages/ebook/src/css-resources.ts';" +
    "export { createFrameResourceUrl } from './packages/ebook/src/frame-resource-url.ts';" +
    "export { normalizeResolvedPreviewSource } from './packages/model3d/src/resource-utils.ts';" },
  outfile: entry, bundle: true, platform: 'browser', format: 'esm', target: 'es2020',
  plugins: engine === 'baseline' ? [{ name: 'baseline-source', setup(builder) {
    builder.onLoad({ filter: /\.ts$/ }, args => {
      const source = sources[path.relative(process.cwd(), args.path)];
      return source === undefined ? undefined : { contents: source, loader: 'ts' };
    });
  } }] : [] });
  modules[engine] = { resources: '/' + entry };
  result.artifacts[engine] = {};
  for (const name of ['ebook', 'mindmap', 'diagram', 'model3d']) {
    const directory = engine === 'baseline' ? path.join(baseline, `${name}-dist`) : `packages/${name}/dist`;
    modules[engine][name] = '/' + path.join(directory, 'index.js');
    const files = [];
    for (const file of (await readdir(directory, { recursive: true })).filter(file => /\.m?js$/.test(file)).sort()) {
      const bytes = await readFile(path.join(directory, file));
      files.push({ file, sha256: hash(bytes), rawBytes: bytes.length, gzip9Bytes: gzipSync(bytes, { level: 9 }).length,
        brotliBytes: brotliCompressSync(bytes).length });
    }
    result.artifacts[engine][name] = files;
  }
  result.artifacts[engine].resourceEntry = { sha256: hash(await readFile(entry)) };
}
const specs = [];
for (const depth of [0, 160]) {
  const count = 2000;
  const xml = '<Root><Topic Id="root" Text="Root">' + '<Wrapper>'.repeat(depth) +
    Array.from({ length: count }, (_, i) => `<Topic Id="${i}" Text="Task ${i}"/>`).join('') + '</Wrapper>'.repeat(depth) + '</Topic></Root>';
  const bytes = zipSync({ 'Document.xml': strToU8(xml) }, { mtime: new Date('2020-01-01T00:00:00Z') });
  specs.push({ name: `mindmanager-${depth ? 'wrapped' : 'flat'}`, kind: 'mindmap', input: [...bytes],
    metadata: { topics: count + 1, wrapperDepth: depth, archiveBytes: bytes.length, inputSha256: hash(bytes) } });
}
for (const depth of [0, 100]) {
  const count = 2000;
  const xml = '<Page><Shapes>' + '<Shape Type="Group"><Shapes>'.repeat(depth) +
    Array.from({ length: count }, (_, i) => `<Shape Type="Shape" ID="${i}"><Cell N="Width" V="2"/><Cell N="Height" V="1"/><Text>Shape ${i}</Text></Shape>`).join('') +
    '</Shapes></Shape>'.repeat(depth) + '</Shapes></Page>';
  specs.push({ name: `visio-${depth ? 'grouped' : 'flat'}`, kind: 'diagram', input: xml,
    metadata: { shapes: count, groupDepth: depth, inputBytes: Buffer.byteLength(xml), inputSha256: hash(xml) } });
}
const plainCss = '.chapter{color:#123456;padding:2px 4px;margin:0;line-height:1.6;font-family:serif}\n'.repeat(10000);
for (const [name, input] of [['plain', plainCss], ['references', '.a{background:URL(image.svg);content:"url(fake.svg)"}/*url(no.svg)*/\n'.repeat(2000)]])
  specs.push({ name: `css-${name}`, kind: 'css', input, metadata: { inputBytes: Buffer.byteLength(input), inputSha256: hash(input) } });
const book = await JSZip.loadAsync(await createStyledBookFixture());
const css = book.file('OPS/styles/main.css');
assert(css);
book.file(css.name, await css.async('string') + plainCss);
const epub = await book.generateAsync({ type: 'uint8array', compression: 'DEFLATE' });
specs.push({ name: 'epub-stylesheet-book', kind: 'ebook', input: [...epub], metadata: { archiveBytes: epub.length, addedCssBytes: Buffer.byteLength(plainCss), inputSha256: hash(epub) } });
for (const target of ['texture', 'frame']) for (const compatibility of [false, true])
  specs.push({ name: `${target}-base64-${compatibility ? 'compatibility' : 'native'}`, kind: 'binary', input: { target, compatibility },
    metadata: { resources: 4, bytesPerResource: 1024 * 1024, slicedInput: true } });
specs.push({ name: 'frame-blob', kind: 'binary', input: { target: 'blob', compatibility: false },
  metadata: { resources: 4, bytesPerResource: 1024 * 1024, slicedInput: true } });

const server = await createServer({ configFile: false, root: process.cwd(), logLevel: 'error',
  cacheDir: 'tmp/document-resources-vite-cache', optimizeDeps: { include: ['fflate', 'utif'] },
  server: { host: '127.0.0.1', port: 0 } });
await server.listen();
const origin = `http://127.0.0.1:${server.httpServer.address().port}`;
const browser = await chromium.launch();
result.browser = browser.version();
const pages = {}, errors = [];
const median = values => [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)];
try {
  for (const engine of ['baseline', 'current']) {
    const page = pages[engine] = await browser.newPage({ locale: 'en-US', timezoneId: 'UTC' });
    page.on('pageerror', error => errors.push(error.message));
    await page.route(origin + '/', route => route.fulfill({ contentType: 'text/html', body: '<!doctype html><div id="host"></div>' }));
    await page.goto(origin);
    const { model3d: unused, ...imports } = modules[engine];
    await page.evaluate(async imports => {
      window.libs = Object.fromEntries(await Promise.all(Object.entries(imports).map(async ([key, file]) => [key, await import(file)])));
      window.binaryViews = Array.from({ length: 4 }, (_, i) => {
        const storage = Uint8Array.from({ length: 1024 * 1024 + 8 }, (_, j) => (j + i) % 256);
        return storage.subarray(3, storage.length - 5);
      });
    }, imports);
  }
  for (const spec of specs) {
    for (const page of Object.values(pages)) await page.evaluate(input => { window.benchmarkInput = Array.isArray(input) ? new Uint8Array(input) : input; }, spec.input);
    const samples = { baseline: [], current: [] };
    let signature;
    for (let iteration = 0; iteration < result.warmupIterations + result.measuredIterations; iteration++) {
      for (const engine of iteration % 2 ? ['current', 'baseline'] : ['baseline', 'current']) {
        const row = await pages[engine].evaluate(async kind => {
          const input = window.benchmarkInput, libs = window.libs, blobs = [];
          const createUrl = blob => { blobs.push(blob); return `blob:asset-${blobs.length}`; };
          const originDescriptor = Object.getOwnPropertyDescriptor(window, 'origin');
          const nativeDescriptor = Object.getOwnPropertyDescriptor(Uint8Array.prototype, 'toBase64');
          if (kind === 'binary') {
            Object.defineProperty(window, 'origin', { configurable: true, value: input.target === 'frame' ? 'null' : location.origin });
            if (input.compatibility) Object.defineProperty(Uint8Array.prototype, 'toBase64', { configurable: true, value: undefined });
            else if (input.target !== 'blob' && typeof Uint8Array.prototype.toBase64 !== 'function') throw new Error('Native Base64 is unavailable in this browser');
          }
          let value, elapsedMs;
          const requests = [];
          const start = performance.now();
          try {
            if (kind === 'mindmap') value = await libs.mindmap.loadMindmanagerDocument(input.buffer);
            else if (kind === 'diagram') value = libs.diagram.loadVdxDiagram(input);
            else if (kind === 'css') value = await libs.resources.rewriteCssResources(input, async (url, stylesheet) => {
              requests.push([url, stylesheet]); return `blob:reference-${requests.length}`;
            });
            else if (kind === 'ebook') value = await libs.ebook.loadEpubBook(input, undefined, createUrl);
            else value = window.binaryViews.map(view => input.target === 'texture'
              ? libs.resources.normalizeResolvedPreviewSource(new DataView(view.buffer, view.byteOffset, view.byteLength), 'image/png')
              : libs.resources.createFrameResourceUrl(view, 'image/png', createUrl));
            elapsedMs = performance.now() - start;
          } finally {
            if (kind === 'binary') {
              if (originDescriptor) Object.defineProperty(window, 'origin', originDescriptor);
              if (nativeDescriptor) Object.defineProperty(Uint8Array.prototype, 'toBase64', nativeDescriptor);
              else Reflect.deleteProperty(Uint8Array.prototype, 'toBase64');
            }
          }
          const digest = async bytes => [...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))].map(v => v.toString(16).padStart(2, '0')).join('');
          const blobResults = [];
          for (const blob of blobs) blobResults.push({ type: blob.type, bytes: blob.size, sha256: await digest(await blob.arrayBuffer()) });
          if (kind === 'binary') for (let i = 0; i < value.length; i++) {
            let decodedHash;
            if (input.target === 'blob') decodedHash = blobResults[i].sha256;
            else {
              if (!value[i].startsWith('data:image/png;base64,')) throw new Error('Wrong data URL MIME');
              const bytes = Uint8Array.from(atob(value[i].slice(value[i].indexOf(',') + 1)), ch => ch.charCodeAt(0));
              decodedHash = await digest(bytes);
            }
            if (decodedHash !== await digest(window.binaryViews[i])) throw new Error('Complete resource bytes differ');
          }
          return { elapsedMs, outputSha256: await digest(new TextEncoder().encode(JSON.stringify({ value, requests, blobs: blobResults }))) };
        }, spec.kind);
        signature ??= row.outputSha256;
        assert.equal(row.outputSha256, signature, `${spec.name}/${engine}: complete output changed`);
        if (iteration >= result.warmupIterations) samples[engine].push(row.elapsedMs);
      }
    }
    result.cases[spec.name] = { ...spec.metadata, outputSha256: signature,
      timings: Object.fromEntries(Object.entries(samples).map(([name, values]) => [name, { samplesMs: values, medianMs: median(values) }])) };
    await writeFile(output, JSON.stringify(result, null, 2) + '\n');
    console.log(JSON.stringify({ name: spec.name, baseline: median(samples.baseline), current: median(samples.current) }));
  }
  assert.deepEqual(errors, []);
  result.errors = errors;
  await writeFile(output, JSON.stringify(result, null, 2) + '\n');
} finally {
  await browser.close();
  await server.close();
}
