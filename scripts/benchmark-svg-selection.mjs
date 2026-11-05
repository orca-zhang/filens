// Build the packages first. Optionally compare with saved pre-change dist folders:
// node scripts/benchmark-svg-selection.mjs --baseline tmp/svg-selection-baseline
// The baseline contains mindmap-dist/index.js and diagram-dist/index.js.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { chromium } from '@playwright/test';
import { build } from 'vite';
import { createWideMmFixture } from '../packages/mindmap/test/fixtures/maps.mjs';
import { createDrawioFixture } from '../packages/diagram/test/fixtures/diagrams.mjs';

const baselineIndex = process.argv.indexOf('--baseline');
const baseline = baselineIndex < 0 ? undefined : process.argv[baselineIndex + 1];
if (baselineIndex >= 0 && (!baseline || baseline.startsWith('--'))) throw new Error('--baseline requires a directory.');
const entries = Object.fromEntries(['mindmap', 'diagram'].flatMap(family => [
  [`current-${family}`, path.resolve(`packages/${family}/dist/index.js`)],
  ...(baseline ? [[`baseline-${family}`, path.resolve(baseline, `${family}-dist/index.js`)]] : [])
]));
const directory = await mkdtemp(path.join(os.tmpdir(), 'filens-svg-selection-'));
let browser;
try {
  await build({ configFile: false, logLevel: 'silent', build: {
    outDir: directory, lib: { entry: entries, formats: ['es'], fileName: (_format, name) => `${name}.js` }
  } });
  browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 960, height: 640 } });
  const errors = []; page.on('pageerror', error => errors.push(error.message));
  const styles = (await Promise.all(['mindmap', 'diagram'].map(family => readFile(`packages/${family}/src/styles/index.css`, 'utf8')))).join('\n');
  await page.route('http://localhost/**', async route => {
    const pathname = new URL(route.request().url()).pathname;
    if (pathname === '/') return route.fulfill({ contentType: 'text/html', body: `<!doctype html><style>${styles}</style><div id="host" style="width:940px;height:620px"></div>` });
    const file = path.resolve(directory, '.' + pathname);
    assert(file.startsWith(directory + path.sep));
    await route.fulfill({ contentType: pathname.endsWith('.js') ? 'text/javascript' : 'text/css', body: await readFile(file) });
  });
  await page.goto('http://localhost/');
  await page.evaluate(async names => {
    window.engines = Object.fromEntries(await Promise.all(names.map(async name => [name, await import(`/${name}.js`)])));
  }, Object.keys(entries));
  const result = { node: process.version, cpu: os.cpus()[0].model, browser: browser.version(), nodeCount: 2000, selections: 500,
    warmupIterations: 2, measuredIterations: 7, families: {}, bindings: {} };
  for (const [name, file] of Object.entries({ ...entries, core: path.resolve('packages/core/dist/index.js') })) {
    result.bindings[name] = createHash('sha256').update(await readFile(file)).digest('hex');
  }
  for (const family of ['mindmap', 'diagram']) {
    const samples = { current: [], ...(baseline ? { baseline: [] } : {}) };
    for (let iteration = 0; iteration < 9; iteration++) {
      const engines = Object.keys(samples);
      if (iteration % 2) engines.reverse();
      for (const engine of engines) {
        const row = await page.evaluate(async ({ name, family, xml, selections }) => {
          const lib = window.engines[name], host = document.getElementById('host');
          const session = (family === 'mindmap' ? lib.createMindmapPreviewDriver() : lib.createDiagramPreviewDriver()).createSession(host, { fit: 'none' });
          const source = new TextEncoder().encode(xml), selector = family === 'mindmap' ? '.mindmapv-node' : '.diagramv-node';
          const attribute = family === 'mindmap' ? 'data-node-id' : 'data-element-id';
          const original = EventTarget.prototype.addEventListener;
          let listeners = 0;
          EventTarget.prototype.addEventListener = function (type, ...args) {
            if (this instanceof SVGElement && (type === 'click' || type === 'keydown')) listeners++;
            return original.call(this, type, ...args);
          };
          try {
            const start = performance.now();
            await session.load(source, { descriptor: { source, extension: family === 'mindmap' ? 'mm' : 'drawio' } });
            const loadMs = performance.now() - start;
            EventTarget.prototype.addEventListener = original;
            const svg = host.querySelector('svg'), nodes = [...svg.querySelectorAll(selector)];
            const hash = async () => [...new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(svg.outerHTML)))].map(value => value.toString(16).padStart(2, '0')).join('');
            const initialHash = await hash();
            const targets = Array.from({ length: selections }, (_, index) => nodes[(index * 37) % nodes.length].firstElementChild);
            let changed = 0; session.on('statechange', () => changed++);
            const selectStart = performance.now();
            for (const target of targets) target.dispatchEvent(new MouseEvent('click', { bubbles: true }));
            const selectionMs = performance.now() - selectStart;
            const selected = [...svg.querySelectorAll('.is-selected')].map(element => element.getAttribute(attribute));
            return { loadMs, selectionMs, listeners, nodeCount: nodes.length, changed, selected,
              expected: targets.at(-1).parentElement.getAttribute(attribute), initialHash, selectedHash: await hash() };
          } finally { EventTarget.prototype.addEventListener = original; session.destroy(); }
        }, { name: `${engine}-${family}`, family, xml: family === 'mindmap' ? createWideMmFixture(result.nodeCount, true) : createDrawioFixture(result.nodeCount), selections: result.selections });
        assert.equal(row.nodeCount, result.nodeCount);
        assert.equal(row.changed, result.selections);
        assert.deepEqual(row.selected, [row.expected]);
        assert.equal(row.listeners, engine === 'baseline' ? result.nodeCount * 2 : 2);
        if (iteration >= result.warmupIterations) samples[engine].push(row);
      }
    }
    const median = values => values.sort((a, b) => a - b)[Math.floor(values.length / 2)];
    const summaries = Object.fromEntries(Object.entries(samples).map(([engine, rows]) => [engine, {
      loadMs: median(rows.map(row => row.loadMs)), selectionMs: median(rows.map(row => row.selectionMs)), listeners: rows[0].listeners,
      initialHash: rows[0].initialHash, selectedHash: rows[0].selectedHash,
      samples: rows.map(({ loadMs, selectionMs }) => ({ loadMs, selectionMs }))
    }]));
    for (const rows of Object.values(samples)) for (const row of rows) {
      assert.equal(row.initialHash, summaries.current.initialHash);
      assert.equal(row.selectedHash, summaries.current.selectedHash);
    }
    result.families[family] = summaries;
  }
  assert.deepEqual(errors, []);
  console.log(JSON.stringify(result, null, 2));
} finally {
  if (browser) await browser.close();
  await rm(directory, { recursive: true, force: true });
}
