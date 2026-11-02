import { expect, test } from '@playwright/test';
import JSZip from 'jszip';
import { createPngFixture, createRasterDxfFixture } from '../../../packages/cad/test/fixtures/resources.mjs';

for (const readme of ['README.txt', 'README.md']) {
  test(`browses every ZIP entry when ${readme} is the only primary candidate`, async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', error => errors.push(error.message));
    const zip = new JSZip();
    zip.file(readme, 'Archive instructions');
    zip.file('metadata.json', '{"name":"archive"}');
    zip.file('payload.bin', new Uint8Array([0, 1, 2, 255]));
    zip.file('assets/preview.png', await createPngFixture(32));
    await page.goto('./?view=preview');
    await page.locator('.wb-upload input[type=file]').setInputFiles({
      name: 'mixed-files.zip', mimeType: 'application/zip', buffer: await zip.generateAsync({ type: 'nodebuffer' })
    });

    await expect(page.locator('.wb-preview-title strong')).toHaveText('mixed-files.zip');
    await expect(page.locator('.archivev-name')).toHaveText(['assets/', 'metadata.json', 'payload.bin', readme]);
    await page.locator('tr.archivev-row').filter({ hasText: readme }).click();
    await expect(page.locator('.archivev-entry-preview')).toContainText('Archive instructions');
    await page.getByRole('button', { name: 'Back to archive', exact: true }).click();
    await page.locator('tr.archivev-row').filter({ hasText: 'assets/' }).click();
    await page.locator('tr.archivev-row').filter({ hasText: 'preview.png' }).click();
    const image = page.locator('.archivev-entry-preview img.pptxv-native-image');
    await expect(image).toBeVisible();
    expect(await image.evaluate(async element => {
      const image = element as HTMLImageElement;
      await image.decode();
      return image.naturalWidth;
    })).toBe(32);
    await page.getByRole('button', { name: 'mixed-files.zip', exact: true }).click();
    await expect(page.locator('.archivev-name')).toHaveCount(4);
    expect(errors).toEqual([]);
  });
}

test('keeps a ZIP containing a single TXT in the archive browser', async ({ page }) => {
  const zip = new JSZip();
  zip.file('notes.txt', 'One archived text file');
  await page.goto('./?view=preview');
  await page.locator('.wb-upload input[type=file]').setInputFiles({
    name: 'notes.zip', mimeType: 'application/zip', buffer: await zip.generateAsync({ type: 'nodebuffer' })
  });
  await expect(page.locator('.wb-preview-title strong')).toHaveText('notes.zip');
  await page.locator('tr.archivev-row').filter({ hasText: 'notes.txt' }).click();
  await expect(page.locator('.archivev-entry-preview')).toContainText('One archived text file');
});

test('opens a recognized DXF ZIP bundle with its image sidecars', async ({ page }) => {
  const zip = new JSZip();
  const png = await createPngFixture(32);
  zip.file('rasters.dxf', createRasterDxfFixture(2));
  zip.file('image-0.png', png);
  zip.file('image-1.png', png);
  zip.file('README.txt', 'Drawing instructions');
  await page.goto('./?view=preview');
  await page.locator('.wb-upload input[type=file]').setInputFiles({
    name: 'drawing.zip', mimeType: 'application/zip', buffer: await zip.generateAsync({ type: 'nodebuffer' })
  });
  await expect(page.locator('.wb-preview-title strong')).toHaveText('rasters.dxf');
  const images = page.locator('svg.cadv-canvas image');
  await expect(images).toHaveCount(2);
  expect(await images.evaluateAll(async nodes => Promise.all(nodes.map(async node => {
    const image = new Image();
    image.src = node.getAttribute('href')!;
    await image.decode();
    return image.naturalWidth;
  })))).toEqual([32, 32]);
  await expect(page.locator('.wb-note.is-error')).toHaveCount(0);
});
