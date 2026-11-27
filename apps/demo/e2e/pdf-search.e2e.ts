import { resolve } from 'node:path';
import { expect, test } from '@playwright/test';
import { createDensePdfSearchFixture, createPdfFixture } from '../../../packages/pdf/test/fixtures/document.mjs';
import { servePdfFixture } from '../../../packages/pdf/test/fixtures/range-source.mjs';
import { countNearbyPixels } from './screenshot-pixels';

for (const rotation of [0, 90]) test(`searches all PDF pages at rotation ${rotation} and preserves highlights through zoom`, async ({ page }) => {
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
  await page.goto('./');
  const moduleUrl = new URL(`@fs${resolve('packages/pdf/src/index.ts')}`, page.url()).href;
  const coreUrl = new URL(`@fs${resolve('packages/core/src/preview-runtime.ts')}`, page.url()).href;
  await page.evaluate(async ({ moduleUrl, coreUrl, bytes }) => {
    const { createPreviewer } = await import(/* @vite-ignore */ coreUrl);
    const { createPdfPreviewDriver } = await import(/* @vite-ignore */ moduleUrl);
    const host = document.createElement('div'); host.style.cssText = 'position:fixed;inset:0;width:800px;height:600px;background:white';
    document.body.replaceChildren(host);
    const session = createPreviewer(host, { drivers: [createPdfPreviewDriver()] });
    (window as any).pdfSearch = session;
    const source = new Uint8Array(bytes);
    await session.preview(source, { name: 'search.pdf', extension: 'pdf' });
    await session.find('PAGE 100');
  }, { moduleUrl, coreUrl, bytes: [...createPdfFixture(100, false, rotation)] });
  const active = page.locator('.pdfv-search-match.is-active');
  await expect(active).toHaveText('page 100');
  expect(await page.evaluate(() => (window as any).pdfSearch.getState().search)).toMatchObject({ total: 1, pagesScanned: 100, searching: false, truncated: false });
  expect(await page.locator('canvas').count()).toBeLessThanOrEqual(4);
  const original = (await active.elementHandle())!;
  await page.evaluate(() => (window as any).pdfSearch.setScale(1.5));
  await expect(page.locator('canvas[data-page-index="99"][data-rendered="true"]')).toHaveCount(1);
  await expect(active).toHaveText('page 100');
  expect(await active.evaluate((mark, original) => mark === original, original)).toBe(true);
  expect(await active.evaluate(element => element.getBoundingClientRect().height)).toBeGreaterThan(0);
  await expect(active).toBeInViewport({ ratio: 1 });
  await page.evaluate(async () => { await (window as any).pdfSearch.find('Document page'); (window as any).pdfSearch.findNext(true); });
  await expect(active).toHaveText('Document page');
  await expect(page.locator('.pdfv-page-slot[data-page-index="99"] .is-active')).toHaveCount(1);
  expect(await page.evaluate(() => (window as any).pdfSearch.getState().search)).toMatchObject({ total: 100, activeIndex: 99 });
  await page.evaluate(() => (window as any).pdfSearch.findNext());
  await expect(page.locator('.pdfv-page-slot[data-page-index="0"] .is-active')).toHaveCount(1);
  await page.evaluate(async () => { await (window as any).pdfSearch.find(''); });
  await expect(active).toHaveCount(0);
  expect(errors).toEqual([]);
});

test('highlights a phrase across actual PDF font-size runs and line breaks', async ({ page }) => {
  const source = createPdfFixture(1, false, 0, (_index: number, height: number) =>
    `1 1 1 rg BT /F1 24 Tf 40 ${height - 60} Td (Hello ) Tj /F1 18 Tf (world) Tj 0 -30 Td (search) Tj ET\n`);
  await page.goto('./?view=preview&lang=zh_CN');
  await page.getByLabel('导入文件', { exact: true }).setInputFiles({ name: 'split.pdf', mimeType: 'application/pdf', buffer: Buffer.from(source) });
  await expect(page.locator('.pdfv-text-layer[data-rendered="true"]')).toHaveCount(1);
  await page.locator('.pdfv-search-controls summary').click();
  const input = page.getByRole('searchbox', { name: '在文档中查找', exact: true });
  await input.fill('lo world'); await input.press('Enter');
  await expect(page.locator('.pdfv-search-controls output')).toHaveText('1 / 1');
  expect((await page.locator('.pdfv-search-match.is-active').allTextContents()).join('')).toBe('lo world');
  expect(await page.locator('.pdfv-search-match.is-active').count()).toBeGreaterThanOrEqual(2);
  await input.fill('world search'); await input.press('Enter');
  await expect(page.locator('.pdfv-search-controls output')).toHaveText('1 / 1');
  await expect.poll(async () => (await page.locator('.pdfv-search-match.is-active').allTextContents()).join('').replace(/\s/g, '')).toBe('worldsearch');
});

