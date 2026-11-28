import { expect, test, type Page } from '@playwright/test';
import { resolve } from 'node:path';
import { gzipSync } from 'node:zlib';
import { createPdfFixture } from '../../../packages/pdf/test/fixtures/document.mjs';
import { createPdfAnnotationRangeFixture, createPdfAttachmentRangeFixture, createPdfPageTreeRangeFixture, createPdfSearchRangeFixture, servePdfFixture } from '../../../packages/pdf/test/fixtures/range-source.mjs';

const bytes = Buffer.from(createPdfFixture(600, false, 0, undefined, 20));
const canvas = (page: Page, index: number) => page.locator(`canvas.pdfv-page[data-page-index="${index}"][data-rendered="true"]`);
const scrollToPage = (page: Page, index: number) => page.locator('.pdfv-preview').evaluate((viewport, index) => {
  viewport.scrollTop = viewport.scrollHeight * index / 600;
}, index);

async function observePageRead(page: Page, action: 'GetPage' | 'GetOperatorList') {
  await page.addInitScript(action => {
    const probe = { reads: 0, cancelled: 0 };
    Object.assign(window, { pdfPageRead: probe });
    const post = Worker.prototype.postMessage;
    Worker.prototype.postMessage = function (message) {
      if (message?.action === action && message.data?.pageIndex === 5) {
        probe.reads++;
        const acknowledge = ({ data }: MessageEvent) => {
          // PDF.js sends CANCEL_COMPLETE after the sink's cancellation handler runs.
          if (data.stream !== 2 || data.streamId !== message.streamId || !data.success) return;
          probe.cancelled++;
          this.removeEventListener('message', acknowledge);
        };
        this.addEventListener('message', acknowledge);
      }
      return Reflect.apply(post, this, arguments);
    };
  }, action);
  return () => page.evaluate(() => (window as any).pdfPageRead as { reads: number; cancelled: number });
}

for (const { indirectBox, shared, label } of [
  { indirectBox: false, shared: false, label: 'page dictionary' },
  { indirectBox: true, shared: false, label: 'indirect media box' },
  { indirectBox: false, shared: true, label: 'page dictionary shared with search' }
]) test(`releases a displaced PDF lookup of the ${label}`, async ({ page }) => {
  const { bytes, offset } = createPdfPageTreeRangeFixture(indirectBox);
  const server = await servePdfFixture(bytes);
  server.pauseRanges(offset);
  const read = await observePageRead(page, 'GetPage');
  try {
    await page.goto('./');
    const moduleUrl = new URL(`@fs${resolve('packages/pdf/src/index.ts')}`, page.url()).href;
    await page.evaluate(async ({ moduleUrl, source }) => {
      const { PdfPreviewSession } = await import(/* @vite-ignore */ moduleUrl);
      const host = document.createElement('div'); host.style.cssText = 'position:fixed;inset:0;width:800px;height:600px';
      document.body.replaceChildren(host);
      const session = new PdfPreviewSession(host, { fit: 'none' });
      Object.assign(window, { geometryPdf: session });
      await session.load(source, { descriptor: { source, name: 'page-tree.pdf' } });
    }, { moduleUrl, source: server.url });
    const go = (index: number) => page.evaluate(index => (window as any).geometryPdf.goToPage(index), index);
    const ranges = () => server.requests.filter(request => request.partial && request.begin <= offset && offset < request.end);
    await expect(canvas(page, 0)).toBeInViewport();
    expect(ranges()).toHaveLength(0);
    await go(5);
    await expect.poll(() => ranges()[0]?.bytesSent).toBe(0);
    await expect(page.locator('.pdfv-page[data-page-index="5"]')).toHaveCount(0);
    if (shared) {
      await page.evaluate(() => { void (window as any).geometryPdf.find('missing phrase'); });
      await expect.poll(() => page.evaluate(() => (window as any).geometryPdf.getState().search))
        .toMatchObject({ pagesScanned: 11, searching: true });
    }
    await go(10);
    await expect(canvas(page, 10)).toBeInViewport();
    await expect.poll(async () => (await read()).cancelled).toBe(1);
    if (shared) {
      expect(ranges()[0]).toMatchObject({ bytesSent: 0, cancelled: false });
      await page.evaluate(() => (window as any).geometryPdf.find(''));
    }
    await expect.poll(() => ranges()[0]?.cancelled).toBe(true);
    server.resumeRanges();
    await go(5);
    await expect(canvas(page, 5)).toBeInViewport();
    await expect(canvas(page, 5)).toHaveCSS('width', '420px');
    await expect(page.locator('.pdfv-page-slot[data-page-index="5"] .pdfv-text-layer[data-rendered="true"]')).toHaveText('Page 6');
    expect(ranges()).toHaveLength(2);
    expect(ranges()[0].bytesSent).toBe(0);
    expect(ranges()[1].bytesSent).toBeGreaterThan(0);
    await go(10);
    await expect(canvas(page, 10)).toBeInViewport();
    await go(5);
    await expect(canvas(page, 5)).toBeInViewport();
    expect(await read()).toEqual({ reads: 2, cancelled: 1 });
    await page.evaluate(() => (window as any).geometryPdf.destroy());
  } finally { await server.close(); }
});

