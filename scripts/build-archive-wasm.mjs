// Rebuild the replaceable, always-external read-only archive engine.
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { chmod, copyFile, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const vendor = path.join(root, 'packages/archive/vendor/7zip');
const manifest = JSON.parse(await readFile(path.join(vendor, 'manifest.json'), 'utf8'));
const version = await run('emcc', ['--version']);
if (version.split('\n')[0].match(/\) (\d+\.\d+\.\d+)(?:-git)?(?:\s|$)/)?.[1] !== manifest.emscripten) throw new Error(`Use Emscripten ${manifest.emscripten}.`);
const work = await mkdtemp(path.join(os.tmpdir(), 'filens-7zip-'));
try {
  const source = path.join(work, 'source');
  await run('git', ['clone', '--quiet', '--no-checkout', '--depth=1', '--branch=24.09',
    process.env.FILENS_7ZIP_SOURCE || manifest.repository, source]);
  await run('git', ['checkout', '--quiet', '--detach', manifest.commit], source);
  if ((await run('git', ['rev-parse', 'HEAD'], source)).trim() !== manifest.commit) throw new Error('Unexpected 7-Zip source revision.');
  await run('git', ['apply', path.join(vendor, '7zip-24.09.patch')], source);
  const bundle = path.join(source, 'CPP/7zip/Bundles/Alone2');
  await writeFile(path.join(bundle, 'makefile.filens'), 'include ./makefile.gcc\nPROG = 7zz.js\n');
  await writeFile(path.join(bundle, 'pre.js'), 'Module.noInitialRun = true;\n');
  await writeFile(path.join(bundle, 'post.js'), 'Module.FS = FS;\nModule.callMain = callMain;\n');
  // Keep every upstream decoder/crypto object. Extraction-only guards and LTO
  // remove writers; only archive handlers outside the public API are omitted.
  await run('make', ['-j8', '-f', 'makefile.filens', 'O=_filens', 'EMSCRIPTEN=1', 'ST_MODE=1', 'CC=emcc', 'CXX=em++',
    'LOCAL_FLAGS=-DZ7_ST -DZ7_EXTRACT_ONLY',
    'CFLAGS_BASE=-O3 -c -DNDEBUG -D_REENTRANT -D_FILE_OFFSET_BITS=64 -D_LARGEFILE_SOURCE -fPIC',
    'FLAGS_FLTO=-flto', 'LFLAGS_NOEXECSTACK=', 'LIB2=',
    'AR_OBJS=$(O)/SplitHandler.o $(O)/Bz2Handler.o $(O)/XzHandler.o $(O)/LzmaHandler.o $(O)/ZstdHandler.o $(O)/ZHandler.o $(O)/ArHandler.o $(O)/CpioHandler.o $(O)/LzhHandler.o $(O)/RpmHandler.o $(O)/HandlerCont.o $(O)/XarHandler.o',
    ...['CHM', 'COM', 'NSIS', 'TAR'].map(name => `${name}_OBJS=`),
    'WIM_OBJS=$(O)/WimHandler.o $(O)/WimIn.o $(O)/WimRegister.o',
    'ZIP_OBJS=$(O)/ZipHandler.o $(O)/ZipIn.o $(O)/ZipItem.o $(O)/ZipRegister.o',
    'LDFLAGS_EMCC=-O3 -sEXPORTED_RUNTIME_METHODS=FS,callMain -sALLOW_MEMORY_GROWTH=1 -sMODULARIZE=1 -sEXPORT_ES6=1 -sEXPORT_NAME=SevenZip --post-js post.js --pre-js pre.js'
  ], bundle);
  const hashes = {};
  for (const file of ['7zz.js', '7zz.wasm']) {
    hashes[file] = createHash('sha256').update(await readFile(path.join(bundle, '_filens', file))).digest('hex');
  }
  hashes['7zip-24.09.patch'] = createHash('sha256').update(await readFile(path.join(vendor, '7zip-24.09.patch'))).digest('hex');
  if (process.argv.includes('--check')) {
    for (const [file, hash] of Object.entries(hashes)) {
      if (hash !== manifest.sha256[file]) throw new Error(`Rebuild differs: ${file}`);
    }
  } else {
    await mkdir(vendor, { recursive: true });
    for (const file of ['7zz.js', '7zz.wasm']) {
      await copyFile(path.join(bundle, '_filens', file), path.join(vendor, file));
      await chmod(path.join(vendor, file), 0o644);
    }
    await writeFile(path.join(vendor, 'manifest.json'), `${JSON.stringify({ ...manifest, sha256: hashes }, null, 2)}\n`);
  }
  console.log(`7-Zip ${manifest.version}: -O3 read-only engine ${process.argv.includes('--check') ? 'reproduced exactly' : 'rebuilt'}.`);
} finally {
  await rm(work, { recursive: true, force: true });
}

function run(command, args, cwd) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd, stdio: ['ignore', 'pipe', 'pipe'] });
    let output = '', errors = '';
    child.stdout.on('data', chunk => { output += chunk; });
    child.stderr.on('data', chunk => { errors += chunk; });
    child.on('error', reject);
    child.on('exit', code => code === 0 ? resolve(output) : reject(new Error(`${command} exited with ${code}\n${errors}\n${output.slice(-4000)}`)));
  });
}
