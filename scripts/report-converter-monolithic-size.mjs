import { spawn } from 'node:child_process';
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { brotliCompressSync, constants, gzipSync } from 'node:zlib';
import { privateRustBuildEnv } from './agent-release-privacy.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const crate = path.join(root, 'wasm/converter-core-rust');
const work = await mkdtemp(path.join(os.tmpdir(), 'filens-monolithic-size-'));
const probe = path.join(work, 'wasm/converter-core-rust');
const target = path.join(crate, 'target/monolithic-size');
const rows = [];
const variants = [
  { name: 'original dependencies', zip: 'deflate', xml: '0.38.3' },
  { name: 'shared miniz deflate', zip: 'deflate-flate2', xml: '0.38.3' },
  { name: 'shared XML parser', zip: 'deflate', xml: '0.41.0' },
  { name: 'shared miniz and XML', zip: 'deflate-flate2', xml: '0.41.0' }
];

try {
  await mkdir(probe, { recursive: true });
  for (const name of ['src', 'Cargo.toml', 'Cargo.lock']) await cp(path.join(crate, name), path.join(probe, name), { recursive: true });
  for (const name of ['converter-core', 'converter-image']) {
    const relative = `wasm/${name}/manifest/conversions.json`;
    await mkdir(path.dirname(path.join(work, relative)), { recursive: true });
    await cp(path.join(root, relative), path.join(work, relative));
  }
  const manifest = await readFile(path.join(probe, 'Cargo.toml'), 'utf8');
  for (const variant of variants) {
    await writeFile(path.join(probe, 'Cargo.toml'), manifest
      .replace(/^quick-xml = ".*"$/m, `quick-xml = "${variant.xml}"`)
      .replace(/^(zip = .*features = \[)"[^"]+"(\] \})$/m, `$1"${variant.zip}"$2`));
    // Keep the existing lock resolutions; only update edges affected by these
    // two dependency settings, using already cached registry sources.
    await run('cargo', ['build', '--offline', '--release', '--target', 'wasm32-wasip1', '--bin', 'converter-core', '--features', 'office-crypto'], probe);
    const input = path.join(target, 'wasm32-wasip1/release/converter-core.wasm');
    const optimizations = variant === variants.at(-1)
      ? [{ name: '-Oz', args: ['-Oz'] }, { name: '-Oz converge', args: ['-Oz', '--converge'] }, { name: '-Os', args: ['-Os'] }]
      : [{ name: '-Oz', args: ['-Oz'] }];
    for (const optimization of optimizations) {
      const output = path.join(work, 'optimized.wasm');
      await run(process.execPath, [path.join(root, 'node_modules/binaryen/bin/wasm-opt'), input, ...optimization.args,
        '--enable-bulk-memory', '--enable-nontrapping-float-to-int', '--strip-debug', '--strip-producers', '-o', output], root);
      const bytes = await readFile(output);
      rows.push({ name: `${variant.name} / ${optimization.name}`, raw: bytes.length,
        gzip: gzipSync(bytes, { level: 9 }).length,
        brotli: brotliCompressSync(bytes, { params: { [constants.BROTLI_PARAM_QUALITY]: 11 } }).length });
      console.log(JSON.stringify(rows.at(-1)));
    }
  }
  const report = { unit: 'bytes', scope: 'Single WASM, including modern and legacy Office cryptography and application icons. Same current source, release profile and full features. Temporary builds vary ZIP compression backend, XML parser version and Binaryen optimization; no production artifacts are overwritten.', rows };
  await writeFile(path.join(root, 'docs/converter-monolithic-size.json'), `${JSON.stringify(report, null, 2)}\n`);
  console.table(rows);
} finally { await rm(work, { recursive: true, force: true }); }

function run(command, args, cwd) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd, env: { ...privateRustBuildEnv(root), CARGO_TARGET_DIR: target }, stdio: ['ignore', 'ignore', 'inherit'] });
    child.on('error', reject);
    child.on('exit', code => code === 0 ? resolve() : reject(new Error(`${command} exited ${code}`)));
  });
}