for (const { part, shared } of [
  { part: 'dictionary', shared: false }, { part: 'appearance', shared: false }, { part: 'resources', shared: false },
  { part: 'dictionary', shared: true }
]) test(`releases a displaced PDF annotation ${part} read${shared ? ' shared with annotation lookup' : ''}`, async ({ page }) => {
  const { bytes, offset } = createPdfAnnotationRangeFixture(part);
  const server = await servePdfFixture(bytes);
  server.pauseRanges(offset);
  const read = await observePageRead(page, 'GetOperatorList');
  const errors: Error[] = [];
  page.on('pageerror', error => errors.push(error));
  try {
    await page.goto('./');
    const moduleUrl = new URL(`@fs${resolve('packages/pdf/src/index.ts')}`, page.url()).href;
    await page.evaluate(async ({ moduleUrl, source }) => {
      const { PdfPreviewSession } = await import(/* @vite-ignore */ moduleUrl);
      const host = document.createElement('div'); host.style.cssText = 'position:fixed;inset:0;width:800px;height:600px';
      document.body.replaceChildren(host);
      const session = new PdfPreviewSession(host, { fit: 'none' });
      Object.assign(window, { annotationPdf: session });
      await session.load(source, { descriptor: { source, name: 'annotations.pdf' } });
    }, { moduleUrl, source: server.url });
    const go = (index: number) => page.evaluate(index => (window as any).annotationPdf.goToPage(index), index);
    const ranges = () => server.requests.filter(request => request.partial && request.begin <= offset && offset < request.end);
    expect(ranges()).toHaveLength(0);
    await go(5);
    await expect.poll(() => ranges()[0]?.bytesSent).toBe(0);
    await expect(page.locator('canvas.pdfv-page[data-page-index="5"]:not([data-rendered])')).toBeInViewport();
    if (shared) await page.evaluate(async () => {
      const pdf = (window as any).annotationPdf.document;
      const waiting = await pdf.getPage(6);
      (window as any).pendingAnnotations = waiting.getAnnotations({ intent: 'display' });
      await (await pdf.getPage(12)).getAnnotations({ intent: 'display' });
    });
    await go(10);
    await expect(canvas(page, 10)).toBeInViewport();
    await expect.poll(async () => (await read()).cancelled).toBe(1);
    if (shared) expect(ranges()).toMatchObject([{ bytesSent: 0, cancelled: false }]);
    else await expect.poll(() => ranges()[0]?.cancelled).toBe(true);
    server.resumeRanges();
    if (shared) {
      const annotations = await page.evaluate(() => (window as any).pendingAnnotations);
      expect(annotations).toMatchObject([{ subtype: 'Square', rect: [60, 570, 120, 630] }]);
    }
    await go(5);
    await expect(canvas(page, 5)).toBeInViewport();
    expect(await canvas(page, 5).evaluate((canvas: HTMLCanvasElement) => {
      const pixel = canvas.getContext('2d')!.getImageData(canvas.width * .15, canvas.height * .25, 1, 1);
      return Array.from(pixel.data);
    })).toEqual([255, 0, 0, 255]);
    expect(ranges()).toHaveLength(shared ? 1 : 2);
    await page.evaluate(() => (window as any).annotationPdf.destroy());
    expect(errors).toEqual([]);
  } finally { await server.close(); }
});

