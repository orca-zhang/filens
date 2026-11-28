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

export function excelWeekStart(returnType: number): number | undefined {
  if (returnType === 1 || returnType === 17) return 0;
  if (returnType === 2) return 1;
  if (returnType >= 11 && returnType <= 16) return returnType - 10;
}

export function excelWeekNumber(day: number, start: number | 'iso', date1904?: boolean): number {
  // An ISO week belongs to the calendar year of its Thursday.
  const weekDate = start === 'iso' ? day + 3 - (excelWeekday(day, date1904) + 6) % 7 : day;
  const { year } = excelDateParts(weekDate, date1904);
  const january1 = excelSerialFromTimestamp(Date.UTC(year, 0, 1), date1904);
  const leadingDays = start === 'iso' ? 0 : (excelWeekday(january1, date1904) - start + 7) % 7;
  return Math.floor((weekDate - january1 + leadingDays) / 7) + 1;
}

function excelLeapYear(year: number): boolean {
  return year === 1900 || (year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0));
}

export function excelDays360(first: number, last: number, method: 'us' | 'european' | 'yearfrac', date1904?: boolean): number {
  const start = excelDateParts(first, date1904), end = excelDateParts(last, date1904);
  let startDay = Math.min(start.day, 30), endDay = end.day;
  if (method === 'european') endDay = Math.min(endDay, 30);
  else {
    const februaryEnd = start.month === 2 && start.day === (excelLeapYear(start.year) ? 29 : 28);
    if (februaryEnd) startDay = 30;
    if (method === 'yearfrac' && februaryEnd) {
      // YEARFRAC basis 0 keeps a 31st after a February month-end start.
      if (end.month === 2 && endDay === (excelLeapYear(end.year) ? 29 : 28)) endDay = 30;
    } else if (endDay === 31 && startDay === 30) endDay = 30;
  }
  return (end.year - start.year) * 360 + (end.month - start.month) * 30 + endDay - startDay;
}

export function excelYearFraction(first: number, last: number, basis: number, date1904?: boolean): number {
  if (first === last) return 0;
  const startDay = Math.min(first, last), endDay = Math.max(first, last);
  const days = endDay - startDay;
  if (basis === 0 || basis === 4) return excelDays360(startDay, endDay, basis === 0 ? 'yearfrac' : 'european', date1904) / 360;
  if (basis === 2 || basis === 3) return days / (basis === 2 ? 360 : 365);

  const start = excelDateParts(startDay, date1904), end = excelDateParts(endDay, date1904);
  const years = end.year - start.year;
  if (years > 1 || (years === 1 && (end.month > start.month || (end.month === start.month && end.day > start.day)))) {
    // Use the average length of all calendar years touched by the interval.
    const firstJanuary = excelSerialFromTimestamp(Date.UTC(start.year, 0, 1), date1904);
    const lastJanuary = excelSerialFromTimestamp(Date.UTC(end.year + 1, 0, 1), date1904);
    return days / ((lastJanuary - firstJanuary) / (years + 1));
  }
  const leap = (excelLeapYear(start.year) && (years === 0 || start.month <= 2))
    || (excelLeapYear(end.year) && (end.month > 2 || (end.month === 2 && end.day === 29)));
  return days / (leap ? 366 : 365);
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
