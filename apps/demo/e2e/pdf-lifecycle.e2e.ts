import { resolve } from 'node:path';
import { expect, test } from '@playwright/test';
import { createPdfFixture } from '../../../packages/pdf/test/fixtures/document.mjs';
import { servePdfFixture } from '../../../packages/pdf/test/fixtures/range-source.mjs';

test('renders mixed PDF pages on demand and supports navigation, zoom and resize', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto('./');
  const moduleUrl = new URL(`@fs${resolve('packages/pdf/src/index.ts')}`, page.url()).href;
  const bytes = [...createPdfFixture(100, true)];
  const result = await page.evaluate(async ({ moduleUrl, bytes }) => {
    const { createPdfPreviewDriver } = await import(/* @vite-ignore */ moduleUrl);
    const host = document.createElement('div');
    host.id = 'pdf-lifecycle-test'; host.style.cssText = 'position:fixed;inset:0;width:800px;height:600px;background:white';
    document.body.replaceChildren(host);
    const session = createPdfPreviewDriver().createSession(host);
    (window as any).pdfLifecycle = { host, session };
    const source = new Uint8Array(bytes);
    await session.load(source, { descriptor: { source, name: 'mixed.pdf' } });
    return { state: session.getState(), canvases: host.querySelectorAll('canvas').length, slots: host.querySelectorAll('.pdfv-page-slot').length };
  }, { moduleUrl, bytes });
  expect(result.state).toMatchObject({ loading: false, error: null, pageCount: 100, pageIndex: 0 });
  expect(result.canvases).toBeLessThanOrEqual(3);
  expect(result.slots).toBeLessThanOrEqual(3);
  await page.evaluate(() => (window as any).pdfLifecycle.session.goToPage(50));
  await expect(page.locator('canvas[data-page-index="50"][data-rendered="true"]')).toHaveCount(1);
  await expect.poll(() => page.evaluate(() => (window as any).pdfLifecycle.session.getState().pageIndex)).toBe(50);
  expect(await page.locator('canvas').count()).toBeLessThanOrEqual(4);
  expect(await page.locator('.pdfv-page-slot').count()).toBeLessThanOrEqual(4);
  await expect(page.locator('.pdfv-page-slot[data-page-index="0"]')).toHaveCount(0);
  await page.evaluate(() => (window as any).pdfLifecycle.session.next());
  await expect(page.locator('canvas[data-page-index="51"][data-rendered="true"]')).toHaveCount(1);
  await page.evaluate(() => (window as any).pdfLifecycle.session.prev());
  await expect(page.locator('canvas[data-page-index="50"][data-rendered="true"]')).toHaveCount(1);
  const initialWidth = await page.locator('canvas[data-page-index="50"]').evaluate(canvas => (canvas as HTMLCanvasElement).width);
  await page.evaluate(() => (window as any).pdfLifecycle.session.setScale(1.5));
  await expect.poll(() => page.locator('canvas[data-page-index="50"][data-rendered="true"]').evaluateAll(canvases => (canvases[0] as HTMLCanvasElement)?.width ?? 0)).toBe(Math.ceil(initialWidth * 1.5));
  await page.evaluate(() => (window as any).pdfLifecycle.session.fit('width'));
  await expect.poll(() => page.locator('canvas[data-page-index="50"][data-rendered="true"]').evaluateAll(canvases => (canvases[0] as HTMLCanvasElement)?.width ?? 0)).toBe(1200);
  await page.evaluate(() => { (window as any).pdfLifecycle.host.style.width = '480px'; });
  await expect.poll(async () => Math.abs(await page.locator('canvas[data-page-index="50"][data-rendered="true"]').evaluateAll(canvases => (canvases[0] as HTMLCanvasElement)?.width ?? 0) - 720)).toBeLessThanOrEqual(1);
  expect(await page.locator('canvas[data-page-index="50"]').evaluate(canvas => Math.abs(canvas.getBoundingClientRect().width - 720))).toBeLessThanOrEqual(1);
  await page.evaluate(() => { const { session } = (window as any).pdfLifecycle; session.fit('contain'); session.setScale(0.1); session.goToPage(0); });
  // Several pages are genuinely visible at this scale; each must receive a canvas.
  await expect(page.locator('canvas[data-page-index="6"][data-rendered="true"]')).toHaveCount(1);
  await page.evaluate(() => (window as any).pdfLifecycle.session.destroy());
  await expect(page.locator('#pdf-lifecycle-test')).toBeEmpty();
  expect(errors).toEqual([]);
});