for (const font of [false, true]) test(`cancels a displaced PDF page's ${font ? 'font' : 'content'} range and retries it on return`, async ({ page }) => {
  const { bytes, offset, match } = createPdfSearchRangeFixture(font);
  const server = await servePdfFixture(bytes);
  const errors: Error[] = [];
  page.on('pageerror', error => errors.push(error));
  const go = (index: number) => page.locator('.pdfv-preview').evaluate((viewport, index) => {
    viewport.scrollTop = viewport.scrollHeight * index / 12;
  }, index);
  server.pauseRanges(offset);
  try {
    await page.goto(`./?url=${encodeURIComponent(server.url)}&lang=en`);
    await expect(canvas(page, 0)).toBeInViewport();
    await go(5);
    const ranges = () => server.requests.filter(request => request.partial && request.begin <= offset && offset < request.end);
    await expect.poll(() => ranges()[0]?.bytesSent).toBe(0);
    await go(10);
    await expect(canvas(page, 10)).toBeInViewport();
    await expect.poll(() => ranges()[0]?.cancelled).toBe(true);
    expect(ranges()[0].bytesSent).toBe(0);
    server.resumeRanges();
    await go(5);
    await expect(canvas(page, 5)).toBeInViewport();
    await expect(page.locator('.pdfv-page-slot[data-page-index="5"] .pdfv-text-layer[data-rendered="true"]')).toHaveText(match);
    expect(ranges()).toHaveLength(2);
    expect(ranges()[1].bytesSent).toBeGreaterThan(0);
    expect(errors).toEqual([]);
  } finally { await server.close(); }
});

test('keeps a PDF drawing range alive for a search that joined the same read', async ({ page }) => {
  const { bytes, offset } = createPdfSearchRangeFixture();
  const server = await servePdfFixture(bytes);
  server.pauseRanges(offset);
  const ranges = () => server.requests.filter(request => request.partial && request.begin <= offset && offset < request.end);
  const read = await observePageRead(page, 'GetOperatorList');
  try {
    await page.goto('./');
    const moduleUrl = new URL(`@fs${resolve('packages/pdf/src/index.ts')}`, page.url()).href;
    await page.evaluate(async ({ moduleUrl, source }) => {
      const { PdfPreviewSession } = await import(/* @vite-ignore */ moduleUrl);
      const host = document.createElement('div'); host.style.cssText = 'position:fixed;inset:0;width:800px;height:600px';
      document.body.replaceChildren(host);
      const session = new PdfPreviewSession(host);
      Object.assign(window, { sharedRangePdf: session });
      await session.load(source, { descriptor: { source, name: 'shared-drawing-range.pdf' } });
      session.goToPage(5);
    }, { moduleUrl, source: server.url });
    await expect.poll(() => ranges()[0]?.bytesSent).toBe(0);
    await page.evaluate(() => { void (window as any).sharedRangePdf.find('missing phrase'); });
    const searchState = () => page.evaluate(() => (window as any).sharedRangePdf.getState().search);
    await expect.poll(searchState).toMatchObject({ pagesScanned: 11, searching: true });
    await page.evaluate(() => (window as any).sharedRangePdf.goToPage(10));
    await expect(canvas(page, 10)).toBeInViewport();
    await expect.poll(async () => (await read()).cancelled).toBe(1);
    expect(ranges()[0]).toMatchObject({ bytesSent: 0, cancelled: false });
    server.resumeRanges();
    await expect.poll(searchState).toMatchObject({ pagesScanned: 12, searching: false, total: 0, truncated: false });
    expect((await searchState()).error).toBeUndefined();
    expect(ranges()).toHaveLength(1);
    await page.evaluate(() => (window as any).sharedRangePdf.destroy());
  } finally { await server.close(); }
});

