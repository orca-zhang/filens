import type { ParsedRowHeight, ParsedRowHeightSource } from './types';

const maxRowHeightPoints = 409.5;
export const XLSX_MAX_ROW_HEIGHT = maxRowHeightPoints * 4 / 3;

export function xlsxRowHeight(raw: unknown, custom: unknown): ParsedRowHeight | undefined {
  const points = typeof raw === 'string' && raw.trim() ? Number(raw) : NaN;
  const height = Number.isFinite(points) && points >= 0 && points <= maxRowHeightPoints ? points * 4 / 3 : undefined;
  const fixed = custom === '1' || custom === 'true' ? true
    : custom === '0' || custom === 'false' || height !== undefined ? false : undefined;
  if (height === undefined && fixed === undefined) return undefined;
  return { height, fixed };
}

export function sourceRowHeight(source: ParsedRowHeightSource | undefined, row: number): number | undefined {
  const height = source?.rows.get(row)?.height ?? source?.height;
  return height === undefined ? undefined : Math.max(1, height);
}

export function fixedRowHeight(source: ParsedRowHeightSource | undefined, row: number): boolean {
  return source?.rows.get(row)?.fixed ?? source?.fixed ?? false;
}
