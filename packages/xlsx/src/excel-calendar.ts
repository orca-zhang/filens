const isoDate = /^\d{4}-\d{2}-\d{2}(?:T\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:\d{2})?)?$/;
export const dayMilliseconds = 86_400_000;
const first1900 = Date.UTC(1899, 11, 31);
const first1904 = Date.UTC(1904, 0, 1);
const march1900 = Date.UTC(1900, 2, 1);
const year10000 = Date.UTC(10000, 0, 1);
const clockTime = /^(\d{1,2}):(\d{2})(?::(\d{2}(?:\.\d+)?))?(?: *(AM|PM))?$/i;

export function excelSerialFromTimestamp(timestamp: number, date1904?: boolean): number {
  return date1904 ? (timestamp - first1904) / dayMilliseconds
    : (timestamp - first1900) / dayMilliseconds + Number(timestamp >= march1900);
}

/** Excel stores local wall time on the same date axis used for literal dates. */
export function excelLocalDateSerial(date: Date, dayOnly: boolean, date1904?: boolean): number {
  const time = Date.UTC(date.getFullYear(), date.getMonth(), date.getDate(), dayOnly ? 0 : date.getHours(),
    dayOnly ? 0 : date.getMinutes(), dayOnly ? 0 : date.getSeconds(), dayOnly ? 0 : date.getMilliseconds());
  return excelSerialFromTimestamp(time, date1904);
}

export function excelDateSerial(raw: string, date1904?: boolean): number | undefined {
  const timestamp = parseExcelIsoDate(raw);
  return timestamp === undefined ? undefined : excelSerialFromTimestamp(timestamp, date1904);
}

export function parseExcelIsoDate(raw: string): number | undefined {
  if (!isoDate.test(raw)) return undefined;
  const calendarDate = raw.slice(0, 10);
  const midnight = new Date(calendarDate);
  if (!Number.isFinite(midnight.getTime()) || midnight.toISOString().slice(0, 10) !== calendarDate) return undefined;
  const date = Date.parse(raw.includes('T') && !/(?:Z|[+-]\d{2}:\d{2})$/.test(raw) ? raw + 'Z' : raw);
  return Number.isFinite(date) ? date : undefined;
}

export function excelTimeSerial(raw: string): number | undefined {
  const match = clockTime.exec(raw);
  if (!match) return undefined;
  let hour = Number(match[1]);
  const minute = Number(match[2]), second = Number(match[3] ?? 0);
  if (minute >= 60 || second >= 60 || (match[4] ? hour < 1 || hour > 12 : hour >= 24)) return undefined;
  if (match[4]) hour = hour % 12 + (match[4].toUpperCase() === 'PM' ? 12 : 0);
  return (hour * 3600 + minute * 60 + second) / 86_400;
}

export function isExcelDateSerial(serial: number, date1904?: boolean): boolean {
  return serial >= 0 && serial < (date1904 ? limit1904 : limit1900);
}

export function lastExcelDateSerial(date1904?: boolean): number {
  return (date1904 ? limit1904 : limit1900) - 1;
}

const limit1900 = excelSerialFromTimestamp(year10000);
const limit1904 = excelSerialFromTimestamp(year10000, true);

/** Calendar parts for a validated, integral serial, including Excel's two synthetic dates. */
export function excelDateParts(day: number, date1904?: boolean): { year: number; month: number; day: number } {
  if (!date1904) {
    if (day === 0) return { year: 1900, month: 1, day: 0 };
    if (day === 60) return { year: 1900, month: 2, day: 29 };
  }
  const timestamp = date1904 ? first1904 + day * dayMilliseconds
    : first1900 + (day - Number(day > 60)) * dayMilliseconds;
  const date = new Date(timestamp);
  return { year: date.getUTCFullYear(), month: date.getUTCMonth() + 1, day: date.getUTCDate() };
}

export function excelWeekday(day: number, date1904?: boolean): number {
  // Sunday is zero. The 1900 epoch includes Excel's historical weekday shift before March.
  return (day + (date1904 ? 5 : 6)) % 7;
}

export function countExcelWorkingDays(first: number, last: number, weekend: number, date1904?: boolean): number {
  if (first > last) return 0;
  const length = last - first + 1, weeks = Math.floor(length / 7), remainder = length % 7;
  const start = excelWeekday(first, date1904);
  let count = 0;
  for (let i = 0; i < 7; i++) {
    if (!(weekend & (1 << ((start + i) % 7)))) count += weeks + Number(i < remainder);
  }
  return count;
}

export function indexExcelHolidays(days: ReadonlySet<number>, date1904?: boolean): number[][] {
  if (!days.size) return [];
  const weekdays = Array.from({ length: 7 }, (): number[] => []);
  for (const day of days) weekdays[excelWeekday(day, date1904)].push(day);
  for (const entries of weekdays) entries.sort((a, b) => a - b);
  return weekdays;
}

export function countExcelHolidays(holidays: readonly (readonly number[])[], first: number, last: number, weekend: number): number {
  let count = 0;
  for (let day = 0; day < holidays.length; day++) {
    if (!(weekend & (1 << day))) count += firstHoliday(holidays[day], last + 1) - firstHoliday(holidays[day], first);
  }
  return count;
}

function firstHoliday(days: readonly number[], limit: number): number {
  let low = 0, high = days.length;
  while (low < high) {
    const mid = (low + high) >>> 1;
    if (days[mid] < limit) low = mid + 1;
    else high = mid;
  }
  return low;
}

/** Find the first distance with enough working days. */
export function offsetExcelWorkingDays(start: number, offset: number, weekend: number, holidays: readonly (readonly number[])[],
  date1904?: boolean): number | undefined {
  const forward = offset > 0, target = Math.abs(offset);
  const horizon = forward ? lastExcelDateSerial(date1904) - start : start;
  const excluded = countExcelHolidays(holidays, forward ? start + 1 : 0, forward ? start + horizon : start - 1, weekend);
  const weeks = Math.ceil((target + excluded) / countExcelWorkingDays(0, 6, weekend, date1904));
  const capacity = Math.min(horizon, weeks * 7);
  const count = (distance: number) => {
    const edge = forward ? start + distance : start - distance;
    const first = forward ? start + 1 : edge, last = forward ? edge : start - 1;
    return countExcelWorkingDays(first, last, weekend, date1904) - countExcelHolidays(holidays, first, last, weekend);
  };
  if (target > capacity || count(capacity) < target) return undefined;
  let low = 1, high = capacity;
  while (low < high) {
    const mid = Math.floor((low + high) / 2);
    if (count(mid) < target) low = mid + 1;
    else high = mid;
  }
  return forward ? start + low : start - low;
}