test('reads ranges from the remote PDF, fetches distant pages and cancels when replaced', async ({ page }, testInfo) => {
  const server = await servePdfFixture(bytes);
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  try {
    await page.goto(`./?url=${encodeURIComponent(server.url)}&lang=zh`);
    await expect(canvas(page, 0)).toBeVisible();
    await expect(page.getByRole('note').getByRole('link')).toHaveAttribute('href', server.url);
    await expect.poll(() => server.requests[0]?.cancelled).toBe(true);
    expect(server.requests.filter(request => !request.partial)).toHaveLength(1);
    const startupBytes = server.requests.reduce((sum, request) => sum + request.bytesSent, 0);
    expect(startupBytes).toBeLessThan(bytes.length / 4);
    await testInfo.attach('PDF startup transfer', { body: JSON.stringify({ startupBytes, fileBytes: bytes.length,
      requests: server.requests }, null, 2), contentType: 'application/json' });

    const middle = bytes.indexOf('Document page 301');
    const middleRange = () => server.requests.find(request => request.partial && request.begin <= middle && request.end > middle);
    expect(middleRange()).toBeUndefined();
    await scrollToPage(page, 300);
    await expect(canvas(page, 300)).toBeVisible();
    expect(middleRange()).toBeDefined();

    server.pauseRanges();
    const before = server.requests.length;
    const pending = () => server.requests.slice(before).find(request => request.partial);
    await scrollToPage(page, 500);
    await expect.poll(pending).toMatchObject({ bytesSent: 0, cancelled: false });
    await page.getByLabel('导入文件', { exact: true }).setInputFiles({
      name: 'replacement.txt', mimeType: 'text/plain', buffer: Buffer.from('Replacement is ready.'),
    });
    await expect.poll(() => pending()?.cancelled).toBe(true);
    await expect(page.locator('.wb-preview-stage')).toContainText('Replacement is ready.');
    await expect(canvas(page, 500)).toHaveCount(0);
    await expect(page.getByRole('alert')).toHaveCount(0);
    expect(errors).toEqual([]);
  } finally { await server.close(); }
});

test('lists remote PDF attachments and cancels held reads on return and replacement', async ({ page }, testInfo) => {
  const fixture = createPdfAttachmentRangeFixture();
  const server = await servePdfFixture(fixture.bytes);
  const largeRanges = () => server.requests.filter(request => request.partial
    && request.begin <= fixture.payloadOffset && fixture.payloadOffset < request.end);
  const errors: Error[] = [];
  page.on('pageerror', error => errors.push(error));
  server.pauseRanges(fixture.payloadOffset);
  try {
    await page.goto(`./?url=${encodeURIComponent(server.url)}&lang=en`);
    await expect(canvas(page, 0)).toBeVisible();
    await page.locator('.filens-attachments summary').click();
    const attachments = page.locator('.filens-attachments');
    await expect(attachments.getByRole('button', { name: 'large.bin', exact: true })).toBeVisible();
    expect(largeRanges()).toHaveLength(0);
    const listingBytes = server.requests.reduce((sum, request) => sum + request.bytesSent, 0);
    expect(listingBytes).toBeLessThan(fixture.bytes.length / 8);
    await testInfo.attach('PDF attachment listing transfer', {
      body: JSON.stringify({ listingBytes, sourceBytes: fixture.bytes.length }), contentType: 'application/json'
    });

    for (let attempt = 0; attempt < 2; attempt++) {
      await attachments.getByRole('button', { name: 'notes.txt', exact: true }).click();
      await expect(page.locator('.filens-attachment-preview')).toContainText(fixture.text);
      await page.getByRole('button', { name: 'Back to document', exact: true }).click();
    }
    expect(largeRanges()).toHaveLength(0);
    await attachments.getByRole('button', { name: 'large.bin', exact: true }).click();
    await expect.poll(() => largeRanges()[0]?.bytesSent).toBe(0);
    await page.getByRole('button', { name: 'Back to document', exact: true }).click();
    await expect.poll(() => largeRanges()[0]?.cancelled).toBe(true);
    await expect(canvas(page, 0)).toBeVisible();
    await attachments.getByRole('button', { name: 'large.bin', exact: true }).click();
    await expect.poll(() => largeRanges()[1]?.bytesSent).toBe(0);
    await page.locator('.wb-upload input[type=file]').setInputFiles({
      name: 'replacement.txt', mimeType: 'text/plain', buffer: Buffer.from('Replacement document')
    });
    await expect.poll(() => largeRanges()[1]?.cancelled).toBe(true);
    await expect(page.locator('.wb-preview-stage')).toContainText('Replacement document');
    await expect(page.locator('.filens-attachment-panel')).toHaveCount(0);
    expect(errors).toEqual([]);
  } finally { await server.close(); }
});

