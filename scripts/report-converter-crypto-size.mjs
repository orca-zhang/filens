import { spawn } from 'node:child_process';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { brotliCompressSync, constants, gzipSync } from 'node:zlib';
import { privateRustBuildEnv } from './agent-release-privacy.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const crate = path.join(root, 'wasm/converter-core-rust');
const target = path.join(crate, 'target/crypto-size');
const variants = [
  { name: 'default crypto', flags: [] },
  { name: 'compact AES', flags: ['--cfg=aes_backend_soft="compact"'] },
  { name: 'compact SHA-2', flags: ['--cfg=sha2_backend_soft="compact"'] },
  { name: 'compact AES and SHA-2', flags: ['--cfg=aes_backend_soft="compact"', '--cfg=sha2_backend_soft="compact"'] },
  { name: 'compact AES and SHA-2, LLVM s', flags: ['--cfg=aes_backend_soft="compact"', '--cfg=sha2_backend_soft="compact"'], optLevel: 's' }
];
const rows = [];
await mkdir(target, { recursive: true });
for (const variant of variants) {
  const env = privateRustBuildEnv(root);
  if (variant.flags.length) env.CARGO_ENCODED_RUSTFLAGS += '\x1f' + variant.flags.join('\x1f');
  env.CARGO_TARGET_DIR = target;
  if (variant.optLevel) env.CARGO_PROFILE_RELEASE_OPT_LEVEL = variant.optLevel;
  await run('cargo', ['build', '--locked', '--release', '--target', 'wasm32-wasip1', '--bin', 'converter-core', '--features', 'office-crypto'], crate, env);
  const name = variant.name.toLowerCase().replace(/[^a-z0-9]+/g, '-');
  const output = path.join(target, `${name}.wasm`);
  await run(process.execPath, [path.join(root, 'node_modules/binaryen/bin/wasm-opt'),
    path.join(target, 'wasm32-wasip1/release/converter-core.wasm'), '-Oz', '--converge',
    '--enable-bulk-memory', '--enable-nontrapping-float-to-int', '--strip-debug', '--strip-producers', '-o', output], root, env);
  const bytes = await readFile(output);
  rows.push({ name: variant.name, file: path.relative(root, output), raw: bytes.length,
    gzip: gzipSync(bytes, { level: 9 }).length,
    brotli: brotliCompressSync(bytes, { params: { [constants.BROTLI_PARAM_QUALITY]: 11 } }).length });
  console.log(JSON.stringify(rows.at(-1)));
}
await writeFile(path.join(root, 'docs/converter-crypto-size.json'), `${JSON.stringify({
  unit: 'bytes', scope: 'Combined WASM with all Office algorithms and conversion routes retained. Compare the upstream RustCrypto compact AES and SHA-2 backends; Binaryen -Oz --converge. These are size candidates, not production configuration.', rows
}, null, 2)}\n`);
console.table(rows);

function run(command, args, cwd, env) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd, env, stdio: ['ignore', 'ignore', 'inherit'] });
    child.on('error', reject);
    child.on('exit', code => code === 0 ? resolve() : reject(new Error(`${command} exited ${code}`)));
  });
}