test('defers text on nearby PDF pages and restarts it on a still-mounted canvas', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto('./');
  const moduleUrl = new URL(`@fs${resolve('packages/pdf/src/index.ts')}`, page.url()).href;
  await page.evaluate(async ({ moduleUrl, bytes }) => {
    const { PdfPreviewSession } = await import(/* @vite-ignore */ moduleUrl);
    const host = document.createElement('div');
    host.style.cssText = 'position:fixed;inset:0;width:800px;height:600px';
    document.body.replaceChildren(host);
    const session = new PdfPreviewSession(host, { fit: 'none' });
    const source = new Uint8Array(bytes);
    await session.load(source, { descriptor: { source, name: 'nearby-text.pdf' } });
    const first = await (session as any).document.getPage(1);
    const prototype = Object.getPrototypeOf(first);
    const original = prototype.streamTextContent;
    const calls: number[] = [], cancelled: number[] = [];
    prototype.streamTextContent = function (this: { pageNumber: number }, ...args: unknown[]) {
      const pageNumber = this.pageNumber;
      const pause = pageNumber === 2 && !calls.includes(2);
      calls.push(pageNumber);
      if (!pause) return original.apply(this, args);
      return new ReadableStream({ pull() { return new Promise(() => {}); }, cancel() { cancelled.push(pageNumber); } }, { highWaterMark: 0 });
    };
    Object.assign(window, { nearbyTextPdf: { session, calls, cancelled } });
  }, { moduleUrl, bytes: [...createPdfFixture(8, false, 0, undefined, 0, 0)] });

  const counts = () => page.evaluate(() => {
    const { calls, cancelled } = (window as any).nearbyTextPdf;
    return { calls, cancelled };
  });
  const navigate = (index: number) => page.evaluate(index => (window as any).nearbyTextPdf.session.goToPage(index), index);
  const neighbor = page.locator('.pdfv-page-slot[data-page-index="1"]');
  const canvas = neighbor.locator('canvas[data-rendered="true"]');
  const layer = neighbor.locator('.pdfv-text-layer');
  await expect(canvas).toBeAttached();
  await expect(canvas).not.toBeInViewport();
  await expect(layer).toHaveCount(0);
  expect(await counts()).toEqual({ calls: [], cancelled: [] });
  const firstCanvas = await canvas.elementHandle();

  await navigate(1);
  await expect(canvas).toBeInViewport();
  await expect(layer).toBeAttached();
  await expect(layer).not.toHaveAttribute('data-rendered', 'true');
  await expect.poll(counts).toEqual({ calls: [2], cancelled: [] });
  await navigate(0);
  await expect(layer).toHaveCount(0);
  await expect.poll(counts).toEqual({ calls: [2], cancelled: [2] });
  expect(await firstCanvas!.evaluate(element => element.isConnected)).toBe(true);

  await navigate(1);
  await expect(layer).toHaveAttribute('data-rendered', 'true');
  await expect(layer).toHaveText('Document page 2');
  const finishedLayer = await layer.elementHandle();
  await navigate(0);
  await expect(canvas).not.toBeInViewport();
  expect(await finishedLayer!.evaluate(element => element.isConnected)).toBe(true);
  expect(await counts()).toEqual({ calls: [2, 2], cancelled: [2] });

  const state = await page.evaluate(async () => {
    const { session } = (window as any).nearbyTextPdf;
    await session.find('Document page 7');
    return session.getState();
  });
  expect(state).toMatchObject({ pageIndex: 6, error: null, warnings: [], search: { total: 1, pagesScanned: 8 } });
  await expect(page.locator('.pdfv-page-slot[data-page-index="6"] .pdfv-search-match.is-active')).toHaveText('Document page 7');
  await page.evaluate(() => (window as any).nearbyTextPdf.session.destroy());
  expect(errors).toEqual([]);
});

