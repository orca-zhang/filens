import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { request } from 'node:http';
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { createInterface } from 'node:readline';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from '@playwright/test';
import { checkPptxVisual, pptxVisualFixtures } from './preview-pptx-visual.mjs';
import { createShxDxf, testShxFont } from '../packages/cad/test/fixtures/shx.mjs';
import { createClockFormulaWorkbook } from '../packages/xlsx/test/fixtures/clock-formula-workbook.mjs';
import { createDateFormulaWorkbook } from '../packages/xlsx/test/fixtures/date-formula-workbook.mjs';
import { createLocaleDateWorkbook } from '../packages/xlsx/test/fixtures/locale-date-workbook.mjs';
import { createSystemDateFormatWorkbook } from '../packages/xlsx/test/fixtures/system-date-format-workbook.mjs';
import { createTextFormulaWorkbook } from '../packages/xlsx/test/fixtures/text-formula-workbook.mjs';
import { createStructuredReferenceWorkbook } from '../packages/xlsx/test/fixtures/structured-reference-workbook.mjs';
import { createModernNumbersArchive } from '../packages/iwork/test/fixtures/numbers-archive.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const binary = process.env.FILENS_AGENT_BINARY || path.join(root, 'dist/filens');
const assetRoot = process.env.FILENS_PREVIEW_TEST_DIR || path.join(root,'packages/preview/dist');
const modes = process.env.FILENS_PREVIEW_TEST_MODES?.split(',') ?? ['split', 'all-in-one'];
assert.ok(modes.length && modes.every(mode => ['split', 'all-in-one'].includes(mode)), 'Invalid preview test modes');
const reportPath = process.env.FILENS_PREVIEW_TEST_REPORT || 'docs/preview-validation.json';
const work = await mkdtemp(path.join(os.tmpdir(), 'filens-preview-'));
const browser = await chromium.launch({ headless: true });
const observations = [];
await writeFile(path.join(work, '中文 preview.txt'), 'FILENS_PREVIEW_2026\nLocal browser preview 中文');
const calendarFiles = [path.join(work, 'calendar-1900.xlsx'), path.join(work, 'calendar-1904.xlsx')];
const clockFiles = [path.join(work, 'clock-1900.xlsx'), path.join(work, 'clock-1904.xlsx')];
const regionalFiles = new Map([
  [path.join(work, 'regional-en-us.xlsx'), { locale: 'en-US', date: '2024-01-02' }],
  [path.join(work, 'regional-en-gb.xlsx'), { locale: 'en-GB', date: '2024-02-01' }]
]);
const systemFormatFiles = new Map([
  [path.join(work, 'system-formats-en-us.xlsx'), {
    locale: 'en-US', date: 'Thursday, February 29, 2024', time: '2:30:45 PM', last: 'Friday, December 31, 9999'
  }],
  [path.join(work, 'system-formats-en-gb.xlsx'), {
    locale: 'en-GB', date: 'Thursday, 29 February 2024', time: '14:30:45', last: 'Friday, 31 December 9999'
  }]
]);
const regionalWorkbook = await createLocaleDateWorkbook();
const systemFormatWorkbook = await createSystemDateFormatWorkbook();
const textFormulaFile = path.join(work, 'text-formulas.xlsx');
const structuredReferenceFile = path.join(work, 'structured-references.xlsx');
const modernNumbersFile = path.join(work, 'modern-values.numbers');
await Promise.all([
  ...calendarFiles.map(async (file, index) => writeFile(file, await createDateFormulaWorkbook(index === 1))),
  ...clockFiles.map(async (file, index) => writeFile(file, await createClockFormulaWorkbook(index === 1))),
  ...[...regionalFiles.keys()].map(file => writeFile(file, regionalWorkbook)),
  ...[...systemFormatFiles.keys()].map(file => writeFile(file, systemFormatWorkbook)),
  createTextFormulaWorkbook(true).then(bytes => writeFile(textFormulaFile, bytes)),
  createStructuredReferenceWorkbook().then(bytes => writeFile(structuredReferenceFile, bytes)),
  createModernNumbersArchive({ locale: 'fr_FR' }).then(bytes => writeFile(modernNumbersFile, bytes))
]);
const files = [
  path.join(work, '中文 preview.txt'),
  ...calendarFiles,
  ...clockFiles,
  ...regionalFiles.keys(),
  ...systemFormatFiles.keys(),
  textFormulaFile,
  structuredReferenceFile,
  path.join(root, 'apps/demo/public/samples/filens-aurora-guide.docx'),
  path.join(root, 'apps/demo/public/samples/filens-cosmic-atlas.pdf'),
  ...['filens-cafe-2000.dwg', 'filens-cafe-2018.dwg', 'field-notes.tiff']
    .map(name => path.join(root, 'apps/demo/public/samples/graphics', name)),
  ...['still-form.psd', 'after-hours.psb', 'forma-identity.ai', 'orbit-marks.eps', 'studio-editions.ps']
    .map(name => path.join(root, 'apps/demo/public/samples/design', name)),
  path.join(root, 'apps/demo/public/samples/a.pages'),
  path.join(root, 'apps/demo/public/samples/filens-weekend.key'),
  path.join(root, 'apps/demo/public/samples/filens-observatory.xlsx'),
  path.join(root, 'apps/demo/public/samples/rich-spreadsheet.ods'),
  path.join(root, 'apps/demo/public/samples/legacy-project-workflow.doc'),
  ...pptxVisualFixtures.map(name => path.join(root, 'apps/demo/public/samples', name)),
  path.join(root, 'apps/demo/public/samples/a.numbers'),
  modernNumbersFile,
  path.join(root, 'apps/demo/public/samples/raw/pentax-k-r.dng'),
  path.join(root, 'apps/demo/public/samples/showcase/milky-way-360.jpg'),
  path.join(root, 'apps/demo/public/samples/sample-nested-archives.zip')
];
// Also exercise the actual embedded STEP engine, rather than a mocked loader.
files.push(path.join(root, 'packages/model3d/test/fixtures/occt/cube.stp'));
for (const ext of ['apk', 'ipa', 'exe', 'dll', 'mui', 'mun', 'ico']) files.push(path.join(root, `examples/converter/fixtures/icons/sample.${ext}`));
for (const ext of ['docx', 'xlsx', 'pptx']) files.push(path.join(root, `packages/converter-client/test/fixtures/password/agile.${ext}`));
const localeFiles = await readdir(path.join(root, 'packages/vue/src/locales'));
const locales = await Promise.all(localeFiles.filter(name => name.endsWith('.json')).map(async name => ({ locale: name.slice(0, -5), fit: JSON.parse(await readFile(path.join(root, 'packages/vue/src/locales', name), 'utf8')).Fit })));

