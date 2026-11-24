import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { access, chmod, cp, mkdtemp, mkdir, readFile, readdir, rm, symlink, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { invoke } from './process.mjs';

const modelId = 'gpt-6.1-sol';
const node = process.env.FILENS_BENCH_OPENCLAW_NODE ?? '/Users/orca/.cache/filens-bench/openclaw-runtime/node_modules/node/bin/node';
const entry = process.env.FILENS_BENCH_OPENCLAW_ENTRY ?? '/Users/orca/.cache/filens-bench/openclaw-runtime/node_modules/openclaw/openclaw.mjs';
const template = process.env.FILENS_BENCH_OPENCLAW_WORKSPACE_TEMPLATE ?? '/tmp/filens-openclaw-baseline/workspace';

let input = '';
for await (const chunk of process.stdin) input += chunk;
const request = JSON.parse(input);
assert.ok(['stock', 'filens'].includes(request.condition), 'Unknown benchmark condition');
assert.ok(request.prompt?.corpus && request.prompt?.answerSchema, 'Invalid benchmark prompt');
assert.equal(request.model, modelId, 'The adapter is pinned to the current Codex GPT model');

function parseTomlString(value) {
  const quoted = value.match(/^"(?:\\.|[^"\\])*"/s)?.[0];
  if (!quoted) return null;
  try { return JSON.parse(quoted); } catch { return quoted.slice(1, -1); }
}

