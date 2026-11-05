// Build portable and optional SIMD128 variants of the shared production text core.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { gzipSync } from 'node:zlib';
import { run } from './agent-rust-build.mjs';
import { privacyIssues } from './agent-release-privacy.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const option = (name, fallback) => { const at = process.argv.indexOf(name); return at < 0 ? fallback : process.argv[at + 1]; };
const output = path.resolve(root, option('--output', 'wasm/converter-core/dist'));
const requested = option('--variant', 'both');
assert(['both', 'scalar', 'simd'].includes(requested), '--variant must be both, scalar or simd');
const crate = 'wasm/converter-core-rust';
const target = `${crate}/target/wasm32-wasip1/release`;
const toolchain = /channel\s*=\s*"([^"]+)"/.exec(await readFile(path.join(root, crate, 'rust-toolchain.toml'), 'utf8'))[1];
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const sources = {};
async function snapshot(directory) {
  for (const entry of await readdir(path.join(root, directory), { withFileTypes: true })) {
    const file = `${directory}/${entry.name}`;
    if (entry.isDirectory()) await snapshot(file);
    else sources[file] = hash(await readFile(path.join(root, file)));
  }
}
await snapshot(`${crate}/src`);
for (const file of [`${crate}/Cargo.toml`, `${crate}/Cargo.lock`, 'converter/text-formats.json',
  'wasm/converter-core/manifest/conversions.json', 'wasm/converter-image/manifest/conversions.json']) {
  sources[file] = hash(await readFile(path.join(root, file)));
}
await mkdir(output, { recursive: true });
const manifest = { rust: toolchain, target: 'wasm32-wasip1', variants: {}, sourceHashes: {} };
for (const variant of requested === 'both' ? ['scalar', 'simd'] : [requested]) {
  const features = `text-extraction,postscript${variant === 'simd' ? ',search-simd' : ''}`;
  // Force the small root target to compile even when another job has used the
  // shared target directory; keep dependency caches intact.
  const fingerprint = path.join(root, target, '.fingerprint');
  for (const entry of await readdir(fingerprint).catch(() => [])) {
    if (entry.startsWith('converter-core-rust-')) await rm(path.join(fingerprint, entry, 'bin-converter-text'), { force: true });
  }
  const cargo = await run('cargo', [`+${toolchain}`, 'build', '--locked', '--release', '--manifest-path',
    `${crate}/Cargo.toml`, '--features', features, '--bin', 'converter-text', '--target', 'wasm32-wasip1', '--message-format=json'], { capture: true });
  const artifact = cargo.split('\n').filter(Boolean).map(line => JSON.parse(line))
    .find(value => value.reason === 'compiler-artifact' && value.target.name === 'converter-text');
  const expected = ['default', 'office-crypto', 'postscript', ...(variant === 'simd' ? ['search-simd'] : []), 'text-extraction'];
  assert.deepEqual(artifact.features, expected);
  const file = `converter-text${variant === 'simd' ? '-simd' : ''}.wasm`;
  await run(process.execPath, ['node_modules/binaryen/bin/wasm-opt', `${target}/converter-text.wasm`, '-Oz',
    '--strip-debug', '--strip-producers', '--enable-bulk-memory', '--enable-nontrapping-float-to-int',
    ...(variant === 'simd' ? ['--enable-simd'] : []), '-o', path.join(output, file)]);
  const bytes = await readFile(path.join(output, file));
  assert(bytes.length && WebAssembly.validate(bytes), `${file}: invalid or empty WASM`);
  assert.deepEqual(privacyIssues(bytes), [], `${file}: private build data`);
  // Cargo emits escaped spaces in dependency paths. Normalize ../ includes so
  // each actual source/include is audited once, including the optional scanner.
  const dependencyLine = (await readFile(path.join(root, `${target}/converter-text.d`), 'utf8')).split('\n')[0];
  const dependencies = dependencyLine.slice(dependencyLine.indexOf(': ') + 2).match(/(?:\\.|[^\s])+/g) ?? [];
  const active = [...new Set([...dependencies.map(file => path.relative(root, path.resolve(file.replace(/\\ /g, ' '))).split(path.sep).join('/')),
    `${crate}/Cargo.toml`, `${crate}/Cargo.lock`])].sort();
  for (const source of active) {
    assert(sources[source], `Uncaptured build input: ${source}`);
    assert.equal(hash(await readFile(path.join(root, source))), sources[source], `Build input changed: ${source}`);
    manifest.sourceHashes[source] = sources[source];
  }
  manifest.variants[variant] = { file, features: artifact.features, bytes: bytes.length, gzip9: gzipSync(bytes, { level: 9 }).length,
    sha256: hash(bytes), sourceFiles: active, optimizer: '-Oz --strip-debug --strip-producers --enable-bulk-memory --enable-nontrapping-float-to-int' + (variant === 'simd' ? ' --enable-simd' : '') };
  console.log(`${file}: ${bytes.length} bytes; ${manifest.variants[variant].sha256}`);
}
for (const [file, expected] of Object.entries(manifest.sourceHashes)) assert.equal(hash(await readFile(path.join(root, file))), expected, `Build input changed: ${file}`);
await writeFile(path.join(output, 'search-wasm-build.json'), JSON.stringify(manifest, null, 2) + '\n');
