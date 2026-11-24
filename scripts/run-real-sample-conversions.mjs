import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { runWasiConverterBatch } from './run-wasi-converter-batch.mjs';

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

async function main() {
  const manifestRel = process.argv[2] || 'tmp/real-samples/real-samples-manifest.json';
  const wasmRel = process.argv[3] || 'wasm/converter-core/dist/converter-core-full.wasm';

  const manifestPath = path.resolve(rootDir, manifestRel);
  const wasmPath = path.resolve(rootDir, wasmRel);
  const reportPath = path.resolve(rootDir, 'tmp/real-samples/conversion-report.json');
  const tmpOutDir = path.resolve(rootDir, 'tmp/real-samples/converted');
  const imageWasmPath = path.resolve(rootDir, 'wasm/converter-image/dist/converter-image.wasm');
  const imageManifestPath = path.resolve(rootDir, 'wasm/converter-image/manifest/conversions.json');

  let raw = await fs.readFile(manifestPath, 'utf8');
  raw = raw.replace(/^\uFEFF/, '');
  const manifest = JSON.parse(raw);
  const samples = Array.isArray(manifest.samples) ? manifest.samples : [];

  // Only 'convert' entries.
  const conversions = samples.filter((s) => s && s.kind === 'convert');
  if (!conversions.length) {
    console.log('No convert samples in manifest.');
    return;
  }

  await fs.mkdir(path.dirname(reportPath), { recursive: true });
  await fs.mkdir(tmpOutDir, { recursive: true });

  const jobs = conversions.map((s) => {
    const srcPath = String(s.path);
    const sourceFormat = String(s.sourceExt || '');
    const targetFormat = String(s.targetExt || '');
    const ext = path.extname(srcPath).slice(1).toLowerCase();
    const outName = `${String(s.id || ext)}.${targetFormat}`;
    const outRel = path.relative(rootDir, path.join(tmpOutDir, outName));

    return {
      inputPath: path.relative(rootDir, path.resolve(rootDir, srcPath)).replace(/\\/g, '/'),
      outputPath: outRel.replace(/\\/g, '/'),
      sourceFormat,
      targetFormat
    };
  });

  console.log(`Running Rust converter-core WASI for ${jobs.length} real-sample jobs...`);
  const result = await runWasiConverterBatch({ rootDir, baseDir: rootDir, coreWasmPath: wasmPath,
    imageWasmPath, imageManifestPath, jobs, defaults: { locale: 'zh-CN' }, reportPath });
  if (!result.ok) process.exit(1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
