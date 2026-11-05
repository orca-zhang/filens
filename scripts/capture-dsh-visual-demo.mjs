// Real DSH Desktop interactions using the public plugin installed by the Office capture.
// node scripts/capture-dsh-visual-demo.mjs [--home /isolated/profile] [--encode-only]
import assert from 'node:assert/strict';
import { copyFile, mkdir, readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { encodeRecording, launchDesktop, prepareWorkspace } from './capture-dsh-plugin-demo.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const work = path.join(root, 'dist/dsh-demo/visual');
const recordingFile = path.join(work, 'recording.json');
await mkdir(work, { recursive: true });

async function capture() {
  const index = process.argv.indexOf('--home');
  const home = index < 0 ? JSON.parse(await readFile(path.join(root, 'dist/dsh-demo/recording.json'), 'utf8')).home : path.resolve(process.argv[index + 1]);
  assert.notEqual(home, path.resolve(process.env.HOME, '.dsh'), 'Use an isolated capture profile.');
  const installed = JSON.parse(await readFile(path.join(home, 'profiles/desktop/node_modules/dsh-filens/package.json'), 'utf8'));
  const directory = path.join(home, 'Visual Gallery');
  await mkdir(directory, { recursive: true });
  const documents = [];
  // These are the same source bytes. Explicit .pano / .360v names select the
  // supported spherical routes; ordinary .jpg / .webm retain their normal view.
  for (const [source, name] of [
    ['models/orbital-bot.glb', 'Orbital Bot.glb'],
    ['models/planetary-gearbox.3mf', 'Planetary Gearbox.3mf'],
    ['showcase/milky-way-360.jpg', 'Milky Way.pano'],
    ['panorama/nasa-black-hole-360.webm', 'NASA Black Hole.360v']
  ]) {
    const original = path.join(root, 'apps/demo/public/samples', source);
    await copyFile(original, path.join(directory, name));
    const data = await readFile(original);
    documents.push({ name, source: `apps/demo/public/samples/${source}`, bytes: data.length, sha256: createHash('sha256').update(data).digest('hex') });
  }
  const { app, page, recording } = await launchDesktop(home, true);
  const began = Date.now(), segments = [], checks = [];
  const viewer = () => page.frames().find(frame => frame.url().includes('/viewer.html'));
  const scene = async (zh, en, action, duration = 2600) => {
    const start = Date.now();
    await action();
    const actionEnd = (Date.now() - began) / 1000;
    await page.waitForTimeout(Math.max(0, duration - (Date.now() - start)));
    segments.push({ zh, en, start: (start - began) / 1000, actionEnd, end: (Date.now() - began) / 1000 });
    console.log(`Recorded: ${en}`);
  };
  const click = async locator => {
    const bounds = await locator.boundingBox();
    if (bounds) await page.mouse.move(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2, { steps: 10 });
    await locator.click();
  };
  const open = async (name, family) => {
    await click(page.getByText('文件', { exact: true }).first());
    await click(page.getByText(name, { exact: true }));
    await page.waitForFunction(() => ['ready', 'error'].includes(document.querySelector('iframe[title="FiLens preview"]')?.parentElement.dataset.phase), null, { timeout: 65000 });
    assert.equal(await page.locator('iframe[title="FiLens preview"]').evaluate(node => node.parentElement.dataset.phase), 'ready');
    await viewer().waitForFunction(family => document.querySelector('#preview')?.dataset.family === family, family);
  };
  const drag = async (selector, dx, dy) => {
    const bounds = await viewer().locator(selector).boundingBox();
    assert.ok(bounds && bounds.width > 100 && bounds.height > 100);
    const x = bounds.x + bounds.width / 2, y = bounds.y + bounds.height / 2;
    await page.mouse.move(x, y, { steps: 12 });
    await page.mouse.down();
    for (let i = 1; i <= 35; i++) {
      await page.mouse.move(x + dx * i / 35, y + dy * i / 35);
      await page.waitForTimeout(25);
    }
    await page.mouse.up();
  };
  let environment;
  try {
    environment = await app.evaluate(({ app }) => ({ dsh: app.getVersion(), platform: process.platform, arch: process.arch, electron: process.versions.electron }));
    await prepareWorkspace(page, directory);
    await scene('3D：打开太空机器人 GLB', '3D: open a space robot GLB', () => open('Orbital Bot.glb', 'model3d'), 2300);
    await scene('展开预览，直接拖拽旋转', 'Expand the preview and drag to orbit', async () => {
      await click(page.getByRole('button', { name: '全屏', exact: true }));
      await drag('.model3dv-canvas', 180, 30);
    }, 3600);
    await scene('滚轮缩放，查看模型细节', 'Scroll to zoom into the model', async () => {
      await page.mouse.wheel(0, -240);
    }, 1800);
    checks.push('GLB render, orbit and zoom through actual pointer input');
    await page.screenshot({ path: path.join(work, 'robot.png') });
    await scene('3MF：多部件行星齿轮箱', '3MF: inspect a multi-part planetary gearbox', () => open('Planetary Gearbox.3mf', 'model3d'), 2300);
    await scene('旋转模型，观察内部齿轮结构', 'Orbit the assembly to inspect its gears', () => drag('.model3dv-canvas', -160, 90), 3300);
    checks.push('3MF render and orbit');
    await page.screenshot({ path: path.join(work, 'gearbox.png') });
    await scene('360° 全景照片：置身银河之下', '360° photo: stand beneath the Milky Way', () => open('Milky Way.pano', 'panorama'), 2300);
    await scene('拖拽环视，探索完整球面', 'Drag to look around the spherical panorama', () => drag('.panoramav-canvas', -380, 35), 3600);
    checks.push('spherical photo render and look-around');
    await page.screenshot({ path: path.join(work, 'panorama-photo.png') });
    await scene('360° 视频：拖动进度条，进入黑洞之旅', '360° video: scrub to NASA’s black-hole journey', async () => {
      await open('NASA Black Hole.360v', 'panorama-video');
      const timeline = viewer().getByRole('slider', { name: 'Panorama video position', exact: true });
      const bounds = await timeline.boundingBox();
      await timeline.click({ position: { x: bounds.width * 0.37, y: bounds.height / 2 } });
      await viewer().waitForFunction(() => document.querySelector('video')?.currentTime > 24);
    }, 3000);
    await scene('播放全景视频，同时拖拽改变视角', 'Play the 360° video and look around while it runs', async () => {
      await click(viewer().getByRole('button', { name: 'Play panorama video', exact: true }));
      await viewer().waitForFunction(() => { const video = document.querySelector('video'); return video && !video.paused && video.currentTime > 26; });
      await drag('.panoramav-canvas', 220, -30);
      assert.ok(await viewer().locator('video').evaluate(video => !video.paused && video.currentTime > 27));
    }, 4400);
    checks.push('panorama video timeline seeking', 'panorama video playback and look-around');
    await page.screenshot({ path: path.join(work, 'panorama-video.png') });
  } catch (error) {
    await page.screenshot({ path: path.join(work, 'error.png') }).catch(() => {});
    throw error;
  } finally {
    await recording.stop();
    await app.close();
    const offset = (began - recording.startedAt) / 1000;
    await writeFile(recordingFile, JSON.stringify({ home, directory, raw: recording.raw, viewport: recording.viewport, offset, synchronization: 'first screencast frame delivery', environment, plugin: installed.version, documents, segments, checks }, null, 2) + '\n');
  }
}

if (!process.argv.includes('--encode-only')) await capture();
await encodeRecording(recordingFile, '3d-and-panorama', 'panorama video playback and look-around');
