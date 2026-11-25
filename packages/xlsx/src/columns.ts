export function columnNameToIndex(name: string): number {
  let index = 0;
  for (const char of name.toUpperCase()) index = index * 26 + char.charCodeAt(0) - 64;
  return index;
}

export function columnIndexToName(index: number): string {
  let name = '';
  while (index > 0) {
    name = String.fromCharCode(65 + (index - 1) % 26) + name;
    index = Math.floor((index - 1) / 26);
  }
  return name || 'A';
}

export function parseCellRef(ref: string): { row: number; column: number } {
  const match = /^([A-Z]+)(\d+)$/i.exec(ref);
  if (!match) {
    return {
      row: 1,
      column: 1
    };
  }
  return {
    column: columnNameToIndex(match[1] ?? 'A'),
    row: Number(match[2] ?? 1)
  };
}
import type { ParsedMerge } from './types';


export function parseSheetRange(value: string): ParsedMerge | undefined {
  const match = /^(\$?[A-Z]{1,3}\$?[1-9]\d*)(?::(\$?[A-Z]{1,3}\$?[1-9]\d*))?$/i.exec(value);
  if (!match) return undefined;
  const first = parseCellRef(match[1].replace(/\$/g, '')), last = parseCellRef((match[2] ?? match[1]).replace(/\$/g, ''));
  if (first.row > last.row || first.column > last.column || last.row > 1_048_576 || last.column > 16_384) return undefined;
  return { firstRow: first.row, lastRow: last.row, firstColumn: first.column, lastColumn: last.column };
}
