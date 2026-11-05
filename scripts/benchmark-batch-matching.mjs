// Compare the actual source modules against a pre-edit snapshot. Synthetic
// lookup timings include lazy index construction in the fresh KMZ cases.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { gzipSync, brotliCompressSync } from 'node:zlib';
import { chromium } from '@playwright/test';
import { build, loadConfigFromFile } from 'vite';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const files = ['packages/model3d/src/preview-driver.ts', 'packages/core/src/preview/formats.ts',
  'packages/core/src/preview/registry.ts', 'wasm/converter-core-rust/src/text.rs', 'wasm/converter-core-rust/src/text/prune.rs'];
const option = name => { const i = process.argv.indexOf(name); return i < 0 ? undefined : process.argv[i + 1]; };
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const sizes = bytes => ({ raw: Buffer.byteLength(bytes), gzip: gzipSync(bytes, { level: 9 }).length, brotli: brotliCompressSync(bytes).length });
const median = values => [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)];

if (option('--snapshot')) {
  const destination = path.resolve(option('--snapshot'));
  for (const file of files) {
    await mkdir(path.dirname(path.join(destination, file)), { recursive: true });
    await cp(path.join(root, file), path.join(destination, file), { errorOnExist: true, force: false });
  }
  console.log(`Saved source baseline to ${destination}. Save a production converter-text.wasm there under wasm/ as well.`);
  process.exit(0);
}
assert(option('--baseline'), '--baseline requires a pre-edit source snapshot (see --snapshot).');
const baseline = path.resolve(option('--baseline'));
const sources = new Map(await Promise.all(files.map(async file => [path.join(root, file), await readFile(path.join(baseline, file), 'utf8')])));
const directory = await mkdtemp(path.join(root, 'tmp/batch-matching-bench-'));
const result = { environment: { node: process.version, cpu: os.cpus()[0].model, platform: `${process.platform}-${process.arch}` },
  warmupIterations: 3, measuredIterations: 9, sourceSha256: {}, packages: {}, cases: {}, limitations: [
    'Synthetic single-host matching benchmarks; excludes decompression, rendering, OCR inference and file traversal.',
    'Fresh KMZ timings include used index construction; warm KMZ timings exclude it. Fresh routes creates a registry but reuses the module-level default index after warmup. Its first-ever build is not timed separately.',
    'Fixture creation and output verification are outside timings.',
    'Package sizes include emitted JS chunks only, excluding dependencies, CSS, maps and declarations; WASM is measured separately.',
    'Custom mutable route arrays retain dynamic lookup. Indexed default registries and explicit compiled resolvers use configuration snapshots.',
    'No peak-memory measurement or whole-document end-to-end speedup claim.'
  ] };
