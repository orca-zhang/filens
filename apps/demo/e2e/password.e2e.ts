import { expect, test } from '@playwright/test';
import path from 'node:path';
import { createPdfFixture } from '../../../packages/pdf/test/fixtures/document.mjs';

const fixtures = path.resolve('packages/converter-client/test/fixtures/password');
const officePassword = ' filens 密码🔐 ';

test('previews an unencrypted legacy Office document without downloading the decryptor', async ({ page }) => {
  const officeRequests: string[] = [];
  page.on('request', request => { if (request.url().includes('converter-office.wasm')) officeRequests.push(request.url()); });
  await page.goto('./?view=preview&lang=zh_CN');
  await page.getByLabel('导入文件', { exact: true }).setInputFiles(path.resolve('examples/converter/fixtures/doc/sample.doc'));
  await expect(page.locator('section.docx').first()).toBeVisible();
  expect(officeRequests).toHaveLength(0);
});

for (const [fixture, selector, text, password] of [
  ['agile.docx', 'section.docx', 'Fixture DOCX document', officePassword],
  ['agile.xlsx', '.xlsxv-preview', 'Fixture XLSX workbook', officePassword],
  ['agile.pptx', '.pptxv-slide', 'Fixture PPTX presentation slide', officePassword],
  ['encrypted.pdf', 'canvas.pdfv-page[data-rendered="true"]', '', 'test123'],
  ['reference/ecma376standard_password.docx', 'section.docx', 'lorem ipsum', 'Password1234_']
]) {
  test(`opens encrypted ${fixture} after correcting a wrong password`, async ({ page }) => {
    const errors: string[] = [];
    const officeRequests: string[] = [];
    page.on('request', request => { if (request.url().includes('converter-office.wasm')) officeRequests.push(request.url()); });
    page.on('pageerror', error => errors.push(error.message));
    await page.goto('./?view=preview&lang=zh_CN');
    await page.getByLabel('导入文件', { exact: true }).setInputFiles(path.join(fixtures, fixture));
    const field = page.getByLabel('文档密码', { exact: true });
    await expect(field).toBeVisible();
    await expect(field).toBeFocused();
    expect(officeRequests).toHaveLength(0);
    await field.fill('wrong');
    await field.press('Enter');
    await expect(page.getByRole('alert')).toContainText('密码不正确，请重试。');
    await expect(field).toHaveValue('');
    await field.fill(password);
    await field.press('Enter');
    await expect(field).toHaveCount(0);
    await expect(page.locator(selector).first()).toBeVisible();
    if (text) await expect(page.locator(selector).first()).toContainText(text);
    await expect(page.locator('.wb-note.is-error')).toHaveCount(0);
    expect(errors).toEqual([]);
    expect(officeRequests).toHaveLength(fixture.endsWith('.pdf') ? 0 : 1);
  });
}

