import type { NumbersFormatting } from './decimal-format';
import { readField } from './helpers';
import { resolveNumbersLocale } from './number-formats';

type Width = 'narrow' | 'short' | 'long';
const dayMilliseconds = 86_400_000;
const widths = { narrow: 'tiny', short: 'short', long: '' } as const;
const capitalize = (value: string) => value ? value[0].toUpperCase() + value.slice(1) : value;
// CLDR territories with a four-day minimum. Intl.Locale.getWeekInfo omits this field in current browsers.
const fourDayWeekRegions = new Set(('AD AN AT AX BE BG CH CZ DE DK EE ES FI FJ FO FR GB GF GG GI GP GR HU IE IM '
  + 'IS IT JE LI LT LU MC MQ NL NO PL PT RE RU SE SJ SK SM VA').split(' '));

export function createDateSymbols(formatting?: NumbersFormatting) {
  let locale: string | undefined;
  const getLocale = () => locale ??= resolveNumbersLocale(formatting?.locale);
  const symbols = formatting?.symbols;
  const dateFormats = new Map<string, Intl.DateTimeFormat>();
  const names = new Map<string, string>();
  let digitLabels: string[] | undefined;
  let weekRules: { firstDay: number; minimalDays: number } | undefined;
  const localPart = (date: Date, key: string, part: string, options: Intl.DateTimeFormatOptions) => {
    let formatter = dateFormats.get(key);
    if (!formatter) {
      formatter = new Intl.DateTimeFormat(getLocale(), { ...options, calendar: 'gregory', timeZone: 'UTC' });
      dateFormats.set(key, formatter);
    }
    return formatter.formatToParts(date).find(value => value.type === part)?.value;
  };

  const namedField = (date: Date, field: 'month' | 'weekday', width: Width, standalone = false) => {
    const index = field === 'month' ? date.getUTCMonth() : date.getUTCDay();
    const base = field + 's';
    const label = widths[width];
    const standaloneKey = standalone ? `standalone${capitalize(label)}${capitalize(base)}` : '';
    const formatKey = label ? label + capitalize(base) : base;
    const key = `${standaloneKey || formatKey}/${index}`;
    const cached = names.get(key);
    if (cached) return cached;
    const entries = standaloneKey && readField<unknown[]>(symbols, [standaloneKey]);
    const archived = (Array.isArray(entries) && entries[index]) || readField<unknown[]>(symbols, [formatKey])?.[index];
    const value = typeof archived === 'string' && archived ? archived
      : localPart(date, standaloneKey || formatKey, field, field === 'weekday' ? { weekday: width }
        : standalone ? { month: width } : { month: width, day: 'numeric' });
    if (value) names.set(key, value);
    return value;
  };

  const getWeekRules = () => {
    if (!weekRules) {
      const info = new Intl.Locale(getLocale()) as Intl.Locale & {
        getWeekInfo?: () => { firstDay: number; minimalDays: number };
        weekInfo?: { firstDay: number; minimalDays: number };
      };
      const runtime = info.getWeekInfo?.() ?? info.weekInfo;
      const minimum = fourDayWeekRegions.has(info.maximize().region ?? '') ? 4 : 1;
      weekRules = { firstDay: runtime?.firstDay ?? (minimum === 4 ? 1 : 7), minimalDays: runtime?.minimalDays ?? minimum };
    }
    return weekRules;
  };

  return {
    month: (date: Date, width: Width, standalone: boolean) => namedField(date, 'month', width, standalone),
    weekday: (date: Date, width: Width) => namedField(date, 'weekday', width),
    era(date: Date, width: Width) {
      const index = Number(date.getUTCFullYear() > 0);
      const key = `era/${width}/${index}`;
      const cached = names.get(key);
      if (cached) return cached;
      const archived = width === 'narrow' ? undefined : readField<unknown[]>(symbols, [width === 'long' ? 'longEras' : 'eras'])?.[index];
      const era = typeof archived === 'string' && archived ? archived
        : localPart(date, `era/${width}`, 'era', { era: width }) ?? (index ? 'AD' : 'BC');
      names.set(key, era);
      return era;
    },
    period(date: Date) {
      const pm = date.getUTCHours() >= 12;
      const key = pm ? 'pmSymbol' : 'amSymbol';
      const cached = names.get(key);
      if (cached) return cached;
      const saved = readField<unknown>(symbols, [key]);
      const period = typeof saved === 'string' && saved ? saved :
        localPart(date, 'period', 'dayPeriod', { hour: 'numeric', hour12: true }) ?? (pm ? 'PM' : 'AM');
      names.set(key, period);
      return period;
    },
    digits(text: string) {
      if (!digitLabels) {
        const system = readField<unknown>(symbols, ['numberingSystem']);
        const numberingSystem = typeof system === 'string' && /^[a-z0-9]{3,8}$/i.test(system) ? system : undefined;
        const formatter = new Intl.NumberFormat(getLocale(), { useGrouping: false, numberingSystem });
        digitLabels = formatter.resolvedOptions().numberingSystem === 'latn' ? []
          : Array.from({ length: 10 }, (_, index) => formatter.format(index));
      }
      return digitLabels.length ? text.replace(/[0-9]/g, digit => digitLabels![Number(digit)]) : text;
    },
    week(date: Date, month: boolean) {
      const { firstDay, minimalDays } = getWeekRules();
      const start = (year: number, month: number) => {
        const first = new Date(0);
        first.setUTCFullYear(year, month, 1);
        const offset = (first.getUTCDay() - firstDay + 7) % 7;
        const delta = 7 - offset < minimalDays ? 7 - offset : -offset;
        return first.getTime() + delta * dayMilliseconds;
      };
      const year = date.getUTCFullYear();
      const beginning = start(year, month ? date.getUTCMonth() : 0);
      if (month) return Math.max(0, Math.floor((date.getTime() - beginning) / (7 * dayMilliseconds)) + 1);
      if (date.getTime() >= start(year + 1, 0)) return 1;
      const weekStart = date.getTime() < beginning ? start(year - 1, 0) : beginning;
      return Math.floor((date.getTime() - weekStart) / (7 * dayMilliseconds)) + 1;
    }
  };
}