test('keeps the selected PDF page when several pages share the viewport', async ({ page }) => {
  await page.goto('./');
  const moduleUrl = new URL(`@fs${resolve('packages/pdf/src/index.ts')}`, page.url()).href;
  await page.evaluate(async ({ moduleUrl, bytes }) => {
    const { PdfPreviewSession } = await import(/* @vite-ignore */ moduleUrl);
    const host = document.createElement('div');
    host.style.cssText = 'position:fixed;inset:0;width:800px;height:600px';
    document.body.replaceChildren(host);
    const session = new PdfPreviewSession(host, { fit: 'none', initialScale: .1 });
    Object.assign(window, { multiPagePdf: session });
    const source = new Uint8Array(bytes);
    await session.load(source, { descriptor: { source, name: 'five-pages.pdf' } });
  }, { moduleUrl, bytes: [...createPdfFixture(5, true, 0, undefined, 0, 0)] });
  const root = page.locator('.pdfv-preview');
  const readIndex = () => page.evaluate(async () => {
    await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    return (window as any).multiPagePdf.getState().pageIndex;
  });
  const canvas = (index: number) => root.locator(`canvas[data-page-index="${index}"][data-rendered="true"]`);
  await expect(canvas(4)).toBeInViewport({ ratio: .99 });
  await expect(canvas(2)).toHaveAttribute('height', '100');
  expect(await root.evaluate(element => element.scrollHeight === element.clientHeight)).toBe(true);
  expect(await readIndex()).toBe(0);
  for (const index of [1, 2, 3, 4]) {
    await page.evaluate(() => (window as any).multiPagePdf.next());
    expect(await readIndex()).toBe(index);
  }
  await page.evaluate(() => (window as any).multiPagePdf.prev());
  expect(await readIndex()).toBe(3);
  await page.evaluate(() => (window as any).multiPagePdf.setScale(.2));
  await expect(canvas(3)).toBeInViewport({ ratio: .99 });
  expect(await readIndex()).toBe(3);
  const bottom = () => root.evaluate(element => element.scrollHeight - element.clientHeight - element.scrollTop);
  expect(await bottom()).toBeLessThanOrEqual(1);
  await page.evaluate(() => (window as any).multiPagePdf.next());
  expect(await readIndex()).toBe(4);
  await page.evaluate(() => (window as any).multiPagePdf.prev());
  expect(await readIndex()).toBe(3);
  expect(await bottom()).toBeLessThanOrEqual(1);
  await page.evaluate(() => (window as any).multiPagePdf.setScale(1));
  await expect(canvas(3)).toBeInViewport();
  expect(await readIndex()).toBe(3);
  expect(await bottom()).toBeGreaterThan(1);
  await root.evaluate(element => { element.scrollTop = element.scrollHeight; });
  await expect(canvas(4)).toBeInViewport({ ratio: .95 });
  expect(await readIndex()).toBe(4);
  await page.evaluate(() => {
    const session = (window as any).multiPagePdf;
    session.setScale(.1);
    session.goToPage(0);
  });
  await expect(canvas(4)).toBeInViewport({ ratio: .99 });
  const selectedTop = await page.evaluate(async () => {
    const session = (window as any).multiPagePdf;
    await session.find('Document page 5');
    session.prev();
    session.setScale(.4);
    return document.querySelector('.pdfv-preview')!.scrollTop;
  });
  await expect(canvas(4)).toHaveCount(1);
  await expect(root.locator('.pdfv-page-slot[data-page-index="4"] .pdfv-search-match.is-active')).toHaveText('Document page 5');
  expect(await readIndex()).toBe(3);
  expect(await root.evaluate(element => element.scrollTop)).toBeCloseTo(selectedTop, 0);
  await page.evaluate(() => (window as any).multiPagePdf.destroy());
});

