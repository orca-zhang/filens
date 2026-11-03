import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { _electron } from 'playwright';

const root = fileURLToPath(new URL('../', import.meta.url));
const artifacts = path.join(root, 'artifacts/desktop');
await mkdir(artifacts, { recursive: true });
const executablePath = process.env.DSH_DESKTOP_EXECUTABLE ?? '/Applications/DeepSeek Harness.app/Contents/MacOS/DeepSeek Harness';
const testHome = process.env.DSH_TEST_HOME ?? '/tmp/filens-dsh-installed-test';
const childEnv = { ...process.env, DSH_HOME: testHome };
delete childEnv.ELECTRON_RUN_AS_NODE;
const app = await _electron.launch({ executablePath, args: [`--user-data-dir=${path.join(testHome, 'electron')}`], env: childEnv, timeout: 60000 });
const errors = [];
try {
  const environment = await app.evaluate(({ app }) => ({ version: app.getVersion(), node: process.versions.node, electron: process.versions.electron, platform: process.platform, arch: process.arch }));
  const page = await app.firstWindow();
  page.on('pageerror', error => errors.push(String(error)));
  // Capture the real client context for test navigation. Instrument the loader,
  // leaving the installed plugin and its compiled artifact unmodified.
  await page.addInitScript(() => {
    let loader;
    Object.defineProperty(window, '__ModuleLoader__', {
      configurable: true, get: () => loader, set(value) {
        let load = value.load;
        Object.defineProperty(value, 'load', { configurable: true, set(fn) { load = fn; }, get() {
          return function (registration) {
            if (registration.id === 'dsh-filens') {
              const factory = registration.factory;
              registration = { ...registration, factory(require) {
                const exports = factory(require);
                return { ...exports, apply(ctx, ...args) {
                  window.__FILENS_TEST_CTX__ = ctx;
                  window.__FILENS_TEST_EXPORTS__ = exports;
                  return exports.apply(ctx, ...args);
                } };
              } };
            }
            return load.call(this, registration);
          };
        } });
        loader = value;
      },
    });
  });
  await page.reload();
  await page.waitForFunction(() => window.__FILENS_TEST_CTX__, null, { timeout: 60000 });
  console.log('DESKTOP', page.url());
  const registrations = await page.evaluate(() => window.__FILENS_TEST_CTX__.documentPreviews.getSnapshot().map(x => ({ id: x.id, extensions: x.extensions.length })));
  assert.equal(registrations.find(x => x.id === 'dsh-filens')?.extensions, 397);
  const repository = path.resolve(root, '../..');
  const sessionId = await page.evaluate(async repository => {
    const ctx = window.__FILENS_TEST_CTX__;
    const workspace = await ctx.get('workspaces').create({ path: repository });
    const sessionId = await ctx.get('uiWorkspace').connectWorkspace(workspace.workspaceId);
    ctx.get('uiWorkspace').openSession(sessionId);
    return sessionId;
  }, repository);
  await page.waitForFunction(() => window.__FILENS_TEST_CTX__.get('sidebarRight').mounted.getSnapshot());
  const results = [];
  for (const name of ['filens-aurora-guide.docx', 'filens-weekend.key', 'rounded-cube.step', 'sample-nested-archives.zip']) {
    await page.evaluate(({ sessionId, name }) => {
      window.__FILENS_TEST_CTX__.get('sidebarRight').openResource(`dsh-resource://file/session/${sessionId}/apps/demo/public/samples/${name}`);
    }, { sessionId, name });
    const frame = page.frameLocator('iframe[title="FiLens preview"]').last();
    await frame.locator('#preview').waitFor({ timeout: 60000 });
    await page.waitForFunction(() => {
      const iframe = [...document.querySelectorAll('iframe[title="FiLens preview"]')].at(-1);
      return iframe?.parentElement.dataset.phase === 'ready';
    }, null, { timeout: 65000 });
    const viewer = page.frames().find(frame => frame.url().includes('/viewer.html'));
    const bounds = await page.locator('iframe[title="FiLens preview"]').last().boundingBox();
    const shell = await viewer.locator('.pptxv-shell').boundingBox();
    assert.ok(Math.abs(bounds.height - shell.height) < 2, 'Preview must fill the actual DSH sidebar');
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
      assert.deepEqual(await canvas.screenshot(), initial, 'Double-click must restore the model in the actual DSH pane');
    }
    results.push({ name, rendered: true, fillsPane: true, ...(name.endsWith('.step') ? { toolbar: false, orbitZoomAndReset: true } : {}) });
    console.log('DESKTOP PREVIEW PASSED', name);
    await page.screenshot({ path: path.join(artifacts, name + '.png') });
  }
  await page.screenshot({ path: path.join(artifacts, 'installed.png') });
  await writeFile(path.join(artifacts, 'report.json'), JSON.stringify({ environment, url: page.url(), registrations, results, errors }, null, 2) + '\n');
  assert.deepEqual(errors, []);
} finally { await app.close(); }
