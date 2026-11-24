// Compare readers against the same published SDK; never overwrite its release files.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { performance } from 'node:perf_hooks';
import { brotliCompressSync } from 'node:zlib';
import ts from 'typescript';
import { transform } from 'esbuild';
import { chromium, expect } from '@playwright/test';
import { createPackedAssetReader, createGroupedPackedAssetReader } from '../packages/preview/src/packed-assets.mjs';
import { packAssetGroups } from './preview-asset-packing.mjs';

const groupedMode = process.argv.includes('--grouped');
const sourcePath = process.argv.slice(2).find(argument => argument !== '--grouped') ?? 'dist/ai-compression/source.js';
const source = await readFile(sourcePath, 'utf8');
const ast = ts.createSourceFile('filens.js', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
let initializer;
function visit(node) {
  if (ts.isVariableDeclaration(node) && node.name.getText(ast) === '__filensPackedAsset') initializer = node.initializer;
  ts.forEachChild(node, visit);
}
visit(ast);
assert.ok(initializer && ts.isCallExpression(initializer), 'Expected a packed SDK entry.');
const args = initializer.arguments.map(argument => JSON.parse(argument.getText(ast)));
const { baselineReader } = await import('data:text/javascript;base64,' + Buffer.from(
  `export const baselineReader=${initializer.expression.getText(ast)};`).toString('base64'));
const bootstrap = (await transform(`const reader=(${createPackedAssetReader.toString()})(${initializer.arguments.map(argument => argument.getText(ast)).join(',')});`,
  { minify: true, target: 'es2020' })).code;
const bootstrapAst = ts.createSourceFile('reader.js', bootstrap, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
const expression = bootstrapAst.statements[0].declarationList.declarations[0].initializer.getText(bootstrapAst);
const optimized = source.slice(0, initializer.getStart(ast)) + expression + source.slice(initializer.end);
await transform(optimized, { loader: 'js', target: 'es2020', format: 'esm' });
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const median = values => [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)];
const variants = { baseline: { code: source, reader: baselineReader }, optimized: { code: optimized, reader: createPackedAssetReader } };
let groupSizes;
if (groupedMode) {
  const reader = baselineReader(...args), assets = [];
  for (const [index, [kind]] of args[2].entries()) {
    const value = reader(index);
    const bytes = kind === 2 ? Buffer.from(await (await fetch(value)).arrayBuffer()) : Buffer.from(value, kind === 1 ? 'base64' : 'utf8');
    assets.push({ kind, bytes });
    if (kind === 2) URL.revokeObjectURL(value);
  }
  const { groups, mapping } = await packAssetGroups(assets);
  groupSizes = groups.map(group => ({ decodedBytes: group.size, compressedBytes: group.compressed.length }));
  const groupArguments = groups.map(group => [group.compressed.toString('base64'), group.layout, group.size, group.checksum]);
  const groupedBootstrap = (await transform(`const reader=(${createGroupedPackedAssetReader.toString()})(${createPackedAssetReader.toString()},${JSON.stringify(args[0])},${JSON.stringify(groupArguments)},${JSON.stringify(mapping)});`,
    { minify: true, target: 'es2020' })).code;
  const groupedAst = ts.createSourceFile('reader.js', groupedBootstrap, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
  const edits = [[initializer.getStart(ast), initializer.end, groupedAst.statements[0].declarationList.declarations[0].initializer.getText(groupedAst)]];
  const bindings = new Set();
  function deferWasm(node) {
    if (ts.isVariableDeclaration(node) && node.initializer && ts.isCallExpression(node.initializer) &&
        node.initializer.expression.getText(ast) === '__filensPackedAsset' && args[2][Number(node.initializer.arguments[0].getText(ast))]?.[0] === 2) {
      bindings.add(node.name.getText(ast));
      edits.push([node.initializer.getStart(ast), node.initializer.end, `()=>${node.initializer.getText(ast)}`]);
    }
    ts.forEachChild(node, deferWasm);
  }
  deferWasm(ast);
  assert.equal(bindings.size, assets.filter(asset => asset.kind === 2).length, 'Each WASM asset must have a deferred binding.');
  // Mirror media-runtime's source-level URL resolution on the fixed published
  // corpus. WASI/STEP loaders already accept deferred functions directly.
  function resolveMediaUrl(node) {
    if (ts.isNewExpression(node) && node.expression.getText(ast) === 'URL' && node.arguments?.[0] && bindings.has(node.arguments[0].getText(ast))) {
      const argument = node.arguments[0];
      edits.push([argument.getStart(ast), argument.end, `${argument.getText(ast)}()`]);
    }
    ts.forEachChild(node, resolveMediaUrl);
  }
  resolveMediaUrl(ast);
  let code = source;
  for (const [start, end, value] of edits.sort((a, b) => b[0] - a[0])) code = code.slice(0, start) + value + code.slice(end);
  await transform(code, { loader: 'js', target: 'es2020', format: 'esm' });
  variants.grouped = { code, reader: () => createGroupedPackedAssetReader(createPackedAssetReader, args[0], groupArguments, mapping) };
}
const trialOrder = trial => trial % 2 ? Object.keys(variants).reverse() : Object.keys(variants);
const report = {
  observedAt: new Date().toISOString(), node: process.version, sourcePath, sourceSha256: sha(source),
  scope: 'Same published SDK, payload and layout; only its reader initializer changes. Node measures first resource restoration. Browser measures localhost Brotli module import, excluding preview rendering and public-network latency. Seven interleaved trials per variant/path, fresh browser contexts. Full per-asset hashes and real previews are checked outside timing.',
  ...(groupedMode ? { groups: groupSizes, groupedScope: 'WASM restoration is deferred; all asset bytes remain embedded in the single file. Grouped variant mirrors source-level WASM loaders and URL resolution on the same published corpus.' } : {}),
  variants: {}, exactAssets: []
};
await mkdir('tmp/packed-startup', { recursive: true });
for (const [name, variant] of Object.entries(variants)) {
  variant.br = brotliCompressSync(Buffer.from(variant.code));
  await writeFile(`tmp/packed-startup/${name}.js`, variant.code);
  report.variants[name] = { rawBytes: Buffer.byteLength(variant.code), brotliBytes: variant.br.length, nodeSamplesMs: [], nodeWasmSamplesMs: [], browser: {} };
  const reader = variant.reader(...args), hashes = [];
  for (const [index, [kind]] of args[2].entries()) {
    const value = reader(index);
    const bytes = kind === 2 ? Buffer.from(await (await fetch(value)).arrayBuffer()) : Buffer.from(value, kind === 1 ? 'base64' : 'utf8');
    hashes.push(sha(bytes));
    if (kind === 2) URL.revokeObjectURL(value);
  }
  if (name === 'baseline') report.exactAssets = hashes;
  else assert.deepEqual(hashes, report.exactAssets, 'Every original asset must remain exact.');
}
for (let trial = -1; trial < 7; trial++) {
  for (const name of trialOrder(trial)) {
    const reader = variants[name].reader(...args), start = performance.now();
    reader(0);
    const elapsed = performance.now() - start;
    if (trial >= 0) report.variants[name].nodeSamplesMs.push(elapsed);
    const wasmStart = performance.now();
    reader(args[2].findIndex(([kind]) => kind === 2));
    if (trial >= 0) report.variants[name].nodeWasmSamplesMs.push(performance.now() - wasmStart);
    for (const [index, [kind]] of args[2].entries()) if (kind === 2) URL.revokeObjectURL(reader(index));
  }
}
const server = createServer((request, response) => {
  const name = request.url.split('/')[1];
  if (request.url.endsWith('/filens.js') && Object.hasOwn(variants, name)) {
    response.writeHead(200, { 'content-type': 'text/javascript', 'content-encoding': 'br', 'cache-control': 'no-store' });
    response.end(variants[name].br);
  } else if (request.url === '/') {
    response.writeHead(200, { 'content-type': 'text/html', 'content-security-policy': "default-src 'none'; script-src 'self' 'wasm-unsafe-eval'; connect-src 'self' blob: data:; worker-src 'self' blob:; style-src 'unsafe-inline'; img-src 'self' blob: data:; font-src 'self' blob: data:" });
    response.end('<!doctype html><div id="host" style="width:800px;height:600px"></div>');
  } else response.writeHead(404).end();
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const browser = await chromium.launch();
try {
  report.browser = browser.version();
  for (const mode of ['native', 'fallback']) {
    for (let trial = 0; trial < 7; trial++) {
      for (const name of trialOrder(trial)) {
        const context = await browser.newContext(), page = await context.newPage(), errors = [];
        page.on('pageerror', error => errors.push(error.message));
        page.on('console', message => { if (/Content Security Policy|Refused to/.test(message.text())) errors.push(message.text()); });
        if (mode === 'fallback') await page.addInitScript(() => Object.defineProperty(Uint8Array, 'fromBase64', { value: undefined, configurable: true }));
        if (groupedMode) await page.addInitScript(() => {
          window.wasmBlobs = 0;
          const original = URL.createObjectURL;
          URL.createObjectURL = blob => { if (blob.type === 'application/wasm') window.wasmBlobs++; return original(blob); };
        });
        try {
          await page.goto(`http://127.0.0.1:${server.address().port}`);
          const observed = await page.evaluate(async name => {
            const nativeBase64 = typeof Uint8Array.fromBase64 === 'function', start = performance.now();
            window.sdk = await import(`/${name}/filens.js`);
            return { nativeBase64, ms: performance.now() - start };
          }, name);
          assert.equal(observed.nativeBase64, mode === 'native');
          const samples = report.variants[name].browser[mode] ??= [];
          samples.push(observed.ms);
          if (groupedMode) assert.equal(await page.evaluate(() => window.wasmBlobs), name === 'grouped' ? 0 : args[2].filter(([kind]) => kind === 2).length);
          if (!trial || groupedMode) {
            await page.evaluate(() => {
              window.previewStarted = performance.now();
              window.previewErrors = [];
              window.viewer = window.sdk.createPreview('#host', {
                src: new File(['Startup optimization 中文'], 'hello.txt'),
                onRendered: state => { window.state = state; window.ready = true; window.previewMs = performance.now() - window.previewStarted; },
                onError: error => window.previewErrors.push(error.message)
              });
            });
            await expect(page.locator('#host')).toContainText('Startup optimization 中文');
            await page.waitForFunction(() => window.ready);
            if (groupedMode) {
              (report.variants[name].textSamplesMs ??= {})[mode] ??= [];
              report.variants[name].textSamplesMs[mode].push(observed.ms + await page.evaluate(() => window.previewMs));
              assert.equal(await page.evaluate(() => window.wasmBlobs), name === 'grouped' ? 0 : args[2].filter(([kind]) => kind === 2).length);
            }
            for (const [file, fixtureName] of trial ? [] : [
              ['apps/demo/public/samples/filens-cosmic-atlas.pdf', 'atlas.pdf'],
              ['packages/model3d/test/fixtures/occt/cube.stp', 'cube.stp']
            ]) {
              await page.evaluate(({ bytes, name }) => { window.ready = false; window.viewer.update({ src: new Uint8Array(bytes), name }); },
                { bytes: [...await readFile(file)], name: fixtureName });
              await page.waitForFunction(() => window.ready, null, { timeout: 60_000 });
              if (fixtureName === 'cube.stp') assert.equal(await page.evaluate(() => window.state.metadata.triangleCount), 12);
              if (groupedMode) assert.equal(await page.evaluate(() => window.wasmBlobs), name === 'grouped'
                ? fixtureName === 'atlas.pdf' ? 0 : 1 : args[2].filter(([kind]) => kind === 2).length);
            }
            assert.deepEqual(await page.evaluate(() => window.previewErrors), []);
            await page.evaluate(() => window.viewer.destroy());
            await expect(page.locator('#host')).toBeEmpty();
          }
          assert.deepEqual(errors, []);
        } finally { await context.close(); }
      }
    }
  }
} finally {
  await browser.close();
  await new Promise(resolve => server.close(resolve));
}
for (const variant of Object.values(report.variants)) {
  variant.nodeMedianMs = median(variant.nodeSamplesMs);
  variant.nodeWasmMedianMs = median(variant.nodeWasmSamplesMs);
  variant.nodeCompleteMedianMs = median(variant.nodeSamplesMs.map((sample, index) => sample + variant.nodeWasmSamplesMs[index]));
  variant.browserMedianMs = Object.fromEntries(Object.entries(variant.browser).map(([mode, samples]) => [mode, median(samples)]));
  if (variant.textSamplesMs) variant.textMedianMs = Object.fromEntries(Object.entries(variant.textSamplesMs).map(([mode, samples]) => [mode, median(samples)]));
  variant.previewValidation = { text: true, pdf: true, stepTriangles: 12, cspWithoutJsEval: true };
}
await writeFile(groupedMode ? 'docs/grouped-startup-benchmark.json' : 'docs/packed-startup-benchmark.json', JSON.stringify(report, null, 2) + '\n');
console.table(Object.fromEntries(Object.entries(report.variants).map(([name, variant]) => [name, {
  brotliBytes: variant.brotliBytes, nodeMs: variant.nodeMedianMs, ...variant.browserMedianMs
}])));