test('keeps PDF text and mark nodes when stepping through a dense page', async ({ page }) => {
  const bytes = createPdfFixture(1, false, 0, (_index: number, height: number) =>
    Array.from({ length: 600 }, (_, line) => {
      const label = line === 7 || line === 572 ? 'Matching item ' + line : 'Ordinary line ' + line;
      return `BT /F1 12 Tf 40 ${height - 50 - line % 26 * 18} Td (${label}) Tj ET\n`;
    }).join(''));
  await page.goto('./?view=preview&lang=zh_CN');
  await page.getByLabel('导入文件', { exact: true }).setInputFiles({ name: 'dense-search.pdf', mimeType: 'application/pdf', buffer: Buffer.from(bytes) });
  const layer = page.locator('.pdfv-text-layer[data-rendered="true"]');
  await expect(layer).toHaveCount(1);
  await layer.evaluate(element => {
    const ordinary = element.querySelector('span')!.firstChild!;
    Object.assign(window, { denseSearch: { ordinary, initialMarks: [] as Element[] } });
  });
  await page.locator('.pdfv-search-controls summary').click();
  const input = page.getByRole('searchbox', { name: '在文档中查找', exact: true });
  await input.fill('Matching item'); await input.press('Enter');
  const output = page.locator('.pdfv-search-controls output');
  await expect(output).toHaveText('1 / 2');
  await layer.evaluate(element => {
    const state = (window as any).denseSearch;
    state.initialMarks = [...element.querySelectorAll('mark')];
  });
  await page.getByRole('button', { name: '下一处匹配', exact: true }).click();
  await expect(output).toHaveText('2 / 2');
  expect(await layer.evaluate(element => {
    const { ordinary, initialMarks } = (window as any).denseSearch;
    const marks = [...element.querySelectorAll('mark')];
    return { sameText: element.querySelector('span')!.firstChild === ordinary,
      sameMarks: marks.length === 2 && marks.every((mark, index) => mark === initialMarks[index]),
      active: marks.map(mark => mark.classList.contains('is-active')) };
  })).toEqual({ sameText: true, sameMarks: true, active: [false, true] });
  await input.fill(''); await input.press('Enter');
  await expect(layer.locator('mark')).toHaveCount(0);
  expect(await layer.evaluate(element => element.querySelector('span')!.firstChild === (window as any).denseSearch.ordinary)).toBe(true);
});

