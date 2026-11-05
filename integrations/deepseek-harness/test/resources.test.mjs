import assert from 'node:assert/strict';
import { test } from 'node:test';
import { Context } from '@deepseek-ai/cordis';
import * as Preview from '../lib/preview-host.js';
import { runtime } from '../lib/runtime-manifest.js';

test('static resources serve enumerated code only, with CSP and proper HEAD', async () => {
  const url = `http://127.0.0.1${runtime.basePath}`;
  const html = await Preview.runtimeResource(new Request(`${url}filens.js`));
  assert.equal(html.status, 200);
  assert.equal(html.headers.get('cache-control'), 'public, max-age=31536000, immutable');
  assert.match(html.headers.get('content-security-policy'), /connect-src 'self' data: blob:/);
  assert.equal(html.headers.get('access-control-allow-origin'), '*');
  assert.match(await html.text(), /createPreview/);
  const css = await Preview.runtimeResource(new Request(`${url}style.css`));
  assert.match(css.headers.get('content-type'), /^text\/css/);
  await css.body.cancel();
  const head = await Preview.runtimeResource(new Request(`${url}filens.js`, { method: 'HEAD' }));
  assert.equal(head.status, 200);
  assert.equal(head.headers.get('cache-control'), html.headers.get('cache-control'));
  assert.equal(head.headers.get('content-length'), String(runtime.files['filens.js'].bytes));
  assert.equal(await head.text(), '');
  const moduleWorker = Object.keys(runtime.files).find(file => file.endsWith('.mjs'));
  assert.ok(moduleWorker, 'The split runtime must expose its PDF module worker.');
  const worker = await Preview.runtimeResource(new Request(`${url}${moduleWorker}`));
  assert.equal(worker.status, 200);
  assert.match(worker.headers.get('content-type'), /^text\/javascript/);
  await worker.body.cancel();
  for (const file of ['../../package.json', '%2e%2e%2fpackage.json', 'filens.js?file=/etc/passwd', 'secret.docx']) {
    const result = await Preview.runtimeResource(new Request(`${url}${file}`));
    assert.equal(result.status, file.startsWith('filens.js?') ? 200 : 404);
    await result.body?.cancel();
  }
  assert.equal((await Preview.runtimeResource(new Request(`${url}filens.js`, { method: 'POST' }))).status, 405);
});

test('Host route and startup injection are removed with the Preview plugin', async () => {
  const ctx = new Context();
  let registered = 0;
  await ctx.provide('webServer', { register: route => { assert.equal(route.kind, 'prefix'); registered++; return () => { registered--; }; }, getOrigin: () => 'http://127.0.0.1:3000' });
  const plugin = ctx.plugin(Preview);
  await plugin;
  const table = [];
  await ctx.parallel('webserver/index-inject', table);
  assert.equal(registered, 1);
  assert.deepEqual(table, [{ kind: 'global', name: '__FILENS_DSH_PREVIEW_ORIGIN__', value: 'http://127.0.0.1:3000' }]);
  await plugin.dispose();
  assert.equal(registered, 0);
  const empty = [];
  await ctx.parallel('webserver/index-inject', empty);
  assert.deepEqual(empty, []);
  await ctx.fiber.dispose();
});
