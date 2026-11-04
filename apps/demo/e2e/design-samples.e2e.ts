import { expect, test } from '@playwright/test';

test('renders the showcase design samples', async ({ page }) => {
  await page.goto('./?view=preview');
  await page.getByRole('button', { name: 'Design', exact: true }).click();

  for (const [format, name, selector] of [
    ['DXF', 'filens-cafe.dxf', '.cadv-preview svg'],
    ['OBJ', /\.obj$/, '.model3dv-canvas'],
    ['MM', 'moonshot-2035.mm', '.mindmapv-node'],
    ['DRAWIO', 'ai-command-center.drawio', '.diagramv-node'],
    ['PSD', 'still-form.psd', 'img.pptxv-native-image'],
    ['PSB', 'after-hours.psb', 'img.pptxv-native-image'],
    ['AI', 'forma-identity.ai', '.pdfv-page[data-rendered="true"]'],
    ['EPS', 'orbit-marks.eps', '.pdfv-page[data-rendered="true"]'],
    ['PS', 'studio-editions.ps', '.pdfv-page[data-rendered="true"]']
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

test('previews all twelve original design files on desktop and mobile', async ({ page }) => {
  test.setTimeout(90000);
  const sources: string[] = [];
  page.on('request', request => {
    if (request.url().includes('/samples/design/') && !request.url().endsWith('.webp')) sources.push(request.url());
  });
  await page.goto('./?view=preview&format=psd&lang=zh');
  const gallery = page.getByRole('navigation', { name: '设计稿样例', exact: true });
  const image = page.locator('img.pptxv-native-image');
  await expect(gallery.getByRole('button')).toHaveCount(12);
  for (const width of [1280, 320]) {
    await page.setViewportSize({ width, height: 900 });
    if (width < 761) {
      await page.getByRole('button', { name: '关闭格式面板', exact: true }).click({ position: { x: width - 10, y: 20 } });
    }
    for (const [label, name, imageWidth] of [
      ['护肤品牌 PSD', 'still-form.psd', 1600],
      ['运动鞋上新 PSD', 'pace-store.psd', 1800],
      ['咖啡品牌 PSD', 'sunday-roast.psd', 1500],
      ['耳机详情 PSD', 'mono-sound.psd', 1100],
      ['家居画册 PSD', 'terra-studio.psd', 1400],
      ['花店海报 PSD', 'bloom-market.psd', 1100],
      ['音乐节视觉 PSB', 'after-hours.psb', 1800],
      ['户外旅行 PSB', 'alpine-journal.psb', 1600],
      ['品牌识别 AI', 'forma-identity.ai', 0],
      ['餐厅菜单 AI', 'kinfolk-menu.ai', 0],
      ['矢量标志 EPS', 'orbit-marks.eps', 0],
      ['印刷设计 PS', 'studio-editions.ps', 0]
    ] as const) {
      const button = gallery.getByRole('button', { name: label, exact: true });
      await button.click();
      await expect(button).toHaveAttribute('aria-pressed', 'true');
      await expect(gallery.locator('button[aria-pressed="true"]')).toHaveCount(1);
      await expect(page.locator('.wb-preview-title strong')).toHaveText(name);
      if (imageWidth) {
        await expect.poll(() => image.evaluate((element: HTMLImageElement) => element.naturalWidth)).toBe(imageWidth);
        await expect(image).toBeVisible();
      } else {
        await expect(page.locator('.pdfv-page[data-rendered="true"]').first()).toBeVisible();
      }
      await expect(page.locator('.wb-note.is-error')).toHaveCount(0);
      expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(width);
    }
  }
  await gallery.getByRole('button', { name: '耳机详情 PSD', exact: true }).click();
  await expect.poll(() => image.evaluate((element: HTMLImageElement) => element.naturalWidth)).toBe(1100);
  const source = await image.getAttribute('src');
  await page.getByRole('button', { name: 'Switch to English', exact: true }).click();
  const englishGallery = page.getByRole('navigation', { name: 'Design file samples', exact: true });
  await expect(englishGallery.getByRole('button', { name: 'Headphone detail PSD', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await expect(image).toHaveAttribute('src', source!);
  await englishGallery.getByRole('button', { name: 'Skincare campaign PSD', exact: true }).focus();
  await page.keyboard.press('Tab');
  await page.keyboard.press('Enter');
  await expect(page.locator('.wb-preview-title strong')).toHaveText('pace-store.psd');
  expect(sources.some(source => /\.psd$/.test(source))).toBe(true);
  expect(sources.some(source => /\.psb$/.test(source))).toBe(true);
  expect(sources.some(source => /\.ai$/.test(source))).toBe(true);
  expect(sources.some(source => /\.eps$/.test(source))).toBe(true);
  expect(sources.some(source => /\.ps$/.test(source))).toBe(true);
  expect(sources.some(source => /\.svg$/.test(source))).toBe(false);
});

test('uploads renamed native design files through the same preview path', async ({ page }) => {
  await page.goto('./?view=preview&lang=zh');
  const upload = page.getByLabel('导入文件', { exact: true });
  for (const [original, name, signature, selector] of [
    ['still-form.psd', 'uploaded-campaign.psd', '8BPS', 'img.pptxv-native-image'],
    ['after-hours.psb', 'uploaded-festival.psb', '8BPS', 'img.pptxv-native-image'],
    ['forma-identity.ai', 'uploaded-identity.ai', '%PDF', '.pdfv-page[data-rendered="true"]'],
    ['orbit-marks.eps', 'uploaded-identity.eps', '%!PS', '.pdfv-page[data-rendered="true"]'],
    ['studio-editions.ps', 'uploaded-print.ps', '%!PS', '.pdfv-page[data-rendered="true"]']
  ] as const) {
    const response = await page.request.get(`./samples/design/${original}`);
    expect(response.ok()).toBe(true);
    const buffer = await response.body();
    expect(buffer.subarray(0, 4).toString()).toBe(signature);
    await upload.setInputFiles({ name, mimeType: 'application/octet-stream', buffer });
    await expect(page.locator('.wb-preview-title strong')).toHaveText(name);
    await expect(page.locator(selector).first()).toBeVisible();
    await expect(page.locator('.wb-note.is-error')).toHaveCount(0);
  }
  await upload.setInputFiles({ name: 'legacy.ai', mimeType: 'application/illustrator', buffer: Buffer.from('%!PS-Adobe-3.0\nunknown_filens_operator showpage\n') });
  await expect(page.locator('.wb-note.is-error')).toContainText('PostScript undefined');
});

for (const [format, name] of [['ai', 'forma-identity.ai'], ['eps', 'orbit-marks.eps'], ['ps', 'studio-editions.ps']]) {
  test(`renders ${format.toUpperCase()} vectors at a higher resolution when zooming`, async ({ page }) => {
    const engines: string[] = [];
    page.on('request', request => { if (/converter-.*\.wasm/.test(request.url())) engines.push(request.url()); });
    await page.goto(`./?view=preview&format=${format}&lang=zh`);
    const canvas = page.locator('.pdfv-page[data-rendered="true"]').first();
    await expect(canvas).toBeVisible();
    const width = await canvas.evaluate((element: HTMLCanvasElement) => element.width);
    await page.getByRole('button', { name: '显示工具栏', exact: true }).click();
    await page.locator('[data-action="zoom-in"]').click();
    await expect.poll(() => canvas.evaluate((element: HTMLCanvasElement) => element.width)).toBeGreaterThan(width);
    await expect(page.locator('.wb-preview-title strong')).toHaveText(name);
    await expect(page.locator('.wb-note.is-error')).toHaveCount(0);
    expect(engines.some(url => url.includes('converter-postscript.wasm'))).toBe(true);
    expect(engines.some(url => url.includes('converter-core.wasm'))).toBe(false);
    if (format === 'ps') await expect(page.locator('.pdfv-page')).toHaveCount(2);
  });
}