for (const browserDefault of [true, false]) test(`keeps dense PDF search usable ${browserDefault ? 'with the browser default' : 'without custom highlights'}`, async ({ page, browserName }) => {
  if (!browserDefault) await page.addInitScript(() => Object.defineProperty(window, 'Highlight', { value: undefined, configurable: true }));
  const native = browserDefault && browserName === 'chromium';
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto('./');
  const moduleUrl = new URL(`@fs${resolve('packages/pdf/src/index.ts')}`, page.url()).href;
  const coreUrl = new URL(`@fs${resolve('packages/core/src/preview-runtime.ts')}`, page.url()).href;
  await page.evaluate(async ({ moduleUrl, coreUrl, bytes }) => {
    const { createPreviewer } = await import(/* @vite-ignore */ coreUrl);
    const { createPdfPreviewDriver } = await import(/* @vite-ignore */ moduleUrl);
    const host = document.createElement('div');
    host.style.cssText = 'position:fixed;inset:0;width:850px;height:550px';
    document.body.replaceChildren(host);
    const openViewer = async (target: HTMLElement) => {
      const viewer = createPreviewer(target, { drivers: [createPdfPreviewDriver()] });
      await viewer.preview(new Uint8Array(bytes), { name: 'dense.pdf', extension: 'pdf' });
      return viewer;
    };
    Object.assign(window, { denseViewer: await openViewer(host), openViewer });
  }, { moduleUrl, coreUrl, bytes: [...createDensePdfSearchFixture()] });
  const layer = page.locator('.pdfv-page-slot[data-page-index="0"] .pdfv-text-layer[data-rendered="true"]');
  await expect(layer).toHaveCount(1);
  await layer.evaluate(element => {
    const first = element.querySelector('span')!.firstChild!;
    const selection = window.getSelection()!;
    selection.setBaseAndExtent(first, 3, first, 0);
    Object.assign(window, { denseText: first });
  });
  const groups = () => page.evaluate(() => [
    CSS.highlights?.get('filens-pdf-search-match')?.size ?? 0,
    CSS.highlights?.get('filens-pdf-search-active')?.size ?? 0
  ]);
  const find = (query: string) => page.evaluate(text => (window as any).denseViewer.find(text), query);
  await find('x');
  expect(await page.evaluate(() => (window as any).denseViewer.getState().search)).toMatchObject({
    total: 10000, activeIndex: 0, pagesScanned: 1, truncated: true, searching: false
  });
  expect(await page.evaluate(() => {
    const selection = window.getSelection()!;
    return [selection.toString(), selection.getRangeAt(0).startContainer === selection.focusNode
      && selection.getRangeAt(0).startOffset === selection.focusOffset];
  })).toEqual(['X X', true]);
  if (native) {
    await expect.poll(groups).toEqual([9999, 1]);
    await expect(layer.locator('mark')).toHaveCount(0);
    expect(await layer.evaluate(element => {
      const { denseText } = window as any;
      return element.querySelector('span')!.firstChild === denseText && window.getSelection()?.anchorNode === denseText;
    })).toBe(true);
  } else {
    expect(await groups()).toEqual([0, 0]);
    await expect(layer.locator('mark')).toHaveCount(10000);
  }
  await page.evaluate(() => window.getSelection()!.removeAllRanges());
  const colorPoints = await layer.evaluate((element, native) => {
    const first = element.querySelector('span')!;
    if (!native) return [...first.querySelectorAll('mark')].slice(0, 2).map(mark => {
      const rect = mark.getBoundingClientRect();
      return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
    });
    return [0, 2].map(start => {
      const range = document.createRange();
      range.setStart(first.firstChild!, start);
      range.setEnd(first.firstChild!, start + 1);
      const rect = range.getBoundingClientRect();
      return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
    });
  }, native);
  await expect.poll(() => countNearbyPixels(page, colorPoints[0].x, colorPoints[0].y, [173, 104, 27], 20)).toBeGreaterThan(0);
  await expect.poll(() => countNearbyPixels(page, colorPoints[1].x, colorPoints[1].y, [138, 129, 69], 20)).toBeGreaterThan(0);
  await page.evaluate(() => (window as any).denseViewer.findNext(true));
  expect(await page.evaluate(() => (window as any).denseViewer.getState().search.activeIndex)).toBe(9999);
  if (native) {
    expect(await page.evaluate(() => {
      let piece: AbstractRange | undefined;
      CSS.highlights.get('filens-pdf-search-active')!.forEach(value => { piece = value; });
      const range = document.createRange();
      range.setStart(piece!.startContainer, piece!.startOffset); range.setEnd(piece!.endContainer, piece!.endOffset);
      const bounds = range.getBoundingClientRect();
      const viewport = document.querySelector('.pdfv-preview')!.getBoundingClientRect();
      return range.toString() === 'X' && bounds.bottom > viewport.top && bounds.top < viewport.bottom;
    })).toBe(true);
  } else {
    await expect(layer.locator('mark.is-active')).toBeInViewport();
  }
  await page.evaluate(() => (window as any).denseViewer.goToPage(11));
  await expect(layer).toHaveCount(0);
  expect(await groups()).toEqual([0, 0]);
  await page.evaluate(() => (window as any).denseViewer.goToPage(0));
  if (native) await expect.poll(groups).toEqual([9999, 1]);
  else await expect(layer.locator('mark')).toHaveCount(10000);
  const multiple = browserName === 'firefox';
  const selectedText = await layer.evaluate((element, multiple) => {
    const [first, second, third] = element.querySelectorAll('span');
    const selection = window.getSelection()!;
    selection.setBaseAndExtent(first, 0, second, 1);
    if (multiple) {
      const range = document.createRange();
      range.selectNodeContents(third);
      selection.addRange(range);
    }
    return Array.from({ length: selection.rangeCount }, (_, index) => selection.getRangeAt(index).toString());
  }, multiple);
  expect(selectedText).toHaveLength(multiple ? 2 : 1);
  await find('');
  expect(await page.evaluate(() => {
    const selection = window.getSelection()!;
    return Array.from({ length: selection.rangeCount }, (_, index) => selection.getRangeAt(index).toString());
  })).toEqual(selectedText);
  expect(await groups()).toEqual([0, 0]);
  await expect(layer.locator('mark')).toHaveCount(0);
  await find('x');
  if (native) {
    await page.evaluate(async () => {
      const host = document.createElement('div');
      host.style.cssText = 'position:fixed;left:0;top:0;width:850px;height:550px';
      document.body.append(host);
      const state = window as any;
      const other = await state.openViewer(host);
      state.otherDenseViewer = other;
      await other.find('x');
    });
    await expect.poll(groups).toEqual([19998, 2]);
  }
  await page.evaluate(() => (window as any).denseViewer.destroy());
  if (native) {
    expect(await groups()).toEqual([9999, 1]);
    await page.evaluate(() => (window as any).otherDenseViewer.destroy());
  }
  expect(await groups()).toEqual([0, 0]);
  expect(errors).toEqual([]);
});

