// Records the installed DSH Desktop UI and the public npm plugin, never a mock.
// npm --prefix integrations/deepseek-harness ci
// node scripts/capture-dsh-plugin-demo.mjs
// node scripts/capture-dsh-plugin-demo.mjs --encode-only
// Requires macOS DSH Desktop, Playwright Chromium and ffmpeg on PATH.
import assert from 'node:assert/strict';
import { _electron, chromium } from 'playwright';
import { copyFile, mkdir, mkdtemp, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const work = path.join(root, 'dist/dsh-demo');
const output = path.join(root, 'docs/assets/dsh-plugin');
const executablePath = process.env.DSH_DESKTOP_EXECUTABLE ?? '/Applications/DeepSeek Harness.app/Contents/MacOS/DeepSeek Harness';
const width = 1280, height = 820, captionHeight = 72;
const recordingPath = path.join(work, 'recording.json');
const pluginVersion = process.env.FILENS_DSH_DEMO_VERSION ?? JSON.parse(await readFile(path.join(root, 'integrations/deepseek-harness/package.json'), 'utf8')).version;
const pluginSpec = `dsh-filens@${pluginVersion}`;
const samples = [
  ['filens-aurora-guide.docx', 'Aurora Guide.docx'],
  ['filens-observatory.xlsx', 'Observatory.xlsx'],
  ['filens-field-notes.pptx', 'Field Notes.pptx']
];
await mkdir(work, { recursive: true });
await mkdir(output, { recursive: true });

// Only expose the existing client context to prepare an empty sample workspace.
// All recorded install, file opening and preview actions use the normal UI.
export function desktopInstrumentation({ pointer = false } = {}) {
  const installPointer = () => {
    const pointer = document.createElement('div');
    pointer.setAttribute('aria-hidden', 'true');
    pointer.style.cssText = 'position:fixed;left:-40px;top:-40px;z-index:2147483647;width:18px;height:24px;pointer-events:none';
    pointer.innerHTML = '<svg viewBox="0 0 18 24"><path d="M2 1v19l5-5 4 8 3-1-4-8h7Z" fill="white" stroke="#172b40" stroke-width="1.5" stroke-linejoin="round"/></svg>';
    document.body.append(pointer);
    document.addEventListener('pointermove', event => {
      pointer.style.left = `${event.clientX}px`;
      pointer.style.top = `${event.clientY}px`;
    }, true);
    document.addEventListener('fullscreenchange', () => (document.fullscreenElement ?? document.body).append(pointer));
  };
  if (pointer) {
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', installPointer, { once: true });
    else installPointer();
  }
  if (window !== window.top) return;
  let loader;
  Object.defineProperty(window, '__ModuleLoader__', {
    configurable: true, get: () => loader,
    set(value) {
      let load = value.load;
      Object.defineProperty(value, 'load', {
        configurable: true, set(fn) { load = fn; },
        get() {
          return function (registration) {
            if (['dsh-filens', '@filens/dsh-workspace', '@deepseek-ai/dsh-client-ui-sidebar-documentpreview'].includes(registration.id)) {
              const factory = registration.factory;
              registration = { ...registration, factory(require) {
                const exports = factory(require);
                return { ...exports, apply(ctx, ...args) {
                  window.__DSH_DEMO_CTX__ = ctx;
                  try {
                    const result = exports.apply(ctx, ...args);
                    if (result?.catch) return result.catch(error => { console.error('Plugin apply failed:', registration.id, error.stack ?? String(error)); throw error; });
                    return result;
                  } catch (error) { console.error('Plugin apply failed:', registration.id, error.stack ?? String(error)); throw error; }
                } };
              } };
            }
            return load.call(this, registration);
          };
        }
      });
      loader = value;
    }
  });
}

export async function launchDesktop(home, recordVideo, options = {}) {
  const env = { ...process.env, DSH_HOME: home };
  delete env.ELECTRON_RUN_AS_NODE;
  const app = await _electron.launch({
    executablePath, args: [`--user-data-dir=${path.join(home, 'electron')}`], env,
    locale: options.locale ?? 'zh-CN',
    timeout: 60000
  });
  app.process().stderr.on('data', data => { if (!options.quiet && /Error|failed/.test(String(data))) console.log('DSH:', String(data).slice(0, 2500)); });
  const page = await app.firstWindow();
  await page.addInitScript(desktopInstrumentation, { pointer: options.pointer ?? recordVideo });
  const viewport = await app.evaluate(({ BrowserWindow, screen }, { recordVideo, opaque }) => {
    let viewport = { width: 1280, height: 820 };
    for (const window of BrowserWindow.getAllWindows()) {
      if (window.webContents.getURL().includes('welcome.html')) window.hide();
      else {
        if (opaque) { window.setVibrancy(null); window.setBackgroundColor('#ffffff'); }
        // Match native fullscreen's display aspect ratio. Otherwise Playwright
        // pads 16:9 fullscreen frames into the taller window video with gray.
        const display = screen.getDisplayMatching(window.getBounds());
        viewport = { width: 1280, height: recordVideo ? Math.round(1280 * display.size.height / display.size.width / 2) * 2 : 820 };
        window.setContentSize(viewport.width, viewport.height);
      }
    }
    return viewport;
  }, { recordVideo, opaque: options.opaque });
  await page.reload();
  await page.waitForFunction(() => window.__DSH_DEMO_CTX__?.get('workspaces') && window.__DSH_DEMO_CTX__?.get('uiWorkspace'));
  // Bring the initialized main window forward before testing native fullscreen.
  await app.evaluate(({ BrowserWindow }) => {
    for (const window of BrowserWindow.getAllWindows()) {
      if (!window.webContents.getURL().includes('welcome.html')) window.focus();
    }
  });
  let recording;
  if (recordVideo) {
    await mkdir(path.join(work, 'raw'), { recursive: true });
    const raw = path.join(work, 'raw', `capture-${randomUUID()}.webm`);
    let startedAt, firstFrame;
    const ready = new Promise(resolve => { firstFrame = resolve; });
    // Start after app initialization and synchronize against the first delivered
    // frame. Inferring the start from video duration includes recorder flush time.
    await page.screencast.start({ path: raw, size: viewport, quality: 95,
      onFrame() { if (startedAt === undefined) { startedAt = Date.now(); firstFrame(); } }
    });
    await ready;
    recording = { raw, startedAt, viewport, stop: () => page.screencast.stop() };
  }
  return { app, page, recording };
}

export async function prepareWorkspace(page, directory) {
  const sessionId = await page.evaluate(async directory => {
    const ctx = window.__DSH_DEMO_CTX__;
    const workspace = await ctx.get('workspaces').create({ path: directory });
    const id = await ctx.get('uiWorkspace').connectWorkspace(workspace.workspaceId);
    ctx.get('uiWorkspace').openSession(id);
    return id;
  }, directory);
  await page.waitForFunction(() => window.__DSH_DEMO_CTX__.get('sidebarRight').mounted.getSnapshot());
  await page.evaluate(() => window.__DSH_DEMO_CTX__.get('sidebarRight').openTab('files'));
  return sessionId;
}

async function capture() {
  const home = await mkdtemp(path.join(os.tmpdir(), 'filens-dsh-demo-'));
  const directory = path.join(home, 'Office Demo');
  await mkdir(directory);
  const documents = [];
  for (const [original, name] of samples) {
    const source = path.join(root, 'apps/demo/public/samples', original);
    await copyFile(source, path.join(directory, name));
    const data = await readFile(source);
    documents.push({ name, source: `apps/demo/public/samples/${original}`, bytes: data.length, sha256: createHash('sha256').update(data).digest('hex') });
  }
  const { app, page, recording } = await launchDesktop(home, true);
  const began = Date.now(), segments = [], checks = [];
  const scene = async (zh, en, action, duration = 1800) => {
    const start = Date.now();
    if (action) await action();
    const actionEnd = (Date.now() - began) / 1000;
    await page.waitForTimeout(Math.max(0, duration - (Date.now() - start)));
    segments.push({ zh, en, start: (start - began) / 1000, actionEnd, end: (Date.now() - began) / 1000 });
    console.log(`Recorded: ${en}`);
  };
  const click = async locator => {
    const bounds = await locator.boundingBox();
    if (bounds) await page.mouse.move(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2, { steps: 12 });
    await locator.click();
  };
  const viewer = () => page.frames().find(frame => frame.url().includes('/viewer.html')) ?? page;
  const ready = async family => {
    await page.waitForFunction(() => document.querySelector('.filens-dsh')?.dataset.phase === 'ready', null, { timeout: 65000 });
    await viewer().waitForFunction(family => document.querySelector('.filens-dsh-view, #preview')?.dataset.family === family, family);
    await viewer().evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  };
  let environment, sessionId, installed, installationSource, components;
  try {
    environment = await app.evaluate(({ app }) => ({ dsh: app.getVersion(), platform: process.platform, arch: process.arch, electron: process.versions.electron }));
    await scene('插件 → 添加插件', 'Plugins → Add plugin', async () => {
      await click(page.getByRole('button', { name: '插件', exact: true }));
      await click(page.getByRole('button', { name: '添加插件', exact: true }));
    }, 2200);
    installationSource = await page.getByRole('button', { name: /安装源/ }).innerText();
    assert.match(installationSource, /中国大陆镜像源/);
    await scene(`填写 ${pluginSpec}，点击安装`, `Enter ${pluginSpec} and click Install`, async () => {
      await page.getByRole('textbox', { name: '包名或地址', exact: true }).pressSequentially(pluginSpec, { delay: 100 });
      await page.waitForTimeout(500);
      await click(page.getByRole('button', { name: '安装', exact: true }));
    }, 3300);
    // Network/download waiting is cut, rather than shown as a preview benchmark.
    await page.getByRole('button', { name: '立即启用', exact: true }).waitFor({ timeout: 240000 });
    await scene('安装完成，立即启用', 'Installation complete → Enable now', async () => {
      await page.waitForTimeout(700);
      await click(page.getByRole('button', { name: '立即启用', exact: true }));
      await page.waitForFunction(() => window.__DSH_DEMO_CTX__?.documentPreviews?.getSnapshot().some(item => item.id === 'dsh-filens'), null, { timeout: 65000 });
    }, 2300);
    await page.getByText('FiLens 文档工具与预览', { exact: true }).first().waitFor();
    await scene('文档工具与预览一起启用', 'FiLens Tools and Preview are enabled together', async () => {
      await click(page.getByText('FiLens 文档工具与预览', { exact: true }).first());
      await page.getByText('2 运行中', { exact: false }).waitFor();
    }, 2200);
    checks.push('public npm installation via Desktop UI', 'default installation source unchanged (China mainland mirror)', 'both installed components running');
    installed = JSON.parse(await readFile(path.join(home, 'profiles/desktop/node_modules/dsh-filens/package.json'), 'utf8'));
    assert.equal(installed.version, pluginVersion, 'The recording must use the requested public plugin version.');
    const pluginDirectory = path.join(home, 'profiles/desktop/node_modules/dsh-filens');
    const support = JSON.parse(await readFile(path.join(pluginDirectory, 'lib/support.json'), 'utf8'));
    const require = createRequire(path.join(pluginDirectory, 'package.json'));
    const cli = JSON.parse(await readFile(require.resolve('filens-cli/package.json'), 'utf8'));
    assert.equal(cli.version, installed.dependencies['filens-cli']);
    components = { cli: cli.version, preview: support.previewVersion, extensions: support.extensions.length,
      previewSHA256: createHash('sha256').update(await readFile(path.join(pluginDirectory, 'lib/runtime/filens.js'))).digest('hex') };
    sessionId = await prepareWorkspace(page, directory);
    await page.getByText('Aurora Guide.docx', { exact: true }).waitFor();
    await scene('在工作区文件列表中，点击 Office 文件', 'Click an Office file in the workspace', undefined, 1600);
    await scene('Word 文档：直接在侧栏阅读', 'Word: read directly in the sidebar', async () => {
      await click(page.getByText('Aurora Guide.docx', { exact: true }));
      await ready('flow');
    }, 2600);
    checks.push('DOCX sidebar preview');
    await scene('Excel：保留工作表，可直接切换', 'Excel: switch worksheets inside the preview', async () => {
      await click(page.getByText('文件', { exact: true }).first());
      await click(page.getByText('Observatory.xlsx', { exact: true }));
      await ready('workbook');
      await click(viewer().getByRole('button', { name: 'Night log', exact: true }));
      await viewer().waitForFunction(() => document.querySelector('.filens-dsh-view, #preview').dataset.page === '1');
    }, 2900);
    checks.push('XLSX preview and worksheet switching');
    await scene('PPT：图片和文字直接呈现', 'PowerPoint: open slides directly in DSH', async () => {
      await click(page.getByText('文件', { exact: true }).first());
      await click(page.getByText('Field Notes.pptx', { exact: true }));
      await ready('paged');
    }, 2600);
    await scene('进入全屏，点击画面开始演示', 'Enter fullscreen, then click the slide to focus', async () => {
      await click(page.locator('.filens-dsh-actions [data-action="fullscreen"]').last());
      await viewer().waitForFunction(() => Boolean(document.fullscreenElement));
      await viewer().locator('.pptxv-scroll-area').click({ position: { x: 20, y: 20 } });
    }, 2700);
    await page.screenshot({ path: path.join(work, 'fullscreen.png') });
    const pages = [await viewer().locator('.filens-dsh-view, #preview').getAttribute('data-page')];
    for (const [index, caption] of [[1, '第二页'], [2, '第三页']]) {
      await scene(`Page Down：${caption}`, `Page Down → Slide ${index + 1}`, async () => {
        await page.keyboard.press('PageDown');
        await viewer().waitForFunction(index => document.querySelector('.filens-dsh-view, #preview').dataset.page === String(index), index);
        assert.ok(await viewer().evaluate(() => Boolean(document.fullscreenElement)));
        pages.push(await viewer().locator('.filens-dsh-view, #preview').getAttribute('data-page'));
      }, 2400);
      await page.screenshot({ path: path.join(work, `fullscreen-slide-${index + 1}.png`) });
    }
    assert.deepEqual(pages, ['0', '1', '2']);
    checks.push('real document fullscreen', 'Page Down navigation through all three slides');
    await scene('Esc 退出全屏，回到 DSH', 'Esc returns to DSH', async () => {
      // Chromium reserves Esc for fullscreen. Send it through Electron's native
      // input path; Playwright's renderer-only CDP key does not trigger this.
      await app.evaluate(({ BrowserWindow }) => {
        const window = BrowserWindow.getAllWindows().find(window => !window.webContents.getURL().includes('welcome.html'));
        window.focus();
        window.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'Escape' });
        window.webContents.sendInputEvent({ type: 'keyUp', keyCode: 'Escape' });
      });
      await viewer().waitForFunction(() => !document.fullscreenElement);
    }, 1800);
    checks.push('Escape exits fullscreen');
    await page.screenshot({ path: path.join(work, 'finished.png') });
  } catch (error) {
    await page.screenshot({ path: path.join(work, 'error.png') }).catch(() => {});
    throw error;
  } finally {
    await recording.stop();
    await app.close();
    const offset = (began - recording.startedAt) / 1000;
    await writeFile(recordingPath, JSON.stringify({ capturedAt: new Date().toISOString(), home, directory, raw: recording.raw, viewport: recording.viewport, offset, synchronization: 'first screencast frame delivery', environment, plugin: installed?.version, installationSource, components, sessionId, documents, segments, checks }, null, 2) + '\n');
  }
}

