import { expect, test, type Page } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import JSZip from 'jszip';

const samples = path.resolve('apps/demo/public/samples/archives');
const formats = [
  ['z', 'field-notes.md.Z'], ['bzip2', 'field-notes.md.bzip2'], ['lzma86', 'field-notes.md.lzma86'],
  ['taz', 'field-notes.taz'], ['tzst', 'field-notes.tzst'], ['lha', 'field-notes.lha'], ['lzh', 'field-notes.lzh'],
  ['rpm', 'field-notes-zstd.rpm'], ['xar', 'field-notes.xar'], ['wim', 'field-notes.wim'],
  ['esd', 'field-notes.esd'], ['udf', 'field-notes.udf']
] as const;
const text = 'Original seasonal color study';

async function readContents(page: Page, name: string) {
  if (name.endsWith('.rpm')) {
    await page.locator('.archivev-name').filter({ hasText: /\.cpio\.(zst|xz)$/ }).click();
    await expect(page.locator('.archivev-summary')).toContainText('.cpio.');
  }
  const stream = /\.md\.(Z|bzip2|lzma86)$/.test(name);
  await page.locator('tr.archivev-row').filter({ has: page.getByText(stream ? 'field-notes.md' : 'README.md', { exact: true }) }).click();
  await expect(page.locator('.archivev-entry-preview')).toContainText(text);
  if (!stream) {
    await page.getByRole('button', { name: 'Back to archive', exact: true }).click();
    await page.locator('tr.archivev-row').filter({ hasText: 'seasons.svg' }).click();
    const image = page.locator('.archivev-entry-preview img.pptxv-native-image');
    await expect(image).toHaveAttribute('alt', 'seasons.svg');
    await expect.poll(() => image.evaluate((element: HTMLImageElement) => element.naturalWidth)).toBe(900);
  }
  await expect(page.locator('.archivev-entry-error')).toHaveCount(0);
}

test('opens all system archive samples and previews their text and original seasonal artwork', async ({ page }) => {
  test.setTimeout(90000);
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto('./?view=preview&lang=zh');
  const search = page.getByRole('searchbox', { name: '搜索文件格式' });
  for (const [extension, name] of formats) {
    await search.fill(`.${extension}`);
    const button = page.getByRole('button', { name: extension.toUpperCase(), exact: true });
    await expect(button).toHaveAttribute('data-support', 'sample');
    await button.click();
    await expect(page.locator('.wb-preview-title strong')).toHaveText(name);
    await readContents(page, name);
  }
  await expect(page.locator('.wb-support-summary')).toHaveText('已支持 40 种格式');
  expect(errors).toEqual([]);
});

test('uploads UDF-only ISO images, alternate package codecs and separate WIM images', async ({ page }) => {
  test.setTimeout(90000);
  await page.goto('./?view=preview&lang=zh');
  const upload = page.getByLabel('导入文件', { exact: true });
  for (const name of ['field-notes-xz.rpm', 'field-notes-bzip2.xar']) {
    await upload.setInputFiles(path.join(samples, name));
    await expect(page.locator('.wb-preview-title strong')).toHaveText(name);
    await readContents(page, name);
  }
  await upload.setInputFiles({ name: 'udf-only.iso', mimeType: 'application/octet-stream', buffer: await readFile(path.join(samples, 'field-notes.udf')) });
  await expect(page.locator('.wb-preview-title strong')).toHaveText('udf-only.iso');
  await readContents(page, 'udf-only.iso');
  await upload.setInputFiles(path.join(samples, 'field-notes-multi.wim'));
  await expect(page.locator('.wb-preview-title strong')).toHaveText('field-notes-multi.wim');
  for (const image of ['1', '2']) {
    await page.locator('tr.archivev-row[data-type="directory"]').filter({ hasText: new RegExp(`^${image}/`) }).click();
    await page.locator('tr.archivev-row').filter({ hasText: 'README.md' }).click();
    await expect(page.locator('.archivev-entry-preview')).toContainText(text);
    if (image === '2') await expect(page.locator('.archivev-entry-preview')).toContainText('Second image: winter edition.');
    await page.getByRole('button', { name: 'field-notes-multi.wim', exact: true }).click();
  }
});

test('opens all newly supported formats inside a ZIP archive', async ({ page }) => {
  test.setTimeout(90000);
  await page.goto('./?view=preview&lang=zh');
  const zip = new JSZip();
  for (const [, name] of formats) zip.file(name, await readFile(path.join(samples, name)));
  await page.getByLabel('导入文件', { exact: true }).setInputFiles({
    name: 'nested-system-formats.zip', mimeType: 'application/zip', buffer: await zip.generateAsync({ type: 'nodebuffer' })
  });
  for (const [, name] of formats) {
    await page.locator('tr.archivev-row').filter({ has: page.getByText(name, { exact: true }) }).click();
    await expect(page.locator('.archivev-summary')).toContainText(name);
    await readContents(page, name);
    await page.getByRole('button', { name: 'nested-system-formats.zip', exact: true }).click();
  }
});