for (const [file, before] of sources) result.sourceSha256[path.relative(root, file)] = { before: hash(before), after: hash(await readFile(file)) };
result.sourceSha256['packages/model3d/src/kmz-resources.ts'] = { after: hash(await readFile(path.join(root, 'packages/model3d/src/kmz-resources.ts'))) };
result.sourceSha256['wasm/converter-core-rust/src/text/ocr_scores.rs'] = { after: hash(await readFile(path.join(root, 'wasm/converter-core-rust/src/text/ocr_scores.rs'))) };
const override = { name: 'batch-matching-baseline', enforce: 'pre', load(id) { return sources.get(id); } };
let browser;
try {
  // Rebuild both versions against the same current dependencies and unrelated
  // worktree edits. Do not compare historical dist artifacts from other tasks.
  for (const pkg of ['core', 'model3d']) {
    const pkgRoot = path.join(root, 'packages', pkg);
    const { config } = await loadConfigFromFile({ command: 'build', mode: 'production' }, path.join(pkgRoot, 'vite.config.ts'));
    result.packages[pkg] = {};
    for (const version of ['before', 'after']) {
      const built = await build({ ...config, configFile: false, root: pkgRoot, logLevel: 'error',
        plugins: [...(version === 'before' ? [override] : []), ...config.plugins.flat().filter(plugin => plugin.name !== 'vite:dts')],
        build: { ...config.build, write: false, sourcemap: false } });
      const chunks = (Array.isArray(built) ? built : [built]).flatMap(item => item.output).filter(item => item.type === 'chunk');
      const total = { raw: 0, gzip: 0, brotli: 0 };
      for (const chunk of chunks) for (const [key, value] of Object.entries(sizes(chunk.code))) total[key] += value;
      result.packages[pkg][version] = { ...total, chunks: chunks.map(chunk => ({ file: chunk.fileName, sha256: hash(chunk.code) })) };
    }
  }
  for (const version of ['before', 'after']) {
    const old = sources.get(path.join(root, files[0]));
    const kmz = version === 'before'
      ? old.slice(old.indexOf('function normalizeKmzPath('), old.indexOf('function findKmzKml(')) + '\nexport { createKmzIndex, findKmzResource };'
      : `export { createKmzIndex, findKmzResource } from ${JSON.stringify(path.join(root, 'packages/model3d/src/kmz-resources.ts'))};`;
    const entry = path.join(directory, `${version}.ts`);
    await writeFile(entry, kmz + `\nexport * from ${JSON.stringify(path.join(root, 'packages/core/src/preview/formats.ts'))};\nexport { PreviewRegistry } from ${JSON.stringify(path.join(root, 'packages/core/src/preview/registry.ts'))};`);
    await build({ configFile: false, root, logLevel: 'error', plugins: version === 'before' ? [override] : [],
      build: { outDir: path.join(directory, version), lib: { entry, formats: ['es'], fileName: () => 'index.js' }, minify: 'esbuild' } });
  }
  browser = await chromium.launch();
  result.environment.browser = browser.version();
  const page = await browser.newPage();
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.route('http://localhost/**', async route => {
    const pathname = new URL(route.request().url()).pathname;
    if (pathname === '/') return route.fulfill({ contentType: 'text/html', body: '<!doctype html>' });
    const file = path.resolve(directory, '.' + pathname);
    assert(file.startsWith(directory + path.sep));
    await route.fulfill({ contentType: 'text/javascript', body: await readFile(file) });
  });
  await page.goto('http://localhost/');
  await page.evaluate(async () => { window.engines = { before: await import('/before/index.js'), after: await import('/after/index.js') }; });
  const cases = [
    ...[32, 10000].flatMap(entries => ['exact', 'case', 'suffix', 'missing', 'ambiguous'].flatMap(mode =>
      [true, false].map(fresh => ({ kind: 'kmz', entries, queries: entries === 32 ? 32 : 512, mode, fresh })))),
    ...[true, false].flatMap(fresh => ['default', 'custom'].map(mode => ({ kind: 'routes', queries: 20000, mode, fresh })))
  ];
  for (const item of cases) {
    const samples = { before: [], after: [] };
    let expectedHash;
    for (let iteration = 0; iteration < result.warmupIterations + result.measuredIterations; iteration++) {
      for (const version of iteration % 2 ? ['after', 'before'] : ['before', 'after']) {
        const row = await page.evaluate(async ({ item, version }) => {
          const engine = window.engines[version];
          const names = item.kind === 'kmz' ? Array.from({ length: item.entries }, (_, i) => `pack-${i % 11}/textures/asset-${i}.png`) : [];
          if (item.mode === 'ambiguous') names.push('other/asset-0.png');
          const queries = Array.from({ length: item.queries }, (_, i) => {
            const id = i % Math.max(1, item.entries ?? 1);
            return item.kind === 'kmz' ? item.mode === 'exact' ? names[id] : item.mode === 'case' ? names[id].toUpperCase()
              : item.mode === 'missing' ? `missing-${i}.png` : item.mode === 'ambiguous' ? 'asset-0.png' : `textures/asset-${id}.png`
              : i % 4 === 0 ? { name: 'folder/file.unknown' } : i % 4 === 1 ? { contentType: 'text/plain; charset=utf-8' }
              : i % 4 === 2 ? { name: 'folder/file.xlsx' } : { extension: '.PDF' };
          });
          const customRoutes = item.mode === 'custom' ? engine.DEFAULT_FORMAT_ROUTES.map(route => ({ ...route })) : undefined;
          const make = () => item.kind === 'kmz' ? engine.createKmzIndex(names) : new engine.PreviewRegistry({ routes: customRoutes });
          let index = item.fresh ? undefined : make();
          const query = (index, value) => item.kind === 'kmz' ? engine.findKmzResource(index, value, 'model.dae') : index.resolve(value)?.route;
          if (!item.fresh) for (const value of queries) query(index, value);
          // Repeat small cases to rise above browser timer quantization.
          const repeats = item.kind === 'kmz' && item.entries === 32 ? 32 : 1;
          const outputs = [];
          const start = performance.now();
          for (let repeat = 0; repeat < repeats; repeat++) {
            if (item.fresh) index = make();
            for (const value of queries) outputs.push(query(index, value) ?? null);
          }
          const elapsedMs = (performance.now() - start) / repeats;
          const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(JSON.stringify(outputs)));
          return { elapsedMs, hash: [...new Uint8Array(digest)].map(n => n.toString(16).padStart(2, '0')).join('') };
        }, { item, version });
        expectedHash ??= row.hash;
        assert.equal(row.hash, expectedHash, `Output mismatch: ${JSON.stringify(item)}`);
        if (iteration >= result.warmupIterations) samples[version].push(row.elapsedMs);
      }
    }
    const key = `${item.kind}-${item.mode}-${item.entries ?? item.queries}-${item.fresh ? 'fresh' : 'warm'}`;
    result.cases[key] = { ...item, outputSha256: expectedHash, before: { medianMs: median(samples.before), samplesMs: samples.before },
      after: { medianMs: median(samples.after), samplesMs: samples.after }, speedup: median(samples.before) / median(samples.after) };
  }
  assert.deepEqual(errors, []);
  await browser.close(); browser = undefined;

  // WASI microbenchmark compiled from the actual helper, and the exact old
  // expression extracted from the snapshot. No copied optimized algorithm.
  const oldText = sources.get(path.join(root, 'wasm/converter-core-rust/src/text.rs'));
  const start = oldText.indexOf('        let confidence = raw', oldText.indexOf('fn emit_ocr('));
  assert(start >= 0);
  const expression = oldText.slice(start + '        let confidence = '.length, oldText.indexOf(';', start));
  const scoreSources = { before: `pub(super) fn confidences(raw: &str, count: usize) -> Vec<Option<f64>> { (0..count).map(|i| { ${expression} }).collect() }`,
    after: await readFile(path.join(root, 'wasm/converter-core-rust/src/text/ocr_scores.rs'), 'utf8') };
  const harness = await readFile(path.join(root, 'scripts/benchmark-ocr-scores.rs'), 'utf8');
  const runner = path.join(directory, 'wasi.mjs');
  await writeFile(runner, `import { WASI } from 'node:wasi';\nimport { readFileSync } from 'node:fs';\nconst wasi = new WASI({version:'preview1',args:['scores'],env:{},preopens:{}});\nconst module = await WebAssembly.compile(readFileSync(process.argv[2]));\nwasi.start(await WebAssembly.instantiate(module, {wasi_snapshot_preview1: wasi.wasiImport}));\n`);
  const command = (exe, args) => {
    const run = spawnSync(exe, args, { cwd: root, encoding: 'utf8', timeout: 120000, maxBuffer: 16 << 20 });
    assert.equal(run.error, undefined, run.error?.message);
    assert.equal(run.status, 0, run.stderr);
    return run.stdout;
  };
  result.ocrScores = {};
  for (const version of ['before', 'after']) {
    const source = path.join(directory, `scores-${version}.rs`), wasm = source.replace(/\.rs$/, '.wasm');
    await writeFile(source, `mod scores {\n${scoreSources[version]}\n}\n${harness}`);
    command('rustc', ['+1.93.0', '--edition=2024', '--crate-name', 'scores', '--target', 'wasm32-wasip1', '-C', 'opt-level=z', '-C', 'lto=true', '-C', 'panic=abort', '-C', 'strip=symbols', source, '-o', wasm]);
    result.ocrScores[version] = JSON.parse(command(process.execPath, ['--disable-warning=ExperimentalWarning', runner, wasm]));
  }
  for (let i = 0; i < result.ocrScores.before.length; i++) assert.deepEqual(result.ocrScores.before[i].checksum, result.ocrScores.after[i].checksum);
  const beforeWasm = path.join(baseline, 'wasm/converter-text.wasm');
  const afterWasm = option('--wasm-after');
  if (afterWasm) {
    result.textWasm = {};
    for (const [version, file] of [['before', beforeWasm], ['after', afterWasm]]) {
      const bytes = await readFile(file);
      assert(bytes.length > 1000000 && WebAssembly.validate(bytes), `Invalid production WASM: ${file}`);
      result.textWasm[version] = { ...sizes(bytes), sha256: hash(bytes) };
    }
  }
  const output = option('--output');
  if (output) { await mkdir(path.dirname(path.resolve(output)), { recursive: true }); await writeFile(output, JSON.stringify(result, null, 2) + '\n'); }
  console.log(JSON.stringify(result, null, 2));
} finally {
  if (browser) await browser.close();
  await rm(directory, { recursive: true, force: true });
}