for (const scale of [1, .1]) test(`paints the selected PDF page at scale ${scale} while a mounted neighbor waits for bytes`, async ({ page }) => {
  const padding = `% ${'x'.repeat(8192)}\n`.repeat(12);
  const bytes = Buffer.from(createPdfFixture(scale === 1 ? 16 : 5, false, 0, (index: number) =>
    `${padding}% Page ${index + 1} midpoint\n${padding}BT /F1 24 Tf 40 740 Td (Page ${index + 1}) Tj ET\n`, 4, 0));
  const heldOffset = bytes.indexOf('% Page 2 midpoint');
  const server = await servePdfFixture(bytes);
  server.pauseRanges(heldOffset);
  try {
    await page.goto('./');
    const moduleUrl = new URL(`@fs${resolve('packages/pdf/src/index.ts')}`, page.url()).href;
    await page.evaluate(async ({ moduleUrl, source, scale }) => {
      const { PdfPreviewSession } = await import(/* @vite-ignore */ moduleUrl);
      const host = document.createElement('div');
      host.style.cssText = 'position:fixed;inset:0;width:800px;height:600px';
      document.body.replaceChildren(host);
      const session = new PdfPreviewSession(host, { fit: 'none', initialScale: scale });
      Object.assign(window, { priorityPdf: session });
      await session.load(source, { descriptor: { source, name: 'slow-neighbor.pdf' } });
    }, { moduleUrl, source: server.url, scale });
    const request = () => server.requests.find(row => row.partial && row.begin <= heldOffset && row.end > heldOffset);
    await expect.poll(() => request()?.bytesSent).toBe(0);
    const neighbor = page.locator('.pdfv-page[data-page-index="1"]:not([data-rendered])');
    const previousCanvas = await neighbor.elementHandle();
    const visible = page.locator('.pdfv-page[data-page-index="2"][data-rendered="true"]');
    if (scale < 1) await expect(visible).toBeInViewport();
    await page.evaluate(() => (window as any).priorityPdf.goToPage(2));
    await expect(visible).toBeInViewport();
    await expect(page.locator('.pdfv-page-slot[data-page-index="2"] .pdfv-text-layer[data-rendered="true"]')).toHaveText('Page 3');
    await expect(page.locator('.pdfv-page-slot[data-page-index="1"]')).toHaveCount(1);
    const waitingWidth = await previousCanvas!.evaluate(canvas => (canvas as HTMLCanvasElement).width);
    if (scale === 1) expect(waitingWidth).toBe(0);
    else expect(waitingWidth).toBeGreaterThan(0);
    expect(await page.locator('.pdfv-page-slot').evaluateAll(slots => slots.map(slot => Number((slot as HTMLElement).dataset.pageIndex))))
      .toEqual(scale === 1 ? [1, 2, 3] : [0, 1, 2, 3, 4]);
    expect(request()?.bytesSent).toBe(0);
    expect(await page.evaluate(() => (window as any).priorityPdf.getState())).toMatchObject({ pageIndex: 2, error: null });
    await page.evaluate(() => (window as any).priorityPdf.destroy());
    await expect.poll(() => request()?.cancelled).toBe(true);
  } finally { await server.close(); }
});

test('paints other visible PDF pages while one visible page waits for bytes', async ({ page }) => {
  const padding = `% ${'x'.repeat(8192)}\n`.repeat(12);
  const bytes = Buffer.from(createPdfFixture(8, false, 0, (index: number) =>
    `${padding}% Page ${index + 1} midpoint\n${padding}BT /F1 24 Tf 40 740 Td (Page ${index + 1}) Tj ET\n`, 4, 0));
  const heldOffset = bytes.indexOf('% Page 2 midpoint');
  const server = await servePdfFixture(bytes);
  server.pauseRanges(heldOffset);
  try {
    await page.goto('./');
    const moduleUrl = new URL(`@fs${resolve('packages/pdf/src/index.ts')}`, page.url()).href;
    await page.evaluate(async ({ moduleUrl, source }) => {
      const { PdfPreviewSession } = await import(/* @vite-ignore */ moduleUrl);
      const host = document.createElement('div');
      host.style.cssText = 'position:fixed;inset:0;width:800px;height:600px';
      document.body.replaceChildren(host);
      const session = new PdfPreviewSession(host, { fit: 'none', initialScale: .1 });
      Object.assign(window, { priorityPdf: session });
      await session.load(source, { descriptor: { source, name: 'held-visible-page.pdf' } });
    }, { moduleUrl, source: server.url });
    const request = () => server.requests.find(row => row.partial && row.begin <= heldOffset && row.end > heldOffset);
    await expect.poll(() => request()?.bytesSent).toBe(0);
    for (const index of [2, 3, 4]) {
      const slot = page.locator(`.pdfv-page-slot[data-page-index="${index}"]`);
      await expect(slot.locator('canvas[data-rendered="true"]')).toBeInViewport();
      await expect(slot.locator('.pdfv-text-layer[data-rendered="true"]')).toHaveText(`Page ${index + 1}`);
    }
    await page.locator('.pdfv-preview').evaluate(root => { root.scrollTop = 120; });
    await expect(page.locator('.pdfv-page[data-page-index="1"]:not([data-rendered])')).toBeInViewport();
    const last = page.locator('.pdfv-page-slot[data-page-index="7"]');
    await expect(last.locator('canvas[data-rendered="true"]')).toBeInViewport();
    await expect(last.locator('.pdfv-text-layer[data-rendered="true"]')).toHaveText('Page 8');
    expect(request()?.bytesSent).toBe(0);
    await page.evaluate(() => (window as any).priorityPdf.destroy());
    await expect.poll(() => request()?.cancelled).toBe(true);
  } finally { await server.close(); }
});

