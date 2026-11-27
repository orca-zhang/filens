import { execFileSync } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const vendor = fileURLToPath(new URL('../packages/pptx/vendor/libeot/', import.meta.url));
const sdk = process.env.WASI_SDK_PATH ?? '/opt/wasi-sdk';
const clang = path.join(sdk, 'bin', 'clang');
if (!execFileSync(clang, ['--version'], { encoding: 'utf8' }).startsWith('clang version 20.1.8-wasi-sdk')) {
  throw new Error('Use WASI SDK 27.0 to rebuild the PPTX font decoder.');
}
const work = await mkdtemp(path.join(os.tmpdir(), 'filens-libeot-'));
try {
  const repository = 'https://github.com/umanwizard/libeot.git';
  const source = path.join(work, 'libeot');
  execFileSync('git', ['-c', 'advice.detachedHead=false', 'clone', '--quiet', '--depth=1', '--branch', 'v0.0.4', repository, source]);
  if (execFileSync('git', ['-C', source, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim()
    !== '864bf4578ffe70cf6662fb8344b731879ebaab95') throw new Error('Unexpected libeot revision.');
  const compiled = path.join(work, 'libeot.wasm');
  execFileSync(clang, ['-Oz', '-flto', '-DDECOMPRESS_ON', '-mexec-model=reactor', '-Iinc', '-Isrc', `-I${vendor}`,
    '-Wl,--export=malloc,--export=decode,--export=decoded_size,--max-memory=134217728,--strip-all',
    ...['writeFontFile.c', 'triplet_encodings.c', 'ctf/parseCTF.c', 'ctf/parseTTF.c', 'ctf/SFNTContainer.c',
      'util/stream.c', 'lzcomp/ahuff.c', 'lzcomp/bitio.c', 'lzcomp/liblzcomp.c', 'lzcomp/lzcomp.c', 'lzcomp/mtxmem.c']
      .map(file => `src/${file}`),
    path.join(vendor, 'decode.c'), '-o', compiled], { cwd: source, stdio: 'inherit' });
  const bytes = await readFile(compiled);
  const target = path.join(vendor, 'libeot.wasm');
  if (process.argv.includes('--check')) {
    if (!bytes.equals(await readFile(target))) throw new Error('PPTX font decoder rebuild differs.');
  } else {
    await writeFile(target, bytes);
  }
  console.log(`libeot WebAssembly size ${bytes.length} bytes`);
} finally {
  await rm(work, { recursive: true, force: true });
}
