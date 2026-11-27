import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { expect, test } from '@playwright/test';
import JSZip from 'jszip';
import { embeddedFontDeck } from '../../../packages/pptx/test/fixtures/embedded-font-deck';

const fontBytes = () => readFile(resolve('node_modules/pdfjs-dist/standard_fonts/LiberationSans-Bold.ttf'));
test.use({ reducedMotion: 'reduce' });

test('late stylesheet fonts refresh PPTX metrics in both viewers and preserve navigation', async ({ page }) => {
  const family = 'Late Deck Face';
  const deck = await JSZip.loadAsync(await embeddedFontDeck([{ family }]));
  const path = 'ppt/presentation.xml';
  deck.file(path, (await deck.file(path)!.async('string')).replace(/<p:embeddedFontLst>.*?<\/p:embeddedFontLst>/, ''));
  const bytes = await deck.generateAsync({ type: 'base64' });
  await page.route('**/late-deck.ttf', async route => route.fulfill({ body: await fontBytes(), contentType: 'font/ttf' }));
  await page.goto('./');
  const moduleUrl = new URL(`@fs${resolve('packages/pptx/src/index.ts')}`, page.url()).href;
  const before = await page.evaluate(async ({ moduleUrl, bytes }) => {
    const { createPptxPreviewDriver, createViewer } = await import(/* @vite-ignore */ moduleUrl);
    const hosts = [0, 1].map(() => {
      const host = document.createElement('div');
      host.style.cssText = 'width:610px;height:350px';
      document.body.append(host);
      return host;
    });
    const source = Uint8Array.from(atob(bytes), char => char.charCodeAt(0));
    const session = createPptxPreviewDriver().createSession(hosts[0], { fit: 'none' });
    const legacy = createViewer(hosts[1], { fit: 'none' });
    await Promise.all([session.load(source, { descriptor: { source } }), legacy.preview(source)]);
    session.setScale(1.25); legacy.setScale(1.25);
    session.goToPage(1); legacy.goToSlide(1);
    await new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
    const runs = () => hosts.map(host => host.querySelector('.pptxv-slide-shell[data-slide-index="1"] .pptxv-run')!);
    const scrolls = () => hosts.map(host => host.querySelector('.pptxv-scroll-area')!.scrollTop);
    const initial = runs(), widths = initial.map(run => run.getBoundingClientRect().width);
    (window as any).lateDeck = { session, legacy, initial, runs, scrolls };
    return { scrolls: scrolls(), widths, fonts: session.getState().fonts };
  }, { moduleUrl, bytes });
  expect(before.fonts).toContainEqual(expect.objectContaining({ fontFamily: family, status: 'missing' }));
  expect(before.scrolls.every(scroll => scroll > 0)).toBe(true);

  await page.addStyleTag({ content: `@font-face{font-family:"${family}";src:url("./late-deck.ttf")}` });
  await page.evaluate(family => document.fonts.load(`26px "${family}"`), family);
  await expect.poll(() => page.evaluate(() => (window as any).lateDeck.session.getState().fonts))
    .toContainEqual(expect.objectContaining({ fontFamily: family, status: 'available', source: 'environment' }));
  await expect.poll(() => page.evaluate(() => {
    const { initial, runs } = (window as any).lateDeck;
    return runs().map((run: Element, index: number) => run !== initial[index]);
  })).toEqual([true, true]);
  const after = await page.evaluate(() => {
    const { session, legacy, runs, scrolls } = (window as any).lateDeck;
    const metrics = { widths: runs().map((run: Element) => run.getBoundingClientRect().width), scrolls: scrolls(),
      page: session.getState().pageIndex, legacyPage: legacy.getState().currentSlide,
      scales: [session.getState().scale, legacy.getState().scale] };
    session.destroy(); legacy.destroy();
    return { ...metrics, retained: [...document.fonts].some(face => face.family.includes('Late Deck Face')) };
  });
  expect(after.widths.every((width: number, index: number) => Math.abs(width - before.widths[index]) > 1)).toBe(true);
  expect(after.scrolls.every((scroll: number, index: number) => Math.abs(scroll - before.scrolls[index]) <= 1)).toBe(true);
  expect(after).toMatchObject({ page: 1, legacyPage: 1, scales: [1.25, 1.25], retained: true });
});