test.describe('large PDF page rasters', () => {
  test.use({ deviceScaleFactor: 2 });

  for (const rotation of [0, 90]) test(`caps page raster memory and redraws selectable detail at rotation ${rotation}`, async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.goto('./');
    const moduleUrl = new URL(`@fs${resolve('packages/pdf/src/index.ts')}`, page.url()).href;
    const bytes = [...createPdfFixture(3, false, rotation, (index: number) =>
      `1 0 0 rg 415 394 10 10 re f\n1 1 1 rg BT /F1 7 Tf 412 415 Td (Target ${index + 1}) Tj ET\n`, 0, 0)];
    await page.evaluate(async ({ moduleUrl, bytes }) => {
      const { PdfPreviewSession } = await import(/* @vite-ignore */ moduleUrl);
      const host = document.createElement('div');
      host.style.cssText = 'position:fixed;inset:0;width:800px;height:600px';
      document.body.replaceChildren(host);
      const session = new PdfPreviewSession(host, { fit: 'none' });
      Object.assign(window, { largePdf: session });
      const source = new Uint8Array(bytes);
      await session.load(source, { descriptor: { source, name: 'large-page.pdf' } });
    }, { moduleUrl, bytes });
    const root = page.locator('.pdfv-preview');
    const slot = root.locator('.pdfv-page-slot[data-page-index="0"]');
    const base = slot.locator('.pdfv-page[data-rendered="true"]');
    const detail = slot.locator('.pdfv-page-detail:visible');
    await expect(base).toHaveAttribute('width', rotation ? '1600' : '1200');
    await expect(detail).toHaveCount(0);
    await page.evaluate(() => (window as any).largePdf.setScale(20));
    await expect(detail).toBeVisible();
    expect(await base.evaluate(canvas => [canvas.style.width, canvas.style.height]))
      .toEqual(rotation ? ['16000px', '12000px'] : ['12000px', '16000px']);
    const firstDetail = (await detail.elementHandle())!;
    const originalBase = (await base.elementHandle())!;
    const marker = rotation ? { x: 7980, y: 8400 } : { x: 8400, y: 8020 };
    const target = { left: marker.x - 400, top: marker.y - 520 };
    const pan = await root.evaluate((element, { left, top }) => {
      element.scrollLeft = left; element.scrollTop = top;
      return [element.scrollLeft, element.scrollTop];
    }, target);
    expect(pan).toEqual([target.left, target.top]);
    await expect.poll(() => firstDetail.evaluate((canvas: HTMLCanvasElement) => [canvas.width, canvas.height])).toEqual([0, 0]);
    await expect(detail).toBeVisible();
    const pixels = await detail.evaluate((canvas: HTMLCanvasElement, marker) => {
      const base = canvas.parentElement!.querySelector('canvas.pdfv-page')!;
      const x = (marker.x - parseFloat(canvas.style.left)) * canvas.width / parseFloat(canvas.style.width);
      const y = (marker.y - parseFloat(canvas.style.top)) * canvas.height / parseFloat(canvas.style.height);
      return {
        color: Array.from(canvas.getContext('2d')!.getImageData(x, y, 1, 1).data),
        density: canvas.width / parseFloat(canvas.style.width),
        total: canvas.width * canvas.height + base.width * base.height
      };
    }, marker);
    expect(pixels.color).toEqual([255, 0, 0, 255]);
    expect(pixels.density).toBeGreaterThanOrEqual(1.9);
    expect(pixels.total).toBeLessThanOrEqual(8 * 1024 * 1024);
    await page.evaluate(() => (window as any).largePdf.find('Target 1'));
    const active = slot.locator('.pdfv-search-match.is-active');
    await expect(active).toHaveText('Target 1');
    await expect(active).toBeInViewport({ ratio: 1 });
    await page.evaluate(() => (window as any).largePdf.find(''));
    const text = slot.locator('.pdfv-text-layer span').getByText('Target 1', { exact: true });
    await expect(text).toBeInViewport({ ratio: 1 });
    const { x, y, width, height } = (await text.boundingBox())!;
    await page.mouse.move(x + (rotation ? width / 2 : 6), y + (rotation ? 6 : height / 2));
    await page.mouse.down();
    await page.mouse.move(x + (rotation ? width / 2 : width - 6), y + (rotation ? height - 6 : height / 2), { steps: 8 });
    await page.mouse.up();
    await expect.poll(() => page.evaluate(() => window.getSelection()?.toString())).toBe('Target 1');
    await page.evaluate(() => (window as any).largePdf.goToPage(2));
    await expect(root.locator('.pdfv-page-slot[data-page-index="2"] .pdfv-page-detail:visible')).toBeVisible();
    await expect(slot).toHaveCount(0);
    expect(await originalBase.evaluate((canvas: HTMLCanvasElement) => [canvas.width, canvas.height])).toEqual([0, 0]);
    await page.evaluate(() => (window as any).largePdf.destroy());
    expect(errors).toEqual([]);
  });
});

