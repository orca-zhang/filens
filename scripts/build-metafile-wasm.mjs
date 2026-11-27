import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { privateRustBuildEnv, privacyIssues } from './agent-release-privacy.mjs';

const root = fileURLToPath(new URL('../', import.meta.url)).replace(/[\\/]$/, '');
const crate = path.join(root, 'wasm/converter-metafile-rust');
const target = path.join(crate, 'target');
const input = path.join(target, 'wasm32-unknown-unknown/release/converter_metafile.wasm');
const optimized = path.join(target, 'metafile.wasm');
const destination = path.join(root, 'packages/core/vendor/metafile/metafile.wasm');
const env = privateRustBuildEnv(root);
env.CARGO_ENCODED_RUSTFLAGS += '\x1f-C\x1flink-arg=--max-memory=134217728';
execFileSync('cargo', ['build', '--locked', '--release', '--lib', '--target', 'wasm32-unknown-unknown', '--target-dir', target], {
  cwd: crate, env, stdio: 'inherit'
});
execFileSync(process.execPath, [path.join(root, 'node_modules/binaryen/bin/wasm-opt'), input,
  '-Oz', '--converge', '--enable-bulk-memory', '--enable-sign-ext', '--enable-mutable-globals',
  '--enable-nontrapping-float-to-int', '--strip-debug', '--strip-producers', '-o', optimized], { stdio: 'inherit' });
const bytes = await readFile(optimized);
assert.deepEqual(privacyIssues(bytes), [], 'Metafile decoder contains a build path or secret');
assert.deepEqual(WebAssembly.Module.imports(await WebAssembly.compile(bytes)), [], 'Metafile decoder must be self-contained');
if (process.argv.includes('--check')) assert.ok(bytes.equals(await readFile(destination)), 'Metafile decoder rebuild differs');
else await writeFile(destination, bytes);
console.log(`Metafile decoder WebAssembly size ${bytes.length} bytes`);
