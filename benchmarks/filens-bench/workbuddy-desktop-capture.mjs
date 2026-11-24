import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { createInterface } from 'node:readline/promises';
import { stdin, stdout } from 'node:process';
import { fileURLToPath } from 'node:url';
import { answerSchema, extractJsonObject, validAnswer } from './metrics.mjs';
import { sha256 } from './corpus.mjs';

const args = process.argv.slice(2);
const flag = (name, fallback) => {
  const index = args.indexOf(name);
  return index < 0 ? fallback : args[index + 1];
};
const root = fileURLToPath(new URL('../../', import.meta.url));
const work = path.resolve(flag('--work', path.join(root, 'dist/filens-bench')));
const taskId = flag('--task');
const condition = flag('--condition');
const observationsFile = path.resolve(flag('--observations', path.join(work, 'workbuddy-observations.json')));
const harnessVersion = flag('--harness-version', '5.11.3.43806934');
const system = flag('--system', 'workbuddy-desktop-hy4');
const model = flag('--model', 'Hy4 flash');
const reasoningEffort = flag('--reasoning-effort', 'default');

function usage() {
  console.log('Usage: node workbuddy-desktop-capture.mjs --work DIR --task ID|all --condition stock|filens [--observations FILE]');
}

if (args.includes('--help') || !taskId || !['stock', 'filens'].includes(condition)) {
  usage();
  process.exit(args.includes('--help') ? 0 : 2);
}

const manifest = JSON.parse(await readFile(path.join(work, 'manifest.json'), 'utf8'));
assert.equal(manifest.schema, 'filens-bench-v1');
for (const file of manifest.physicalFiles) assert.equal(sha256(await readFile(path.join(work, 'corpus', file.source))), file.sha256, `Corpus changed: ${file.source}`);
const manifestHash = sha256(await readFile(path.join(work, 'manifest.json')));
const selectedTasks = taskId === 'all' ? manifest.tasks : manifest.tasks.filter(item => item.id === taskId);
assert.ok(selectedTasks.length, `Unknown task: ${taskId}`);
let rows = [];
try { rows = JSON.parse(await readFile(observationsFile, 'utf8')); } catch (error) { if (error.code !== 'ENOENT') throw error; }
assert.ok(Array.isArray(rows), 'Observations file must contain a JSON array');
assert.ok(rows.every(row => row.system !== system || (row.harness === 'WorkBuddy Desktop' && row.harnessVersion === harnessVersion && row.model === model && row.reasoningEffort === reasoningEffort && row.corpusSHA256 === manifestHash)), `Existing observations for ${system} use a different WorkBuddy configuration or corpus`);
const countFor = task => rows.filter(row => row.system === system && row.condition === condition && row.taskId === task.id).length;
const repeat = Math.min(...selectedTasks.map(countFor));
const tasks = selectedTasks.filter(task => countFor(task) === repeat);
const rl = createInterface({ input: stdin, output: stdout });
if ((await rl.question(`Confirm WorkBuddy is set to ${model}? [Y/n] `)).trim().toLowerCase() === 'n') {
  rl.close();
  process.exit(2);
}
const parse = text => {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  return extractJsonObject(fenced?.[1] ?? text, validAnswer);
};
const number = async label => {
  const value = (await rl.question(`${label} (blank if unavailable): `)).trim();
  if (!value) return null;
  const parsed = Number(value);
  assert.ok(Number.isInteger(parsed) && parsed >= 0, `${label} must be a nonnegative integer`);
  return parsed;
};
console.log(`\nWorkBuddy ${condition} · repeat ${repeat} · ${tasks.length} task(s) · ${model}`);
console.log(`Corpus: ${path.join(work, 'corpus')}`);
console.log('Use a fresh WorkBuddy conversation for each task. The next prompt is copied after each result is saved.');

for (const [index, task] of tasks.entries()) {
  const prompt = JSON.stringify({
    corpus: path.join(work, 'corpus'),
    task: { id: task.id, question: task.question, answerKeys: task.answerKeys },
    answerSchema,
    instruction: '根据 corpus 内文件回答，自主选择当前环境可用的工具。不要读取参考答案、manifest、评测报告或其他答题会话；本地索引中的证据须来自本轮 corpus。答案只输出符合 answerSchema 的 JSON。answers 中只填所问字段，数字保留两位小数且不含单位；days 使用整数。citations.source 为 corpus 相对路径，压缩包成员用 !/ 分隔；quote 必须逐字引用原文，可以折叠空白。找不到事实返回 not_found，answers/citations 为空；提取失败或证据不足返回 insufficient_evidence。',
  }, null, 2);
  const copied = spawnSync('pbcopy', [], { input: prompt, encoding: 'utf8' });
  console.log(`\n[${index + 1}/${tasks.length}] ${task.id}: prompt copied`);
  if (copied.error || copied.status !== 0) console.log(`Copy this prompt manually:\n${prompt}`);
  await rl.question('Send it in a fresh WorkBuddy conversation, then press Enter here to start timing. ');
  const started = performance.now();
  await rl.question('When the final answer is ready, copy it and press Enter here to stop timing. ');
  const elapsedMs = performance.now() - started;

  const completed = (await rl.question('Did WorkBuddy finish with a response? [Y/n] ')).trim().toLowerCase() !== 'n';
  let raw = completed ? (spawnSync('pbpaste', [], { encoding: 'utf8' }).stdout?.trim() ?? '') : '';
  let response = parse(raw);
  if (completed && !response) {
    raw = (await rl.question('Clipboard was not JSON. Paste the final JSON answer, or leave blank if the run failed: ')).trim();
    response = parse(raw);
  }

  const inputTokens = await number('Input tokens');
  const cachedInputTokens = await number('Cached input tokens');
  const outputTokens = await number('Output tokens');
  if (inputTokens !== null && cachedInputTokens !== null) assert.ok(cachedInputTokens <= inputTokens, 'Cached input tokens cannot exceed input tokens');
  const usage = {};
  if (inputTokens !== null) usage.input_tokens = inputTokens;
  if (cachedInputTokens !== null) usage.cached_input_tokens = cachedInputTokens;
  if (outputTokens !== null) usage.output_tokens = outputTokens;
  const row = {
    system, harness: 'WorkBuddy Desktop', harnessVersion, model, reasoningEffort,
    corpusSHA256: manifestHash,
    condition, taskId: task.id, repeat: Math.max(-1, ...rows.filter(row => row.system === system && row.condition === condition && row.taskId === task.id).map(row => row.repeat)) + 1, elapsedMs, operational: completed,
    response, usage: Object.keys(usage).length ? usage : null, toolCalls: null,
    captureMethod: 'manual-desktop-stopwatch', protocolValidAtCapture: validAnswer(response),
  };
  rows.push(row);
  await mkdir(path.dirname(observationsFile), { recursive: true });
  await writeFile(observationsFile, JSON.stringify(rows, null, 2) + '\n');
  console.log(`Saved ${task.id} (${Math.round(elapsedMs)} ms, operational=${completed}, protocolValid=${row.protocolValidAtCapture}).`);
}
rl.close();
console.log(`\nSaved ${tasks.length} observation(s) to ${observationsFile}`);
console.log('GUI captures are exploratory and do not count as formal latency or token results.');
