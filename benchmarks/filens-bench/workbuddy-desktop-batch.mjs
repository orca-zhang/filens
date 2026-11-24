import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { createInterface } from 'node:readline/promises';
import { stdin, stdout } from 'node:process';
import { fileURLToPath } from 'node:url';
import { answerSchema, extractJsonObject, scoreAnswer, validAnswer } from './metrics.mjs';
import { sha256 } from './corpus.mjs';

const args = process.argv.slice(2);
const flag = (name, fallback) => {
  const index = args.indexOf(name);
  return index < 0 ? fallback : args[index + 1];
};
const root = fileURLToPath(new URL('../../', import.meta.url));
const work = path.resolve(flag('--work', path.join(root, 'dist/filens-bench')));
const condition = flag('--condition');
const observationsFile = path.resolve(flag('--observations', path.join(work, 'workbuddy-batch-observations.json')));
const promptRecord = flag('--prompt-record', null);
const harnessVersion = flag('--harness-version', '5.11.3.43806934');
const system = flag('--system', 'workbuddy-desktop-hy4-batch');
const model = flag('--model', 'Hy4 flash');

function usage() {
  console.log('Usage: node workbuddy-desktop-batch.mjs --work DIR --condition stock|filens [--observations FILE]');
}

if (args.includes('--help') || !['stock', 'filens'].includes(condition)) {
  usage();
  process.exit(args.includes('--help') ? 0 : 2);
}

const manifest = JSON.parse(await readFile(path.join(work, 'manifest.json'), 'utf8'));
assert.equal(manifest.schema, 'filens-bench-v1');
for (const file of manifest.physicalFiles) assert.equal(sha256(await readFile(path.join(work, 'corpus', file.source))), file.sha256, `Corpus changed: ${file.source}`);
const corpusSHA256 = sha256(await readFile(path.join(work, 'manifest.json')));
let observations = [];
try {
  const saved = JSON.parse(await readFile(observationsFile, 'utf8'));
  assert.equal(saved.schema, 'filens-bench-workbuddy-batch-v1');
  assert.equal(saved.corpusSHA256, corpusSHA256);
  observations = saved.observations;
} catch (error) {
  if (error.code !== 'ENOENT') throw error;
}
assert.ok(Array.isArray(observations), 'Observations must be a JSON array');
const previous = observations.filter(row => row.system === system && row.condition === condition);
assert.ok(observations.every(row => row.system !== system || (row.harness === 'WorkBuddy Desktop' && row.harnessVersion === harnessVersion && row.model === model && row.reasoningEffort === 'default')), `Existing observations for ${system} use a different WorkBuddy configuration`);
const repeat = Math.max(-1, ...previous.map(row => row.repeat)) + 1;

