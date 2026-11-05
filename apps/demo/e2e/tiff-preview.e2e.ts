import { createHash } from 'node:crypto';
import { expect, test } from '@playwright/test';
import { createTiffPresentation } from '../../../packages/core/test/fixtures/tiff-presentation.mjs';

for (const corruptUnusedPage of [false, true]) {
  test(`previews complete first-page TIFF pixels in PPTX (corrupt unused page: ${corruptUnusedPage})`, async ({ page }) => {
    const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
    const fixture = await createTiffPresentation(corruptUnusedPage);
    await page.goto('./?view=preview');
    await page.getByLabel('导入文件', { exact: true }).setInputFiles({ name: 'multipage-tiff.pptx', mimeType: 'application/vnd.openxmlformats-officedocument.presentationml.presentation', buffer: Buffer.from(fixture.bytes) });
    const image = page.locator('.pptxv-slide .pptxv-image').first();
    await expect(image).toHaveAttribute('src', /^data:image\/png;/);
    const result = await image.evaluate(async image => {
      const img = image as HTMLImageElement; await img.decode();
      const canvas = document.createElement('canvas'); canvas.width = img.naturalWidth; canvas.height = img.naturalHeight;
      const context = canvas.getContext('2d')!; context.drawImage(img, 0, 0);
      const data = context.getImageData(0, 0, canvas.width, canvas.height).data;
      const hash = [...new Uint8Array(await crypto.subtle.digest('SHA-256', data))].map(value => value.toString(16).padStart(2, '0')).join('');
      return { width: canvas.width, height: canvas.height, hash };
    });
    expect(result).toEqual({ width: fixture.width, height: fixture.height, hash: createHash('sha256').update(fixture.firstPage).digest('hex') });
    expect(errors).toEqual([]);
  });
}
