import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { extractJsonObject, scoreAnswer, validAnswer } from './metrics.mjs';

const args = process.argv.slice(2);
const flag = name => {
  const index = args.indexOf(name);
  assert.ok(index >= 0 && args[index + 1], 'Missing ' + name);
  return args[index + 1];
};
const candidateDir = path.resolve(flag('--candidate-dir'));
const sessionFile = path.resolve(flag('--session'));
const readJson = async file => JSON.parse(await readFile(file, 'utf8'));
const writeJson = async (file, value) => writeFile(file, JSON.stringify(value, null, 2) + '\n');
const candidate = await readJson(path.join(candidateDir, 'candidate.json'));
const prompt = await readJson(path.join(candidateDir, 'prompt.json'));
const events = (await readFile(sessionFile, 'utf8')).trim().split('\n').map(line => JSON.parse(line));
const userEvent = events.find(event => event.type === 'message' && event.role === 'user');
assert.ok(userEvent, 'WorkBuddy user message is missing');
const userText = (userEvent.content ?? []).map(part => part.text ?? '').join('');
const quoteStart = userText.indexOf('<long_text_quote>') + '<long_text_quote>'.length;
const quoteEnd = userText.indexOf('</long_text_quote>', quoteStart);
assert.ok(quoteStart >= '<long_text_quote>'.length && quoteEnd >= 0, 'WorkBuddy long-text prompt is missing');
assert.deepEqual(JSON.parse(userText.slice(quoteStart, quoteEnd)), prompt, 'Submitted prompt differs from the archived prompt');

const assistantEvents = events
  .filter(event => event.type === 'message' && event.role === 'assistant')
  .map(event => ({ event, text: (event.content ?? []).map(part => part.text ?? '').join('') }))
  .sort((first, second) => (second.event.timestamp ?? 0) - (first.event.timestamp ?? 0));
assert.ok(assistantEvents.length, 'WorkBuddy assistant response is missing');
const final = assistantEvents[0];
const response = extractJsonObject(final.text, value => Array.isArray(value?.results));
assert.ok(response, 'Could not extract the final results JSON');
assert.deepEqual(Object.keys(response), ['results'], 'Unexpected top-level response fields');

const corpusDir = path.resolve(prompt.corpus);
const manifest = await readJson(path.join(path.dirname(corpusDir), 'manifest.json'));
const expectedIds = manifest.tasks.map(task => task.id);
const resultIds = response.results.map(result => result.taskId);
assert.equal(resultIds.length, expectedIds.length, 'Wrong number of task results');
assert.equal(new Set(resultIds).size, expectedIds.length, 'Duplicate task result');
assert.deepEqual([...resultIds].sort(), [...expectedIds].sort(), 'Task IDs do not match the manifest');
for (const result of response.results) {
  assert.deepEqual(Object.keys(result).sort(), ['response', 'taskId'], 'Unexpected task-result fields');
  assert.ok(validAnswer(result.response), 'Invalid response schema for ' + result.taskId);
}

const taskScores = response.results.map(result => {
  const task = manifest.tasks.find(item => item.id === result.taskId);
  return { taskId: result.taskId, track: task.track, ...scoreAnswer(task, result.response, manifest.documents, true) };
});
const mean = values => values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null;
const summarize = rows => ({
  tasks: rows.length,
  quality: mean(rows.map(row => row.quality)),
  accuracy: mean(rows.map(row => row.accuracy)),
  evidencePrecision: mean(rows.map(row => row.evidencePrecision).filter(Number.isFinite)),
  evidenceRecall: mean(rows.map(row => row.evidenceRecall).filter(Number.isFinite)),
  successRate: mean(rows.map(row => Number(row.success)))
});
const complexScores = taskScores.filter(row => row.track !== 'text-control');
const controlScores = taskScores.filter(row => row.track === 'text-control');

