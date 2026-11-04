import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtemp, readFile, writeFile, rm, access } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { zipSync, strToU8 } from 'fflate';
import { toolContext } from './helpers.mjs';
import { parseResult } from '../src/requests.js';

const repository = fileURLToPath(new URL('../../../', import.meta.url));

test('real DSH pipeline: capacity, OCR, read, search, excerpt, conversion and no overwrite', async t => {
  const root = await mkdtemp(path.join(tmpdir(), 'filens-dsh-tools-'));
  const { ctx, plugin, call } = await toolContext();
  t.after(async () => { await ctx.fiber.dispose(); await rm(root, { recursive: true, force: true }); });
  assert.equal(ctx.tools.schemas().length, 7);
  const capacity = await call('filens_capacity');
  assert.equal(capacity.isError, false, JSON.stringify(capacity));
  assert.equal(capacity.value.response.ok, true);
  assert.equal(capacity.value.response.capacity.ocr.available, true);
  const compactText = capacity.content.map(v => v.text ?? '').join('\n');
  assert.match(compactText, /read\(input,/);
  assert.ok(compactText.length < JSON.stringify(capacity.value, null, 2).length);
  assert.ok(Buffer.byteLength(JSON.stringify(capacity.value.response)) < 8000);
  for (const op of ['read','excerpt','duplicates','similar-images']) assert.ok(capacity.value.response.capacity.operations.some(v => v.name === op));
  const ocr = await call('filens_read', { path: path.join(repository, 'converter/rapidocr/testdata/scan.pdf'), layout: true });
  assert.equal(ocr.value.response.ok, true, JSON.stringify(ocr));
  assert.match(ocr.value.response.content.text, /FILENS2026[\s\S]*BRIGHT2027/);
  for (const file of ['filens-cosmic-atlas.pdf', 'filens-aurora-guide.docx', 'filens-observatory.xlsx', 'filens-field-notes.pptx']) {
    const result = await call('filens_read', { path: path.join(repository, 'apps/demo/public/samples', file) });
    assert.equal(result.isError, false, JSON.stringify(result));
    if (result.value.exit_code === 3) {
      assert.equal(result.value.response.error.code, 'ocr_low_confidence', JSON.stringify(result.value));
      assert.ok(result.value.response.content.warnings.length);
    } else assert.equal(result.value.response.ok, true, JSON.stringify(result.value));
    assert.ok(result.value.response.content.text.length > 0);
    if (/\.(docx|xlsx|pptx)$/.test(file)) {
      assert.equal(result.value.exit_code, 0, JSON.stringify(result.value));
      assert.equal(result.value.response.content.textScope, 'native-text');
      assert.ok(result.value.response.content.document.blocks.every(b => b.source === 'text'));
    }
  }
  const tricky = path.join(root, "中文 ' $(touch PWNED).txt");
  await writeFile(tricky, 'Harness integration evidence.\nEvidence must survive search and excerpt.');
  const read = await call('filens_read', { path: tricky });
  assert.equal(read.value.response.ok, true);
  assert.match(JSON.stringify(read.value), /Harness integration evidence/);
  await assert.rejects(access(path.join(process.cwd(), 'PWNED')));
  const search = await call('filens_search', { path: root, query: 'evidence' });
  assert.equal(search.value.response.ok, true, JSON.stringify(search));
  assert.match(JSON.stringify(search.value), /Harness integration evidence/);
  const excerpt = await call('filens_excerpt', { path: tricky, query: 'Harness' });
  assert.equal(excerpt.value.response.ok, true, JSON.stringify(excerpt));
  assert.match(excerpt.value.response.content.text, /Harness integration/);
  assert.equal(excerpt.value.response.op, 'excerpt');
  const input = path.join(root, 'data.csv');
  const output = path.join(root, 'data.xlsx');
  await writeFile(input, 'name,value\nHarness,42\n');
  const converted = await call('filens_convert', { path: input, output });
  assert.equal(converted.value.response.ok, true, JSON.stringify(converted));
  assert.equal((await readFile(output)).subarray(0, 2).toString(), 'PK');
  const before = await readFile(output);
  const duplicate = await call('filens_convert', { path: input, output });
  assert.equal(duplicate.value.response.ok, false);
  assert.deepEqual(await readFile(output), before);
  const missing = await call('filens_read', { path: path.join(root, 'missing.docx') });
  assert.equal(missing.value.response.ok, false);
  assert.notEqual(missing.value.exit_code, 0);
  const partial = await call('filens_read', { path: tricky, max_bytes: 10 });
  assert.equal(partial.value.exit_code, 3, JSON.stringify(partial));
  assert.equal(partial.value.response.content.truncated, true);
  await plugin.dispose();
  assert.equal(ctx.tools.schemas().length, 0);
});

test('filtered discovery, page selection and duplicate/image tools are callable through DSH', async t => {
  const root = await mkdtemp(path.join(tmpdir(), 'filens-dsh-discovery-'));
  const { ctx, call } = await toolContext();
  t.after(async () => { await ctx.fiber.dispose(); await rm(root, { recursive: true, force: true }); });
  const capacity = await call('filens_capacity', { from: 'pptx', section: 'operations,conversionPairs' });
  assert.equal(capacity.value.response.ok, true, JSON.stringify(capacity));
  assert.deepEqual(Object.keys(capacity.value.response.capacity).sort(), ['conversionPairs','operations']);
  assert.ok(capacity.value.response.capacity.conversionPairs.every(v => v.sourceFormat === 'pptx'));
  const operation = await call('filens_capacity', { op: 'read' });
  assert.deepEqual(Object.keys(operation.value.response.capacity), ['operations']);
  assert.deepEqual(operation.value.response.capacity.operations.map(v => v.name), ['read']);
  const keyword = await call('filens_capacity', { query: 'OCR', section: 'formats' });
  assert.ok(keyword.value.response.capacity.formats.length > 0);
  assert.ok(keyword.value.response.capacity.formats.every(v => v.ocr === true));
  const full = await call('filens_capacity', { op: 'read', detail: 'full' });
  assert.deepEqual(JSON.parse(full.content[0].text), full.value);
  for (const [query, from, to] of [['docx>?', 'docx', ''], ['?>pdf', '', 'pdf']]) {
    const direction = await call('filens_capacity', { query });
    assert.equal(direction.value.response.ok, true, JSON.stringify(direction));
    assert.deepEqual(Object.keys(direction.value.response.capacity), ['conversionPairs']);
    assert.ok(direction.value.response.capacity.conversionPairs.every(p => (!from || p.sourceFormat === from) && (!to || p.targetFormat === to)));
  }
  const page = await call('filens_read', { path: path.join(repository, 'converter/rapidocr/testdata/scan.pdf'), pages: '2', ocr: 'always' });
  assert.equal(page.value.response.ok, true, JSON.stringify(page));
  assert.match(page.value.response.content.text, /BRIGHT2027/);
  assert.ok(page.value.response.content.document.blocks.every(b => b.page === 2 && b.source === 'ocr'));
  const image = await readFile(path.join(repository, 'converter/rapidocr/testdata/scan.png'));
  await writeFile(path.join(root, 'a.png'), image); await writeFile(path.join(root, 'b.png'), image);
  for (const tool of ['filens_duplicates', 'filens_similar_images']) {
    const result = await call(tool, { path: root });
    assert.equal(result.value.response.ok, true, JSON.stringify(result));
    assert.equal(result.value.response.similarity.groups.length, 1);
  }
});

test('session cwd and shell environment use the DSH services', async t => {
  const root = await mkdtemp(path.join(tmpdir(), 'filens-dsh-session-'));
  await writeFile(path.join(root, 'relative.txt'), 'Session-owned relative file');
  const agent = { session: {} };
  let ensured = false, collected = false;
  const { ctx } = await toolContext({}, {
    workingDirectory: { ensure: async (owner, signal) => { assert.equal(owner, agent); assert.equal(signal.aborted, false); ensured = true; return root; } },
    shellEnv: { collect: exec => { assert.equal(exec.agent, agent); collected = true; return {}; } },
  });
  t.after(async () => { await ctx.fiber.dispose(); await rm(root, { recursive: true, force: true }); });
  // Exercise the registered implementation to isolate cwd ownership from the
  // full agent-loop fixture; pipeline behavior is covered by the preceding test.
  const value = await ctx.tools.get('filens_read').execute({ path: 'relative.txt' }, { agent, signal: new AbortController().signal });
  assert.match(JSON.stringify(value), /Session-owned relative file/);
  assert.equal(ensured && collected, true);
});

test('per-call OCR control completes the requested native text scope without false failures', async t => {
  const root = await mkdtemp(path.join(tmpdir(), 'filens-dsh-ocr-'));
  const { ctx, call } = await toolContext();
  t.after(async () => { await ctx.fiber.dispose(); await rm(root, { recursive: true, force: true }); });
  const document = path.join(root, 'illustrated.docx');
  await writeFile(document, zipSync({
    'word/document.xml': strToU8('<w:document xmlns:w="word" xmlns:a="drawing" xmlns:r="rels"><w:body><w:p><w:r><w:t>NATIVE BEFORE</w:t><a:blip r:embed="image1"/><w:t>NATIVE AFTER</w:t></w:r></w:p></w:body></w:document>'),
    'word/_rels/document.xml.rels': strToU8('<Relationships><Relationship Id="image1" Target="media/scan.png"/></Relationships>'),
    'word/media/scan.png': await readFile(path.join(repository, 'converter/rapidocr/testdata/scan-transparent.png')),
  }));
  const recognized = await call('filens_read', { path: document, ocr: 'auto' });
  assert.equal(recognized.value.response.ok, true, JSON.stringify(recognized));
  assert.match(recognized.value.response.content.text, /NATIVE BEFORE[\s\S]*FILENS2026[\s\S]*NATIVE AFTER/);
  const native = await call('filens_read', { path: document, ocr: 'never', layout: true });
  assert.equal(native.value.exit_code, 0, JSON.stringify(native));
  assert.equal(native.value.response.ok, true);
  assert.equal(native.value.response.error, undefined);
  assert.equal(native.value.response.content.complete, true);
  assert.equal(native.value.response.content.textScope, 'native-text');
  assert.match(native.value.response.content.text, /NATIVE BEFORE[\s\S]*NATIVE AFTER/);
  assert.doesNotMatch(native.value.response.content.text, /FILENS2026/);

  const excerpt = await call('filens_excerpt', { path: document, query: 'NATIVE', ocr: 'never' });
  assert.equal(excerpt.value.exit_code, 0, JSON.stringify(excerpt));
  assert.match(excerpt.value.response.content.text, /NATIVE/);
  assert.doesNotMatch(excerpt.value.response.content.text, /FILENS2026/);
  const imageHit = await call('filens_search', { path: root, query: 'FILENS2026' });
  assert.equal(imageHit.value.response.search.matchedFiles, 1, JSON.stringify(imageHit));
  const skipped = await call('filens_search', { path: root, query: 'FILENS2026', ocr: 'never' });
  assert.equal(skipped.value.response.search.matchedFiles, 0, JSON.stringify(skipped));
  assert.equal(skipped.value.response.search.complete, true);
  const nativeHit = await call('filens_search', { path: root, query: 'NATIVE', ocr: 'never' });
  assert.equal(nativeHit.value.response.search.matchedFiles, 1, JSON.stringify(nativeHit));
  assert.equal(nativeHit.value.response.search.results[0].sourceComplete, true);
});

test('per-call OCR cannot re-enable recognition disabled by the plugin setting', async t => {
  const { ctx, call } = await toolContext({ ocr: false });
  t.after(() => ctx.fiber.dispose());
  const skipped = await call('filens_read', { path: path.join(repository, 'converter/rapidocr/testdata/scan.png'), ocr: 'auto' });
  assert.equal(skipped.value.exit_code, 0, JSON.stringify(skipped));
  assert.equal(skipped.value.response.ok, true);
  assert.equal(skipped.value.response.content.complete, true);
  assert.equal(skipped.value.response.content.textScope, 'native-text');
  assert.doesNotMatch(skipped.value.response.content.text, /FILENS2026/);
  const native = await call('filens_read', { path: path.join(repository, 'README.md'), ocr: 'auto' });
  assert.equal(native.value.response.ok, true, JSON.stringify(native));
  assert.match(native.value.response.content.text, /FiLens/);
});

test('real process deadline, cancellation and plugin unload stop execution', async t => {
  const command = [process.execPath, '-e', 'setTimeout(() => {}, 30000)', '--'];
  const { ctx, plugin, call } = await toolContext({ command });
  t.after(() => ctx.fiber.dispose());
  const timed = await call('filens_capacity', { timeout_ms: 100 });
  assert.equal(timed.isError, true);
  assert.match(JSON.stringify(timed), /deadline|timed out/);
  const controller = new AbortController();
  const cancelled = call('filens_capacity', {}, { signal: controller.signal });
  setTimeout(() => controller.abort(), 100);
  assert.equal((await cancelled).isError, true);
  const running = call('filens_capacity');
  setTimeout(() => plugin.dispose(), 100);
  assert.equal((await running).isError, true);
});

test('sandbox policy is forwarded, invalid escalation is rejected, denial is visible', async t => {
  const policy = { mode: 'read-only', root: process.cwd(), writableRoots: [] };
  let executed = 0;
  const shell = {
    sandboxMode: 'read-only', resolve: request => { assert.deepEqual(request.sandboxPolicy, policy); return request; },
    execute: async () => { executed++; return { result: async () => ({ sandbox: { denied: true, mode: 'read-only' }, stderr: { text: 'blocked' }, stdout: { text: '' } }) }; },
  };
  const { ctx, call } = await toolContext({}, { shell, sandboxPolicy: { resolve: () => policy }, approval: { request: async () => 'rejected' } });
  t.after(() => ctx.fiber.dispose());
  for (const args of [{ justification: 'orphan reason' }, { sandbox_permissions: 'danger-full-access' }]) {
    assert.equal((await call('filens_capacity', args)).isError, true);
  }
  assert.equal(executed, 0);
  const denied = await call('filens_capacity');
  assert.equal(denied.isError, true);
  assert.match(JSON.stringify(denied), /sandbox.*blocked/);
  assert.equal(executed, 1);
  const repeated = await call('filens_capacity', { sandbox_permissions: 'read-only' });
  assert.equal(repeated.isError, true);
  assert.equal(executed, 2);
  await assert.rejects(ctx.tools.get('filens_capacity').execute({ sandbox_permissions: 'danger-full-access', justification: 'Test rejected escalation' }, { agent: { session: {} }, callId: 'rejected', signal: new AbortController().signal }), /user rejected/);
  assert.equal(executed, 2);
});

test('runner failures and malformed/truncated JSON are never reported as successful values', () => {
  const run = { stdout: { text: '{"ok":true}' }, stderr: { text: '' }, exitCode: 0 };
  assert.throws(() => parseResult({ ...run, stdout: { text: '{"ok":true}', truncated: true } }), /output limit/);
  assert.throws(() => parseResult({ ...run, stdout: { text: 'not JSON' } }), /invalid JSON/);
  assert.throws(() => parseResult({ ...run, exitCode: 127 }), /unexpectedly/);
  assert.throws(() => parseResult({ ...run, sandbox: { mode: 'read-only', runnerFailed: true } }), /sandbox/);
});
