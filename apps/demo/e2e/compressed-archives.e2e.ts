import { expect, test } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import JSZip from 'jszip';

const samples = path.resolve('apps/demo/public/samples/archives');
const streams = ['bz2', 'xz', 'lzma', 'zst', 'zstd'];
const containers = ['tbz', 'tbz2', 'txz', 'tlz', 'ar', 'cpio', 'cab', 'iso'];
const text = 'Original color and shape artwork';

test('opens all compressed-stream and container samples through the real browser worker', async ({ page }) => {
  test.setTimeout(90000);
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto('./?view=preview&lang=zh');
  const search = page.getByRole('searchbox', { name: '搜索文件格式' });
  for (const extension of [...streams, ...containers, 'deb']) {
    await search.fill(`.${extension}`);
    const button = page.getByRole('button', { name: extension.toUpperCase(), exact: true });
    await expect(button).toHaveAttribute('data-support', 'sample');
    await button.click();
    const stream = streams.includes(extension);
    await expect(page.locator('.archivev-name')).toHaveCount(stream ? 1 : 3);
    if (extension === 'deb') {
      await page.locator('tr.archivev-row').filter({ hasText: 'data.tar.zst' }).click();
      await expect(page.locator('.archivev-summary')).toContainText('data.tar.zst');
    }
    const filename = stream ? 'archive-readme.md' : 'README.md';
    await page.locator('tr.archivev-row').filter({ hasText: filename }).click();
    await expect(page.locator('.archivev-entry-preview')).toContainText(text);
    if (!stream) {
      await page.getByRole('button', { name: 'Back to archive', exact: true }).click();
      await page.locator('tr.archivev-row').filter({ hasText: 'page-2.jpeg' }).click();
      const image = page.locator('.archivev-entry-preview img.pptxv-native-image');
      await expect(image).toHaveAttribute('alt', 'page-2.jpeg');
      await expect.poll(() => image.evaluate((element: HTMLImageElement) => element.naturalWidth)).toBe(900);
    }
    await expect(page.locator('.archivev-entry-error')).toHaveCount(0);
  }
  await expect(page.locator('.wb-support-summary')).toHaveText('已支持 40 种格式');
  expect(errors).toEqual([]);
});

test('uploads compound TAR names and browses nested new formats and Debian control files', async ({ page }) => {
  test.setTimeout(90000);
  await page.goto('./?view=preview&lang=zh');
  const upload = page.getByLabel('导入文件', { exact: true });
  for (const [alias, codec] of [['tbz2', 'bz2'], ['txz', 'xz'], ['tlz', 'lzma']]) {
    const name = `artwork.tar.${codec}`;
    await upload.setInputFiles({ name, mimeType: 'application/octet-stream', buffer: await readFile(path.join(samples, `color-study.${alias}`)) });
    await expect(page.locator('.wb-preview-title strong')).toHaveText(name);
    await expect(page.locator('.archivev-name')).toHaveCount(3);
    await page.locator('tr.archivev-row').filter({ hasText: 'README.md' }).click();
    await expect(page.locator('.archivev-entry-preview')).toContainText(text);
  }
  const zip = new JSZip();
  for (const name of [
    ...streams.map(extension => `archive-readme.md.${extension}`),
    ...containers.map(extension => `color-study.${extension}`), 'color-study.deb'
  ]) zip.file(name, await readFile(path.join(samples, name)));
  await upload.setInputFiles({ name: 'nested-containers.zip', mimeType: 'application/zip', buffer: await zip.generateAsync({ type: 'nodebuffer' }) });
  for (const name of Object.keys(zip.files)) {
    await page.locator('tr.archivev-row').filter({ has: page.getByText(name, { exact: true }) }).click();
    await expect(page.locator('.archivev-summary')).toContainText(name);
    if (name.endsWith('.deb')) {
      await page.locator('tr.archivev-row').filter({ hasText: 'control.tar.xz' }).click();
      await expect(page.locator('.archivev-name')).toHaveCount(1);
      await page.locator('tr.archivev-row').filter({ hasText: 'control' }).click();
      await expect(page.locator('.archivev-entry-preview')).toContainText('Package: filens-color-study');
    } else {
      const filename = name.startsWith('archive-readme') ? 'archive-readme.md' : 'README.md';
      await page.locator('tr.archivev-row').filter({ hasText: filename }).click();
      await expect(page.locator('.archivev-entry-preview')).toContainText(text);
    }
    await page.getByRole('button', { name: 'nested-containers.zip', exact: true }).click();
  }
});
