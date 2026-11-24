import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
import { invoke } from './process.mjs';

let input = '';
for await (const chunk of process.stdin) input += chunk;
const request = JSON.parse(input);
assert.ok(typeof request.provider === 'string' && request.provider, 'Configure adapter.provider with the DSH model route');
const directory = await mkdtemp(path.join(os.tmpdir(), 'fb-dsh-'));
try {
  const patch = path.join(directory, 'session.json');
  await writeFile(patch, JSON.stringify([
    { id: 'agent-default-model', config: { provider: request.provider, model: request.model, reasoningEffort: request.reasoningEffort } },
    { id: 'session-persistence-jsonl', config: { root: path.join(directory, 'sessions') } },
  ]));
  const extras = process.argv.slice(2), overlays = [], options = [];
  for (let i = 0; i < extras.length; i++) {
    if (extras[i] === '--patch') overlays.push(extras[i], extras[++i]);
    else options.push(extras[i]);
  }
  const result = await invoke(process.env.FILENS_BENCH_DSH ?? 'dsh', [
    'headless', ...overlays, '--patch', patch, ...options, '--json', '--approval-policy', 'never', '-',
  ], { cwd: request.prompt.corpus, input: JSON.stringify(request.prompt), timeout: 3500000, newGroup: false });
  const events = result.stdout.split('\n').filter(Boolean).flatMap(line => { try { return [JSON.parse(line)]; } catch { return []; } });
  const final = events.filter(event => event.type === 'final').at(-1);
  let response = null;
  const finalText = final?.text?.trim();
  const fencedJson = finalText?.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i)?.[1];
  try { response = JSON.parse(fencedJson ?? finalText); } catch {}
  const steps = events.filter(event => event.type === 'status' && event.phase === 'step_end');
  const usage = steps.length && steps.every(event => event.usage) ? {
    // pi-ai reports uncached input separately; totalTokens includes cache reads/writes.
    input_tokens: steps.every(event => Number.isFinite(event.usage.totalTokens)) ? steps.reduce((sum, event) => sum + event.usage.totalTokens - event.usage.outputTokens, 0) : null,
    reported_input_tokens: steps.reduce((sum, event) => sum + event.usage.inputTokens, 0),
    cached_input_tokens: steps.reduce((sum, event) => sum + (event.usage.cacheReadTokens ?? 0), 0),
    cache_write_input_tokens: steps.reduce((sum, event) => sum + (event.usage.cacheWriteTokens ?? 0), 0),
    output_tokens: steps.reduce((sum, event) => sum + event.usage.outputTokens, 0),
    reasoning_output_tokens: steps.every(event => Number.isFinite(event.usage.reasoningTokens)) ? steps.reduce((sum, event) => sum + event.usage.reasoningTokens, 0) : null,
  } : null;
  console.log(JSON.stringify({ response, operational: result.exit === 0 && !result.error && !result.timedOut && final?.reason?.kind === 'completed',
    usage, toolCalls: events.filter(event => event.type === 'tool_call').length, trace: result }));
} finally {
  await rm(directory, { recursive: true, force: true });
}
