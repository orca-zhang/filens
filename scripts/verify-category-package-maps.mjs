// Compare actual npm tarballs; never publishes or installs a package.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { cp, mkdir, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { createServer } from 'vite';
import { chromium } from '@playwright/test';

const option = (name, fallback) => {
  const index = process.argv.indexOf(name);
  if (index < 0) return fallback;
  assert(process.argv[index + 1] && !process.argv[index + 1].startsWith('--'));
  return process.argv[index + 1];
};
const baseline = option('--baseline', 'tmp/viewport-fonts-baseline');
const work = option('--work', 'tmp/category-package-maps');
const output = option('--output', `${work}/results.json`);
const controlOnly = process.argv.includes('--control-only');
const selected = new Set(option('--packages', '').split(',').filter(Boolean));
const sources = JSON.parse(await readFile(path.join(baseline, 'sources.json'), 'utf8')).files;
const names = Object.keys(sources).filter(file => /^packages\/[^/]+\/package\.json$/.test(file)).map(file => file.split('/')[1]).filter(name => !selected.size || selected.has(name)).sort();
assert(names.length > 0);
await mkdir(work, { recursive: true });
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const result = { date: new Date().toISOString(), node: process.version,
  baselineKind: controlOnly ? 'same-current-dist' : 'saved-historical-dist',
  method: 'Actual npm pack --ignore-scripts tarballs. The mapInclusionControl uses exactly the same rebuilt current dist, README/license/vendor files and metadata, except the files allowlist includes maps. Compare this control with current to attribute packaging savings. Saved pre-change dist is retained as historical baseline only: it contains earlier ZIP-worker and Vue archive CSS differences. No publishing. Public export targets and declaration references resolve in extracted tarballs; browser runtime exports and format routes compared with saved baseline builds.',
  packages: {}, totals: { baseline: { packedBytes: 0, unpackedBytes: 0, maps: 0, mapBytes: 0 }, current: { packedBytes: 0, unpackedBytes: 0, maps: 0, mapBytes: 0 }, mapInclusionControl: { packedBytes: 0, unpackedBytes: 0, maps: 0, mapBytes: 0 } }, errors: [] };