test.describe('shared PDF page raster budget', () => {
  test.use({ deviceScaleFactor: 3, viewport: { width: 1100, height: 2700 } });

  test('bounds the virtual canvas window and sharpens the selected page', async ({ page }) => {
    await page.goto('./');
    const moduleUrl = new URL(`@fs${resolve('packages/pdf/src/index.ts')}`, page.url()).href;
    await page.evaluate(async ({ moduleUrl, bytes }) => {
      const { PdfPreviewSession } = await import(/* @vite-ignore */ moduleUrl);
      const host = document.createElement('div');
      host.style.cssText = 'position:fixed;inset:0;width:800px;height:2500px';
      document.body.replaceChildren(host);
      const session = new PdfPreviewSession(host, { fit: 'none' });
      Object.assign(window, { budgetPdf: session });
      const source = new Uint8Array(bytes);
      await session.load(source, { descriptor: { source, name: 'high-density.pdf' } });
    }, { moduleUrl, bytes: [...createPdfFixture(12, false, 0, undefined, 0, 0)] });
    const root = page.locator('.pdfv-preview');
    const slot = (index: number) => root.locator(`.pdfv-page-slot[data-page-index="${index}"]`);
    const canvas = (index: number) => slot(index).locator('canvas.pdfv-page[data-rendered="true"]');
    const text = (index: number) => slot(index).locator('.pdfv-text-layer[data-rendered="true"]');
    const pixels = () => root.locator('canvas').evaluateAll(elements => elements.reduce((total, element) => {
      const canvas = element as HTMLCanvasElement;
      return total + canvas.width * canvas.height;
    }, 0));
    for (const index of [0, 1, 2, 3]) await expect(text(index)).toHaveText(`Document page ${index + 1}`);
    await expect(slot(1).locator('canvas.pdfv-page-detail:visible')).toHaveCount(1);
    await expect(canvas(0)).toHaveAttribute('width', '1800');
    expect(await pixels()).toBeLessThanOrEqual(16 * 1024 * 1024);
    const previousBase = (await canvas(1).elementHandle())!;
    const previousText = (await text(1).elementHandle())!;
    expect(await previousBase.evaluate((canvas: HTMLCanvasElement) => canvas.width)).toBeLessThan(1800);
    await page.evaluate(() => (window as any).budgetPdf.goToPage(1));
    await expect(canvas(1)).toHaveAttribute('width', '1800');
    await expect(canvas(1)).toHaveAttribute('height', '2400');
    expect(await previousBase.evaluate((canvas: HTMLCanvasElement) => [canvas.width, canvas.height])).toEqual([0, 0]);
    expect(await text(1).evaluate((layer, previous) => layer === previous, previousText)).toBe(true);
    expect(await pixels()).toBeLessThanOrEqual(16 * 1024 * 1024);
    await page.evaluate(() => (window as any).budgetPdf.find('Document page 9'));
    await expect(slot(8).locator('.pdfv-search-match.is-active')).toHaveText('Document page 9');
    await expect(canvas(8)).toHaveAttribute('width', '1800');
    await expect(slot(1)).toHaveCount(0);
    expect(await pixels()).toBeLessThanOrEqual(16 * 1024 * 1024);
    await page.evaluate(() => (window as any).budgetPdf.destroy());
    await expect(root).toHaveCount(0);
  });
});

