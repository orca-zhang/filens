import { dayMilliseconds, excelSerialFromTimestamp, excelTimeSerial, parseExcelIsoDate } from './excel-calendar';

type DateField = 'year' | 'month' | 'day';
interface LocalDateFormat {
  order: DateField[];
  normalize(value: string): string;
  monthNames: Map<string, number>;
  monthPattern?: RegExp;
  dateWords: Set<string>;
  periods: Map<string, boolean>;
  decimal: string;
  timePattern: RegExp;
}

interface DateTimeText { day?: number; time?: number }

const formats = new Map<string, LocalDateFormat>();
const dateDigits = /^(\d{1,4}) *([ ./-]) *(\d{1,4})(?: *\2 *(\d{1,4}))?\.?$/;
const dateMarkers = /^(\d{4}) *[年년] *(\d{1,2}) *[月월] *(\d{1,2}) *[日일]?$/;
const escapeRegex = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const words = (text: string) => text.match(/[\p{L}\p{M}\d]+/gu) ?? [];
const dateField = (part: Intl.DateTimeFormatPart): part is Intl.DateTimeFormatPart & { type: DateField } =>
  part.type === 'year' || part.type === 'month' || part.type === 'day';

function localeFormat(locale: string): LocalDateFormat {
  const cached = formats.get(locale);
  if (cached) return cached;
  const digitFormatter = new Intl.NumberFormat(locale, { useGrouping: false });
  const digits = new Map(Array.from({ length: 10 }, (_, digit) => [digitFormatter.format(digit).normalize('NFKC'), String(digit)]));
  const digitPattern = new RegExp([...digits.keys()].map(escapeRegex).join('|'), 'g');
  const normalize = (value: string) => value.normalize('NFKC').replace(/[\u061c\u200e\u200f\u2066-\u2069]/g, '')
    .replace(digitPattern, digit => digits.get(digit)!).toLocaleLowerCase(locale).replace(/\s+/g, ' ').trim();
  const utc = { calendar: 'gregory', timeZone: 'UTC' } as const;
  const sample = Date.UTC(2024, 10, 23);
  const numeric = new Intl.DateTimeFormat(locale, { ...utc, year: 'numeric', month: 'numeric', day: 'numeric' });
  const order = numeric.formatToParts(sample).filter(dateField).map(part => part.type);
  const monthNames = new Map<string, number>(), dateWords = new Set<string>();
  for (const month of ['short', 'long'] as const) {
    const standalone = new Intl.DateTimeFormat(locale, { ...utc, month });
    const inDate = new Intl.DateTimeFormat(locale, { ...utc, month, day: 'numeric', year: 'numeric' });
    for (let index = 0; index < 12; index++) {
      const date = Date.UTC(2024, index, 23);
      const parts = inDate.formatToParts(date);
      const names = [standalone.format(date), parts.find(part => part.type === 'month')?.value ?? ''];
      for (const name of names) {
        const key = words(normalize(name)).join(' ');
        if (/\p{L}/u.test(key)) monthNames.set(key, monthNames.has(key) && monthNames.get(key) !== index + 1 ? 0 : index + 1);
      }
      for (const part of parts) if (part.type === 'literal') {
        for (const token of words(normalize(part.value))) dateWords.add(token);
      }
    }
  }
  const clock = new Intl.DateTimeFormat(locale, { ...utc, hour: 'numeric', minute: 'numeric', second: 'numeric', hour12: true });
  const periods = new Map<string, boolean>([['am', false], ['pm', true], ['a.m.', false], ['p.m.', true], ['a. m.', false], ['p. m.', true]]);
  for (const hour of [3, 15]) {
    const part = clock.formatToParts(sample + hour * 3_600_000).find(part => part.type === 'dayPeriod');
    if (part?.value) periods.set(normalize(part.value), hour > 12);
  }
  const separators = new Set([':']);
  const hour24 = new Intl.DateTimeFormat(locale, { ...utc, hour: 'numeric', minute: 'numeric', hour12: false }).formatToParts(sample);
  const separator = hour24[hour24.findIndex(part => part.type === 'hour') + 1];
  const localSeparator = separator?.type === 'literal' ? normalize(separator.value) : '';
  if (/^(?:[.:·]|\p{L}{1,3})$/u.test(localSeparator)) separators.add(localSeparator);
  const decimal = digitFormatter.formatToParts(1.5).find(part => part.type === 'decimal')?.value ?? '.';
  const fractionSeparator = [...new Set(['.', ',', decimal])].map(escapeRegex).join('|');
  const periodPattern = [...periods.keys()].sort((a, b) => b.length - a.length).map(escapeRegex).join('|');
  const timeSeparator = [...separators].map(escapeRegex).join('|');
  const timePattern = new RegExp(`(?:^| )(?:(${periodPattern}) *)?(\\d{1,2})(?: *(${timeSeparator}) *(\\d{1,2})(?: *\\3 *(\\d{1,2}(?:(?:${fractionSeparator})\\d{1,3})?))?)? *(?:(${periodPattern}))?$`);
  const monthTerms = [...monthNames.keys()].sort((a, b) => b.length - a.length).map(escapeRegex);
  const monthPattern = monthTerms.length ? new RegExp(`(?:^| )(${monthTerms.join('|')})(?= |$)`) : undefined;
  const format = { order, normalize, monthNames, monthPattern, dateWords, periods, decimal, timePattern };
  formats.set(locale, format);
  return format;
}

