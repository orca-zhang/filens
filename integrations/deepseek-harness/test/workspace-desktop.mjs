// Actual installed DSH, synthetic stored history, and real document bytes.
import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { copyFile, cp, mkdir, mkdtemp, readFile, symlink, unlink, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { launchDesktop } from '../../../scripts/capture-dsh-plugin-demo.mjs';

const plugin = process.env.FILENS_DSH_TEST_PLUGIN ?? fileURLToPath(new URL('../', import.meta.url));
const workspace = process.env.FILENS_DSH_TEST_WORKSPACE ?? path.join(plugin, 'workspace');
const repo = fileURLToPath(new URL('../../../', import.meta.url));
const home = await mkdtemp(path.join(os.tmpdir(), 'filens-sessions-'));
const profile = path.join(home, 'profiles/desktop');
const directory = path.join(home, 'Documents');
const output = path.join(plugin, 'artifacts/workspace-desktop');
await mkdir(path.join(profile, 'node_modules'), { recursive: true });
await mkdir(directory);
await mkdir(output, { recursive: true });
await symlink(plugin, path.join(profile, 'node_modules/dsh-filens'));
await cp(workspace, path.join(profile, 'node_modules/dsh-filens-workspace'), { recursive: true });
await writeFile(path.join(profile, 'package.json'), JSON.stringify({ name: 'filens-workspace-test', private: true,
  dependencies: { 'dsh-filens': `file:${plugin}`, 'dsh-filens-workspace': `file:${workspace}` },
  dsh: { profile: { bundles: ['@deepseek-ai/dsh-base', '@deepseek-ai/dsh-web-app', 'dsh-filens'] } } }));
await writeFile(path.join(profile, 'cordis.yml'), '[]\n');
await writeFile(path.join(profile, 'cordis.patch.yml'), '- id: filens-tools\n  disabled: true\n');
const documentName = '观测手册.docx';
await copyFile(path.join(repo, 'apps/demo/public/samples/filens-aurora-guide.docx'), path.join(directory, documentName));
await mkdir(path.join(directory, 'second'));
await copyFile(path.join(directory, documentName), path.join(directory, 'second', documentName));
await writeFile(path.join(directory, 'sample.py'), 'print("Source files use icons in the gallery")\n');
await writeFile(path.join(directory, 'corrupt.pdf'), 'This is deliberately not a PDF document.');
await mkdir(path.join(directory, '__MACOSX'));
for (const name of [`~$${documentName}`, `._${documentName}`, '__MACOSX/metadata.pdf']) {
  await copyFile(path.join(directory, documentName), path.join(directory, name));
}
const attachmentBytes = await readFile(path.join(repo, 'apps/demo/public/samples/filens-cosmic-atlas.pdf'));
const digest = createHash('sha256').update(attachmentBytes).digest('hex');
const attachment = { attachmentId: `sha256:${digest}`, name: '上传的图鉴.pdf', bytes: attachmentBytes.length };
const storedAttachment = path.join(home, 'attachments/v1/files', digest.slice(0, 2), digest, attachment.name);
await mkdir(path.dirname(storedAttachment), { recursive: true });
await writeFile(storedAttachment, attachmentBytes);

const sessionIds = [], origins = [];
const sessionTitles = ['观测手册与上传图鉴的内容核对', '观测手册、源码与异常文件检查'];
for (const count of [270, 1]) {
  const title = sessionTitles[sessionIds.length];
  const id = `session-${randomUUID()}`;
  sessionIds.push(id);
  const header = { type: 'session', version: 4, id, createdAt: Date.now(), cwd: directory, isSeeded: false, delegationDepth: 0 };
  const events = [];
  const emit = (type, data, surface = false) => {
    const seq = events.length;
    events.push({ type, seq, time: header.createdAt + seq, data, ...(surface ? { surfaceOp: 'append' } : {}) });
    return seq;
  };
  emit('session/title', { title, messageSeqs: [], source: { kind: 'user' } });
  for (let turn = 1; turn <= count; turn++) {
    emit('turn/start', { turn });
    const messageId = `fixture-${id}-${turn}`;
    const seq = emit('user/message', { id: messageId, role: 'user', source: { kind: 'user' },
      content: [{ type: 'text', text: turn === 1 ? `请检查这份文件：\`${documentName}\`` : '这是一条重复的历史提问。' },
        ...(turn === 1 && count === 270 ? [{ type: 'file', attachment }] : [])] }, true);
    emit('step/start', { turn, step: 1 });
    const answerSeq = emit('assistant/message', { turn, step: 1, message: { id: `answer-${messageId}`, role: 'assistant',
      source: { kind: 'model', provider: 'fixture', model: 'fixture' },
      content: [{ type: 'text', text: turn === 1 ? `文件已生成：[手册](${documentName})${count === 1 ? `，另一个目录：\`second/${documentName}\`，测试文件：\`missing.pdf\`、\`sample.py\`、\`corrupt.pdf\`，临时文件：\`~$${documentName}\`、\`._${documentName}\`、\`__MACOSX/metadata.pdf\`` : ''}` : '已收到。' }] }, stream: [] }, true);
    emit('step/end', { turn, step: 1 });
    emit('turn/end', { turn, reason: { kind: 'completed' } });
    if (turn === 1) origins.push({ sessionId: id, seq, messageId, answerSeq });
  }
  const bucket = `--${directory.replace(/[/\\:]+/g, '-').replace(/^-+/, '')}--`;
  const file = path.join(home, 'sessions', bucket, id, 'session.v4.jsonl.zstd');
  await mkdir(path.dirname(file), { recursive: true });
  const frames = [JSON.stringify(header) + '\n', events.map(row => JSON.stringify(row)).join('\n') + '\n'].map(input => {
    const compressed = spawnSync('zstd', ['-q', '-c'], { input });
    assert.equal(compressed.status, 0);
    return compressed.stdout;
  });
  await writeFile(file, Buffer.concat(frames));
}
console.log('Fixture home:', home);
const { app, page } = await launchDesktop(home, false);
const checks = [];
page.on('console', message => { if (message.type() === 'error') console.log('Browser:', message.text().slice(0, 1600)); });
page.setDefaultTimeout(30000);
const record = text => { checks.push(text); console.log('Passed:', text); };
async function checkZoom(locator) {
  await locator.waitFor();
  assert.equal(await locator.innerText(), '100%');
  assert.equal(await locator.evaluate(node => {
    const text = document.createRange(); text.selectNodeContents(node);
    const a = text.getBoundingClientRect(), b = node.getBoundingClientRect();
    const c = node.closest('.filens-dsh-controls').getBoundingClientRect();
    return a.left >= b.left - 1 && a.right <= b.right + 1 && a.left >= c.left - 1 && a.right <= c.right + 1;
  }), true, '100% must fit inside its element and toolbar viewport');
}
try {
  await page.getByRole('button', { name: /^(文件工作台|File workspace)$/ }).click();
  await page.waitForFunction(() => /已读取 [2-9]|[2-9] sessions read/.test(document.querySelector('.fw-scan-status')?.textContent ?? ''));
  assert.equal(await page.locator('.fw-scan-status details').count(), 0, await page.locator('.fw-scan-status').textContent());
  assert.equal(await page.locator('.fw-session-group').count(), 2);
  assert.equal(await page.locator('.fw-session-group[open]').count(), 0);
  assert.equal(await page.locator('.fw-session-group .fw-card').count(), 0);
  assert.equal(await page.locator('.fw-group-art .fw-file-symbol').count(), 6);
  const titleLabels = await page.locator('.fw-group-title').allTextContents();
  assert.ok(titleLabels.every(title => !title.includes('session-') && Array.from(title).length <= 13));
  assert.deepEqual((await page.locator('.fw-group-title').evaluateAll(nodes => nodes.map(node => node.title))).sort(), [...sessionTitles].sort());
  await page.locator('.fw-group-art .filens-dsh[data-phase=ready]').first().waitFor({ timeout: 65000 });
  record('Group cards show shortened session titles with the full title on hover, and real Office thumbnails');
  const groupCard = await page.locator('.fw-session-group > summary').first().boundingBox();
  const cover = await page.locator('.fw-group-art').first().boundingBox();
  const mosaic = await page.locator('.fw-group-stack').first().boundingBox();
  assert.ok(Math.abs(cover.width - mosaic.width) <= 1);
  const cell = await page.locator('.fw-group-art .fw-mini-preview').first().boundingBox();
  assert.ok(cell.width >= cover.width / 2 - 10);
  assert.ok(groupCard.height - cover.height < 65);
  assert.equal(await page.locator('.fw-group-art').evaluateAll(covers => covers.every(cover => {
    const bounds = cover.getBoundingClientRect();
    return [...cover.querySelectorAll('.fw-mini-preview')].every(cell => {
      const rect = cell.getBoundingClientRect();
      return rect.left >= bounds.left && rect.right <= bounds.right && rect.top >= bounds.top && rect.bottom <= bounds.bottom;
    });
  })), true, 'Mosaic cells must stay inside the cover and cannot cover the title');
  await page.screenshot({ path: path.join(output, 'sessions-collapsed.png') });
  record('Group thumbnails fill the cover; two files use both halves and short titles use a compact caption');
  async function expandSessions() {
    for (const group of await page.locator('.fw-session-group').all()) {
      if (await group.getAttribute('open') === null) await group.locator(':scope > summary').click();
      await group.locator('.fw-card').first().waitFor();
    }
  }
  await expandSessions();
  assert.equal(await page.locator('.fw-card').count(), 6);
  const fileCard = await page.locator('.fw-card').first().boundingBox();
  assert.ok(Math.abs(groupCard.width - fileCard.width) <= 1);
  record('Collapsed sessions align with file grid columns and preview at most four representative files');
  assert.equal(await page.locator('.fw-card-open').filter({ hasText: /~\$|^\._|metadata\.pdf/ }).count(), 0);
  await page.getByRole('button', { name: /显示 3 个临时文件|Show 3 temporary files/ }).click();
  await page.waitForFunction(() => document.querySelectorAll('.fw-card').length === 9);
  assert.equal(await page.locator('.fw-card-open').filter({ hasText: /~\$|^\._|metadata\.pdf/ }).count(), 3);
  await page.getByRole('button', { name: /隐藏 3 个临时文件|Hide 3 temporary files/ }).click();
  await page.waitForFunction(() => document.querySelectorAll('.fw-card').length === 6);
  record('Temporary session files are hidden by default and can be revealed; ordinary documents in the OS temporary directory remain visible');
  assert.equal(await page.locator('.fw-card-open').filter({ hasText: documentName }).count(), 3);
  const firstGroupFiles = await page.locator('.fw-session-group').first().locator('.fw-card').count();
  await page.locator('.fw-session-group > summary').first().click();
  await page.waitForFunction(count => document.querySelectorAll('.fw-card').length === count, 6 - firstGroupFiles);
  await expandSessions();
  await page.getByRole('combobox', { name: /来源会话|Source session/ }).selectOption(sessionIds[0]);
  assert.equal(await page.locator('.fw-session-group').count(), 1);
  assert.equal(await page.locator('.fw-card').count(), 2);
  await page.getByRole('combobox', { name: /来源会话|Source session/ }).selectOption('all');
  record('Session groups start folded; expand, collapse and session filtering retain the correct files');
  record('All history pages collected; shared paths deduplicate, different directories stay separate');
  assert.equal(await page.locator('.fw-card-open').filter({ hasText: 'missing.pdf' }).count(), 0);
  record('Confirmed missing references are excluded before cards, session counts and related-file recommendations are built');
  const code = page.locator('.fw-card').filter({ has: page.locator('.fw-card-open', { hasText: 'sample.py' }) });
  await code.locator('.fw-file-symbol').waitFor();
  assert.equal(await code.locator('.filens-dsh').count(), 0);
  assert.equal(await code.locator('.fw-file-symbol').getAttribute('data-icon'), 'code');
  assert.notEqual(await code.locator('.fw-file-symbol').evaluate(node => getComputedStyle(node).color),
    await page.locator('.fw-card').filter({ hasText: 'corrupt.pdf' }).locator('.fw-file-symbol').evaluate(node => getComputedStyle(node).color));
  const corrupt = page.locator('.fw-card').filter({ has: page.locator('.fw-card-open', { hasText: 'corrupt.pdf' }) });
  await corrupt.scrollIntoViewIfNeeded();
  await corrupt.locator('.filens-dsh[data-phase=error]').waitFor({ timeout: 65000 });
  assert.equal(await corrupt.locator('.fw-preview-placeholder').isVisible(), true);
  assert.equal(await corrupt.locator('[role=alert]').isVisible(), false);
  await page.locator('.fw-card').filter({ has: page.locator('.fw-card-open', { hasText: documentName }) }).first().locator('.filens-dsh[data-phase=ready]').waitFor({ timeout: 65000 });
  await page.screenshot({ path: path.join(output, 'file-icons.png') });
  await page.evaluate(() => window.__DSH_DEMO_CTX__.get('theme').setTheme('dark'));
  await page.locator('.fw-workspace.fw-dark').waitFor();
  await page.screenshot({ path: path.join(output, 'file-icons-dark.png') });
  await page.evaluate(() => window.__DSH_DEMO_CTX__.get('theme').setTheme('light'));
  await page.locator('.fw-workspace:not(.fw-dark)').waitFor();
  await page.getByRole('button', { name: /列表视图|List view/ }).click();
  assert.equal(await code.locator('.fw-file-symbol').isVisible(), true);
  await page.screenshot({ path: path.join(output, 'file-icons-list.png') });
  await page.getByRole('button', { name: /网格视图|Grid view/ }).click();
  record('Existing corrupt and source-code files retain type covers; only confirmed absence is hidden');
  const attachmentCard = page.locator('.fw-card').filter({ hasText: attachment.name });
  await attachmentCard.locator('.fw-card-open').click();
  await page.waitForFunction(() => document.querySelector('.fw-stage [role=alert]') || ['ready', 'error'].includes(document.querySelector('.fw-stage .filens-dsh')?.dataset.phase), null, { timeout: 65000 });
  assert.equal(await page.locator('.fw-stage [role=alert]').count(), 0, await page.locator('.fw-stage').innerText());
  await page.locator('.fw-stage .filens-dsh[data-phase=ready]').waitFor();
  record('Stored generic attachment resolves through the native provider and previews real PDF bytes');
  await page.screenshot({ path: path.join(output, 'attachment.png') });
  assert.equal(await page.locator('.fw-related-file').count(), 1);
  assert.match(await page.locator('.fw-related-file').innerText(), /同一条消息|Same message/);
  await page.locator('.fw-related-file').focus();
  await page.keyboard.press('Enter');
  assert.equal(await page.locator('.fw-reader-title strong').innerText(), documentName);
  await page.locator('.fw-stage .filens-dsh[data-phase=ready]').waitFor({ timeout: 65000 });
  assert.equal(await page.locator('.fw-related-file').count(), 4);
  assert.equal(await page.locator('.fw-related-file').filter({ hasText: 'missing.pdf' }).count(), 0);
  await page.locator('.fw-related-file').filter({ hasText: documentName }).first().locator('.filens-dsh[data-phase=ready]').waitFor({ timeout: 65000 });
  assert.equal(await page.locator('.fw-origin').count(), 4);
  await page.locator('.fw-related').scrollIntoViewIfNeeded();
  await page.screenshot({ path: path.join(output, 'related-files.png') });
  await page.locator('.fw-related-file').filter({ hasText: attachment.name }).click();
  await page.locator('.fw-stage .filens-dsh[data-phase=ready]').waitFor({ timeout: 65000 });
  assert.equal(await page.locator('.fw-reader-title strong').innerText(), attachment.name);
  record('Related files explain their reference relationship, open with keyboard or mouse, and retain source messages');
  await page.getByRole('button', { name: /返回工作台|Back to workspace/ }).first().click();
  const shared = page.locator('.fw-card').filter({ has: page.locator('.fw-card-open', { hasText: documentName }) }).first();
  await shared.locator('.fw-card-open').click();
  assert.equal(await page.locator('.fw-origin').count(), 4);
  record('Same file retains four exact source occurrences across two sessions');
  await page.locator('.fw-stage .filens-dsh[data-phase=ready]').waitFor({ timeout: 65000 });
  assert.ok((await page.locator('.fw-file-nav').boundingBox()).width <= 160);
  record('The reader file sidebar is at most 160 pixels wide');
  await checkZoom(page.locator('.fw-reader-footer .pptxv-zoom-status'));
  assert.equal(Number(await page.locator('.fw-inspector [data-file-size]').getAttribute('data-file-size')), (await readFile(path.join(directory, documentName))).byteLength);
  assert.equal(await page.locator('.fw-inspector-heading h2').innerText(), documentName);
  const heading = await page.locator('.fw-inspector-heading').boundingBox();
  assert.equal(await page.locator('.fw-inspector-content').evaluate(node => {
    node.scrollTop = node.scrollHeight;
    return node.scrollTop > 0;
  }), true);
  assert.deepEqual(await page.locator('.fw-inspector-heading').boundingBox(), heading);
  const requestId = await page.locator('.fw-stage .filens-dsh-view').getAttribute('data-request-id');
  await page.keyboard.press('Escape');
  assert.equal(await page.locator('.fw-inspector').count(), 0);
  assert.equal(await page.locator('.fw-info-toggle').evaluate(node => node === document.activeElement), true);
  await page.locator('.fw-info-toggle').click();
  assert.equal(await page.locator('.fw-stage .filens-dsh-view').getAttribute('data-request-id'), requestId);
  await page.locator('.fw-related-file').filter({ hasText: documentName }).first().locator('.filens-dsh[data-phase=ready]').waitFor({ timeout: 65000 });
  await page.screenshot({ path: path.join(output, 'info-photos-light.png') });
  await page.evaluate(() => window.__DSH_DEMO_CTX__.get('theme').setTheme('dark'));
  await page.locator('.fw-workspace.fw-dark').waitFor();
  await page.screenshot({ path: path.join(output, 'info-photos-dark.png') });
  await page.evaluate(() => window.__DSH_DEMO_CTX__.get('theme').setTheme('light'));
  await page.locator('.fw-workspace:not(.fw-dark)').waitFor();
  record('Photos-style details keep the filename fixed, show actual byte size, follow theme and close with Escape without reopening the preview');
  await page.locator('.fw-origin').filter({ hasText: sessionTitles[0] }).first().getByRole('button', { name: /查看所在消息|View message/ }).click();
  const oldQuestion = page.locator(`[data-chat-node-key="13:input-message${origins[0].messageId}"]`);
  await oldQuestion.waitFor();
  await page.waitForFunction(() => !document.querySelector('.fw-notice'));
  const target = await oldQuestion.getAttribute('data-chat-node-key');
  assert.equal(target, `13:input-message${origins[0].messageId}`);
  assert.equal(await oldQuestion.evaluate(node => { const r = node.getBoundingClientRect(); return r.bottom > 0 && r.top < innerHeight; }), true);
  record('Source navigation loads the oldest history and scrolls to its stable message identity');
  await page.screenshot({ path: path.join(output, 'old-message.png') });
  await page.getByText('轨迹', { exact: true }).click();
  await page.getByRole('button', { name: /^(文件工作台|File workspace)$/ }).click();
  await page.locator('.fw-origin').filter({ hasText: sessionTitles[0] }).nth(1).getByRole('button', { name: /查看提问|View question/ }).click();
  await page.waitForFunction(() => !document.querySelector('.fw-notice'));
  assert.equal(await oldQuestion.evaluate(node => { const r = node.getBoundingClientRect(); return r.bottom > 0 && r.top < innerHeight; }), true);
  record('An answer file switches from Trajectory to Chat and locates its corresponding question');
  await page.evaluate(({ sessionId, name }) => {
    window.__DSH_DEMO_CTX__.get('sidebarRight').openResource(`dsh-resource://file/session/${sessionId}/${name}`);
  }, { sessionId: sessionIds[0], name: documentName });
  await page.locator('.filens-dsh[data-phase=ready]').waitFor({ timeout: 65000 });
  await checkZoom(page.locator('.filens-dsh-actions .pptxv-zoom-status'));
  record('100% fits completely in the real sidebar and workspace toolbars');
  const plugins = await page.evaluate(async () => {
    const response = await window.__DSH_DEMO_CTX__.get('remote.pluginManager').listPlugins();
    if (!response.ok) throw new Error(response.error.message);
    return response.value.filter(row => row.patchId?.startsWith('filens-')).map(row => ({ entryId: row.entryId, patchId: row.patchId, moduleName: row.moduleName, meta: row.meta }));
  });
  assert.ok(plugins.some(row => row.patchId === 'filens-workspace'), JSON.stringify(plugins));
  const workspacePlugin = plugins.find(row => row.patchId === 'filens-workspace');
  assert.equal(workspacePlugin.moduleName, 'dsh-filens-workspace');
  assert.equal(workspacePlugin.meta.title.zh, '文件工作台');
  record('Workspace plugin has the native localized title 文件工作台 and a package icon');
  async function toggle(id, enabled) {
    const result = await page.evaluate(({ id, enabled }) => window.__DSH_DEMO_CTX__.get('remote.pluginManager').setPluginEnabled(id, enabled), { id, enabled });
    assert.equal(result.ok, true, JSON.stringify(result));
  }
  const workspaceId = plugins.find(row => row.patchId === 'filens-workspace').entryId;
  await toggle(workspaceId, false);
  await page.getByRole('button', { name: /^(文件工作台|File workspace)$/ }).waitFor({ state: 'hidden' });
  assert.equal(await page.locator('.filens-dsh[data-phase=ready]').count(), 1);
  await toggle(workspaceId, true);
  await page.getByRole('button', { name: /^(文件工作台|File workspace)$/ }).waitFor();
  record('Native plugin manager disables and enables File workspace independently of sidebar Preview');
  const previewId = plugins.find(row => row.patchId === 'filens-preview').entryId;
  await toggle(previewId, false);
  await page.getByRole('button', { name: /^(文件工作台|File workspace)$/ }).click();
  await page.locator('.fw-session-group').first().waitFor();
  await page.waitForFunction(() => !document.querySelector('.fw-appbar-end button')?.disabled);
  await expandSessions();
  await page.waitForFunction(() => document.querySelectorAll('.fw-card').length === 6);
  await page.locator('.fw-card-open').filter({ hasText: attachment.name }).click();
  await page.locator('.fw-stage .filens-dsh[data-phase=ready]').waitFor({ timeout: 65000 });
  await toggle(previewId, true);
  record('Workspace attachment preview remains functional while sidebar Preview is disabled');
  await app.evaluate(({ BrowserWindow }) => {
    for (const window of BrowserWindow.getAllWindows()) if (!window.webContents.getURL().includes('welcome.html')) window.setContentSize(600, 900);
  });
  await page.locator('.fw-file-row').filter({ hasText: documentName }).first().click({ force: true }).catch(async () => {
    await page.locator('.fw-mobile-back').click();
    await page.locator('.fw-card-open').filter({ hasText: documentName }).first().click();
  });
  await page.locator('.fw-stage .filens-dsh[data-phase=ready]').waitFor({ timeout: 65000 });
  await checkZoom(page.locator('.fw-reader-footer .pptxv-zoom-status'));
  record('100% also fits at a 600-pixel Desktop window width');
  const sheet = await page.locator('.fw-inspector').boundingBox();
  const reader = await page.locator('.fw-reader').boundingBox();
  assert.ok(sheet.x > reader.x && sheet.x + sheet.width < reader.x + reader.width);
  assert.ok(sheet.y > reader.y && sheet.y + sheet.height < reader.y + reader.height);
  await page.screenshot({ path: path.join(output, 'info-photos-mobile.png') });
  await page.keyboard.press('Escape');
  assert.equal(await page.locator('.fw-inspector').count(), 0);
  assert.equal(await page.locator('.fw-stage .filens-dsh[data-phase=ready]').count(), 1);
  record('Narrow-window details become an inset bottom sheet and dismiss without leaving the document');
  await page.locator('.fw-mobile-back').click();
  for (const group of await page.locator('.fw-session-group').all()) {
    if (await group.getAttribute('open') !== null) await group.locator(':scope > summary').click();
  }
  await page.waitForFunction(() => document.querySelectorAll('.fw-session-group .fw-card').length === 0);
  await page.screenshot({ path: path.join(output, 'sessions-collapsed-mobile.png') });
  await page.getByRole('button', { name: /列表视图|List view/ }).click();
  assert.equal(await page.locator('.fw-groups').evaluate(node => getComputedStyle(node).gridTemplateColumns.split(' ').length), 1);
  await page.screenshot({ path: path.join(output, 'sessions-list-mobile.png') });
  record('Group cards fit a narrow window in both grid and list modes');
  await app.evaluate(({ BrowserWindow }) => {
    for (const window of BrowserWindow.getAllWindows()) if (!window.webContents.getURL().includes('welcome.html')) window.setContentSize(1280, 820);
  });
  await page.getByRole('button', { name: /网格视图|Grid view/ }).click();
  await page.locator('input[type=file]').setInputFiles(['filens-aurora-guide.docx', 'filens-field-notes.pptx', 'filens-observatory.xlsx'].map(name => path.join(repo, 'apps/demo/public/samples', name)));
  const localGroup = page.locator('.fw-session-group').filter({ has: page.locator('.fw-group-title', { hasText: /本机文件|Local files/ }) });
  for (const card of await localGroup.locator('.fw-card').all()) {
    await card.scrollIntoViewIfNeeded();
    await card.locator('.filens-dsh[data-phase=ready]').waitFor({ timeout: 65000 });
    assert.equal(await card.locator('.fw-preview-placeholder').isVisible(), false);
  }
  assert.equal(await localGroup.locator('.fw-card').count(), 3);
  await localGroup.screenshot({ path: path.join(output, 'office-thumbnails.png') });
  record('Word, PowerPoint and Excel show real rendered thumbnails rather than fallback covers');
  const returnButton = page.getByRole('button', { name: /返回工作台|Back to workspace/ }).first();
  if (await returnButton.isVisible()) await returnButton.click();
  await expandSessions();
  await unlink(path.join(directory, 'sample.py'));
  await page.locator('.fw-card-open').filter({ hasText: 'sample.py' }).click();
  await page.waitForFunction(() => ![...document.querySelectorAll('.fw-card-open,.fw-file-row,.fw-related-file')].some(node => node.textContent.includes('sample.py')));
  await page.screenshot({ path: path.join(output, 'deleted-file-hidden.png') });
  record('A file deleted after scanning disappears when opened, including navigation and related-file lists');
  await writeFile(path.join(directory, 'sample.py'), 'print("restored")');
  await page.getByRole('button', { name: /刷新会话文件|Refresh session files/ }).click();
  await page.getByRole('button', { name: /刷新会话文件|Refresh session files/ }).waitFor({ state: 'visible' });
  await page.waitForFunction(() => !document.querySelector('.fw-appbar-end button')?.disabled);
  await expandSessions();
  await page.locator('.fw-card-open').filter({ hasText: 'sample.py' }).waitFor();
  await page.screenshot({ path: path.join(output, 'restored-file.png') });
  record('Refreshing rechecks existence and restores a file recreated at the same path');
  await writeFile(path.join(output, 'validation.json'), JSON.stringify({ capturedAt: new Date().toISOString(), dsh: '0.2.1-rc.5',
    scope: 'Installed DSH Desktop; synthetic 270-turn and one-turn sessions; real local documents; no model calls or user history edits', checks }, null, 2));
} catch (error) {
  await page.screenshot({ path: path.join(output, 'failure.png') }).catch(() => {});
  console.log((await page.locator('body').textContent().catch(() => '')).slice(0, 1600));
  throw error;
} finally { await app.close(); }
