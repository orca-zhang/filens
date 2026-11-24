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
// Media's existing generic typed arrays need TS 5.7; older compilers check XLSX.
const compatibilityCompilers = [
  { version: '5.0.4', file: 'xlsx.mts' },
  { version: '5.4.5', file: 'xlsx.mts' },
  { version: '5.7.3', file: 'index.mts' },
  { version: '5.8.3', file: 'index.mts' }
];
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
  const npm = npmInvocation(['install', '--ignore-scripts', '--no-audit', '--no-fund',
    ...release.packages.map(pkg => registry ? `${pkg.name}@${pkg.version}` : path.join(root, 'dist/workspace-npm', pkg.file)),
    ...compatibilityCompilers.map(({ version }) => `typescript-${version}@npm:typescript@${version}`)]);
  run(npm.command, npm.args);
  const typeImports = [];
  for (const pkg of release.packages) {
    const metadata = JSON.parse(await readFile(path.join(work, 'node_modules', pkg.name, 'package.json'), 'utf8'));
    assert.equal(metadata.version, pkg.version); assert.equal(metadata.license, 'MIT');
    for (const [subpath, entry] of Object.entries(metadata.exports)) {
      if (entry.types) typeImports.push(`import type * as Module${typeImports.length} from '${pkg.name}${subpath.slice(1)}';`);
    }
  }
  await writeFile(path.join(work, 'xlsx.mts'), `
    import { createXlsxPreviewDriver, createSheetTable as rootTable, loadXlsxWorkbook } from '@filens/xlsx';
    import type { ParsedWorkbook, ParsedSheet } from '@filens/xlsx';
    import { createSheetTable } from '@filens/xlsx/table';
    import type { ParsedSheet as TableSheet } from '@filens/xlsx/table';
    import { createXlsxPreviewRoutes } from '@filens/xlsx/routes';
    import type { PreviewDriver, WorkbookPreviewState } from '@filens/core';
    import type { PreviewDriver as RuntimeDriver } from '@filens/core/preview-runtime';
    type IsAny<T> = 0 extends (1 & T) ? true : false;
    type AssertTyped<T extends false> = T;
    type Session = ReturnType<ReturnType<typeof createXlsxPreviewDriver>['createSession']>;
    export type WorkbookIsTyped = AssertTyped<IsAny<ParsedWorkbook>>;
    export type SheetIsTyped = AssertTyped<IsAny<ParsedSheet>>;
    export type CellIsTyped = AssertTyped<IsAny<ParsedSheet['rows'][number]['cells'][number]>>;
    export type FactoryIsTyped = AssertTyped<IsAny<typeof createXlsxPreviewDriver>>;
    export type DriverIsTyped = AssertTyped<IsAny<ReturnType<typeof createXlsxPreviewDriver>>>;
    export type SessionIsTyped = AssertTyped<IsAny<Session>>;
    export type StateIsTyped = AssertTyped<IsAny<ReturnType<Session['getState']>>>;
    export type ParserResultIsTyped = AssertTyped<IsAny<Awaited<ReturnType<typeof loadXlsxWorkbook>>>>;
    export type TableSheetIsTyped = AssertTyped<IsAny<Parameters<typeof createSheetTable>[0]>>;
    export type TableResultIsTyped = AssertTyped<IsAny<ReturnType<typeof createSheetTable>>>;
    export type RouteIsTyped = AssertTyped<IsAny<ReturnType<typeof createXlsxPreviewRoutes>[number]>>;
    export const sheet: ParsedSheet = { id: '1', name: 'Sheet1', rows: [], columnCount: 1, rowCount: 1 };
    export const sameSheet: TableSheet = sheet;
    export const driver: PreviewDriver<WorkbookPreviewState> = createXlsxPreviewDriver();
    export const runtimeDriver: RuntimeDriver<WorkbookPreviewState> = driver;
    export const tableFromRoot: typeof createSheetTable = rootTable;
    export const tableFromSubpath: typeof rootTable = createSheetTable;
    export const table: HTMLTableElement = createSheetTable(sheet, 1);
    export const firstSheet = (workbook: ParsedWorkbook): ParsedSheet | undefined => workbook.sheets[0];
    // @ts-expect-error The driver factory must retain its function type, never any.
    export const probe: symbol = createXlsxPreviewDriver;
    // @ts-expect-error The table subpath must retain its sheet parameter type.
    createSheetTable({});
    // @ts-expect-error Row counts remain numbers.
    createSheetTable(sheet, '1');
    // @ts-expect-error Sheet properties must retain their types.
    export const invalidCount: string = sheet.rowCount;
    // @ts-expect-error Route factories take route arrays, never format strings.
    createXlsxPreviewRoutes('xlsx');
  `);
  await writeFile(path.join(work, 'index.mts'), `${typeImports.join('\n')}
    import './xlsx.mjs';
    import { Preview, createVueDefaultPreviewDrivers, createVueDefaultPreviewRoutes } from '@filens/vue';
    type IsAny<T> = 0 extends (1 & T) ? true : false;
    type AssertTyped<T extends false> = T;
    export type ComponentIsTyped = AssertTyped<IsAny<typeof Preview>>;
    export type PropsAreTyped = AssertTyped<IsAny<InstanceType<typeof Preview>['$props']>>;
    export type VueDriverIsTyped = AssertTyped<IsAny<ReturnType<typeof createVueDefaultPreviewDrivers>[number]>>;
    export type VueRouteIsTyped = AssertTyped<IsAny<ReturnType<typeof createVueDefaultPreviewRoutes>[number]>>;
    // @ts-expect-error Public Vue helpers must retain their options type.
    createVueDefaultPreviewRoutes('xlsx');
  `);
  const compilers = [
    { version: JSON.parse(await readFile(path.join(root, 'node_modules/typescript/package.json'), 'utf8')).version,
      file: 'index.mts', binary: path.join(root, 'node_modules/typescript/bin/tsc') },
    ...compatibilityCompilers.map(compiler => ({ ...compiler, binary: path.join(work, `node_modules/typescript-${compiler.version}/bin/tsc`) }))
  ];
  for (const compiler of compilers) {
    for (const [module, moduleResolution] of [['ESNext', 'Bundler'], ['Node16', 'Node16'], ['NodeNext', 'NodeNext']]) {
      for (const skipLibCheck of [false, true]) {
        await writeFile(path.join(work, 'tsconfig.json'), JSON.stringify({ compilerOptions: {
          target: 'ES2022', module, moduleResolution, lib: ['ES2022', 'DOM', 'DOM.Iterable'],
          strict: true, noEmit: true, types: [], skipLibCheck
        }, files: [compiler.file] }));
        run(process.execPath, [compiler.binary, '-p', 'tsconfig.json']);
        console.log(`Public declarations: TS ${compiler.version}, ${compiler.file}, ${moduleResolution}, skipLibCheck ${skipLibCheck}`);
      }
    }
  }
  await writeFile(path.join(work, 'repro.mts'), `
    import { ParsedWorkbook, ParsedSheet, createXlsxPreviewDriver } from '@filens/xlsx';
    export const probe: symbol = createXlsxPreviewDriver;
  `);
  for (const mode of ['Node16', 'NodeNext']) {
    for (const skipLibCheck of [false, true]) {
      await writeFile(path.join(work, 'tsconfig.json'), JSON.stringify({ compilerOptions: {
        module: mode, moduleResolution: mode, strict: true, noEmit: true, types: [], skipLibCheck,
        lib: ['ES2022', 'DOM', 'DOM.Iterable']
      }, files: ['repro.mts'] }));
      const result = spawnSync(process.execPath, [compilers[0].binary, '-p', 'tsconfig.json'], { cwd: work, env, encoding: 'utf8', timeout: 60000 });
      if (result.error) throw result.error;
      assert.equal(result.status, 2, result.stderr);
      assert.deepEqual([...result.stdout.matchAll(/error TS(\d+):/g)].map(match => Number(match[1])), [2322], result.stdout);
      assert.match(result.stdout, /PreviewDriver<WorkbookPreviewState>/);
      console.log(`Original issue repro: ${mode}, skipLibCheck ${skipLibCheck}, expected TS2322 only`);
    }
  }
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
    typescript: compilers.map(({ version, file }) => ({ version, scope: file === 'xlsx.mts' ? 'xlsx' : 'all packages' })),
    checks: [`All ${release.packages.length} modules installed with MIT licenses`, 'All typed exports under Bundler, Node16 and NodeNext, skipLibCheck false and true',
      'TypeScript 5.0/5.4 XLSX compatibility and TypeScript 5.7/5.8/current full package compatibility',
      'XLSX parser, driver, session, state, cells, table and routes retain types; Vue component, props and helpers retain types',
      'Root/subpath types remain assignable; invalid inputs rejected; original issue produces TS2322 only',
      'Production Vite build of public Vue component and text/books dependencies', 'EPUB and CBZ rendered in Chromium with external requests blocked'] }, null, 2) + '\n');
  console.log(`All ${release.packages.length} modules from ${registry ? 'the public registry' : 'staged tarballs'} passed installation, types and production browser consumer checks.`);
} finally {
  await browser?.close();
  if (server) await new Promise(resolve => server.httpServer.close(resolve));
  await rm(work, { recursive: true, force: true });
}
