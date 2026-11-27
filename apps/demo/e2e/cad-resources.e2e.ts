import { resolve } from 'node:path';
import { readFile } from 'node:fs/promises';
import { expect, test, type Page } from '@playwright/test';
import { createPngFixture, createRasterDxfFixture, lineDxfFixture } from '../../../packages/cad/test/fixtures/resources.mjs';
import { createShxDxf, testShxFont } from '../../../packages/cad/test/fixtures/shx.mjs';

async function prepare(page: Page) {
  await page.goto('./');
  const url = new URL(`@fs${resolve('packages/cad/src/index.ts')}`, page.url()).href;
  await page.evaluate(async url => {
    const lib = await import(/* @vite-ignore */ url), host = document.createElement('div');
    host.style.cssText = 'position:fixed;inset:0'; document.body.replaceChildren(host);
    const urls = new Set<string>(), create = URL.createObjectURL.bind(URL), revoke = URL.revokeObjectURL.bind(URL);
    URL.createObjectURL = blob => { const url = create(blob); urls.add(url); return url; };
    URL.revokeObjectURL = url => { urls.delete(url); revoke(url); };
    (window as any).cadTest = { lib, host, urls };
  }, url);
}

test('keeps default CAD lines one screen pixel wide on zoom and resize', async ({ page }) => {
  await prepare(page);
  await page.evaluate(async dxf => {
    const state = (window as any).cadTest;
    state.session = state.lib.createCadPreviewDriver().createSession(state.host);
    const source = new TextEncoder().encode(dxf);
    await state.session.load(source, { descriptor: { source, extension: 'dxf' } });
  }, lineDxfFixture);
  const line = page.locator('.cadv-canvas line');
  const screenWidth = () => line.evaluate(node => {
    const scale = (node as SVGLineElement).getScreenCTM()!.a;
    return parseFloat(getComputedStyle(node).strokeWidth) * scale;
  });
  await expect.poll(screenWidth).toBeCloseTo(1);
  await page.evaluate(() => (window as any).cadTest.session.setScale(4));
  await expect.poll(screenWidth).toBeCloseTo(1);
  await page.setViewportSize({ width: 480, height: 360 });
  await expect.poll(screenWidth).toBeCloseTo(1);
});

for (const kind of ['bytes', 'slice', 'buffer', 'blob', 'wrapped']) {
  test(`decodes actual DXF ${kind} raster resources and releases them`, async ({ page }) => {
    const errors: string[] = []; page.on('pageerror', error => errors.push(error.message)); await prepare(page);
    const result = await page.evaluate(async ({ kind, png, dxf }) => {
      const { lib, host, urls } = (window as any).cadTest, source = new TextEncoder().encode(dxf), bytes = new Uint8Array(png);
      const padded = new Uint8Array(bytes.length + 20); padded.set(bytes, 10);
      const resource = kind === 'blob' ? new Blob([bytes], { type: 'image/png' }) : kind === 'buffer' ? bytes.buffer
        : kind === 'slice' ? padded.subarray(10, -10) : kind === 'wrapped' ? { source: bytes, warnings: ['Test raster'] } : bytes;
      const session = lib.createCadPreviewDriver().createSession(host, { resourceResolver: () => resource });
      await session.load(source, { descriptor: { source, extension: 'dxf', name: 'rasters.dxf' } });
      let matching = 0;
      for (const node of host.querySelectorAll('image')) {
        const url = node.getAttribute('href'), image = new Image(); image.src = url; await image.decode();
        const actual = new Uint8Array(await (await fetch(url)).arrayBuffer());
        if (image.naturalWidth === 32 && actual.length === bytes.length && actual.every((byte, index) => byte === bytes[index])) matching++;
      }
      session.toggleLayer('RASTER', false);
      const hidden = [...host.querySelectorAll('image')].every((node: Element) => getComputedStyle(node.parentElement!).display === 'none');
      session.toggleLayer('RASTER', true);
      const visible = [...host.querySelectorAll('image')].every((node: Element) => getComputedStyle(node.parentElement!).display !== 'none');
      const text = host.querySelector('text[data-layer="LABELS"]').textContent, count = urls.size, warnings = session.getState().warnings;
      session.destroy(); return { matching, hidden, visible, text, count, warnings, remaining: urls.size, empty: !host.childElementCount };
    }, { kind, png: [...await createPngFixture(32)], dxf: createRasterDxfFixture(2) });
    expect(result).toEqual({ matching: 2, hidden: true, visible: true, text: '配套图片 / Raster', count: 2,
      warnings: kind === 'wrapped' ? ['Test raster'] : [], remaining: 0, empty: true });
    expect(errors).toEqual([]);
  });
}

