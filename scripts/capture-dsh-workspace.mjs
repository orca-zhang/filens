// Real DSH Desktop capture in a fresh profile, using the local plugin build.
import assert from 'node:assert/strict';
import { cp, mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { _electron } from 'playwright';
import { desktopInstrumentation } from './capture-dsh-plugin-demo.mjs';

const repository = fileURLToPath(new URL('../', import.meta.url));
const plugin = path.join(repository, 'integrations/deepseek-harness');
const output = path.join(repository, 'docs/assets/dsh-workspace');
const testHome = await mkdtemp(path.join(os.tmpdir(), 'filens-workspace-'));
const profile = path.join(testHome, 'profiles/desktop');
await mkdir(path.join(profile, 'node_modules'), { recursive: true });
await mkdir(output, { recursive: true });
await symlink(plugin, path.join(profile, 'node_modules/dsh-filens'));
await cp(path.join(plugin, 'workspace'), path.join(profile, 'node_modules/dsh-filens-workspace'), { recursive: true });
await writeFile(path.join(profile, 'package.json'), JSON.stringify({
  name: 'dsh-profile-desktop', private: true,
  dependencies: { 'dsh-filens': `file:${plugin}`, 'dsh-filens-workspace': `file:${path.join(plugin, 'workspace')}` },
  dsh: { profile: { bundles: ['@deepseek-ai/dsh-base', '@deepseek-ai/dsh-web-app', 'dsh-filens'] } },
}, null, 2));
await writeFile(path.join(profile, 'cordis.yml'), '[]\n');
await writeFile(path.join(profile, 'cordis.patch.yml'), '- id: filens-tools\n  disabled: true\n');

const env = { ...process.env, DSH_HOME: testHome };
delete env.ELECTRON_RUN_AS_NODE;
console.log('Launching isolated DSH:', testHome);
const app = await _electron.launch({
  executablePath: process.env.DSH_DESKTOP_EXECUTABLE ?? '/Applications/DeepSeek Harness.app/Contents/MacOS/DeepSeek Harness',
  args: [`--user-data-dir=${path.join(testHome, 'electron')}`], env, locale: 'zh-CN', timeout: 60000,
});
console.log('Electron connected');
app.process().stderr.on('data', data => console.log('DSH stderr:', String(data).slice(0, 2500)));
app.on('close', () => console.log('DSH closed'));
const errors = [], checks = [], screenshots = [];
let page;
try {
  page = await app.firstWindow();
  console.log('First window:', page.url());
  page.setDefaultTimeout(20000);
  page.on('pageerror', error => errors.push(String(error)));
  page.on('console', message => { if (message.type() === 'error') console.log('Browser error:', message.text()); });
  page.on('crash', () => console.log('Renderer crashed'));
  page.on('close', () => console.log('Page closed'));
  await page.addInitScript(desktopInstrumentation);
  console.log('Instrumentation ready');
  const environment = await app.evaluate(({ app, BrowserWindow }) => {
    for (const window of BrowserWindow.getAllWindows()) {
      if (window.webContents.getURL().includes('welcome.html')) window.hide();
      else { window.setContentSize(1600, 1040); window.focus(); }
    }
    return { version: app.getVersion(), electron: process.versions.electron, platform: process.platform, arch: process.arch };
  });
  console.log('Window prepared');
  await page.reload();
  console.log('Page reloaded');
  await page.waitForFunction(() => Boolean(window.__DSH_DEMO_CTX__?.documentPreviews), null, { timeout: 60000 });
  // The shared recorder adds a pointer overlay; still images keep only app UI.
  await page.locator('[aria-hidden="true"][style*="2147483647"]').evaluateAll(nodes => nodes.forEach(node => node.remove()));
  console.log('DSH initialized', JSON.stringify(environment));
  console.log('Buttons:', await page.getByRole('button').allTextContents(), 'Errors:', errors);
  // The host's normal navigation selects the registered full-page workspace.
  await page.getByRole('button', { name: /^(文件工作台|File workspace)$/ }).click();
  await page.locator('.fw-workspace').waitFor();
  assert.equal(await page.locator('.fw-empty').count(), 1);
  checks.push('fresh profile opens the native DSH main panel with an empty file picker');
  await page.mouse.move(1510, 1000);
  async function capture(name) {
    await page.mouse.move(-40, -40);
    await page.screenshot({ path: path.join(output, name), animations: 'disabled', scale: 'css' });
    screenshots.push(name);
    console.log('Captured', name);
  }
  await capture('01-empty.png');

  const samples = [
    ['filens-aurora-guide.docx', '极光观测手册.docx'],
    ['filens-field-notes.pptx', 'Beyond the Visible.pptx'],
    ['photo-alpine-lake.jpg', '阿尔卑斯山湖.jpg'],
    ['filens-cosmic-atlas.pdf', '宇宙图鉴.pdf'],
    ['filens-observatory.xlsx', '观测站数据.xlsx'],
    ['models/orbital-bot.glb', '轨道机器人.glb'],
  ];
  const fixtures = await Promise.all(samples.map(async ([source, name]) => ({
    name, mimeType: 'application/octet-stream', buffer: await readFile(path.join(repository, 'apps/demo/public/samples', source)),
  })));
  await page.locator('.fw-workspace input[type=file]').setInputFiles(fixtures);
  await page.waitForFunction(() => document.querySelectorAll('.fw-card').length === 6
    && [...document.querySelectorAll('.fw-thumb .filens-dsh')].every(view => view.dataset.phase === 'ready')
    && document.querySelectorAll('.fw-thumb .filens-dsh').length === 6, null, { timeout: 90000 });
  assert.equal(await page.locator('.fw-thumb [role=alert]').count(), 0);
  checks.push('six real files render live thumbnails: DOCX, PPTX, JPG, PDF, XLSX, GLB');
  await capture('02-gallery.png');
  await page.getByRole('searchbox', { name: /查找文件|Find a file/ }).fill('宇宙');
  assert.equal(await page.locator('.fw-card').count(), 1);
  await page.getByRole('searchbox', { name: /查找文件|Find a file/ }).fill('');
  await page.getByRole('button', { name: /^(图像|Images)/ }).click();
  assert.equal(await page.locator('.fw-card').count(), 1);
  await page.getByRole('button', { name: /^(全部文件|All files)/ }).click();
  await page.getByRole('button', { name: /列表视图|List view/ }).click();
  assert.equal(await page.locator('.fw-files-list .fw-card').count(), 6);
  checks.push('filename search, category filter and list/grid controls change real file results');
  await page.getByRole('button', { name: /网格视图|Grid view/ }).click();

  async function open(name, shot) {
    const card = page.locator('.fw-card-open').filter({ hasText: name });
    if (await card.count()) await card.click();
    else await page.locator('.fw-file-row').filter({ hasText: name }).click();
    await page.waitForFunction(() => document.querySelector('.fw-stage .filens-dsh')?.dataset.phase === 'ready', null, { timeout: 65000 });
    assert.equal(await page.locator('.fw-stage [role=alert]').count(), 0);
    await page.mouse.move(1510, 1000);
    await capture(shot);
    checks.push(`${name}: shared renderer opens successfully in the main canvas`);
  }
  await open('极光观测手册.docx', '03-document.png');
  const scale = page.locator('.fw-reader-footer .pptxv-zoom-status').first();
  const before = await scale.innerText();
  await page.locator('.fw-reader-footer [data-action=zoom-in]').click();
  await scale.filter({ hasText: before }).waitFor({ state: 'hidden' });
  await page.locator('.fw-reader-footer [data-action=zoom-out]').click();
  await page.getByRole('button', { name: /收起文件信息|Hide file information/ }).click();
  assert.equal(await page.locator('.fw-inspector').count(), 0);
  await page.getByRole('button', { name: /^(文件信息|File information)$/ }).click();
  checks.push('real zoom controls work and the inspector toggles without replacing the document');
  await open('宇宙图鉴.pdf', '04-pdf.png');
  await open('轨道机器人.glb', '05-model.png');
  const canvas = page.locator('.fw-stage canvas').first();
  const beforeOrbit = await canvas.screenshot();
  const bounds = await canvas.boundingBox();
  await page.mouse.move(bounds.x + bounds.width * .5, bounds.y + bounds.height * .45);
  await page.mouse.down();
  await page.mouse.move(bounds.x + bounds.width * .67, bounds.y + bounds.height * .5, { steps: 12 });
  await page.mouse.up();
  assert.notDeepEqual(await canvas.screenshot(), beforeOrbit, 'Dragging changes the rendered model');
  checks.push('3D orbit changes the actual WebGL canvas');
  await open('阿尔卑斯山湖.jpg', '06-image.png');
  await open('Beyond the Visible.pptx', '07-presentation.png');
  await page.getByRole('button', { name: /返回工作台|Back to workspace/ }).click();
  assert.equal(await page.locator('.fw-card').count(), 6);
  // Navigate away using DSH, then return: file references survive panel unmount.
  await page.evaluate(() => window.__DSH_DEMO_CTX__.get('layout').selectPanel(null));
  await page.getByRole('button', { name: /^(文件工作台|File workspace)$/ }).click();
  assert.equal(await page.locator('.fw-card').count(), 6);
  checks.push('native DSH navigation away and back preserves the six browser-selected files');
  await page.evaluate(() => window.__DSH_DEMO_CTX__.get('theme').setTheme('dark'));
  await page.locator('.fw-workspace.fw-dark').waitFor();
  await page.waitForFunction(() => document.querySelectorAll('.fw-thumb .filens-dsh[data-phase=ready]').length === 6, null, { timeout: 65000 });
  await capture('08-gallery-dark.png');
  await page.evaluate(() => window.__DSH_DEMO_CTX__.get('theme').setTheme('light'));
  await page.locator('.fw-workspace:not(.fw-dark)').waitFor();
  checks.push('changing the actual DSH theme updates the workspace and live previews');
  await app.evaluate(({ BrowserWindow }) => {
    for (const window of BrowserWindow.getAllWindows()) if (!window.webContents.getURL().includes('welcome.html')) window.setContentSize(600, 900);
  });
  await page.locator('.fw-card-open').filter({ hasText: '极光观测手册.docx' }).click();
  await page.locator('.fw-mobile-back').waitFor({ state: 'visible' });
  await page.locator('.fw-mobile-back').click();
  assert.equal(await page.locator('.fw-card').count(), 6);
  checks.push('narrow workspace retains a visible back button and restores the file gallery');
  assert.deepEqual(errors, []);
  await writeFile(path.join(output, 'validation.json'), JSON.stringify({
    capturedAt: new Date().toISOString(), environment, url: page.url(),
    scope: 'Real installed DSH Desktop; isolated test home; local source build; no model calls or user profile edits.',
    viewport: { width: 1600, height: 1040 }, samples: samples.map(([source, name], index) => ({ source, name, bytes: fixtures[index].buffer.length })),
    checks, screenshots, errors,
  }, null, 2) + '\n');
  await rm(path.join(output, 'failure.png'), { force: true });
  console.log('Workspace validation passed:', checks.length, 'checks;', screenshots.length, 'screenshots.');
} catch (error) {
  if (page && !page.isClosed()) {
    await page.screenshot({ path: path.join(output, 'failure.png') }).catch(() => {});
    console.log((await page.locator('body').innerText().catch(() => '')).slice(0, 5000));
  }
  console.log('Isolated profile:', testHome);
  throw error;
} finally {
  await app.close();
}
