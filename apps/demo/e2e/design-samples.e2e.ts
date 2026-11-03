import { expect, test } from '@playwright/test';

test('renders the showcase design samples', async ({ page }) => {
  await page.goto('./?view=preview');
  await page.getByRole('button', { name: 'Design', exact: true }).click();

  for (const [format, name, selector] of [
    ['DXF', 'filens-cafe.dxf', '.cadv-preview svg'],
    ['OBJ', 'viking-helmet.obj', '.model3dv-canvas'],
    ['MM', 'moonshot-2035.mm', '.mindmapv-node'],
    ['DRAWIO', 'ai-command-center.drawio', '.diagramv-node'],
    ['PSD', 'still-form.psd.svg', 'img.pptxv-native-image'],
    ['AI', 'neon-orbit.ai.svg', 'img.pptxv-native-image'],
    ['EPS', 'signal-void.eps.svg', 'img.pptxv-native-image'],
    ['PS', 'future-grid.ps.svg', 'img.pptxv-native-image']
  ] as const) {
    await page.getByRole('button', { name: format, exact: true }).click();
    await expect(page.locator('.wb-preview-title strong')).toHaveText(name);
    await expect(page.locator(selector).first()).toBeVisible();
    await expect(page.locator('.wb-note.is-error')).toHaveCount(0);
    if (format === 'DXF') {
      await page.getByRole('button', { name: '显示工具栏', exact: true }).click();
      await page.getByRole('button', { name: 'Fit', exact: true }).click();
      await expect(page.locator('.cadv-preview svg')).toContainText('FIELD NOTES / CAFE');
      const canvas = await page.locator('.cadv-canvas').boundingBox();
      const stage = await page.locator('.cadv-preview').boundingBox();
      expect(canvas).not.toBeNull();
      expect(stage).not.toBeNull();
      expect(canvas!.y).toBeGreaterThanOrEqual(stage!.y);
      expect(canvas!.y + canvas!.height).toBeLessThanOrEqual(stage!.y + stage!.height + 1);
    }
  }
});

test('switches between commercial Photoshop designs on desktop and mobile', async ({ page }) => {
  await page.goto('./?view=preview&format=psd&lang=zh');
  const gallery = page.getByRole('navigation', { name: 'Photoshop 设计稿样例', exact: true });
  const image = page.locator('img.pptxv-native-image');
  for (const width of [1280, 320]) {
    await page.setViewportSize({ width, height: 900 });
    if (width < 761) {
      await page.getByRole('button', { name: '关闭格式面板', exact: true }).click({ position: { x: width - 10, y: 20 } });
    }
    for (const [label, name, imageWidth] of [
      ['护肤品牌', 'still-form.psd.svg', 1600],
      ['运动鞋上新', 'pace-store.psd.svg', 1800],
      ['咖啡品牌', 'sunday-roast.psd.svg', 1500],
      ['耳机详情', 'mono-sound.psd.svg', 1100]
    ] as const) {
      const button = gallery.getByRole('button', { name: label, exact: true });
      await button.click();
      await expect(button).toHaveAttribute('aria-pressed', 'true');
      await expect(gallery.locator('button[aria-pressed="true"]')).toHaveCount(1);
      await expect(page.locator('.wb-preview-title strong')).toHaveText(name);
      await expect.poll(() => image.evaluate((element: HTMLImageElement) => element.naturalWidth)).toBe(imageWidth);
      await expect(image).toBeVisible();
      await expect(page.locator('.wb-note.is-error')).toHaveCount(0);
      expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(width);
    }
  }
  const source = await image.getAttribute('src');
  await page.getByRole('button', { name: 'Switch to English', exact: true }).click();
  const englishGallery = page.getByRole('navigation', { name: 'Photoshop design samples', exact: true });
  await expect(englishGallery.getByRole('button', { name: 'Headphone detail', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await expect(image).toHaveAttribute('src', source!);
  await englishGallery.getByRole('button', { name: 'Skincare campaign', exact: true }).focus();
  await page.keyboard.press('Tab');
  await page.keyboard.press('Enter');
  await expect(page.locator('.wb-preview-title strong')).toHaveText('pace-store.psd.svg');
});
