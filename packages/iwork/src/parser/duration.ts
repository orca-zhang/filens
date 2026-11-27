export interface NumbersDurationFormat {
  durationStyle?: number;
  durationUnitLargest?: number;
  durationUnitSmallest?: number;
  useAutomaticDurationUnits?: boolean;
}

const units = [
  { code: 1, milliseconds: 604_800_000, name: 'week' },
  { code: 2, milliseconds: 86_400_000, name: 'day' },
  { code: 4, milliseconds: 3_600_000, name: 'hour' },
  { code: 8, milliseconds: 60_000, name: 'minute' },
  { code: 16, milliseconds: 1_000, name: 'second' },
  { code: 32, milliseconds: 1, name: 'millisecond' }
];

export function createDurationFormatter(localeIdentifier?: string) {
  const locale = resolveNumbersLocale(localeIdentifier);
  const formatters = new Map<number | string, Intl.NumberFormat>();
  const getFormatter = (key: number | string, options: Intl.NumberFormatOptions): Intl.NumberFormat => {
    let formatter = formatters.get(key);
    if (!formatter) {
      formatter = new Intl.NumberFormat(locale, { useGrouping: false, ...options });
      formatters.set(key, formatter);
    }
    return formatter;
  };
  let decimalSeparator: string | undefined;

  return (seconds: number, format: NumbersDurationFormat): string => {
    const style = format.durationStyle ?? 0;
    if (style !== 0 && style !== 1 && style !== 2) return '';
    const total = Math.round(Math.abs(seconds) * 1_000);
    if (!Number.isSafeInteger(total)) return '';
    let first = units.findIndex(unit => unit.code === format.durationUnitLargest);
    let last = units.findIndex(unit => unit.code === format.durationUnitSmallest);
    if (format.useAutomaticDurationUnits) {
      first = total ? units.findIndex(unit => total >= unit.milliseconds) : 1;
      last = total ? Math.max(first, units.findIndex(unit => total % unit.milliseconds === 0)) : first;
    }
    if (first < 0 || last < first) return '';

    const parts: string[] = [];
    let remaining = total;
    for (let index = first; index <= last; index += 1) {
      const unit = units[index];
      const value = Math.floor(remaining / unit.milliseconds);
      remaining %= unit.milliseconds;
      if (style === 0) {
        const width = unit.code === 32 ? 3 : (unit.code === 8 || unit.code === 16) && first !== last ? 2 : 1;
        parts.push(getFormatter(width, { minimumIntegerDigits: width }).format(value));
      } else {
        const unitDisplay = style === 1 ? 'narrow' : 'long';
        parts.push(getFormatter(`${style}/${unit.name}`, { style: 'unit', unit: unit.name, unitDisplay }).format(value));
      }
    }
    const sign = seconds < 0 && remaining !== total ? '-' : '';
    if (style === 0 && units[last].code === 32 && first !== last) {
      decimalSeparator ??= getFormatter(1, {}).formatToParts(0.1).find(part => part.type === 'decimal')?.value ?? '.';
      return sign + parts.slice(0, -1).join(':') + decimalSeparator + parts.at(-1);
    }
    return sign + parts.join(style === 0 ? ':' : ' ');
  };
}
import { resolveNumbersLocale } from './number-formats';

