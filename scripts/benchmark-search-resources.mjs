// Compare complete fresh CLI processes; fixtures and observations belong to FiLens.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { quantile } from './search-benchmark-metrics.mjs';
import { privacyIssues } from './agent-release-privacy.mjs';

const option = name => {
  const index = process.argv.indexOf(name);
  assert.ok(index >= 0 && process.argv[index + 1], `Required: ${name} PATH`);
  return path.resolve(process.argv[index + 1]);
};
const binaries = { before: option('--baseline'), after: option('--binary') };
const output = option('--output');
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const directory = await mkdtemp(path.join(os.tmpdir(), 'filens-search-resources-'));
const env = { ...process.env };
delete env.FILENS_TEXT_WASM;
delete env.FILENS_WALKER;
const ascii = 'ordinary background text for retrieval and file scheduling\n'.repeat(150).slice(0, 8192);
const bounded = 'BUDGET782\n' + 'x'.repeat((512 << 10) - 10);
const cases = [
  { name: 'ascii-bm25', count: 2000, mode: 'bm25', query: 'AUDIT2026', jobs: 1,
    text: i => `${i === 1900 ? 'AUDIT2026' : 'background'}\n${ascii}` },
  { name: 'chinese-bm25', count: 128, mode: 'bm25', query: '预算 审批', jobs: 1,
    text: () => '预算需要逐项复核，审批材料仍待负责人确认。\n'.repeat(300) },
  { name: 'ascii-exact-parallel', count: 2000, mode: 'exact', query: 'AUDIT2026', jobs: 4,
    text: i => `${i === 1900 ? 'AUDIT2026' : 'background'}\n${ascii}` },
  { name: 'over-budget-parallel', count: 256, mode: 'exact', query: 'BUDGET782', jobs: 4,
    text: () => bounded },
];
const observations = [], summary = [], resources = [];
function run(version, test, rss = false) {
  let args = [binaries[version], 'search', test.directory, '--query', test.query,
    '--search-mode', test.mode, '--max-files', '20000', '--json', '--no-ocr'];
  if (rss) args = ['/usr/bin/time', '-l', ...args];
  const started = performance.now();
  const result = spawnSync(args[0], args.slice(1), { env: { ...env, FILENS_SEARCH_JOBS: String(test.jobs) },
    encoding: 'utf8', timeout: 120000, maxBuffer: 32 << 20 });
  const processMs = performance.now() - started;
  assert.equal(result.error, undefined);
  assert.equal(result.status, test.name === 'over-budget-parallel' ? 3 : 0, result.stderr || result.stdout);
  const wire = JSON.parse(result.stdout), scan = wire.search.scan;
  const row = { version, case: test.name, processMs, discoveryMs: scan.discoveryMs,
    extractionMs: scan.extractionMs, assemblyMs: scan.assemblyMs, rankingMs: scan.rankingMs,
    nativeFiles: scan.execution.nativeFiles, indexedFiles: wire.search.indexedFiles, textBytes: scan.textBytes };
  if (rss) {
    const match = result.stderr.match(/(\d+)\s+maximum resident set size/);
    assert.ok(match, 'Missing macOS RSS measurement');
    row.rssMiB = Number(match[1]) / (1 << 20);
  }
  if (test.name === 'over-budget-parallel' && version === 'after') {
    assert.equal(scan.execution.nativeFiles, 65);
    assert.equal(wire.search.indexedFiles, 64);
  }
  return { row, value: { results: wire.search.results, content: wire.content,
    matchedFiles: wire.search.matchedFiles, chunks: wire.search.chunks, complete: wire.search.complete } };
}
try {
  for (const test of cases) {
    test.directory = path.join(directory, test.name);
    await mkdir(test.directory);
    let inputBytes = 0;
    for (let i = 0; i < test.count; i++) {
      const text = test.text(i);
      inputBytes += Buffer.byteLength(text);
      await writeFile(path.join(test.directory, `${String(i).padStart(5, '0')}.txt`), text);
    }
    let expected;
    for (let round = -1; round < 5; round++) {
      for (const version of round % 2 ? ['after', 'before'] : ['before', 'after']) {
        const { row, value } = run(version, test);
        expected ??= value;
        assert.deepEqual(value, expected, `${test.name}: scores, order or evidence changed`);
        if (round >= 0) observations.push({ round, ...row });
      }
    }
    for (const version of Object.keys(binaries)) {
      const rows = observations.filter(row => row.version === version && row.case === test.name);
      summary.push({ case: test.name, version, inputBytes,
        ...Object.fromEntries(['processMs', 'discoveryMs', 'extractionMs', 'assemblyMs', 'rankingMs']
          .map(key => [key, quantile(rows.map(row => row[key]), .5)])),
        nativeFiles: rows[0].nativeFiles, indexedFiles: rows[0].indexedFiles });
      if (process.platform === 'darwin') resources.push(run(version, test, true).row);
    }
    console.log(`${test.name}: five alternating pairs passed`);
    await rm(test.directory, { recursive: true });
  }
  const artifacts = {};
  for (const [version, binary] of Object.entries(binaries)) {
    const bytes = await readFile(binary);
    artifacts[version] = { sha256: sha(bytes), bytes: bytes.length };
  }
  const report = { observedAt: new Date().toISOString(), platform: `${process.platform}-${process.arch}`,
    cpu: os.cpus()[0]?.model, artifacts,
    scope: 'Fresh CLI processes, one warmup and five alternating pairs per case; no application cache. OS caches enabled; not physical-cold disk. RSS is one separate macOS sample per configuration.',
    change: 'CLI package speed optimization and ordered extraction windows bounded by remaining corpus budget and source metadata.',
    resultPairs: observations.length / 2, allResultsEqual: true, summary, resources, observations };
  const bytes = Buffer.from(JSON.stringify(report, null, 2) + '\n');
  assert.deepEqual(privacyIssues(bytes), []);
  await mkdir(path.dirname(output), { recursive: true });
  await writeFile(output, bytes);
  console.log(JSON.stringify({ summary, resources }, null, 2));
} finally {
  await rm(directory, { recursive: true, force: true });
}
