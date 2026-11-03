// Validate modular tarballs or the public registry from an isolated consumer.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { build, preview } from 'vite';
import { chromium } from '@playwright/test';
import JSZip from 'jszip';
import { npmInvocation } from './agent-platforms.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
process.chdir(root);
const registry = process.argv.includes('--registry');
const release = JSON.parse(await readFile('dist/workspace-npm/release.json', 'utf8'));
const work = await realpath(await mkdtemp(path.join(os.tmpdir(), 'filens-modules-public-')));
const env = { ...process.env, npm_config_registry: 'https://registry.npmjs.org/',
  npm_config_userconfig: path.join(work, '.npmrc'), npm_config_cache: path.join(work, 'npm-cache') };
const run = (command, args) => {
  const result = spawnSync(command, args, { cwd: work, env, stdio: 'inherit', timeout: 180000 });
  if (result.error) throw result.error;
  assert.equal(result.status, 0, `${command} exited ${result.status}`);
};
let browser, server;
try {
  await writeFile(path.join(work, 'package.json'), JSON.stringify({ name: 'filens-modules-consumer', private: true, type: 'module' }));
  const npm = npmInvocation(['install', '--ignore-scripts', '--no-audit', '--no-fund', ...release.packages.map(pkg => registry ? `${pkg.name}@${pkg.version}` : path.join(root, 'dist/workspace-npm', pkg.file))]);
  run(npm.command, npm.args);
  for (const pkg of release.packages) {
    const metadata = JSON.parse(await readFile(path.join(work, 'node_modules', pkg.name, 'package.json'), 'utf8'));
    assert.equal(metadata.version, pkg.version); assert.equal(metadata.license, 'MIT');
  }
  await writeFile(path.join(work, 'index.ts'), release.packages.map((pkg, index) => `import type * as Module${index} from '${pkg.name}';`).join('\n'));
  await writeFile(path.join(work, 'tsconfig.json'), JSON.stringify({ compilerOptions: {
    target: 'ES2022', module: 'ESNext', moduleResolution: 'Bundler', lib: ['ES2022', 'DOM', 'DOM.Iterable'],
    strict: true, noEmit: true, types: [], skipLibCheck: false
  }, include: ['index.ts'] }));
  run(process.execPath, [path.join(root, 'node_modules/typescript/bin/tsc'), '-p', 'tsconfig.json']);
  await writeFile(path.join(work, 'index.html'), '<html><style>html,body,#host{height:100%;margin:0}</style><input id="file" type="file"><div id="host"></div><script type="module" src="/main.js"></script></html>');
  await writeFile(path.join(work, 'main.js'), `
    import {createApp,h} from 'vue';
    import {Preview} from '@filens/vue';
    import {createTextPreviewDrivers} from '@filens/text';
    import '@filens/vue/style.css';
    if (!createTextPreviewDrivers().some(driver => driver.supports('epub') && driver.supports('cbz'))) throw new Error('Missing books driver');
    let app;
    document.querySelector('#file').onchange = event => {
      const file=event.target.files[0]; app?.unmount(); document.body.dataset.state='loading';
      app=createApp({render:()=>h(Preview,{src:file,name:file.name,
        onRendered:state=>{window.result=state;document.body.dataset.state='ready'},
        onError:error=>{document.body.dataset.state='error';document.body.dataset.error=error.message}})});
      app.mount('#host');
    };
  `);
  await build({ root: work, configFile: false, logLevel: 'warn' });
  server = await preview({ root: work, configFile: false, logLevel: 'error', preview: { host: '127.0.0.1', port: 0 } });
  const origin = server.resolvedUrls.local[0];
  browser = await chromium.launch({ headless: true });
  const page = await browser.newPage(); const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.route('**/*', route => route.request().url().startsWith(origin) ? route.continue() : route.abort());
  await page.goto(origin);
  const zip = new JSZip();
  zip.file('page-1.png', Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aX1sAAAAASUVORK5CYII=', 'base64'));
  const fixtures = [
    { name: 'pepper-carrot.epub', mimeType: 'application/epub+zip', buffer: await readFile('apps/demo/public/samples/pepper-carrot.epub') },
    { name: 'comic.cbz', mimeType: 'application/vnd.comicbook+zip', buffer: await zip.generateAsync({ type: 'nodebuffer' }) }
  ];
  for (const fixture of fixtures) {
    await page.locator('#file').setInputFiles(fixture);
    await page.waitForFunction(() => ['ready', 'error'].includes(document.body.dataset.state), null, { timeout: 30000 });
    const result = await page.evaluate(() => ({ state: document.body.dataset.state, error: document.body.dataset.error, family: window.result?.family }));
    assert.equal(result.state, 'ready', JSON.stringify(result)); assert.equal(result.family, 'ebook');
    await page.locator('.ebookv-frame').waitFor();
    console.log(`${fixture.name}: rendered through isolated @filens/vue -> @filens/text -> @filens/books`);
  }
  assert.deepEqual(errors, []);
  await writeFile(registry ? 'docs/module-npm-registry-validation.json' : 'docs/module-npm-validation.json', JSON.stringify({ observedAt: new Date().toISOString(),
    command: `node scripts/test-workspace-npm.mjs${registry ? ' --registry' : ''}`,
    source: registry ? 'public npm registry with fresh cache; isolated consumer without workspace links' : 'staged tarballs with isolated consumer and fresh npm cache',
    packages: release.packages.map(pkg => ({ name: pkg.name, version: pkg.version })), passed: true,
    checks: [`All ${release.packages.length} modules installed with MIT licenses`, 'Strict public declarations, skipLibCheck false',
      'Production Vite build of public Vue component and text/books dependencies', 'EPUB and CBZ rendered in Chromium with external requests blocked'] }, null, 2) + '\n');
  console.log(`All ${release.packages.length} modules from ${registry ? 'the public registry' : 'staged tarballs'} passed installation, types and production browser consumer checks.`);
} finally {
  await browser?.close();
  if (server) await new Promise(resolve => server.httpServer.close(resolve));
  await rm(work, { recursive: true, force: true });
}
