import { columnIndexToName } from './columns';
import type { ParsedCell } from './types';

/** Preview value cells derive canonical A1 addresses from their coordinates. */
export class WorksheetValueCell implements ParsedCell {
  constructor(readonly row: number, readonly column: number, public value: string) {}

  get ref(): string { return columnIndexToName(this.column) + this.row; }
}

const canonicalRef = /^[A-Z]{1,3}[1-9]\d{0,6}$/;

export function createWorksheetCell(ref: string | undefined, row: number, column: number, value: string, compact = false): ParsedCell {
  return compact && row <= 1_048_576 && column <= 16_384 && (ref === undefined || canonicalRef.test(ref))
    ? new WorksheetValueCell(row, column, value)
    : { ref: ref ?? columnIndexToName(column) + row, row, column, value };
}