for (const compressed of [true, false]) test(`bounds PDF attachment bytes and resolves embedded links (FlateDecode=${compressed})`, async ({ page }) => {
  const fixture = createPdfAttachmentRangeFixture(true, compressed);
  const server = await servePdfFixture(fixture.bytes);
  try {
    await page.goto('./');
    const moduleUrl = new URL(`@fs${resolve('packages/pdf/src/index.ts')}`, page.url()).href;
    const coreUrl = new URL(`@fs${resolve('packages/core/src/index.ts')}`, page.url()).href;
    const result = await page.evaluate(async ({ moduleUrl, coreUrl, source, size }) => {
      const { PdfPreviewSession } = await import(/* @vite-ignore */ moduleUrl);
      const { PREVIEW_CONTAINER_LIMITS } = await import(/* @vite-ignore */ coreUrl);
      const host = document.createElement('div');
      host.style.cssText = 'position:fixed;inset:0;width:800px;height:600px';
      document.body.replaceChildren(host);
      const budget = { expandedBytes: PREVIEW_CONTAINER_LIMITS.maxExpandedBytes - size + 1 };
      const session = new PdfPreviewSession(host, { containerContext: { depth: 0, budget } });
      try {
        await session.load(source, { descriptor: { source, name: 'bound-attachment.pdf' } });
        const listed = await session.getAttachments();
        const entry = listed.find((attachment: { name: string }) => attachment.name === 'notes.txt');
        const error = await entry.readRaw().then(() => '', (cause: Error) => cause.message);
        const refunded = budget.expandedBytes === PREVIEW_CONTAINER_LIMITS.maxExpandedBytes - size + 1;
        budget.expandedBytes--;
        const descriptor = await entry.readRaw();
        const pdfPage = await (session as any).document.getPage(1);
        const [link] = await pdfPage.getAnnotations();
        return { error, refunded, text: new TextDecoder().decode(descriptor.source), bufferSize: descriptor.source.buffer.byteLength,
          atLimit: budget.expandedBytes === PREVIEW_CONTAINER_LIMITS.maxExpandedBytes,
          linked: new TextDecoder().decode(link.attachment.content), linkBufferSize: link.attachment.content.buffer.byteLength };
      } finally { session.destroy(); }
    }, { moduleUrl, coreUrl, source: server.url, size: Buffer.byteLength(fixture.text) });
    expect(result).toEqual({ error: 'Attachment exceeds the expanded preview size limit.', refunded: true,
      atLimit: true, text: fixture.text, linked: fixture.text, bufferSize: Buffer.byteLength(fixture.text),
      linkBufferSize: Buffer.byteLength(fixture.text) });
    expect(server.requests.some(request => request.partial
      && request.begin <= fixture.payloadOffset && fixture.payloadOffset < request.end)).toBe(false);
  } finally { await server.close(); }
});

