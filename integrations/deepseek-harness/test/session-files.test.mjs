import assert from 'node:assert/strict';
import test from 'node:test';
import { collectSessionFiles, existingSessionFiles, extractSessionFiles, isTemporaryFile, mergeSessionFiles, resolveFilePath, sessionTitle, shortSessionTitle } from '../src/session-files.js';

const extensions = ['pdf', 'docx', 'png', 'xlsx'];
const session = { sessionId: 'review', cwd: '/work', projections: { values: { title: '设计评审' } } };
const event = (seq, type, data) => ({ type: 'event', event: { seq, type, time: 1000 + seq, data } });
const question = (seq, text, extra = []) => event(seq, 'user/message', { id: `q-${seq}`, source: { kind: 'user' }, content: [{ type: 'text', text }, ...extra] });

test('collects explicit files and attachments with exact message and question provenance', () => {
  const attachment = { attachmentId: `sha256:${'a'.repeat(64)}`, name: '样张.png', bytes: 321 };
  const files = extractSessionFiles([
    question(1, '请检查 [原稿](<报告%20一.docx>) 与 `draft.pdf`。', [{ type: 'image', attachment }]),
    event(3, 'assistant/message', { turn: 1, step: 1, message: { content: [{ type: 'text', text: '已生成 [修订版](./result.pdf)' }] } }),
    event(4, 'tool/result', { turn: 1, message: { source: { callId: 'call-1' }, content: [{ type: 'text', text: '{"output":"./data.xlsx"}' }] } }),
    question(5, '再看一次 `draft.pdf`，外部链接 https://example.com/ignore.pdf 不收集。'),
  ], session, extensions);
  assert.equal(files.length, 5);
  assert.equal(files.find(x => x.path === '/work/报告 一.docx').origins[0].nodeKey, '13:input-messageq-1');
  assert.equal(files.find(x => x.path === '/work/draft.pdf').origins.length, 2);
  const result = files.find(x => x.path === '/work/result.pdf').origins[0];
  assert.equal(result.nodeKey, '14:assistant-step1:1');
  assert.equal(result.question.seq, 1);
  assert.equal(result.sessionTitle, '设计评审');
  assert.equal(files.find(x => x.path === '/work/data.xlsx').origins[0].nodeKey, '9:tool-callcall-1');
  assert.equal(files.find(x => x.attachment)?.attachment, attachment);
});

test('deduplicates the same file across sessions, retaining all references and distinct same-name files', () => {
  const one = extractSessionFiles([question(1, '`report.pdf`')], session, extensions);
  const two = extractSessionFiles([question(1, '`report.pdf`')], { ...session, sessionId: 'another' }, extensions);
  const three = extractSessionFiles([question(1, '`report.pdf`')], { ...session, sessionId: 'third', cwd: '/other' }, extensions);
  const merged = mergeSessionFiles([one, two, three, two]);
  assert.equal(merged.length, 2);
  assert.equal(merged.find(x => x.path === '/work/report.pdf').origins.length, 2);
});

test('normalizes local references and excludes remote URLs, malformed and unresolved paths', () => {
  assert.equal(resolveFilePath('../report.pdf', '/work/folder'), '/work/report.pdf');
  assert.equal(resolveFilePath('file:///work/%E6%A0%B7%E7%A8%BF.pdf'), '/work/样稿.pdf');
  assert.equal(resolveFilePath('C:\\work\\report.pdf'), 'C:/work/report.pdf');
  for (const value of ['https://a/report.pdf', 'javascript:alert(1)', '../report.pdf', 'file://%', '~/report.pdf', 'a\0.pdf']) assert.equal(resolveFilePath(value), null);
});

test('format names alone are not files, while named documents and common dotfiles remain references', () => {
  const files = extractSessionFiles([question(1, '支持 `.doc`、`.pdf`、`.wps`，查看 `report.docx` 和 `.env`。')], session, [...extensions, 'doc', 'wps', 'env']);
  assert.deepEqual(files.map(file => file.name), ['report.docx', '.env']);
});

test('recognizes transient artifacts while retaining useful files in temporary directories', () => {
  for (const path of ['/work/~$report.docx', '/work/._photo.jpg', '/work/.DS_Store', '/work/Thumbs.db',
    '/work/desktop.ini', '/work/.~lock.report.docx#', '/work/report.pdf~', '/work/.report.swp',
    '/work/report.pdf.bak', '/work/preview.tmp', '/work/__MACOSX/assets/photo.jpg',
    '/Users/test/.Trash/report.pdf', 'C:\\$RECYCLE.BIN\\report.pdf']) {
    assert.equal(isTemporaryFile({ path }), true, path);
  }
  for (const path of ['/tmp/report.pdf', '/private/tmp/output.png', '/var/folders/id/T/draft.docx',
    '/work/temp/diagram.svg', '/work/temporary-notes.md', '/work/.env', '/work/.config/settings.json',
    '/work/backup/report.pdf', '/work/recovered~final.docx', '/work/my__MACOSX/photo.jpg']) {
    assert.equal(isTemporaryFile({ path }), false, path);
  }
  assert.equal(isTemporaryFile({ name: '~$uploaded.docx' }), true);
  assert.equal(isTemporaryFile({ file: { name: '._photo.png' } }), true);
  assert.equal(isTemporaryFile({}), false);
  const files = extractSessionFiles([question(1, '`~$report.docx` 和 `/tmp/result.pdf`')], session, extensions);
  assert.equal(files.length, 2, 'Temporary references remain indexed so the UI can reveal them');
  assert.equal(files.filter(isTemporaryFile).length, 1);
});

