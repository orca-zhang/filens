import assert from 'node:assert/strict';
import { chmod, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { after, before, test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { prepare } from './corpus.mjs';
import { invoke } from './bench.mjs';
import { retrievalMetrics, scoreAnswer, scoreRows, validAnswer } from './metrics.mjs';
import { tables } from './table.mjs';
import { ledger } from './ledger.mjs';

let directory, manifest;
before(async () => {
  directory = await mkdtemp(path.join(os.tmpdir(), 'filens-bench-test-'));
  manifest = await prepare(path.join(directory, 'first'), { distractors: 3 });
});
after(async () => rm(directory, { recursive: true, force: true }));
const gold = task => ({ status: Object.keys(task.answers).length ? 'answered' : 'not_found', answers: Object.entries(task.answers).map(([key, value]) => ({ key, value })), citations: task.evidence.map(({ source, anchor }) => ({ source, quote: anchor })) });
const identity = { system: 'codex-test', harness: 'codex', harnessVersion: 'test-only', model: 'fixed-test-model', reasoningEffort: 'medium' };
const rowsFor = (tasks, extra = {}) => ['stock', 'filens'].flatMap(condition => tasks.map(task => ({ ...identity, condition, taskId: task.id, repeat: 0, elapsedMs: condition === 'stock' ? 200 : 100, operational: true, response: gold(task), ...extra })));

test('fixture hashes and gold are reproducible and labels stay outside corpus', async () => {
  const other = await prepare(path.join(directory, 'second'), { distractors: 3 });
  assert.deepEqual(other, manifest);
  assert.deepEqual((await readdir(path.join(directory, 'first/corpus'))).sort(), manifest.physicalFiles.map(file => file.source).sort());
  assert.equal(manifest.tasks.length, 11);
  assert.ok(manifest.documents.some(doc => doc.source.includes('!/inner.zip!/')));
});

test('all authored answers and evidence calibrate to 100', () => {
  for (const task of manifest.tasks) {
    const score = scoreAnswer(task, gold(task), manifest.documents);
    assert.equal(score.quality, 100, task.id);
    assert.equal(score.success, true, task.id);
  }
});

test('citation whitespace does not reduce evidence recall', () => {
  const task = { answers: { amount: '12345.67元' }, evidence: [{ source: 'invoice.pdf', anchor: '12345.67 元' }] };
  const documents = [{ source: 'invoice.pdf', text: '应付金额 12345.67 元' }];
  const response = { status: 'answered', answers: [{ key: 'amount', value: '12345.67元' }], citations: [{ source: 'invoice.pdf', quote: '12345.67元' }] };
  const score = scoreAnswer(task, response, documents);
  assert.equal(score.evidencePrecision, 1);
  assert.equal(score.evidenceRecall, 1);
  assert.equal(score.success, true);
});

test('wrong answers, invented quotes and missing multi-hop sources cannot pass', () => {
  const task = manifest.tasks.find(task => task.id === 'current-owner');
  const wrong = gold(task); wrong.answers[0].value = '周岚';
  assert.equal(scoreAnswer(task, wrong, manifest.documents).success, false);
  assert.equal(scoreAnswer(task, wrong, manifest.documents).accuracy, 0);
  const invented = gold(task); invented.citations[0].quote = '林澈 invented extra statement';
  assert.equal(scoreAnswer(task, invented, manifest.documents).evidencePrecision, 0);
  const extra = gold(task); extra.answers.push({ key: 'phone', value: '123' });
  assert.ok(scoreAnswer(task, extra, manifest.documents).accuracy < 1);
  const multi = manifest.tasks.find(task => task.id === 'cross-file-sum');
  const missing = gold(multi); missing.citations.pop();
  assert.equal(scoreAnswer(multi, missing, manifest.documents).success, false);
});

test('abstention, protocol errors and operational failures are scored explicitly', () => {
  const absent = manifest.tasks.find(task => task.id === 'absent-id');
  assert.equal(scoreAnswer(absent, gold(absent), manifest.documents).success, true);
  const guessed = { status: 'answered', answers: [{ key: 'owner', value: 'someone' }], citations: [] };
  assert.equal(scoreAnswer(absent, guessed, manifest.documents).quality, 0);
  const task = manifest.tasks[0];
  assert.equal(scoreAnswer(task, gold(task), manifest.documents, false).quality, 0);
  assert.equal(scoreAnswer(task, null, manifest.documents).quality, 0);
  const duplicate = gold(task); duplicate.answers.push(duplicate.answers[0]);
  assert.equal(validAnswer(duplicate), false);
  assert.equal(retrievalMetrics([], absent, false).empty, false);
  assert.equal(retrievalMetrics(['f001.docx'], absent, false).falsePositive, true);
});

test('matrix separates harnesses, pairs only comparable cells, and enforces a fixed model', () => {
  const rows = rowsFor(manifest.tasks);
  const second = rowsFor(manifest.tasks, { system: 'dsh-test', harness: 'dsh' });
  const report = scoreRows([...rows, ...second], manifest, 150);
  assert.equal(report.matrix.filens['dsh-test'].quality, 100);
  assert.equal(report.matrix.stock['codex-test'].scoreAtBudget, 0);
  assert.equal(report.matrix.filens['codex-test'].scoreAtBudget, 100);
  assert.equal(report.pairs.length, 4);
  assert.equal(report.pairs[0].medianSpeedupFirstOverSecond, 2);
  assert.throws(() => scoreRows([...rows, ...second.map(row => ({ ...row, model: 'different-model' }))], manifest), /fixed model/);
});

test('missing, duplicate and unknown attempts cannot silently improve the score', () => {
  const rows = rowsFor(manifest.tasks);
  assert.throws(() => scoreRows(rows.slice(1), manifest), /Missing observation/);
  assert.throws(() => scoreRows([...rows, rows[0]], manifest), /Duplicate observation/);
  assert.throws(() => scoreRows([{ ...rows[0], taskId: 'unknown' }], manifest), /Unknown task/);
  assert.throws(() => scoreRows(rows, manifest, 120000, 2), /Missing observation/);
});

test('score tables include negative changes, failures, controls and untested harnesses', () => {
  const rows = rowsFor(manifest.tasks).map(row => row.condition === 'filens' ? { ...row, operational: false } : row);
  const claudeRows = rowsFor(manifest.tasks, { system: 'claude-test', harness: 'Claude Code' });
  const report = scoreRows([...rows, ...claudeRows], manifest);
  const output = tables(report, manifest);
  const header = output.markdown.split('\n').find(line => line.startsWith('| 使用环境 |'));
  assert.match(output.markdown, /-100\.0 分/);
  assert.match(output.markdown, /未测试/);
  assert.match(output.markdown, /纯文本控制题/);
  assert.match(output.markdown, /cross-file-sum/);
  assert.equal(header.match(/Claude \/ Claude Code/g)?.length, 1);
  assert.match(output.markdown, /WorkBuddy/);
  assert.match(output.markdown, /OpenClaw/);
  assert.match(output.matrixCSV, /"operationalFailures"/);
  assert.equal(output.taskCSV.trim().split('\n').length, manifest.tasks.length * 2 + 1);
});

test('usage ledger counts cache and reasoning once and retains failed and unknown attempts', () => {
  const rows = rowsFor(manifest.tasks, { usage: { input_tokens: 100, cached_input_tokens: 60, cache_write_input_tokens: 10, output_tokens: 20, reasoning_output_tokens: 5 }, toolCalls: 2 });
  rows[0] = { ...rows[0], operational: false, usage: null };
  const report = scoreRows(rows, manifest), billed = ledger(report, manifest);
  const entry = billed.data.entries[1], total = billed.data.summary.totals;
  assert.equal(entry.uncachedInputTokens, 30);
  assert.equal(entry.totalTokens, 120);
  assert.equal(entry.amount, null);
  assert.equal(entry.pricingStatus, 'unpriced');
  assert.equal(billed.data.entries[0].success, false);
  assert.equal(billed.data.entries[0].totalTokens, null);
  assert.equal(billed.data.entries.length, rows.length);
  assert.equal(total.totalTokens.total, null);
  assert.equal(total.totalTokens.knownSubtotal, (rows.length - 1) * 120);
  assert.equal(total.totalTokens.unknownAttempts, 1);
  assert.equal(billed.data.groups[`${identity.system}/filens`].tokensPerSuccessfulTask, 120);
  assert.equal(billed.data.groups[`${identity.system}/stock`].tokensPerSuccessfulTask, null);
  assert.match(billed.markdown, /未计价/);
  assert.equal(billed.csv.trim().split('\n').length, rows.length + 1);
  const calibration = ledger({ observations: [{ ...report.observations[0], elapsedMs: null }] }, { tasks: [] });
  assert.equal(calibration.data.summary.elapsedMs, null);
  assert.equal(calibration.data.summary.knownElapsedMs, 0);
  assert.doesNotMatch(calibration.markdown, /复杂文件题 token 对比/);
  const knownFailures = ledger({ observations: [report.observations[1], { ...report.observations[1], score: { success: false } }] }, manifest);
  assert.equal(knownFailures.data.summary.tokensPerSuccessfulTask, 240);
  rows[1].usage.cached_input_tokens = 101;
  assert.throws(() => ledger(scoreRows(rows, manifest), manifest), /Cache tokens exceed/);
  rows[1].usage.cached_input_tokens = 60;
  rows[1].usage.reasoning_output_tokens = 21;
  assert.throws(() => ledger(scoreRows(rows, manifest), manifest), /Reasoning tokens exceed/);
});

test('runner records launch failures, timeouts and multibyte output', async () => {
  const missing = await invoke(path.join(directory, 'not-installed'), [], { timeout: 500 });
  assert.ok(missing.error);
  const timeout = await invoke(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { timeout: 150 });
  assert.equal(timeout.timedOut, true);
  const unicode = await invoke(process.execPath, ['-e', 'for (const byte of Buffer.from("林澈")) process.stdout.write(Buffer.from([byte]))']);
  assert.equal(unicode.stdout, '林澈');
});

test('agent uses separate environments and identical unprompted tasks without requiring a FiLens binary', async () => {
  const fakeAdapter = path.join(directory, 'fake-adapter.mjs');
  await writeFile(fakeAdapter, `import assert from 'node:assert/strict';
let input=''; for await(const chunk of process.stdin) input+=chunk;
const request=JSON.parse(input);
assert.equal(request.condition,process.argv[2]);
assert.equal(request.prompt.task.answers,undefined); assert.equal(request.prompt.task.evidence,undefined);
assert.equal(request.prompt.task.retrieval,undefined);
assert.equal(request.prompt.condition,undefined); assert.equal(request.prompt.model,undefined);
assert.equal(request.filensBinary,undefined); assert.equal(request.prompt.toolProfile,undefined);
assert.doesNotMatch(JSON.stringify({...request.prompt,corpus:'<corpus>'}),/filens|ripgrep|embedding|FTS/i);
console.log(JSON.stringify({response:{status:'not_found',answers:[],citations:[]}}));
`);
  const adapter = path.join(directory, 'adapter.json');
  await writeFile(adapter, JSON.stringify({ id: identity.system, harness: identity.harness, harnessVersion: identity.harnessVersion, model: identity.model, reasoningEffort: identity.reasoningEffort,
    commands: { stock: [process.execPath, fakeAdapter, 'stock'], filens: [process.execPath, fakeAdapter, 'filens'] } }));
  const work = path.join(directory, 'first');
  const result = await invoke(process.execPath, [fileURLToPath(new URL('./bench.mjs', import.meta.url)), 'agent', '--work', work, '--binary', path.join(directory, 'not-installed'), '--adapter', adapter, '--task', 'text-control', '--repeats', '1']);
  assert.equal(result.exit, 0, result.stderr);
  const reportFolder = (await readdir(work)).find(name => name.startsWith('agent-'));
  const report = JSON.parse(await readFile(path.join(work, reportFolder, 'report.json'), 'utf8'));
  assert.equal(report.observations.length, 2);
  assert.equal(report.matrix.filens[identity.system].quality, 0);
  assert.equal(report.matrix.stock[identity.system].operationalFailures, 0);
  assert.ok(await readFile(path.join(work, reportFolder, 'observations.json')));
  const stock = JSON.parse(await readFile(path.join(work, reportFolder, 'text-control-0-stock.json'), 'utf8'));
  const filens = JSON.parse(await readFile(path.join(work, reportFolder, 'text-control-0-filens.json'), 'utf8'));
  assert.deepEqual(stock.request.prompt, filens.request.prompt);
});

test('agent can rerun only FiLens and score that condition without inventing a stock comparison', async () => {
  const fakeAdapter = path.join(directory, 'fake-adapter-filens-only.mjs');
  await writeFile(fakeAdapter, `let input=''; for await(const chunk of process.stdin) input+=chunk;
const request=JSON.parse(input); if(request.condition!=='filens') process.exit(9);
console.log(JSON.stringify({response:{status:'not_found',answers:[],citations:[]}}));
`);
  const adapter = path.join(directory, 'adapter-filens-only.json');
  await writeFile(adapter, JSON.stringify({ id: identity.system, harness: identity.harness, harnessVersion: identity.harnessVersion, model: identity.model, reasoningEffort: identity.reasoningEffort,
    commands: { stock: [path.join(directory, 'must-not-run')], filens: [process.execPath, fakeAdapter] } }));
  const work = path.join(directory, 'first');
  const runner = fileURLToPath(new URL('./bench.mjs', import.meta.url));
  const existingRuns = new Set((await readdir(work)).filter(name => name.startsWith('agent-')));
  const result = await invoke(process.execPath, [runner, 'agent', '--adapter', adapter, '--condition', 'filens', '--work', work, '--task', 'text-control', '--repeats', '1']);
  assert.equal(result.exit, 0, result.stderr);
  const runFolder = (await readdir(work)).find(name => name.startsWith('agent-') && !existingRuns.has(name));
  const runDir = path.join(work, runFolder);
  const report = JSON.parse(await readFile(path.join(runDir, 'report.json'), 'utf8'));
  assert.deepEqual(report.selectedConditions, ['filens']);
  assert.deepEqual(Object.keys(report.matrix), ['filens']);
  assert.deepEqual(report.pairs, []);
  const observations = path.join(runDir, 'observations.json');
  assert.equal(JSON.parse(await readFile(observations, 'utf8')).length, 1);

  const scored = await invoke(process.execPath, [runner, 'score', '--input', observations, '--work', work, '--task', 'text-control', '--repeats', '1', '--output', path.join(runDir, 'score.json')]);
  assert.equal(scored.exit, 0, scored.stderr);
  const score = JSON.parse(await readFile(path.join(runDir, 'score.json'), 'utf8'));
  assert.deepEqual(Object.keys(score.matrix), ['filens']);
  assert.deepEqual(score.pairs, []);

  const rendered = await invoke(process.execPath, [runner, 'table', '--input', path.join(runDir, 'score.json'), '--work', work, '--output', path.join(runDir, 'tables')]);
  assert.equal(rendered.exit, 0, rendered.stderr);
  const scores = await readFile(path.join(runDir, 'tables/scores.md'), 'utf8');
  assert.match(scores, /单组评分表/);
  assert.match(scores, /不计算配对差值/);
  assert.match(scores, /本报告不含原生对照/);
  assert.doesNotMatch(scores, /两组使用相同用户题目/);
  assert.doesNotMatch(scores, /安装后的配对变化|0\/0/);
  assert.match(scores, /正常安装 FiLens/);
  assert.ok(await readFile(path.join(runDir, 'tables/billing.md'), 'utf8'));
});

test('Codex adapter preserves native configuration and sends only the neutral prompt', { skip: process.platform === 'win32' }, async () => {
  const fakeCodex = path.join(directory, 'codex-fake');
  await writeFile(fakeCodex, `#!/usr/bin/env node
const assert=require('node:assert/strict'),fs=require('node:fs');
const args=process.argv.slice(2);
assert.ok(!args.includes('--ignore-user-config')); assert.ok(!args.includes('--sandbox'));
assert.equal(args[args.indexOf('--profile')+1],'with-filens');
let input='';process.stdin.on('data',chunk=>input+=chunk).on('end',()=>{
 const prompt=JSON.parse(input); assert.equal(prompt.condition,undefined); assert.equal(prompt.model,undefined);
 assert.deepEqual(Object.keys(prompt).sort(),['answerSchema','corpus','instruction','task']);
 fs.writeFileSync(args[args.indexOf('--output-last-message')+1],JSON.stringify({status:'not_found',answers:[],citations:[]}));
 console.log(JSON.stringify({type:'turn.completed',usage:{input_tokens:42,output_tokens:7}}));
});

`);
  await chmod(fakeCodex, 0o755);
  const previous = process.env.FILENS_BENCH_CODEX;
  process.env.FILENS_BENCH_CODEX = fakeCodex;
  try {
    const request = { condition: 'filens', model: identity.model, reasoningEffort: identity.reasoningEffort,
      prompt: { corpus: directory, task: { question: '查询文件' }, answerSchema: {}, instruction: '自主选择工具' } };
    const result = await invoke(process.execPath, [fileURLToPath(new URL('./codex-adapter.mjs', import.meta.url)), '--profile', 'with-filens'], { input: JSON.stringify(request) });
    assert.equal(result.exit, 0, result.stderr);
    const value = JSON.parse(result.stdout);
    assert.equal(value.operational, true, value.trace.stderr);
    assert.equal(value.usage.input_tokens, 42);
  } finally {
    if (previous === undefined) delete process.env.FILENS_BENCH_CODEX;
    else process.env.FILENS_BENCH_CODEX = previous;
  }
});

test('DSH adapter orders loader overlays first and preserves neutral prompts and reported usage', { skip: process.platform === 'win32' }, async () => {
  const fakeDSH = path.join(directory, 'dsh-fake');
  await writeFile(fakeDSH, `#!/usr/bin/env node
const assert=require('node:assert/strict'),fs=require('node:fs');
const args=process.argv.slice(2),lastPatch=args.lastIndexOf('--patch');
assert.ok(lastPatch<args.indexOf('--permission-mode'));
const overlay=JSON.parse(fs.readFileSync(args[lastPatch+1]));
assert.equal(overlay[0].config.model,'fixed-test-model');
assert.equal(overlay[0].config.reasoningEffort,'medium');
assert.equal(overlay[0].config.provider,'test-route');
let input='';process.stdin.on('data',chunk=>input+=chunk).on('end',()=>{
 const prompt=JSON.parse(input);assert.equal(prompt.condition,undefined);assert.equal(prompt.model,undefined);
for(const event of [{type:'tool_call',tool:'bash'},{type:'status',phase:'step_end',usage:{inputTokens:11,outputTokens:3,totalTokens:14}},{type:'status',phase:'step_end',usage:{inputTokens:12,outputTokens:4,cacheReadTokens:5,cacheWriteTokens:2,totalTokens:23}},{type:'final',reason:{kind:'completed'},text:String.fromCharCode(96,96,96)+'json'+String.fromCharCode(10)+JSON.stringify({status:'not_found',answers:[],citations:[]})+String.fromCharCode(10)+String.fromCharCode(96,96,96)}]) console.log(JSON.stringify(event));
});
`);
  await chmod(fakeDSH, 0o755);
  const previous = process.env.FILENS_BENCH_DSH;
  process.env.FILENS_BENCH_DSH = fakeDSH;
  try {
    const request = { condition: 'filens', provider: 'test-route', model: identity.model, reasoningEffort: identity.reasoningEffort,
      prompt: { corpus: directory, task: { question: '查询文件' }, answerSchema: {}, instruction: '自主选择工具' } };
    const result = await invoke(process.execPath, [fileURLToPath(new URL('./dsh-adapter.mjs', import.meta.url)), '--patch', 'provider.json', '--permission-mode', 'workspace-write'], { input: JSON.stringify(request) });
    assert.equal(result.exit, 0, result.stderr);
    const value = JSON.parse(result.stdout);
    assert.equal(value.operational, true, value.trace.stderr);
    assert.deepEqual(value.usage, { input_tokens: 30, reported_input_tokens: 23, cached_input_tokens: 5, cache_write_input_tokens: 2, output_tokens: 7, reasoning_output_tokens: null });
    assert.equal(value.toolCalls, 1);
    assert.equal(value.response.status, 'not_found');
  } finally {
    if (previous === undefined) delete process.env.FILENS_BENCH_DSH;
    else process.env.FILENS_BENCH_DSH = previous;
  }
});

test('Claude Code adapter sends the neutral prompt, pins model settings, and sums cached input usage', { skip: process.platform === 'win32' }, async () => {
  const fakeClaude = path.join(directory, 'claude-fake');
  await writeFile(fakeClaude, `#!/usr/bin/env node
const assert=require('node:assert/strict');
const args=process.argv.slice(2);
assert.ok(args.includes('--print'));
assert.ok(args.includes('--verbose'));
assert.equal(args[args.indexOf('--output-format')+1],'stream-json');
assert.equal(args[args.indexOf('--model')+1],'claude-test-model');
assert.equal(args[args.indexOf('--effort')+1],'high');
assert.equal(JSON.parse(args[args.indexOf('--json-schema')+1]).required[0],'status');
let input='';process.stdin.on('data',chunk=>input+=chunk).on('end',()=>{
 const prompt=JSON.parse(input);assert.equal(prompt.condition,undefined);assert.equal(prompt.model,undefined);
 assert.deepEqual(Object.keys(prompt).sort(),['answerSchema','corpus','instruction','task']);
 console.log(JSON.stringify({type:'assistant',message:{content:[{type:'tool_use',name:'Bash'}]}}));
 console.log(JSON.stringify({type:'result',subtype:'success',structured_output:{status:'not_found',answers:[],citations:[]},usage:{input_tokens:10,cache_read_input_tokens:5,cache_creation_input_tokens:2,output_tokens:4}}));
});
`);
  await chmod(fakeClaude, 0o755);
  const previous = process.env.FILENS_BENCH_CLAUDE;
  process.env.FILENS_BENCH_CLAUDE = fakeClaude;
  try {
    const request = { condition: 'filens', model: 'claude-test-model', reasoningEffort: 'high',
      prompt: { corpus: directory, task: { id: 'absent', question: '查询文件', answerKeys: [] }, answerSchema: { type: 'object', required: ['status'] }, instruction: '自主选择工具' } };
    const result = await invoke(process.execPath, [fileURLToPath(new URL('./claude-adapter.mjs', import.meta.url))], { input: JSON.stringify(request) });
    assert.equal(result.exit, 0, result.stderr);
    const value = JSON.parse(result.stdout);
    assert.equal(value.operational, true, value.trace.stderr);
    assert.deepEqual(value.response, { status: 'not_found', answers: [], citations: [] });
    assert.deepEqual(value.usage, { input_tokens: 17, reported_input_tokens: 10, cached_input_tokens: 5, cache_write_input_tokens: 2, output_tokens: 4, reasoning_output_tokens: null });
    assert.equal(value.toolCalls, 1);
  } finally {
    if (previous === undefined) delete process.env.FILENS_BENCH_CLAUDE;
    else process.env.FILENS_BENCH_CLAUDE = previous;
  }
});
