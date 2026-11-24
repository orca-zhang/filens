// Adapter stdout is one JSON object; Codex events are returned as trace data.
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { invoke } from './process.mjs';

let input = '';
for await (const chunk of process.stdin) input += chunk;
const request = JSON.parse(input);
const directory = await mkdtemp(path.join(os.tmpdir(), 'filens-bench-codex-'));
try {
  const schema = path.join(directory, 'schema.json'), answer = path.join(directory, 'answer.json');
  await writeFile(schema, JSON.stringify(request.prompt.answerSchema));
  const result = await invoke(process.env.FILENS_BENCH_CODEX ?? 'codex', [
    'exec', '--ephemeral', '--skip-git-repo-check',
    '--model', request.model, '-c', `model_reasoning_effort=${JSON.stringify(request.reasoningEffort)}`,
    '--cd', request.prompt.corpus, '--output-schema', schema, '--output-last-message', answer, '--json', ...process.argv.slice(2), '-',
  ], { cwd: request.prompt.corpus, input: JSON.stringify(request.prompt), timeout: 3500000, newGroup: false });
  const events = result.stdout.split('\n').filter(Boolean).flatMap(line => { try { return [JSON.parse(line)]; } catch { return []; } });
  const response = await readFile(answer, 'utf8').then(JSON.parse).catch(() => null);
  const usage = events.filter(event => event.type === 'turn.completed').at(-1)?.usage ?? null;
  const toolCalls = events.filter(event => event.type === 'item.completed' && ['command_execution', 'mcp_tool_call', 'web_search'].includes(event.item?.type)).length;
  console.log(JSON.stringify({ response, operational: result.exit === 0 && !result.error && !result.timedOut,
    usage, toolCalls, trace: result }));
} finally {
  await rm(directory, { recursive: true, force: true });
}
