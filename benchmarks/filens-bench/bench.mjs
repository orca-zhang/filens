import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, stat, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { prepare, sha256 } from './corpus.mjs';
import { answerSchema, latency, retrievalMetrics, scoreRows } from './metrics.mjs';
import { mean, summarize } from '../../scripts/search-benchmark-metrics.mjs';
import { invoke } from './process.mjs';
import { tables } from './table.mjs';
import { ledger } from './ledger.mjs';
export { invoke } from './process.mjs';

const root = fileURLToPath(new URL('../../', import.meta.url));
const args = process.argv.slice(2), command = args.shift();
const flag = (key, fallback) => { const i = args.indexOf(key); if (i < 0) return fallback; assert.ok(args[i + 1] && !args[i + 1].startsWith('--'), `Missing ${key} value`); return args[i + 1]; };
const integer = (key, fallback, max) => { const value = Number(flag(key, fallback)); assert.ok(Number.isInteger(value) && value >= 1 && value <= max, `Invalid ${key}`); return value; };
const work = path.resolve(flag('--work', path.join(root, 'dist/filens-bench')));
const binary = path.resolve(flag('--binary', process.env.FILENS_AGENT_BINARY ?? path.join(root, 'dist', process.platform === 'win32' ? 'filens.exe' : 'filens')));
const repeats = integer('--repeats', 3, 100), timeoutMs = integer('--timeout-ms', 120000, 3600000);
const json = async file => JSON.parse(await readFile(file, 'utf8'));
const save = async (file, value) => writeFile(file, JSON.stringify(value, null, 2) + '\n');
const relativeSource = (directory, source) => path.relative(directory, source).replaceAll('\\', '/');

const parsed = result => { try { return JSON.parse(result.stdout); } catch { return null; } };
const operational = (result, exits = [0]) => !result.error && !result.timedOut && exits.includes(result.exit);

async function loadManifest() {
  const manifest = await json(path.join(work, 'manifest.json'));
  assert.equal(manifest.schema, 'filens-bench-v1');
  for (const file of manifest.physicalFiles) assert.equal(sha256(await readFile(path.join(work, 'corpus', file.source))), file.sha256, `Corpus changed: ${file.source}`);
  return manifest;
}
async function metadata(manifest, includeBinary = false) {
  const info = { schema: 'filens-bench-run-v1', date: new Date().toISOString(), platform: `${process.platform}-${process.arch}`, cpu: os.cpus()[0]?.model, node: process.version,
    corpusSHA256: sha256(await readFile(path.join(work, 'manifest.json'))), ocr: manifest.ocr, timeoutMs, repeats,
    cachePolicy: 'Fresh session per request; native harness behavior and OS page caches remain enabled.' };
  if (!includeBinary) return info;
  const version = await invoke(binary, ['capacity', '--json'], { timeout: timeoutMs });
  assert.ok(operational(version), `FiLens preflight failed: ${version.error ?? version.stderr}`);
  if (manifest.ocr) assert.equal(parsed(version)?.capacity?.ocr?.available, true, 'OCR profile requires an OCR-enabled binary');
  return { ...info, binarySHA256: sha256(await readFile(binary)), binary,
    textWasmSHA256: await readFile(path.join(path.dirname(binary), 'converter-text.wasm')).then(sha256).catch(() => null), capacity: parsed(version) };
}

