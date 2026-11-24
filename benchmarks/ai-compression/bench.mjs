import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { createHash } from 'node:crypto';
import { brotliCompressSync, brotliDecompressSync, gzipSync } from 'node:zlib';
import { performance } from 'node:perf_hooks';
import { chromium } from '@playwright/test';
import { encodeArithmetic, decodeArithmetic, createLearnedReader } from './codec.mjs';
const work = 'dist/ai-compression';
const meta = JSON.parse(await readFile(`${work}/extracted.json`, 'utf8'));
const source = await readFile(`${work}/source.js`, 'utf8');
const decoder = (await readFile(`${work}/decoder.wasm`)).toString('base64');
const plans = JSON.parse(await readFile(`${work}/plans.json`, 'utf8'));
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const report = { date: new Date().toISOString(), sourceSha256: meta.sha256, assets: meta.layout.length, decodedBytes: meta.size,
  scope: 'Fixed published SDK input. Structural byte histograms/K-means + LZMA versus a trained one-byte-context softmax model compiled to CDFs and arithmetic coding. Whole-JS transport includes model, decoder, Base64 and unchanged application code. Local Chromium import measurements include HTTP transfer, parsing, asset restoration and module initialization; not WAN latency.', variants: [] };
function replaceInitializer(initializer) { return source.slice(0, meta.initializer.start) + initializer + source.slice(meta.initializer.end); }
const candidates = [{ name: 'published-baseline', code: source, codec: 'published solid LZMA' }];
for (const plan of plans) {
  const payload = await readFile(`${work}/${plan.name}.lzma`);
  const inverse = plan.order.map((_, old) => plan.order.indexOf(old));
  const reader = `(${meta.reader})(${JSON.stringify(decoder)},${JSON.stringify(payload.toString('base64'))},${JSON.stringify(plan.layout)},${meta.size},${plan.crc})`;
  const initializer = plan.order.every((value, i) => value === i) ? reader : `((reader,map)=>index=>reader(map[index]))(${reader},${JSON.stringify(inverse)})`;
  candidates.push({ name: plan.name, code: replaceInitializer(initializer), codec: 'native LZMA + lossless asset permutation', encodeMs: plan.encodeMs, payloadBytes: plan.bytes });
}
const raw = await readFile(`${work}/assets.bin`), modelBytes = await readFile(`${work}/model.cdf`);
const cdf = new Uint16Array(modelBytes.buffer, modelBytes.byteOffset, modelBytes.length / 2);
const encodeStart = performance.now(), encoded = encodeArithmetic(raw, cdf), encodeMs = performance.now() - encodeStart;
const decodeStart = performance.now(), decoded = decodeArithmetic(encoded, cdf, raw.length), decodeMs = performance.now() - decodeStart;
assert.deepEqual(Buffer.from(decoded), raw);
const model = JSON.parse(await readFile(`${work}/model.json`, 'utf8'));
report.learnedModel = { ...model, payloadBytes: encoded.length, nodeEncodeMs: encodeMs, nodeDecodeMs: decodeMs, exactRoundTrip: true };
const learnedInitializer = `(${createLearnedReader.toString()})(${decodeArithmetic.toString()},${JSON.stringify(modelBytes.toString('base64'))},${JSON.stringify(Buffer.from(encoded).toString('base64'))},${JSON.stringify(meta.layout)},${meta.size},${meta.crc})`;
candidates.push({ name: 'learned-byte-context', code: replaceInitializer(learnedInitializer), codec: 'trained softmax + arithmetic coding', payloadBytes: encoded.length, modelBytes: modelBytes.length, encodeMs });
for (const candidate of candidates) {
  const bytes = Buffer.from(candidate.code), br = brotliCompressSync(bytes);
  assert.deepEqual(brotliDecompressSync(br), bytes);
  await writeFile(`${work}/${candidate.name}.js`, bytes);
  await writeFile(`${work}/${candidate.name}.js.br`, br);
  report.variants.push({ name: candidate.name, codec: candidate.codec, rawBytes: bytes.length, brotliBytes: br.length,
    gzipBytes: gzipSync(bytes, { level: 9 }).length, sha256: sha(bytes),
    ...(candidate.payloadBytes ? { payloadBytes: candidate.payloadBytes } : {}),
    ...(candidate.modelBytes ? { modelBytes: candidate.modelBytes } : {}),
    ...(candidate.encodeMs ? { encodeMs: candidate.encodeMs } : {}) });
  console.log(report.variants.at(-1));
}
const baseline = report.variants[0];
const best = report.variants.filter(v => v.name !== 'learned-byte-context').sort((a, b) => a.brotliBytes - b.brotliBytes)[0];
const browserNames = [...new Set([baseline.name, best.name, 'learned-byte-context'])];
const server = createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost');
  if (url.pathname.endsWith('/filens.js')) {
    const name = url.pathname.split('/')[1];
    if (!browserNames.includes(name)) { res.writeHead(404); res.end(); return; }
    res.writeHead(200, { 'Content-Type': 'application/javascript', 'Content-Encoding': 'br', 'Cache-Control': 'no-store' });
    res.end(await readFile(`${work}/${name}.js.br`)); return;
  }
  res.writeHead(200, { 'Content-Type': 'text/html', 'Cache-Control': 'no-store' });
  res.end(`<!doctype html><div id="host" style="height:600px;width:800px"></div><script type="module">
  const start=performance.now();const {createPreview}=await import('/${url.searchParams.get('name')}/filens.js');window.importMs=performance.now()-start;
  window.errors=[];window.createPreview=createPreview;window.viewer=createPreview('#host',{src:new File(['Lossless compression marker'],'test.txt'),onRendered:()=>window.ready=true,onError:e=>window.errors.push(e.message)});
  </script>`);
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const browser = await chromium.launch({ headless: true });
try {
  report.browser = browser.version();
  for (const name of browserNames) {
    const samples = [];
    for (let trial = 0; trial < 3; trial++) {
      const context = await browser.newContext(), page = await context.newPage(), errors = [];
      page.on('pageerror', error => errors.push(error.message));
      try {
        await page.goto(`http://127.0.0.1:${server.address().port}/?name=${name}`, { timeout: 120_000 });
        await page.waitForFunction(() => window.ready, null, { timeout: 120_000 });
        assert.ok((await page.locator('#host').innerText()).includes('Lossless compression marker'));
        samples.push(await page.evaluate(() => window.importMs));
        if (!trial) {
          const fixture = await readFile('packages/model3d/test/fixtures/occt/cube.stp');
          await page.evaluate(bytes => {window.ready=false;window.viewer.destroy();window.viewer=window.createPreview('#host',{src:new Uint8Array(bytes),name:'cube.stp',onRendered:state=>{window.state=state;window.ready=true;},onError:e=>window.errors.push(e.message)});}, [...fixture]);
          await page.waitForFunction(() => window.ready, null, { timeout: 60_000 });
          const triangles = await page.evaluate(() => window.state.metadata.triangleCount);
          assert.equal(triangles, 12, name);
        }
        assert.deepEqual(errors, [], name);
        assert.deepEqual(await page.evaluate(() => window.errors), [], name);
      } finally { await context.close(); }
    }
    const variant = report.variants.find(v => v.name === name);
    variant.browserImportMs = samples;
    variant.medianBrowserImportMs = [...samples].sort((a, b) => a - b)[1];
    variant.browserValidation = { text: true, stepTriangles: 12, trials: 3 };
    console.log(name, variant.medianBrowserImportMs, 'ms');
  }
} finally { await browser.close(); await new Promise(resolve => server.close(resolve)); }
report.bestStructural = { name: best.name, brotliBytes: best.brotliBytes, savingsPercent: (1 - best.brotliBytes / baseline.brotliBytes) * 100 };
await writeFile('docs/ai-compression-benchmark.json', JSON.stringify(report, null, 2) + '\n');
console.table(report.variants.map(v => ({ name: v.name, brotliBytes: v.brotliBytes, medianImportMs: v.medianBrowserImportMs })));