test('reaches distant and final PDF pages within a bounded native scroll track', async ({ page }) => {
  const count = 15_000;
  const server = await servePdfFixture(Buffer.from(createPdfFixture(count, false, 0, undefined, 100, 0)));
  try {
    await page.goto('./');
    const moduleUrl = new URL(`@fs${resolve('packages/pdf/src/index.ts')}`, page.url()).href;
    await page.evaluate(async ({ moduleUrl, url }) => {
      const { PdfPreviewSession } = await import(/* @vite-ignore */ moduleUrl);
      const host = document.createElement('div'); host.style.cssText = 'position:fixed;width:800px;height:600px';
      document.body.replaceChildren(host);
      const session = new PdfPreviewSession(host);
      await session.load(url, { descriptor: { source: url, name: 'long.pdf' } });
      Object.assign(window, { longPdf: session, longPdfHost: host });
    }, { moduleUrl, url: server.url });
    const root = page.locator('.pdfv-preview'), slots = page.locator('.pdfv-page-slot');
    expect(await root.evaluate(element => element.scrollHeight)).toBe(8_000_000);
    expect(await slots.count()).toBeLessThanOrEqual(3);
    await page.evaluate(() => (window as any).longPdf.goToPage(7499));
    await expect(page.locator('canvas[data-page-index="7499"][data-rendered="true"]')).toBeInViewport();
    expect(await slots.count()).toBeLessThanOrEqual(3);
    await root.evaluate(element => { element.scrollTop = element.scrollHeight; });
    const last = page.locator(`canvas[data-page-index="${count - 1}"][data-rendered="true"]`);
    await expect(last).toBeInViewport({ ratio: .95 });
    expect(await last.evaluate(element => element.getBoundingClientRect().height)).toBeGreaterThan(550);
    expect(await page.evaluate(() => (window as any).longPdf.getState().pageIndex)).toBe(count - 1);
    expect(await slots.count()).toBeLessThanOrEqual(3);
    await page.evaluate(() => (window as any).longPdf.setScale(.75));
    await expect.poll(() => root.evaluate(element => element.scrollHeight)).toBeLessThan(8_000_000);
    await expect(last).toBeInViewport({ ratio: .95 });
    await expect.poll(() => page.evaluate(() => (window as any).longPdf.getState().pageIndex)).toBe(count - 1);
    await page.evaluate(() => (window as any).longPdf.setScale(1));
    await expect.poll(() => root.evaluate(element => element.scrollHeight)).toBe(8_000_000);
    await expect(last).toBeInViewport({ ratio: .95 });
    await page.setViewportSize({ width: 1000, height: 2000 });
    await page.evaluate(() => { (window as any).longPdfHost.style.height = '1800px'; });
    await expect.poll(() => root.evaluate(element => element.clientHeight)).toBe(1800);
    await expect(last).toBeInViewport({ ratio: .95 });
    const selected = (method: 'next' | 'prev') => page.evaluate(async method => {
      const session = (window as any).longPdf;
      session[method]();
      await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
      return session.getState().pageIndex;
    }, method);
    expect(await selected('prev')).toBe(count - 2);
    expect(await selected('next')).toBe(count - 1);
    await root.evaluate(element => { element.scrollTop -= 96; });
    await expect(last).toBeInViewport({ ratio: .7 });
    const readIndex = () => page.evaluate(() => (window as any).longPdf.getState().pageIndex);
    await expect.poll(readIndex).toBe(count - 2);
    await root.evaluate(element => { element.scrollTop = element.scrollHeight; });
    await expect.poll(readIndex).toBe(count - 1);
    expect(await root.evaluate(element => element.scrollHeight)).toBe(8_000_000);
    expect(await slots.count()).toBeLessThanOrEqual(6);
    await page.evaluate(() => (window as any).longPdf.destroy());
  } finally { await server.close(); }
});

