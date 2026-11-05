// Standalone detector artifacts: SIMD by default, scalar for compatibility.
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { copyFile, mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { gzipSync } from 'node:zlib';
import { privateRustBuildEnv, privacyIssues } from './agent-release-privacy.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const index = process.argv.indexOf('--output');
const output = path.resolve(root, index < 0 ? 'wasm/format-detector/dist' : process.argv[index + 1]);
const crate = path.join(root, 'wasm/converter-core-rust');
const optimizer = path.join(root, 'node_modules/binaryen/bin/wasm-opt');
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const result = { defaultVariant: 'simd', fallbackVariant: 'scalar', sourceSha256: {}, variants: {} };
const sourceFiles = ['Cargo.toml', 'Cargo.lock', 'examples/detect_web.rs', 'src/format_detection.rs',
  'src/format_detection/probes.rs', 'src/format_detection/signatures.rs', 'src/format_detection/text_scan.rs'];
for (const file of sourceFiles) result.sourceSha256[file] = sha(await readFile(path.join(crate, file)));
await mkdir(output, { recursive: true });
async function run(command, args) {
  await new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd: root, env: { ...privateRustBuildEnv(root), CARGO_INCREMENTAL: '0' }, stdio: 'inherit' });
    child.on('error', reject);
    child.on('exit', code => code === 0 ? resolve() : reject(new Error(`${command} exited ${code}`)));
  });
}
for (const variant of ['scalar', 'simd']) {
  const features = 'format-detection-expanded' + (variant === 'simd' ? ',format-detection-simd' : '');
  await run('cargo', ['build', '--locked', '--release', '--manifest-path', path.join(crate, 'Cargo.toml'),
    '--no-default-features', '--features', features, '--example', 'detect-web', '--target', 'wasm32-wasip1']);
  const file = `converter-detect-${variant}.wasm`;
  await run(process.execPath, [optimizer, path.join(crate, 'target/wasm32-wasip1/release/examples/detect_web.wasm'),
    '-Oz', '--converge', '--enable-bulk-memory', '--enable-nontrapping-float-to-int',
    ...(variant === 'simd' ? ['--enable-simd'] : []), '--strip-debug', '--strip-producers', '-o', path.join(output, file)]);
  const bytes = await readFile(path.join(output, file));
  const issues = privacyIssues(bytes);
  if (issues.length) throw new Error(`Detector artifact rejected: ${issues.join(', ')}`);
  result.variants[variant] = { file, features, bytes: bytes.length, gzip9Bytes: gzipSync(bytes, { level: 9 }).length, sha256: sha(bytes) };
  console.log(`${file}: ${bytes.length} bytes, gzip ${result.variants[variant].gzip9Bytes} bytes`);
}
for (const file of sourceFiles) {
  if (sha(await readFile(path.join(crate, file))) !== result.sourceSha256[file]) throw new Error(`Build source changed: ${file}`);
}
await writeFile(path.join(output, 'manifest.json'), JSON.stringify(result, null, 2) + '\n');
await copyFile(path.join(root, 'wasm/converter-core/THIRD-PARTY-NOTICES.txt'), path.join(output, 'THIRD-PARTY-NOTICES.txt'));
