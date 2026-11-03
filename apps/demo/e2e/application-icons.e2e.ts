import { expect, test } from '@playwright/test';
import path from 'node:path';

test('browses APK and IPA archives and previews Windows resource icons locally', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto('./?view=preview&lang=ja_JP');
  const input = page.locator('input[type=file]').first();
  await page.getByRole('button', { name: 'Media', exact: true }).click();
  for (const name of ['APK', 'IPA']) {
    await expect(page.getByRole('button', { name, exact: true })).toHaveCount(0);
  }
  await page.getByRole('button', { name: 'Archive', exact: true }).click();
  for (const [extension, entry] of [['apk', 'AndroidManifest.xml'], ['ipa', 'Payload/']]) {
    await expect(page.getByRole('button', { name: extension.toUpperCase(), exact: true })).toHaveCount(1);
    await input.setInputFiles(path.resolve(`examples/go-wazero-converter/fixtures/icons/sample.${extension}`));
    await expect(page.locator('.wb-preview-title strong')).toHaveText(`sample.${extension}`);
    await expect(page.locator('.archivev-table')).toContainText(entry);
    await expect(page.locator('img.pptxv-native-image')).toHaveCount(0);
    await expect(page.locator('.wb-note.is-error')).toHaveCount(0);
  }
  for (const extension of ['exe', 'dll', 'mui', 'mun', 'ico']) {
    await input.setInputFiles(path.resolve(`examples/go-wazero-converter/fixtures/icons/sample.${extension}`));
    await expect(page.locator('.wb-preview-title strong')).toHaveText(`sample.${extension}`);
    const image = page.locator('img.pptxv-native-image');
    await expect(image).toBeVisible();
    await expect.poll(() => image.evaluate((img: HTMLImageElement) => img.naturalWidth)).toBe(1);
    await expect(page.locator('.wb-note.is-error')).toHaveCount(0);
  }
  await page.getByRole('button', { name: '显示工具栏' }).click();
  await expect(page.locator('.pptxv-toolbar')).toContainText('全体表示');
  await expect(page.getByRole('button', { name: '拡大', exact: true })).toBeVisible();
  expect(errors).toEqual([]);
});