test('reopens a permission-only PDF without prompting or sharing its first-page raster', async ({ page }) => {
  await page.goto('./?view=preview&lang=zh_CN');
  const cacheUrl = new URL(`@fs${path.resolve('packages/pdf/src/page-cache.ts')}`, page.url()).href;
  await page.evaluate(async cacheUrl => {
    const { pdfPageCache } = await import(/* @vite-ignore */ cacheUrl);
    const activity = { reads: 0, writes: 0 };
    Object.assign(window, { pdfCacheActivity: activity });
    const { read, write } = pdfPageCache;
    pdfPageCache.read = (key: string, target: HTMLCanvasElement) => {
      activity.reads++;
      return read.call(pdfPageCache, key, target);
    };
    pdfPageCache.write = (key: string, source: HTMLCanvasElement) => {
      activity.writes++;
      write.call(pdfPageCache, key, source);
    };
  }, cacheUrl);
  const getActivity = () => page.evaluate(() => (window as Window & { pdfCacheActivity: { reads: number; writes: number } }).pdfCacheActivity);
  const upload = page.getByLabel('导入文件', { exact: true });
  const textLayer = page.locator('.pdfv-text-layer[data-rendered="true"]');
  await upload.setInputFiles({ name: 'plain.pdf', mimeType: 'application/pdf', buffer: Buffer.from(createPdfFixture(1)) });
  await expect(textLayer).toContainText('Document page 1');
  const plaintextActivity = await getActivity();
  expect(plaintextActivity.reads).toBeGreaterThan(0);
  expect(plaintextActivity.writes).toBeGreaterThan(0);

  for (let open = 0; open < 2; open++) {
    await upload.setInputFiles(path.join(fixtures, 'permissions-only.pdf'));
    await expect(page.locator('canvas.pdfv-page[data-rendered="true"]')).toBeVisible();
    await expect(textLayer).toContainText('Permission restricted PDF');
    await expect(page.getByLabel('文档密码', { exact: true })).toHaveCount(0);
    expect(await getActivity()).toEqual(plaintextActivity);
    await page.locator('.filens-attachments summary').click();
    await page.getByRole('button', { name: 'private-notes.pdf', exact: true }).click();
    await expect(page.locator('.filens-attachment-preview .pdfv-text-layer[data-rendered="true"]')).toContainText('Permission restricted attachment');
    expect(await getActivity()).toEqual(plaintextActivity);
    await upload.setInputFiles({ name: 'replacement.txt', mimeType: 'text/plain', buffer: Buffer.from('Replaced PDF') });
    await expect(page.locator('.wb-preview-stage')).toContainText('Replaced PDF');
    await expect(textLayer).toHaveCount(0);
  }
});

test('previews encrypted Numbers after a Unicode password retry and prompts again on reopening', async ({ page }) => {
  const workbook = path.resolve('packages/iwork/test/fixtures/password/encrypted-non-latin.numbers');
  const errors: Error[] = [];
  page.on('pageerror', error => errors.push(error));
  await page.goto('./?view=preview&lang=zh_CN');
  const upload = page.getByLabel('导入文件', { exact: true });
  const field = page.getByLabel('文档密码', { exact: true });
  const table = page.locator('.xlsxv-grid table').first();
  await upload.setInputFiles(workbook);
  await expect(field).toBeVisible();
  await expect(table).toHaveCount(0);
  await field.fill('错误密码');
  await field.press('Enter');
  await expect(page.getByRole('alert')).toContainText('密码不正确，请重试。');
  await field.fill('秘密');
  await field.press('Enter');
  await expect(table).toContainText('Decryption');
  await expect(field).toHaveCount(0);

  await upload.setInputFiles({ name: 'replacement.txt', mimeType: 'text/plain', buffer: Buffer.from('Replacement document') });
  await expect(page.locator('.wb-preview-stage')).toContainText('Replacement document');
  await expect(table).toHaveCount(0);
  await upload.setInputFiles(workbook);
  await expect(field).toBeVisible();
  await expect(field).toHaveValue('');
  await expect(table).toHaveCount(0);
  expect(errors).toEqual([]);
});

test('cancels password entry, reopens it and clears it when switching documents', async ({ page }) => {
  await page.goto('./?view=preview&lang=zh_CN');
  await page.getByLabel('导入文件', { exact: true }).setInputFiles(path.join(fixtures, 'agile.docx'));
  const field = page.getByLabel('文档密码', { exact: true });
  await expect(field).toBeVisible();
  await field.fill('secret that must be cleared');
  await page.getByRole('button', { name: '取消', exact: true }).click();
  await expect(field).toHaveCount(0);
  await page.getByRole('button', { name: '重新输入密码' }).click();
  await expect(field).toHaveValue('');
  await page.getByLabel('导入文件', { exact: true }).setInputFiles({ name: 'hello.txt', mimeType: 'text/plain', buffer: Buffer.from('A different document') });
  await expect(field).toHaveCount(0);
  await expect(page.locator('.wb-preview-stage')).toContainText('A different document');
  await page.getByLabel('导入文件', { exact: true }).setInputFiles(path.join(fixtures, 'agile.docx'));
  await expect(field).toHaveValue('');
});
