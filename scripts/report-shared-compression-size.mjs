// Compare compression integration with identical application sources and WASM.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { brotliCompressSync, gzipSync } from 'node:zlib';
import { build, loadConfigFromFile } from 'vite';

const baselineIndex = process.argv.indexOf('--baseline');
const baseline = baselineIndex < 0 ? undefined : process.argv[baselineIndex + 1];
if (baselineIndex >= 0 && (!baseline || baseline.startsWith('--'))) throw new Error('--baseline requires a saved shared-compression.ts file.');
await mkdir(path.resolve('tmp'), { recursive: true });
const directory = await mkdtemp(path.resolve('tmp/compression-size-'));
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const sizes = bytes => ({ raw: Buffer.byteLength(bytes), gzip: gzipSync(bytes, { level: 9 }).length, brotli: brotliCompressSync(bytes).length });
const files = ['core', 'core-full', 'office', 'postscript', 'graphics'].map(name => `wasm/converter-core/dist/converter-${name}.wasm`);
files.push('wasm/converter-image/dist/converter-image.wasm');
const snapshots = new Map(await Promise.all(files.map(async file => [path.resolve(file), await readFile(file)])));
const result = { node: process.version, wasm: Object.fromEntries([...snapshots].map(([file, bytes]) => [path.relative('.', file), hash(bytes)])),
  bindings: { current: hash(await readFile('scripts/shared-compression.ts')), adapter: hash(await readFile('scripts/jszip-flate.mjs')) }, builds: {} };
try {
  let baselinePlugin;
  if (baseline) {
    result.bindings.baseline = hash(await readFile(baseline));
    const configFile = path.join(directory, 'baseline-vite.config.mjs');
    await writeFile(configFile, `import {sharedCompression} from ${JSON.stringify(path.resolve(baseline))};export default {plugins:[sharedCompression()]};`);
    baselinePlugin = (await loadConfigFromFile({ command: 'build', mode: 'production' }, configFile)).config.plugins[0];
  }
  for (const variant of ['split', 'all-in-one']) {
    process.env.FILENS_PREVIEW_BUILD = variant;
    const single = variant === 'all-in-one'; result.builds[variant] = {};
    for (const name of [...(baseline ? ['baseline'] : []), 'current']) {
      const { config } = await loadConfigFromFile({ command: 'build', mode: 'production' }, path.resolve('packages/preview/vite.config.ts'));
      if (name === 'baseline') config.plugins = config.plugins.map(plugin => plugin.name === 'filens-shared-compression' ? baselinePlugin : plugin);
      let hasPakoEncoder;
      config.plugins.unshift({
        name: 'frozen-converter-assets', enforce: 'pre',
        load(id) {
          if (!id.endsWith('?url')) return;
          const file = id.slice(0, -4); if (!snapshots.has(file)) return;
          if (single && /converter-(office|postscript|graphics)\.wasm$/.test(file)) return 'export default undefined;';
          const bytes = snapshots.get(single && file.endsWith('/converter-core.wasm') ? file.replace('/converter-core.wasm', '/converter-core-full.wasm') : file);
          if (single) return `export default ${JSON.stringify(`data:application/wasm+gzip;base64,${gzipSync(bytes, { level: 9 }).toString('base64')}`)};`;
          const reference = this.emitFile({ type: 'asset', name: path.basename(file), source: bytes });
          return `export default import.meta.ROLLUP_FILE_URL_${reference};`;
        },
        generateBundle() { hasPakoEncoder = [...this.getModuleIds()].some(id => /\/pako\/lib\/(?:zlib\/)?deflate\.js/.test(id.replaceAll('\\', '/'))); }
      });
      const built = await build({ ...config, configFile: false, root: path.resolve('packages/preview'), logLevel: 'silent', build: { ...config.build, write: false } });
      const output = (Array.isArray(built) ? built : [built]).flatMap(item => item.output);
      const chunks = new Map(output.filter(item => item.type === 'chunk').map(item => [item.fileName, item]));
      const startup = new Set();
      const visit = file => { if (startup.has(file) || !chunks.has(file)) return; startup.add(file); chunks.get(file).imports.forEach(visit); };
      visit('filens.js'); assert(startup.size > 0);
      const sum = values => values.reduce((total, value) => Object.fromEntries(Object.keys(total).map(key => [key, total[key] + value[key]])), { raw: 0, gzip: 0, brotli: 0 });
      assert.equal(hasPakoEncoder, name === 'baseline');
      result.builds[variant][name] = { startupJs: sum([...startup].map(file => sizes(chunks.get(file).code))),
        allJs: sum(output.filter(item => /\.m?js$/.test(item.fileName)).map(item => sizes(item.type === 'chunk' ? item.code : item.source))), hasPakoEncoder };
    }
  }
  console.log(JSON.stringify(result, null, 2));
} finally { await rm(directory, { recursive: true, force: true }); }