function serve(file, mode) {
  const child = spawn(binary, ['preview', file, '--mode', 'serve', '--assets', path.join(assetRoot, mode), '--no-open', '--json'], { cwd:root });
  let stderr = ''; child.stderr.on('data', bytes => { stderr += bytes; });
  const lines = createInterface({ input: child.stdout });
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => { child.kill(); reject(new Error(`preview startup timeout: ${stderr}`)); }, 10000);
    child.once('error', reject);
    child.once('exit', code => { clearTimeout(timer); reject(new Error(`preview exited ${code}: ${stderr}`)); });
    lines.once('line', line => {
      clearTimeout(timer);
      const response = JSON.parse(line);
      resolve({ url:response.url, async close() {
        if (child.exitCode !== null || child.signalCode !== null) return;
        const closed = new Promise(resolve => child.once('close', resolve)); child.kill('SIGTERM'); await closed;
      } });
    });
  });
}
function raw(url, target, headers = {}, method = 'GET') {
  const parsed = new URL(url);
  return new Promise((resolve, reject) => {
    const req = request({ hostname:parsed.hostname, port:parsed.port, path:target, method, agent:false,
      headers:{ Host:parsed.host, ...headers } }, response => {
      const bytes = []; response.on('data', data => bytes.push(data));
      response.on('end', () => resolve({ status:response.statusCode, headers:response.headers, body:Buffer.concat(bytes) }));
    }); req.on('error', error => reject(new Error(`${method} ${target} ${JSON.stringify(headers)}: ${error.message}`))); req.end();
  });
}
try {
  for (const args of [
    ['preview', path.join(work,'中文 preview.txt'),'--assets',path.join(work,'missing'),'--json'],
    ['preview',work,'--json'],
    ['preview','--json']
  ]) {
    const result = spawnSync(binary,args,{encoding:'utf8'});
    assert.equal(result.status,1,result.stderr);
    assert.equal(JSON.parse(result.stdout).error.code,'preview_failed');
  }
  for (const mode of modes) {
    for (const file of files) {
      await readFile(file);
      const server = await serve(file, mode);
      const hasClock = clockFiles.includes(file);
      const regional = regionalFiles.get(file);
      const systemFormat = systemFormatFiles.get(file);
      const page = await browser.newPage({
        locale: regional?.locale ?? systemFormat?.locale, timezoneId: hasClock ? 'America/New_York' : undefined
      });
      if (hasClock) await page.clock.setFixedTime(new Date('2024-01-02T04:59:50Z'));
      const requests = [], errors = [];
      page.on('pageerror', error => errors.push(error.message));
      page.on('requestfailed', request => {
        if (request.failure()?.errorText !== 'net::ERR_ABORTED') errors.push(`${request.url()}: ${request.failure()?.errorText}`);
      });
      page.on('response', response => { if (response.status() >= 400) errors.push(`${response.status()} ${response.url()}`); });
      await page.route('**/*', route => {
        const url = route.request().url();
        if (!url.startsWith(new URL(server.url).origin) && !url.startsWith('blob:') && !url.startsWith('data:')) {
          errors.push(`External dependency: ${url}`); return route.abort();
        }
        requests.push(url); return route.continue();
      });
      try {
        await page.goto(server.url);
        const encrypted = path.basename(file).startsWith('agile.');
        if (encrypted) {
          const field = page.locator('input[type=password]');
          await field.waitFor();
          assert.equal(requests.filter(url => url.includes('converter-office.wasm')).length, 0);
          await field.fill('wrong');
          await field.press('Enter');
          await page.getByRole('alert').waitFor();
          await field.fill(' filens 密码🔐 ');
          await field.press('Enter');
          await field.waitFor({ state: 'detached' });
          await page.waitForFunction(() => /Fixture (DOCX document|XLSX workbook|PPTX presentation slide)/.test(document.body.innerText));
        }
        await page.waitForFunction(() => ['ready', 'error'].includes(document.body.dataset.state), null, {timeout:30000}).catch(async error => {
          throw new Error(`${mode} ${file}: ${error.message}; errors=${JSON.stringify(errors)}; requests=${JSON.stringify(requests)}; body=${await page.locator('body').innerText()}`);
        });
        const state = await page.evaluate(() => ({state:document.body.dataset.state,error:document.body.dataset.error,text:document.body.innerText,canvases:document.querySelectorAll('canvas').length}));
        assert.equal(state.state, 'ready', `${mode}: ${file}: ${JSON.stringify(state)}; ${errors}`);
        if (mode === 'split') assert.equal(requests.filter(url => url.includes('converter-office.wasm')).length, encrypted ? 1 : 0);
        if (encrypted) assert.match(state.text, /Fixture (DOCX document|XLSX workbook|PPTX presentation slide)/);
        if (/\.(apk|ipa)$/.test(file)) {
          // Mobile app packages expose their ZIP contents in the current UI.
          const entry = page.locator('tr.archivev-row').filter({ hasText: file.endsWith('.apk') ? 'AndroidManifest.xml' : 'Payload/' });
          await entry.waitFor();
        } else if (path.dirname(file) === path.join(root, 'examples/converter/fixtures/icons')) {
          const icon = page.locator('img.pptxv-native-image');
          await icon.waitFor();
          assert.equal(await icon.evaluate(img => img.naturalWidth), 1, `${mode}: ${file}`);
        }
        if (file.endsWith('.txt')) assert.match(state.text, /FILENS_PREVIEW_2026/);
        if (file.endsWith('.dwg')) {
          await page.locator('.cadv-preview svg').getByText('FIELD NOTES / CAFE', { exact: true }).waitFor();
          if (mode === 'split') {
            assert.equal(requests.filter(url => url.includes('converter-cad.wasm')).length, 1);
            assert.equal(requests.filter(url => /converter-(raster|graphics|core)\.wasm/.test(url)).length, 0);
          }
        }
        if (file.endsWith('.tiff') && mode === 'split') {
          assert.equal(requests.filter(url => url.includes('converter-raster.wasm')).length, 1);
          assert.equal(requests.filter(url => /converter-(cad|graphics|core)\.wasm/.test(url)).length, 0);
        }
        if (calendarFiles.includes(file)) {
          const grid = page.locator('.xlsxv-grid');
          await grid.getByText('2024-03-31', { exact: true }).waitFor();
          const epoch = calendarFiles[1] === file ? '0' : '1462';
          assert.equal(await grid.locator('tr[aria-rowindex="3"] td[aria-colindex="2"]').textContent(), epoch);
          assert.equal(await grid.locator('tr[aria-rowindex="4"] td[aria-colindex="2"]').textContent(), '3');
          await grid.evaluate(grid => { grid.scrollTop = grid.scrollHeight; grid.scrollLeft = grid.scrollWidth; });
          await grid.getByText('2025-02-28 23:59:59', { exact: true }).waitFor();
          assert.equal(await grid.locator('tr[aria-rowindex="1048577"] td[aria-colindex="16384"]').textContent(), '2024-03-05');
        }
        if (hasClock) {
          const grid = page.locator('.xlsxv-grid');
          const time = grid.locator('tr[aria-rowindex="1048577"] td[aria-colindex="16385"]');
          await grid.evaluate(grid => { grid.scrollTop = grid.scrollHeight; grid.scrollLeft = grid.scrollWidth; });
          await time.filter({ hasText: /^2024-01-01 23:59:50$/ }).waitFor();
          await page.clock.setFixedTime(new Date('2024-01-02T05:01:00Z'));
          await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
          await time.filter({ hasText: /^2024-01-02 00:01:00$/ }).waitFor();
        }
        if (regional) {
          const grid = page.locator('.xlsxv-grid');
          assert.equal(await grid.locator('tr[aria-rowindex="2"] td[aria-colindex="2"]').textContent(), regional.date);
          assert.equal(await grid.locator('tr[aria-rowindex="2"] td[aria-colindex="3"]').textContent(), '16:30:00');
          await grid.evaluate(grid => { grid.scrollTop = grid.scrollHeight; grid.scrollLeft = grid.scrollWidth; });
          const date = grid.locator('tr[aria-rowindex="1048577"] td[aria-colindex="16385"]');
          await date.waitFor();
          assert.equal(await date.textContent(), regional.date);
        }
        if (systemFormat) {
          const grid = page.locator('.xlsxv-grid');
          const clock = await grid.locator('tr[aria-rowindex="2"] td[aria-colindex="3"]').textContent();
          assert.equal(clock.replace(/\s+/g, ' '), systemFormat.time);
          assert.equal(await grid.locator('tr[aria-rowindex="2"] td[aria-colindex="4"]').textContent(), systemFormat.date);
          await grid.evaluate(grid => { grid.scrollTop = grid.scrollHeight; grid.scrollLeft = grid.scrollWidth; });
          const last = grid.locator('tr[aria-rowindex="1048577"] td[aria-colindex="16385"]');
          await last.waitFor();
          assert.equal(await last.textContent(), systemFormat.last);
        }
        if (file === structuredReferenceFile) {
          const grid = page.locator('.xlsxv-grid');
          const first = grid.locator('tr[aria-rowindex="2"]');
          assert.equal(await first.locator('td[aria-colindex="2"]').textContent(), '44');
          assert.equal(await first.locator('td[aria-colindex="3"]').textContent(), '32');
          assert.equal(await first.locator('td[aria-colindex="4"]').textContent(), '5');
          await grid.evaluate(grid => { grid.scrollTop = grid.scrollHeight; grid.scrollLeft = grid.scrollWidth; });
          const last = grid.locator('tr[aria-rowindex="1048577"] td[aria-colindex="16385"]');
          await last.waitFor();
          assert.equal(await last.textContent(), '76');
        }
        if (file === textFormulaFile) {
          const grid = page.locator('.xlsxv-grid');
          await grid.getByText('February 29, 2024', { exact: true }).waitFor();
          await grid.getByText('a/b:c/d', { exact: true }).waitFor();
          assert.equal(await grid.locator('tr[aria-rowindex="3"] td[aria-colindex="6"]').textContent(), '4  17/50 ');
          await grid.evaluate(grid => { grid.scrollTop = grid.scrollHeight; grid.scrollLeft = grid.scrollWidth; });
          const last = grid.locator('tr[aria-rowindex="1048577"] td[aria-colindex="16385"]');
          await last.waitFor();
          assert.equal(await last.textContent(), 'North | South | Far | 12.50% | Deep');
        }
        if (file === modernNumbersFile) {
          const grid = page.locator('.xlsxv-grid');
          await grid.getByText('-12,50 %', { exact: true }).waitFor();
          await grid.getByText('1999-12-31 23:59:59', { exact: true }).waitFor();
          await grid.getByText('01:01,001', { exact: true }).waitFor();
          await grid.getByText('3 16/113', { exact: true }).waitFor();
          await grid.getByText('FFFFFF01', { exact: true }).waitFor();
          await grid.getByText('12,35 %', { exact: true }).first().waitFor();
          await grid.getByText(/jeudi, 29 février 2024/).waitFor();
          await grid.getByText('1372023', { exact: true }).waitFor();
          await grid.getByText('Ref 007%: 1 234,56', { exact: true }).waitFor();
          await grid.getByText('Tag [A&B]', { exact: true }).waitFor();
          await grid.getByText('CHF 42,45 paid', { exact: true }).waitFor();
          await grid.evaluate(grid => { grid.scrollTop = grid.scrollHeight; grid.scrollLeft = grid.scrollWidth; });
          await grid.locator('tr[aria-rowindex="100001"] td[aria-colindex="2044"]')
            .getByText('Zero or below 1 234,56', { exact: true }).waitFor();
          await grid.getByText('Epoch 2001/01/01 24:00 0', { exact: true }).waitFor();
          await grid.getByText('1.00E+01', { exact: true }).waitFor();
          await grid.getByText('1 jour 1 heure', { exact: true }).waitFor();
          const last = grid.locator('tr[aria-rowindex="100001"] td[aria-colindex="2049"]');
          await last.waitFor();
          assert.equal(await last.textContent(), '42,50\u00a0€');
          const accounting = grid.locator('tr[aria-rowindex="100001"] td[aria-colindex="2046"] .iworkv-accounting');
          await accounting.waitFor();
          assert.equal((await accounting.textContent()).replace(/\s/g, ' '), '(1 234,56) $US');
        }
        if (file.endsWith('.ods')) {
          assert.match(state.text, /Test spreadsheet/);
          assert.match(state.text, /2nd row 2nd column/);
          await page.locator('.xlsxv-sheet-tab').filter({ hasText:'Sheet Number 2' }).click();
          await page.locator('.xlsxv-grid').getByText('13', { exact:true }).waitFor();
          assert.equal(await page.locator('.xlsxv-sheet-tab').count(), 3);
        }
        const visual = await checkPptxVisual(page, path.basename(file));
        if (mode === 'all-in-one') {
          assert.equal(requests.filter(url => /\.(js|mjs|wasm)(?:\?|$)/.test(url)).length, 1, requests.join('\n'));
        }
        observations.push({ mode, file:path.basename(file), state:state.state, canvases:state.canvases,
          runtimeRequests:requests.filter(url => /\.(js|mjs|wasm)(?:\?|$)/.test(url)).length, visual });
        if (file.endsWith('.txt')) {
          await page.evaluate(async locales => {
            const { createPreview } = await import(new URL('./filens.js', location.href).href);
            const host = document.createElement('div'); host.style.height='500px'; document.body.append(host);
            let rendered;
            const initial = new Promise(resolve => { rendered = resolve; });
            const viewer = createPreview(host, { src:new File(['FIRST_SOURCE'], 'first.txt'), name:'first.txt', onRendered:() => rendered() });
            await initial;
            const changed = new Promise(resolve => { rendered = resolve; });
            viewer.update({ src:new File(['SECOND_SOURCE'], 'second.txt'), name:'second.txt' });
            await changed;
            if (!host.textContent.includes('SECOND_SOURCE') || host.textContent.includes('FIRST_SOURCE')) throw new Error('Source update did not replace the preview');
            for (const { locale, fit } of locales) {
              viewer.update({ locale });
              await new Promise(resolve => requestAnimationFrame(resolve));
              if (!host.querySelector('.pptxv-toolbar').textContent.includes(fit)) throw new Error(`Missing toolbar translation: ${locale}`);
              if (!host.textContent.includes('SECOND_SOURCE')) throw new Error('Locale update replaced the source');
            }
            viewer.update({ messages: { Next: 'HOST_NEXT' } });
            await new Promise(resolve => requestAnimationFrame(resolve));
            if (!host.querySelector('.pptxv-toolbar').textContent.includes('HOST_NEXT')) throw new Error('Host translation override was ignored');
            viewer.destroy();
            if (host.children.length) throw new Error('Preview was not unmounted');
            host.remove();
          }, locales);
          const prefix = new URL(server.url).pathname.replace('index.html', '');
          const source = (await raw(server.url, `${prefix}input.txt`));
          assert.equal(source.status, 200);
          const ranged = await raw(server.url, `${prefix}input.txt`, {Range:'bytes=0-5'});
          assert.equal(ranged.status,206); assert.equal(ranged.body.toString(), source.body.subarray(0,6).toString());
          assert.equal((await raw(server.url, `${prefix}input.txt`, {Range:'bytes=999999-'})).status,416);
          assert.equal((await raw(server.url, `${prefix}input.txt`, {}, 'HEAD')).body.length,0);
          for (const target of ['/source.json', `${prefix}../LICENSE`, `${prefix}%2e%2e/LICENSE`, `${prefix}source.json/../input.txt`]) {
            assert.equal((await raw(server.url,target)).status,404,target);
          }
          assert.equal((await raw(server.url, `${prefix}source.json`, {Host:'example.com'})).status,403);
          assert.equal((await raw(server.url, `${prefix}source.json`, {Origin:'https://example.com'})).status,403);
          assert.equal((await raw(server.url, `${prefix}source.json`, {'Sec-Fetch-Site':'cross-site'})).status,403);
          assert.equal((await raw(server.url, `${prefix}source.json`, {}, 'POST')).status,405);
          await page.locator('#file').setInputFiles([
            { name: 'stroke.shx', mimeType: 'application/octet-stream', buffer: Buffer.from(testShxFont) },
            { name: 'drawing.dxf', mimeType: 'application/dxf', buffer: Buffer.from(createShxDxf()) }
          ]);
          const shxPath = page.locator('svg.cadv-canvas path[data-shx-text][aria-label="AA"]');
          await shxPath.waitFor();
          assert.match(await shxPath.getAttribute('d'), /^M.+L/);
          assert.ok(!requests.some(url => url.endsWith('.shx')));
        }
        assert.deepEqual(errors, [], `${mode}: ${file}`);
        console.log(`${mode}: ${path.basename(file)} rendered (${observations.at(-1).runtimeRequests} runtime requests)`);
      } finally { await page.close(); await server.close(); }
    }
  }
  await writeFile(path.resolve(root, reportPath), `${JSON.stringify({
    date:new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Shanghai'}).format(new Date()),
    platform:`${process.platform}-${process.arch}`, browser:await browser.version(),
    scope:'Actual CLI loopback server and real shared engines. External network requests blocked. Render readiness, source text, and the listed PPTX visual properties are checked. Encrypted DOCX/XLSX/PPTX tested with wrong and correct passwords; split Office module loaded only after password submission and reused on retry.',
    localeChecks:locales.map(({ locale }) => locale),
    localeChecksScope:`${modes.join(', ')}: switch all 28 toolbar languages without reloading the source, then verify an instance message override.`,
    httpChecks:['GET','HEAD','byte ranges','invalid ranges','unscoped paths','directory traversal','Host','Origin','Sec-Fetch-Site','unsupported method'],
    cadShxChecks: modes.map(mode => `${mode}: local DXF and SHX upload with no font request`),
    observations
  },null,2)}\n`);
  console.log(`${observations.length} real preview checks passed; saved ${reportPath}`);
} finally { await browser.close(); await rm(work,{recursive:true,force:true}); }
