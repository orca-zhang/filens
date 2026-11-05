// Paired production core measurements, plus the internal XML-view stage.
// Save core-dist and sources.json in --baseline before applying source changes.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { performance } from 'node:perf_hooks';
import { pathToFileURL } from 'node:url';
import { brotliCompressSync, gzipSync } from 'node:zlib';
import { build } from 'esbuild';
import { zipSync, strToU8 } from 'fflate';

const option = (name, fallback) => {
  const i = process.argv.indexOf(name);
  if (i < 0) return fallback;
  assert(process.argv[i + 1] && !process.argv[i + 1].startsWith('--'), `${name} requires a value`);
  return process.argv[i + 1];
};
const baseline = option('--baseline', 'tmp/shared-readers-baseline');
const output = option('--output', 'tmp/shared-readers-current/core.json');
const work = path.dirname(output);
await mkdir(work, { recursive: true });
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const sourceBaseline = JSON.parse(await readFile(path.join(baseline, 'sources.json'), 'utf8')).files;
const engines = {}, artifacts = {};
for (const name of ['baseline', 'current']) {
  const directory = name === 'baseline' ? path.join(baseline, 'core-dist') : 'packages/core/dist';
  const xmlFile = path.resolve(work, `xml-${name}.mjs`);
  await build({
    stdin: { contents: "export { parseXmlFile, parseXmlFileOrdered } from './packages/core/src/parser/xml.ts';", resolveDir: process.cwd() },
    outfile: xmlFile, bundle: true, format: 'esm', platform: 'node', target: 'es2022', external: ['fast-xml-parser'],
    plugins: name === 'baseline' ? [{ name: 'source-baseline', setup(builder) {
      builder.onLoad({ filter: /\.ts$/ }, args => {
        const source = sourceBaseline[path.relative(process.cwd(), args.path)];
        return source === undefined ? undefined : { contents: source, loader: 'ts' };
      });
    } }] : []
  });
  engines[name] = { ...await import(pathToFileURL(path.resolve(directory, 'index.js')).href),
    xml: await import(pathToFileURL(xmlFile).href) };
  artifacts[name] = {};
  for (const file of (await readdir(directory)).filter(file => file.endsWith('.js'))) {
    const bytes = await readFile(path.join(directory, file));
    artifacts[name][file] = { sha256: hash(bytes), bytes: bytes.length,
      gzip9Bytes: gzipSync(bytes, { level: 9 }).length, brotliBytes: brotliCompressSync(bytes).length };
  }
  artifacts[name].xmlBenchmark = { sha256: hash(await readFile(xmlFile)) };
}
const result = { date: '2026-11-04', node: process.version, cpu: os.cpus()[0].model,
  warmupIterations: 3, measuredIterations: 9, artifacts, sourceSha256: {}, cases: {} };
for (const file of Object.keys(sourceBaseline)) result.sourceSha256[file] = hash(await readFile(file));
const median = values => [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)];
async function measure(name, input, run, metadata = {}, prepare) {
  const samples = { baseline: [], current: [] };
  let expected;
  for (let iteration = 0; iteration < result.warmupIterations + result.measuredIterations; iteration++) {
    for (const engine of iteration % 2 ? ['current', 'baseline'] : ['baseline', 'current']) {
      const implementation = prepare ? await prepare(engine, iteration) : engines[engine];
      const start = performance.now();
      const output = await run(implementation, input);
      const elapsed = performance.now() - start;
      const signature = hash(JSON.stringify(output));
      expected ??= signature;
      assert.equal(signature, expected, `${name}/${engine}: complete output differs`);
      if (iteration >= result.warmupIterations) samples[engine].push(elapsed);
    }
  }
  result.cases[name] = { ...metadata, outputSha256: expected,
    timings: Object.fromEntries(Object.entries(samples).map(([name, values]) => [name, { medianMs: median(values), samplesMs: values }])) };
}

