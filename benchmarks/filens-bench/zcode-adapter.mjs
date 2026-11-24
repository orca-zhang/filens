import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { access, chmod, cp, mkdir, mkdtemp, readFile, readdir, rm, symlink, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { invoke } from './process.mjs';

const repo = fileURLToPath(new URL('../../', import.meta.url));
const node = process.env.FILENS_BENCH_NODE22 ?? '/Users/orca/.nvm/versions/node/v22.18.0/bin/node';
const skillSource = process.env.FILENS_BENCH_SKILL_DIR ?? path.join(repo, 'skills', 'filens');
const openAIResponses = process.env.FILENS_BENCH_ZCODE_OPENAI_RESPONSES === '1';
let zcode = process.env.FILENS_BENCH_ZCODE;
if (!zcode) {
  try { zcode = execFileSync('/usr/bin/which', ['zcode'], { encoding: 'utf8' }).trim(); }
  catch { throw new Error('zcode CLI is unavailable; set FILENS_BENCH_ZCODE or add zcode to PATH.'); }
}
zcode = path.resolve(repo, zcode);
const providerId = 'codex-current';

try { await access(zcode); } catch { throw new Error('zcode CLI is unavailable; set FILENS_BENCH_ZCODE to its installed entry point.'); }

let input = '';
for await (const chunk of process.stdin) input += chunk;
const request = JSON.parse(input);
assert.ok(['stock', 'filens'].includes(request.condition), 'Unknown benchmark condition');
assert.ok(request.prompt?.corpus && request.prompt?.answerSchema, 'Invalid benchmark prompt');
assert.equal(request.model, 'gpt-6.1-sol', 'The adapter is pinned to the current Codex GPT model');

function tomlString(source, key) {
  return source.match(new RegExp(`^${key}\\s*=\\s*"([^"]+)"`, 'm'))?.[1];
}

async function codexRoute() {
  if (openAIResponses) {
    const config = await readFile(path.join(os.homedir(), '.codex', 'config.toml'), 'utf8');
    const stringValue = raw => {
      const quoted = raw.match(/^"(?:\\.|[^"\\])*"/s)?.[0];
      if (!quoted) return null;
      try { return JSON.parse(quoted); } catch { return quoted.slice(1, -1); }
    };
    let providerName = null, model = null, baseURL = null, wireApi = null, requiresOpenAIAuth = false, section = '';
    for (const line of config.split(/\r?\n/)) {
      const header = line.match(/^\s*\[([^\]]+)\]\s*$/);
      if (header) { section = header[1]; continue; }
      const setting = line.match(/^\s*([\w-]+)\s*=\s*(.*?)\s*(?:#.*)?$/);
      if (!setting) continue;
      const [, key, raw] = setting;
      if (!section && key === 'model_provider') providerName = stringValue(raw);
      if (!section && key === 'model') model = stringValue(raw);
      if (section === `model_providers.${providerName}`) {
        if (key === 'base_url') baseURL = stringValue(raw);
        if (key === 'wire_api') wireApi = stringValue(raw);
        if (key === 'requires_openai_auth') requiresOpenAIAuth = raw === 'true';
      }
    }
    assert.equal(model, 'gpt-6.1-sol', 'The current Codex route must match the pinned model');
    assert.equal(wireApi, 'responses', 'The current Codex provider must use the Responses protocol');
    assert.equal(requiresOpenAIAuth, true, 'The current Codex provider must expose OpenAI-compatible auth');
    assert.ok(baseURL && /^https?:\/\//.test(baseURL), 'The current Codex provider must have an HTTP(S) base URL');
    const auth = JSON.parse(await readFile(path.join(os.homedir(), '.codex', 'auth.json'), 'utf8'));
    let apiKey = auth.OPENAI_API_KEY;
    if (apiKey && typeof apiKey === 'object') apiKey = apiKey.value ?? apiKey.key;
    assert.ok(typeof apiKey === 'string' && apiKey.length, 'The current Codex login has no usable GPT credential');
    return { apiKey, baseURL, model, providerKind: 'openai' };
  }
  const configPath = path.join(os.homedir(), '.codex', 'config.toml');
  const config = await readFile(configPath, 'utf8');
  const model = tomlString(config, 'model');
  assert.ok(model, 'Codex model must be configured');
  const database = path.join(os.homedir(), '.cc-switch', 'cc-switch.db');
  const sql = "SELECT p.settings_config,COALESCE(e.url,p.name) AS url FROM providers p LEFT JOIN provider_endpoints e ON e.provider_id=p.id AND e.app_type=p.app_type WHERE p.app_type='codex' AND p.is_current=1 ORDER BY e.added_at DESC LIMIT 1;";
  const rows = JSON.parse(execFileSync('sqlite3', ['-cmd', '.timeout 10000', '-json', database, sql], { encoding: 'utf8' }));
  assert.equal(rows.length, 1, 'CC Switch must have one current Codex provider');
  const settings = JSON.parse(rows[0].settings_config);
  const configuredKey = settings.auth?.OPENAI_API_KEY;
  const apiKey = typeof configuredKey === 'string' ? configuredKey : configuredKey?.value ?? configuredKey?.key;
  const endpoint = new URL(rows[0].url);
  const baseURL = endpoint.origin;
  assert.ok(typeof apiKey === 'string' && apiKey.length, 'Current CC Switch Codex provider has no OPENAI_API_KEY');
  assert.ok(/^https?:\/\//.test(baseURL), 'Current CC Switch Codex provider URL must be HTTP(S)');
  return { apiKey, baseURL, model, providerKind: 'anthropic' };
}

function parseEvents(stdout) {
  return stdout.split(/\r?\n/).filter(line => line.trim().startsWith('{')).flatMap(line => {
    try { return [JSON.parse(line)]; } catch { return []; }
  });
}

function parseDocument(stdout) {
  try { return JSON.parse(stdout); } catch { return null; }
}

async function modelToolTrace(home, sessionId) {
  const directory = path.join(home, '.zcode', 'cli', 'rollout');
  const files = await readdir(directory).catch(() => []);
  const file = files.find(name => name === `model-io-${sessionId}.jsonl`) ?? (files.length === 1 ? files[0] : null);
  if (!file) return { count: null, names: [], filensUsed: null };
  const rows = (await readFile(path.join(directory, file), 'utf8')).split(/\r?\n/).filter(Boolean).flatMap(line => {
    try { return [JSON.parse(line)]; } catch { return []; }
  });
  const calls = rows.flatMap(row => row.response?.toolCalls ?? []);
  const names = calls.map(call => call.toolName ?? call.name).filter(name => typeof name === 'string');
  const filensUsed = calls.some(call => call.toolName === 'Bash' && /\bfilens(?:\s|$)/i.test(call.input?.command ?? ''));
  return { count: calls.length, names, filensUsed };
}

function parseResponse(final) {
  const text = typeof final?.text === 'string' ? final.text.trim() : typeof final?.response === 'string' ? final.response.trim() : '';
  if (!text) return final?.structured_output ?? final?.response ?? null;
  const fenced = text.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i)?.[1];
  try { return JSON.parse(fenced ?? text); } catch { return null; }
}

function reportedUsage(events) {
  const steps = events.filter(event => event.type === 'status' && event.phase === 'step_end' && event.usage);
  const rows = steps.length ? steps.map(event => event.usage) : events.filter(event => event.type === 'final' && event.usage).slice(-1);
  if (!rows.length) return null;
  const total = key => rows.every(row => Number.isFinite(row[key])) ? rows.reduce((sum, row) => sum + row[key], 0) : null;
  const output = total('outputTokens') ?? total('output_tokens');
  const reported = total('inputTokens') ?? total('input_tokens');
  const totalTokens = total('totalTokens') ?? total('total_tokens');
  const cacheRead = total('cacheReadTokens') ?? total('cachedInputTokens') ?? total('cache_read_input_tokens');
  const cacheWrite = total('cacheWriteTokens') ?? total('cache_write_input_tokens');
  return {
    input_tokens: totalTokens !== null && output !== null ? totalTokens - output : reported,
    reported_input_tokens: reported,
    cached_input_tokens: cacheRead,
    cache_write_input_tokens: cacheWrite,
    output_tokens: output,
    reasoning_output_tokens: total('reasoningTokens') ?? total('reasoning_output_tokens'),
  };
}

function redact(value, secret) {
  if (typeof value === 'string') return value.replaceAll(secret, '[redacted]');
  if (Array.isArray(value)) return value.map(item => redact(item, secret));
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, redact(item, secret)]));
  return value;
}

