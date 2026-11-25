import type { ParsedColumnStyle } from './types';

/** Cache only requested columns, including columns with no style declaration. */
export function columnStyleLookup(ranges: readonly ParsedColumnStyle[]): (column: number) => number {
  if (!ranges.length) return () => 0;
  const cache: number[] = [];
  return column => cache[column] ??= ranges.find(range => column >= range.firstColumn && column <= range.lastColumn)?.styleIndex ?? 0;
}