for (const zoom of [false, true]) test(zoom
  ? 'preserves streamed PDF text and its reader through zoom and search before the page is complete'
  : 'renders PDF text chunks before the page is complete and cancels them when leaving it', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  const index = 5;
  const bytes = createPdfFixture(18, false, zoom ? 90 : 0, (pageIndex: number, height: number) => {
    if (pageIndex !== index) return `BT /F1 18 Tf 40 ${height - 50} Td (Unrelated page) Tj ET\n`;
    return Array.from({ length: 240 }, (_, line) => {
      const label = line === 0 ? 'First streamed line' : line === 239 ? 'Last streamed line' : `Content line ${line}`;
      return `BT /F1 14 Tf 40 ${height - 50 - line % 20 * 22} Td (${label}) Tj ET\n`;
    }).join('');
  }, 0, 60, zoom ? 2 : 1);
  await page.goto('./');
  const moduleUrl = new URL(`@fs${resolve('packages/pdf/src/index.ts')}`, page.url()).href;
  await page.evaluate(async ({ moduleUrl, bytes, index }) => {
    const { PdfPreviewSession } = await import(/* @vite-ignore */ moduleUrl);
    const host = document.createElement('div');
    host.style.cssText = 'position:fixed;width:800px;height:600px';
    document.body.replaceChildren(host);
    const session = new PdfPreviewSession(host);
    const source = new Uint8Array(bytes);
    await session.load(source, { descriptor: { source, name: 'streamed-selection.pdf' } });
    const proxy = await (session as any).document.getPage(index + 1);
    const openText = proxy.streamTextContent.bind(proxy);
    const selection = { waiting: false, released: false, opens: 0,
      stream: undefined as ReadableStream | undefined, resume: undefined as (() => void) | undefined };
    Object.assign(window, { pdfSearch: session, pdfSearchHost: host, selection });
    proxy.streamTextContent = () => {
      if (selection.opens++) return openText();
      const upstream = openText().getReader();
      let sent = false, resumed = false, cancelled = false;
      selection.stream = new ReadableStream({
        async pull(controller) {
          if (sent && !resumed) {
            selection.waiting = true;
            await new Promise<void>(resolve => {
              selection.resume = () => { resumed = true; resolve(); };
            });
            if (cancelled) return;
          }
          const { value, done } = await upstream.read();
          if (cancelled) return;
          if (done) {
            upstream.releaseLock();
            selection.released = true;
            controller.close();
          }
          else { sent = true; controller.enqueue(value); }
        },
        cancel(reason) {
          cancelled = true;
          selection.resume?.();
          void upstream.cancel(reason).catch(() => {});
          upstream.releaseLock();
          selection.released = !upstream.locked;
          // Match PDF.js when the worker sink is already closed and sends no acknowledgment.
          return new Promise<void>(() => {});
        }
      }, { highWaterMark: 0 });
      return selection.stream;
    };
    session.goToPage(index);
  }, { moduleUrl, bytes: [...bytes], index });
  const slot = page.locator(`.pdfv-page-slot[data-page-index="${index}"]`);
  const text = slot.locator('.pdfv-text-layer');
  await expect.poll(() => page.evaluate(() => (window as any).selection.waiting)).toBe(true);
  await expect(text).toContainText('First streamed line');
  await expect(text).not.toContainText('Last streamed line');
  await expect(text).not.toHaveAttribute('data-rendered', 'true');
  if (zoom) {
    const first = text.getByText('First streamed line', { exact: true });
    const original = (await first.elementHandle())!, before = (await first.boundingBox())!;
    await first.evaluate(el => {
      const range = document.createRange();
      range.selectNodeContents(el);
      const selection = window.getSelection()!;
      selection.removeAllRanges(); selection.addRange(range);
      (window as any).pdfSearch.setScale(1.25);
    });
    const raster = slot.locator('canvas[data-rendered="true"]');
    await expect(raster).toHaveCount(1);
    await page.evaluate(() => (window as any).pdfSearch.setScale(1.5));
    await expect.poll(async () => (await first.boundingBox())?.height ?? 0).toBeCloseTo(before.height * 1.5, 0);
    await page.evaluate(() => {
      (window as any).pdfSearch.fit('width');
      (window as any).pdfSearchHost.style.width = '640px';
    });
    await expect.poll(() => page.locator('.pdfv-preview').evaluate(el => {
      const canvas = el.querySelector<HTMLCanvasElement>('canvas[data-rendered="true"]');
      return canvas ? Math.abs(parseFloat(canvas.style.width) - el.clientWidth * 1.5) : Infinity;
    })).toBeLessThan(1);
    await expect(text).not.toHaveAttribute('data-rendered', 'true');
    expect(await first.evaluate((el, original) => ({
      same: el === original, selected: window.getSelection()?.toString(),
      opens: (window as any).selection.opens, cancelled: (window as any).selection.released
    }), original)).toEqual({ same: true, selected: 'First streamed line', opens: 1, cancelled: false });
    const searching = () => page.evaluate(() => (window as any).pdfSearch.getState().search);
    await page.evaluate(() => {
      const state = (window as any).selection;
      void (window as any).pdfSearch.find('absent query').then(() => { state.searchSettled = true; });
    });
    await expect.poll(searching).toMatchObject({ searching: true, pagesScanned: index });
    await page.evaluate(() => (window as any).pdfSearch.find(''));
    await expect.poll(() => page.evaluate(() => (window as any).selection.searchSettled)).toBe(true);
    expect(await page.evaluate(() => (window as any).selection.stream.locked)).toBe(true);
    await page.evaluate(() => { void (window as any).pdfSearch.find('Last streamed line'); });
    await expect.poll(searching).toMatchObject({ searching: true, pagesScanned: index });
    expect(await page.evaluate(() => (window as any).selection.opens)).toBe(1);
    await page.evaluate(() => (window as any).selection.resume());
    await expect(text).toHaveAttribute('data-rendered', 'true');
    await expect.poll(searching).toMatchObject({ total: 1, searching: false });
    await expect(slot.locator('.pdfv-search-match.is-active')).toHaveText('Last streamed line');
    expect(await first.evaluate((el, original) => el === original, original)).toBe(true);
    expect(await page.evaluate(() => !(window as any).selection.stream.locked)).toBe(true);
  } else {
    await page.evaluate(() => (window as any).pdfSearch.goToPage(15));
    await expect(slot).toHaveCount(0);
    await expect.poll(() => page.evaluate(() => {
      const selection = (window as any).selection;
      return selection.released && !selection.stream.locked;
    })).toBe(true);
    await page.evaluate(index => (window as any).pdfSearch.goToPage(index), index);
  }
  await expect(text).toHaveAttribute('data-rendered', 'true');
  await expect(text).toContainText('Last streamed line');
  const reads = await page.evaluate(async index => {
    const session = (window as any).pdfSearch;
    const pages = await Promise.all([index + 1, 1].map(number => session.document.getPage(number)));
    const reads = [0, 0];
    for (const [i, proxy] of pages.entries()) {
      const open = proxy.streamTextContent.bind(proxy);
      proxy.streamTextContent = () => { reads[i]++; return open(); };
    }
    await session.find('Last streamed line');
    return reads;
  }, index);
  expect(reads).toEqual([0, zoom ? 0 : 1]);
  await expect(slot.locator('.pdfv-search-match.is-active')).toHaveText('Last streamed line');
  expect(errors).toEqual([]);
});