const route = await codexRoute();
assert.equal(route.model, request.model, 'Codex model changed after the adapter was pinned');
const temp = await mkdtemp(path.join(os.tmpdir(), 'filens-bench-zcode-'));
process.once('SIGTERM', () => {});
process.once('SIGINT', () => {});
try {
  const home = path.join(temp, 'home'), data = path.join(temp, 'data'), configPath = path.join(home, '.zcode', 'cli', 'config.json');
  await Promise.all([mkdir(home, { recursive: true }), mkdir(data, { recursive: true })]);
  await mkdir(path.dirname(configPath), { recursive: true });
  const config = {
    provider: {
      [providerId]: {
        kind: route.providerKind,
        name: 'Codex GPT',
        options: { apiKey: route.apiKey, baseURL: route.baseURL },
        models: { [request.model]: { name: request.model, contextWindow: 200000, maxOutputTokens: 32768 } },
      },
    },
    model: { main: `${providerId}/${request.model}` },
  };
  await writeFile(configPath, JSON.stringify(config), { mode: 0o600 });
  await chmod(configPath, 0o600);

  process.env.HOME = home;
  process.env.ZCODE_DATA_BASE_DIR = data;
  delete process.env.ZCODE_PERSONAL_PROVIDER_CONFIG_FILE;
  process.env.PATH = `${path.dirname(node)}${path.delimiter}${process.env.PATH ?? ''}`;
  if (request.condition === 'filens') {
    const skillDir = path.join(home, '.zcode', 'skills');
    await mkdir(skillDir, { recursive: true });
    await cp(skillSource, path.join(skillDir, 'filens'), { recursive: true });
  } else {
    const pathEntries = [...new Set(process.env.PATH.split(path.delimiter))];
    const hiddenBins = [];
    for (const directory of pathEntries) {
      try { await access(path.join(directory, 'filens')); hiddenBins.push(directory); } catch {}
    }
    const shadow = path.join(temp, 'native-bin');
    await mkdir(shadow);
    for (const directory of hiddenBins) for (const entry of await readdir(directory)) {
      if (entry === 'filens') continue;
      const target = path.join(shadow, entry);
      try { await access(target); } catch { await symlink(path.resolve(directory, entry), target); }
    }
    const hidden = new Set(hiddenBins.map(directory => path.resolve(directory)));
    process.env.PATH = [shadow, ...pathEntries.filter(directory => !hidden.has(path.resolve(directory)))].join(path.delimiter);
  }

  const result = await invoke(node, [zcode, '--prompt', JSON.stringify(request.prompt), '--cwd', request.prompt.corpus, '--mode', 'yolo', '--json'], {
    cwd: request.prompt.corpus, timeout: 118000, newGroup: false,
  });
  if (process.env.FILENS_BENCH_ZCODE_DEBUG_DIR) {
    const debugDir = path.resolve(repo, process.env.FILENS_BENCH_ZCODE_DEBUG_DIR, request.condition);
    await mkdir(debugDir, { recursive: true });
    const cliData = path.join(home, '.zcode', 'cli');
    // Preserve diagnostics without copying provider config or other credential files.
    for (const entry of ['log', 'rollout']) {
      await cp(path.join(cliData, entry), path.join(debugDir, entry), { recursive: true, force: true }).catch(() => {});
    }
  }
  const events = parseEvents(result.stdout);
  const final = events.filter(event => event.type === 'final').at(-1);
  const document = parseDocument(result.stdout);
  const response = parseResponse(final ?? document);
  const toolTrace = await modelToolTrace(home, document?.sessionId);
  const usage = document?.usage ? {
    input_tokens: Number.isFinite(document.usage.inputTokens) ? document.usage.inputTokens : null,
    reported_input_tokens: Number.isFinite(document.usage.inputTokens) ? document.usage.inputTokens : null,
    cached_input_tokens: Number.isFinite(document.usage.cacheReadTokens) ? document.usage.cacheReadTokens : null,
    cache_write_input_tokens: Number.isFinite(document.usage.cacheWriteTokens) ? document.usage.cacheWriteTokens : null,
    output_tokens: Number.isFinite(document.usage.outputTokens) ? document.usage.outputTokens : null,
    reasoning_output_tokens: Number.isFinite(document.usage.reasoningTokens) ? document.usage.reasoningTokens : null,
    model_requests: Number.isFinite(document.usage.modelRequestCount) ? document.usage.modelRequestCount : null,
  } : reportedUsage(events);
  const rawTrace = { stdout: result.stdout, stderr: result.stderr, exit: result.exit, signal: result.signal, error: result.error,
    timedOut: result.timedOut, elapsedMs: result.elapsedMs, modelToolTrace: toolTrace };
  console.log(JSON.stringify({ response, operational: result.exit === 0 && !result.error && !result.timedOut && (final?.reason?.kind === 'completed' || (typeof document?.response === 'string' && Boolean(document.turnId))),
    usage, toolCalls: toolTrace.count,
    trace: redact(rawTrace, route.apiKey) }));
} finally {
  await rm(temp, { recursive: true, force: true });
}
