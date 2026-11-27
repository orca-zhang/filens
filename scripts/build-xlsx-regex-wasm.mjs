import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const version = '10.49';
const url = `https://github.com/PCRE2Project/pcre2/releases/download/pcre2-${version}/pcre2-${version}.tar.gz`;
const sdk = path.resolve(process.env.WASI_SDK_PATH || '/opt/wasi-sdk');
const clang = path.join(sdk, 'bin', 'clang');
assert.match(execFileSync(clang, ['--version'], { encoding: 'utf8' }), /^clang version 20\.1\.8-wasi-sdk/);
const vendor = fileURLToPath(new URL('../packages/xlsx/vendor/pcre2/', import.meta.url));
const work = await mkdtemp(path.join(os.tmpdir(), 'filens-pcre2-'));
try {
  const archive = path.join(work, 'source.tar.gz');
  execFileSync('curl', ['-fsSL', '--max-time', '120', url, '-o', archive]);
  assert.equal(createHash('sha256').update(await readFile(archive)).digest('hex'),
    '929f0b20e62879252a15886b06c89f1edef61a363cbd5826fb041080a5e557ae');
  execFileSync('tar', ['-xf', archive, '-C', work]);
  const source = path.join(work, `pcre2-${version}`);
  const build = path.join(work, 'build');
  execFileSync('cmake', ['-S', source, '-B', build,
    `-DCMAKE_TOOLCHAIN_FILE=${path.join(sdk, 'share/cmake/wasi-sdk.cmake')}`,
    '-DCMAKE_BUILD_TYPE=MinSizeRel', '-DCMAKE_C_FLAGS_MINSIZEREL=-Oz -flto -DNDEBUG',
    '-DPCRE2_BUILD_TESTS=OFF', '-DPCRE2_BUILD_PCRE2GREP=OFF', '-DPCRE2_BUILD_PCRE2_8=OFF',
    '-DPCRE2_BUILD_PCRE2_16=ON', '-DPCRE2_SUPPORT_UNICODE=ON', '-DPCRE2_SUPPORT_JIT=OFF',
    '-DPCRE2_PARENS_NEST_LIMIT=128'], { stdio: 'inherit' });
  execFileSync('cmake', ['--build', build, '--parallel'], { stdio: 'inherit' });
  const exports = ['malloc', 'free', 'reset_budget', 'compile_pattern', 'create_match', 'run_match', 'substitute_text',
    ...['get_ovector_pointer', 'get_ovector_count', 'match_data_free', 'code_free'].map(name => `pcre2_${name}_16`)];
  const output = path.join(work, 'pcre2.wasm');
  execFileSync(clang, ['-mexec-model=reactor', '-Oz', '-flto', '-DPCRE2_CODE_UNIT_WIDTH=16', `-I${build}/interface`,
    path.join(vendor, 'engine.c'), path.join(build, 'libpcre2-16.a'), '-Wl,--strip-all,--max-memory=8388608',
    ...exports.map(name => `-Wl,--export=${name}`), '-o', output]);
  const wasm = await readFile(output);
  const module = new WebAssembly.Module(wasm);
  assert.deepEqual(WebAssembly.Module.imports(module), [
    { module: 'wasi_snapshot_preview1', name: 'random_get', kind: 'function' }
  ]);
  const files = [['pcre2.wasm', wasm], ['LICENCE.md', await readFile(path.join(source, 'LICENCE.md'))]];
  for (const [name, bytes] of files) {
    const destination = path.join(vendor, name);
    if (process.argv.includes('--check')) assert.deepEqual(bytes, await readFile(destination), name);
    else await writeFile(destination, bytes);
  }
  console.log(`PCRE2 ${version} WASM (${wasm.length} bytes)`);
} finally {
  await rm(work, { recursive: true, force: true });
}