test('clears a PDF search while the worker waits for a page content range', async ({ page }) => {
  const padding = '% padding inside the page stream\n'.repeat(12_000);
  const marker = 'held content range';
  const bytes = Buffer.from(createPdfFixture(12, false, 0, (index: number, height: number) =>
    (index === 5 ? `${padding}% ${marker}\n${padding}` : '')
      + `BT /F1 24 Tf 40 ${height - 60} Td (Document page ${index + 1}) Tj ET\n`));
  const offset = bytes.indexOf(marker);
  const server = await servePdfFixture(bytes);
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  const held = () => server.requests.find(request => request.partial && request.begin <= offset && request.end > offset);
  try {
    server.pauseRanges(offset);
    await page.goto('./');
    const moduleUrl = new URL(`@fs${resolve('packages/pdf/src/index.ts')}`, page.url()).href;
    await page.evaluate(async ({ moduleUrl, url }) => {
      const { PdfPreviewSession } = await import(/* @vite-ignore */ moduleUrl);
      const host = document.createElement('div'); host.style.cssText = 'position:fixed;width:800px;height:600px';
      document.body.replaceChildren(host);
      const session = new PdfPreviewSession(host);
      await session.load(url, { descriptor: { source: url, name: 'search.pdf' } });
      const searchProgress: number[] = [];
      session.on('statechange', ({ search }) => { if (search?.searching) searchProgress.push(search.pagesScanned); });
      Object.assign(window, { pdfSearch: session, searchProgress, searchSettled: false });
      void session.find('missing phrase').then(() => { (window as any).searchSettled = true; });
    }, { moduleUrl, url: server.url });
    await expect.poll(() => held()?.bytesSent).toBe(0);
    await expect.poll(() => page.evaluate(() => (window as any).searchProgress.at(-1))).toBe(5);
    expect(await page.evaluate(() => (window as any).pdfSearch.getState().search)).toMatchObject({ pagesScanned: 5, searching: true });
    await page.evaluate(() => (window as any).pdfSearch.find(''));
    await expect.poll(() => page.evaluate(() => (window as any).searchSettled)).toBe(true);
    expect(await page.evaluate(() => (window as any).pdfSearch.getState().search)).toMatchObject({ query: '', total: 0, searching: false });
    await page.evaluate(() => (window as any).pdfSearch.destroy());
    await expect.poll(() => held()?.cancelled).toBe(true);
    expect(errors).toEqual([]);
  } finally { await server.close(); }
});

