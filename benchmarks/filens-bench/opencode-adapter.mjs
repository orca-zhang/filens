import assert from 'node:assert/strict';
import { access, chmod, cp, mkdir, mkdtemp, readFile, readdir, rm, symlink, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { invoke } from './process.mjs';

const modelId = 'gpt-6.1-sol';
const providerId = 'codex-current';
const repo = fileURLToPath(new URL('../../', import.meta.url));
const opencode = process.env.FILENS_BENCH_OPENCODE ?? 'opencode';

let input = '';
for await (const chunk of process.stdin) input += chunk;
const request = JSON.parse(input);
assert.ok(['stock', 'filens'].includes(request.condition), 'Unknown benchmark condition');
assert.ok(request.prompt?.corpus && request.prompt?.answerSchema, 'Invalid benchmark prompt');
assert.equal(request.model, modelId, 'The adapter is pinned to the current Codex GPT model');
assert.equal(request.reasoningEffort, 'high', 'OpenCode reasoning effort is pinned to high');

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
    if (section === 'model_providers.' + providerName) {
      if (key === 'base_url' && raw.startsWith('"')) baseURL = parseTomlString(raw);
      if (key === 'wire_api' && raw.startsWith('"')) wireApi = parseTomlString(raw);
      if (key === 'requires_openai_auth') requiresOpenAIAuth = raw === 'true';
    }
  }
  return { model, baseURL, wireApi, requiresOpenAIAuth };
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

function parseEvents(stdout) {
  return stdout.split(/\r?\n/).filter(line => line.trim().startsWith('{')).flatMap(line => {
    try { return [JSON.parse(line)]; } catch { return []; }
  });
}

function parseAnswer(value) {
  if (typeof value !== 'string') return null;
  const text = value.trim();
  const fence = String.fromCharCode(96).repeat(3);
  const fenced = text.match(new RegExp('^' + fence + '(?:json)?\\s*([\\s\\S]*?)\\s*' + fence + '$', 'i'))?.[1];
  try {
    const parsed = JSON.parse(fenced ?? text);
    return parsed && typeof parsed === 'object' && parsed.status && Array.isArray(parsed.answers) ? parsed : null;
  } catch { return null; }
}

function responseFrom(events, stdout) {
  const texts = events.flatMap(event => {
    const candidates = [event?.part?.text, event?.text, event?.message?.text];
    return candidates.filter(value => typeof value === 'string');
  });
  for (const text of texts.slice().reverse()) {
    const answer = parseAnswer(text);
    if (answer) return answer;
  }
  for (const text of [texts.join(''), stdout]) {
    const answer = parseAnswer(text);
    if (answer) return answer;
  }
  return null;
}

function usageFrom(events) {
  const rows = events.flatMap(event => {
    const part = event?.part ?? event;
    const usage = part?.tokens ?? part?.usage ?? event?.usage;
    return event?.type === 'step_finish' && usage ? [usage] : [];
  });
  if (!rows.length) return null;
  const sum = values => values.every(Number.isFinite) ? values.reduce((total, value) => total + value, 0) : null;
  const inputs = rows.map(row => row.input ?? row.inputTokens ?? row.input_tokens ?? row.prompt_tokens);
  const outputs = rows.map(row => row.output ?? row.outputTokens ?? row.output_tokens ?? row.completion_tokens);
  const reads = rows.map(row => row.cache?.read ?? row.cacheReadTokens ?? row.cachedInputTokens ?? row.cache_read_input_tokens ?? 0);
  const writes = rows.map(row => row.cache?.write ?? row.cacheWriteTokens ?? row.cache_write_input_tokens ?? 0);
  const reasoning = rows.map(row => row.reasoning ?? row.reasoningTokens ?? row.reasoning_output_tokens ?? 0);
  const reportedInput = sum(inputs);
  const cachedInput = sum(reads);
  const cacheWrite = sum(writes);
  return {
    input_tokens: reportedInput === null || cachedInput === null || cacheWrite === null ? null : reportedInput + cachedInput + cacheWrite,
    reported_input_tokens: reportedInput,
    cached_input_tokens: cachedInput,
    cache_write_input_tokens: cacheWrite,
    output_tokens: sum(outputs),
    reasoning_output_tokens: sum(reasoning),
  };
}

