import assert from 'node:assert/strict';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { access, mkdir, readFile, writeFile } from 'node:fs/promises';

const root = fileURLToPath(new URL('../', import.meta.url));
const modules = process.env.DSH_RUNTIME_MODULES ?? path.join(root, 'node_modules');
const fromRuntime = (name, file) => import(pathToFileURL(path.join(modules, '@deepseek-ai', name, 'lib', file)).href);
const { runProfile } = await fromRuntime('dsh', 'profile-boot.js');
const { loadLayeredEnv } = await fromRuntime('dsh-app-boot', 'index.js');
const version = JSON.parse(await readFile(path.join(modules, '@deepseek-ai/dsh/package.json'), 'utf8')).version;
const profile = process.env.DSH_TEST_PROFILE ?? 'filens-test';
const { ctx, shutdown } = await runProfile({ environment: loadLayeredEnv('dsh'), profile, patchFiles: [], args: ['--no-open', '--port', '0'] });
const readOnly = process.env.DSH_TEST_READ_ONLY === '1';
const removed = process.env.DSH_TEST_REMOVED === '1';
const artifacts = path.join(root, 'artifacts/integration', version, removed ? 'removed' : readOnly ? 'read-only' : 'workspace-write');
await mkdir(artifacts, { recursive: true });
const report = { version, profile, policy: ctx.get('sandboxPolicy')?.resolve().mode, checks: [] };
const record = name => { report.checks.push(name); console.log(`Passed: ${name}`); };
try {
  const entries = [...ctx.loader.entries()];
  if (removed) {
    assert.ok(!entries.some(entry => entry.options.name.startsWith('dsh-filens')));
    assert.equal(ctx.tools.get('filens_read'), undefined);
    assert.ok(!ctx.clientModules.graph().entries.some(entry => entry.id === 'dsh-filens'));
    const { runtime } = await import(pathToFileURL(path.join(root, 'lib/runtime-manifest.js')).href);
    assert.equal((await fetch(`${ctx.webServer.getOrigin()}${runtime.basePath}viewer.html`)).status, 404);
    record('fresh boot after package removal has no FiLens tools, client or resource route');
  } else {
  const tools = entries.find(entry => entry.options.id === 'filens-tools');
  const preview = entries.find(entry => entry.options.id === 'filens-preview');
  assert.ok(tools?.fiber && preview?.fiber, 'Both installed bundle entries must mount');
  assert.ok(ctx.tools.get('filens_read'));
  record('bundle installation mounts both Host entries');
  const graph = ctx.clientModules.graph();
  assert.ok(graph.entries.some(entry => entry.id === 'dsh-filens'));
  record('Preview client participates in the real DSH module graph');
  const origin = ctx.webServer.getOrigin();
  const authenticated = await fetch(ctx.connection.authenticatedUrl(origin), { redirect: 'manual' });
  const cookie = authenticated.headers.getSetCookie().map(value => value.split(';')[0]).join('; ');
  const html = await (authenticated.status >= 300 && authenticated.status < 400
    ? await fetch(origin, { headers: { cookie } }) : authenticated).text();
  assert.match(html, /__FILENS_DSH_PREVIEW_ORIGIN__/);
  assert.ok(html.includes(origin));
  const runtimeManifest = await import(pathToFileURL(path.join(root, 'lib/runtime-manifest.js')).href);
  const asset = `${origin}${runtimeManifest.runtime.basePath}viewer.html`;
  assert.equal((await fetch(asset)).status, 200);
  record('real webServer serves the iframe runtime');
  async function call(name, args = {}) {
    const signal = new AbortController().signal;
    if (version === '0.2.1-rc.5') return ctx.tools.execute({ name, arguments: args, callId: crypto.randomUUID(), signal });
    const batch = await ctx.tools.execute({ signal, calls: [{ type: 'tool-call', id: crypto.randomUUID(), name, arguments: JSON.stringify(args) }] });
    return batch.results[0].result;
  }
  async function update(entry, options) {
    await entry.update(options);
    // rc.5 returns before the remounted plugin has registered its tools.
    await entry.fiber?.await();
  }
  for (const [name, args] of [
    ['filens_capacity', {}],
    ['filens_read', { path: path.join(root, '../../apps/demo/public/samples/filens-aurora-guide.docx') }],
    ['filens_read', { path: path.join(root, '../../converter/rapidocr/testdata/scan.pdf'), layout: true }],
    ['filens_excerpt', { path: path.join(root, '../../README.md'), query: 'preview' }],
    ['filens_search', { path: path.join(root, '../../apps/demo/public/samples'), query: 'Aurora', max_files: 3 }],
  ]) {
    const result = await call(name, args);
    assert.equal(result.isError, false, JSON.stringify(result));
    assert.ok(result.value?.response, JSON.stringify(result));
    if (name !== 'filens_search') assert.equal(result.value.response.ok, true, JSON.stringify(result));
    if (name === 'filens_capacity') {
      assert.equal(result.value.response.capacity.execution.workspace, 'memory');
      assert.equal(result.value.response.capacity.ocr.available, true, JSON.stringify(result));
    }
    if (args.path?.endsWith('scan.pdf')) assert.match(result.value.response.content.text, /FILENS2026[\s\S]*BRIGHT2027/);
    record(`${name} through the installed DSH tool pipeline (${report.policy})`);
  }
  const csv = path.join(artifacts, 'input.csv');
  const xlsx = path.join(artifacts, `converted-${crypto.randomUUID()}.xlsx`);
  await writeFile(csv, 'name,value\nHarness,42\n');
  const converted = await call('filens_convert', { path: csv, output: xlsx });
  if (readOnly) {
    assert.equal(report.policy, 'read-only');
    assert.ok(converted.isError || converted.value.response.ok === false, JSON.stringify(converted));
    await assert.rejects(access(xlsx));
    record('real read-only sandbox refuses conversion output without creating a file');
  } else {
    assert.equal(converted.isError, false, JSON.stringify(converted));
    assert.equal(converted.value.response.ok, true, JSON.stringify(converted));
    assert.equal((await readFile(xlsx)).subarray(0, 2).toString(), 'PK');
    record('filens_convert writes a new XLSX through the installed DSH tool pipeline');
    if (process.platform === 'darwin' && process.env.DSH_HOME) {
      const config = { ...tools.options.config };
      const require = createRequire(path.join(process.env.DSH_HOME, 'profiles', profile, 'node_modules/dsh-filens/package.json'));
      const launcher = path.join(path.dirname(require.resolve('filens-cli/package.json')), 'cli.mjs');
      await access(launcher);
      try {
        await update(tools, { config: { ...config, command: ['/usr/bin/env', 'ELECTRON_RUN_AS_NODE=1', process.execPath, launcher, '--workspace', 'disk'] } });
        const disk = await call('filens_capacity');
        assert.equal(disk.isError, false, JSON.stringify(disk));
        assert.equal(disk.value.response.capacity.execution.workspace, 'disk', JSON.stringify(disk));
        const read = await call('filens_read', { path: path.join(root, '../../apps/demo/public/samples/filens-aurora-guide.docx') });
        assert.equal(read.value.response.ok, true, JSON.stringify(read));
        record('command parameters explicitly select disk workspace through the installed DSH pipeline');
      } finally { await update(tools, { config }); }
    }
  }
  await update(tools, { disabled: true });
  assert.equal(ctx.tools.get('filens_read'), undefined);
  assert.equal((await fetch(asset)).status, 200);
  record('disable Tools independently while Preview stays active');
  await update(tools, { disabled: false });
  assert.ok(ctx.tools.get('filens_read'));
  await update(preview, { disabled: true });
  assert.equal((await fetch(asset)).status, 404);
  assert.ok(ctx.tools.get('filens_read'));
  assert.ok(!ctx.clientModules.graph().entries.some(entry => entry.id === 'dsh-filens'));
  record('disable Preview removes its route/client while Tools stays active');
  await update(preview, { disabled: false });
  assert.equal((await fetch(asset)).status, 200);
  assert.ok(ctx.clientModules.graph().entries.some(entry => entry.id === 'dsh-filens'));
  record('both entries re-enable without duplicate registrations');
  }
} finally {
  await writeFile(path.join(artifacts, 'report.json'), JSON.stringify(report, null, 2) + '\n');
  await shutdown.shutdown(0);
}
