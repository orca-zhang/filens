import latest from '../../../benchmarks/filens-bench/published/latest.json';

type Pair = { stock: number | null; filens: number | null };
interface BenchmarkSnapshot {
  generatedAt: string;
  dataset: { filensCliVersion: string; tasksPerRun: number; complexTasks: number };
  baselines: Array<{ metrics: {
    complexQuality: Pair;
    complexElapsedSeconds?: { stockP50: number | null; filensP50: number | null };
    elapsedSeconds?: Pair;
    allTaskTokens?: Pair;
  } }>;
}

export function summarizeBenchmark(data: BenchmarkSnapshot) {
  const metrics = data.baselines.map(row => row.metrics);
  const times = metrics.map(m => m.complexElapsedSeconds
    ? { stock: m.complexElapsedSeconds.stockP50, filens: m.complexElapsedSeconds.filensP50 }
    : m.elapsedSeconds);
  const complete = (pair: Pair | undefined): pair is Pair & { stock: number; filens: number } =>
    pair != null && Number.isFinite(pair.stock) && Number.isFinite(pair.filens);
  const quality = metrics.map(m => m.complexQuality).filter(complete);
  const latency = times.filter(complete);
  // Known subtotals cannot establish token savings.
  const tokens = metrics.map(m => m.allTaskTokens).filter(complete);
  return {
    date: data.generatedAt,
    cliVersion: data.dataset.filensCliVersion,
    tasks: data.dataset.tasksPerRun,
    complexTasks: data.dataset.complexTasks,
    harnesses: metrics.length,
    quality: `${quality.filter(p => p.filens > p.stock).length}/${quality.length}`,
    latency: `${latency.filter(p => p.filens < p.stock).length}/${latency.length}`,
    tokens: `${tokens.filter(p => p.filens < p.stock).length}/${tokens.length}`,
    completeTokenPairs: tokens.length
  };
}

const snapshots = import.meta.glob<BenchmarkSnapshot>(
  '../../../benchmarks/filens-bench/published/*/baselines.json',
  { eager: true, import: 'default' }
);
const data = snapshots[`../../../benchmarks/filens-bench/published/${latest.snapshot}/baselines.json`];
if (!data) throw new Error(`Missing benchmark snapshot: ${latest.snapshot}`);
export const benchmark = summarizeBenchmark(data);
