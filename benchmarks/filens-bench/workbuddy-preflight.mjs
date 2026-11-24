import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { invoke } from './process.mjs';

const cli = process.env.FILENS_BENCH_WORKBUDDY_CLI
  ?? '/Applications/WorkBuddy.app/Contents/Resources/app.asar.unpacked/cli/dist/codebuddy-lite-wb.mjs';
const output = process.env.FILENS_BENCH_WORKBUDDY_PREFLIGHT
  ?? fileURLToPath(new URL('./results/2026-11-20/workbuddy-hy4-preflight/preflight.json', import.meta.url));
const modelId = 'hy4';

const version = await invoke(process.execPath, [cli, '--version'], { timeout: 10000 });
const help = await invoke(process.execPath, [cli, '--help'], { timeout: 10000 });
const modelText = `${help.stdout}\n${help.stderr}`.match(/Currently supported:\s*\(([^)]*)\)/i)?.[1] ?? null;
const cliModels = modelText?.split(',').map(value => value.trim()).filter(Boolean) ?? [];
const probe = await invoke(process.execPath, [
  cli, '--model', modelId, '--print', '--output-format', 'json', '只回复 READY。',
], { timeout: 20000, newGroup: false });
const probeText = `${probe.stdout}\n${probe.stderr}`.trim();
const authRequired = /authentication required|please use \/login/i.test(probeText);
const supportsModel = cliModels.includes(modelId);
const modelResponseReceived = /\bREADY\b/.test(probeText) && !authRequired;

const report = {
  schema: 'filens-bench-workbuddy-preflight-v1',
  timestamp: new Date().toISOString(),
  desktop: {
    appVersion: '5.11.3.43806934',
    selectedModel: 'Hy4 flash',
  },
  cli: {
    packageVersion: version.stdout.trim() || version.stderr.trim() || null,
    modelCatalog: cliModels,
    exposesHy4: supportsModel,
    authRequiredForHeadless: authRequired,
    modelResponseReceived,
    probeElapsedMs: probe.elapsedMs,
    probeExit: probe.exit,
    probeTimedOut: probe.timedOut,
    probeMessage: probeText || null,
  },
  status: authRequired && !supportsModel
    ? 'blocked-headless-auth-and-model-route'
    : authRequired
      ? 'blocked-headless-login-not-shared'
    : supportsModel && modelResponseReceived && probe.exit === 0 && !probe.error && !probe.timedOut
      ? 'ready'
      : 'blocked-hy4-headless-route-unavailable',
  benchmarkStarted: false,
  note: 'Desktop Hy4 flash is selected, but the bundled headless CLI is a separate route. This preflight does not count as a scored attempt.',
};

await mkdir(path.dirname(output), { recursive: true });
await writeFile(output, JSON.stringify(report, null, 2) + '\n');
console.log(JSON.stringify(report, null, 2));
