import { spawn } from 'node:child_process';
import { copyFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { privateRustBuildEnv } from './agent-release-privacy.mjs';
import { checkPostscriptSize } from './check-postscript-size.mjs';

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const wasmOpt = path.join(rootDir, 'node_modules', 'binaryen', 'bin', 'wasm-opt');
const converters = [
  {
    name: 'converter-core',
    cargoArgs: ['--no-default-features'],
    crateDir: path.join(rootDir, 'wasm', 'converter-core-rust'),
    outputDir: path.join(rootDir, 'wasm', 'converter-core', 'dist')
  },
  {
    name: 'converter-postscript',
    cargoArgs: ['--no-default-features', '--features', 'postscript'],
    crateDir: path.join(rootDir, 'wasm', 'converter-core-rust'),
    outputDir: path.join(rootDir, 'wasm', 'converter-core', 'dist')
  },
  {
    name: 'converter-graphics',
    optimization: '-Oz',
    cargoArgs: ['--no-default-features', '--features', 'graphics-preview'],
    crateDir: path.join(rootDir, 'wasm', 'converter-core-rust'),
    outputDir: path.join(rootDir, 'wasm', 'converter-core', 'dist')
  },
  {
    name: 'converter-office',
    cargoArgs: ['--no-default-features', '--features', 'office-crypto'],
    crateDir: path.join(rootDir, 'wasm', 'converter-core-rust'),
    outputDir: path.join(rootDir, 'wasm', 'converter-core', 'dist')
  },
  {
    name: 'converter-core',
    outputName: 'converter-core-full',
    optimization: '-Oz',
    cargoArgs: ['--features', 'office-crypto,postscript,graphics-preview'],
    crateDir: path.join(rootDir, 'wasm', 'converter-core-rust'),
    outputDir: path.join(rootDir, 'wasm', 'converter-core', 'dist')
  },
  {
    name: 'converter-image',
    optimization: '-O3',
    crateDir: path.join(rootDir, 'wasm', 'converter-image-rust'),
    outputDir: path.join(rootDir, 'wasm', 'converter-image', 'dist')
  }
];

for (const converter of converters) {
  const inputPath = path.join(
    converter.crateDir,
    'target',
    'wasm32-wasip1',
    'release',
    `${converter.name}.wasm`
  );
  const outputPath = path.join(converter.outputDir, `${converter.outputName ?? converter.name}.wasm`);
  await mkdir(converter.outputDir, { recursive: true });
  await run(
    process.platform === 'win32' ? 'cargo.exe' : 'cargo',
    ['build', '--locked', '--release', '--target', 'wasm32-wasip1', '--bin', converter.name, ...(converter.cargoArgs ?? [])],
    converter.crateDir
  );
  await run(process.execPath, [
    wasmOpt,
    inputPath,
    converter.optimization ?? '-Oz',
    ...(converter.optimization ? [] : ['--converge']),
    '--enable-bulk-memory',
    '--enable-nontrapping-float-to-int',
    '--strip-debug',
    '--strip-producers',
    '-o',
    outputPath
  ], rootDir);
  console.log(`Built Rust production WASM -> ${path.relative(rootDir, outputPath)}`);
  if (converter.name === 'converter-postscript') await checkPostscriptSize();
}
await copyFile(path.join(rootDir, 'wasm/converter-core/THIRD-PARTY-NOTICES.txt'),
  path.join(rootDir, 'wasm/converter-core/dist/THIRD-PARTY-NOTICES.txt'));

function run(command, args, cwd) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd, env: privateRustBuildEnv(rootDir), stdio: 'inherit' });
    child.on('error', reject);
    child.on('exit', (code) => code === 0 ? resolve() : reject(new Error(`${command} exited with ${code ?? 1}`)));
  });
}
