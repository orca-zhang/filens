import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { Readable } from 'node:stream';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { build } from 'esbuild';
import { chromium } from 'playwright';
import { runtimeResource } from '../lib/preview-host.js';

const root = fileURLToPath(new URL('../', import.meta.url));
const repository = path.resolve(root, '../..');
const artifacts = path.join(root, 'artifacts/browser');
await mkdir(artifacts, { recursive: true });
const samples = [
  'filens-cosmic-atlas.pdf', 'filens-aurora-guide.docx', 'filens-observatory.xlsx',
  'filens-field-notes.pptx', 'a.pages', 'a.numbers', 'filens-weekend.key',
  'rounded-cube.step', 'raw/pentax-k-r.dng', 'sample-nested-archives.zip',
];
const fixturePaths = Object.fromEntries(samples.map(name => [name, path.join(repository, 'apps/demo/public/samples', name)]));
for (const name of ['filens-cafe.dxf', 'pepper-carrot.epub', 'photo-alpine-lake.jpg', 'sample-video.mp4']) {
  fixturePaths[name] = path.join(repository, 'apps/demo/public/samples', name);
}
const fixtureText = {
  'hello.txt': 'Hello from FiLens inside DSH.',
  'hello.mm': '<map version="1.0.1"><node TEXT="Lazy mindmap"><node TEXT="Child"/></node></map>',
  'hello.drawio': '<mxfile><diagram name="Page"><mxGraphModel><root><mxCell id="0"/><mxCell id="1" parent="0"/><mxCell id="2" value="Lazy diagram" vertex="1" parent="1"><mxGeometry x="20" y="20" width="100" height="40" as="geometry"/></mxCell></root></mxGraphModel></diagram></mxfile>',
};
for (const name of Object.keys(fixtureText)) fixturePaths[name] = null;
fixturePaths['hello.txt'] = null;
fixturePaths['encrypted.rar'] = path.join(repository, 'packages/archive/test/fixtures/rar5-encrypted.rar');
fixturePaths['protected.pdf'] = path.join(repository, 'packages/converter-client/test/fixtures/password/encrypted.pdf');
const harness = await build({
  stdin: { resolveDir: root, contents: `
    import React from 'react';
    import { createRoot } from 'react-dom/client';
    import { flushSync } from 'react-dom';
    let plugin, component, action;
    const disposers = [];
    window.__ModuleLoader__ = { load: item => { plugin = item.factory(name => { if(name === 'react') return React; throw Error(name); }); } };
    await new Promise((resolve, reject) => { const s=document.createElement('script'); s.src='/client.js'; s.onload=resolve; s.onerror=reject; document.head.append(s); });
    const ctx = {
      effect: fn => { disposers.push(fn()); },
      documentPreviews: { register: spec => { window.registration=spec; return () => { window.registration=undefined; }; } },
      slots: { inject: (name, fn) => fn(), register: (spec, body) => { if(spec.name.endsWith('.action')) action=body; else component=body; return () => {}; } }
    };
    plugin.apply(ctx);
    window.pluginExports=plugin;
    let reactRoot = createRoot(document.querySelector('#root'));
    window.openFile = async name => {
      const bytes = new Uint8Array(await (await fetch('/fixture?name='+encodeURIComponent(name))).arrayBuffer());
      window.openBytes(name, bytes);
    };
    window.openBytes = (name, bytes) => {
      window.sourceBytes=bytes;
      const props={content:{kind:'bytes',data:bytes},resourceAddress:'/session/'+name,useTabInfo:()=>({tab:{id:'test-tab'}})};
      flushSync(() => reactRoot.render(React.createElement(React.Fragment,null,React.createElement('div',{className:'harness-actions',style:{position:'absolute',right:0,top:0,zIndex:2}},React.createElement(action,props)),React.createElement(component,props))));
    };
    window.closeFile = () => { flushSync(() => reactRoot.render(null)); };
    window.openOtherFile = async name => {
      const bytes = new Uint8Array(await (await fetch('/fixture?name='+encodeURIComponent(name))).arrayBuffer());
      const element=document.createElement('div'); element.id='other-root'; element.style.cssText='position:absolute;left:500px;top:0;width:400px;height:300px;display:flex'; document.body.append(element);
      const other=createRoot(element);
      const props={content:{kind:'bytes',data:bytes},resourceAddress:'/other/'+name,useTabInfo:()=>({tab:{id:'other-tab'}})};
      flushSync(()=>other.render(React.createElement(React.Fragment,null,React.createElement(action,props),React.createElement(component,props))));
      window.closeOtherFile=()=>{flushSync(()=>other.unmount());element.remove();};
    };
    window.unloadPlugin = () => { reactRoot.unmount(); for(const dispose of disposers.reverse()) dispose(); };
    window.ready=true;
  ` },
  bundle: true, format: 'esm', platform: 'browser', write: false,
});
const server = createServer(async (req, res) => {
  try {
    const url = new URL(req.url, 'http://localhost');
    if (url.pathname === '/') { res.setHeader('content-type', 'text/html'); res.end('<!doctype html><title>FiLens DSH renderer integration</title><body style="margin:0;font:14px system-ui,sans-serif"><div id="root" style="height:100vh"></div><script type="module" src="/harness.js"></script>'); return; }
    if (url.pathname === '/harness.js') { res.setHeader('content-type', 'text/javascript'); res.end(harness.outputFiles[0].contents); return; }
    if (url.pathname === '/client.js') { res.setHeader('content-type', 'text/javascript'); res.end(await readFile(path.join(root, 'lib/client.js'))); return; }
    if (url.pathname === '/fixture') {
      const name = url.searchParams.get('name');
      if (!Object.hasOwn(fixturePaths, name)) { res.writeHead(404).end(); return; }
      res.end(fixturePaths[name] ? await readFile(fixturePaths[name]) : fixtureText[name]); return;
    }
    const response = runtimeResource(new Request(`http://${req.headers.host}${req.url}`, { method: req.method }));
    res.writeHead(response.status, Object.fromEntries(response.headers));
    if (response.body) Readable.fromWeb(response.body).pipe(res); else res.end();
  } catch (error) { res.writeHead(500).end(String(error)); }
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const origin = `http://127.0.0.1:${server.address().port}`;
const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({ viewport: { width: 1280, height: 900 }, recordVideo: { dir: path.join(artifacts, 'video'), size: { width: 1280, height: 900 } } });
const page = await context.newPage();
const instrumentWorkers = () => {
  window.pdfWorkerActivity = { active: 0, firstPageRequests: 0, iworkDocuments: 0, iworkSheets: 0 };
  const Base = window.Worker;
  window.Worker = class extends Base {
    constructor(...args) { super(...args); window.pdfWorkerActivity.active++; }
    postMessage(message, ...args) {
      if (message?.action === 'GetOperatorList' && message.data?.pageIndex === 0) window.pdfWorkerActivity.firstPageRequests++;
      if (message?.kind === 'document') window.pdfWorkerActivity.iworkDocuments++;
      if (message?.kind === 'sheet') window.pdfWorkerActivity.iworkSheets++;
      return super.postMessage(message, ...args);
    }
    terminate() {
      if (!this.closed) { this.closed = true; window.pdfWorkerActivity.active--; }
      return super.terminate();
    }
  };
};
await page.addInitScript(instrumentWorkers);
const errors = [], failures = [], results = [], interactions = [], lazyLoading = [];
page.on('pageerror', error => errors.push(String(error)));
page.on('console', msg => { if (msg.type() === 'error') errors.push(msg.text()); });
page.on('requestfailed', request => failures.push({ url: request.url(), reason: request.failure()?.errorText }));
try {
  // Each format starts in a fresh context, so prior imports cannot hide eager
  // dependencies. The same assertions cover the actual DSH client mount path.
  for (const [name, expected] of [
    ['hello.txt', 'native-drivers'], ['photo-alpine-lake.jpg', 'native-drivers'],
    ['filens-cosmic-atlas.pdf', 'pdf-driver'], ['filens-aurora-guide.docx', 'docx-driver'],
    ['filens-observatory.xlsx', 'xlsx-driver'], ['filens-field-notes.pptx', 'pptx-driver'],
    ['filens-weekend.key', 'iwork-driver'], ['rounded-cube.step', 'model3d-driver'],
    ['sample-nested-archives.zip', 'archive-driver'], ['filens-cafe.dxf', 'cad-driver'],
    ['pepper-carrot.epub', 'ebook-driver'], ['hello.mm', 'mindmap-driver'],
    ['hello.drawio', 'diagram-driver'], ['sample-video.mp4', 'codec-preview-driver'],
    ['raw/pentax-k-r.dng', 'panorama-driver'],
  ]) {
    const isolated = await browser.newPage({ viewport: { width: 1000, height: 800 } });
    await isolated.addInitScript(instrumentWorkers);
    const requested = [], scriptErrors = [];
    isolated.on('request', request => { if (request.url().includes('/_filens/')) requested.push(request.url()); });
    isolated.on('pageerror', error => scriptErrors.push(error.message));
    try {
      await isolated.goto(origin);
      await isolated.waitForFunction(() => window.ready);
      await isolated.evaluate(name => window.openFile(name), name);
      await isolated.waitForFunction(() => ['ready', 'error'].includes(document.querySelector('.filens-dsh')?.dataset.phase), null, { timeout: 65000 });
      assert.equal(await isolated.locator('.filens-dsh').getAttribute('data-phase'), 'ready', `${name}: ${await isolated.locator('[role=alert]').allTextContents()}`);
      const files = [...new Set(requested.map(url => new URL(url).pathname.split('/_filens/')[1].split('/').slice(1).join('/')))].sort();
      const drivers = files.filter(file => /\/(?:\w+-driver|native-drivers|codec-preview-driver)-/.test(file));
      assert.ok(files.some(file => file.startsWith(`chunks/${expected}-`)), `${name} did not load ${expected}: ${files}`);
      assert.ok(drivers.every(file => file.startsWith(`chunks/${expected}-`) || file.startsWith('chunks/native-drivers-')), `${name} loaded unrelated drivers: ${drivers}`);
      if (!['model3d-driver', 'panorama-driver'].includes(expected)) assert.ok(!files.some(file => /\/three-/.test(file)), `${name} loaded Three.js`);
      if (expected !== 'model3d-driver') assert.ok(!files.some(file => /\/model-(?:gltf|fbx|vrml|3ds|obj|mtl|usdz|ldraw)-/.test(file)), `${name} loaded a 3D model loader`);
      if (expected !== 'pdf-driver') assert.ok(!files.some(file => /\/pdf-|pdf\.worker/.test(file)), `${name} loaded PDF.js`);
      assert.deepEqual(scriptErrors, []);
      const runtimeFiles = files.filter(file => /\.(?:js|mjs|wasm|css)$/.test(file));
      const rawBytes = (await Promise.all(runtimeFiles.map(file => readFile(path.join(root, 'lib/runtime', file))))).reduce((sum, bytes) => sum + bytes.length, 0);
      const before = requested.length;
      const parsedBefore = await isolated.evaluate(() => window.pdfWorkerActivity.iworkDocuments);
      await isolated.evaluate(() => window.closeFile());
      await isolated.waitForFunction(() => window.pdfWorkerActivity.active === 0);
      await isolated.evaluate(name => window.openFile(name), name);
      await isolated.waitForFunction(() => document.querySelector('.filens-dsh')?.dataset.phase === 'ready', null, { timeout: 65000 });
      assert.ok(!requested.slice(before).some(url => /\/chunks\/.*\.js$/.test(url)), `${name} fetched format modules again on reopen`);
      if (expected === 'iwork-driver') {
        assert.equal(parsedBefore, 1);
        assert.equal(await isolated.evaluate(() => window.pdfWorkerActivity.iworkDocuments), 1, 'Cached Keynote skips worker parsing');
      }
      lazyLoading.push({ name, expected, files, rawBytes, moduleCacheReused: true });
      console.log(`Lazy loading passed: ${name} (${rawBytes} bytes)`);
    } finally { await isolated.close(); }
  }
  await page.goto(origin);
  await page.waitForFunction(() => window.ready);
  const registration = await page.evaluate(() => window.registration);
  const support = JSON.parse(await readFile(path.join(root, 'lib/support.json'), 'utf8'));
  assert.ok(support.extensions.length > 0);
  assert.deepEqual([...registration.extensions].sort(), [...support.extensions].sort(), 'Sidebar registration must match the shared support manifest');
  assert.equal(registration.loading, 'bytes-complete');
  assert.ok(await page.evaluate(() => window.pluginExports.runtimeUrl('https://example.test/ui/').startsWith('https://example.test/ui/_filens/')));
  let releaseViewer;
  let viewerContinued;
  const heldViewer = new Promise(resolve => { releaseViewer = resolve; });
  const continuedViewer = new Promise(resolve => { viewerContinued = resolve; });
  const hold = async route => { await heldViewer; await route.continue(); viewerContinued(); };
  await page.route('**/filens.js', hold);
  await page.emulateMedia({ reducedMotion: 'reduce' });
  try {
    await page.evaluate(() => window.openFile('hello.txt'));
    await page.getByRole('status').waitFor();
    assert.match(await page.getByRole('status').innerText(), /Opening preview[\s\S]*hello\.txt/);
    assert.equal(await page.locator('.filens-dsh-progress span').evaluate(node => getComputedStyle(node).animationName), 'none');
    await page.screenshot({ path: path.join(artifacts, 'loading.png') });
  } finally { releaseViewer(); await continuedViewer; await page.unroute('**/filens.js', hold); }
  await page.waitForFunction(() => document.querySelector('.filens-dsh')?.dataset.phase === 'ready');
  interactions.push('loading identifies the file and respects reduced motion');
  const reopened = [];
  for (let round = 0; round < 2; round++) {
    await page.evaluate(() => window.closeFile());
    await page.locator('.filens-dsh').waitFor({ state: 'detached' });
    await page.waitForFunction(() => window.pdfWorkerActivity.active === 0);
    await page.evaluate(() => window.openFile('filens-cosmic-atlas.pdf'));
    await page.waitForFunction(() => document.querySelector('.filens-dsh')?.dataset.phase === 'ready');
    const frame = page;
    reopened.push(await frame.evaluate(async () => {
      const canvas = document.querySelector('canvas[data-page-index="0"][data-rendered="true"]');
      const pixels = canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height).data;
      const digest = await crypto.subtle.digest('SHA-256', pixels);
      const runtime = performance.getEntriesByType('resource').filter(entry => new URL(entry.name).pathname.endsWith('/filens.js'));
      return {
        pixels: [...new Uint8Array(digest)],
        runtimeLoads: runtime.length,
        firstPageRequests: window.pdfWorkerActivity.firstPageRequests,
      };
    }));
  }
  assert.equal(reopened[0].runtimeLoads, 1);
  assert.equal(reopened[1].runtimeLoads, 1, 'Reopening must reuse the same imported runtime');
  assert.equal(await page.locator('.filens-dsh > iframe').count(), 0, 'The sidebar viewer must mount directly without an iframe');
  assert.deepEqual(reopened[0].pixels, reopened[1].pixels, 'Cached runtime must preserve PDF rendering');
  assert.equal(reopened[0].firstPageRequests, 1);
  assert.equal(reopened[1].firstPageRequests, 1, 'Reopening reuses painted first-page pixels without decoding its operators again');
  interactions.push('closing and reopening PDF releases each worker, reuses exact first-page pixels and skips repeated page decoding');
  const numbersSheets = [];
  for (let round = 0; round < 2; round++) {
    await page.evaluate(() => window.closeFile());
    await page.waitForFunction(() => window.pdfWorkerActivity.active === 0);
    await page.evaluate(() => window.openFile('a.numbers'));
    await page.waitForFunction(() => document.querySelector('.filens-dsh')?.dataset.phase === 'ready');
    assert.equal(await page.locator('.xlsxv-sheet-tab').count(), 6);
    await page.locator('.xlsxv-sheet-tab').nth(1).click();
    await page.waitForFunction(() => !document.querySelector('.iworkv-root')?.classList.contains('is-loading') && document.querySelectorAll('.xlsxv-grid tbody tr').length > 0);
    numbersSheets.push(await page.locator('.xlsxv-grid').innerText());
    assert.equal(await page.evaluate(() => window.pdfWorkerActivity.iworkDocuments), 1, 'Reopening Numbers skips document parsing');
    assert.equal(await page.evaluate(() => window.pdfWorkerActivity.iworkSheets), round + 1, 'Sheets remain lazy after cache reuse');
  }
  assert.ok(numbersSheets[0].length > 0);
  assert.equal(numbersSheets[0], numbersSheets[1], 'Restored Numbers archive renders the same second sheet');
  await page.evaluate(() => window.closeFile());
  await page.waitForFunction(() => window.pdfWorkerActivity.active === 0);
  interactions.push('cached Numbers restores its archive for lazy sheets, preserves sheet content and releases workers');
  for (const name of ['hello.txt', ...samples, 'encrypted.rar']) {
    const started = Date.now();
    await page.evaluate(name => window.openFile(name), name);
    await page.locator('.filens-dsh-view').waitFor();
    await page.waitForFunction(() => document.querySelector('.filens-dsh')?.dataset.phase === 'ready' || document.querySelector('.filens-dsh')?.dataset.phase === 'error', null, { timeout: 65000 });
    const status = await page.locator('.filens-dsh-state[role=alert]').allTextContents();
    assert.deepEqual(status, [], `${name}: ${status.join(' ')}`);
    assert.ok(await page.evaluate(() => window.sourceBytes.byteLength > 0), 'Parent source buffer was detached');
    const frame = page;
    const text = await frame.locator('body').innerText();
    assert.ok(text.length > 0 || await frame.locator('canvas,img,svg').count() > 0, `Empty preview: ${name}`);
    results.push({ name, rendered: true, ms: Date.now() - started });
    console.log(`Preview passed: ${name}`);
    if (['filens-field-notes.pptx', 'rounded-cube.step', 'sample-nested-archives.zip'].includes(name)) await page.screenshot({ path: path.join(artifacts, name.replaceAll('/', '_') + '.png') });
  }
  // The former iframe message protocol cannot mutate a directly mounted viewer.
  const before = await page.locator('.filens-dsh-view').getAttribute('data-request-id');
  await page.evaluate(() => postMessage({ type: 'filens:error', message: 'spoofed' }, location.origin));
  assert.deepEqual(await page.locator('.filens-dsh-state[role=status]').allTextContents(), []);
  assert.equal(await page.locator('.filens-dsh-view').getAttribute('data-request-id'), before);

  const previewFrame = () => page;
  const ready = async () => {
    await page.waitForFunction(() => ['ready', 'error'].includes(document.querySelector('.filens-dsh')?.dataset.phase), null, { timeout: 65000 });
    assert.equal(await page.locator('.filens-dsh').getAttribute('data-phase'), 'ready', await page.locator('.filens-dsh-state[role=alert]').allTextContents());
  };
  await page.setViewportSize({ width: 420, height: 540 });
  await page.evaluate(() => window.openFile('filens-field-notes.pptx'));
  await ready();
  const shell = previewFrame().locator('.pptxv-shell');
  const dimensions = await shell.boundingBox();
  assert.equal(Math.round(dimensions.height), 540, 'Preview must use the full pane height');
  assert.equal(await previewFrame().evaluate(() => document.documentElement.scrollWidth), 420, 'Viewer must not overflow the pane');
  const position = previewFrame().locator('.filens-dsh-view');
  const toolbar = page.locator('.filens-dsh-actions');
  assert.equal(await page.locator('.pptxv-toolbar').count(), 0, 'The inner viewer must not duplicate the DSH header controls');
  assert.equal(await toolbar.getByRole('button').count(), 3, 'Only zoom out/in and fullscreen remain');
  assert.equal(await toolbar.getByRole('button', { name: /Prev|Next|Fit|Width|Height|Rotate/ }).count(), 0);
  const zoom = toolbar.locator('.filens-dsh-zoom');
  const beforeZoom = await zoom.innerText();
  await toolbar.locator('[data-action="zoom-in"]').click();
  await zoom.filter({ hasText: beforeZoom }).waitFor({ state: 'hidden' });
  await toolbar.locator('[data-action="zoom-out"]').click();
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  const firstPage = await position.getAttribute('data-page');
  await shell.focus();
  await shell.press('ArrowRight');
  await previewFrame().waitForFunction(first => document.querySelector('.filens-dsh-view').dataset.page !== first, firstPage);
  await shell.press('ArrowLeft');
  await previewFrame().waitForFunction(first => document.querySelector('.filens-dsh-view').dataset.page === first, firstPage);
  interactions.push('toolbar contains only working zoom and fullscreen; keyboard navigation works');
  await shell.press('f');
  await previewFrame().waitForFunction(() => Boolean(document.fullscreenElement), null, { timeout: 5000 });
  await previewFrame().evaluate(() => document.exitFullscreen());
  interactions.push('document fullscreen opens from the keyboard and exits normally');

  const oldRequest = await previewFrame().locator('.filens-dsh-view').getAttribute('data-request-id');
  await page.evaluate(() => {
    document.documentElement.lang = 'zh-CN';
    document.body.setAttribute('data-ds-dark-theme', '');
    document.body.style.setProperty('--dsw-alias-bg-base', '#202126');
  });
  await previewFrame().waitForFunction(() => document.querySelector('.filens-dsh-view').lang === 'zh-CN' && document.querySelector('.filens-dsh-view').dataset.theme === 'dark');
  await previewFrame().getByRole('button', { name: '放大', exact: true }).waitFor();
  assert.equal(await previewFrame().locator('.filens-dsh-view').getAttribute('data-request-id'), oldRequest, 'Appearance changes must not reopen the source');
  assert.equal(await position.getAttribute('data-page'), firstPage, 'Appearance changes must preserve the current page');
  assert.equal(await shell.evaluate(node => getComputedStyle(node).backgroundColor), 'rgb(32, 33, 38)');
  assert.equal(await previewFrame().getByRole('button', { name: '放大', exact: true }).isEnabled(), true, 'Theme changes must leave zoom interactive');
  await page.screenshot({ path: path.join(artifacts, 'narrow-dark.png') });
  interactions.push('live DSH language and theme changes preserve the document and current page');

  await page.evaluate(() => window.openFile('rounded-cube.step'));
  await ready();
  assert.equal(await previewFrame().locator('.filens-dsh-view').getAttribute('data-family'), 'model3d');
  assert.equal(await previewFrame().locator('.pptxv-toolbar').isVisible(), false, '3D previews must not show a toolbar');
  const canvas = previewFrame().locator('canvas').first();
  // Read a rendered screenshot, rather than the WebGL buffer (which may be
  // cleared after presentation). The STEP fixture should leave clear margins.
  const assertModelFramed = async () => {
    const pixels = await previewFrame().evaluate(async data => {
      const bitmap = await createImageBitmap(await (await fetch(data)).blob());
      const surface = document.createElement('canvas');
      surface.width = bitmap.width; surface.height = bitmap.height;
      const ctx = surface.getContext('2d');
      ctx.drawImage(bitmap, 0, 0); bitmap.close();
      const at = (x, y) => [...ctx.getImageData(x, y, 1, 1).data];
      const w = surface.width, h = surface.height;
      return { background: at(2, 2), center: at(w / 2, h / 2), edges: [at(2, h / 2), at(w - 3, h / 2), at(w / 2, 2), at(w / 2, h - 3)] };
    }, `data:image/png;base64,${(await canvas.screenshot()).toString('base64')}`);
    for (const edge of pixels.edges) assert.deepEqual(edge, pixels.background, 'Model must leave visible margins');
    assert.notDeepEqual(pixels.center, pixels.background, 'Model must remain visible in the center');
  };
  const modelBounds = await canvas.boundingBox();
  assert.equal(Math.round(modelBounds.height), 540, '3D canvas must fill the pane');
  await assertModelFramed();
  const beforeOrbit = await canvas.screenshot();
  const modelDifference = async screenshot => previewFrame().evaluate(async images => {
    const decoded = await Promise.all(images.map(async data => {
      const bitmap = await createImageBitmap(await (await fetch(data)).blob());
      const surface = document.createElement('canvas');
      surface.width = bitmap.width; surface.height = bitmap.height;
      const ctx = surface.getContext('2d');
      ctx.drawImage(bitmap, 0, 0); bitmap.close();
      return { width: surface.width, height: surface.height, pixels: ctx.getImageData(0, 0, surface.width, surface.height).data };
    }));
    const [a, b] = decoded;
    if (a.width !== b.width || a.height !== b.height) throw Error('Model canvas dimensions changed');
    let total = 0, changed = 0;
    for (let i = 0; i < a.pixels.length; i += 4) {
      const differences = [0, 1, 2].map(c => Math.abs(a.pixels[i + c] - b.pixels[i + c]));
      total += differences.reduce((sum, v) => sum + v, 0);
      if (Math.max(...differences) > 8) changed++;
    }
    return { mean: total / (a.width * a.height * 3), changed: changed / (a.width * a.height) };
  }, [beforeOrbit, screenshot].map(bytes => `data:image/png;base64,${bytes.toString('base64')}`));
  const x = modelBounds.x + modelBounds.width / 2, y = modelBounds.y + modelBounds.height / 2;
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x + 60, y + 20, { steps: 8 });
  await page.mouse.up();
  await page.mouse.wheel(0, -100);
  assert.ok((await modelDifference(await canvas.screenshot())).changed > 0.01, 'Direct drag/zoom must visibly change the rendered model');
  await page.screenshot({ path: path.join(artifacts, 'model-narrow-dark.png') });
  interactions.push('3D canvas fills the pane without a toolbar and supports direct orbit/zoom');
  await canvas.dblclick();
  const resetModel = await canvas.screenshot();
  await writeFile(path.join(artifacts, 'model-before-orbit.png'), beforeOrbit);
  await writeFile(path.join(artifacts, 'model-after-reset.png'), resetModel);
  const difference = await modelDifference(resetModel);
  // Compare decoded pixels: WebGL antialiasing may vary by a few edge pixels.
  assert.ok(difference.mean < 0.1 && difference.changed < 0.005, `Double-click must restore the original orbit and zoom: ${JSON.stringify(difference)}`);
  interactions.push('double-click restores the complete 3D model after orbit and zoom');

  const modelTools = previewFrame().getByRole('region', { name: '模型工具', exact: true });
  const toolsOpener = previewFrame().getByRole('button', { name: '显示模型工具', exact: true });
  assert.equal(await modelTools.isVisible(), false, 'Model tools start collapsed');
  await toolsOpener.click();
  assert.deepEqual(await canvas.boundingBox(), modelBounds, 'Opening model tools must not shrink the canvas');
  const inspectorBounds = await modelTools.boundingBox();
  assert.ok(inspectorBounds.x >= 0 && inspectorBounds.x + inspectorBounds.width <= 420, 'Inspector must fit the narrow pane');
  await modelTools.getByRole('button', { name: '放大', exact: true }).click();
  assert.equal(await modelTools.locator('.pptxv-zoom-status').innerText(), '110%');
  await modelTools.getByRole('button', { name: '重置视图', exact: true }).click();
  assert.equal(await modelTools.locator('.pptxv-zoom-status').innerText(), '100%');
  await modelTools.getByRole('button', { name: '全屏', exact: true }).click();
  await previewFrame().waitForFunction(() => Boolean(document.fullscreenElement));
  await previewFrame().evaluate(() => document.exitFullscreen());
  await modelTools.getByRole('tab', { name: '视图', exact: true }).focus();
  await page.keyboard.press('ArrowRight');
  assert.equal(await modelTools.getByRole('tab', { name: '结构', exact: true }).getAttribute('aria-selected'), 'true');
  await modelTools.getByRole('searchbox').fill('no-such-part');
  assert.equal(await modelTools.getByText('没有匹配当前筛选条件的节点。', { exact: true }).isVisible(), true);
  await modelTools.getByRole('button', { name: '清除', exact: true }).click();
  await modelTools.getByRole('tab', { name: '工具', exact: true }).click();
  await modelTools.locator('summary').filter({ hasText: /^剖切$/ }).click();
  await modelTools.getByRole('button', { name: '剖切', exact: true }).click();
  assert.equal(await modelTools.getByRole('button', { name: '剖切', exact: true }).getAttribute('aria-pressed'), 'true');
  await modelTools.getByRole('button', { name: '重置剖切', exact: true }).click();
  await modelTools.getByRole('tab', { name: '视图', exact: true }).click();
  await page.screenshot({ path: path.join(artifacts, 'model-tools-narrow-dark.png') });
  await page.keyboard.press('Escape');
  assert.equal(await modelTools.isVisible(), false);
  assert.equal(await toolsOpener.evaluate(node => node === document.activeElement), true, 'Closing returns focus to the opener');
  interactions.push('compact model inspector preserves the canvas; zoom, fullscreen, keyboard tabs, search and section controls work in a narrow dark pane');

  await page.setViewportSize({ width: 240, height: 600 });
  await previewFrame().waitForFunction(() => document.querySelector('canvas')?.clientWidth === 240);
  await assertModelFramed();
  await toolsOpener.click();
  const smallInspector = await modelTools.boundingBox();
  assert.ok(smallInspector.x >= 0 && smallInspector.x + smallInspector.width <= 240, 'Inspector must also fit a 240px pane');
  await modelTools.getByRole('button', { name: '隐藏模型工具', exact: true }).click();
  await page.screenshot({ path: path.join(artifacts, 'model-framed-narrow.png') });
  await page.setViewportSize({ width: 420, height: 540 });
  interactions.push('3D auto framing keeps the whole model visible in a tall narrow pane');

  await page.evaluate(() => window.openFile('filens-aurora-guide.docx'));
  await ready();
  await previewFrame().waitForFunction(() => document.querySelector('.docxv-document .docx')?.getBoundingClientRect().width <= innerWidth - 30);
  assert.equal(await previewFrame().locator('.pptxv-toolbar').isVisible(), false, 'Flow documents must not show controls they do not support');
  await page.screenshot({ path: path.join(artifacts, 'word-narrow-dark.png') });
  const readingPosition = await previewFrame().evaluate(() => {
    const view = document.querySelector('.docxv-preview');
    const zoom = Number(view.querySelector('.docx-wrapper').style.zoom);
    view.scrollTop = 250 * zoom;
    return view.scrollTop / zoom;
  });
  await page.setViewportSize({ width: 320, height: 540 });
  await previewFrame().waitForFunction(() => document.querySelector('.docxv-document .docx')?.getBoundingClientRect().width <= innerWidth - 30);
  const narrowZoom = await previewFrame().locator('.docx-wrapper').evaluate(node => Number(node.style.zoom));
  await page.setViewportSize({ width: 420, height: 540 });
  await previewFrame().waitForFunction(previous => Number(document.querySelector('.docx-wrapper').style.zoom) > previous, narrowZoom);
  const restoredPosition = await previewFrame().evaluate(() => {
    const view = document.querySelector('.docxv-preview');
    return view.scrollTop / Number(view.querySelector('.docx-wrapper').style.zoom);
  });
  assert.ok(readingPosition > 0 && Math.abs(restoredPosition - readingPosition) < 5, `Reading position moved: ${readingPosition} → ${restoredPosition}`);
  interactions.push('Word pages fit narrow/resized panes and omit unavailable controls');
  interactions.push('resizing the Word pane preserves the reading position');

  // A completion from the prior file must not clear the current file's state.
  await page.evaluate(() => window.openFile('hello.txt'));
  await ready();
  await previewFrame().evaluate(oldRequest => {
    parent.postMessage({ type: 'filens:error', channel: location.hash.slice(1), requestId: oldRequest, message: 'stale document' }, location.origin);
  }, oldRequest);
  assert.equal(await page.locator('.filens-dsh').getAttribute('data-phase'), 'ready');
  interactions.push('late events from a previous document are ignored');

  // Exercise an actual parser failure and recover using the visible retry control.
  await page.evaluate(() => window.openBytes('broken.docx', new Uint8Array([1, 2, 3, 4])));
  await page.getByRole('alert').waitFor();
  await page.getByRole('button', { name: '重新尝试', exact: true }).waitFor();
  assert.equal(await page.getByRole('alert').locator('details').count(), 1);
  await page.screenshot({ path: path.join(artifacts, 'error-dark.png') });
  const failedRequest = await previewFrame().locator('.filens-dsh-view').getAttribute('data-request-id');
  await page.getByRole('button', { name: '重新尝试', exact: true }).click();
  await page.waitForFunction(previous => document.querySelector('.filens-dsh-view').dataset.requestId !== previous, failedRequest);
  await page.getByRole('alert').waitFor();
  assert.notEqual(await previewFrame().locator('.filens-dsh-view').getAttribute('data-request-id'), failedRequest, 'Retry must start a fresh viewer request');
  interactions.push('localized parser failure exposes details and a working retry action');
  await page.evaluate(() => window.openFile('protected.pdf'));
  await page.waitForFunction(() => document.querySelector('.filens-dsh')?.dataset.phase === 'interactive', null, { timeout: 65000 });
  const password = previewFrame().locator('input[type=password]');
  await password.waitFor();
  assert.equal(await page.locator('.filens-dsh-state').count(), 0, 'Loading cover must not block the password form');
  await password.fill('test123');
  await password.press('Enter');
  await password.waitFor({ state: 'hidden', timeout: 5000 });
  await ready();
  interactions.push('encrypted documents expose the password form and render after password entry');
  await page.evaluate(() => window.openFile('hello.txt'));
  await ready();
  await page.setViewportSize({ width: 420, height: 240 });
  assert.equal(Math.round((await previewFrame().locator('.pptxv-shell').boundingBox()).height), 240, 'Short panes must not force a minimum document height');
  interactions.push('short panes do not inherit a fixed minimum height');
  await page.setViewportSize({ width: 1000, height: 540 });
  await page.evaluate(() => window.openFile('filens-cosmic-atlas.pdf'));
  await ready();
  await page.evaluate(() => window.openOtherFile('filens-cosmic-atlas.pdf'));
  await page.waitForFunction(() => [...document.querySelectorAll('.filens-dsh')].length === 2 && [...document.querySelectorAll('.filens-dsh')].every(node => node.dataset.phase === 'ready'));
  const otherZoom = await page.locator('#other-root .filens-dsh-zoom').innerText();
  await page.locator('#root .filens-dsh-actions [data-action="zoom-in"]').click();
  assert.equal(await page.locator('#other-root .filens-dsh-zoom').innerText(), otherZoom, 'Toolbar controls must affect only their own tab');
  assert.equal(await page.locator('link[data-filens-runtime]').count(), 1, 'Concurrent previews share one stylesheet');
  await page.evaluate(() => window.closeFile());
  assert.equal(await page.locator('link[data-filens-runtime]').count(), 1, 'Closing one tab must keep another tab styled');
  assert.equal(await page.locator('#other-root canvas[data-rendered="true"]').count() > 0, true);
  await page.evaluate(() => window.closeOtherFile());
  interactions.push('concurrent tabs share runtime assets but keep controls and lifecycle independent');
  await page.waitForFunction(() => !document.querySelector('.filens-dsh'));
  assert.equal(await page.locator('link[data-filens-runtime]').count(), 0, 'Closing the final viewer releases its stylesheet');
  await page.evaluate(() => window.unloadPlugin());
  assert.equal(await page.evaluate(() => window.registration), undefined);
  // Chromium reports intentional aborted archive worker fetches during teardown;
  // actual script errors, CSP violations and failed WASM fetches fail the check.
  assert.deepEqual(errors, [], JSON.stringify(errors));
} finally {
  await page.screenshot({ path: path.join(artifacts, 'last-state.png') }).catch(() => {});
  await writeFile(path.join(artifacts, 'report.json'), JSON.stringify({ results, interactions, lazyLoading, errors, failures }, null, 2) + '\n');
  await context.close();
  await browser.close();
  await new Promise(resolve => server.close(resolve));
}
console.log(`Browser checks passed: ${results.length} formats, file switching, source ownership, message validation and unload.`);
