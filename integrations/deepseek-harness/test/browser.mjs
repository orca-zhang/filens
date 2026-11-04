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
fixturePaths['hello.txt'] = null;
fixturePaths['encrypted.rar'] = path.join(repository, 'packages/archive/test/fixtures/rar5-encrypted.rar');
fixturePaths['protected.pdf'] = path.join(repository, 'packages/converter-client/test/fixtures/password/encrypted.pdf');
const harness = await build({
  stdin: { resolveDir: root, contents: `
    import React from 'react';
    import { createRoot } from 'react-dom/client';
    let plugin, component;
    const disposers = [];
    window.__ModuleLoader__ = { load: item => { plugin = item.factory(name => { if(name === 'react') return React; throw Error(name); }); } };
    await new Promise((resolve, reject) => { const s=document.createElement('script'); s.src='/client.js'; s.onload=resolve; s.onerror=reject; document.head.append(s); });
    const ctx = {
      effect: fn => { disposers.push(fn()); },
      documentPreviews: { register: spec => { window.registration=spec; return () => { window.registration=undefined; }; } },
      slots: { inject: (name, fn) => fn(), register: (spec, body) => { component=body; return () => { component=undefined; }; } }
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
      reactRoot.render(React.createElement(component, {content:{kind:'bytes',data:bytes},resourceAddress:'/session/'+name}));
    };
    window.closeFile = () => { reactRoot.render(null); };
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
      res.end(fixturePaths[name] ? await readFile(fixturePaths[name]) : 'Hello from FiLens inside DSH.'); return;
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
const errors = [], failures = [], results = [], interactions = [];
page.on('pageerror', error => errors.push(String(error)));
page.on('console', msg => { if (msg.type() === 'error') errors.push(msg.text()); });
page.on('requestfailed', request => failures.push({ url: request.url(), reason: request.failure()?.errorText }));
try {
  await page.goto(origin);
  await page.waitForFunction(() => window.ready);
  const registration = await page.evaluate(() => window.registration);
  const support = JSON.parse(await readFile(path.join(root, 'lib/support.json'), 'utf8'));
  assert.ok(support.extensions.length > 0);
  assert.deepEqual([...registration.extensions].sort(), [...support.extensions].sort(), 'Sidebar registration must match the shared support manifest');
  assert.equal(registration.loading, 'bytes-complete');
  assert.ok(await page.evaluate(() => window.pluginExports.viewerUrl('https://example.test/ui/', 'https://example.test', 'channel').startsWith('https://example.test/ui/_filens/')));
  let releaseViewer;
  let viewerContinued;
  const heldViewer = new Promise(resolve => { releaseViewer = resolve; });
  const continuedViewer = new Promise(resolve => { viewerContinued = resolve; });
  const hold = async route => { await heldViewer; await route.continue(); viewerContinued(); };
  await page.route('**/viewer.js', hold);
  await page.emulateMedia({ reducedMotion: 'reduce' });
  try {
    await page.evaluate(() => window.openFile('hello.txt'));
    await page.getByRole('status').waitFor();
    assert.match(await page.getByRole('status').innerText(), /Opening preview[\s\S]*hello\.txt/);
    assert.equal(await page.locator('.filens-dsh-progress span').evaluate(node => getComputedStyle(node).animationName), 'none');
    await page.screenshot({ path: path.join(artifacts, 'loading.png') });
  } finally { releaseViewer(); await continuedViewer; await page.unroute('**/viewer.js', hold); }
  await page.waitForFunction(() => document.querySelector('.filens-dsh')?.dataset.phase === 'ready');
  interactions.push('loading identifies the file and respects reduced motion');
  for (const name of ['hello.txt', ...samples, 'encrypted.rar']) {
    const started = Date.now();
    await page.evaluate(name => window.openFile(name), name);
    await page.locator('iframe').waitFor();
    await page.waitForFunction(() => document.querySelector('.filens-dsh')?.dataset.phase === 'ready' || document.querySelector('.filens-dsh')?.dataset.phase === 'error', null, { timeout: 65000 });
    const status = await page.locator('[role=alert]').allTextContents();
    assert.deepEqual(status, [], `${name}: ${status.join(' ')}`);
    assert.ok(await page.evaluate(() => window.sourceBytes.byteLength > 0), 'Parent source buffer was detached');
    const frame = page.frames().find(frame => frame.url().includes('/viewer.html'));
    const text = await frame.locator('body').innerText();
    assert.ok(text.length > 0 || await frame.locator('canvas,img,svg').count() > 0, `Empty preview: ${name}`);
    results.push({ name, rendered: true, ms: Date.now() - started });
    console.log(`Preview passed: ${name}`);
    if (['filens-field-notes.pptx', 'rounded-cube.step', 'sample-nested-archives.zip'].includes(name)) await page.screenshot({ path: path.join(artifacts, name.replaceAll('/', '_') + '.png') });
  }
  // Untrusted window messages must not change the currently mounted document.
  const before = await page.locator('iframe').getAttribute('src');
  await page.evaluate(() => postMessage({ type: 'filens:error', channel: new URL(document.querySelector('iframe').src).hash.slice(1), message: 'spoofed' }, location.origin));
  assert.deepEqual(await page.locator('[role=status]').allTextContents(), []);
  assert.equal(await page.locator('iframe').getAttribute('src'), before);

  const previewFrame = () => page.frames().find(frame => frame.url().includes('/viewer.html'));
  const ready = async () => {
    await page.waitForFunction(() => ['ready', 'error'].includes(document.querySelector('.filens-dsh')?.dataset.phase), null, { timeout: 65000 });
    assert.equal(await page.locator('.filens-dsh').getAttribute('data-phase'), 'ready', await page.locator('[role=alert]').allTextContents());
  };
  await page.setViewportSize({ width: 420, height: 540 });
  await page.evaluate(() => window.openFile('filens-field-notes.pptx'));
  await ready();
  const shell = previewFrame().locator('.pptxv-shell');
  const dimensions = await shell.boundingBox();
  assert.equal(Math.round(dimensions.height), 540, 'Preview must use the full pane height');
  assert.equal(await previewFrame().evaluate(() => document.documentElement.scrollWidth), 420, 'Viewer must not overflow the pane');
  const position = previewFrame().locator('#preview');
  const firstPage = await position.getAttribute('data-page');
  const toolbar = previewFrame().locator('.pptxv-toolbar');
  assert.equal(await toolbar.getByRole('button').count(), 3, 'Only zoom out/in and fullscreen remain');
  assert.equal(await toolbar.getByRole('button', { name: /Prev|Next|Fit|Width|Height|Rotate/ }).count(), 0);
  const zoom = toolbar.locator('.pptxv-zoom-status');
  const beforeZoom = await zoom.innerText();
  await toolbar.locator('[data-action="zoom-in"]').click();
  await zoom.filter({ hasText: beforeZoom }).waitFor({ state: 'hidden' });
  await toolbar.locator('[data-action="zoom-out"]').click();
  await shell.focus();
  await shell.press('ArrowRight');
  await previewFrame().waitForFunction(first => document.querySelector('#preview').dataset.page !== first, firstPage);
  await shell.press('ArrowLeft');
  await previewFrame().waitForFunction(first => document.querySelector('#preview').dataset.page === first, firstPage);
  interactions.push('toolbar contains only working zoom and fullscreen; keyboard navigation works');
  await shell.press('f');
  await previewFrame().waitForFunction(() => Boolean(document.fullscreenElement), null, { timeout: 5000 });
  await previewFrame().evaluate(() => document.exitFullscreen());
  interactions.push('document fullscreen opens from the keyboard and exits normally');

  const oldRequest = await previewFrame().locator('#preview').getAttribute('data-request-id');
  await page.evaluate(() => {
    document.documentElement.lang = 'zh-CN';
    document.body.setAttribute('data-ds-dark-theme', '');
    document.body.style.setProperty('--dsw-alias-bg-base', '#202126');
  });
  await previewFrame().waitForFunction(() => document.documentElement.lang === 'zh-CN' && document.documentElement.dataset.theme === 'dark');
  await previewFrame().getByRole('button', { name: '放大', exact: true }).waitFor();
  assert.equal(await previewFrame().locator('#preview').getAttribute('data-request-id'), oldRequest, 'Appearance changes must not reopen the source');
  assert.equal(await position.getAttribute('data-page'), firstPage, 'Appearance changes must preserve the current page');
  assert.equal(await shell.evaluate(node => getComputedStyle(node).backgroundColor), 'rgb(32, 33, 38)');
  assert.equal(await previewFrame().getByRole('button', { name: '放大', exact: true }).isEnabled(), true, 'Theme changes must leave zoom interactive');
  await page.screenshot({ path: path.join(artifacts, 'narrow-dark.png') });
  interactions.push('live DSH language and theme changes preserve the document and current page');

  await page.evaluate(() => window.openFile('rounded-cube.step'));
  await ready();
  assert.equal(await previewFrame().locator('#preview').getAttribute('data-family'), 'model3d');
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
  const failedRequest = await previewFrame().locator('#preview').getAttribute('data-request-id');
  await page.getByRole('button', { name: '重新尝试', exact: true }).click();
  await page.getByRole('alert').waitFor();
  assert.notEqual(await previewFrame().locator('#preview').getAttribute('data-request-id'), failedRequest, 'Retry must start a fresh viewer request');
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
  await page.evaluate(() => window.closeFile());
  await page.waitForFunction(() => !document.querySelector('iframe'));
  await page.evaluate(() => window.unloadPlugin());
  assert.equal(await page.evaluate(() => window.registration), undefined);
  // Chromium reports intentional aborted archive worker fetches during teardown;
  // actual script errors, CSP violations and failed WASM fetches fail the check.
  assert.deepEqual(errors, [], JSON.stringify(errors));
} finally {
  await page.screenshot({ path: path.join(artifacts, 'last-state.png') }).catch(() => {});
  await writeFile(path.join(artifacts, 'report.json'), JSON.stringify({ results, interactions, errors, failures }, null, 2) + '\n');
  await context.close();
  await browser.close();
  await new Promise(resolve => server.close(resolve));
}
console.log(`Browser checks passed: ${results.length} formats, file switching, source ownership, message validation and unload.`);
