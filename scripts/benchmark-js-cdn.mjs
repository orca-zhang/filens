import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const { components: { preview: version } } = JSON.parse(await readFile(path.join(root, 'docs/preview-release-sizes.json'), 'utf8'));
const origins = {
  jsDelivr: `https://cdn.jsdelivr.net/npm/filens-preview@${version}/dist`,
  unpkg: `https://unpkg.com/filens-preview@${version}/dist`
};
const files = ['split/filens.js', 'all-in-one/filens.js', 'all-in-one/archive/7zz.wasm'];
const median = values => {
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
};
assert.equal(median([4, 1, 2, 3]), 2.5);
assert.equal(median([3, 1, 2]), 2);

const report = {
  date: new Date().toISOString(), version, repetitions: 7,
  method: 'Alternating providers; first request recorded separately; new curl connection per request; HTTP/2, compression enabled, no client cache or cache busting. CDN state comes from response headers. One machine/network path, not a global benchmark.',
  proxyConfigured: Object.keys(process.env).some(key => /^(https?|all)_proxy$/i.test(key)),
  samples: [], summary: []
};
const work = await mkdtemp(path.join(tmpdir(), 'filens-js-cdn-bench-'));
try {
  for (const file of files) {
    for (let round = 0; round <= report.repetitions; round++) {
      const providers = Object.entries(origins);
      if (round % 2) providers.reverse();
      for (const [provider, base] of providers) {
        const url = `${base}/${file}`;
        const bodyFile = path.join(work, 'body');
        const headerFile = path.join(work, 'headers');
        await rm(bodyFile, { force: true });
        const result = spawnSync('curl', ['--silent', '--show-error', '--location', '--http2', '--compressed',
          '--connect-timeout', '10', '--max-time', '45', '--output', bodyFile, '--dump-header', headerFile,
          '--write-out', '%{json}', url], { encoding: 'utf8' });
        const metrics = JSON.parse(result.stdout || '{}');
        const headers = Object.fromEntries((await readFile(headerFile, 'utf8')).trim().split(/\r?\n/)
          .filter(line => line.includes(':')).map(line => {
            const colon = line.indexOf(':');
            return [line.slice(0, colon).toLowerCase(), line.slice(colon + 1).trim()];
          }));
        const bytes = await readFile(bodyFile).catch(() => Buffer.alloc(0));
        const sample = {
          file, provider, round, url, status: metrics.http_code ?? 0, exitCode: result.status,
          httpVersion: metrics.http_version,
          ttfbMs: metrics.time_starttransfer * 1000, totalMs: metrics.time_total * 1000,
          transferBytes: metrics.size_download, decodedBytes: bytes.length,
          sha256: createHash('sha256').update(bytes).digest('hex'),
          encoding: headers['content-encoding'] ?? 'identity',
          cache: headers['x-vercel-cache'] ?? headers['cf-cache-status'] ?? headers['x-cache'],
          pop: headers['x-vercel-id'] ?? headers['cf-ray'] ?? headers['x-served-by'],
          ...(result.status ? { error: result.stderr.trim() || result.error?.message } : {})
        };
        report.samples.push(sample);
        console.log(`${file} ${provider} ${round === 0 ? 'first' : round}: ${sample.status}, ${sample.ttfbMs.toFixed(1)} ms TTFB, ${sample.totalMs.toFixed(1)} ms total, ${sample.cache}`);
      }
    }
    const samples = report.samples.filter(sample => sample.file === file);
    for (const provider of Object.keys(origins)) {
      const measured = samples.filter(sample => sample.provider === provider && sample.round > 0);
      const valid = measured.filter(sample => sample.status === 200 && sample.exitCode === 0);
      report.summary.push({ file, provider, successful: valid.length, failed: measured.length - valid.length,
        medianTtfbMs: valid.length ? median(valid.map(sample => sample.ttfbMs)) : null,
        medianTotalMs: valid.length ? median(valid.map(sample => sample.totalMs)) : null });
    }
  }
  const output = path.join(root, 'docs/js-cdn-provider-benchmark.json');
  await writeFile(output, `${JSON.stringify(report, null, 2)}\n`);
  console.table(report.summary);
  console.log(`Saved ${output}`);
  for (const file of files) {
    const samples = report.samples.filter(sample => sample.file === file);
    assert.ok(samples.every(sample => sample.status === 200 && sample.exitCode === 0), `Failed request: ${file}`);
    assert.equal(new Set(samples.map(sample => sample.sha256)).size, 1, `Content mismatch: ${file}`);
  }
} finally {
  await rm(work, { recursive: true, force: true });
}
