import { WASI } from 'node:wasi';
import { readFile, rm, writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';

export async function runWasiConverterBatch({ rootDir, baseDir, coreWasmPath, imageWasmPath,
  imageManifestPath, jobs, defaults = {}, reportPath }) {
  const root = path.resolve(rootDir);
  const base = path.resolve(baseDir);
  const report = path.resolve(reportPath);
  const workDir = path.join(root, 'tmp', 'wasi-converter-batch');
  await mkdir(workDir, { recursive: true });
  const [coreModule, imageModule, imageManifest] = await Promise.all([
    WebAssembly.compile(await readFile(coreWasmPath)),
    WebAssembly.compile(await readFile(imageWasmPath)),
    readFile(imageManifestPath, 'utf8').then(JSON.parse)
  ]);
  const imagePairs = new Set(imageManifest.map(pair => `${pair.sourceFormat}>${pair.targetFormat}`));
  const results = [];

  for (const [index, job] of jobs.entries()) {
    const inputPath = within(base, job.inputPath);
    const outputPath = within(base, job.outputPath);
    const optionsPath = path.join(workDir, `${index}.options.json`);
    const resultPath = path.join(workDir, `${index}.result.json`);
    const module = imagePairs.has(`${job.sourceFormat}>${job.targetFormat}`) ? imageModule : coreModule;
    await mkdir(path.dirname(outputPath), { recursive: true });
    await writeFile(optionsPath, JSON.stringify({ ...defaults, ...(job.options ?? {}) }));
    await rm(resultPath, { force: true });

    const wasi = new WASI({
      version: 'preview1',
      args: ['converter-core', '--input', guestPath(root, inputPath), '--output', guestPath(root, outputPath),
        '--source', job.sourceFormat, '--target', job.targetFormat,
        '--options', guestPath(root, optionsPath), '--result', guestPath(root, resultPath)],
      env: {},
      preopens: { '/workspace': root },
      returnOnExit: true
    });

    let result;
    let exitCode = 1;
    try {
      const instance = await WebAssembly.instantiate(module, wasi.getImportObject());
      exitCode = wasi.start(instance);
      result = JSON.parse(await readFile(resultPath, 'utf8'));
      if (exitCode !== 0 && result.ok) {
        result = { ...result, ok: false, errorCode: 'wasi_exit', errorMessage: `WASI exited with ${exitCode}` };
      }
    } catch (error) {
      result = { ok: false, errorCode: 'wasi_error', errorMessage: error.message };
    }
    results.push({ job, result, runtime: 'node-wasi', exitCode });
  }

  const ok = results.filter(item => item.result.ok === true && item.exitCode === 0).length;
  const output = { ok: ok === jobs.length, summary: { total: jobs.length, ok, failed: jobs.length - ok, byBackend: { wasi: ok } }, results };
  await mkdir(path.dirname(report), { recursive: true });
  await writeFile(report, JSON.stringify(output, null, 2));
  return output;
}

function within(base, relative) {
  const resolved = path.resolve(base, relative);
  if (resolved !== base && !resolved.startsWith(`${base}${path.sep}`)) {
    throw new Error(`converter job path escapes its base directory: ${relative}`);
  }
  return resolved;
}

function guestPath(root, file) {
  const relative = path.relative(root, file);
  if (relative.startsWith('..') || path.isAbsolute(relative)) {
    throw new Error(`converter job path escapes the workspace: ${file}`);
  }
  return `/workspace/${relative.split(path.sep).join('/')}`;
}
