import { spawn } from 'node:child_process';
import { cp, mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { gzipSync, brotliCompressSync, constants } from 'node:zlib';
import { privateRustBuildEnv } from './agent-release-privacy.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const crate = path.join(root, 'wasm/converter-core-rust');
const work = await mkdtemp(path.join(os.tmpdir(), 'filens-core-size-'));
const temporary = path.join(work, 'wasm/converter-core-rust');
const probeTarget = path.join(crate, 'target/size-impact');
const manifestPath = 'wasm/converter-core/manifest/conversions.json';
const rows = [];
const measure = (name, bytes) => ({ name, raw: bytes.length, gzip: gzipSync(bytes, { level: 9 }).length,
  brotli: brotliCompressSync(bytes, { params: { [constants.BROTLI_PARAM_QUALITY]: 11 } }).length });

try {
  rows.push(measure('production core (Office detection only)', await readFile(path.join(root, 'wasm/converter-core/dist/converter-core.wasm'))));
  rows.push(measure('optional Office decrypt-only module', await readFile(path.join(root, 'wasm/converter-core/dist/converter-office.wasm'))));
  rows.push(measure('combined core (all-in-one alternative)', await readFile(path.join(root, 'wasm/converter-core/dist/converter-core-full.wasm'))));
  await mkdir(temporary, { recursive: true });
  for (const name of ['src', 'Cargo.toml', 'Cargo.lock']) await cp(path.join(crate, name), path.join(temporary, name), { recursive: true });
  await mkdir(path.join(work, 'wasm/converter-image/manifest'), { recursive: true });
  await cp(path.join(root, 'wasm/converter-image/manifest/conversions.json'), path.join(work, 'wasm/converter-image/manifest/conversions.json'));
  const source = await readFile(path.join(temporary, 'src/main.rs'), 'utf8');
  await mkdir(path.dirname(path.join(work, manifestPath)), { recursive: true });
  await cp(path.join(root, manifestPath), path.join(work, manifestPath));
  const iconStart = source.indexOf('        } else if icons::supports(&request.source) {');
  const iconEnd = source.indexOf('        } else if request.source == "ppm" {', iconStart);
  const limitStart = source.indexOf('    if icons::supports(&request.source) && input_size > MAX_PACKAGE_BYTES {');
  const limitEnd = source.indexOf('    if request.source == "ppm"', limitStart);
  if (Math.min(iconStart, iconEnd, limitStart, limitEnd) < 0) throw new Error('Icon dispatch changed; update the size probe before comparing.');
  let baseline = source.slice(0, limitStart) + source.slice(limitEnd);
  baseline = baseline.slice(0, iconStart) + baseline.slice(iconEnd);
  baseline = baseline.replace('mod icons;\n', '');
  await writeFile(path.join(temporary, 'src/main.rs'), baseline);
  const manifest = (await readFile(path.join(root, manifestPath), 'utf8')).split('\n')
    .filter(line => !/"sourceFormat": "(?:apk|ipa|exe|dll|mui|mun|ico)"/.test(line)).join('\n');
  await writeFile(path.join(work, manifestPath), manifest);
  for (const name of ['without application icons', 'without application icons or Office decryption']) {
    if (name.endsWith('Office decryption')) await writeFile(path.join(temporary, 'src/office.rs'),
      'use crate::{Request, ConvertError};\npub(super) fn convert_encrypted(_: &Request) -> Option<Result<(), ConvertError>> { None }\n');
    await probe(name);
  }
  const delta = (from, to) => Object.fromEntries(['raw', 'gzip', 'brotli'].map(key => [key, rows[from][key] - rows[to][key]]));
  const report = { unit: 'bytes', method: 'Split production core excludes the office-crypto feature and ships a separate decrypt-only module. All-in-one uses the combined core with office-crypto and omits the addon. Analysis variants remove icon dispatch/manifest entries, then stub the Office handler. Identical release settings and Binaryen -Oz --converge; probe uses a temporary source tree, so small path-related codegen differences are possible.',
    rows, addedByApplicationIcons: delta(2, 3), addedByOfficeDecryption: delta(3, 4),
    savedOnOrdinaryPreviews: delta(2, 0),
    overheadWhenOfficeModuleIsLoaded: Object.fromEntries(['raw', 'gzip', 'brotli'].map(key => [key, rows[0][key] + rows[1][key] - rows[2][key]])) };
  await writeFile(path.join(root, 'docs/converter-size-impact.json'), `${JSON.stringify(report, null, 2)}\n`);
  console.table(rows);
  console.log(JSON.stringify({ savedOnOrdinaryPreviews: report.savedOnOrdinaryPreviews, overheadWhenOfficeModuleIsLoaded: report.overheadWhenOfficeModuleIsLoaded }));
} finally { await rm(work, { recursive: true, force: true }); }

async function probe(name) {
  await run('cargo', ['build', '--locked', '--release', '--target', 'wasm32-wasip1', '--bin', 'converter-core', '--features', 'office-crypto'], temporary);
  const output = path.join(work, 'probe.wasm');
  await run(process.execPath, [path.join(root, 'node_modules/binaryen/bin/wasm-opt'), path.join(probeTarget, 'wasm32-wasip1/release/converter-core.wasm'),
    '-Oz', '--converge', '--enable-bulk-memory', '--enable-nontrapping-float-to-int', '--strip-debug', '--strip-producers', '-o', output], root);
  rows.push(measure(name, await readFile(output)));
}

function run(command, args, cwd) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd, env: { ...privateRustBuildEnv(root), CARGO_TARGET_DIR: probeTarget }, stdio: ['ignore', 'ignore', 'inherit'] });
    child.on('error', reject); child.on('exit', code => code === 0 ? resolve() : reject(new Error(`${command} exited ${code}`)));
  });
}