const outputSchema = {
  type: 'object', additionalProperties: false, required: ['results'],
  properties: {
    results: {
      type: 'array', items: {
        type: 'object', additionalProperties: false, required: ['taskId', 'response'],
        properties: { taskId: { type: 'string' }, response: answerSchema },
      },
    },
  },
};
const prompt = JSON.stringify({
  corpus: path.join(work, 'corpus'),
  tasks: manifest.tasks.map(({ id, question, answerKeys }) => ({ id, question, answerKeys })),
  outputSchema,
  instruction: '逐题独立回答 tasks 中的全部问题，自主选择当前环境可用的工具。不要读取参考答案、manifest、评测报告或其他答题会话；本地索引中的证据须来自本轮 corpus。最终只输出一个符合 outputSchema 的 JSON 对象，results 每题恰好一项，taskId 必须与题目 id 相同。answers 中只填所问字段；数字保留两位小数且不含单位，days 使用整数。citations.source 为 corpus 相对路径，压缩包成员用 !/ 分隔；quote 必须逐字引用原文，可以折叠空白。找不到事实返回 not_found，answers/citations 为空；提取失败或证据不足返回 insufficient_evidence。',
}, null, 2);
const rl = createInterface({ input: stdin, output: stdout });
const parse = text => {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  return extractJsonObject(fenced?.[1] ?? text, value => Object.keys(value).length === 1 && Array.isArray(value.results));
};
const parseDurationMs = value => {
  const input = value.trim().toLowerCase();
  if (!input) return null;
  const clock = input.match(/^(\d+):(\d{1,2})(?:\.(\d{1,3}))?$/);
  if (clock) return (Number(clock[1]) * 60 + Number(clock[2]) + Number(`0.${clock[3] ?? 0}`)) * 1000;
  const durationPattern = /(\d+(?:\.\d+)?)\s*(hours?|hrs?|hr|h|minutes?|mins?|min|m|seconds?|secs?|sec|s)/g;
  const parts = [...input.matchAll(durationPattern)];
  if (parts.length) {
    const parsed = parts.reduce((total, [, amount, unit]) => total + Number(amount) * (unit.startsWith('h') ? 3_600_000 : unit.startsWith('m') ? 60_000 : 1_000), 0);
    const residue = input.replace(durationPattern, '').replace(/[\s,]/g, '');
    assert.equal(residue, '', `Invalid UI elapsed time: ${value}`);
    return parsed;
  }
  const seconds = Number(input);
  assert.ok(Number.isFinite(seconds) && seconds > 0, `Invalid UI elapsed time: ${value}`);
  return seconds * 1_000;
};
const clipboardText = () => spawnSync('pbpaste', [], { encoding: 'utf8' }).stdout?.trim() ?? '';
console.log(`WorkBuddy batch · ${condition} · repeat ${repeat} · ${manifest.tasks.length} tasks · ${model}`);
console.log(`Corpus: ${path.join(work, 'corpus')}`);
if (promptRecord) {
  const recordPath = path.resolve(promptRecord);
  await mkdir(path.dirname(recordPath), { recursive: true });
  await writeFile(recordPath, `${prompt}\n`);
  console.log(`Prompt record: ${recordPath}`);
}
if ((await rl.question(`Confirm WorkBuddy is set to ${model}? [Y/n] `)).trim().toLowerCase() === 'n') {
  rl.close();
  process.exit(2);
}
const copied = spawnSync('pbcopy', [], { input: prompt, encoding: 'utf8' });
if (copied.error || copied.status !== 0) {
  console.log(`Clipboard copy failed. Copy this prompt manually:\n${prompt}`);
  rl.close();
  process.exit(2);
}
const copiedText = clipboardText();
if (copiedText !== prompt) {
  console.log(`Clipboard verification failed (expected ${prompt.length} characters, read ${copiedText.length}); timing was not started. Copy this prompt manually:\n${prompt}`);
  rl.close();
  process.exit(2);
}
console.log(`Prompt copied and verified · ${prompt.length} characters · SHA-256 ${sha256(prompt).slice(0, 16)} · tasks: ${manifest.tasks.map(task => task.id).join(', ')}`);
await rl.question('Send the copied prompt in a fresh WorkBuddy conversation, then press Enter here to start timing. ');
let initialClipboard = clipboardText();
if (initialClipboard !== prompt) {
  const recopied = spawnSync('pbcopy', [], { input: prompt, encoding: 'utf8' });
  assert.ok(!recopied.error && recopied.status === 0, 'Clipboard changed before timing and the prompt could not be recopied');
  console.log('Clipboard changed before timing; the benchmark prompt was recopied. Send it in a fresh WorkBuddy conversation, then press Enter here again.');
  await rl.question('Press Enter after sending the recopied prompt. ');
  initialClipboard = clipboardText();
  assert.equal(initialClipboard, prompt, 'Clipboard no longer contains this benchmark prompt; timing was not started');
}
const started = performance.now();
console.log('Copy the complete final answer; timing stops when valid JSON reaches the clipboard. Press Enter to stop manually.');
const timing = await new Promise(resolve => {
  let finished = false;
  const finish = (source, raw) => {
    if (finished) return;
    finished = true;
    clearInterval(poll);
    rl.removeListener('line', stopManually);
    resolve({ source, raw });
  };
  const stopManually = () => finish('manual-desktop-batch-stopwatch', clipboardText());
  const poll = setInterval(() => {
    const raw = clipboardText();
    if (raw && raw !== initialClipboard && parse(raw)) finish('clipboard-auto-detect-250ms', raw);
  }, 250);
  rl.once('line', stopManually);
});
const runnerElapsedMs = performance.now() - started;
const completed = (await rl.question('Did WorkBuddy finish with a response? [Y/n] ')).trim().toLowerCase() !== 'n';
let raw = completed ? timing.raw : '';
let response = parse(raw);
if (completed && !response) {
  raw = (await rl.question('Clipboard was not valid JSON. Paste the batch JSON, or leave blank if the run failed: ')).trim();
  response = parse(raw);
}
const uiElapsedInput = await rl.question('WorkBuddy UI elapsed (e.g. 68s or 1m8s; blank if unavailable): ');
const userReportedElapsedMs = parseDurationMs(uiElapsedInput);
const elapsedMs = userReportedElapsedMs ?? runnerElapsedMs;
const number = async label => {
  const value = (await rl.question(`${label} (blank if unavailable): `)).trim();
  if (!value) return null;
  const parsed = Number(value);
  assert.ok(Number.isInteger(parsed) && parsed >= 0, `${label} must be a nonnegative integer`);
  return parsed;
};
const inputTokens = await number('Input tokens');
const cachedInputTokens = await number('Cached input tokens');
const outputTokens = await number('Output tokens');
if (inputTokens !== null && cachedInputTokens !== null) assert.ok(cachedInputTokens <= inputTokens, 'Cached input tokens cannot exceed input tokens');
rl.close();

