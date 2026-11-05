import assert from 'node:assert/strict';
import { copyFile, mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { launchDesktop, prepareWorkspace } from '../../../scripts/capture-dsh-plugin-demo.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const artifacts = path.join(root, 'artifacts/desktop');
await mkdir(artifacts, { recursive: true });
const testHome = process.env.DSH_TEST_HOME ?? '/tmp/filens-dsh-installed-test';
const { app, page } = await launchDesktop(testHome, false);
page.setDefaultTimeout(30000);
await page.addStyleTag({ content: '[aria-hidden="true"][style*="2147483647"] { display: none !important; }' });
const errors = [];
try {
  const environment = await app.evaluate(({ app }) => ({ version: app.getVersion(), node: process.versions.node, electron: process.versions.electron, platform: process.platform, arch: process.arch }));
  page.on('pageerror', error => errors.push(String(error)));
  console.log('DESKTOP', page.url());
  const registrations = await page.evaluate(() => window.__DSH_DEMO_CTX__.documentPreviews.getSnapshot().map(x => ({ id: x.id, extensions: x.extensions.length })));
  const support = JSON.parse(await readFile(path.join(root, 'lib/support.json'), 'utf8'));
  assert.equal(registrations.find(x => x.id === 'dsh-filens')?.extensions, support.extensions.length);
  const repository = path.resolve(root, '../..');
  const fixtures = path.join(testHome, 'Preview Fixtures');
  await mkdir(fixtures, { recursive: true });
  const samples = ['filens-cosmic-atlas.pdf', 'filens-aurora-guide.docx', 'filens-field-notes.pptx', 'filens-weekend.key', 'rounded-cube.step', 'sample-nested-archives.zip'];
  for (const name of samples) await copyFile(path.join(repository, 'apps/demo/public/samples', name), path.join(fixtures, name));
  const sessionId = await prepareWorkspace(page, fixtures);
  const results = [];
  for (const name of samples) {
    await page.evaluate(({ sessionId, name }) => {
      window.__DSH_DEMO_CTX__.get('sidebarRight').openResource(`dsh-resource://file/session/${sessionId}/${name}`);
    }, { sessionId, name });
    await page.locator('.filens-dsh-view').last().waitFor({ timeout: 60000 });
    await page.waitForFunction(() => {
      return ['ready', 'error'].includes([...document.querySelectorAll('.filens-dsh')].at(-1)?.dataset.phase);
    }, null, { timeout: 65000 });
    assert.equal(await page.locator('.filens-dsh').last().getAttribute('data-phase'), 'ready', await page.locator('.filens-dsh-state[role=alert]').allTextContents());
    const viewer = page;
    assert.equal(await page.locator('iframe[title="FiLens preview"]').count(), 0);
    const bounds = await page.locator('.filens-dsh-view').last().boundingBox();
    const shell = await viewer.locator('.pptxv-shell').boundingBox();
    assert.ok(Math.abs(bounds.height - shell.height) < 2, 'Preview must fill the actual DSH sidebar');
    assert.equal(await viewer.locator('.pptxv-toolbar').count(), 0, 'Controls belong to the DSH header');
    if (name.endsWith('.pdf') || name.endsWith('.pptx')) {
      const actions = page.locator('.filens-dsh-actions');
      await actions.waitFor();
      const scale = await actions.locator('output').innerText();
      await actions.locator('[data-action="zoom-in"]').click();
      await actions.locator('output').filter({ hasText: scale }).waitFor({ state: 'hidden' });
      await actions.locator('[data-action="zoom-out"]').click();
      if (process.env.DSH_TEST_FULLSCREEN !== '0') {
        await actions.locator('[data-action="fullscreen"]').click();
        await page.waitForFunction(() => Boolean(document.fullscreenElement));
        await page.evaluate(() => document.exitFullscreen());
      }
    }
    if (name.endsWith('.step')) {
      assert.equal(await viewer.locator('.pptxv-toolbar').isVisible(), false);
      const canvas = viewer.locator('canvas').first();
      assert.equal(Math.round((await canvas.boundingBox()).height), Math.round(bounds.height));
      const initial = await canvas.screenshot();
      const center = await canvas.boundingBox();
      await page.mouse.move(center.x + center.width / 2, center.y + center.height / 2);
      await page.mouse.down();
      await page.mouse.move(center.x + center.width / 2 + 45, center.y + center.height / 2 + 20, { steps: 6 });
      await page.mouse.up();
      await page.mouse.wheel(0, -100);
      assert.notDeepEqual(await canvas.screenshot(), initial);
      await canvas.dblclick();
      const difference = await page.evaluate(async images => {
        const pixels = await Promise.all(images.map(async data => {
          const bitmap = await createImageBitmap(await (await fetch(data)).blob());
          const surface = document.createElement('canvas');
          surface.width = bitmap.width; surface.height = bitmap.height;
          const ctx = surface.getContext('2d'); ctx.drawImage(bitmap, 0, 0); bitmap.close();
          return ctx.getImageData(0, 0, surface.width, surface.height).data;
        }));
        let total = 0, changed = 0;
        for (let i = 0; i < pixels[0].length; i += 4) {
          const delta = [0, 1, 2].map(c => Math.abs(pixels[0][i + c] - pixels[1][i + c]));
          total += delta.reduce((a, b) => a + b, 0);
          if (Math.max(...delta) > 8) changed++;
        }
        return { mean: total / (pixels[0].length / 4 * 3), changed: changed / (pixels[0].length / 4) };
      }, [initial, await canvas.screenshot()].map(bytes => `data:image/png;base64,${bytes.toString('base64')}`));
      assert.ok(difference.mean < 0.1 && difference.changed < 0.005, `Double-click must restore the model, allowing WebGL edge antialiasing: ${JSON.stringify(difference)}`);
    }
    results.push({ name, rendered: true, fillsPane: true, ...(name.endsWith('.step') ? { toolbar: false, orbitZoomAndReset: true } : {}) });
    console.log('DESKTOP PREVIEW PASSED', name);
    await page.screenshot({ path: path.join(artifacts, name + '.png') });
  }
  await page.screenshot({ path: path.join(artifacts, 'installed.png') });
  await writeFile(path.join(artifacts, 'report.json'), JSON.stringify({ environment, url: page.url(), registrations, results, nativeFullscreenTested: process.env.DSH_TEST_FULLSCREEN !== '0', errors }, null, 2) + '\n');
  assert.deepEqual(errors, []);
} finally { await app.close(); }
