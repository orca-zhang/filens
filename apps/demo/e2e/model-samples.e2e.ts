import { expect, test } from '@playwright/test';
import { createGlbFixture } from '../../../packages/model3d/test/fixtures/mesh.mjs';

test('opens all eight native models, preserves detail and supports orbit and zoom', async ({ page }) => {
  test.setTimeout(120000);
  const errors: string[] = [];
  const externalRequests: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto('./?view=preview&format=step&lang=zh');
  const origin = new URL(page.url()).origin;
  page.on('request', request => {
    if (/^https?:/.test(request.url()) && new URL(request.url()).origin !== origin) externalRequests.push(request.url());
  });
  const gallery = page.getByRole('navigation', { name: '3D 模型样例', exact: true });
  await expect(gallery.getByRole('button')).toHaveCount(8);
  await page.getByRole('button', { name: '文件详情', exact: true }).click();
  for (const [title, file, format] of [
    ['法兰轴承座', 'flanged-bearing.step', 'STEP'],
    ['离心叶轮', 'centrifugal-impeller.stl', 'STL'],
    ['越野车玩具', 'trail-rover.obj', 'OBJ'],
    ['太空机器人', 'orbital-bot.glb', 'GLB'],
    ['工业机械臂', 'industrial-arm.gltf', 'GLTF'],
    ['狐狸手办', 'sleepy-fox.ply', 'PLY'],
    ['行星齿轮箱', 'planetary-gearbox.3mf', '3MF'],
    ['换热器剖面', 'heat-exchanger.vtk', 'VTK']
  ] as const) {
    const button = gallery.getByRole('button', { name: `${title} ${format}`, exact: true });
    await button.click();
    await expect(page.locator('.wb-preview-title strong')).toHaveText(file);
    await expect(button).toHaveAttribute('aria-pressed', 'true');
    await expect(gallery.locator('button[aria-pressed="true"]')).toHaveCount(1);
    await expect(page.locator('.wb-file-badge')).toHaveText(format);
    await expect(page.locator('canvas.model3dv-canvas')).toBeVisible();
    const triangles = page.locator('.wb-detail-section .wb-file-facts > div').filter({ has: page.locator('dt', { hasText: /^Triangles$/ }) }).locator('dd');
    await expect.poll(async () => Number(await triangles.textContent())).toBeGreaterThan(10000);
    await expect(button.locator('img')).toHaveJSProperty('complete', true);
    expect(await button.locator('img').evaluate((img: HTMLImageElement) => img.naturalWidth)).toBeGreaterThan(0);
    await expect(page.locator('.wb-note.is-error')).toHaveCount(0);
  }
  await page.getByRole('button', { name: '关闭文件详情', exact: true }).click();
  const canvas = page.locator('canvas.model3dv-canvas');
  const before = await canvas.screenshot();
  const bounds = (await canvas.boundingBox())!;
  const x = bounds.x + bounds.width / 2, y = bounds.y + bounds.height / 2;
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x + 100, y + 35, { steps: 12 });
  await page.mouse.up();
  expect(await canvas.screenshot()).not.toEqual(before);
  await canvas.hover();
  await page.mouse.wheel(0, -100);
  await page.getByRole('button', { name: '显示模型工具', exact: true }).click();
  await expect(page.locator('.pptxv-status').filter({ hasText: /^108%$/ })).toBeVisible();
  expect(errors).toEqual([]);
  expect(externalRequests).toEqual([]);

  // A local file with the same name as a bundled asset must keep its own content.
  await page.locator('input[type=file]').setInputFiles({
    name: 'orbital-bot.glb', mimeType: 'model/gltf-binary', buffer: Buffer.from(createGlbFixture())
  });
  await expect(gallery).toHaveCount(0);
  await expect(canvas).toBeVisible();
  await expect(page.locator('.wb-workspace-label')).toContainText('本地文件');
});

test('keeps the model gallery usable on mobile and with keyboard and language changes', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 900 });
  await page.goto('./?view=preview&format=obj&lang=zh');
  const gallery = page.getByRole('navigation', { name: '3D 模型样例', exact: true });
  for (const [title, file] of [
    ['换热器剖面 VTK', 'heat-exchanger.vtk'],
    ['太空机器人 GLB', 'orbital-bot.glb'],
    ['法兰轴承座 STEP', 'flanged-bearing.step']
  ]) {
    await gallery.getByRole('button', { name: title, exact: true }).click();
    await expect(page.locator('.wb-preview-title strong')).toHaveText(file);
    await expect(page.locator('canvas.model3dv-canvas')).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(320);
    const bounds = (await page.locator('canvas.model3dv-canvas').boundingBox())!;
    expect(bounds.width).toBeGreaterThan(250);
    expect(bounds.x).toBeGreaterThanOrEqual(0);
    expect(bounds.x + bounds.width).toBeLessThanOrEqual(320);
  }
  await page.getByRole('button', { name: 'Switch to English', exact: true }).click();
  const englishGallery = page.getByRole('navigation', { name: '3D model samples', exact: true });
  const bearing = englishGallery.getByRole('button', { name: 'Bearing assembly STEP', exact: true });
  await expect(bearing).toHaveAttribute('aria-pressed', 'true');
  await bearing.focus();
  await page.keyboard.press('Tab');
  await page.keyboard.press('Enter');
  await expect(page.locator('.wb-preview-title strong')).toHaveText('centrifugal-impeller.stl');
  await expect(page.locator('canvas.model3dv-canvas')).toBeVisible();
});