function currentCodexRoute(config) {
  let providerName = null, model = null, baseURL = null, wireApi = null, requiresOpenAIAuth = false;
  let section = '';
  for (const line of config.split(/\r?\n/)) {
    const header = line.match(/^\s*\[([^\]]+)\]\s*$/);
    if (header) { section = header[1]; continue; }
    const setting = line.match(/^\s*([\w-]+)\s*=\s*(.*?)\s*(?:#.*)?$/);
    if (!setting) continue;
    const [, key, raw] = setting;
    if (!section && key === 'model_provider' && raw.startsWith('"')) providerName = parseTomlString(raw);
    if (!section && key === 'model' && raw.startsWith('"')) model = parseTomlString(raw);
    if (section === `model_providers.${providerName}`) {
      if (key === 'base_url' && raw.startsWith('"')) baseURL = parseTomlString(raw);
      if (key === 'wire_api' && raw.startsWith('"')) wireApi = parseTomlString(raw);
      if (key === 'requires_openai_auth') requiresOpenAIAuth = raw === 'true';
    }
  }
  return { providerName, model, baseURL, wireApi, requiresOpenAIAuth };
}

async function codexRoute() {
  const home = os.homedir();
  const config = await readFile(path.join(home, '.codex', 'config.toml'), 'utf8');
  const route = currentCodexRoute(config);
  assert.equal(route.model, modelId, 'The current Codex model changed; this run must use the pinned GPT model');
  assert.equal(route.wireApi, 'responses', 'The current Codex provider must use the Responses protocol');
  assert.equal(route.requiresOpenAIAuth, true, 'The current Codex provider does not expose the compatible API-key route');
  assert.ok(route.baseURL && /^https?:\/\//.test(route.baseURL), 'The current Codex provider has no HTTP(S) base URL');

  const auth = JSON.parse(await readFile(path.join(home, '.codex', 'auth.json'), 'utf8'));
  let apiKey = auth.OPENAI_API_KEY;
  if (apiKey && typeof apiKey === 'object') apiKey = apiKey.value ?? apiKey.key;
  assert.ok(typeof apiKey === 'string' && apiKey.length, 'The current Codex login has no usable GPT credential');
  return { apiKey, baseURL: route.baseURL };
}

function findAnswer(value) {
  if (value && typeof value === 'object' && value.status && Array.isArray(value.answers)) return value;
  if (typeof value !== 'string') return null;
  const text = value.trim();
  const fenced = text.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i)?.[1];
  try {
    const parsed = JSON.parse(fenced ?? text);
    return parsed && typeof parsed === 'object' && parsed.status && Array.isArray(parsed.answers) ? parsed : null;
  } catch { return null; }
}

function getDocument(stdout) {
  try { return JSON.parse(stdout); } catch {}
  const lines = stdout.split(/\r?\n/).filter(Boolean);
  for (let index = lines.length - 1; index >= 0; index--) {
    try { return JSON.parse(lines[index]); } catch {}
  }
  return null;
}

function responseFrom(document) {
  const candidates = [
    document?.final, document?.text, document?.response, document?.result?.text, document?.result?.response,
    document?.output, document?.message?.text, document?.payload?.text,
  ];
  for (const candidate of candidates) {
    const answer = findAnswer(candidate);
    if (answer) return answer;
  }
  for (const candidate of [document?.structuredOutput, document?.structured_output, document?.result?.structuredOutput]) {
    const answer = findAnswer(candidate);
    if (answer) return answer;
  }
  return null;
}

function usageFrom(document) {
  const candidates = [document?.usage, document?.result?.usage, document?.stats?.usage, document?.result?.stats?.usage];
  const usage = candidates.find(value => value && typeof value === 'object');
  if (!usage) return null;
  const first = (...values) => values.find(Number.isFinite) ?? null;
  const inputTokens = first(usage.inputTokens, usage.input_tokens, usage.promptTokens, usage.prompt_tokens);
  const outputTokens = first(usage.outputTokens, usage.output_tokens, usage.completionTokens, usage.completion_tokens, usage.output);
  const cacheRead = first(usage.cacheReadTokens, usage.cachedInputTokens, usage.cached_input_tokens, usage.cache_read_input_tokens, usage.cacheRead);
  const cacheWrite = first(usage.cacheWriteTokens, usage.cache_write_input_tokens, usage.cacheWrite);
  const totalTokens = first(usage.totalTokens, usage.total_tokens, usage.total);
  return {
    input_tokens: totalTokens !== null && outputTokens !== null ? totalTokens - outputTokens : inputTokens,
    reported_input_tokens: first(inputTokens, usage.input),
    cached_input_tokens: cacheRead,
    cache_write_input_tokens: cacheWrite,
    output_tokens: outputTokens,
    reasoning_output_tokens: first(usage.reasoningTokens, usage.reasoning_output_tokens),
  };
}

function countToolCalls(document) {
  const direct = document?.toolCalls ?? document?.toolCallCount ?? document?.tool_call_count ?? document?.toolSummary?.calls ?? document?.result?.toolCalls;
  if (Number.isFinite(direct)) return direct;
  if (Array.isArray(direct)) return direct.length;
  const matches = [];
  const visit = value => {
    if (!value || typeof value !== 'object') return;
    if (Array.isArray(value)) { for (const item of value) visit(item); return; }
    const type = value.type ?? value.kind;
    if (typeof type === 'string' && /^(tool[_-]?call|toolCall)$/i.test(type)) matches.push(value);
    for (const child of Object.values(value)) visit(child);
  };
  visit(document);
  return matches.length || null;
}

function redact(value, secret) {
  if (typeof value === 'string') return value.replaceAll(secret, '[redacted]');
  if (Array.isArray(value)) return value.map(item => redact(item, secret));
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, redact(item, secret)]));
  return value;
}

function sanitizeTrace(value) {
  if (typeof value === 'string') return value.replace(/Incorrect API key provided:[^.\r\n]+/gi, 'Incorrect API key provided: [redacted]');
  if (Array.isArray(value)) return value.map(sanitizeTrace);
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, sanitizeTrace(item)]));
  return value;
}

