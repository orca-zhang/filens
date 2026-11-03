import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtemp, readFile, writeFile, rm, access } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { toolContext } from './helpers.mjs';
import { parseResult } from '../src/requests.js';

const repository = fileURLToPath(new URL('../../../', import.meta.url));

test('real DSH pipeline: capacity, OCR, read, search, excerpt, conversion and no overwrite', async t => {
  const root = await mkdtemp(path.join(tmpdir(), 'filens-dsh-tools-'));
  const { ctx, plugin, call } = await toolContext();
  t.after(async () => { await ctx.fiber.dispose(); await rm(root, { recursive: true, force: true }); });
  assert.equal(ctx.tools.schemas().length, 5);
  const capacity = await call('filens_capacity');
  assert.equal(capacity.isError, false, JSON.stringify(capacity));
  assert.equal(capacity.value.response.ok, true);
  assert.equal(capacity.value.response.capacity.ocr.available, true);
  const ocr = await call('filens_read', { path: path.join(repository, 'converter/rapidocr/testdata/scan.pdf'), layout: true });
  assert.equal(ocr.value.response.ok, true, JSON.stringify(ocr));
  assert.match(ocr.value.response.content.text, /FILENS2026[\s\S]*BRIGHT2027/);
  for (const file of ['filens-cosmic-atlas.pdf', 'filens-aurora-guide.docx', 'filens-observatory.xlsx', 'filens-field-notes.pptx']) {
    const result = await call('filens_read', { path: path.join(repository, 'apps/demo/public/samples', file) });
    assert.equal(result.isError, false, JSON.stringify(result));
    assert.equal(result.value.response.ok, true, JSON.stringify(result.value));
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
