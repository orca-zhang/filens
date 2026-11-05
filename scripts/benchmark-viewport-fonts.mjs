// Engineering A/B comparison; parsing, rasterization and input creation are not timed.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { build } from 'esbuild';
import { createServer } from 'vite';
import { chromium } from '@playwright/test';
import { createPdfFixture } from '../packages/pdf/test/fixtures/document.mjs';

const option = (name, fallback) => {
  const index = process.argv.indexOf(name);
  if (index < 0) return fallback;
  assert(process.argv[index + 1] && !process.argv[index + 1].startsWith('--'));
  return process.argv[index + 1];
};
const baseline = option('--baseline', 'tmp/viewport-fonts-baseline/sources.json');
const output = option('--output', 'tmp/viewport-fonts-current/results.json');
const work = path.dirname(output);
await mkdir(work, { recursive: true });
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const sources = JSON.parse(await readFile(baseline, 'utf8')).files;
const result = { date: new Date().toISOString(), node: process.version, cpu: os.cpus()[0].model,
  method: 'Identical esbuild source bundles, shared current dependencies, actual Chromium DOM geometry. Two warmups and seven alternating measured runs. Timers cover visibility queries or complete font collection/diagnostics only. Inputs, imports, DOM creation, scroll/layout preparation, serialization, hashes and validation are outside timers. Separate actual mixed-page PDF pixel/lifecycle validation is untimed.',
  warmups: 2, iterations: 7, sourceSha256: {}, baselineSourceSha256: {}, entrySha256: {}, cases: {}, errors: [] };
for (const [file, source] of Object.entries(sources)) {
  result.sourceSha256[file] = sha(await readFile(file));
  result.baselineSourceSha256[file] = sha(source);
}
for (const engine of ['baseline', 'current']) {
  const entry = path.join(work, `runtime-${engine}.mjs`);
  await build({ stdin: { resolveDir: process.cwd(), contents:
    "export { PdfPreviewSession } from './packages/pdf/src/preview-driver.ts';" +
    "export { collectSlideFontReferences, analyzePreviewFonts } from './packages/core/src/preview/fonts.ts';" +
    "export { collectSlideFontLoadingReferences } from './packages/core/src/preview/font-scenes.ts';" },
  outfile: entry, bundle: true, platform: 'browser', format: 'esm', target: 'es2020',
  external: ['@filens/core', 'pdfjs-dist', 'pdfjs-dist/*'],
  plugins: engine === 'baseline' ? [{ name: 'baseline-source', setup(builder) {
    builder.onLoad({ filter: /\.ts$/ }, args => {
      const contents = sources[path.relative(process.cwd(), args.path)];
      return contents === undefined ? undefined : { contents, loader: 'ts' };
    });
  } }] : [] });
  result.entrySha256[engine] = sha(await readFile(entry));
}
const server = await createServer({ configFile: false, root: process.cwd(), logLevel: 'error',
  cacheDir: path.join(work, 'vite-cache'), optimizeDeps: { include: ['fflate', 'utif', 'pdfjs-dist'] },
  server: { host: '127.0.0.1', port: 0 } });
