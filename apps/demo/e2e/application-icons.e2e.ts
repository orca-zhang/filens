import { expect, test } from '@playwright/test';
import path from 'node:path';

test('previews APK, IPA and Windows resource icons locally through WASM', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto('./?view=preview&lang=ja_JP');
  const input = page.locator('input[type=file]').first();
  for (const extension of ['apk', 'ipa', 'exe', 'dll', 'mui', 'mun', 'ico']) {
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