const toolEvents = events.filter(event => event.type === 'function_call');
const toolCallBreakdown = {};
for (const event of toolEvents) {
  const name = event.name ?? 'unknown';
  toolCallBreakdown[name] = (toolCallBreakdown[name] ?? 0) + 1;
}
const searchEvents = toolEvents.filter(event => {
  if (event.name !== 'Bash') return false;
  try {
    const args = typeof event.arguments === 'string' ? JSON.parse(event.arguments) : event.arguments;
    return /^\s*filens\s+search(?:\s|$)/i.test(args?.command ?? '');
  } catch {
    return false;
  }
});
const waves = [];
for (const event of searchEvents) {
  const timestamp = Number(event.timestamp);
  const last = waves.at(-1);
  if (!last || timestamp - last.lastTimestamp > 500) waves.push({ lastTimestamp: timestamp, calls: 1 });
  else {
    last.lastTimestamp = timestamp;
    last.calls++;
  }
}

const requests = [];
for (const event of events) {
  const usage = event.providerData?.usage;
  if (!usage || !Number.isFinite(usage.inputTokens) || !Number.isFinite(usage.outputTokens)) continue;
  const cached = (usage.inputTokensDetails ?? []).reduce((sum, detail) => sum + (detail.cached_tokens ?? 0), 0);
  const reasoning = (usage.outputTokensDetails ?? []).reduce((sum, detail) => sum + (detail.reasoning_tokens ?? 0), 0);
  requests.push({
    timestampMs: event.timestamp,
    phase: event.type === 'message' ? 'final-response' : 'tool-response',
    input_tokens: usage.inputTokens,
    cached_input_tokens: cached,
    non_cached_input_tokens: usage.inputTokens - cached,
    output_tokens: usage.outputTokens,
    reasoning_output_tokens: reasoning,
    total_tokens: usage.inputTokens + usage.outputTokens
  });
}
assert.ok(requests.length, 'No provider usage records found');
const usage = requests.reduce((totals, request) => {
  totals.input_tokens += request.input_tokens;
  totals.cached_input_tokens += request.cached_input_tokens;
  totals.output_tokens += request.output_tokens;
  totals.reasoning_output_tokens += request.reasoning_output_tokens;
  totals.total_tokens += request.total_tokens;
  return totals;
}, { input_tokens: 0, cached_input_tokens: 0, output_tokens: 0, reasoning_output_tokens: 0, total_tokens: 0 });
usage.non_cached_input_tokens = usage.input_tokens - usage.cached_input_tokens;
usage.requests = requests.reduce((sum, request) => sum + 1, 0);

const elapsedMs = Number(final.event.timestamp) - Number(userEvent.timestamp);
assert.ok(Number.isFinite(elapsedMs) && elapsedMs > 0, 'Invalid prompt-to-final elapsed time');
const observation = {
  system: candidate.candidate,
  harness: candidate.harness,
  harnessVersion: candidate.harnessVersion,
  model: candidate.model,
  reasoningEffort: candidate.reasoningEffort,
  capturedAt: new Date(Number(final.event.timestamp)).toISOString(),
  corpusSHA256: candidate.corpusSHA256,
  protocol: 'single-batch-all-tasks',
  condition: 'filens',
  repeat: 0,
  elapsedMs,
  operational: true,
  protocolValid: true,
  response,
  taskScores,
  summary: { all: summarize(taskScores), complex: summarize(complexScores), textControls: summarize(controlScores) },
  usage,
  toolCalls: toolEvents.length,
  toolCallBreakdown,
  filensSearchCalls: searchEvents.length,
  filensSearchWaves: waves.length,
  searchCallsByWave: waves.map(wave => wave.calls),
  captureMethod: 'WorkBuddy local conversation JSONL; prompt-to-final timestamps and provider-reported usage'
};
const baselineSummary = {};
for (const [name, source] of Object.entries(candidate.comparisonSources ?? {})) {
  const file = path.resolve(source.file);
  const data = await readJson(file);
  const rows = data.observations ?? [];
  const baseline = rows.find(row => row.condition === source.condition) ?? rows.at(-1);
  assert.ok(baseline, 'Missing comparison observation: ' + name);
  const baselineTokens = baseline.usage?.total_tokens ?? ((baseline.usage?.input_tokens ?? 0) + (baseline.usage?.output_tokens ?? 0));
  baselineSummary[name] = {
    elapsedMs: baseline.elapsedMs,
    totalTokens: baselineTokens,
    complexQuality: baseline.summary.complex.quality,
    complexSuccessRate: baseline.summary.complex.successRate
  };
}
const comparison = Object.fromEntries(Object.entries(baselineSummary).map(([name, baseline]) => [
  name,
  {
    ...baseline,
    elapsedDeltaMs: elapsedMs - baseline.elapsedMs,
    elapsedDeltaPercent: 100 * (elapsedMs - baseline.elapsedMs) / baseline.elapsedMs,
    totalTokenDelta: usage.total_tokens - baseline.totalTokens,
    totalTokenDeltaPercent: 100 * (usage.total_tokens - baseline.totalTokens) / baseline.totalTokens,
    complexQualityGain: observation.summary.complex.quality - baseline.complexQuality,
    complexSuccessRateGain: observation.summary.complex.successRate - baseline.complexSuccessRate
  }
]));

