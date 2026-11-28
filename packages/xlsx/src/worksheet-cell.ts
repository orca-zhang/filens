import { columnIndexToName } from './columns';
import type { ParsedCell } from './types';

/** Preview value cells derive canonical A1 addresses from their coordinates. */
export class WorksheetValueCell implements ParsedCell {
  constructor(readonly row: number, readonly column: number, private stored: string | number) {}

  get ref(): string { return columnIndexToName(this.column) + this.row; }
  get value(): string { return typeof this.stored === 'string' ? this.stored : String(this.stored); }
  set value(value: string) { this.stored = value; }
  get numericValue(): number | undefined { return typeof this.stored === 'number' ? this.stored : undefined; }
}

const canonicalRef = /^[A-Z]{1,3}[1-9]\d{0,6}$/;
const canonicalInteger = /^(?:0|-?[1-9]\d{0,9})$/;

export function createWorksheetCell(ref: string | undefined, row: number, column: number, value: string,
  valueType: ParsedCell['valueType'], compact = false): ParsedCell {
  let cell: ParsedCell;
  if (compact && row <= 1_048_576 && column <= 16_384 && (ref === undefined || canonicalRef.test(ref))) {
    const integer = !valueType && canonicalInteger.test(value) ? Number(value) : NaN;
    // A signed 31-bit integer fits inline in V8's compressed-pointer representation.
    cell = new WorksheetValueCell(row, column, integer >= -0x40000000 && integer < 0x40000000 ? integer : value);
  } else cell = { ref: ref ?? columnIndexToName(column) + row, row, column, value };
  if (valueType) cell.valueType = valueType;
  return cell;
}