test('keeps the active DXF when a replaced source response arrives late', async ({ page }) => {
  let release!: () => void, requested!: () => void;
  const response = new Promise<void>(resolve => { release = resolve; }), request = new Promise<void>(resolve => { requested = resolve; });
  await page.route('**/delayed-drawing.dxf', async route => { requested(); await response; await route.fulfill({ body: createRasterDxfFixture() }).catch(() => {}); });
  await prepare(page);
  await page.evaluate(() => {
    const state = (window as any).cadTest; state.session = state.lib.createCadPreviewDriver().createSession(state.host);
    state.pending = state.session.load('/delayed-drawing.dxf', { descriptor: { extension: 'dxf', name: 'old.dxf' } });
  });
  await request;
  await page.evaluate(async text => {
    const state = (window as any).cadTest, source = new TextEncoder().encode(text);
    await state.session.load(source, { descriptor: { source, extension: 'dxf', name: 'current.dxf' } });
  }, lineDxfFixture);
  release(); await page.evaluate(async () => { await (window as any).cadTest.pending; });
  expect(await page.evaluate(() => (window as any).cadTest.session.getState())).toMatchObject({ title: 'current.dxf', loading: false, error: null, activeLayerIds: ['LINES'] });
  await expect(page.locator('svg line')).toHaveCount(1);
});

test('drops an unresolved raster after cancellation without leaking a URL', async ({ page }) => {
  await prepare(page);
  await page.evaluate(dxf => {
    const state = (window as any).cadTest, source = new TextEncoder().encode(dxf);
    state.controller = new AbortController(); state.errorCount = 0;
    state.session = state.lib.createCadPreviewDriver().createSession(state.host, { resourceResolver: () => new Promise(resolve => { state.finish = resolve; }) });
    state.session.on('error', () => state.errorCount++);
    state.pending = state.session.load(source, { descriptor: { source, extension: 'dxf' }, signal: state.controller.signal }).then(() => 'done', error => error.name);
  }, createRasterDxfFixture());
  await page.waitForFunction(() => Boolean((window as any).cadTest.finish));
  const result = await page.evaluate(async () => {
    const state = (window as any).cadTest; state.controller.abort(); state.finish(new Blob(['late image']));
    return { settled: await state.pending, loading: state.session.getState().loading, urls: state.urls.size, errors: state.errorCount, empty: !state.host.querySelector('svg') };
  });
  expect(result).toEqual({ settled: 'AbortError', loading: false, urls: 0, errors: 0, empty: true });
});

test('opens DXF and PNG sidecars through the demo upload flow', async ({ page }) => {
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
  const png = Buffer.from(await createPngFixture(32)); await page.goto('./?view=preview');
  await page.locator('.wb-upload input[type=file]').setInputFiles([
    { name: 'rasters.dxf', mimeType: 'application/dxf', buffer: Buffer.from(createRasterDxfFixture(2)) },
    { name: 'image-0.png', mimeType: 'image/png', buffer: png },
    { name: 'image-1.png', mimeType: 'image/png', buffer: png }
  ]);
  await expect(page.locator('svg.cadv-canvas image')).toHaveCount(2);
  await expect(page.locator('.wb-note.is-error')).toHaveCount(0);
  expect(await page.locator('svg.cadv-canvas image').evaluateAll(async nodes => {
    const sizes = [];
    for (const node of nodes) { const image = new Image(); image.src = node.getAttribute('href')!; await image.decode(); sizes.push(image.naturalWidth); }
    return sizes;
  })).toEqual([32, 32]); expect(errors).toEqual([]);
});

