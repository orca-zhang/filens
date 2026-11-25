import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createLargeMergedNumbersArchive } from '../packages/iwork/test/fixtures/numbers-archive.mjs';

const script = fileURLToPath(import.meta.url), root = path.resolve(path.dirname(script), '..');
if (!globalThis.gc || !process.execArgv.includes('--max-old-space-size=128')) {
  const child = spawnSync(process.execPath, ['--expose-gc', '--max-old-space-size=128', script], { cwd: root, stdio: 'inherit' });
  if (child.error) throw child.error;
  process.exit(child.status ?? 1);
}

const { loadIwork } = await import('../packages/iwork/dist/index.js');
// Warm schema initialization separately from retained model measurements.
await loadIwork(await createLargeMergedNumbersArchive({ rowCount: 1000, columnCount: 64 }), { hint: 'numbers' });
const cases = [];
for (const [rowCount, columnCount, emptyAnchor] of [[1000, 64, false], [100_000, 1024, false], [100_000, 1024, true], [1_000_000, 1024, false]]) {
  const bytes = await createLargeMergedNumbersArchive({ rowCount, columnCount, emptyAnchor });
  globalThis.gc();
  const before = process.memoryUsage().heapUsed, start = performance.now();
  let doc = await loadIwork(bytes, { hint: 'numbers' });
  const elapsedMs = performance.now() - start;
  assert.equal(doc.kind, 'numbers');
  assert.equal(doc.sheets[0].tables[0].item.cells.length, 3);
  assert.equal(doc.sheets[0].tables[0].item.cells[0].rowSpan, rowCount - 1);
  assert.deepEqual(doc.warnings, []);
  globalThis.gc();
  const after = process.memoryUsage();
  cases.push({ rows: rowCount, columns: columnCount, emptyAnchor, mergedPositions: (rowCount - 1) * columnCount,
    inputZipBytes: bytes.length, inputSha256: createHash('sha256').update(bytes).digest('hex'), parsedCells: 3,
    elapsedMs, retainedHeapDeltaBytes: after.heapUsed - before, heapAfterBytes: after.heapUsed, rssAfterBytes: after.rss });
  doc = null;
}
const date = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Shanghai' }).format(new Date());
const directory = path.join(root, 'benchmarks/frontend', date);
const artifacts = {};
for (const file of ['packages/iwork/src/parser/table.ts', 'packages/iwork/dist/index.js', 'packages/iwork/test/fixtures/numbers-archive.mjs', 'scripts/benchmark-numbers-merge-memory.mjs']) {
  artifacts[file] = createHash('sha256').update(await readFile(path.join(root, file))).digest('hex');
}
const report = { date, command: 'npm run build:iwork && node scripts/benchmark-numbers-merge-memory.mjs',
  scope: 'Synthetic serialized Numbers ZIP/Snappy/IWA archives with three stored cells. The built frontend parser runs in Node under a 128 MiB V8 old-space cap. Schema initialization is warmed; retained heap deltas follow explicit GC. RSS values are snapshots, not peaks. Results do not establish browser/device limits, dense archive costs, or a total-memory bound.',
  environment: { node: process.version, platform: process.platform, architecture: process.arch, oldSpaceLimitMiB: 128 },
  artifacts, cases };
await mkdir(directory, { recursive: true });
await writeFile(path.join(directory, 'numbers-merge-memory-review.json'), JSON.stringify(report, null, 2) + '\n');
console.log(JSON.stringify(report, null, 2));
