// Controlled runtime-size comparison. Declaration generation is excluded.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { gunzipSync, gzipSync } from 'node:zlib';
import { build, loadConfigFromFile } from 'vite';

const option = (name, fallback) => {
  const index = process.argv.indexOf(name);
  return index < 0 ? fallback : process.argv[index + 1];
};
const baselinePath = option('--baseline', 'benchmarks/frontend/2026-11-04/text-layers-resources-source-baseline.json.gz');
const output = option('--output', 'tmp/text-layers-resources-size/results.json');
const work = path.dirname(output);
await mkdir(work, { recursive: true });
const savedBytes = await readFile(baselinePath);
const baselineBytes = baselinePath.endsWith('.gz') ? gunzipSync(savedBytes) : savedBytes;
const sources = JSON.parse(baselineBytes).files;
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const result = { date: new Date().toISOString(), node: process.version, baselineSha256: sha(baselineBytes),
  method: 'Identical package Vite configurations and current dependencies, baseline source overrides in both main and worker builds. Declarations/maps excluded. All runtime JS/CSS counted; gzip sizes summed per artifact. Current output hashes must match actual package dist.',
  packages: {}, sourceSha256: {}, baselineSourceSha256: {} };
for (const [file, source] of Object.entries(sources)) {
  result.sourceSha256[file] = sha(await readFile(file));
  result.baselineSourceSha256[file] = sha(source);
}
async function listFiles(directory, relative = '') {
  const files = [];
  for (const entry of await readdir(path.join(directory, relative), { withFileTypes: true })) {
    const file = path.join(relative, entry.name);
    if (entry.isDirectory()) files.push(...await listFiles(directory, file));
    else files.push(file);
  }
  return files.sort();
}
for (const name of ['core', 'cad', 'iwork']) {
  const root = path.resolve('packages', name);
  const { config } = await loadConfigFromFile({ command: 'build', mode: 'production' }, path.join(root, 'vite.config.ts'));
  const row = result.packages[name] = {};
  for (const engine of ['baseline', 'current']) {
    const outDir = path.resolve(work, `${name}-${engine}`);
    const sourcePlugin = () => ({ name: 'saved-comparison-source', enforce: 'pre', load(id) {
      const source = sources[path.relative(process.cwd(), id)];
      return engine === 'baseline' && source !== undefined ? source : undefined;
    } });
    await build({ ...config, root, configFile: false, logLevel: 'error', plugins: [sourcePlugin()],
      worker: { ...config.worker, plugins: () => [sourcePlugin()] },
      build: { ...config.build, outDir, sourcemap: false, emptyOutDir: true, reportCompressedSize: false } });
    const files = [];
    for (const file of (await listFiles(outDir)).filter(file => /\.(js|css)$/.test(file))) {
      const bytes = await readFile(path.join(outDir, file));
      const hash = sha(bytes);
      if (engine === 'current') {
        // Production renames style.css to index.css after Vite.
        assert.equal(sha(await readFile(path.join(root, 'dist', file === 'style.css' ? 'index.css' : file))), hash,
          `${name}/${file} differs from actual dist`);
      }
      files.push({ file, bytes: bytes.length, gzipBytes: gzipSync(bytes).length, sha256: hash });
    }
    row[engine] = { bytes: files.reduce((sum, file) => sum + file.bytes, 0),
      gzipBytes: files.reduce((sum, file) => sum + file.gzipBytes, 0), files };
  }
  console.log(JSON.stringify({ name, baseline: row.baseline.bytes, current: row.current.bytes,
    baselineGzip: row.baseline.gzipBytes, currentGzip: row.current.gzipBytes }));
}
await writeFile(output, JSON.stringify(result, null, 2) + '\n');
console.log('PASS: current main/worker runtime hashes match production dist.');
