import { resolve } from 'node:path';
import { expect, test, type CDPSession, type Page } from '@playwright/test';
import { createGlbFixture } from '../../../packages/model3d/test/fixtures/mesh.mjs';

test.use({ hasTouch: true, isMobile: true, viewport: { width: 390, height: 844 } });

async function touch(
  page: Page, cdp: CDPSession,
  type: 'touchStart' | 'touchMove' | 'touchEnd' | 'touchCancel',
  touchPoints: Array<{ id: number; x: number; y: number }>
): Promise<void> {
  await cdp.send('Input.dispatchTouchEvent', { type, touchPoints });
  // Touch moves can be delivered on the next frame after the protocol call returns.
  await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => resolve())));
}

async function prepare(page: Page): Promise<void> {
  await page.goto('./');
  const url = new URL(`@fs${resolve('packages/model3d/src/index.ts')}`, page.url()).href;
  await page.evaluate(async ({ url, bytes }) => {
    const { createModel3dPreviewDriver } = await import(/* @vite-ignore */ url);
    const host = document.createElement('div');
    host.style.cssText = 'position:fixed;inset:0';
    document.body.replaceChildren(host);
    const session = createModel3dPreviewDriver().createSession(host);
    (window as any).modelTouchTest = { session };
    const source = new Uint8Array(bytes);
    await session.load(source, { descriptor: { source, name: 'triangle.glb', extension: 'glb' } });
    session.setCameraViewPreset('front');
    await new Promise<void>(resolve => requestAnimationFrame(() => resolve()));
  }, { url, bytes: [...createGlbFixture()] });
  await expect(page.locator('canvas.model3dv-canvas')).toBeVisible();
}

test('mobile touch gestures orbit, pinch and resume after a finger is lifted or cancelled', async ({ page, browserName }) => {
  test.skip(browserName !== 'chromium', 'Native multi-touch injection uses the Chromium DevTools protocol.');
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await prepare(page);
  const cdp = await page.context().newCDPSession(page);
  const state = () => page.evaluate(() => (window as any).modelTouchTest.session.getState());
  const finger = (id: number, x: number, y = 300) => ({ id, x, y });
  const initial = await state();
  await touch(page, cdp, 'touchStart', [finger(1, 100)]);
  await touch(page, cdp, 'touchMove', [finger(1, 140)]);
  const orbited = await state();
  expect(orbited.camera.position).not.toEqual(initial.camera.position);
  expect(orbited.camera.viewPreset).toBe('free');

  await touch(page, cdp, 'touchStart', [finger(1, 140), finger(2, 240)]);
  await touch(page, cdp, 'touchMove', [finger(1, 140), finger(2, 340)]);
  const pinched = await state();
  expect(pinched.scale).toBeCloseTo(2);
  expect(pinched.camera.position[0] / pinched.camera.position[2]).toBeCloseTo(orbited.camera.position[0] / orbited.camera.position[2]);

  await touch(page, cdp, 'touchEnd', [finger(2, 340)]);
  await touch(page, cdp, 'touchMove', [finger(1, 160)]);
  expect((await state()).camera.position).not.toEqual(pinched.camera.position);
  expect((await state()).scale).toBeCloseTo(2);
  await touch(page, cdp, 'touchCancel', []);
  const cancelled = await state();
  await page.mouse.move(250, 350);
  expect((await state()).camera).toEqual(cancelled.camera);
  await touch(page, cdp, 'touchStart', [finger(3, 100)]);
  await touch(page, cdp, 'touchMove', [finger(3, 120)]);
  await touch(page, cdp, 'touchEnd', []);
  expect((await state()).camera.position).not.toEqual(cancelled.camera.position);
  expect(await page.evaluate(() => window.visualViewport!.scale)).toBe(1);
  expect(errors).toEqual([]);
});

test('native touch taps still pick measurement points', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await prepare(page);
  await page.evaluate(() => (window as any).modelTouchTest.session.setMeasurementActive(true));
  const bounds = (await page.locator('canvas.model3dv-canvas').boundingBox())!;
  await page.touchscreen.tap(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2);
  const measurement = await page.evaluate(() => (window as any).modelTouchTest.session.getState().measurement);
  expect(measurement.status).toBe('pick-end');
  expect(measurement.start).toHaveLength(3);
  expect(errors).toEqual([]);
});

test('demo upload reflects pinch zoom and keeps mobile zoom buttons reachable', async ({ page, browserName }) => {
  test.skip(browserName !== 'chromium', 'Native multi-touch injection uses the Chromium DevTools protocol.');
  await page.goto('./?view=preview&lang=zh');
  await expect(page.locator('.wb-status')).toHaveText('预览就绪');
  await page.locator('input[type=file]').setInputFiles({
    name: 'triangle.glb', mimeType: 'model/gltf-binary', buffer: Buffer.from(createGlbFixture())
  });
  const canvas = page.locator('canvas.model3dv-canvas');
  await expect(canvas).toBeVisible();
  await canvas.scrollIntoViewIfNeeded();
  const bounds = (await canvas.boundingBox())!;
  const x = bounds.x + bounds.width / 2;
  const y = bounds.y + bounds.height / 2;
  const cdp = await page.context().newCDPSession(page);
  await touch(page, cdp, 'touchStart', [{ id: 1, x: x - 40, y }, { id: 2, x: x + 40, y }]);
  await touch(page, cdp, 'touchMove', [{ id: 1, x: x - 80, y }, { id: 2, x: x + 80, y }]);
  await touch(page, cdp, 'touchEnd', []);
  await page.getByRole('button', { name: '显示模型工具', exact: true }).tap();
  await expect(page.locator('.pptxv-status').filter({ hasText: /^200%$/ })).toBeVisible();
  await page.getByRole('button', { name: '放大', exact: true }).tap();
  await expect(page.locator('.pptxv-status').filter({ hasText: /^210%$/ })).toBeVisible();
});