export async function encodeRecording(recordingFile = recordingPath, basename = 'install-and-preview', requiredCheck = 'Escape exits fullscreen', options = {}) {
  const work = path.dirname(recordingFile);
  const recording = JSON.parse(await readFile(recordingFile, 'utf8'));
  const { width, height } = recording.viewport ?? { width: 1280, height: 820 };
  assert.ok(recording.checks.includes(requiredCheck), 'Only encode a completed, verified capture.');
  const ffmpeg = args => execFileSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', ...args], { stdio: 'inherit' });
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width, height: captionHeight }, deviceScaleFactor: 1 });
  const fps = options.fps ?? 25;
  const destination = options.output ?? output;
  await mkdir(destination, { recursive: true });
  const gallery = basename === '3d-and-panorama';
  // Keep the full walkthrough in MP4. The looping images retain short, actual-
  // speed interactions, rather than long pauses or accelerated camera motion.
  const highlights = gallery ? [
    ['Expand the preview and drag to orbit', 0.5, 1.5, '3D：拖拽旋转', '3D: drag to orbit'],
    ['Scroll to zoom into the model', 0, 0.6, '3D：滚轮缩放', '3D: scroll to zoom'],
    ['Header model tools: view and section', 0.3, 3.5, '地址栏模型工具：视图与剖切', 'Header tools: view and section'],
    ['Orbit the assembly to inspect its gears', 0.2, 1.2, '3MF：查看齿轮结构', '3MF: inspect the gears'],
    ['Drag to look around the spherical panorama', 0.2, 1.3, '360° 照片：拖拽环视', '360° photo: look around'],
    ['Header zoom for the spherical photo', 0, 1.5, '地址栏全景缩放', 'Panorama zoom beside the address bar'],
    ['360° video: scrub the bottom timeline', 0, 1.8, '底部进度条：拖动定位', 'Bottom timeline: scrub to seek'],
    ['Play the 360° video and look around while it runs', 0.6, 2.4, '底部控件播放，全景拖拽环视', 'Bottom playback controls and 360° look-around']
  ].map(([en, skip, duration, zh, caption]) => {
    const segment = recording.segments.find(segment => segment.en === en);
    assert.ok(segment, `Missing recorded scene: ${en}`);
    const start = segment.start + skip;
    return { ...segment, start, end: Math.min(segment.end, start + duration), zh, en: caption };
  }) : recording.segments
    .filter(segment => segment.en !== 'Click an Office file in the workspace')
    .map(segment => ({ ...segment, end: Math.min(segment.end, Math.max(segment.start + (options.locale ? 1.8 : 1.2), (segment.actionEnd ?? segment.end - 0.6) + (options.locale ? 0.8 : 0.4))) }));
  const render = async (segments, prefix, target) => {
    const chapters = [];
    let timeline = 0;
    for (const [index, segment] of segments.entries()) {
      await page.evaluate(({ zh, en, index, count, locale }) => {
        document.querySelector('.step').textContent = `${String(index + 1).padStart(2, '0')} / ${count}`;
        document.querySelector('strong').textContent = locale === 'en' ? en : zh;
        document.querySelector('small').textContent = locale ? '' : en;
      }, { ...segment, index, count: segments.length, locale: options.locale });
      const caption = path.join(work, `${prefix}-caption-${index}.png`);
      await page.screenshot({ path: caption });
      const frames = Math.max(1, Math.round((segment.end - segment.start) * fps));
      const chapter = path.join(work, `${prefix}-chapter-${index}.mp4`);
      ffmpeg(['-ss', String(segment.start + recording.offset), '-i', recording.raw,
        '-i', caption, '-filter_complex', `[0:v]setpts=PTS-STARTPTS,scale=${width}:${height}:force_original_aspect_ratio=decrease,pad=${width}:${height + captionHeight}:(ow-iw)/2:0:color=white[ui];[ui][1:v]overlay=0:${height}:format=auto,format=yuv420p[v]`,
        '-map', '[v]', '-an', '-frames:v', String(frames), '-r', String(fps), '-c:v', 'libx264', '-preset', 'fast', '-crf', '17', chapter]);
      chapters.push({ start: timeline, duration: frames / fps, sourceStart: segment.start + recording.offset, zh: segment.zh, en: segment.en });
      timeline = Number((timeline + frames / fps).toFixed(6));
    }
    const concat = path.join(work, `${prefix}-chapters.txt`);
    await writeFile(concat, segments.map((_, index) => `file '${prefix}-chapter-${index}.mp4'`).join('\n') + '\n');
    ffmpeg(['-f', 'concat', '-safe', '0', '-i', concat, '-c', 'copy', '-movflags', '+faststart', target]);
    return chapters;
  };
  const video = path.join(destination, `${basename}.mp4`);
  const shortVideo = path.join(work, 'highlights.mp4');
  let chapters, highlightChapters;
  try {
    await page.setContent('<style>*{box-sizing:border-box}body{margin:0;background:#142334;color:#fff;font-family:system-ui,sans-serif;border-top:2px solid #5da9ec;height:72px;display:flex;align-items:center;gap:18px;padding:8px 28px}.step{font-size:13px;color:#95b9dc;font-variant-numeric:tabular-nums}strong{display:block;font-size:20px;font-weight:600;line-height:1.4}small{font-size:14px;line-height:1.4;color:#b4c8dc}</style><span class="step"></span><div><strong></strong><small></small></div>');
    chapters = await render(recording.segments, 'full', video);
    highlightChapters = await render(highlights, 'short', shortVideo);
  } finally { await browser.close(); }
  const framesDirectory = path.join(work, 'highlight-frames');
  await rm(framesDirectory, { recursive: true, force: true });
  await mkdir(framesDirectory);
  ffmpeg(['-i', shortVideo, '-vf', `fps=${fps},scale=960:-1:flags=lanczos`, path.join(framesDirectory, 'frame-%04d.png')]);
  const webp = path.join(destination, `${basename}.webp`);
  const frames = (await readdir(framesDirectory)).filter(name => name.endsWith('.png')).sort().map(name => path.join(framesDirectory, name));
  execFileSync('img2webp', ['-loop', '0', '-lossy', '-q', '92', '-m', '4', '-d', String(1000 / fps), ...frames, '-o', webp]);
  const gif = path.join(destination, `${basename}.gif`);
  const gifWidth = gallery ? 800 : 960;
  const gifClips = [];
  for (const [index] of highlights.entries()) {
    const clip = path.join(work, `short-chapter-${index}.gif`);
    ffmpeg(['-i', path.join(work, `short-chapter-${index}.mp4`), '-filter_complex', `[0:v]fps=${fps},scale=${gifWidth}:-1:flags=lanczos,split[a][b];[a]palettegen=max_colors=256:stats_mode=full[p];[b][p]paletteuse=dither=sierra2_4a:diff_mode=rectangle`, '-loop', '0', clip]);
    gifClips.push(clip);
  }
  execFileSync('python3', [path.join(root, 'scripts/merge-recording-gifs.py'), gif, ...gifClips], { stdio: 'inherit' });
  const report = {
    recordedAt: recording.capturedAt ?? new Date().toISOString(), environment: recording.environment, plugin: `dsh-filens@${recording.plugin}`,
    installationSource: recording.installationSource, components: recording.components,
    source: recording.installationSource === 'isolated local source build'
      ? 'Installed Desktop application, isolated local source build, actual UI interactions'
      : 'Installed Desktop application, public npm package, actual UI interactions',
    locale: options.locale ?? 'bilingual captions',
    windowCompositing: recording.windowCompositing,
    editing: `Download waits, workspace preparation and verification screenshots are cut. MP4 keeps the full walkthrough. WebP/GIF keep shorter actual-speed highlights with fewer idle holds. Captions are annotations.${recording.pointer === false ? ' No pointer overlay is added.' : ' A pointer annotation may be included.'} This is not a timing comparison.`,
    encoding: { fps, webp: { width: 960, quality: 92, color: 'full color' }, gif: { width: gifWidth, colors: 256, palette: 'adaptive per scene', dither: 'sierra2_4a', optimization: 'lossless frame differences, displayed pixels and timing verified' }, highlightFrames: frames.length, highlightSeconds: frames.length / fps },
    modelCalls: 0, checks: recording.checks, documents: recording.documents, chapters, highlightChapters,
    artifacts: await Promise.all([webp, gif, video].map(async file => ({ path: path.relative(root, file), bytes: (await stat(file)).size, sha256: createHash('sha256').update(await readFile(file)).digest('hex') })))
  };
  await writeFile(path.join(destination, basename === 'install-and-preview' ? 'demo-recording.json' : `${basename}-recording.json`), JSON.stringify(report, null, 2) + '\n');
  console.log(`Saved ${fps} fps, ${frames.length / fps} second highlights: ${path.relative(root, webp)}`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (!process.argv.includes('--encode-only')) await capture();
  if (!process.argv.includes('--capture-only')) await encodeRecording();
}
