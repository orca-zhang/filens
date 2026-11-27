// Build @filens/core and @filens/xlsx, then pass the saved pre-change XLSX dist directory.
// Pass --shared-strings after the directory to benchmark a large shared string table.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createWorksheetBatchWorkbook } from '../packages/xlsx/test/fixtures/worksheet-batches.mjs';
import { createSharedStringsWorkbook, sharedStringsLastValue } from '../packages/xlsx/test/fixtures/shared-strings.mjs';

const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
const [argument, ...args] = process.argv.slice(2);
if (argument === '--load') {
  const [entry, file] = args;
  const { loadXlsxWorkbook, resolveCellValue } = await import(pathToFileURL(entry));
  const bytes = await readFile(file);
  const start = performance.now();
  const { sheets, ...metadata } = await loadXlsxWorkbook(bytes);
  const metrics = { parseMs: performance.now() - start, peakRssKiB: process.resourceUsage().maxRSS };
  if (typeof global.gc === 'function') {
    global.gc();
    global.gc();
    metrics.retainedHeapKiB = process.memoryUsage().heapUsed / 1024;
  }
  console.log(JSON.stringify(metrics));
  const digest = createHash('sha256').update(JSON.stringify(metadata));
  let cells = 0;
  for (const { rows, ...sheet } of sheets) {
    digest.update(JSON.stringify(sheet, (_, value) => value instanceof Map ? [...value] : value));
    for (const row of rows) {
      cells += row.cells.length;
      digest.update(JSON.stringify(row));
    }
  }
  const sheet = sheets[0];
  const last = resolveCellValue(sheet, sheet.rows.at(-1).cells.at(-1));
  console.log(JSON.stringify({ cells, rows: sheet.rows.length, last, modelSha256: digest.digest('hex') }));
} else {
  if (!argument) throw new Error('Pass the saved pre-change XLSX dist directory.');
  const sharedStrings = args.includes('--shared-strings');
  const entries = { baseline: path.resolve(argument, 'index.js'), batched: path.resolve('packages/xlsx/dist/index.js') };
  const archive = sharedStrings ? await createSharedStringsWorkbook(220_000) : await createWorksheetBatchWorkbook(120_000);
  const bindings = Object.fromEntries(await Promise.all(Object.entries(entries).map(async ([key, entry]) => [key, sha256(await readFile(entry))])));
  const scratch = await mkdtemp(path.join(os.tmpdir(), 'filens-xlsx-row-parsing-'));
  const input = path.join(scratch, 'sample.xlsx');
  const date = new Date().toISOString().slice(0, 10);
  const samples = { baseline: [], batched: [] };
  const capped = {};
  let model;
  const run = (entry, cap) => {
    const outcome = spawnSync(process.execPath, ['--expose-gc', `--max-old-space-size=${cap}`, fileURLToPath(import.meta.url), '--load', entry, input],
      { encoding: 'utf8' });
    if (outcome.error) throw outcome.error;
    const [metrics, verified] = outcome.stdout.trim().split('\n').filter(Boolean).map(line => JSON.parse(line));
    if (outcome.status !== 0) {
      if (/heap out of memory/i.test(outcome.stderr)) return { result: 'V8 heap exhausted', parsed: Boolean(metrics), ...metrics };
      throw new Error(outcome.stderr);
    }
    assert.equal(verified.rows, sharedStrings ? 220_000 : 120_001);
    assert.equal(verified.cells, sharedStrings ? 220_002 : 479_998);
    assert.equal(verified.last, sharedStrings ? sharedStringsLastValue : '120030');
    model ??= verified;
    assert.deepEqual(verified, model);
    return { result: 'complete', ...metrics };
  };
  try {
    await writeFile(input, archive);
    for (let sample = 0; sample < 3; sample++) {
      const order = Object.keys(entries);
      if (sample % 2) order.reverse();
      for (const key of order) {
        const result = run(entries[key], 1024);
        assert.equal(result.result, 'complete');
        samples[key].push(result);
      }
    }
    for (const cap of [256, 128]) {
      capped[cap] = Object.fromEntries(Object.entries(entries).map(([key, entry]) => [key, run(entry, cap)]));
    }
    console.log(JSON.stringify({
      date, node: process.version, platform: os.platform(), arch: os.arch(), cpu: os.cpus()[0].model,
      workload: sharedStrings ? '220,000 shared strings referenced by worksheets' : '120,000 worksheet rows with inline strings and formulas',
      method: 'Fresh Node processes, alternating build order. 1024 MiB V8 old-space for the three measured runs per build. Parse times cover opening the ZIP, decoding XML and building the full model, including lazy parser initialization. They exclude fixture generation, reading the input file, static package imports, rendering and network. Peak process RSS includes the process baseline and compressed input and is sampled immediately after parsing. Retained V8 heap is sampled after two explicit collections with the workbook still reachable. Both measurements precede model hashing and formula evaluation. Capped runs limit V8 old space.',
      archiveBytes: archive.length, archiveSha256: sha256(archive), entrySha256: bindings, model, samples, capped,
    }, null, 2));
  } finally {
    await rm(scratch, { recursive: true, force: true });
  }
}