for (const name of names) {
  const record = result.packages[name] = {};
  for (const engine of ['baseline', 'current']) {
    const stage = path.join(work, 'stage', engine, name);
    await rm(stage, { recursive: true, force: true });
    await mkdir(stage, { recursive: true });
    const metadataText = engine === 'baseline' ? sources[`packages/${name}/package.json`] : await readFile(`packages/${name}/package.json`, 'utf8');
    const metadata = JSON.parse(metadataText);
    await writeFile(path.join(stage, 'package.json'), metadataText);
    await cp(engine === 'baseline' && !controlOnly ? path.join(baseline, `${name}-dist`) : `packages/${name}/dist`, path.join(stage, 'dist'), { recursive: true });
    for (const entry of await readdir(`packages/${name}`)) {
      if (/^(?:readme|licen[sc]e|copying|notice|third-party)/i.test(entry) || metadata.files?.includes(entry) && entry !== 'dist') {
        await cp(`packages/${name}/${entry}`, path.join(stage, entry), { recursive: true });
      }
    }
    const destination = path.resolve(work, 'tarballs', engine);
    await mkdir(destination, { recursive: true });
    const [pack] = JSON.parse(execFileSync(process.platform === 'win32' ? 'npm.cmd' : 'npm',
      ['pack', '--ignore-scripts', '--workspaces=false', '--json', '--pack-destination', destination],
      { cwd: stage, encoding: 'utf8', maxBuffer: 8 * 1024 * 1024 }));
    const maps = pack.files.filter(file => file.path.endsWith('.map'));
    const totals = { packedBytes: pack.size, unpackedBytes: pack.unpackedSize, maps: maps.length, mapBytes: maps.reduce((sum, file) => sum + file.size, 0) };
    for (const key of Object.keys(totals)) result.totals[engine][key] += totals[key];
    const tarball = path.join(destination, pack.filename);
    record[engine] = { ...totals, name: pack.name, filename: pack.filename, tarballSha256: sha(await readFile(tarball)),
      files: pack.files.map(file => ({ path: file.path, size: file.size })) };
    if (engine === 'current') {
      assert.equal(maps.length, 0, `${name}: published source maps`);
      const control = { ...metadata, files: JSON.parse(sources[`packages/${name}/package.json`]).files };
      const controlDestination = path.resolve(work, 'tarballs', 'map-inclusion-control');
      await mkdir(controlDestination, { recursive: true });
      let controlled;
      try {
        await writeFile(path.join(stage, 'package.json'), JSON.stringify(control, null, 2) + '\n');
        [controlled] = JSON.parse(execFileSync(process.platform === 'win32' ? 'npm.cmd' : 'npm',
          ['pack', '--ignore-scripts', '--workspaces=false', '--json', '--pack-destination', controlDestination],
          { cwd: stage, encoding: 'utf8', maxBuffer: 8 * 1024 * 1024 }));
      } finally { await writeFile(path.join(stage, 'package.json'), metadataText); }
      const controlledMaps = controlled.files.filter(file => file.path.endsWith('.map'));
      const payload = files => files.filter(file => !file.path.endsWith('.map') && file.path !== 'package.json');
      assert.deepEqual(payload(controlled.files), payload(pack.files), `${name}: controlled non-map payload changed`);
      const controlledTotals = { packedBytes: controlled.size, unpackedBytes: controlled.unpackedSize,
        maps: controlledMaps.length, mapBytes: controlledMaps.reduce((sum, file) => sum + file.size, 0) };
      for (const key of Object.keys(controlledTotals)) result.totals.mapInclusionControl[key] += controlledTotals[key];
      record.mapInclusionControl = { ...controlledTotals, tarballSha256: sha(await readFile(path.join(controlDestination, controlled.filename))) };
      const unpack = path.resolve(work, 'unpacked', name);
      await rm(unpack, { recursive: true, force: true });
      await mkdir(unpack, { recursive: true });
      execFileSync('tar', ['-xzf', tarball, '-C', unpack]);
      const root = path.join(unpack, 'package');
      const checkExport = async value => {
        if (typeof value === 'string') assert((await stat(path.join(root, value))).isFile(), `${name}: missing ${value}`);
        else if (value && typeof value === 'object') for (const nested of Object.values(value)) await checkExport(nested);
      };
      await checkExport(metadata.exports);
      for (const key of ['main', 'module', 'types']) if (metadata[key]) await checkExport(metadata[key]);
      let declarationReferences = 0;
      for (const file of pack.files.filter(file => /\.(?:m?js|[cm]?ts)$/.test(file.path))) {
        const text = await readFile(path.join(root, file.path), 'utf8');
        assert(!/sourceMappingURL=/.test(text), `${name}/${file.path}: dangling map URL`);
        if (/\.d\.[cm]?ts$/.test(file.path)) for (const match of text.matchAll(/(?:from\s*|import\s*\()\s*['"]([.][^'"]+)['"]/g)) {
          const reference = path.resolve(root, path.dirname(file.path), match[1]);
          const candidates = [reference, reference + '.d.ts', path.join(reference, 'index.d.ts'), reference.replace(/\.m?js$/, '.d.ts'), reference.replace(/\.mjs$/, '.d.mts')];
          let found = false;
          for (const candidate of candidates) try { if ((await stat(candidate)).isFile()) { found = true; break; } } catch { /* Next TS resolution form. */ }
          assert(found, `${name}/${file.path}: unresolved ${match[1]}`);
          declarationReferences++;
        }
      }
      record.validation = { publicPathsResolve: true, noSourceMaps: true, noDanglingMapUrls: true, declarationReferences };
    }
  }
  const assets = record.baseline.files.filter(file => /\.wasm$/.test(file.path) || /(?:license|notices?)/i.test(path.basename(file.path)));
  for (const file of assets) {
    const before = await readFile(path.join(work, 'stage/baseline', name, file.path));
    const after = await readFile(path.join(work, 'unpacked', name, 'package', file.path));
    assert.equal(sha(after), sha(before), `${name}/${file.path}: binary or license changed`);
  }
  record.validation.unchangedAssets = assets.map(file => file.path);
  console.log(`${name}: ${record.mapInclusionControl.packedBytes} -> ${record.current.packedBytes} controlled packed bytes`);
}
const server = await createServer({ configFile: false, root: process.cwd(), logLevel: 'error',
  cacheDir: path.join(work, 'vite-cache'), optimizeDeps: { noDiscovery: true,
    include: ['fflate', 'utif', 'pdfjs-dist', 'protobufjs/light.js', 'snappyjs', 'cfb', 'dxf-parser', 'three', 'vue', 'docx-preview', 'fast-xml-parser', 'jszip'] },
  server: { host: '127.0.0.1', port: 0 } });
await server.listen();
const browser = await chromium.launch();
result.browser = browser.version();
try {
  const page = await browser.newPage();
  page.on('pageerror', error => result.errors.push(error.message));
  const origin = `http://127.0.0.1:${server.httpServer.address().port}`;
  await page.route(origin + '/', route => route.fulfill({ contentType: 'text/html', body: '<!doctype html>' }));
  await page.goto(origin);
  for (const name of names) {
    const entries = { baseline: '/' + path.join(work, 'stage/baseline', name, 'dist/index.js'), current: '/' + path.join(work, 'unpacked', name, 'package/dist/index.js') };
    const models = await page.evaluate(async entries => {
      const outputs = [];
      for (const entry of Object.values(entries)) {
        const lib = await import(entry);
        outputs.push({ exports: Object.keys(lib).sort(), routes: Object.fromEntries(Object.entries(lib).filter(([key]) => key.endsWith('_FORMAT_ROUTES'))) });
      }
      return outputs;
    }, entries);
    assert.deepEqual(models[0], models[1], `${name}: runtime exports/routes changed`);
    result.packages[name].validation.runtimeExports = models[1].exports;
    result.packages[name].validation.routesEqual = true;
  }
  assert.deepEqual(result.errors, []);
  await mkdir(path.dirname(output), { recursive: true });
  await writeFile(output, JSON.stringify(result, null, 2) + '\n');
  console.log(JSON.stringify(result.totals, null, 2));
  console.log(`PASS: ${names.length} packed packages, public paths, declarations, browser exports/routes, and source-map exclusion.`);
} finally {
  await browser.close();
  await server.close();
}
