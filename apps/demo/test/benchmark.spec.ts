import { describe, expect, it } from 'vitest';
import snapshot from '../../../benchmarks/filens-bench/published/converged-2026-11-24/baselines.json';
import { benchmark, summarizeBenchmark } from '../src/benchmark';

describe('homepage benchmark summary', () => {
  it('follows the published snapshot and includes Blue', () => {
    expect(benchmark).toMatchObject({ harnesses: 8, quality: '8/8', latency: '8/8', tokens: '5/5', completeTokenPairs: 5 });
  });

  it('keeps unknown usage out of savings claims and does not count regressions as improvements', () => {
    const data = structuredClone(snapshot);
    data.baselines[0]!.metrics.complexQuality.filens = 90;
    data.baselines[0]!.metrics.elapsedSeconds!.filens = 60;
    data.baselines[0]!.metrics.allTaskTokens!.filens = 600000;
    // Incomplete Codex, Claude and Zcode subtotals remain excluded.
    expect(summarizeBenchmark(data)).toMatchObject({ quality: '7/8', latency: '7/8', tokens: '4/5' });
    const missing = { ...data, baselines: [{ metrics: {
      complexQuality: { stock: 90, filens: 100 },
      allTaskTokens: { stock: null, filens: 10 }
    } }] };
    expect(summarizeBenchmark(missing)).toMatchObject({ latency: '0/0', tokens: '0/0', completeTokenPairs: 0 });
  });
});