test('reuses offscreen text when searching an HTTP range-backed PDF again', async ({ page }) => {
  const pages = 600;
  const server = await servePdfFixture(Buffer.from(createPdfFixture(pages, false, 0, undefined, 20, 20)));
  await page.addInitScript(() => {
    const pageReads: number[] = [], post = Worker.prototype.postMessage;
    Object.assign(window, { pageReads });
    Worker.prototype.postMessage = function (message) {
      if (message?.action === 'GetTextContent') pageReads.push(message.data.pageIndex);
      return Reflect.apply(post, this, arguments);
    };
  });
  try {
    await page.goto('./');
    const moduleUrl = new URL(`@fs${resolve('packages/pdf/src/index.ts')}`, page.url()).href;
    await page.evaluate(async ({ moduleUrl, url }) => {
      const { PdfPreviewSession } = await import(/* @vite-ignore */ moduleUrl);
      const host = document.createElement('div'); host.style.cssText = 'position:fixed;width:800px;height:600px';
      document.body.replaceChildren(host);
      const session = new PdfPreviewSession(host);
      Object.assign(window, { pdfSearch: session });
      await session.load(url, { descriptor: { source: url, name: 'repeat-search.pdf' } });
    }, { moduleUrl, url: server.url });
    await expect(page.locator('.pdfv-text-layer[data-rendered="true"]')).toBeVisible();
    const result = await page.evaluate(async () => {
      const { pdfSearch, pageReads } = window as any;
      pageReads.length = 0;
      await pdfSearch.find('first missing term');
      const first = [...pageReads];
      pageReads.length = 0;
      await pdfSearch.find('second missing term');
      return { first, second: pageReads.length, search: pdfSearch.getState().search };
    });
    expect(result.first).toContain(pages - 1);
    expect(result.first.length).toBeGreaterThanOrEqual(pages - 2);
    expect(result.second).toBe(0);
    expect(result.search).toMatchObject({ total: 0, pagesScanned: pages, searching: false });
    expect(server.requests.some(request => request.partial)).toBe(true);
    await page.evaluate(() => (window as any).pdfSearch.find('page 600'));
    await expect(page.locator('.pdfv-page-slot[data-page-index="599"] mark.is-active')).toHaveText('page 600');
    await page.evaluate(() => (window as any).pdfSearch.destroy());
  } finally { await server.close(); }
});

