import type { ParsedSheet } from './types';

export interface FormulaClock {
  time?: number;
  reads: number;
}

const clocks = new WeakMap<ParsedSheet, FormulaClock>();

export function shareFormulaClock(sheets: readonly ParsedSheet[]): void {
  const clock: FormulaClock = { reads: 0 };
  for (const sheet of sheets) clocks.set(sheet, clock);
}

export function formulaClock(sheet: ParsedSheet): FormulaClock {
  let clock = clocks.get(sheet);
  if (!clock) clocks.set(sheet, clock = { reads: 0 });
  return clock;
}

export function withFormulaTime<T>(sheet: ParsedSheet, run: () => T): T {
  const clock = formulaClock(sheet);
  if (clock.time !== undefined) return run();
  clock.time = Date.now();
  try { return run(); }
  finally { clock.time = undefined; }
}

/** A cached range or threshold only expires if its evaluation read the clock. */
export function memoizeWithFormulaTime<T>(sheet: ParsedSheet, calculate: () => T): () => T {
  let cached: { value: T; time?: number } | undefined;
  return () => {
    if (cached && cached.time === undefined) return cached.value;
    return withFormulaTime(sheet, () => {
      const clock = formulaClock(sheet);
      if (cached && cached.time === clock.time) {
        clock.reads++;
        return cached.value;
      }
      const reads = clock.reads;
      const value = calculate();
      cached = { value, time: clock.reads === reads ? undefined : clock.time };
      return value;
    });
  };
}