test('refreshFonts updates a windowed XLSX after the host adds an already loaded face', async ({ page }) => {
  const family = 'Late Workbook Face';
  const zip = new JSZip();
  zip.file('xl/workbook.xml', '<workbook xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="Host fonts" sheetId="1" r:id="sheet"/></sheets></workbook>');
  zip.file('xl/_rels/workbook.xml.rels', '<Relationships><Relationship Id="sheet" Target="worksheets/sheet.xml"/></Relationships>');
  zip.file('xl/styles.xml', `<styleSheet><fonts><font><name val="${family}"/><sz val="13"/></font></fonts><cellXfs><xf fontId="0"/></cellXfs></styleSheet>`);
  zip.file('xl/worksheets/sheet.xml', `<worksheet><sheetFormatPr defaultColWidth="20"/><sheetData>${Array.from({ length: 600 }, (_, i) =>
    `<row r="${i + 1}"><c r="A${i + 1}" t="inlineStr"><is><t>Host metrics ${i + 1}</t></is></c></row>`).join('')}</sheetData></worksheet>`);
  const bytes = await zip.generateAsync({ type: 'base64' });
  await page.goto('./');
  const imports = ['packages/core/src/preview-runtime.ts', 'packages/xlsx/src/index.ts'].map(path => new URL(`@fs${resolve(path)}`, page.url()).href);
  const before = await page.evaluate(async ({ imports, bytes }) => {
    const { createPreviewer } = await import(/* @vite-ignore */ imports[0]);
    const { createXlsxPreviewDriver } = await import(/* @vite-ignore */ imports[1]);
    const host = document.createElement('div');
    host.style.cssText = 'width:490px;height:280px';
    document.body.append(host);
    const source = Uint8Array.from(atob(bytes), char => char.charCodeAt(0));
    const previewer = createPreviewer(host, { drivers: [createXlsxPreviewDriver()] });
    await previewer.preview(source, { name: 'host-fonts.xlsx' });
    const grid = host.querySelector('.xlsxv-grid')!;
    grid.scrollTop = 784;
    grid.dispatchEvent(new Event('scroll'));
    await new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
    const table = grid.querySelector('table')!, body = table.tBodies[0];
    const topRow = () => {
      const top = grid.getBoundingClientRect().top + table.tHead!.getBoundingClientRect().height + 1;
      return [...table.querySelectorAll('tbody tr[aria-rowindex]')].find(row => row.getBoundingClientRect().bottom > top)?.getAttribute('aria-rowindex');
    };
    (window as any).lateSheet = { previewer, grid, table, body, topRow };
    return { scrollTop: grid.scrollTop, row: topRow(), fonts: previewer.getState().fonts };
  }, { imports, bytes });
  expect(before.scrollTop).toBeGreaterThan(0);
  expect(Number(before.row)).toBeGreaterThan(1);
  expect(before.fonts).toContainEqual(expect.objectContaining({ fontFamily: family, status: 'missing' }));
  await page.evaluate(async ({ family, bytes }) => {
    const face = await new FontFace(family, Uint8Array.from(atob(bytes), char => char.charCodeAt(0))).load();
    document.fonts.add(face);
    (window as any).lateSheet.previewer.refreshFonts();
    (window as any).lateSheet.face = face;
  }, { family, bytes: (await fontBytes()).toString('base64') });
  const inventory = () => page.evaluate(() => (window as any).lateSheet.previewer.getState().fonts);
  await expect.poll(inventory).toContainEqual(expect.objectContaining({ fontFamily: family, status: 'available', source: 'environment' }));
  expect(await page.evaluate(() => {
    const { previewer, grid, table, body, face, topRow } = (window as any).lateSheet;
    const state = { row: topRow(), retainedTable: grid.querySelector('table') === table, changedRows: table.tBodies[0] !== body };
    previewer.destroy();
    return { ...state, retainedFont: document.fonts.has(face) };
  })).toEqual({ row: before.row, retainedTable: true, changedRows: true, retainedFont: true });
});