test('finds visible PDF text while an earlier page is waiting for bytes', async ({ page }) => {
  const padding = `% ${'x'.repeat(8192)}\n`.repeat(12);
  const text = ['Opening page', 'Held needle', 'Visible needle', 'Other text', 'Another needle'];
  const bytes = Buffer.from(createPdfFixture(text.length, false, 0, (index: number) =>
    `${padding}% Page ${index + 1} midpoint\n${padding}BT /F1 24 Tf 40 740 Td (${text[index]}) Tj ET\n`, 4, 0));
  const offset = bytes.indexOf('% Page 2 midpoint');
  const server = await servePdfFixture(bytes);
  server.pauseRanges(offset);
  const held = () => server.requests.find(request => request.partial && request.begin <= offset && request.end > offset);
  try {
    await page.goto('./');
    const moduleUrl = new URL(`@fs${resolve('packages/pdf/src/index.ts')}`, page.url()).href;
    await page.evaluate(async ({ moduleUrl, source }) => {
      const { PdfPreviewSession } = await import(/* @vite-ignore */ moduleUrl);
      const host = document.createElement('div');
      host.style.cssText = 'position:fixed;width:800px;height:600px';
      document.body.replaceChildren(host);
      const session = new PdfPreviewSession(host, { fit: 'none', initialScale: .1 });
      Object.assign(window, { pdfSearch: session, searchSettled: false });
      await session.load(source, { descriptor: { source, name: 'visible-search.pdf' } });
    }, { moduleUrl, source: server.url });
    await expect.poll(() => held()?.bytesSent).toBe(0);
    await expect(page.locator('.pdfv-page-slot[data-page-index="2"] .pdfv-text-layer[data-rendered="true"]')).toHaveText(text[2]);
    await expect(page.locator('.pdfv-page-slot[data-page-index="4"] .pdfv-text-layer[data-rendered="true"]')).toHaveText(text[4]);
    await page.evaluate(() => {
      void (window as any).pdfSearch.find('needle').then(() => { (window as any).searchSettled = true; });
    });
    const active = page.locator('.pdfv-search-match.is-active');
    await expect(page.locator('.pdfv-page-slot[data-page-index="2"]').locator(active)).toHaveText('needle');
    const search = () => page.evaluate(() => (window as any).pdfSearch.getState().search);
    await expect.poll(search).toMatchObject({ total: 2, activeIndex: 0, searching: true });
    await page.evaluate(() => (window as any).pdfSearch.findNext());
    await expect(page.locator('.pdfv-page-slot[data-page-index="4"]').locator(active)).toHaveText('needle');
    expect(held()?.bytesSent).toBe(0);
    server.resumeRanges();
    await expect.poll(() => page.evaluate(() => (window as any).searchSettled)).toBe(true);
    expect(await search()).toMatchObject({ total: 3, activeIndex: 2, pagesScanned: text.length, searching: false });
    await expect(page.locator('.pdfv-page-slot[data-page-index="4"]').locator(active)).toHaveText('needle');
    await page.evaluate(() => (window as any).pdfSearch.findNext());
    await expect(page.locator('.pdfv-page-slot[data-page-index="1"]').locator(active)).toHaveText('needle');
    await page.evaluate(() => (window as any).pdfSearch.find(''));
    await expect(active).toHaveCount(0);
    await page.evaluate(() => (window as any).pdfSearch.destroy());
  } finally { await server.close(); }
});

