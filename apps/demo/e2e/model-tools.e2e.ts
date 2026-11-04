import { expect, test, type Page } from '@playwright/test';
import { createGlbFixture } from '../../../packages/model3d/test/fixtures/mesh.mjs';

async function openModel(page: Page): Promise<void> {
  await page.goto('./?view=preview&lang=zh');
  await expect(page.locator('.wb-status')).toHaveText('预览就绪');
  await page.locator('input[type=file]').setInputFiles({
    name: 'triangle.glb', mimeType: 'model/gltf-binary', buffer: Buffer.from(createGlbFixture())
  });
  await expect(page.locator('canvas.model3dv-canvas')).toBeVisible();
}

test('model inspector preserves the canvas, supports keyboard navigation and changes the actual view', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await openModel(page);
  const canvas = page.locator('canvas.model3dv-canvas');
  const bounds = await canvas.boundingBox();
  const opener = page.getByRole('button', { name: '显示模型工具', exact: true });
  const panel = page.getByRole('region', { name: '模型工具', exact: true });
  await expect(panel).not.toBeVisible();
  await expect(page.locator('.pptxv-toolbar')).toHaveCount(0);
  await expect(page.getByRole('button', { name: '显示工具栏', exact: true })).toHaveCount(0);
  await opener.click();
  const opened = (await canvas.boundingBox())!;
  expect(opened.width).toBe(bounds!.width);
  expect(opened.height).toBeCloseTo(bounds!.height, 0);
  const viewTab = page.getByRole('tab', { name: '视图', exact: true });
  await expect(viewTab).toBeFocused();
  await viewTab.press('ArrowRight');
  await expect(page.getByRole('tab', { name: '结构', exact: true })).toBeFocused();
  await expect(page.getByRole('searchbox', { name: '搜索节点、类型、材质' })).toBeVisible();
  await page.keyboard.press('End');
  await expect(page.getByRole('tab', { name: '工具', exact: true })).toBeFocused();
  await expect(page.getByRole('searchbox', { name: '搜索节点、类型、材质' })).not.toBeVisible();
  await page.keyboard.press('Home');
  await expect(viewTab).toBeFocused();
  const before = await canvas.screenshot();
  await panel.getByRole('combobox', { name: '视图', exact: true }).selectOption('front');
  await expect.poll(async () => (await canvas.screenshot()).equals(before)).toBe(false);
  await panel.getByRole('button', { name: '放大', exact: true }).click();
  await expect(panel.locator('output')).toHaveText('110%');
  await panel.getByRole('button', { name: '重置视图', exact: true }).click();
  await expect(panel.locator('output')).toHaveText('100%');
  await page.keyboard.press('Escape');
  await expect(panel).not.toBeVisible();
  await expect(opener).toBeFocused();
});

test('structure and advanced tools remain usable in a narrow model pane', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 844 });
  await openModel(page);
  const canvas = page.locator('canvas.model3dv-canvas');
  const original = await canvas.boundingBox();
  await page.getByRole('button', { name: '显示模型工具', exact: true }).click();
  const panel = page.getByRole('region', { name: '模型工具', exact: true });
  const bounds = (await panel.boundingBox())!;
  expect(bounds.x).toBeGreaterThanOrEqual(0);
  expect(bounds.x + bounds.width).toBeLessThanOrEqual(320);
  const opened = (await canvas.boundingBox())!;
  expect(opened.width).toBe(original!.width);
  expect(opened.height).toBeCloseTo(original!.height, 0);
  await page.getByRole('tab', { name: '结构', exact: true }).click();
  const search = panel.getByRole('searchbox');
  await search.fill('no-such-part');
  await expect(panel.getByText('没有匹配当前筛选条件的节点。', { exact: true })).toBeVisible();
  await panel.getByRole('button', { name: '清除', exact: true }).click();
  await expect(search).toHaveValue('');
  await expect(panel.getByRole('checkbox').first()).toBeChecked();
  await panel.getByRole('checkbox').first().uncheck();
  await expect(panel.getByRole('checkbox').first()).not.toBeChecked();
  await panel.getByRole('button', { name: '显示全部', exact: true }).click();
  await expect(panel.getByRole('checkbox').first()).toBeChecked();
  await page.getByRole('tab', { name: '工具', exact: true }).click();
  await panel.locator('summary').filter({ hasText: /^测量$/ }).click();
  await panel.getByRole('button', { name: '测量', exact: true }).click();
  await expect(panel.getByRole('button', { name: '测量', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await panel.getByLabel('吸附', { exact: true }).selectOption('vertex');
  await expect(panel.getByLabel('吸附', { exact: true })).toHaveValue('vertex');
  await panel.locator('summary').filter({ hasText: /^剖切$/ }).click();
  await panel.getByRole('button', { name: '剖切', exact: true }).click();
  await expect(panel.getByRole('button', { name: '剖切', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await panel.getByLabel('模式', { exact: true }).selectOption('box');
  await expect(panel.getByRole('slider', { name: '盒 X min', exact: true })).toBeVisible();
  await panel.getByRole('button', { name: '重置剖切', exact: true }).click();
  await expect(panel.getByRole('button', { name: '剖切', exact: true })).toHaveAttribute('aria-pressed', 'false');
  await expect(panel.getByRole('button', { name: '隐藏模型工具', exact: true })).toBeInViewport();
  await panel.getByRole('button', { name: '隐藏模型工具', exact: true }).click();
  await expect(panel).not.toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(320);
});