const names = Array.from({ length: 100_000 }, (_, i) => [
  `/workspace/project-${i}/assets/figures/preview/result-${i}.PNG?token=abc#page`,
  `C:\\workspace\\project-${i}\\documents\\report-${i}.DOCX`,
  `/a/b/c/d/e/f/g/h/i/j/k/l/m/n/o/p/file-${i}.unknown`,
  `/workspace/中文目录-${i}/Dockerfile.prod`,
  `/archive/directory-${i}/bundle.zip.001`, `/a/b/c/README#file.png`
][i % 6]);
await measure('infer-100000-paths', names, (engine, names) => names.map(name => engine.inferExtensionFromName(name)),
  { files: names.length, inputSha256: hash(JSON.stringify(names)) });
const resolvers = Object.fromEntries(Object.entries(engines).map(([name, engine]) => [name, engine.createFormatRouteResolver()]));
await measure('resolve-100000-paths', names, (engine, names) => {
  const resolve = resolvers[engine === engines.baseline ? 'baseline' : 'current'];
  return names.map(name => resolve({ name }));
}, { files: names.length, inputSha256: hash(JSON.stringify(names)) });

for (const count of [1000, 20000]) {
  const bytes = zipSync(Object.fromEntries(Array.from({ length: count }, (_, i) => [
    `document/parts/section-${i}/content.xml`, [strToU8(`Part ${i}`), { mtime: new Date('2020-01-01T00:00:00Z') }]
  ])), { level: 1 });
  const metadata = { entries: count, archiveBytes: bytes.length, archiveSha256: hash(bytes) };
  await measure(`zip-index-${count}`, bytes, async (engine, bytes) =>
    [...(await engine.openZipArchive(bytes)).values()].map(({ name, directory, size, modified }) => ({ name, directory, size, modified })), metadata);
  if (count === 1000) await measure('zip-read-1000', bytes, async (engine, bytes) => {
    const values = [];
    for (const entry of (await engine.openZipArchive(bytes)).values()) values.push({ name: entry.name, text: await entry.text() });
    return values;
  }, metadata);
}

const xml = '<parts>' + Array.from({ length: 20000 }, (_, i) =>
  `<part id="${i}" type="shape"><name>Shape ${i}</name><empty/><value>${i}</value><value>${i + 1}</value></part>`).join('') + '</parts>';
await measure('xml-ordered-and-lookup-20000', xml, async (engine, source) => {
  const file = { async: async () => source }, archive = { file: () => file };
  return { lookup: await engine.xml.parseXmlFile(archive, 'part.xml'), ordered: await engine.xml.parseXmlFileOrdered(archive, 'part.xml') };
}, { parts: 20000, inputBytes: Buffer.byteLength(xml), inputSha256: hash(xml), includes: 'tokenization and lookup grouping; no ZIP or byte decoding' });
for (const file of ['sample-deck.pptx', 'rich-pptx-shapes.pptx']) {
  const bytes = new Uint8Array(await readFile(`apps/demo/public/samples/${file}`));
  await measure(`pptx-${file}`, bytes, (engine, bytes) => engine.loadPptx(bytes),
    { archiveBytes: bytes.length, archiveSha256: hash(bytes), includes: 'complete loadPptx model; no rendering or module import; fresh entry module resets generated IDs before each timed invocation' },
    (name, iteration) => {
      const directory = name === 'baseline' ? path.join(baseline, 'core-dist') : 'packages/core/dist';
      return import(`${pathToFileURL(path.resolve(directory, 'index.js')).href}?shared-readers=${file}-${iteration}`);
    });
}
await writeFile(output, JSON.stringify(result, null, 2) + '\n');
console.log(JSON.stringify(Object.fromEntries(Object.entries(result.cases).map(([name, row]) =>
  [name, Object.fromEntries(Object.entries(row.timings).map(([engine, value]) => [engine, value.medianMs]))])), null, 2));
