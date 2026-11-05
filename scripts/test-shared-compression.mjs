import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { performance } from 'node:perf_hooks';
import { pathToFileURL } from 'node:url';
import { gzipSync, deflateSync } from 'node:zlib';
import OriginalJSZip from 'jszip';
import OriginalUTIF from 'utif';
import { build, loadConfigFromFile } from 'vite';

const baselineIndex = process.argv.indexOf('--baseline');
const baseline = baselineIndex < 0 ? undefined : process.argv[baselineIndex + 1];
if (baselineIndex >= 0 && (!baseline || baseline.startsWith('--'))) throw new Error('--baseline requires a saved shared-compression.ts file.');
await mkdir(path.resolve('tmp'), { recursive: true });
const directory = await mkdtemp(path.resolve('tmp/shared-compression-test-'));
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const result = { node: process.version, cpu: os.cpus()[0].model, checks: [], bindings: {}, cases: {} };
try {
  const engines = {};
  for (const name of ['current', ...(baseline ? ['baseline'] : [])]) {
    let configFile = path.resolve('packages/preview/vite.config.ts');
    if (name === 'baseline') {
      configFile = path.join(directory, 'baseline-vite.config.mjs');
      await writeFile(configFile, `import { sharedCompression } from ${JSON.stringify(path.resolve(baseline))}; export default {plugins:[sharedCompression()]};`);
    }
    const loaded = await loadConfigFromFile({ command: 'build', mode: 'production' }, configFile);
    const compression = loaded.config.plugins.find(plugin => plugin.name === 'filens-shared-compression');
    assert(compression);
    let hasPakoDeflate = false;
    await build({ configFile: false, logLevel: 'silent', plugins: [compression, {
      name: 'inspect-compression', generateBundle() { hasPakoDeflate = [...this.getModuleIds()].some(id => /\/pako\/lib\/(?:zlib\/)?deflate\.js/.test(id)); }
    }], define: { 'process.env.NODE_ENV': '"production"' }, build: {
      outDir: path.join(directory, name), lib: { entry: path.resolve('scripts/shared-compression-test-entry.mjs'), formats: ['es'], fileName: () => 'index.js' }
    } });
    assert.equal(hasPakoDeflate, name === 'baseline');
    const file = path.join(directory, name, 'index.js');
    result.bindings[name] = { sha256: hash(await readFile(file)), hasPakoDeflate };
    engines[name] = await import(pathToFileURL(file).href);
  }
  const { JSZip, openUnencryptedZipArchive } = engines.current;
  const bytes = Uint8Array.from({ length: 1024 * 1024 + 73 }, (_, index) => (index * 37 + (index >>> 9)) % 256);
  const binary = String.fromCharCode(...Array.from({ length: 256 }, (_, index) => index)).repeat(257);
  const inputs = { '中文/notes.txt': 'Shared 中文 & 🙂\n'.repeat(3000), 'binary.bin': bytes.subarray(3, bytes.length - 7),
    'string.bin': binary, 'empty.bin': new Uint8Array() };
  const fill = zip => { for (const [name, data] of Object.entries(inputs)) zip.file(name, data, { binary: name === 'string.bin' }); return zip; };
  const check = async zip => {
    assert.equal(await zip.file('中文/notes.txt').async('string'), inputs['中文/notes.txt']);
    assert.deepEqual(await zip.file('binary.bin').async('uint8array'), inputs['binary.bin']);
    assert.equal(await zip.file('string.bin').async('binarystring'), binary);
    assert.equal((await zip.file('empty.bin').async('uint8array')).length, 0);
  };
  for (const level of [undefined, -1, 0, 1, 6, 9]) {
    const options = { type: 'uint8array', compression: 'DEFLATE', compressionOptions: { level } };
    const original = await fill(new OriginalJSZip()).generateAsync(options);
    try { await check(await JSZip.loadAsync(original, { checkCRC32: true })); }
    catch (error) { throw new Error(`Original ZIP read at level ${level}`, { cause: error }); }
    const generated = await fill(new JSZip()).generateAsync(options);
    try { await check(await OriginalJSZip.loadAsync(generated, { checkCRC32: true })); }
    catch (error) { throw new Error(`Generated ZIP read by original at level ${level}`, { cause: error }); }
    try { await check(await JSZip.loadAsync(generated, { checkCRC32: true })); }
    catch (error) { throw new Error(`Generated ZIP read at level ${level}`, { cause: error }); }
    const entries = await openUnencryptedZipArchive(original);
    assert.equal(await entries.get('中文/notes.txt').text(), inputs['中文/notes.txt']);
    result.checks.push(`read/write DEFLATE level ${level ?? 'default'}, Unicode, binary strings, views and empty entries`);
  }
  const chunks = [], stream = fill(new JSZip()).generateInternalStream({ type: 'uint8array', compression: 'DEFLATE', streamFiles: true });
  await new Promise((resolve, reject) => {
    stream.on('data', (chunk, metadata) => {
      assert(metadata.percent >= 0 && metadata.percent <= 100);
      chunks.push(chunk); stream.pause(); queueMicrotask(() => stream.resume());
    }).on('error', reject).on('end', resolve).resume();
  });
  const streamed = new Uint8Array(chunks.reduce((size, chunk) => size + chunk.length, 0));
  let offset = 0; for (const chunk of chunks) { streamed.set(chunk, offset); offset += chunk.length; }
  await check(await OriginalJSZip.loadAsync(streamed, { checkCRC32: true }));
  result.checks.push('streamed ZIP generation, data descriptors, pause/resume and metadata');

  const bad = await new OriginalJSZip().file('bad.bin', bytes).generateAsync({ type: 'uint8array', compression: 'DEFLATE' });
  const view = new DataView(bad.buffer, bad.byteOffset, bad.byteLength);
  const start = 30 + view.getUint16(26, true) + view.getUint16(28, true);
  bad[start] = 7; // Reserved DEFLATE block type.
  const corrupt = await JSZip.loadAsync(bad);
  await assert.rejects(corrupt.file('bad.bin').async('uint8array'));
  await assert.rejects(JSZip.loadAsync(bad, { checkCRC32: true }));
  result.checks.push('malformed DEFLATE rejects entry reads and CRC validation');

  const width = 512, height = 512;
  const rgba = Uint8Array.from({ length: width * height * 4 }, (_, index) => index % 4 === 3 ? 255 : (index * 37 + (index >>> 9)) % 256);
  const makeTiff = compress => {
    const payload = compress(rgba), prefix = new Uint8Array(OriginalUTIF.encodeImage(rgba, width, height, { t259: [8], t279: [payload.length] })).subarray(0, 1000);
    const output = new Uint8Array(prefix.length + payload.length); output.set(prefix); output.set(payload, prefix.length); return output;
  };
  const tiffs = { zlib: makeTiff(deflateSync), gzip: makeTiff(gzipSync), uncompressed: new Uint8Array(OriginalUTIF.encodeImage(rgba, width, height)) };
  const decode = (engine, source) => {
    const pages = engine.UTIF.decode(source.buffer); engine.UTIF.decodeImage(source.buffer, pages[0], pages); return engine.UTIF.toRGBA8(pages[0]);
  };
  for (const [name, source] of Object.entries(tiffs)) {
    assert.deepEqual(decode(engines.current, source), rgba);
    assert.deepEqual(decode({ UTIF: OriginalUTIF }, source), rgba);
    result.checks.push(`TIFF complete pixels (${name})`);
  }
  for (const name of ['zlib', 'gzip']) {
    const corrupt = tiffs[name].slice(); corrupt[corrupt.length - (name === 'zlib' ? 1 : 8)] ^= 1;
    assert.throws(() => decode(engines.current, corrupt));
    assert.throws(() => decode({ UTIF: OriginalUTIF }, corrupt));
    result.checks.push(`TIFF rejects corrupt ${name} checksums`);
  }

  if (process.argv.includes('--bench')) {
    result.warmupIterations = 2; result.measuredIterations = 7;
    const inputZip = new OriginalJSZip();
    for (let index = 0; index < 100; index++) inputZip.file(`${index}.bin`, bytes.subarray(0, 65536), { date: new Date('2020-01-01T00:00:00Z') });
    const archive = await inputZip.generateAsync({ type: 'uint8array', compression: 'DEFLATE' });
    for (const [name, source, run, validate] of [
      ['zip-compat', archive, async (engine, source) => {
        const zip = await engine.JSZip.loadAsync(source); const outputs = [];
        for (const file of Object.values(zip.files)) outputs.push(await file.async('uint8array'));
        return outputs;
      }],
      ['tiff-deflate', tiffs.zlib, (engine, source) => [decode(engine, source)]],
      ['zip-write', bytes, async (engine, source) => [await new engine.JSZip().file('data.bin', source, { date: new Date('2020-01-01T00:00:00Z') }).generateAsync({ type: 'uint8array', compression: 'DEFLATE' })],
        async outputs => [await (await OriginalJSZip.loadAsync(outputs[0], { checkCRC32: true })).file('data.bin').async('uint8array')]]
    ]) {
      const samples = Object.fromEntries(Object.keys(engines).map(engine => [engine, []]));
      let expected;
      for (let iteration = 0; iteration < result.warmupIterations + result.measuredIterations; iteration++) {
        const order = Object.keys(engines); if (iteration % 2) order.reverse();
        for (const engine of order) {
          const start = performance.now(); const outputs = await run(engines[engine], source); const ms = performance.now() - start;
          const hashes = (validate ? await validate(outputs) : outputs).map(hash); expected ??= hashes; assert.deepEqual(hashes, expected);
          if (iteration >= result.warmupIterations) samples[engine].push(ms);
        }
      }
      const median = values => [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)];
      result.cases[name] = { inputBytes: source.length, inputSha256: hash(source), outputCount: expected.length, outputSha256: hash(expected.join('\n')),
        timings: Object.fromEntries(Object.entries(samples).map(([engine, values]) => [engine, { medianMs: median(values), samplesMs: values }])) };
    }
  }
  console.log(JSON.stringify(result, null, 2));
} finally { await rm(directory, { recursive: true, force: true }); }