async function tools(manifest) {
  const info = await metadata(manifest, true), corpus = path.join(work, 'corpus');
  const output = await mkdtemp(path.join(work, 'tools-')), extracted = path.join(output, 'extracted');
  await mkdir(extracted);
  const ocrFlags = manifest.ocr ? [] : ['--no-ocr'];
  const preparations = [], mapping = new Map();
  const prepStart = performance.now();
  for (const [i, doc] of manifest.documents.entries()) {
    const result = await invoke(binary, ['read', path.join(corpus, doc.source), '--json', ...ocrFlags], { timeout: timeoutMs });
    await save(path.join(output, `extract-${i}.json`), result);
    const response = parsed(result), name = `${String(i).padStart(5, '0')}.txt`;
    const complete = operational(result) && response?.ok === true && response.content?.complete === true && !response.content?.truncated;
    preparations.push({ source: doc.source, elapsedMs: result.elapsedMs, complete, exit: result.exit });
    if (typeof response?.content?.text === 'string') {
      await writeFile(path.join(extracted, name), response.content.text);
      mapping.set(name, doc.source);
    }
  }
  const setupMs = performance.now() - prepStart;
  const artifactBytes = (await Promise.all([...mapping.keys()].map(name => stat(path.join(extracted, name))))).reduce((sum, entry) => sum + entry.size, 0);
  const rgVersion = await invoke('rg', ['--version']);
  assert.ok(operational(rgVersion), 'ripgrep is required');
  const names = ['rg-raw', 'filens-exact', 'extract-rg'], observations = [];
  const queries = manifest.tasks.filter(task => task.retrieval);
  for (let repeat = 0; repeat < repeats; repeat++) for (const [index, task] of queries.entries()) {
    const shift = (repeat + index) % names.length;
    for (const name of names.slice(shift).concat(names.slice(0, shift))) {
      const directory = name === 'extract-rg' ? extracted : corpus;
      const argv = name === 'filens-exact'
        ? ['search', corpus, '--query', task.retrieval.query, '--search-mode', 'exact', '--max-files', '20000', '--max-results', '100', '--json', ...ocrFlags]
        : ['--no-config', '--no-ignore', '--files-with-matches', '--null', '--fixed-strings', '-e', task.retrieval.query, '--', '.'];
      const result = await invoke(name === 'filens-exact' ? binary : 'rg', argv, { cwd: directory, timeout: timeoutMs });
      const value = name === 'filens-exact' ? parsed(result) : null;
      const found = name === 'filens-exact'
        ? (value?.search?.results ?? []).map(hit => relativeSource(corpus, hit.path))
        : result.stdout.split('\0').filter(Boolean).map(source => source.replace(/^\.\//, '').replaceAll('\\', '/')).map(source => name === 'extract-rg' ? mapping.get(source) : source).filter(Boolean).sort();
      const complete = name === 'filens-exact'
        ? operational(result) && value?.search?.complete === true && !value.search.truncated
        : operational(result, [0, 1]) && (name !== 'extract-rg' || preparations.every(row => row.complete));
      const record = { condition: name, taskId: task.id, repeat, elapsedMs: result.elapsedMs, complete, found,
        returnedBytes: Buffer.byteLength(result.stdout), metrics: retrievalMetrics(found, task, complete) };
      observations.push(record);
      await save(path.join(output, `${task.id}-${repeat}-${name}.json`), { ...record, process: result });
    }
  }
  const summary = Object.fromEntries(names.map(name => {
    const rows = observations.filter(row => row.condition === name);
    const answerable = rows.filter(row => manifest.tasks.find(task => task.id === row.taskId).retrieval.relevant.length);
    const absent = rows.filter(row => !manifest.tasks.find(task => task.id === row.taskId).retrieval.relevant.length);
    return [name, { attempts: rows.length, incomplete: rows.filter(row => !row.complete).length, ...summarize(rows.map(row => row.metrics)),
      correctEmptyRate: mean(absent.map(row => Number(row.complete && row.found.length === 0))),
      hitRate: mean(answerable.map(row => Number(row.complete && row.found.some(id => manifest.tasks.find(task => task.id === row.taskId).retrieval.relevant.includes(id))))),
      latency: latency(rows), setupMs: name === 'extract-rg' ? setupMs : 0, artifactBytes: name === 'extract-rg' ? artifactBytes : 0,
      totalMeasuredMs: rows.reduce((sum, row) => sum + row.elapsedMs, name === 'extract-rg' ? setupMs : 0) }];
  }));
  const report = { ...info, track: 'tool-retrieval', ripgrep: rgVersion.stdout.trim(), method: 'Case-sensitive literal search, complete candidate recall/precision; no semantic ranking. Pre-extraction uses the same FiLens core. Setup includes extraction, writes and measurement artifacts; installation is excluded.',
    summary, preparations, observations };
  await save(path.join(output, 'report.json'), report);
  console.log(JSON.stringify({ report: path.join(output, 'report.json'), summary }, null, 2));
}

function taskPrompt(task) {
  return { corpus: path.join(work, 'corpus'), task: { id: task.id, question: task.question, answerKeys: task.answerKeys }, answerSchema,
    instruction: '根据 corpus 内文件回答，自主选择当前环境可用的工具。不要读取参考答案、manifest、评测报告或其他答题会话；本地索引中的证据须来自本轮 corpus。答案只输出符合 answerSchema 的 JSON。answers 中只填所问字段，数字保留两位小数且不含单位；days 使用整数。citations.source 为 corpus 相对路径，压缩包成员用 !/ 分隔；quote 必须逐字引用原文，可以折叠空白。找不到事实返回 not_found，answers/citations 为空；提取失败或证据不足返回 insufficient_evidence。' };
}
async function agent(manifest) {
  const adapterFile = path.resolve(flag('--adapter', ''));
  const adapter = await json(adapterFile);
  const selectedCondition = flag('--condition');
  assert.ok(selectedCondition === undefined || ['stock', 'filens'].includes(selectedCondition), '--condition must be stock or filens');
  const conditions = selectedCondition ? [selectedCondition] : ['stock', 'filens'];
  for (const condition of conditions) assert.ok(Array.isArray(adapter.commands?.[condition]) && adapter.commands[condition].length > 0 && adapter.commands[condition].every(value => typeof value === 'string'), `adapter.commands.${condition} must launch the corresponding installed environment`);
  for (const key of ['id', 'harness', 'harnessVersion']) assert.ok(typeof adapter[key] === 'string' && adapter[key].length > 0, `Pin adapter.${key}`);
  assert.ok(typeof adapter.model === 'string' && adapter.model.length > 0, 'Pin adapter.model');
  assert.ok(typeof adapter.reasoningEffort === 'string', 'Pin adapter.reasoningEffort');
  const info = await metadata(manifest), output = await mkdtemp(path.join(work, 'agent-'));
  const tasks = manifest.tasks.filter(task => !flag('--task') || task.id === flag('--task'));
  assert.ok(tasks.length, 'No tasks selected');
  const observations = [];
  for (let repeat = 0; repeat < repeats; repeat++) for (const [index, task] of tasks.entries()) {
    const shift = (repeat + index) % conditions.length;
    for (const condition of conditions.slice(shift).concat(conditions.slice(0, shift))) {
      // Condition and model settings are adapter metadata, never part of the model prompt.
      const request = { schema: 'filens-bench-request-v2', condition, model: adapter.model, provider: adapter.provider, reasoningEffort: adapter.reasoningEffort, prompt: taskPrompt(task) };
      const command = adapter.commands[condition];
      const result = await invoke(command[0], command.slice(1), { cwd: path.join(work, 'corpus'), input: JSON.stringify(request), timeout: timeoutMs });
      const value = parsed(result);
      const row = { system: adapter.id, harness: adapter.harness, harnessVersion: adapter.harnessVersion, model: adapter.model, reasoningEffort: adapter.reasoningEffort,
        corpusSHA256: info.corpusSHA256, condition, taskId: task.id, repeat, elapsedMs: result.elapsedMs, operational: operational(result) && value?.operational !== false,
        response: value?.response ?? null, usage: value?.usage ?? null, toolCalls: value?.toolCalls ?? null };
      observations.push(row);
      await save(path.join(output, `${task.id}-${repeat}-${condition}.json`), { request, process: result });
      // Checkpoint every attempt, including malformed responses and timeouts.
      await save(path.join(output, 'observations.json'), observations);
      console.log(`${task.id} ${condition} #${repeat}: ${Math.round(row.elapsedMs)} ms; operational=${row.operational}`);
    }
  }
  const report = { ...info, track: 'agent', protocol: 'Same task prompt; native environment versus native installation of FiLens; autonomous tool selection.', selectedConditions: conditions, adapter, selectedTaskIds: tasks.map(task => task.id), isolation: 'Environment separation is provided by adapter commands; keep evaluation labels outside both environments.', ...scoreRows(observations, { ...manifest, tasks }, timeoutMs, repeats, conditions) };
  await save(path.join(output, 'report.json'), report);
  console.log(JSON.stringify({ report: path.join(output, 'report.json'), summary: report.summary, pairs: report.pairs }, null, 2));
}

async function main() {
  if (command === 'prepare') {
    await mkdir(work, { recursive: true });
    const existing = await stat(path.join(work, 'corpus')).catch(() => null);
    assert.equal(existing, null, 'Choose a fresh --work directory; existing corpus is never overwritten');
    const manifest = await prepare(work, { ocr: args.includes('--ocr'), distractors: integer('--distractors', 32, 19000) });
    await save(path.join(work, 'answer.schema.json'), answerSchema);
    console.log(`Prepared ${manifest.physicalFiles.length} files, ${manifest.tasks.length} tasks: ${work}`);
  } else if (command === 'tools') await tools(await loadManifest());
  else if (command === 'agent') await agent(await loadManifest());
  else if (command === 'score') {
    const manifest = await loadManifest();
    const files = args.flatMap((value, i) => value === '--input' ? [args[i + 1]] : []);
    assert.ok(files.length > 0 && files.every(Boolean), 'Provide --input observations.json');
    const rows = (await Promise.all(files.map(file => json(path.resolve(file))))).flat();
    const corpusHash = sha256(await readFile(path.join(work, 'manifest.json')));
    assert.ok(rows.every(row => row.corpusSHA256 === corpusHash), 'Cannot combine different corpora');
    const conditions = [...new Set(rows.map(row => row.condition))];
    assert.ok(conditions.length > 0 && conditions.every(condition => ['stock', 'filens'].includes(condition)), 'Unknown observation condition');
    const selected = { ...manifest, tasks: manifest.tasks.filter(task => !flag('--task') || task.id === flag('--task')) };
    const report = { schema: 'filens-bench-score-v1', corpusSHA256: corpusHash, selectedConditions: conditions, ...scoreRows(rows, selected, timeoutMs, repeats, conditions) };
    const output = path.resolve(flag('--output', path.join(work, 'imported-score.json')));
    await save(output, report);
    console.log(JSON.stringify({ report: output, summary: report.summary, pairs: report.pairs }, null, 2));
  } else if (command === 'table') {
    const report = await json(path.resolve(flag('--input', ''))), manifest = await loadManifest();
    const output = path.resolve(flag('--output', path.join(work, 'tables')));
    assert.equal(report.corpusSHA256, sha256(await readFile(path.join(work, 'manifest.json'))), 'Table corpus differs from scored report');
    const rendered = tables(report, manifest);
    await mkdir(output, { recursive: true });
    await writeFile(path.join(output, 'scores.md'), rendered.markdown);
    await writeFile(path.join(output, 'matrix.csv'), rendered.matrixCSV);
    await writeFile(path.join(output, 'task-scores.csv'), rendered.taskCSV);
    const billed = ledger(report, manifest);
    await save(path.join(output, 'ledger.json'), billed.data);
    await writeFile(path.join(output, 'ledger.csv'), billed.csv);
    await writeFile(path.join(output, 'billing.md'), billed.markdown);
    console.log(`Saved score tables and itemized usage ledger to ${output}`);
  } else console.log('FiLens-Bench\n  prepare [--work DIR] [--ocr] [--distractors N]\n  agent --adapter FILE [--condition stock|filens] [--task ID] [--work DIR] [--repeats N] [--timeout-ms N]\n  score --input observations.json [--input other.json] [--work DIR] [--task ID] [--repeats N] [--output FILE]\n  table --input report.json [--work DIR] [--output DIR]\n  tools [--work DIR] [--binary FILE] [--repeats N] (optional tool diagnostics)');
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await main();
