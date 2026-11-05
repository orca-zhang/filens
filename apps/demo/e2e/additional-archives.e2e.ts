import { expect, test } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import JSZip from 'jszip';

const samples = path.resolve('apps/demo/public/samples/archives');

test('opens additional format samples and previews their original contents', async ({ page }) => {
  test.setTimeout(90000);
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto('./?view=preview&lang=zh');
  const search = page.getByRole('searchbox', { name: '搜索文件格式' });
  for (const format of ['XPI', 'CRX', 'ZIPX', 'CBR', 'CB7', 'CBT']) {
    await search.fill(`.${format}`);
    const button = page.getByRole('button', { name: format, exact: true });
    await expect(button).toHaveAttribute('data-support', 'sample');
    if (format.startsWith('CB')) await expect(button).toContainText('浏览内容');
    await button.click();
    await expect(page.locator('.archivev-name')).toHaveCount(3);
    await page.locator('tr.archivev-row').filter({ hasText: 'README.md' }).click();
    await expect(page.locator('.archivev-entry-preview')).toContainText('Original color and shape artwork');
    await page.getByRole('button', { name: 'Back to archive', exact: true }).click();
    const imageName = ['XPI', 'CRX'].includes(format) ? 'artwork.svg' : 'page-2.jpeg';
    await page.locator('tr.archivev-row').filter({ hasText: imageName }).click();
    const image = page.locator('.archivev-entry-preview img.pptxv-native-image');
    await expect(image).toHaveAttribute('alt', imageName);
    await expect.poll(() => image.evaluate((element: HTMLImageElement) => element.naturalWidth)).toBe(900);
    await expect(page.locator('.archivev-entry-error')).toHaveCount(0);
  }
  expect(errors).toEqual([]);
});

test('uploads CRX2, advanced ZIPX methods and nested new archive formats', async ({ page }) => {
  test.setTimeout(90000);
  await page.goto('./?view=preview');
  const upload = page.getByLabel('导入文件', { exact: true });
  for (const name of ['color-study-v2.crx', 'color-study-bzip2.zipx', 'color-study-deflate64.zipx']) {
    await upload.setInputFiles(path.join(samples, name));
    await expect(page.locator('.wb-preview-title strong')).toHaveText(name);
    await page.locator('tr.archivev-row').filter({ hasText: 'README.md' }).click();
    await expect(page.locator('.archivev-entry-preview')).toContainText('Original color and shape artwork');
  }
  const zip = new JSZip();
  for (const name of ['color-study.xpi', 'color-study.cb7', 'color-study.cbt', 'color-study.cbr', 'color-study-lzma.zipx', 'color-study-v3.crx']) {
    zip.file(name, await readFile(path.join(samples, name)));
  }
  await upload.setInputFiles({ name: 'nested-formats.zip', mimeType: 'application/zip', buffer: await zip.generateAsync({ type: 'nodebuffer' }) });
  for (const name of Object.keys(zip.files)) {
    await page.locator('tr.archivev-row').filter({ hasText: name }).click();
    await expect(page.locator('.archivev-summary')).toContainText(name);
    await expect(page.locator('.archivev-name')).toHaveCount(3);
    await page.locator('tr.archivev-row').filter({ hasText: 'README.md' }).click();
    await expect(page.locator('.archivev-entry-preview')).toContainText('Original color and shape artwork');
    await page.getByRole('button', { name: 'nested-formats.zip', exact: true }).click();
  }
});
