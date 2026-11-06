// Record localized release demos in the installed Desktop, using synthetic history.
// node scripts/capture-dsh-release.mjs --locale zh-CN --package-dir /path/to/dsh-filens
// node scripts/capture-dsh-release.mjs --locale en --encode-only
import assert from 'node:assert/strict';
import { copyFile, cp, mkdir, mkdtemp, readFile, symlink, writeFile } from 'node:fs/promises';
import { createHash, randomUUID } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { encodeRecording, launchDesktop } from './capture-dsh-plugin-demo.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const argument = (name, fallback) => {
  const index = process.argv.indexOf(name);
  return index < 0 ? fallback : process.argv[index + 1];
};
const locale = argument('--locale', 'zh-CN');
assert.ok(['zh-CN', 'en'].includes(locale));
const zh = locale === 'zh-CN';
const text = (cn, en) => zh ? cn : en;
const plugin = path.resolve(argument('--package-dir', path.join(root, 'integrations/deepseek-harness')));
const work = path.join(root, 'dist/dsh-release-demos', locale);
const output = path.join(root, 'docs/assets/dsh-release');
const topics = ['office-preview', '3d-and-panorama', 'file-workspace'];
await mkdir(work, { recursive: true });
await mkdir(output, { recursive: true });

async function capture() {
  const home = await mkdtemp(path.join(os.tmpdir(), 'filens-release-'));
  const profile = path.join(home, 'profiles/desktop');
  const directory = path.join(home, 'Documents');
  await mkdir(path.join(profile, 'node_modules'), { recursive: true });
  await mkdir(directory);
  await symlink(plugin, path.join(profile, 'node_modules/dsh-filens'));
  const workspace = path.join(plugin, 'node_modules/@filens/dsh-workspace');
  await cp(argument('--workspace-dir', workspace), path.join(profile, 'node_modules/@filens/dsh-workspace'), { recursive: true });
  await writeFile(path.join(profile, 'package.json'), JSON.stringify({ name: 'filens-release-demo', private: true,
    dependencies: { 'dsh-filens': `file:${plugin}`, '@filens/dsh-workspace': 'file:./node_modules/@filens/dsh-workspace' },
    dsh: { profile: { bundles: ['@deepseek-ai/dsh-base', '@deepseek-ai/dsh-web-app', 'dsh-filens'] } } }));
  await writeFile(path.join(profile, 'cordis.yml'), '[]\n');
  await writeFile(path.join(profile, 'cordis.patch.yml'), '- id: filens-tools\n  disabled: true\n');
  const definitions = [
    [text('filens-aurora-guide.zh-CN.docx', 'filens-aurora-guide.docx'), text('极光观测手册.docx', 'Aurora Guide.docx')],
    [text('filens-observatory.zh-CN.xlsx', 'filens-observatory.xlsx'), text('观测站数据.xlsx', 'Observatory.xlsx')],
    [`filens-introduction.${locale}.pptx`, text('FiLens 介绍.pptx', 'FiLens Introduction.pptx')],
    ['filens-cosmic-atlas.pdf', text('宇宙图鉴.pdf', 'Cosmic Atlas.pdf')],
    ['photo-alpine-lake.jpg', text('山间湖泊.jpg', 'Alpine Lake.jpg')],
    ['models/orbital-bot.glb', text('轨道机器人.glb', 'Orbital Bot.glb')],
    ['models/planetary-gearbox.3mf', text('行星齿轮箱.3mf', 'Planetary Gearbox.3mf')],
    ['showcase/milky-way-360.jpg', text('银河全景.pano', 'Milky Way.pano')],
    ['panorama/nasa-black-hole-360.webm', text('黑洞之旅.360v', 'Black Hole.360v')],
  ];
  const documents = [];
  for (const [source, name] of definitions) {
    const file = path.join(root, 'apps/demo/public/samples', source);
    await copyFile(file, path.join(directory, name));
    const bytes = await readFile(file);
    documents.push({ name, source: `apps/demo/public/samples/${source}`, bytes: bytes.length,
      sha256: createHash('sha256').update(bytes).digest('hex') });
  }
  const names = definitions.map(([, name]) => name);
  const codeName = text('观测计划.py', 'observation.py');
  await writeFile(path.join(directory, codeName), 'from datetime import datetime\n\nprint("Plan the next observation", datetime.now())\n');
  const titles = [text('极光观测计划', 'Night watch'), text('现场素材整理', 'Field notes')];
  const questions = [text('请核对观测手册和数据表，并准备一份分享幻灯片。', 'Review the observing guide and spreadsheet, and prepare presentation slides.'),
    text('请整理这些现场照片、模型和观测脚本。', 'Organize these field photos, models and observing scripts.')];
  const sessions = [];
  for (const [index, references] of [[0, names.slice(0, 4)], [1, [names[4], names[5], codeName]]]) {
    const id = `session-${randomUUID()}`, messageId = `demo-question-${index}`;
    sessions.push({ id, messageId });
    const header = { type: 'session', version: 4, id, createdAt: Date.now(), cwd: directory, isSeeded: false, delegationDepth: 0 };
    const events = [];
    const emit = (type, data, surface = false) => events.push({ type, seq: events.length, time: header.createdAt + events.length,
      data, ...(surface ? { surfaceOp: 'append' } : {}) });
    emit('session/title', { title: titles[index], messageSeqs: [], source: { kind: 'user' } });
    emit('turn/start', { turn: 1 });
    emit('user/message', { id: messageId, role: 'user', source: { kind: 'user' }, content: [{ type: 'text', text: questions[index] }] }, true);
    emit('step/start', { turn: 1, step: 1 });
    emit('assistant/message', { turn: 1, step: 1, message: { id: `demo-answer-${index}`, role: 'assistant',
      source: { kind: 'model', provider: 'fixture', model: 'fixture' }, content: [{ type: 'text',
        text: text('已整理相关文件：', 'The files are ready: ') + references.map(name => `[${name}](${encodeURI(name)})`).join(' · ')
          + (index === 0 ? text('\n临时锁文件：', '\nTemporary lock file: ') + `\`~$${names[0]}\`` : '') }] }, stream: [] }, true);
    emit('step/end', { turn: 1, step: 1 });
    emit('turn/end', { turn: 1, reason: { kind: 'completed' } });
    const bucket = `--${directory.replace(/[/\\:]+/g, '-').replace(/^-+/, '')}--`;
    const stored = path.join(home, 'sessions', bucket, id, 'session.v4.jsonl.zstd');
    await mkdir(path.dirname(stored), { recursive: true });
    const frames = [JSON.stringify(header) + '\n', events.map(row => JSON.stringify(row)).join('\n') + '\n'].map(input => {
      const result = spawnSync('zstd', ['-q', '-c'], { input });
      assert.equal(result.status, 0);
      return result.stdout;
    });
    await writeFile(stored, Buffer.concat(frames));
  }
  const { app, page, recording } = await launchDesktop(home, true, { locale, pointer: false, quiet: true, opaque: true });
  page.setDefaultTimeout(30000);
  const began = Date.now(), films = new Map(topics.map(topic => [topic, { segments: [], checks: [] }]));
  let topic, environment;
  // Native fullscreen transitions can restore macOS's translucent window backing.
  const opaqueBackground = color => app.evaluate(({ BrowserWindow }, color) => {
    for (const window of BrowserWindow.getAllWindows()) if (!window.webContents.getURL().includes('welcome.html')) {
      window.setVibrancy(null);
      window.setBackgroundColor(color);
    }
  }, color);
  const click = async locator => {
    await locator.scrollIntoViewIfNeeded();
    const rect = await locator.boundingBox();
    if (rect) await page.mouse.move(rect.x + rect.width / 2, rect.y + rect.height / 2, { steps: 10 });
    await locator.click();
  };
  const scene = async (cn, en, action, hold = 900) => {
    const start = (Date.now() - began) / 1000;
    if (action) await action();
    const actionEnd = (Date.now() - began) / 1000;
    await page.waitForTimeout(hold);
    films.get(topic).segments.push({ zh: cn, en, start, actionEnd, end: (Date.now() - began) / 1000 });
    films.get(topic).checks.push(en);
    console.log(`${locale} / ${topic}: ${en}`);
  };
  const sidebarReady = async family => {
    await page.locator('.filens-dsh[data-phase=ready]').last().waitFor({ timeout: 65000 });
    await page.locator(`.filens-dsh-view[data-family="${family}"]`).last().waitFor();
  };
  const openSidebar = async (name, family) => {
    await click(page.getByText(text('文件', 'Files'), { exact: true }).first());
    await click(page.getByRole('list').getByRole('button', { name, exact: true }).last());
    await sidebarReady(family);
  };
  const drag = async (selector, dx, dy) => {
    const rect = await page.locator(selector).boundingBox();
    assert.ok(rect && rect.width > 100 && rect.height > 100);
    const x = rect.x + rect.width * .5, y = rect.y + rect.height * .5;
    await page.mouse.move(x, y, { steps: 10 });
    await page.mouse.down();
    for (let step = 1; step <= 28; step++) {
      await page.mouse.move(x + dx * step / 28, y + dy * step / 28);
      await page.waitForTimeout(25);
    }
    await page.mouse.up();
  };
  try {
    environment = await app.evaluate(({ app }) => ({ dsh: app.getVersion(), platform: process.platform, arch: process.arch, electron: process.versions.electron }));
    await page.evaluate(locale => window.__DSH_DEMO_CTX__.get('locale').setLocale(locale), zh ? 'zh' : 'en');
    await page.waitForFunction(zh => document.documentElement.lang.startsWith(zh ? 'zh' : 'en'), zh);
    await page.evaluate(() => window.__DSH_DEMO_CTX__.get('theme').setTheme('dark'));
    await page.waitForTimeout(150);
    await page.evaluate(() => window.__DSH_DEMO_CTX__.get('theme').setTheme('light'));
    await opaqueBackground('#ffffff');
    assert.equal(await page.locator('[aria-hidden="true"][style*="2147483647"]').count(), 0, 'No duplicate pointer overlay');
    await page.evaluate(async () => { await window.__DSH_DEMO_CTX__.get('sessions').refresh(); });
    await page.waitForFunction(id => Boolean(window.__DSH_DEMO_CTX__.get('sessions').list.getSnapshot().byId[id]), sessions[0].id);
    await page.evaluate(id => window.__DSH_DEMO_CTX__.get('uiWorkspace').openSession(id), sessions[0].id);
    await page.waitForFunction(() => window.__DSH_DEMO_CTX__.get('sidebarRight').mounted.getSnapshot());
    await page.evaluate(() => window.__DSH_DEMO_CTX__.get('sidebarRight').openTab('files'));
    topic = 'office-preview';
    await scene('Word：在 DSH 侧栏直接阅读', 'Word: read directly in the DSH sidebar', async () => {
      await click(page.getByRole('list').getByRole('button', { name: names[0], exact: true }).last());
      await sidebarReady('flow');
      assert.ok((await page.locator('.docx-wrapper').innerText()).includes(text('追寻极光', 'Chasing the light')));
      films.get(topic).checks.push('Word document body matches the recording language');
    }, 1400);
    await scene('展开阅读，缩放工具就在地址栏旁', 'Expand the preview; zoom beside the address bar', async () => {
      await click(page.locator('[data-sidebar-right-mode=fullscreen]'));
      const zoom = page.locator('.filens-dsh-actions .pptxv-zoom-status');
      assert.equal(await zoom.innerText(), '100%');
      await click(page.locator('.filens-dsh-actions [data-action=zoom-in]'));
      assert.notEqual(await zoom.innerText(), '100%');
      await click(page.locator('.filens-dsh-actions [data-action=zoom-out]'));
    });
    await scene('Excel：切换工作表，保留表格结构', 'Excel: switch sheets without leaving the preview', async () => {
      await openSidebar(names[1], 'workbook');
      await click(page.locator('.filens-dsh-actions .pptxv-format-controls > summary'));
      await click(page.getByRole('button', { name: text('观测日志', 'Night log'), exact: true }));
      await page.waitForFunction(() => document.querySelector('.filens-dsh-view')?.dataset.page === '1');
      await click(page.locator('.filens-dsh-actions .pptxv-format-controls > summary'));
    }, 1500);
    await scene('PowerPoint：打开 FiLens 介绍', 'PowerPoint: open the FiLens introduction', async () => {
      await openSidebar(names[2], 'paged');
      const content = await page.locator('.pptxv-scroll-area').innerText();
      assert.ok(content.includes(text('把文件理解', 'File intelligence')), 'Localized FiLens introduction is rendered');
      assert.equal(await page.locator('.filens-dsh-view').getAttribute('data-page'), '0');
      films.get(topic).checks.push('FiLens introduction cover matches the recording language');
    }, 1800);
    await page.screenshot({ path: path.join(output, `${topic}.${locale}.png`), scale: 'css' });
    await scene('全屏演示，Page Down 翻页', 'Present fullscreen; Page Down advances slides', async () => {
      await click(page.locator('.filens-dsh-actions [data-action=fullscreen]'));
      await page.waitForFunction(() => Boolean(document.fullscreenElement));
      await page.locator('.pptxv-scroll-area').click({ position: { x: 20, y: 20 } });
      await page.waitForTimeout(750);
      await page.keyboard.press('PageDown');
      await page.waitForFunction(() => document.querySelector('.filens-dsh-view')?.dataset.page === '1');
      assert.ok((await page.locator('.pptxv-scroll-area').innerText()).includes(text('让应用自己读懂文件', 'Let your app understand files')));
    }, 1200);
    await scene('Esc 退出，回到 DSH', 'Esc returns to DSH', async () => {
      await app.evaluate(({ BrowserWindow }) => {
        const window = BrowserWindow.getAllWindows().find(w => !w.webContents.getURL().includes('welcome.html'));
        window.focus();
        window.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'Escape' });
        window.webContents.sendInputEvent({ type: 'keyUp', keyCode: 'Escape' });
      });
      await page.waitForFunction(() => !document.fullscreenElement);
      await opaqueBackground('#ffffff');
    });
    topic = '3d-and-panorama';
    await openSidebar(names[5], 'model3d');
    await scene('3D 模型：拖拽旋转，滚轮缩放', '3D models: drag to orbit and scroll to zoom', async () => {
      const before = await page.locator('.model3dv-canvas').screenshot();
      await drag('.model3dv-canvas', 180, 30);
      assert.notDeepEqual(await page.locator('.model3dv-canvas').screenshot(), before);
      await page.mouse.wheel(0, -160);
    }, 1300);
    await scene('模型工具：视图、投影和剖切', 'Model tools: view, projection and section', async () => {
      const header = page.locator('.filens-dsh-actions');
      await click(header.getByRole('button', { name: text('显示模型工具', 'Show model tools'), exact: true }));
      const tools = header.getByRole('region', { name: text('模型工具', 'Model tools'), exact: true });
      await tools.getByRole('combobox', { name: text('视图', 'View'), exact: true }).selectOption('front');
      await click(tools.getByRole('button', { name: text('正交', 'Ortho'), exact: true }));
      await click(tools.getByRole('tab', { name: text('工具', 'Tools'), exact: true }));
      await click(tools.locator('summary').filter({ hasText: zh ? /^剖切$/ : /^Section$/ }));
      await click(tools.getByRole('button', { name: text('剖切', 'Section'), exact: true }));
      await page.waitForTimeout(700);
      await click(tools.getByRole('button', { name: text('重置剖切', 'Reset cut'), exact: true }));
      await page.keyboard.press('Escape');
    });
    await scene('3MF 装配：查看齿轮结构', '3MF assemblies: inspect the gears', async () => {
      await openSidebar(names[6], 'model3d');
      await drag('.model3dv-canvas', -135, 45);
    }, 1300);
    await openSidebar(names[7], 'panorama');
    assert.equal(await page.locator('.panoramav-hint').textContent(), text('拖动环视 · 双指捏合或滚动缩放', 'Drag to look around · Pinch or scroll to zoom'));
    films.get(topic).checks.push('Panorama interaction hint matches the recording language');
    await scene('360° 照片：拖拽探索银河全景', '360° photos: look around the Milky Way', () => drag('.panoramav-canvas', -350, 25), 1400);
    await openSidebar(names[8], 'panorama-video');
    const playback = page.locator('.filens-dsh-view .pptxv-video-controls');
    await scene('360° 视频：用底部进度条定位', '360° video: seek with the bottom timeline', async () => {
      const slider = playback.getByRole('slider', { name: text('播放进度', 'Playback position'), exact: true });
      await slider.scrollIntoViewIfNeeded();
      await page.waitForTimeout(250);
      const rect = await slider.boundingBox();
      assert.ok(rect && rect.y + rect.height <= recording.viewport.height);
      assert.equal(await page.locator('.filens-dsh-actions .pptxv-video-controls').count(), 0);
      await page.mouse.move(rect.x + rect.width * .37, rect.y + rect.height / 2, { steps: 22 });
      await slider.click({ position: { x: rect.width * .37, y: rect.height / 2 } });
      await page.waitForFunction(() => document.querySelector('video')?.currentTime > 24);
    });
    await scene('播放全景视频，同时改变视角', 'Play the panorama and change the view', async () => {
      await click(playback.getByRole('button', { name: text('播放', 'Play'), exact: true }));
      await drag('.panoramav-canvas', 210, -25);
      assert.equal(await page.locator('video').evaluate(v => v.paused), false);
    }, 1700);
    await playback.getByRole('button', { name: text('暂停', 'Pause'), exact: true }).click();
    const video = await page.locator('video').elementHandle();
    const position = await video.evaluate(v => v.currentTime);
    const waitPreviewLanguage = async chinese => {
      await page.waitForFunction(({ chinese, hint }) =>
        document.documentElement.lang.startsWith(chinese ? 'zh' : 'en') &&
        document.querySelector('.filens-dsh-view .pptxv-shell')?.getAttribute('lang')?.startsWith(chinese ? 'zh' : 'en') &&
        document.querySelector('.panoramav-hint')?.textContent === hint,
      { chinese, hint: chinese ? '拖动环视 · 双指捏合或滚动缩放' : 'Drag to look around · Pinch or scroll to zoom' });
    };
    const otherLocale = zh ? 'en' : 'zh';
    await page.evaluate(value => window.__DSH_DEMO_CTX__.get('locale').setLocale(value), otherLocale);
    await waitPreviewLanguage(!zh);
    await playback.getByRole('button', { name: text('Play', '播放'), exact: true }).waitFor();
    assert.equal(await video.evaluate((v, position) => v.isConnected && v === document.querySelector('video') && v.paused && Math.abs(v.currentTime - position) < 0.1, position), true);
    await page.evaluate(value => window.__DSH_DEMO_CTX__.get('locale').setLocale(value), zh ? 'zh' : 'en');
    await waitPreviewLanguage(zh);
    await playback.getByRole('button', { name: text('播放', 'Play'), exact: true }).waitFor();
    assert.equal(await playback.getByRole('button', { name: text('取消静音', 'Unmute'), exact: true }).getAttribute('title'), text('取消静音', 'Unmute'));
    films.get(topic).checks.push('Live language switching translates paused controls without replacing video or resetting playback position');
    await page.waitForTimeout(200);
    await page.screenshot({ path: path.join(output, `${topic}.${locale}.png`), scale: 'css' });
    await click(page.locator('[data-sidebar-right-mode=push]'));
    await click(page.locator('[data-sidebar-right-toggle]'));

    topic = 'file-workspace';
    await page.getByRole('button', { name: /^(文件工作台|File workspace)$/ }).click();
    await page.waitForFunction(() => /已读取 [1-9]|[1-9]\d* sessions read/.test(document.querySelector('.fw-scan-status')?.textContent ?? ''));
    assert.equal(await page.locator('.fw-session-group').count(), 2);
    await page.waitForFunction(() => document.querySelectorAll('.fw-group-art .filens-dsh[data-phase=ready]').length >= 6, null, { timeout: 65000 });
    await opaqueBackground('#ffffff');
    await page.waitForTimeout(200);
    assert.ok((await page.locator('.fw-group-title').allTextContents()).every(t => !t.includes('session-')));
    await page.screenshot({ path: path.join(output, `${topic}.${locale}.png`), scale: 'css' });
    await scene('会话文件自动汇集，折叠成预览群组', 'Session files, collected into thumbnail groups', null, 1900);
    const office = page.locator('.fw-session-group').filter({ has: page.locator('.fw-group-title', { hasText: titles[0] }) });
    await scene('展开会话：Word、PPT、Excel 都有真实缩略图', 'Expand a session: live Word, PowerPoint and Excel previews', async () => {
      await click(office.locator(':scope > summary'));
      await office.locator('.fw-card').first().waitFor();
      for (const card of await office.locator('.fw-card').all()) await card.locator('.filens-dsh[data-phase=ready]').waitFor({ timeout: 65000 });
      assert.equal(await office.locator('.fw-card').count(), 4);
    }, 1500);
    await scene('按会话标题查找，临时锁文件默认隐藏', 'Search by session title; temporary lock files stay hidden', async () => {
      const search = page.getByRole('searchbox', { name: /查找文件|Find a file/ });
      await search.pressSequentially(zh ? '极光' : 'Night', { delay: 120 });
      await page.waitForFunction(() => document.querySelectorAll('.fw-session-group').length === 1);
      assert.equal(await page.locator('.fw-card').count(), 4);
      assert.match(await page.locator('.fw-temporary-toggle').innerText(), /显示 1|Show 1/);
      await page.waitForTimeout(650);
      await search.fill('');
    });
    await scene('打开文件：窄文件栏与大画布', 'Open a file: a compact list and a large reading canvas', async () => {
      await click(office.locator('.fw-card-open').filter({ hasText: names[0] }));
      await page.locator('.fw-stage .filens-dsh[data-phase=ready]').waitFor({ timeout: 65000 });
      assert.ok((await page.locator('.fw-file-nav').boundingBox()).width <= 160);
    }, 1500);
    await scene('文件详情：属性、相关文件与来源消息', 'File details: properties, related files and source messages', async () => {
      if (!(await page.locator('.fw-inspector').count())) await click(page.locator('.fw-info-toggle'));
      assert.ok(await page.locator('.fw-inspector [data-file-size]').count());
      await page.locator('.fw-related').scrollIntoViewIfNeeded();
      await page.locator('.fw-related-file .filens-dsh[data-phase=ready]').first().waitFor({ timeout: 65000 });
    }, 1700);
    await scene('相关文件：按同一消息、提问和会话推荐', 'Related files: linked by message, question and session', async () => {
      await click(page.locator('.fw-related-file').filter({ hasText: names[1] }));
      await page.locator('.fw-stage .filens-dsh[data-phase=ready]').waitFor({ timeout: 65000 });
      assert.equal(await page.locator('.fw-reader-title strong').innerText(), names[1]);
    }, 1400);
    await scene('返回原提问，定位文件产生的位置', 'Jump back to the exact question behind the file', async () => {
      const question = page.locator('.fw-origin').first().getByRole('button', { name: /查看提问|View question/ });
      await click(question);
      const original = page.locator(`[data-chat-node-key="13:input-message${sessions[0].messageId}"]`);
      await original.waitFor();
      assert.equal(await original.evaluate(node => { const r = node.getBoundingClientRect(); return r.top < innerHeight && r.bottom > 0; }), true);
    }, 1800);
    await page.getByRole('button', { name: /^(文件工作台|File workspace)$/ }).click();
    await page.getByRole('button', { name: /返回工作台|Back to workspace/ }).first().click();
    for (const group of await page.locator('.fw-session-group').all()) if (await group.getAttribute('open') !== null) await group.locator(':scope > summary').click();
    await scene('跟随 DSH 深色外观，保持同一套文件', 'Follow DSH dark mode with the same collected files', async () => {
      await page.evaluate(() => window.__DSH_DEMO_CTX__.get('theme').setTheme('dark'));
      await opaqueBackground('#151515');
      await page.locator('.fw-workspace.fw-dark').waitFor();
      await page.locator('.fw-group-art .filens-dsh[data-phase=ready]').first().waitFor({ timeout: 65000 });
    }, 1700);
    for (const film of films.values()) film.checks.push('capture complete');
  } catch (error) {
    await page.screenshot({ path: path.join(work, 'failure.png') }).catch(() => {});
    throw error;
  } finally {
    await recording.stop();
    await app.close();
    const installed = JSON.parse(await readFile(path.join(plugin, 'package.json'), 'utf8'));
    const support = JSON.parse(await readFile(path.join(plugin, 'lib/support.json'), 'utf8'));
    const components = { cli: installed.dependencies['filens-cli'], preview: support.previewVersion, extensions: support.extensions.length,
      previewSHA256: createHash('sha256').update(await readFile(path.join(plugin, 'lib/runtime/filens.js'))).digest('hex'),
      workspaceSHA256: createHash('sha256').update(await readFile(path.join(profile, 'node_modules/@filens/dsh-workspace/client.js'))).digest('hex') };
    for (const [name, film] of films) {
      const folder = path.join(work, name);
      await mkdir(folder, { recursive: true });
      await writeFile(path.join(folder, 'recording.json'), JSON.stringify({ capturedAt: new Date().toISOString(),
        installationSource: 'isolated local source build', plugin: installed.version, components, environment,
        locale, pointer: false, windowCompositing: 'opaque native window background for screencast transparency',
        modelCalls: 0, syntheticHistory: true, documents, raw: recording.raw, viewport: recording.viewport,
        offset: (began - recording.startedAt) / 1000, synchronization: 'first screencast frame delivery', ...film }, null, 2) + '\n');
    }
  }
}

if (!process.argv.includes('--encode-only')) await capture();
if (!process.argv.includes('--capture-only')) for (const topic of topics) {
  await encodeRecording(path.join(work, topic, 'recording.json'), `${topic}.${locale}`, 'capture complete', { output, locale, fps: 20 });
}