const results = Array.isArray(response?.results) ? response.results : [];
const resultByTask = new Map();
for (const item of results) {
  if (manifest.tasks.some(task => task.id === item?.taskId) && !resultByTask.has(item.taskId)) resultByTask.set(item.taskId, item.response);
}
const taskScores = manifest.tasks.map(task => {
  const answer = resultByTask.get(task.id) ?? null;
  const score = scoreAnswer(task, answer, manifest.documents, completed && validAnswer(answer));
  return { taskId: task.id, track: task.track, ...score };
});
const average = values => values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null;
const summaryFor = rows => ({
  tasks: rows.length,
  quality: average(rows.map(row => row.quality)),
  accuracy: average(rows.map(row => row.accuracy)),
  successRate: average(rows.map(row => Number(row.success))),
});
const tokenUsage = { input_tokens: inputTokens, cached_input_tokens: cachedInputTokens, output_tokens: outputTokens };
const row = {
  system, harness: 'WorkBuddy Desktop', harnessVersion, model, reasoningEffort: 'default',
  capturedAt: new Date().toISOString(),
  corpusSHA256,
  protocol: 'single-batch-all-tasks', condition, repeat, elapsedMs, operational: completed,
  runnerElapsedMs,
  elapsedSource: userReportedElapsedMs === null ? 'runner-wall-time-to-clipboard' : 'user-reported-workbuddy-ui',
  ...(userReportedElapsedMs === null ? {} : { userReportedElapsedMs }),
  protocolValid: Array.isArray(response?.results) && results.length === manifest.tasks.length && new Set(results.map(item => item?.taskId)).size === manifest.tasks.length && taskScores.every(item => item.protocolValid),
  response, taskScores,
  summary: {
    all: summaryFor(taskScores),
    complex: summaryFor(taskScores.filter(item => item.track === 'complex')),
    textControls: summaryFor(taskScores.filter(item => item.track === 'text-control')),
  },
  usage: Object.values(tokenUsage).some(value => value !== null) ? tokenUsage : null,
  toolCalls: null, captureMethod: timing.source,
};
observations.push(row);
const paired = observations.filter(item => item.system === system && item.repeat === repeat);
const stock = paired.find(item => item.condition === 'stock');
const filens = paired.find(item => item.condition === 'filens');
const hasKnownTotal = item => item?.usage && Number.isInteger(item.usage.input_tokens) && Number.isInteger(item.usage.output_tokens);
const report = {
  schema: 'filens-bench-workbuddy-batch-v1',
  corpusSHA256: row.corpusSHA256,
  note: 'Exploratory batch protocol: all tasks are answered in one conversation. Batch latency and usage are aggregate values and are not comparable to single-task main-matrix results.',
  observations,
  comparison: stock && filens ? {
    repeat,
    qualityGain: filens.summary.complex.quality - stock.summary.complex.quality,
    successRateGain: filens.summary.complex.successRate - stock.summary.complex.successRate,
    batchSpeedupStockOverFilens: stock.elapsedMs / filens.elapsedMs,
    knownTotalTokens: hasKnownTotal(stock) && hasKnownTotal(filens)
      ? { stock: stock.usage.input_tokens + stock.usage.output_tokens, filens: filens.usage.input_tokens + filens.usage.output_tokens }
      : null,
  } : null,
};
await mkdir(path.dirname(observationsFile), { recursive: true });
await writeFile(observationsFile, JSON.stringify(report, null, 2) + '\n');
console.log(JSON.stringify({ saved: observationsFile, condition, repeat, elapsedMs, summary: row.summary, comparison: report.comparison }, null, 2));
