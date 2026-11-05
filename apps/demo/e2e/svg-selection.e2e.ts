import { resolve } from 'node:path';
import { expect, test } from '@playwright/test';
import { createWideMmFixture } from '../../../packages/mindmap/test/fixtures/maps.mjs';
import { createDrawioFixture } from '../../../packages/diagram/test/fixtures/diagrams.mjs';

for (const family of ['mindmap', 'diagram'] as const) test(`selects ${family} shapes by mouse and keyboard and ignores replaced SVGs`, async ({ page }) => {
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
  await page.goto('./');
  const moduleUrl = new URL(`@fs${resolve(`packages/${family}/src/index.ts`)}`, page.url()).href;
  await page.evaluate(async ({ moduleUrl, family, xml }) => {
    const lib = await import(/* @vite-ignore */ moduleUrl);
    const host = document.createElement('div'); host.style.cssText = 'position:fixed;inset:0;background:white';
    document.body.replaceChildren(host);
    const source = new TextEncoder().encode(xml), context = { descriptor: { source, extension: family === 'mindmap' ? 'mm' : 'drawio' } };
    const session = (family === 'mindmap' ? lib.createMindmapPreviewDriver() : lib.createDiagramPreviewDriver()).createSession(host);
    await session.load(source, context);
    (window as any).svgSelection = { host, session, source, context };
  }, { moduleUrl, family, xml: family === 'mindmap' ? createWideMmFixture(4, true) : createDrawioFixture(4) });
  const nodes = page.locator(family === 'mindmap' ? '.mindmapv-node' : '.diagramv-node');
  const idAttribute = family === 'mindmap' ? 'data-node-id' : 'data-element-id';
  for (const [index, key] of [[1, 'Enter'], [2, 'Space']] as const) {
    await nodes.nth(index).press(key);
    await expect(page.locator('.is-selected')).toHaveCount(1);
    await expect(nodes.nth(index)).toHaveClass(/is-selected/);
  }
  await nodes.nth(3).locator('text').click();
  await expect(nodes.nth(3)).toHaveClass(/is-selected/);
  expect(await page.evaluate(family => {
    const state = (window as any).svgSelection.session.getState();
    return family === 'mindmap' ? state.selectedNodeId : state.selectedElementId;
  }, family)).toBe(await nodes.nth(3).getAttribute(idAttribute));
  const unchanged = await page.evaluate(async () => {
    const { host, session, source, context } = (window as any).svgSelection;
    const oldNode = host.querySelector('.is-selected');
    await session.load(source, context);
    const before = JSON.stringify(session.getState());
    oldNode.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    oldNode.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    const unchanged = before === JSON.stringify(session.getState());
    session.destroy();
    return unchanged && !host.childElementCount;
  });
  expect(unchanged).toBe(true); expect(errors).toEqual([]);
});