function toolCallCount(events) {
  return events.filter(event => event.type === 'tool_use' || event.part?.type === 'tool').length;
}

function redact(value, secret) {
  if (typeof value === 'string') return value.replaceAll(secret, '[redacted]');
  if (Array.isArray(value)) return value.map(item => redact(item, secret));
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, redact(item, secret)]));
  return value;
}

async function pathWithoutFilens(directory) {
  const pathEntries = [...new Set((process.env.PATH ?? '').split(path.delimiter).filter(Boolean))];
  const hidden = new Set();
  for (const entry of pathEntries) {
    try { await access(path.join(entry, 'filens')); hidden.add(path.resolve(entry)); } catch {}
  }
  if (!hidden.size) return process.env.PATH ?? '';
  const shadow = path.join(directory, 'native-bin');
  await mkdir(shadow);
  for (const entry of hidden) for (const item of await readdir(entry)) {
    if (item === 'filens') continue;
    const target = path.join(shadow, item);
    try { await access(target); } catch { await symlink(path.resolve(entry, item), target); }
  }
  return [shadow, ...pathEntries.filter(entry => !hidden.has(path.resolve(entry)))]
    .join(path.delimiter);
}

const route = await codexRoute();
const temp = await mkdtemp(path.join(os.tmpdir(), 'filens-bench-opencode-'));
const envKeys = ['HOME', 'XDG_CONFIG_HOME', 'XDG_DATA_HOME', 'OPENCODE_CONFIG', 'OPENCODE_DISABLE_AUTOUPDATE', 'PATH'];
const previous = Object.fromEntries(envKeys.map(key => [key, process.env[key]]));
try {
  const home = path.join(temp, 'home'), configHome = path.join(home, '.config'), dataHome = path.join(temp, 'data');
  const configPath = path.join(temp, 'opencode.json');
  await Promise.all([
    mkdir(path.join(configHome, 'opencode', 'skills'), { recursive: true }),
    mkdir(dataHome, { recursive: true }),
  ]);
  const model = {
    name: 'GPT-6.1-Sol',
    limit: { context: 272000, output: 32768 },
    reasoning: true,
    tool_call: true,
    variants: { high: { reasoningEffort: 'high' } },
  };
  const config = {
    '$schema': 'https://opencode.ai/config.json',
    model: providerId + '/' + modelId,
    provider: {
      [providerId]: {
        name: 'Codex GPT',
        npm: '@ai-sdk/openai',
        options: { baseURL: route.baseURL, apiKey: route.apiKey },
        models: { [modelId]: model },
      },
    },
  };
  await writeFile(configPath, JSON.stringify(config, null, 2) + '\n', { mode: 0o600 });
  await chmod(configPath, 0o600);
  if (request.condition === 'filens') {
    await cp(path.join(repo, 'skills', 'filens'), path.join(configHome, 'opencode', 'skills', 'filens'), { recursive: true });
  }

  process.env.HOME = home;
  process.env.XDG_CONFIG_HOME = configHome;
  process.env.XDG_DATA_HOME = dataHome;
  process.env.OPENCODE_CONFIG = configPath;
  process.env.OPENCODE_DISABLE_AUTOUPDATE = '1';
  if (request.condition === 'stock') process.env.PATH = await pathWithoutFilens(temp);
  const result = await invoke(opencode, [
    'run', '--pure', '--format', 'json', '--auto', '--model', providerId + '/' + modelId,
    '--variant', 'high', '--dir', request.prompt.corpus, '--title', request.prompt.task.id,
    JSON.stringify(request.prompt),
  ], { cwd: request.prompt.corpus, timeout: request.timeoutMs ?? 120000, newGroup: false });
  const events = parseEvents(result.stdout);
  const response = responseFrom(events, result.stdout);
  const trace = redact({
    stdout: result.stdout, stderr: result.stderr, exit: result.exit, signal: result.signal,
    error: result.error, timedOut: result.timedOut, elapsedMs: result.elapsedMs,
  }, route.apiKey);
  console.log(JSON.stringify({
    response,
    operational: result.exit === 0 && !result.error && !result.timedOut,
    usage: usageFrom(events),
    toolCalls: toolCallCount(events),
    trace,
  }));
} finally {
  for (const [key, value] of Object.entries(previous)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  await rm(temp, { recursive: true, force: true });
}
