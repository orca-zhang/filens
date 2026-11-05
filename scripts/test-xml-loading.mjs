// Browser checks against both built standalone runtimes, including actual chunk requests.
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import JSZip from 'jszip';
import { chromium, expect } from '@playwright/test';
import { createWorkbookFixture } from '../packages/xlsx/test/fixtures/workbook.mjs';

const original = await readFile('apps/demo/public/samples/sample-deck.pptx');
const fixtures = {};
for (const fallback of [false, true]) {
  const zip = await JSZip.loadAsync(original), file = zip.file('ppt/slides/slide1.xml');
  let xml = (await file.async('string')).replace(/<a:t>[^<]*<\/a:t>/, `<a:t>${fallback ? '&preview;' : 'Ordinary XML marker'}</a:t>`);
  if (fallback) xml = xml.replace(/(<\?xml[^?]*\?>)?/, '$&<!DOCTYPE p:sld [<!ENTITY preview "Fallback XML marker">]>');
  zip.file(file.name, xml, { date: file.date });
  fixtures[fallback ? 'fallback' : 'ordinary'] = [...await zip.generateAsync({ type: 'uint8array', compression: 'DEFLATE' })];
}
fixtures.xlsx = [...await createWorkbookFixture()];
const browser = await chromium.launch(), reports = [];
try {
  for (const variant of ['split', 'all-in-one']) for (const first of ['xlsx', 'fallback']) {
    const directory = path.resolve(`packages/preview/dist/${variant}`), page = await browser.newPage();
    const errors = [], requested = [];
    let release, holdXml = variant === 'split';
    const held = new Promise(resolve => { release = resolve; });
    page.on('pageerror', error => errors.push(error.message));
    await page.route('http://localhost/**', async route => {
      const pathname = new URL(route.request().url()).pathname;
      if (pathname === '/') return route.fulfill({ contentType: 'text/html', body: '<!doctype html><div id="host" style="width:800px;height:600px"></div>' });
      requested.push(pathname);
      if (holdXml && /\/xml-compat-/.test(pathname)) await held;
      const file = path.resolve(directory, '.' + pathname); assert(file.startsWith(directory + path.sep));
      await route.fulfill({ contentType: pathname.endsWith('.js') ? 'text/javascript' : 'application/octet-stream', body: await readFile(file) });
    });
    try {
      await page.goto('http://localhost/');
      await page.evaluate(async () => {
        const { createPreview } = await import('/filens.js'); window.previewErrors = [];
        window.viewer = createPreview('#host', { src: new TextEncoder().encode('Initial text'), name: 'initial.txt', toolbar: false,
          onError: error => window.previewErrors.push(error.message) });
      });
      await expect(page.locator('#host')).toContainText('Initial text');
      await page.evaluate(() => window.viewer.update({ src: new TextEncoder().encode('CSV marker,42'), name: 'simple.csv' }));
      await expect(page.locator('.xlsxv-table')).toContainText('CSV marker');
      await page.evaluate(bytes => window.viewer.update({ src: new Uint8Array(bytes), name: 'ordinary.pptx' }), fixtures.ordinary);
      await expect(page.locator('.pptxv-slide').first()).toContainText('Ordinary XML marker');
      assert(!requested.some(file => /\/xml-compat-/.test(file)), 'XML engine loaded for text/CSV/ordinary PPTX.');
      const open = async kind => {
        await page.evaluate(({ bytes, name }) => window.viewer.update({ src: new Uint8Array(bytes), name }),
          { bytes: fixtures[kind], name: kind === 'xlsx' ? 'workbook.xlsx' : 'fallback.pptx' });
      };
      await open(first);
      if (variant === 'split') {
        await expect.poll(() => requested.filter(file => /\/xml-compat-/.test(file)).length).toBe(1);
        await page.evaluate(() => window.viewer.update({ src: new TextEncoder().encode('Replacement text'), name: 'replacement.txt' }));
        await expect(page.locator('#host')).toContainText('Replacement text');
        holdXml = false; release();
        await open(first);
      }
      for (const kind of [first, first === 'xlsx' ? 'fallback' : 'xlsx']) {
        if (kind !== first) await open(kind);
        if (kind === 'fallback') await expect(page.locator('.pptxv-slide').first()).toContainText('Fallback XML marker');
        else {
          await expect(page.locator('tbody tr').first().locator('td')).toHaveText(['First 1', '7', '21']);
          await page.getByRole('button', { name: 'Second', exact: true }).click();
          await expect(page.locator('tbody tr').first().locator('td')).toHaveText(['Second 1', '7', '21']);
        }
      }
      assert.equal(requested.filter(file => /\/xml-compat-/.test(file)).length, variant === 'split' ? 1 : 0);
      assert.deepEqual(await page.evaluate(() => window.previewErrors), []);
      await page.evaluate(() => window.viewer.destroy());
      await expect(page.locator('#host')).toBeEmpty(); assert.deepEqual(errors, []);
      reports.push({ variant, first, deferredFor: ['text', 'CSV', 'ordinary PPTX'], fallback: true, xlsx: true,
        cancelledDuringImport: variant === 'split', xmlChunks: requested.filter(file => /\/xml-compat-/.test(file)), errors });
    } finally { release(); await page.close(); }
  }
  console.log(JSON.stringify({ browser: browser.version(), cases: reports }, null, 2));
} finally { await browser.close(); }
