import SSF from 'ssf';
import type { ParsedCell } from './types';

const numericValue = /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?$/i;
const isoDate = /^\d{4}-\d{2}-\d{2}(?:T\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:\d{2})?)?$/;
const dayMilliseconds = 86_400_000;
const first1900 = Date.UTC(1899, 11, 31);
const first1904 = Date.UTC(1904, 0, 1);
const march1900 = Date.UTC(1900, 2, 1);

// SSF maps these four currency IDs to non-currency aliases in its default table.
const dollarFormats = [
  '$#,##0_);($#,##0)', '$#,##0_);[Red]($#,##0)',
  '$#,##0.00_);($#,##0.00)', '$#,##0.00_);[Red]($#,##0.00)'
];

export function builtinNumberFormat(id: number): number | string | undefined {
  if (!Number.isInteger(id)) return undefined;
  if (id >= 5 && id <= 8) return dollarFormats[id - 5];
  if ((id >= 1 && id <= 22) || (id >= 27 && id <= 31) || (id >= 37 && id <= 81)) return id;
  return undefined;
}

export function formatCellValue(raw: string, type: ParsedCell['valueType'], code: string | number, date1904 = false): string {
  // Number format codes in Excel can be up to 255 characters.
  if (!raw || type === 'boolean' || type === 'error' || (typeof code === 'string' && (!code || code.length > 255 || /^general$/i.test(code)))) return raw;
  let value: string | number = raw;
  if (type === 'date') {
    const serial = excelDateSerial(raw, date1904);
    if (serial === undefined || serial < 0) return raw;
    value = serial;
  } else if (type !== 'text') {
    const trimmed = raw.trim();
    if (!numericValue.test(trimmed)) return raw;
    value = Number(trimmed);
    if (!Number.isFinite(value)) return raw;
  }
  try {
    return SSF.format(code, value, { date1904 });
  } catch {
    // An unsupported or malformed source format must not hide the underlying value.
    return raw;
  }
}

export function excelDateSerial(raw: string, date1904 = false): number | undefined {
  if (!isoDate.test(raw)) return undefined;
  const calendarDate = raw.slice(0, 10);
  const midnight = new Date(calendarDate);
  if (!Number.isFinite(midnight.getTime()) || midnight.toISOString().slice(0, 10) !== calendarDate) return undefined;
  const date = Date.parse(raw.includes('T') && !/(?:Z|[+-]\d{2}:\d{2})$/.test(raw) ? raw + 'Z' : raw);
  if (!Number.isFinite(date)) return undefined;
  return date1904 ? (date - first1904) / dayMilliseconds
    : (date - first1900) / dayMilliseconds + Number(date >= march1900);
}