test('opens a PDF from an HTTP server without range support', async ({ page }) => {
  const server = await servePdfFixture(bytes, { ranges: false });
  try {
    await page.goto(`./?url=${encodeURIComponent(server.url)}&lang=en`);
    await expect(canvas(page, 0)).toBeVisible();
    expect(server.requests).toMatchObject([{ partial: false, bytesSent: bytes.length, cancelled: false }]);
  } finally { await server.close(); }
});

for (const fault of ['full response', 'wrong offset', 'wrong total', 'encoding', 'etag', 'last modified', 'short body', 'long body']) {
  test(`rejects an invalid PDF range and retries the affected page (${fault})`, async ({ page }) => {
    const { bytes, offset, match } = createPdfSearchRangeFixture();
    let inject = true;
    const holdBody = fault !== 'encoding' && fault !== 'short body' && fault !== 'long body';
    const coversMarker = ({ begin, end }: { begin: number; end: number }) => begin <= offset && offset < end;
    const server = await servePdfFixture(bytes, { rangeResponse: ({ begin, end }: { begin: number; end: number }) => {
      if (!inject || !coversMarker({ begin, end })) return;
      switch (fault) {
        case 'full response': return { status: 200, headers: { 'Content-Range': undefined, 'Content-Length': bytes.length }, body: bytes };
        case 'wrong offset': return { headers: { 'Content-Range': `bytes ${begin + 1}-${end}/${bytes.length}` } };
        case 'wrong total': return { headers: { 'Content-Range': `bytes ${begin}-${end - 1}/${bytes.length + 1}` } };
        case 'encoding': return {
          headers: { 'Content-Encoding': 'gzip', 'Content-Length': undefined },
          body: gzipSync(bytes.subarray(begin, end))
        };
        case 'etag': return { headers: { ETag: '"fixture-v2"' } };
        case 'last modified': return { headers: { 'Last-Modified': 'Thu, 02 Jan 2020 00:00:00 GMT' } };
        case 'short body': return { headers: { 'Content-Length': undefined }, body: bytes.subarray(begin, end - 1) };
        case 'long body': return { headers: { 'Content-Length': undefined }, body: bytes.subarray(begin, end + 1) };
      }
    } });
    // Firefox can wait for body data before exposing a response to Fetch.
    if (holdBody) server.pauseRanges(offset, 1);
    const requests = () => server.requests.filter(request => request.partial && coversMarker(request));
    const errors: string[] = [];
    page.on('pageerror', error => errors.push(error.message));
    try {
      await page.goto(`./?url=${encodeURIComponent(server.url)}&lang=en`);
      await expect(canvas(page, 0)).toBeInViewport();
      const grid = page.locator('.pdfv-preview');
      await grid.evaluate(element => { element.scrollTop = element.scrollHeight * 5 / 12; });
      const slot = grid.locator('.pdfv-page-slot[data-page-index="5"]');
      const retry = slot.getByRole('button', { name: 'Retry (Page 6)' });
      await expect(retry).toBeInViewport();
      await expect(canvas(page, 5)).toHaveCount(0);
      if (holdBody) await expect.poll(() => requests()[0]).toMatchObject({ cancelled: true, bytesSent: 1 });
      expect(requests()).toHaveLength(1);
      expect(server.requests.filter(request => !request.partial)).toHaveLength(1);
      inject = false;
      server.resumeRanges();
      await retry.click();
      await expect(canvas(page, 5)).toBeInViewport();
      await expect(slot.locator('.pdfv-text-layer[data-rendered="true"]')).toHaveText(match);
      await expect(retry).toHaveCount(0);
      expect(requests()).toHaveLength(2);
      expect(errors).toEqual([]);
    } finally { await server.close(); }
  });
}