test('fits rotated SHX paths and aborts a later unresolved font request', async ({ page }) => {
  await prepare(page);
  const result = await page.evaluate(async ({ dxf, font }) => {
    const { lib, host, urls } = (window as any).cadTest;
    const source = new TextEncoder().encode(dxf);
    let requested: () => void;
    const started = new Promise<void>(resolve => { requested = resolve; });
    let resolveCount = 0;
    const session = lib.createCadPreviewDriver().createSession(host, { resourceResolver: () => {
      if (++resolveCount === 1) return new Blob([new Uint8Array(font)]);
      requested();
      return new Promise(() => {});
    } });
    await session.load(source, { descriptor: { source, extension: 'dxf' } });
    const svg = host.querySelector('svg') as SVGSVGElement, path = host.querySelector('[data-shx-text]') as SVGPathElement;
    const box = path.getBBox();
    const matrix = svg.getScreenCTM()!.inverse().multiply(path.getScreenCTM()!), view = svg.viewBox.baseVal;
    const inside = [box.x, box.x + box.width].every(x => [box.y, box.y + box.height].every(y => {
      const point = new DOMPoint(x, y).matrixTransform(matrix);
      return point.x >= view.x && point.x <= view.x + view.width && point.y >= view.y && point.y <= view.y + view.height;
    }));
    const label = path.getAttribute('aria-label');
    const controller = new AbortController();
    const pending = session.load(source, { descriptor: { source, extension: 'dxf' }, signal: controller.signal })
      .then(() => 'rendered', error => error.name);
    await started;
    controller.abort();
    const settled = await pending;
    const state = session.getState();
    session.destroy();
    return { inside, label, settled, urls: urls.size, loading: state.loading, fonts: state.fonts.length };
  }, { dxf: createShxDxf({ labels: ['AAAAAAAA'] }), font: [...testShxFont] });
  expect(result).toEqual({ inside: true, label: 'AAAAAAAA', settled: 'AbortError', urls: 0, loading: false, fonts: 0 });
});

for (const extension of ['dxf', 'dwg']) {
  test(`opens ${extension.toUpperCase()} with a local SHX sidecar through the demo`, async ({ page }) => {
    const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
    const requests: string[] = []; page.on('request', request => requests.push(request.url()));
    const drawing = extension === 'dwg' ? await readFile('apps/demo/public/samples/graphics/filens-cafe-2018.dwg')
      : Buffer.from(createShxDxf());
    await page.goto('./?view=preview');
    await page.locator('.wb-upload input[type=file]').setInputFiles([
      { name: `stroke.${extension}`, mimeType: 'application/octet-stream', buffer: drawing },
      { name: extension === 'dwg' ? 'txt.shx' : 'stroke.shx', mimeType: 'application/octet-stream', buffer: Buffer.from(testShxFont) }
    ]);
    const label = extension === 'dwg' ? 'FIELD NOTES / CAFE' : 'AA';
    const outline = page.locator(`svg.cadv-canvas path[data-shx-text][aria-label="${label}"]`);
    await expect(outline).toHaveAttribute('d', /^M.+L/);
    await expect(page.locator('.wb-note.is-error')).toHaveCount(0);
    expect(requests.filter(url => url.endsWith('.shx'))).toEqual([]);
    if (extension === 'dwg') expect(requests.filter(url => url.includes('converter-cad.wasm'))).toHaveLength(1);
    expect(errors).toEqual([]);
  });
}
