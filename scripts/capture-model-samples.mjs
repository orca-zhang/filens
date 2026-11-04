// Capture the native model previewer. Run with the Vite demo server on port 4173.
// FILENS_DEMO_URL can override the demo URL. No external render or model service.
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const output = path.join(root, 'apps/demo/public/samples/models');
const origin = process.env.FILENS_DEMO_URL ?? 'http://127.0.0.1:4173/modules/filens/';
const manifest = JSON.parse(await readFile(path.join(output, 'manifest.json'), 'utf8'));
const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
try {
  const page = await browser.newPage({ viewport: { width: 720, height: 600 }, deviceScaleFactor: 1 });
  await page.goto(origin);
  const moduleUrl = new URL(`@fs${path.join(root, 'packages/model3d/src/index.ts')}`, origin).href;
  await page.evaluate(async url => {
    const { createModel3dPreviewDriver } = await import(/* @vite-ignore */ url);
    const host = document.createElement('div');
    host.style.cssText = 'position:fixed;inset:0;background:#111827';
    document.body.replaceChildren(host);
    window.modelCaptureSession = createModel3dPreviewDriver().createSession(host);
  }, moduleUrl);
  for (const model of manifest) {
    const source = new URL(`samples/models/${model.file}`, origin).href;
    const result = await page.evaluate(async ({ source, name }) => {
      const session = window.modelCaptureSession;
      await session.load(source, { descriptor: { source, name, extension: name.split('.').at(-1) } });
      const state = session.getState();
      if (state.error) throw new Error(JSON.stringify(state.error));
      await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
      return state.metadata;
    }, { source, name: model.file });
    const webp = await page.locator('canvas.model3dv-canvas').evaluate(canvas => {
      const thumbnail = document.createElement('canvas');
      thumbnail.width = 360; thumbnail.height = 300;
      thumbnail.getContext('2d').drawImage(canvas, 0, 0, 360, 300);
      return thumbnail.toDataURL('image/webp', .9).split(',')[1];
    });
    await writeFile(path.join(output, `${model.id}.webp`), Buffer.from(webp, 'base64'));
    console.log(`${model.file}: ${result.triangleCount} triangles, ${result.meshCount ?? 1} meshes`);
  }
  await page.evaluate(() => window.modelCaptureSession.destroy());

  // The landing card opens the same OBJ file, so capture its actual workbench too.
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(`${origin}?view=preview&format=obj`);
  await page.locator('.wb-runtime-timings').waitFor();
  await page.locator('canvas.model3dv-canvas').waitFor();
  const stage = await page.locator('.wb-preview-stage').screenshot();
  const home = await page.evaluate(async source => {
    const image = new Image(); image.src = source; await image.decode();
    const canvas = document.createElement('canvas'); canvas.width = 1120; canvas.height = 680;
    const ctx = canvas.getContext('2d'); ctx.fillStyle = '#111827'; ctx.fillRect(0, 0, 1120, 680);
    const ratio = Math.min(1120 / image.width, 680 / image.height);
    ctx.drawImage(image, (1120 - image.width * ratio) / 2, (680 - image.height * ratio) / 2, image.width * ratio, image.height * ratio);
    return canvas.toDataURL('image/webp', .9).split(',')[1];
  }, `data:image/png;base64,${stage.toString('base64')}`);
  await writeFile(path.join(root, 'apps/demo/public/home/model.webp'), Buffer.from(home, 'base64'));
} finally {
  await browser.close();
}
