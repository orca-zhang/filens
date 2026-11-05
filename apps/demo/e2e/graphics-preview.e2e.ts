import { expect, test } from '@playwright/test';
import path from 'node:path';

test('opens TIFF, DWG and raster samples with current format status', async ({ page }) => {
  test.setTimeout(150000);
  const engines: string[] = [];
  page.on('request', request => {
    if (request.url().includes('converter-')) engines.push(request.url());
  });
  await page.goto('./?view=preview&format=tiff&lang=zh');
  await expect(page.locator('img.pptxv-native-image')).toBeVisible();
  for (const [format, width, name] of [
    ['TIFF', 1200, 'field-notes.tiff'], ['TIF', 768, 'tonal-ramp-16bit.tif'],
    ['TGA', 1200, 'texture-study.tga'], ['PGM', 900, 'portable-gray.pgm'],
    ['PBM', 900, 'portable-ink.pbm'], ['PNM', 900, 'portable-color.pnm'],
    ['DDS', 1024, 'surface-atlas.dds'], ['HDR', 256, 'studio-light.hdr'],
    ['DIB', 900, 'color-archive.dib'], ['CUR', 64, 'studio-pointer.cur'],
    ['PCX', 900, 'color-archive.pcx'], ['EXR', 900, 'linear-light.exr'],
    ['JXL', 900, 'color-archive.jxl'], ['QOI', 900, 'color-archive.qoi'],
    ['FF', 900, 'color-archive.ff'], ['HEIC', 900, 'color-archive.heic'],
    ['HEIF', 900, 'color-archive.heif'], ['JPEG', 900, 'color-archive.jpeg']
  ] as const) {
    const button = page.locator('.wb-subformat').filter({ has: page.locator('span', { hasText: new RegExp(`^${format}$`) }) });
    await expect(button).toHaveAttribute('data-support', 'sample');
    await button.click();
    const image = page.locator('img.pptxv-native-image');
    await expect(image).toHaveAttribute('alt', name);
    await expect(image).toBeVisible();
    await expect.poll(() => image.evaluate((element: HTMLImageElement) => element.naturalWidth)).toBe(width);
    if (['TIFF', 'TGA', 'CUR', 'DIB', 'PCX', 'EXR', 'JXL', 'QOI', 'FF'].includes(format)) {
      const pixel = await image.evaluate((element: HTMLImageElement) => {
        const canvas = document.createElement('canvas');
        canvas.width = 1; canvas.height = 1;
        const context = canvas.getContext('2d')!;
        context.drawImage(element, 0, 0);
        return [...context.getImageData(0, 0, 1, 1).data];
      });
      // Check first-page color and preserved alpha, beyond a valid PNG header.
      expect(pixel).toEqual(['TGA', 'CUR'].includes(format) ? [0, 0, 0, 0] : [220, 107, 69, 255]);
    }
    await expect(page.locator('.wb-note.is-error')).toHaveCount(0);
  }
  await page.getByRole('button', { name: 'SVG', exact: true }).click();
  await expect(page.locator('.wb-preview-title strong')).toHaveText('shape-study.svg');
  const svgImage = page.getByRole('img', { name: 'shape-study.svg', exact: true });
  await expect(svgImage).toBeVisible();
  await expect.poll(() => svgImage.evaluate((element: HTMLImageElement) => element.naturalWidth)).toBe(900);
  await page.getByRole('button', { name: 'Design', exact: true }).click();
  const dwg = page.getByRole('button', { name: 'DWG', exact: true });
  await expect(dwg).toHaveAttribute('data-support', 'sample');
  await dwg.click();
  await expect(page.locator('.cadv-preview svg')).toContainText('FIELD NOTES / CAFE');
  await expect(page.locator('.wb-preview-title strong')).toHaveText('filens-cafe-2018.dwg');
  await expect(page.getByRole('button', { name: 'DGN', exact: true })).toHaveCount(0);
  expect(engines.filter(url => url.includes('converter-raster.wasm'))).toHaveLength(1);
  expect(engines.filter(url => url.includes('converter-cad.wasm'))).toHaveLength(1);
});

test('uploads original TIFF and DWG files through the same local route', async ({ page }) => {
  await page.goto('./?view=preview&lang=zh');
  const upload = page.getByLabel('导入文件', { exact: true });
  for (const [name, selector] of [
    ['field-notes.tiff', 'img.pptxv-native-image'],
    ['filens-cafe-2000.dwg', '.cadv-preview svg'],
    ['studio-pointer-bmp.cur', 'img.pptxv-native-image'],
    ['indexed-archive.pcx', 'img.pptxv-native-image']
  ]) {
    await upload.setInputFiles(path.resolve('apps/demo/public/samples/graphics', name));
    await expect(page.locator('.wb-preview-title strong')).toHaveText(name);
    if (selector === 'img.pptxv-native-image') await expect(page.locator(selector)).toHaveAttribute('alt', name);
    await expect(page.locator(selector)).toBeVisible();
    await expect(page.locator('.wb-note.is-error')).toHaveCount(0);
  }
});
