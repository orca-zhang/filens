// Run after sourcing Emscripten 3.1.61's emsdk_env.sh. Build only the HEVC
// decoder, using unmodified upstream sources with verified archive hashes.
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { copyFile, mkdir, readFile, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { privacyIssues } from './agent-release-privacy.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const work = path.join(root, 'tmp', 'heif-decoder-build');
const vendor = path.join(root, 'packages/converter-client/vendor/libheif');
const revision = '413e2a87e6a70b3eccc3a3adc5801179dd2d9e00';
const jobs = String(Math.min(4, os.availableParallelism()));

function run(command, args, cwd = work) {
  const result = spawnSync(command, args, { cwd, stdio: 'inherit' });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`${command} exited with ${result.status}`);
}

await mkdir(work, { recursive: true });
const version = spawnSync('emcc', ['--version'], { encoding: 'utf8' });
if (version.status !== 0 || !version.stdout.includes('3.1.61')) {
  throw new Error('Source Emscripten 3.1.61 emsdk_env.sh before rebuilding.');
}
for (const [name, url, hash] of [
  ['libheif', `https://codeload.github.com/strukturag/libheif/tar.gz/${revision}`,
    'ef8e86a4e5670b7338a58b17553e306b8be88e506587b265dfdfe44495896999'],
  ['libde265', 'https://github.com/strukturag/libde265/releases/download/v1.0.18/libde265-1.0.18.tar.gz',
    '800478f3bf35f0621b14928ceb317579f3e8b23de4bd2aac29b6cb8be962bbd8']
]) {
  const archive = path.join(work, `${name}.tar.gz`);
  let bytes;
  try { bytes = await readFile(archive); } catch {
    const response = await fetch(url);
    if (!response.ok) throw new Error(`${name} source download failed: ${response.status}`);
    bytes = Buffer.from(await response.arrayBuffer());
    await writeFile(archive, bytes);
  }
  if (createHash('sha256').update(bytes).digest('hex') !== hash) throw new Error(`${name} source hash mismatch`);
  await mkdir(path.join(work, name), { recursive: true });
  run('tar', ['-xzf', archive, '--strip-components=1', '-C', path.join(work, name)]);
}

const prefix = `-ffile-prefix-map=${root}=/filens-source -ffile-prefix-map=${os.homedir()}=/toolchain-cache`;
const compilerFlags = [`-DCMAKE_C_FLAGS=${prefix}`, `-DCMAKE_CXX_FLAGS=${prefix}`];
const de265 = path.join(work, 'libde265');
const de265Build = path.join(work, 'de265-build');
run('emcmake', ['cmake', '-S', de265, '-B', de265Build, '-DCMAKE_BUILD_TYPE=Release',
  '-DBUILD_SHARED_LIBS=OFF', '-DENABLE_DECODER=OFF', '-DENABLE_SDL=OFF', ...compilerFlags]);
run('cmake', ['--build', de265Build, '--parallel', jobs]);

const heif = path.join(work, 'libheif');
const heifBuild = path.join(work, 'heif-build');
// libde265 keeps its generated version header in the build tree.
await copyFile(path.join(de265Build, 'libde265/de265-version.h'), path.join(de265, 'libde265/de265-version.h'));
const decoderArchive = path.join(de265Build, 'libde265/libde265.a');
run('emcmake', ['cmake', '-S', heif, '-B', heifBuild, '-DCMAKE_BUILD_TYPE=Release',
  '-DBUILD_TESTING=OFF', '-DWITH_EXAMPLES=OFF', '-DWITH_GDK_PIXBUF=OFF',
  '-DENABLE_MULTITHREADING_SUPPORT=OFF', '-DBUILD_SHARED_LIBS=OFF', '-DENABLE_PLUGIN_LOADING=OFF',
  '-DWITH_LIBDE265=ON', '-DWITH_AOM_DECODER=OFF', '-DWITH_AOM_ENCODER=OFF',
  `-DLIBDE265_INCLUDE_DIR=${de265}`, `-DLIBDE265_LIBRARY=${decoderArchive}`, ...compilerFlags]);
run('cmake', ['--build', heifBuild, '--target', 'heif', '--parallel', jobs]);

const library = path.join(heifBuild, 'libheif/libheif.a');
const nm = path.join(process.env.EMSDK, 'upstream/bin/llvm-nm');
const symbols = spawnSync(nm, [library, '--format=just-symbols'], { encoding: 'utf8' });
if (symbols.status !== 0) throw new Error('Unable to collect libheif exports');
const exports = [...new Set(symbols.stdout.split(/\r?\n/).filter(name => /^(heif_|de265_)\w+$/.test(name)).map(name => `_${name}`)), '_free', '_malloc', '_memcpy'];
await mkdir(vendor, { recursive: true });
run('emcc', ['-Wl,--whole-archive', library, '-Wl,--no-whole-archive', decoderArchive, '-lembind',
  `-sEXPORTED_FUNCTIONS=${JSON.stringify(exports)}`, '-sMODULARIZE', '-sEXPORT_NAME=libheif',
  '-sWASM_ASYNC_COMPILATION=0', '-sALLOW_MEMORY_GROWTH', '-sEXPORT_ES6', '-sDYNAMIC_EXECUTION=0',
  '--post-js', path.join(heif, 'post.js'), '-std=c++11', '-O3', '-o', path.join(work, 'libheif.js')]);
// Filens always supplies wasmBinary from its separate lazy asset. Prevent Vite
// from embedding another copy via Emscripten's unused fallback URL in a worker.
const gluePath = path.join(work, 'libheif.js');
let glue = await readFile(gluePath, 'utf8');
for (const value of ['libheif.wasm', './']) {
  glue = glue.replaceAll(`new URL("${value}",import.meta.url)`, `new URL(/* @vite-ignore */"${value}",import.meta.url)`);
}
await writeFile(gluePath, glue);
for (const name of ['libheif.js', 'libheif.wasm']) {
  const bytes = await readFile(path.join(work, name));
  const issues = privacyIssues(bytes);
  if (issues.length) throw new Error(`Generated ${name}: ${issues.join(', ')}`);
}
for (const name of ['libheif.js', 'libheif.wasm']) await copyFile(path.join(work, name), path.join(vendor, name));
await copyFile(path.join(heif, 'COPYING'), path.join(vendor, 'COPYING.libheif'));
await copyFile(path.join(de265, 'COPYING'), path.join(vendor, 'COPYING.libde265'));
console.log('Rebuilt libheif 1.23.5 + libde265 1.0.18. Run converter-client tests and build.');
