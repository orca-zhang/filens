// Adapter stdout is one JSON object; Claude Code stream events remain trace data.
import { invoke } from './process.mjs';

let input = '';
for await (const chunk of process.stdin) input += chunk;
const request = JSON.parse(input);
const { prompt, model, reasoningEffort } = request;
if (!prompt?.answerSchema || typeof model !== 'string' || !model) throw new Error('Pin a model and provide answerSchema');
if (!['low', 'medium', 'high'].includes(reasoningEffort)) throw new Error('Claude Code effort must be low, medium, or high');

let progressBuffer = '';
const onChunk = process.env.FILENS_BENCH_PROGRESS === '1' ? (stream, chunk) => {
  if (stream !== 'stdout') {
    process.stderr.write(`[claude-progress] stderr-bytes=${Buffer.byteLength(chunk)}\n`);
    return;
  }
  progressBuffer += chunk;
  let end;
  while ((end = progressBuffer.indexOf('\n')) >= 0) {
    const line = progressBuffer.slice(0, end);
    progressBuffer = progressBuffer.slice(end + 1);
    let event;
    try { event = JSON.parse(line); } catch { continue; }
    const toolNames = event.type === 'assistant'
      ? (event.message?.content ?? []).filter(block => block.type === 'tool_use').map(block => block.name)
      : [];
    const toolResults = event.type === 'user'
      ? (event.message?.content ?? []).filter(block => block.type === 'tool_result').length
      : 0;
    if (toolNames.length) process.stderr.write(`[claude-progress] tool-use=${toolNames.join(',')}\n`);
    else if (toolResults) process.stderr.write(`[claude-progress] tool-result-count=${toolResults}\n`);
    else if (event.type === 'system') process.stderr.write(`[claude-progress] system=${event.subtype ?? 'event'}\n`);
    else if (event.type === 'result') process.stderr.write(`[claude-progress] result=${event.subtype ?? 'event'}\n`);
  }
} : undefined;

const result = await invoke(process.env.FILENS_BENCH_CLAUDE ?? 'claude', [
  '--print', '--verbose', '--output-format', 'stream-json', '--json-schema', JSON.stringify(prompt.answerSchema),
  '--model', model, '--effort', reasoningEffort, ...process.argv.slice(2),
], { cwd: prompt.corpus, input: JSON.stringify(prompt), timeout: 3500000, newGroup: false, onChunk });
const events = result.stdout.split('\n').filter(Boolean).flatMap(line => { try { return [JSON.parse(line)]; } catch { return []; } });
const final = events.filter(event => event.type === 'result').at(-1);
let response = final?.structured_output ?? null;
if (!response && typeof final?.result === 'string') { try { response = JSON.parse(final.result); } catch {} }
const usage = final?.usage;
const number = value => Number.isFinite(value) ? value : null;
const reportedInput = number(usage?.input_tokens);
const cacheRead = number(usage?.cache_read_input_tokens) ?? 0;
const cacheWrite = number(usage?.cache_creation_input_tokens) ?? 0;
const outputTokens = number(usage?.output_tokens);
const normalizedUsage = usage ? {
  input_tokens: reportedInput === null ? null : reportedInput + cacheRead + cacheWrite,
  reported_input_tokens: reportedInput,
  cached_input_tokens: cacheRead,
  cache_write_input_tokens: cacheWrite,
  output_tokens: outputTokens,
  reasoning_output_tokens: null,
} : null;
const toolCalls = events.reduce((count, event) => count + (event.type === 'assistant'
  ? (event.message?.content ?? []).filter(block => block.type === 'tool_use').length
  : 0), 0);
const completed = Boolean(final) && (final.subtype === undefined || final.subtype === 'success');
console.log(JSON.stringify({ response, operational: result.exit === 0 && !result.error && !result.timedOut && completed,
  usage: normalizedUsage, toolCalls, trace: result }));