test('reports an invalid PDF range during startup and releases its response body', async ({ page }) => {
  const server = await servePdfFixture(bytes, { rangeResponse: () => ({ status: 200 }) });
  server.pauseRanges('all', 1);
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  try {
    await page.goto(`./?url=${encodeURIComponent(server.url)}&lang=en`);
    await expect(page.locator('.wb-status')).toHaveText('Preview failed');
    await expect(page.getByRole('alert')).toContainText('Invalid PDF byte range response.');
    const partial = server.requests.filter(request => request.partial);
    expect(partial.length).toBeGreaterThan(0);
    await expect.poll(() => partial.every(request => request.cancelled && request.bytesSent === 1)).toBe(true);
    expect(server.requests.filter(request => !request.partial)).toHaveLength(1);
    expect(errors).toEqual([]);
  } finally { await server.close(); }
});

test('keeps PDF ranges usable when CORS hides the Content-Range header', async ({ page }) => {
  const server = await servePdfFixture(bytes, { rangeResponse: () => ({
    headers: { 'Access-Control-Expose-Headers': 'Accept-Ranges, Content-Encoding, ETag' }
  }) });
  try {
    await page.goto(`./?url=${encodeURIComponent(server.url)}&lang=en`);
    await expect(canvas(page, 0)).toBeInViewport();
    await scrollToPage(page, 300);
    await expect(canvas(page, 300)).toBeInViewport();
    expect(server.requests.filter(request => !request.partial)).toHaveLength(1);
    expect(server.requests.reduce((sum, request) => sum + request.bytesSent, 0)).toBeLessThan(bytes.length / 2);
  } finally { await server.close(); }
});

test('loads distant pages and searches a large PDF across disjoint byte ranges', async ({ page }) => {
  const small = Buffer.from(createPdfFixture(8)).toString('latin1');
  const split = small.indexOf('\n8 0 obj\n') + 1;
  const xref = Number(/startxref\s+(\d+)/.exec(small)![1]);
  const unused = Number(/xref\n0 (\d+)/.exec(small)![1]);
  const paddingSize = 24 * 1024 * 1024;
  const padding = Buffer.concat([Buffer.from(`${unused} 0 obj\n<< /Length ${paddingSize} >>\nstream\n`),
    Buffer.alloc(paddingSize), Buffer.from('\nendstream\nendobj\n')]);
  const gap = padding.length;
  const tail = small.slice(xref).replace(/^(\d{10})( \d{5} n )$/gm, (_, offset, flag) =>
    String(Number(offset) + (Number(offset) >= split ? gap : 0)).padStart(10, '0') + flag)
    .replace(`xref\n0 ${unused}`, `xref\n0 ${unused + 1}`)
    .replace(`trailer\n<< /Size ${unused}`, `${String(split).padStart(10, '0')} 00000 n \ntrailer\n<< /Size ${unused + 1}`)
    .replace(/startxref\s+\d+/, `startxref\n${xref + gap}`);
  const large = Buffer.concat([Buffer.from(small.slice(0, split)), padding,
    Buffer.from(small.slice(split, xref) + tail)]);
  const server = await servePdfFixture(large);
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  try {
    await page.goto(`./?url=${encodeURIComponent(server.url)}&lang=zh`);
    await expect(canvas(page, 0)).toBeVisible();
    await expect(page.locator('.pdfv-text-layer')).toContainText('Document page 1');
    await page.locator('.pdfv-search-controls summary').click();
    const input = page.getByRole('searchbox', { name: '在文档中查找', exact: true });
    await input.fill('Document page 8');
    await input.press('Enter');
    await expect(page.locator('.pdfv-search-controls output')).toHaveText('1 / 1');
    await expect(page.locator('.pdfv-search-match.is-active')).toHaveText('Document page 8');
    await expect(canvas(page, 7)).toBeVisible();
    expect(server.requests.some(request => request.partial && request.begin >= paddingSize)).toBe(true);
    expect(server.requests.reduce((total, request) => total + request.bytesSent, 0)).toBeLessThan(1024 * 1024);
    expect(errors).toEqual([]);
  } finally { await server.close(); }
});
