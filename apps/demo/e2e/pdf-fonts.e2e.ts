import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import { createPdfFixture } from '../../../packages/pdf/test/fixtures/document.mjs';
import { createPdfFontInventoryFixture } from '../../../packages/pdf/test/fixtures/font-inventory.mjs';

const openFixture = async (page: Page, pageCount: number, sourceType: 'file' | 'bytes') => {
  const font = await readFile(resolve('node_modules/pdfjs-dist/standard_fonts/LiberationSans-Regular.ttf'));
  const bytes = createPdfFontInventoryFixture(font, pageCount).toString('base64');
  await page.goto('./');
  const moduleUrl = new URL(`@fs${resolve('packages/pdf/src/index.ts')}`, page.url()).href;
  await page.evaluate(async ({ moduleUrl, bytes, sourceType }) => {
    const { createPdfPreviewDriver } = await import(/* @vite-ignore */ moduleUrl);
    const host = document.createElement('div');
    host.id = 'pdf-font-test';
    host.style.cssText = 'position:fixed;inset:0;width:700px;height:550px;background:white';
    document.body.append(host);
    const input = Uint8Array.from(atob(bytes), character => character.charCodeAt(0));
    const name = 'font-inventory.pdf';
    const source = sourceType === 'file' ? new File([input], name, { type: 'application/pdf' }) : input;
    let wholeFileReads = 0;
    if (source instanceof File) {
      const read = source.arrayBuffer.bind(source);
      Object.defineProperty(source, 'arrayBuffer', { value: () => { wholeFileReads++; return read(); } });
    }
    const session = createPdfPreviewDriver().createSession(host, { fit: 'none' });
    const open = () => session.load(source, { descriptor: { source, name, extension: 'pdf' } });
    (window as any).pdfFontTest = { session, open, wholeFileReads: () => wholeFileReads };
    await open();
  }, { moduleUrl, bytes, sourceType });
};

const inventory = (page: Page) => page.evaluate(() => (window as any).pdfFontTest.session.getState().fonts);
const outline = { fontFamily: 'ABCDEF+LiberationSans', embedded: true, source: 'embedded', status: 'available' };
const standard = { fontFamily: 'Helvetica', source: 'unknown', status: 'unknown' };
const glyphPrograms = { fontFamily: 'monospace', embedded: true, source: 'embedded', status: 'available' };

test('discovers embedded PDF fonts only as their pages render and clears them on replacement', async ({ page }) => {
  await openFixture(page, 40, 'file');
  await expect.poll(() => inventory(page)).toEqual(expect.arrayContaining([
    expect.objectContaining(standard), expect.objectContaining(glyphPrograms)
  ]));
  expect(await inventory(page)).toHaveLength(2);
  await page.evaluate(() => (window as any).pdfFontTest.session.goToPage(39));
  await expect(page.locator('#pdf-font-test canvas[data-page-index="39"][data-rendered="true"]')).toBeVisible();
  await expect.poll(() => inventory(page)).toEqual(expect.arrayContaining([expect.objectContaining(outline)]));
  expect(await page.evaluate(() => (window as any).pdfFontTest.wholeFileReads())).toBe(0);

  const bytes = Buffer.from(createPdfFixture(1)).toString('base64');
  await page.evaluate(async bytes => {
    const { session } = (window as any).pdfFontTest;
    const source = Uint8Array.from(atob(bytes), character => character.charCodeAt(0));
    await session.load(source, { descriptor: { source, name: 'replacement.pdf', extension: 'pdf' } });
  }, bytes);
  await expect.poll(() => inventory(page)).toMatchObject([standard]);
  await page.evaluate(() => (window as any).pdfFontTest.session.destroy());
  expect(await inventory(page)).toEqual([]);
});

test('recovers the embedded font name when reopening cached first-page pixels', async ({ page }) => {
  await openFixture(page, 1, 'bytes');
  await expect.poll(() => inventory(page)).toEqual(expect.arrayContaining([expect.objectContaining(outline)]));
  const first = (await inventory(page)).find((font: { fontFamily?: string }) => font.fontFamily === outline.fontFamily);
  await page.evaluate(() => (window as any).pdfFontTest.open());
  await expect.poll(() => inventory(page)).toEqual(expect.arrayContaining([expect.objectContaining(outline)]));
  const second = (await inventory(page)).find((font: { fontFamily?: string }) => font.fontFamily === outline.fontFamily);
  expect(second.fontId).not.toBe(first.fontId);
  await expect(page.locator('#pdf-font-test .pdfv-text-layer[data-rendered="true"]')).toContainText('EMBEDDED');
  await page.evaluate(() => (window as any).pdfFontTest.session.destroy());
});
