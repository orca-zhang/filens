// Compare directory discovery only: filename mode loads no document parser.
// Run on Windows/NTFS for NTFS measurements. No cache eviction is attempted.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const binary = process.env.FILENS_AGENT_BINARY || path.join(root, 'dist/agent-lite', process.platform === 'win32' ? 'filens.exe' : 'filens');
const count = Number(process.env.FILENS_BENCH_FILES || 10000);
assert.ok(Number.isInteger(count) && count >= 1 && count <= 20000);
const directory = await mkdtemp(path.join(os.tmpdir(), 'filens-walk-'));
const observations = [];
const median = values => [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)];
try {
  for (let group = 0; group < Math.ceil(count / 1000); group++) {
    const folder = path.join(directory, `group-${group}`);
    await mkdir(folder);
    for (let i = group * 1000; i < Math.min(count, (group + 1) * 1000); i++) {
      await writeFile(path.join(folder, `BENCH2026 ${String(i).padStart(5, '0')} ${'a'.repeat(80)}.txt`), `evidence ${i}`);
    }
  }
  let expected;
  for (let trial = 0; trial < 6; trial++) {
    // Alternate order to reduce systematic filesystem-cache bias.
    for (const mode of trial % 2 ? ['read-dir', 'native'] : ['native', 'read-dir']) {
      const env = { ...process.env };
      delete env.FILENS_WALKER;
      if (mode === 'read-dir') env.FILENS_WALKER = 'read-dir';
      const start = performance.now();
      const result = spawnSync(binary, ['search', directory, '--query', 'BENCH2026', '--search-mode', 'files', '--max-files', String(count), '--json', '--no-ocr'],
        { env, encoding: 'utf8', timeout: 120000, maxBuffer: 16 << 20 });
      const processMs = performance.now() - start;
      assert.equal(result.error, undefined);
      assert.equal(result.status, 0, result.stderr || result.stdout);
      const { search } = JSON.parse(result.stdout);
      assert.equal(search.complete, true);
      assert.equal(search.scan.discoveredFiles, count);
      assert.equal(search.matchedFiles, count);
      assert.equal(search.scan.execution.sharedTextModules, 0);
      expected ??= search.results;
      assert.deepEqual(search.results, expected);
      if (trial > 0) observations.push({ mode, backend: search.scan.backend, discoveryMs: search.scan.discoveryMs, processMs: Math.round(processMs * 100) / 100 });
    }
  }
  const summary = ['native', 'read-dir'].map(mode => {
    const runs = observations.filter(o => o.mode === mode);
    return { mode, backend: runs[0].backend, medianDiscoveryMs: median(runs.map(o => o.discoveryMs)), medianProcessMs: median(runs.map(o => o.processMs)) };
  });
  console.log(JSON.stringify({ platform: `${process.platform}-${process.arch}`, count,
    method: 'Synthetic directory metadata scan; five fresh processes per mode after one warmup. OS caches remain enabled. NTFS results require a Windows/NTFS host.',
    summary, observations }, null, 2));
} finally {
  await rm(directory, { recursive: true, force: true });
}
