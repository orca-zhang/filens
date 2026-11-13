// Exercise actual file:// HTML artifacts with the browser offline and the
// generating process already exited. No document conversion is mocked.
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { createInterface } from 'node:readline';
import { access, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium, firefox, webkit } from '@playwright/test';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const binary = process.env.FILENS_AGENT_BINARY || path.join(root, 'dist/filens');
const assets = process.env.FILENS_PREVIEW_TEST_DIR || path.join(root, 'packages/preview/dist');
const browsers = (process.env.FILENS_HTML_TEST_BROWSERS || 'chromium').split(',');
const work = await mkdtemp(path.join(os.tmpdir(), 'filens-html-test-'));
const outputs = [];
const observations = [];
const sourceName = process.platform === 'win32' ? '中文 & name.txt' : '中文 <&" #.txt';
const source = path.join(work, sourceName);
const text = 'FILENS_OFFLINE_HTML_2026 中文\n<script>window.filensInjected = true</script>';
await writeFile(source, text);

function run(args, code = 0) {
  const result = spawnSync(binary, ['preview', ...args, '--no-open', '--json'], { cwd: root, encoding: 'utf8', timeout: 15000 });
  assert.equal(result.error, undefined, result.error?.message);
  assert.equal(result.status, code, result.stderr || result.stdout);
  return JSON.parse(result.stdout);
}
function generate(file, args = []) {
  const result = run([file, '--assets', assets, ...args]);
  assert.equal(result.mode, 'html');
  assert.equal(result.transport, 'file');
  assert.equal(result.containsSource, true);
  assert.equal(result.stop, undefined);
  const localPath = process.platform === 'win32'
    ? result.path.replace(/^\\\\\?\\UNC\\/, '\\\\').replace(/^\\\\\?\\/, '')
    : result.path;
  assert.equal(fileURLToPath(result.url), localPath);
  outputs.push(result.path);
  return result;
}

async function verifyCompatibility(browser, file) {
  const child = spawn(binary, ['preview', file, '--assets', assets, '--mode', 'serve', '--no-open', '--json'], { cwd: root });
  const closed = new Promise(resolve => child.once('close', resolve));
  const context = await browser.newContext();
  try {
    const info = await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('Compatibility server startup timeout')), 10000);
      child.once('error', error => { clearTimeout(timer); reject(error); });
      child.once('exit', code => { clearTimeout(timer); reject(new Error(`Compatibility server exited ${code}`)); });
      createInterface({ input: child.stdout }).once('line', line => { clearTimeout(timer); resolve(JSON.parse(line)); });
    });
    const page = await context.newPage();
    const external = [];
    await context.route('**/*', route => {
      const url = route.request().url();
      if (/^https?:/.test(url) && new URL(url).origin !== new URL(info.url).origin) {
        external.push(url); return route.abort();
      }
      return route.continue();
    });
    await page.goto(info.url);
    await page.waitForFunction(() => ['ready', 'error'].includes(document.body.dataset.state), null, { timeout: 30000 });
    assert.equal(await page.evaluate(() => document.body.dataset.state), 'ready');
    assert.deepEqual(external, []);
  } finally {
    await context.close();
    child.kill('SIGTERM');
    await closed;
  }
}