test('uses session titles, log titles or the first question instead of IDs, keeping a short display label', () => {
  assert.equal(sessionTitle(session), '设计评审');
  assert.equal(sessionTitle({ sessionId: 'internal-id', projections: { values: { title: { title: '已命名的会话' } } } }), '已命名的会话');
  const records = [question(1, '  检查这份观测手册\n并定位图片  `report.pdf`  '),
    event(3, 'session/title', { title: '旧的标题' }), event(8, 'session/title', { title: '新的会话标题' })];
  assert.equal(sessionTitle({ sessionId: 'internal-id' }, records), '新的会话标题');
  assert.equal(sessionTitle({ sessionId: 'internal-id' }, records.slice(0, 1)), '检查这份观测手册 并定位图片 `report.pdf`');
  assert.equal(sessionTitle({ sessionId: 'internal-id' }), '未命名会话');
  const files = extractSessionFiles(records, { sessionId: 'internal-id', cwd: '/work' }, extensions);
  assert.equal(files[0].origins[0].sessionTitle, '新的会话标题');
  const full = '观测手册与上传图鉴的内容核对和修订';
  assert.equal(shortSessionTitle(full), '观测手册与上传图鉴的内容…');
  assert.equal(shortSessionTitle('设计评审'), '设计评审');
  assert.equal(shortSessionTitle('📄'.repeat(15)), '📄'.repeat(12) + '…');
});

test('paginates complete old histories at a fixed cut and reports individual session errors', async () => {
  const calls = [], states = [];
  const remote = { session: {
    list: async () => ({ ok: true, value: { items: [session, { sessionId: 'denied' }] } }),
    follow: async function* (request) {
      if (request.address.sessionId === 'denied') throw new Error('Access denied');
      yield { type: 'snapshot', cursor: 101, records: [question(101, '`recent.pdf`')], hasMore: true };
    },
    page: async request => {
      calls.push(request);
      return { ok: true, value: { records: [question(1, '`old.pdf`')], hasMore: false } };
    },
  } };
  await collectSessionFiles(remote, extensions, new AbortController().signal, state => states.push(state));
  assert.equal(calls[0].beforeSeq, 101);
  assert.equal(calls[0].throughSeq, 101);
  assert.equal(states.at(-1).files.length, 2);
  assert.equal(states.at(-1).done, 2);
  assert.equal(states.at(-1).errors[0].sessionId, 'denied');
});

test('does not loop or report completeness when a history cursor stalls', async () => {
  const states = [];
  const remote = { session: {
    list: async () => ({ ok: true, value: { items: [session] } }),
    follow: async function* () { yield { type: 'snapshot', cursor: 5, records: [question(5, '`report.pdf`')], hasMore: true }; },
    page: async () => ({ ok: true, value: { records: [question(5, '`report.pdf`')], hasMore: true } }),
  } };
  await collectSessionFiles(remote, extensions, new AbortController().signal, state => states.push(state));
  assert.match(states.at(-1).errors[0].message, /cursor/);
  assert.equal(states.at(-1).files.length, 0);
});

test('collection hides only confirmed missing paths and attachments, preserving permission and network errors', async () => {
  const files = extractSessionFiles([question(1, '`kept.pdf` `gone.pdf` `denied.pdf` `offline.pdf`', [
    { type: 'file', attachment: { attachmentId: `sha256:${'a'.repeat(64)}`, name: 'lost.pdf', bytes: 8 } },
    { type: 'image', attachment: { attachmentId: `sha256:${'b'.repeat(64)}`, mediaType: 'image/png', bytes: 8, width: 1, height: 1 } },
  ])], session, extensions);
  const paths = [];
  const remote = {
    filensWorkspace: { attachmentPath: async (id, ref) => ({ ok: true, value: ref.mediaType ? '/images/lost.png' : '/attachments/lost.pdf' }) },
    workspaceFiles: { stat: async (id, path) => {
      assert.equal(id, session.sessionId); paths.push(path);
      if (/gone|lost/.test(path)) return { ok: false, error: { code: 'workspace-file/not-found', message: 'Missing' } };
      if (path.includes('denied')) return { ok: false, error: { code: 'fs/permission-denied', message: 'Denied' } };
      if (path.includes('offline')) throw new Error('Connection unavailable');
      return { ok: true, value: { bytes: 123 } };
    } },
  };
  const result = await existingSessionFiles(remote, files, new AbortController().signal);
  assert.deepEqual(result.map(file => file.name).sort(), ['denied.pdf', 'kept.pdf', 'offline.pdf']);
  assert.equal(result.find(file => file.name === 'kept.pdf').size, 123);
  assert.ok(paths.includes('/images/lost.png'));
  assert.ok(paths.includes('/attachments/lost.pdf'));
});

test('existence checks propagate cancellation instead of classifying it as absence', async () => {
  const controller = new AbortController();
  const remote = { workspaceFiles: { stat: async () => { controller.abort(); throw controller.signal.reason; } } };
  const files = extractSessionFiles([question(1, '`report.pdf`')], session, extensions);
  await assert.rejects(existingSessionFiles(remote, files, controller.signal), { name: 'AbortError' });
});