await server.listen();
const origin = `http://127.0.0.1:${server.httpServer.address().port}`;
const browser = await chromium.launch();
result.browser = browser.version();
const pages = {};
const median = values => [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)];
const specs = [
  ...[100, 2048, 10000].map(count => ({ name: `pdf-visibility-${count}`, kind: 'visibility', count, queries: 40 })),
  { name: 'scene-font-references', kind: 'references', count: 30000 },
  { name: 'scene-font-loading', kind: 'loading', count: 30000 },
  { name: 'font-diagnostics', kind: 'diagnostics', count: 10000 },
  { name: 'scene-font-loading-small', kind: 'loading', count: 24, batch: 100 },
  { name: 'scene-font-references-unique', kind: 'references', count: 1000, unique: true, batch: 10 },
  { name: 'font-diagnostics-unique', kind: 'diagnostics', count: 200, unique: true, batch: 5 }
];
try {
  for (const engine of ['baseline', 'current']) {
    const page = pages[engine] = await browser.newPage({ viewport: { width: 1000, height: 800 }, locale: 'en-US' });
    page.on('pageerror', error => result.errors.push(error.message));
    await page.route(origin + '/', route => route.fulfill({ contentType: 'text/html', body: '<!doctype html>' }));
    await page.goto(origin);
    await page.evaluate(async entry => {
      window.lib = await import(entry);
      const style = document.createElement('style');
      style.textContent = 'body{margin:0}.pdfv-preview{position:relative;box-sizing:border-box;display:grid;grid-template-columns:minmax(0,1fr);justify-items:center;align-content:start;gap:16px;width:100%;height:100%;min-height:360px;overflow:auto}.pdfv-page-slot{justify-self:start;margin-inline:auto}.pdfv-page{display:block;box-sizing:border-box;border:1px solid #d7dee8}';
      document.head.append(style);
    }, '/' + path.join(work, `runtime-${engine}.mjs`));
  }
  for (const spec of specs) {
    for (const page of Object.values(pages)) await page.evaluate(spec => {
      document.body.replaceChildren();
      const host = document.createElement('div');
      host.style.cssText = 'width:800px;height:600px';
      document.body.append(host);
      if (spec.kind === 'visibility') {
        const session = new window.lib.PdfPreviewSession(host, { fit: 'none' });
        const root = host.firstElementChild;
        session.pages = Array.from({ length: spec.count }, (_, index) => {
          const element = document.createElement('div');
          element.className = 'pdfv-page-slot';
          const height = [80, 800, 1600][index % 3];
          element.style.cssText = `height:${height}px;width:600px`;
          root.append(element);
          return { index, element, width: 600, height };
        });
        window.input = { session, root, scrolls: Array.from({ length: spec.queries }, (_, i) =>
          Math.round((root.scrollHeight - root.clientHeight) * ((i * 17 % spec.queries) / (spec.queries - 1)))) };
      } else {
        const names = ['Arial', 'Times New Roman', 'Courier New', 'PingFang SC', 'Book Serif', 'Symbol', 'Calibri', 'Web Custom'];
        const traits = [{ weight: 400 }, { weight: 700 }, { serif: true }, undefined];
        const family = i => spec.unique ? `Unique Font ${i}` : names[i % names.length];
        const references = Array.from({ length: spec.count }, (_, i) => ({ fontFamily: family(i),
          styleName: `Style ${i % 3}`, traits: traits[i % traits.length] }));
        const runs = Array.from({ length: spec.count }, (_, i) => ({ fontFamily: family(i),
          text: `Text ${i} 汉字😀 `.repeat(16), bold: [undefined, false, true][Math.floor(i / 8) % 3], italic: Boolean(Math.floor(i / 24) % 2) }));
        window.input = { references, slides: [{ items: [{ kind: 'text', textFrame: { paragraphs: [{ runs }] } }] }] };
      }
    }, spec);
    const samples = { baseline: [], current: [] };
    let signature, details;
    for (let iteration = 0; iteration < result.warmups + result.iterations; iteration++) {
      for (const engine of iteration % 2 ? ['current', 'baseline'] : ['baseline', 'current']) {
        const row = await pages[engine].evaluate(spec => {
          const input = window.input, values = [];
          let ms = 0, geometryReads = 0;
          if (spec.kind === 'visibility') {
            const original = Element.prototype.getBoundingClientRect;
            Element.prototype.getBoundingClientRect = function () { geometryReads++; return original.call(this); };
            try {
              for (let i = 0; i < input.scrolls.length; i++) {
                input.root.scrollTop = input.scrolls[i];
                input.root.getBoundingClientRect(); // Flush scroll/layout before timing.
                input.session.state.loading = i % 2 === 0;
                input.session.state.pageIndex = 0;
                const start = performance.now();
                const visible = input.session.visiblePages();
                ms += performance.now() - start;
                values.push([visible, input.session.state.pageIndex]);
              }
            } finally { Element.prototype.getBoundingClientRect = original; }
          } else {
            const start = performance.now();
            let output;
            for (let i = 0; i < (spec.batch ?? 1); i++) output = spec.kind === 'references' ? window.lib.collectSlideFontReferences(input.slides)
              : spec.kind === 'loading' ? window.lib.collectSlideFontLoadingReferences(input.slides)
                : window.lib.analyzePreviewFonts(input.references, document);
            ms = performance.now() - start;
            values.push(output);
          }
          return { ms, geometryReads, json: JSON.stringify(values) };
        }, spec);
        const hash = sha(row.json);
        signature ??= hash;
        assert.equal(hash, signature, `${spec.name}/${engine} output changed`);
        if (iteration >= result.warmups) samples[engine].push(row.ms);
        details ??= {};
        details[engine] = { geometryReads: row.geometryReads, outputBytes: Buffer.byteLength(row.json) };
      }
    }
    result.cases[spec.name] = { ...spec, outputSha256: signature, details,
      timings: Object.fromEntries(Object.entries(samples).map(([engine, samplesMs]) => [engine, { samplesMs, medianMs: median(samplesMs) }])) };
    console.log(JSON.stringify(result.cases[spec.name]));
    await writeFile(output, JSON.stringify(result, null, 2) + '\n');
  }
  const pdf = createPdfFixture(100, true);
  result.pdfValidation = { inputSha256: sha(pdf), pageCount: 100, engines: {} };
  let expected;
  for (const [engine, page] of Object.entries(pages)) {
    const validation = await page.evaluate(async bytes => {
      window.input?.session?.destroy();
      document.body.replaceChildren();
      const host = document.createElement('div');
      host.style.cssText = 'width:800px;height:600px';
      document.body.append(host);
      const session = new window.lib.PdfPreviewSession(host);
      const source = new Uint8Array(bytes);
      const hashes = [];
      const frame = () => new Promise(resolve => requestAnimationFrame(resolve));
      try {
        await session.load(source, { descriptor: { source } });
        for (const [index, scale, fit] of [[0, 1, 'contain'], [50, 1, 'contain'], [51, 0.5, 'width'], [99, 0.8, 'height'], [2, 1, 'contain']]) {
          session.fit(fit);
          session.setScale(scale);
          session.goToPage(index);
          let canvas;
          const deadline = performance.now() + 20000;
          do {
            if (performance.now() > deadline) throw new Error('PDF render timed out');
            await frame();
            canvas = host.querySelector(`canvas[data-page-index="${index}"][data-rendered="true"]`);
          } while (!canvas || session.rendering || session.animationFrame !== null);
          const data = canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height).data;
          const hash = [...new Uint8Array(await crypto.subtle.digest('SHA-256', data))].map(byte => byte.toString(16).padStart(2, '0')).join('');
          hashes.push({ index, scale, fit, width: canvas.width, height: canvas.height, hash,
            pageIndex: session.getState().pageIndex, canvases: host.querySelectorAll('canvas').length });
        }
        const canvases = [...host.querySelectorAll('canvas')];
        session.destroy();
        return { hashes, removed: !host.childElementCount, buffersReleased: canvases.every(canvas => !canvas.width && !canvas.height) };
      } finally { session.destroy(); }
    }, [...pdf]);
    expected ??= validation;
    assert.deepEqual(validation, expected, 'Mixed-page PDF pixels/navigation/lifecycle changed');
    assert(validation.removed && validation.buffersReleased);
    result.pdfValidation.engines[engine] = validation;
  }
  assert.deepEqual(result.errors, []);
  await writeFile(output, JSON.stringify(result, null, 2) + '\n');
  console.log('PASS: output equality and five actual mixed-page PDF pixel/navigation/lifecycle comparisons.');
} finally {
  await browser.close();
  await server.close();
}