test('releases the drawing operators of distant PDF pages and paints them again when revisited', async ({ page }) => {
  const server = await servePdfFixture(Buffer.from(createPdfFixture(36, false, 0, undefined, 6, 1200)));
  try {
    await page.goto('./');
    const moduleUrl = new URL(`@fs${resolve('packages/pdf/src/index.ts')}`, page.url()).href;
    await page.evaluate(async ({ moduleUrl, url }) => {
      const { PdfPreviewSession } = await import(/* @vite-ignore */ moduleUrl);
      const host = document.createElement('div');
      host.style.cssText = 'position:fixed;inset:0;width:800px;height:600px';
      document.body.replaceChildren(host);
      const session = new PdfPreviewSession(host);
      await session.load(url, { descriptor: { source: url, name: 'vector-pages.pdf' } });
      Object.assign(window, { vectorPdf: session });
    }, { moduleUrl, url: server.url });
    const visited = [0, 8, 16, 24, 32];
    const counts = () => page.evaluate(async (indices) => {
      // Inspect the pinned PDF.js operator lists without starting a fresh render.
      const { document } = (window as any).vectorPdf;
      return Promise.all(indices.map(async index => {
        const proxy = await document.getPage(index + 1);
        const states = proxy._intentStates as Map<string, { operatorList: { fnArray: number[] } }>;
        return Array.from(states.values()).reduce((total, state) => total + state.operatorList.fnArray.length, 0);
      }));
    }, visited);
    const visit = async (index: number) => {
      await page.evaluate(index => (window as any).vectorPdf.goToPage(index), index);
      const slot = page.locator(`.pdfv-page-slot[data-page-index="${index}"]`);
      await expect(slot.locator('canvas[data-rendered="true"]')).toBeVisible();
      await expect(slot.locator('.pdfv-text-layer[data-rendered="true"]')).toHaveText(`Document page ${index + 1}`);
    };
    const painted = [];
    for (const [i, index] of visited.entries()) {
      await visit(index);
      const count = (await counts())[i];
      expect(count).toBeGreaterThan(1000);
      painted.push(count);
    }
    await expect.poll(counts, { timeout: 3000 }).toEqual([0, 0, 0, 0, painted[4]]);
    await visit(0);
    await expect.poll(counts).toEqual([painted[0], 0, 0, 0, 0]);
    await page.evaluate(() => (window as any).vectorPdf.destroy());
  } finally { await server.close(); }
});

test('preserves the latest PDF while switching, aborting and destroying delayed reads', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto('./');
  const moduleUrl = new URL(`@fs${resolve('packages/pdf/src/index.ts')}`, page.url()).href;
  const sampleUrl = new URL('samples/filens-cosmic-atlas.pdf', page.url()).href;
  const result = await page.evaluate(async ({ moduleUrl, sampleUrl }) => {
    const { createPdfPreviewDriver } = await import(/* @vite-ignore */ moduleUrl);
    const bytes = new Uint8Array(await (await fetch(sampleUrl)).arrayBuffer());
    const host = document.createElement('div'); host.style.cssText = 'width:800px;height:600px'; document.body.replaceChildren(host);
    const session = createPdfPreviewDriver().createSession(host);
    let rendered = 0;
    session.on('rendered', () => rendered++);
    const delayed = () => {
      let release!: (value: ArrayBuffer) => void;
      let start!: () => void;
      const started = new Promise<void>(resolve => { start = resolve; });
      const source = new File([], 'delayed.pdf');
      Object.defineProperty(source, 'arrayBuffer', { value: () => new Promise<ArrayBuffer>(resolve => { release = resolve; start(); }) });
      return { source, started, release: () => release(new ArrayBuffer(0)) };
    };
    const load = (source: File | Uint8Array, signal?: AbortSignal) => session.load(source, { descriptor: { source, name: source instanceof File ? source.name : 'current.pdf' }, signal });
    const old = delayed(), pending = load(old.source);
    await old.started;
    await load(bytes);
    old.release(); await pending;
    const currentPreserved = session.getState().title === 'current.pdf' && session.getState().pageCount === 3 && host.querySelectorAll('canvas').length > 0;
    const controller = new AbortController(), cancelled = delayed();
    const cancellation = load(cancelled.source, controller.signal).then(() => 'loaded', (error: Error) => error.name);
    await cancelled.started;
    controller.abort(); cancelled.release();
    const abort = await cancellation;
    const last = delayed(), unfinished = load(last.source);
    await last.started;
    session.destroy(); last.release(); await unfinished;
    return { currentPreserved, abort, rendered, destroyed: !host.childElementCount };
  }, { moduleUrl, sampleUrl });
  expect(result).toEqual({ currentPreserved: true, abort: 'AbortError', rendered: 1, destroyed: true });
  expect(errors).toEqual([]);
});