test('adds PDF results after navigating while an earlier range remains paused', async ({ page }) => {
  const padding = `% ${'x'.repeat(8192)}\n`.repeat(12);
  const bytes = Buffer.from(createPdfFixture(12, false, 0, (index: number) => {
    const text = [1, 6, 10].includes(index) ? `Needle on page ${index + 1}` : `Document page ${index + 1}`;
    return `${padding}% Page ${index + 1} midpoint\n${padding}BT /F1 24 Tf 40 740 Td (${text}) Tj ET\n`;
  }, 4, 0));
  const offset = bytes.indexOf('% Page 2 midpoint');
  const server = await servePdfFixture(bytes);
  server.pauseRanges(offset);
  const held = () => server.requests.find(request => request.partial && request.begin <= offset && request.end > offset);
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  try {
    await page.goto('./');
    const moduleUrl = new URL(`@fs${resolve('packages/pdf/src/index.ts')}`, page.url()).href;
    await page.evaluate(async ({ moduleUrl, source }) => {
      const { PdfPreviewSession } = await import(/* @vite-ignore */ moduleUrl);
      const host = document.createElement('div');
      host.style.cssText = 'position:fixed;width:800px;height:600px';
      document.body.replaceChildren(host);
      const session = new PdfPreviewSession(host, { fit: 'none', initialScale: .75 });
      Object.assign(window, { pdfSearch: session, searchSettled: false });
      await session.load(source, { descriptor: { source, name: 'new-visible-results.pdf' } });
      void session.find('needle').then(() => { (window as any).searchSettled = true; });
    }, { moduleUrl, source: server.url });
    const search = () => page.evaluate(() => (window as any).pdfSearch.getState().search);
    const matches = (index: number, active = false) => page.locator(
      `.pdfv-page-slot[data-page-index="${index}"] .pdfv-search-match${active ? '.is-active' : ''}`);
    await expect.poll(() => held()?.bytesSent).toBe(0);
    await expect.poll(search).toMatchObject({ total: 0, pagesScanned: 1, searching: true });
    await page.evaluate(() => (window as any).pdfSearch.goToPage(10));
    await expect(matches(10, true)).toHaveText('Needle');
    await page.evaluate(() => {
      const session = (window as any).pdfSearch;
      session.findNext();
      session.goToPage(6);
    });
    await expect(matches(6)).toHaveText('Needle');
    await expect.poll(search).toMatchObject({ total: 2, activeIndex: 1, searching: true });
    expect(held()?.bytesSent).toBe(0);
    server.resumeRanges();
    await expect.poll(() => page.evaluate(() => (window as any).searchSettled)).toBe(true);
    expect(await search()).toMatchObject({ total: 3, activeIndex: 2, pagesScanned: 12, searching: false });
    await page.evaluate(() => (window as any).pdfSearch.findNext());
    await expect(matches(1, true)).toHaveText('Needle');
    await page.evaluate(() => (window as any).pdfSearch.destroy());
    expect(errors).toEqual([]);
  } finally { await server.close(); }
});

test('exposes localized find controls with keyboard navigation, clearing and source cleanup', async ({ page }) => {
  await page.goto('./?view=preview&lang=zh_CN');
  await page.getByLabel('导入文件', { exact: true }).setInputFiles({ name: 'search.pdf', mimeType: 'application/pdf', buffer: Buffer.from(createPdfFixture(100)) });
  await expect(page.locator('canvas.pdfv-page[data-rendered="true"]').first()).toBeVisible();
  await page.locator('.pdfv-preview').focus();
  await page.keyboard.press('Control+f');
  const input = page.getByRole('searchbox', { name: '在文档中查找', exact: true });
  await expect(input).toBeFocused();
  await input.fill('Document page'); await input.press('Enter');
  const output = page.locator('.pdfv-search-controls output');
  await expect(output).toHaveText('1 / 100');
  await page.getByRole('button', { name: '下一处匹配', exact: true }).click();
  await expect(output).toHaveText('2 / 100');
  await input.press('Shift+Enter'); await expect(output).toHaveText('1 / 100');
  await page.getByRole('button', { name: '上一处匹配', exact: true }).click();
  await expect(output).toHaveText('100 / 100');
  await expect(page.locator('.pdfv-page-slot[data-page-index="99"] .is-active')).toHaveCount(1);
  await input.fill('no match'); await input.fill('page 100');
  await expect(output).toHaveText('1 / 1');
  await page.getByRole('button', { name: 'Switch to English', exact: true }).click();
  const englishInput = page.getByRole('searchbox', { name: 'Find in document', exact: true });
  await expect(englishInput).toHaveValue('page 100');
  await expect(output).toHaveText('1 / 1');
  await expect(page.locator('.pdfv-search-match.is-active')).toHaveText('page 100');
  await englishInput.press('Escape');
  await expect(page.locator('.pdfv-search-controls')).not.toHaveAttribute('open');
  await expect(page.locator('.pdfv-search-match')).toHaveCount(0);
  await page.getByRole('button', { name: 'CSV', exact: true }).click();
  await expect(page.locator('.xlsxv-table')).toBeVisible();
  await expect(page.locator('.pdfv-search-controls')).toHaveCount(0);
});
