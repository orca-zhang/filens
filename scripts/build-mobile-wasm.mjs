import { spawn } from 'node:child_process';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { privateRustBuildEnv, privacyIssues } from './agent-release-privacy.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const target = path.join(root, 'tmp/mobile-wasm-target');
const env = privateRustBuildEnv(root);
// Rebuild std with the same abort behavior but without unused panic formatting.
env.RUSTC_BOOTSTRAP = '1';
env.CARGO_ENCODED_RUSTFLAGS += '\x1f-Zunstable-options\x1f-Cpanic=immediate-abort';
env.CARGO_TARGET_DIR = target;
for (const [crate, binary, destination, features, optimization] of [
  ['converter-core-rust', 'converter-core', 'converter-core', ['--no-default-features', '--features', 'office-crypto,postscript,graphics-preview'], '-Oz'],
  ['converter-image-rust', 'converter-image', 'converter-image', [], '-O3']
]) {
  await run('cargo', ['+1.93.0', 'build', '--locked', '--release', '--target', 'wasm32-wasip1', '--bin', binary,
    ...features, '-Zbuild-std=std,panic_abort'], path.join(root, 'wasm', crate), env);
  const directory = path.join(root, 'wasm', destination, 'dist');
  await mkdir(directory, { recursive: true });
  const output = path.join(directory, `${binary}-mobile.wasm`);
  await run(process.execPath, [path.join(root, 'node_modules/binaryen/bin/wasm-opt'),
    path.join(target, 'wasm32-wasip1/release', `${binary}.wasm`), optimization,
    ...(optimization === '-Oz' ? ['--converge'] : []), '--enable-bulk-memory', '--enable-nontrapping-float-to-int',
    '--strip-debug', '--strip-producers', '-o', output], root, process.env);
  const issues = privacyIssues(await readFile(output));
  if (issues.length) throw new Error(`Mobile WASM privacy check failed: ${issues.join(', ')}`);
  await writeFile(path.join(directory, `${binary}-mobile.json`), `${JSON.stringify({
    compiler: 'Rust 1.93.0', target: 'wasm32-wasip1', panic: 'immediate-abort', optimization,
    scope: 'Same complete preview conversions and validation; unused standard-library panic formatting is omitted.'
  }, null, 2)}\n`);
  console.log(`Built ${path.relative(root, output)}`);
}

function run(command, args, cwd, env) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd, env, stdio: 'inherit' });
    child.on('error', reject);
    child.on('exit', code => code === 0 ? resolve() : reject(new Error(`Mobile WASM build failed; ensure Rust 1.93.0 and rust-src are installed (${code}).`)));
  });
}