try {
  const savedPath = path.join(work, '中文 # %.html');
  const saved = generate(source, ['--output', savedPath]);
  assert.equal(saved.temporary, false);
  const html = await readFile(savedPath, 'utf8');
  const embedded = JSON.parse(html.split('<script id="filens-source" type="application/json">')[1].split('</script>')[0]);
  assert.equal(embedded.name, sourceName);
  assert.equal(Buffer.from(embedded.data, 'base64').toString(), text);
  assert.ok(!html.includes('<!--FILENS_'));
  assert.match(html, /THIRD.PARTY|MIT License/);
  assert.equal(run([source, '--assets', assets, '--output', savedPath], 1).error.code, 'preview_failed');
  assert.equal(await readFile(savedPath, 'utf8'), html);
  assert.equal(run([source, '--assets', assets, '--output', source], 1).error.code, 'preview_failed');
  assert.equal(await readFile(source, 'utf8'), text);
  for (const options of [
    ['--mode', 'unknown'], ['--mode', 'html', '--port', '0'],
    ['--mode', 'serve', '--output', path.join(work, 'unused.html')],
    ['--assets', path.join(work, 'missing')]
  ]) assert.equal(run([source, ...options], 1).error.code, 'preview_failed');

  const fixtures = [
    'apps/demo/public/samples/filens-cosmic-atlas.pdf',
    'apps/demo/public/samples/filens-aurora-guide.docx',
    'apps/demo/public/samples/filens-observatory.xlsx',
    'apps/demo/public/samples/filens-field-notes.pptx',
    'apps/demo/public/samples/legacy-project-workflow.doc',
    'apps/demo/public/samples/filens-weekend.key',
    'apps/demo/public/samples/a.pages',
    'apps/demo/public/samples/a.numbers',
    'apps/demo/public/samples/raw/pentax-k-r.dng',
    'apps/demo/public/samples/sample-nested-archives.zip',
    'packages/archive/test/fixtures/rar5-encrypted.rar',
    'packages/model3d/test/fixtures/occt/cube.stp',
    'examples/go-wazero-converter/fixtures/icons/sample.apk',
    'packages/converter-client/test/fixtures/password/agile.docx',
    'packages/converter-client/test/fixtures/password/agile.xlsx',
    'packages/converter-client/test/fixtures/password/agile.pptx'
  ];
  const documents = [saved, ...fixtures.map(file => ({ ...generate(path.join(root, file)), input: path.join(root, file) }))];
  // Artifacts remain usable after the source file disappears.
  await rm(source);

  for (const browserName of browsers) {
    const browserType = { chromium, firefox, webkit }[browserName];
    assert.ok(browserType, `Unknown browser: ${browserName}`);
    await access(browserType.executablePath());
    const browser = await browserType.launch({ headless: true });
    try {
      // WebKit's automation offline switch also disables file: navigation, even
      // for an empty local HTML. Block network routes there instead.
      const context = await browser.newContext({ offline: browserName !== 'webkit' });
      if (browserName === 'webkit') await context.route(/^https?:\/\//, route => route.abort());
      for (const document of documents) {
        const page = await context.newPage();
        const network = [], errors = [];
        page.on('request', request => { if (/^(https?|wss?):/.test(request.url())) network.push(request.url()); });
        page.on('pageerror', error => errors.push(error.message));
        try {
          await page.goto(document.url);
          if (document.source.name.startsWith('agile.')) {
            const password = page.locator('input[type=password]');
            await password.waitFor();
            await password.fill('wrong');
            await password.press('Enter');
            await page.getByRole('alert').waitFor();
            await password.fill(' filens 密码🔐 ');
            await password.press('Enter');
            await password.waitFor({ state: 'detached' });
            await page.waitForFunction(() => /Fixture (DOCX document|XLSX workbook|PPTX presentation slide)/.test(document.body.innerText));
          }
          await page.waitForFunction(() => ['ready', 'error'].includes(document.body.dataset.state), null, { timeout: 30000 });
          const state = await page.evaluate(() => ({ state: document.body.dataset.state, error: document.body.dataset.error, text: document.body.innerText, injected: window.filensInjected }));
          if (document.source.name.endsWith('.rar')) {
            assert.equal(state.state, 'error');
            assert.match(state.error, /separate archive engine files/);
            assert.deepEqual(network, []);
            await verifyCompatibility(browser, document.input);
            observations.push({ browser: browserName, file: document.source.name, state: 'external-archive-engine-required', compatibilityMode: 'serve', compatibilityState: 'ready' });
            console.log(`${browserName}: embedded HTML keeps RAR external and HTTP compatibility renders locally`);
            continue;
          }
          if (browserName === 'webkit' && /\.(key|pages|numbers)$/.test(document.source.name) && state.state === 'error') {
            assert.match(state.error, /iWork parser worker failed|Script error/);
            assert.equal(await page.locator('#help').isVisible(), true);
            assert.match(await page.locator('#help').textContent(), /--mode serve/);
            assert.deepEqual(network, []);
            await verifyCompatibility(browser, document.input);
            observations.push({ browser: browserName, version: browser.version(), file: document.source.name,
              state: 'compatibility-required', error: state.error, compatibilityMode: 'serve', compatibilityState: 'ready', externalRequests: 0 });
            console.log(`${browserName}: ${document.source.name} shows file: worker restriction; HTTP compatibility rendered locally`);
            continue;
          }
          assert.equal(state.state, 'ready', `${browserName}: ${document.source.name}: ${state.error}`);
          assert.equal(state.injected, undefined);
          assert.deepEqual(network, [], `${document.source.name}: network requests`);
          assert.deepEqual(errors, [], `${document.source.name}: browser errors`);
          if (document === saved) {
            assert.match(state.text, /FILENS_OFFLINE_HTML_2026 中文/);
            assert.equal(await page.locator('#name').textContent(), sourceName);
            assert.equal(await page.getByRole('link', { name: 'GitHub' }).getAttribute('href'), 'https://github.com/orca-zhang/filens');
            assert.equal(await page.locator('#help').isVisible(), false);
          }
          observations.push({ browser: browserName, version: browser.version(), file: document.source.name, state: state.state, externalRequests: network.length,
            networkIsolation: browserName === 'webkit' ? 'HTTP(S) routes blocked; automation offline switch also blocks local files' : 'Browser offline mode' });
          console.log(`${browserName}: ${document.source.name} rendered offline from file://`);
        } finally { await page.close(); }
      }
      // Missing capabilities produce visible fallback instructions, not a blank page.
      for (const feature of ['Worker', 'WebAssembly']) {
        const page = await context.newPage();
        await page.addInitScript(feature => Object.defineProperty(window, feature, { value: undefined, configurable: true }), feature);
        await page.goto(saved.url);
        await page.waitForFunction(() => document.body.dataset.state === 'error');
        assert.match(await page.locator('#status').textContent(), /WebAssembly.*Web Workers/);
        assert.match(await page.locator('#help').textContent(), /--mode serve/);
        await page.close();
      }
      await context.close();
      // Test the CSP separately with the browser online. A route would catch
      // egress if the policy failed, without sending any bytes to a remote host.
      const online = await browser.newContext();
      const attempted = [];
      await online.route('https://filens-egress.invalid/**', route => { attempted.push(route.request().url()); return route.abort(); });
      const page = await online.newPage();
      await page.goto(saved.url);
      await page.waitForFunction(() => document.body.dataset.state === 'ready');
      const blocked = await page.evaluate(async () => {
        const violation = new Promise(resolve => window.addEventListener('securitypolicyviolation', event => resolve(event.effectiveDirective), { once: true }));
        await fetch('https://filens-egress.invalid/upload', { method: 'POST', body: 'fixed-test-string' }).catch(() => {});
        return violation;
      });
      assert.equal(blocked, 'connect-src');
      assert.deepEqual(attempted, []);
      await online.close();
    } finally { await browser.close(); }
  }
  const reportPath = process.env.FILENS_HTML_TEST_REPORT || 'docs/preview-html-validation.json';
  await writeFile(path.resolve(root, reportPath), JSON.stringify({
    observedAt: new Date().toISOString(), platform: `${process.platform}-${process.arch}`,
    scope: 'Real embedded HTML opened via file:// after CLI exit. Chromium/Firefox use offline mode; WebKit uses blocked HTTP(S) routes because its automation offline switch also blocks local files. Readiness is checked; no pixel-fidelity claim or OS default-browser-launch validation.',
    checks: ['Default HTML mode starts no local HTTP server', 'Source removed before preview', 'Unicode/URL-delimiter paths and HTML-sensitive names', 'No overwrite of existing files', 'GitHub link', 'Embedded licenses', 'Wrong and correct Office passwords', 'Visible errors for missing WASM/Worker support', 'Online CSP blocks outbound fetch before routing', 'WebKit iWork file-worker errors display fallback instructions; actual loopback compatibility is verified'],
    observations
  }, null, 2) + '\n');
  console.log(`${observations.length} HTML preview checks passed; saved ${reportPath}`);
} finally {
  for (const file of outputs) await rm(file, { force: true });
  await rm(work, { recursive: true, force: true });
}