function parseDay(text: string, format: LocalDateFormat, date1904: boolean | undefined, currentYear: () => number): number | undefined {
  let year: string | undefined, month: number, day: number;
  const native = dateMarkers.exec(text), numbers = dateDigits.exec(text);
  if (native) {
    year = native[1]; month = Number(native[2]); day = Number(native[3]);
  } else if (numbers) {
    const date = numbers[4] ? [numbers[1], numbers[3], numbers[4]] : [numbers[1], numbers[3]];
    const monthAndDay = format.order.filter(field => field !== 'year');
    let fields: DateField[] = format.order;
    if (date.length === 3) {
      if (date[0].length === 4) fields = ['year', 'month', 'day'];
      else if (date[2].length === 4) fields = [...monthAndDay, 'year'];
    } else {
      fields = date[0].length === 4 ? ['year', 'month'] : date[1].length === 4 ? ['month', 'year'] : monthAndDay;
    }
    year = date[fields.indexOf('year')];
    month = Number(date[fields.indexOf('month')]); day = Number(date[fields.indexOf('day')] ?? 1);
  } else {
    if (!/^[\p{L}\p{M}\d .,/\-]+$/u.test(text)) return undefined;
    const normalized = words(text).join(' ');
    const name = format.monthPattern?.exec(normalized);
    if (!name) return undefined;
    month = format.monthNames.get(name[1])!;
    const rest = words(normalized.slice(0, name.index) + ' ' + normalized.slice(name.index + name[0].length))
      .filter(word => !format.dateWords.has(word));
    if (rest.length < 1 || rest.length > 2 || rest.some(word => !/^\d{1,4}$/.test(word))) return undefined;
    if (rest[0].length >= 3) {
      year = rest[0]; day = Number(rest[1] ?? 1);
    } else {
      day = Number(rest[0]); year = rest[1];
    }
  }
  if (!Number.isInteger(month) || !Number.isInteger(day) || month < 1 || month > 12 || day < 1 || day > 31) return undefined;
  const rawYear = Number(year);
  const fullYear = year === undefined ? currentYear() : year.length <= 2 ? rawYear + (rawYear < 30 ? 2000 : 1900) : rawYear;
  const date = new Date(0);
  date.setUTCFullYear(fullYear, month - 1, day);
  if (date.getUTCFullYear() !== fullYear || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) return undefined;
  return excelSerialFromTimestamp(date.getTime(), date1904);
}

function parseClock(text: string, format: LocalDateFormat): { start: number; time: number } | undefined {
  const match = format.timePattern.exec(text);
  if (!match) return undefined;
  const [, prefix, rawHour, separator, minute, second, suffix] = match;
  const period = prefix ?? suffix;
  if ((prefix && suffix) || (!period && !separator)) return undefined;
  let hour = Number(rawHour);
  const minutes = Number(minute ?? 0), seconds = Number((second ?? '0').replace(format.decimal, '.').replace(',', '.'));
  if (minutes >= 60 || seconds >= 60 || (period ? hour < 1 || hour > 12 : hour >= 24)) return undefined;
  if (period) hour = hour % 12 + (format.periods.get(period) ? 12 : 0);
  return { start: match.index, time: (hour * 3600 + minutes * 60 + seconds) / 86_400 };
}

export function parseFormulaDateText(text: string, date1904: boolean | undefined, currentYear: () => number,
  preferTime = false, locale = globalThis.navigator?.language || Intl.DateTimeFormat().resolvedOptions().locale): DateTimeText | undefined {
  const raw = text.trim();
  if (!raw || raw.length > 256) return undefined;
  const isoTime = parseExcelIsoDate(raw);
  if (isoTime !== undefined) {
    const time = ((isoTime % dayMilliseconds + dayMilliseconds) % dayMilliseconds) / dayMilliseconds;
    return { day: Math.floor(excelSerialFromTimestamp(isoTime, date1904)), time: raw.includes('T') ? time : undefined };
  }
  const clockOnly = excelTimeSerial(raw);
  if (clockOnly !== undefined) return { time: clockOnly };
  const format = localeFormat(locale);
  // Chinese, Japanese and Korean date suffixes can touch the following time.
  const normalized = format.normalize(raw).replace(/([日일])(?=\S)/g, '$1 ');
  const clock = parseClock(normalized, format);
  if (preferTime && clock?.start === 0) return { time: clock.time };
  const day = parseDay(normalized, format, date1904, currentYear);
  if (day !== undefined) return { day };
  if (!clock) return undefined;
  if (clock.start === 0) return { time: clock.time };
  const date = parseDay(normalized.slice(0, clock.start).replace(/[, ]+$/, ''), format, date1904, currentYear);
  return date === undefined ? undefined : { day: date, time: clock.time };
}