async function pathWithoutFilens(directory) {
  const pathEntries = [...new Set((process.env.PATH ?? '').split(path.delimiter).filter(Boolean))];
  const hiddenDirs = new Set();
  for (const directory of pathEntries) {
      try { await access(path.join(directory, 'filens')); hiddenDirs.add(path.resolve(directory)); } catch {}
  }
  if (!hiddenDirs.size) return process.env.PATH ?? '';
  const shadow = path.join(directory, 'native-bin');
  await mkdir(shadow);
  for (const hiddenDir of hiddenDirs) {
    for (const item of await readdir(hiddenDir)) {
      if (item === 'filens') continue;
      const target = path.join(shadow, item);
      try { await access(target); } catch { await symlink(path.resolve(hiddenDir, item), target); }
    }
  }
  return [shadow, ...pathEntries.filter(item => !hiddenDirs.has(path.resolve(item)))].join(path.delimiter);
}

const route = await codexRoute();
const previousApiKey = process.env.OPENAI_API_KEY;
const previousCodexKey = process.env.FILENS_BENCH_CODEX_API_KEY;
process.env.FILENS_BENCH_CODEX_API_KEY = route.apiKey;
delete process.env.OPENAI_API_KEY;
const temp = await mkdtemp(path.join(os.tmpdir(), 'filens-bench-openclaw-'));
try {
  await access(template);
  const workspace = path.join(temp, 'workspace');
  await cp(template, workspace, { recursive: true });
  if (request.condition === 'stock') await rm(path.join(workspace, 'skills'), { recursive: true, force: true });

  const stateDir = path.join(temp, 'state');
  await mkdir(stateDir, { recursive: true });
  const configPath = path.join(temp, 'openclaw.json');
  const config = {
    update: { checkOnStart: false },
    models: {
      mode: 'replace',
      providers: {
        'codex-local': {
          baseUrl: route.baseURL,
          apiKey: '${FILENS_BENCH_CODEX_API_KEY}',
          api: 'openai-responses',
          models: [{
            id: modelId, name: 'GPT-6.1-Sol', reasoning: true, input: ['text'],
            contextWindow: 272000, maxTokens: 32768,
            compat: { supportedReasoningEfforts: ['low', 'medium', 'high', 'xhigh'] },
          }],
        },
      },
    },
    agents: { defaults: { workspace, model: { primary: `codex-local/${modelId}` } } },
  };
  await writeFile(configPath, JSON.stringify(config, null, 2) + '\n', { mode: 0o600 });
  await chmod(configPath, 0o600);

  const previousPath = process.env.PATH;
  if (request.condition === 'stock') process.env.PATH = await pathWithoutFilens(temp);
  let result;
  try {
    result = await invoke(node, [entry, 'agent', 'exec', '--json', '--config', configPath,
      '--state-dir', stateDir, '--cwd', workspace, '--model', `codex-local/${modelId}`, '--thinking', 'high',
      '--timeout', String(Math.max(1, Math.floor((request.timeoutMs ?? 120000) / 1000))), '--message-file', '-'], {
      cwd: workspace, input: JSON.stringify(request.prompt), timeout: request.timeoutMs ?? 120000, newGroup: true,
    });
  } finally {
    if (previousPath === undefined) delete process.env.PATH;
    else process.env.PATH = previousPath;
  }
  const document = getDocument(result.stdout);
  const response = responseFrom(document);
  const usage = usageFrom(document);
  const trace = sanitizeTrace(redact({ stdout: result.stdout, stderr: result.stderr, exit: result.exit, signal: result.signal,
    error: result.error, timedOut: result.timedOut, elapsedMs: result.elapsedMs }, route.apiKey));
  console.log(JSON.stringify({ response, operational: result.exit === 0 && !result.error && !result.timedOut && document?.ok === true,
    usage, toolCalls: countToolCalls(document), trace }));
} finally {
  if (previousApiKey === undefined) delete process.env.OPENAI_API_KEY;
  else process.env.OPENAI_API_KEY = previousApiKey;
  if (previousCodexKey === undefined) delete process.env.FILENS_BENCH_CODEX_API_KEY;
  else process.env.FILENS_BENCH_CODEX_API_KEY = previousCodexKey;
  await rm(temp, { recursive: true, force: true });
}