await writeJson(path.join(candidateDir, 'response.json'), response);
await writeJson(path.join(candidateDir, 'observations.json'), {
  schema: 'filens-bench-workbuddy-batch-v1',
  corpusSHA256: candidate.corpusSHA256,
  note: 'Single-batch exploratory comparison. Prompt-to-final timing and provider usage are recovered from the local WorkBuddy conversation log. Input includes cached input; output includes reasoning. Amounts are unpriced.',
  observations: [observation],
  comparison
});
const taskCsv = [
  'task_id,track,accuracy,evidence_precision,evidence_recall,quality,success,protocol_valid',
  ...taskScores.map(row => [row.taskId, row.track, row.accuracy, row.evidencePrecision ?? '', row.evidenceRecall ?? '', row.quality, row.success, row.protocolValid].join(','))
].join('\n') + '\n';
await writeFile(path.join(candidateDir, 'task-scores.csv'), taskCsv);
const billingCsv = [
  'request,timestamp_utc,phase,input_tokens,cached_input_tokens,non_cached_input_tokens,output_tokens,reasoning_output_tokens,total_tokens',
  ...requests.map((request, index) => [
    index + 1, new Date(Number(request.timestampMs)).toISOString(), request.phase, request.input_tokens,
    request.cached_input_tokens, request.non_cached_input_tokens, request.output_tokens,
    request.reasoning_output_tokens, request.total_tokens
  ].join(','))
].join('\n') + '\n';
await writeFile(path.join(candidateDir, 'billing.csv'), billingCsv);
const billingRows = requests.map((request, index) => '| ' + (index + 1) + ' | ' + request.phase + ' | ' +
  request.input_tokens + ' | ' + request.cached_input_tokens + ' | ' + request.non_cached_input_tokens + ' | ' +
  request.output_tokens + ' | ' + request.reasoning_output_tokens + ' | ' + request.total_tokens + ' |');
const billingMd = [
  '# WorkBuddy request ledger',
  '',
  'Provider-reported usage for ' + candidate.model + '. Amounts are unpriced.',
  '',
  '| Request | Phase | Input | Cached input | Non-cached input | Output | Reasoning output | Total |',
  '| ---: | --- | ---: | ---: | ---: | ---: | ---: | ---: |',
  ...billingRows,
  '| **Total (' + requests.length + ')** |  | **' + usage.input_tokens + '** | **' + usage.cached_input_tokens + '** | **' +
    usage.non_cached_input_tokens + '** | **' + usage.output_tokens + '** | **' + usage.reasoning_output_tokens + '** | **' + usage.total_tokens + '** |',
  '',
  'Cached input is included in input. Reasoning output is included in output. Total is input plus output.'
].join('\n') + '\n';
await writeFile(path.join(candidateDir, 'billing.md'), billingMd);
console.log(JSON.stringify({
  candidate: candidate.candidate,
  elapsedMs,
  toolCalls: observation.toolCalls,
  toolCallBreakdown,
  filensSearchCalls: observation.filensSearchCalls,
  searchCallsByWave: observation.searchCallsByWave,
  usage,
  complex: observation.summary.complex,
  all: observation.summary.all,
  comparison
}, null, 2));
