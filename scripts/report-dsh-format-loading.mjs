// Compare actual format resource requests against an earlier embedded runtime.
// node scripts/report-dsh-format-loading.mjs --baseline <lib/runtime> --output <json>
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createServer } from 'node:http';
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { gzipSync, brotliCompressSync } from 'node:zlib';
import { chromium } from '@playwright/test';

const argument = name => {
  const at = process.argv.indexOf(name);
  return at < 0 ? undefined : process.argv[at + 1];
};
const roots = {
  current: path.resolve('integrations/deepseek-harness/lib/runtime'),
  ...(argument('--baseline') ? { baseline: path.resolve(argument('--baseline')) } : {})
};
const cases = ['hello.txt', 'filens-cosmic-atlas.pdf', 'filens-aurora-guide.docx', 'filens-field-notes.pptx'];
const mime = file => file.endsWith('.wasm') ? 'application/wasm' : file.endsWith('.css') ? 'text/css' : 'text/javascript';
const server = createServer(async (request, response) => {
  try {
    const url = new URL(request.url, 'http://localhost');
    if (url.pathname === '/') {
      response.setHeader('content-type', 'text/html');
      return response.end('<!doctype html><style>html,body,#preview{height:100%;margin:0}</style><div id="preview"></div>');
    }
    const [, build, ...parts] = url.pathname.split('/');
    assert.ok(Object.hasOwn(roots, build));
    const file = path.resolve(roots[build], ...parts);
    assert.ok(file.startsWith(roots[build] + path.sep));
    response.setHeader('content-type', mime(file));
    response.end(await readFile(file));
  } catch (error) { response.writeHead(404).end(String(error)); }
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const origin = `http://127.0.0.1:${server.address().port}`;
const browser = await chromium.launch();
const report = {
  observedAt: new Date().toISOString(), browser: browser.version(), node: process.version,
  scope: 'Actual runtime requests in fresh browser contexts. Raw file bytes plus independently compressed gzip/Brotli estimates; excludes document bytes, HTTP headers and host application. Worker assets are included when requested. This is a loading-size comparison, not a latency or rendering-fidelity benchmark.',
  builds: {}
};
const measure = async (root, files) => {
  const rows = {};
  for (const file of [...files].sort()) {
    const bytes = await readFile(path.join(root, file));
    rows[file] = { raw: bytes.length, gzip: gzipSync(bytes, { level: 9 }).length,
      brotli: brotliCompressSync(bytes).length, sha256: createHash('sha256').update(bytes).digest('hex') };
  }
  return { total: Object.fromEntries(['raw', 'gzip', 'brotli'].map(key =>
    [key, Object.values(rows).reduce((sum, row) => sum + row[key], 0)])), files: rows };
};
try {
  for (const [build, root] of Object.entries(roots)) {
    const result = {};
    for (const name of cases) {
      const page = await browser.newPage();
      const requested = new Set(), errors = [];
      page.on('request', request => {
        const url = new URL(request.url());
        if (url.pathname.startsWith(`/${build}/`)) requested.add(url.pathname.slice(build.length + 2));
      });
      page.on('pageerror', error => errors.push(error.message));
      try {
        await page.goto(origin);
        await page.evaluate(async build => { window.previewLibrary = await import(`/${build}/filens.js`); }, build);
        if (!result.importOnly) result.importOnly = await measure(root, requested);
        const bytes = name === 'hello.txt' ? new TextEncoder().encode('Hello from FiLens.')
          : await readFile(path.join('apps/demo/public/samples', name));
        await page.evaluate(async ({ build, name, bytes }) => {
          const style = document.createElement('link'); style.rel = 'stylesheet'; style.href = `/${build}/style.css`;
          await new Promise((resolve, reject) => { style.onload = resolve; style.onerror = reject; document.head.append(style); });
          window.previewLibrary.createPreview('#preview', {
            src: new Uint8Array(bytes), name, toolbar: false,
            onRendered() { document.body.dataset.state = 'ready'; },
            onError(error) { document.body.dataset.state = 'error'; document.body.dataset.error = error.message; }
          });
        }, { build, name, bytes: [...bytes] });
        await page.waitForFunction(() => document.body.dataset.state, null, { timeout: 65000 });
        assert.equal(await page.locator('body').getAttribute('data-state'), 'ready', `${build} ${name}`);
        await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
        assert.deepEqual(errors, []);
        result[name] = await measure(root, requested);
      } finally { await page.close(); }
    }
    report.builds[build] = result;
  }
  const output = JSON.stringify(report, null, 2) + '\n';
  if (argument('--output')) await writeFile(argument('--output'), output);
  console.log(JSON.stringify(Object.fromEntries(Object.entries(report.builds).map(([name, cases]) =>
    [name, Object.fromEntries(Object.entries(cases).map(([file, data]) => [file, data.total]))])), null, 2));
} finally {
  await browser.close();
  await new Promise(resolve => server.close(resolve));
}
