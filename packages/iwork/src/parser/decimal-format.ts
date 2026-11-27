import { asArray, asObject, readField } from './helpers';
import { resolveNumbersLocale } from './number-formats';

export interface NumbersFormatting {
  locale?: string;
  symbols?: Record<string, unknown>;
  customFormats?: ReadonlyMap<string, Record<string, unknown>>;
}

export interface DecimalNumberFormat {
  formatType?: number;
  decimalPlaces?: number;
  currencyCode?: string;
  negativeStyle?: number;
  showThousandsSeparator?: boolean;
  useAccountingStyle?: boolean;
  scaleFactor?: number;
  usesPlusSign?: boolean;
}

export interface FormattedDecimal {
  text: string;
  red?: boolean;
  accounting?: [string, string];
}

export function readNumbersCurrencySymbols(symbols: NumbersFormatting['symbols']): Map<string, string> {
  const currencies = new Map<string, string>();
  for (const item of asArray(readField(symbols, ['currencySymbols', 'currency_symbols']))) {
    const data = asObject(item);
    const code = readField(data, ['code']), label = readField(data, ['symbol']);
    if (typeof code === 'string' && typeof label === 'string' && label) currencies.set(code.toUpperCase(), label);
  }
  return currencies;
}

export function createDecimalFormatter(formatting?: NumbersFormatting) {
  const cache = new WeakMap<DecimalNumberFormat, {
    formatter: Intl.NumberFormat;
    style: 'decimal' | 'currency' | 'percent';
    currency?: string;
    zero: string;
  } | null>();
  const symbols = formatting?.symbols;
  const symbol = (camel: string, snake: string) => {
    const value = readField(symbols, [camel, snake]);
    return typeof value === 'string' && value ? value : undefined;
  };
  const decimal = symbol('decimalSeparator', 'decimal_separator');
  const grouping = symbol('groupingSeparator', 'grouping_separator');
  const currencyDecimal = symbol('currencyDecimalSeparator', 'currency_decimal_separator') ?? decimal;
  const currencyGrouping = symbol('currencyGroupingSeparator', 'currency_grouping_separator') ?? grouping;
  const percent = symbol('percentSymbol', 'percent_symbol');
  const numberingSystem = symbol('numberingSystem', 'numbering_system');
  let minusSign = symbol('minusSign', 'minus_sign');
  let plusSign = symbol('plusSign', 'plus_sign');
  let locale: string | undefined;
  let signs: Intl.NumberFormat | undefined;
  let currencies: Map<string, string> | undefined;

  return (value: number, format: DecimalNumberFormat): FormattedDecimal | undefined => {
    if (!Number.isFinite(value) || (format.formatType !== 256 && format.formatType !== 257 && format.formatType !== 258)) {
      return undefined;
    }
    let entry = cache.get(format);
    if (entry === undefined) {
      const style = format.formatType === 257 ? 'currency' : format.formatType === 258 ? 'percent' : 'decimal';
      const currency = style === 'currency' ? format.currencyCode?.trim().toUpperCase() || symbol('currencyCode', 'currency_code') : undefined;
      const places = format.decimalPlaces ?? (style === 'currency' ? 2 : 253);
      locale ??= resolveNumbersLocale(formatting?.locale);
      try {
        const formatter = new Intl.NumberFormat(locale, {
          style, currency, numberingSystem, useGrouping: format.showThousandsSeparator === true,
          ...(places === 253 ? { maximumSignificantDigits: 15 } : { minimumFractionDigits: places, maximumFractionDigits: places })
        });
        const zero = formatter.formatToParts(0).find(part => part.type === 'integer')?.value ?? '0';
        entry = { formatter, style, currency, zero };
      } catch {
        entry = null;
      }
      cache.set(format, entry);
    }
    if (!entry) return undefined;

    const { formatter, style, currency, zero } = entry;
    if (currency) currencies ??= readNumbersCurrencySymbols(symbols);
    const scaled = style === 'percent' && Number.isFinite(format.scaleFactor) && format.scaleFactor ? value * (format.scaleFactor / 100) : value;
    if (!Number.isFinite(scaled)) return undefined;
    let prefix = '', number = '', suffix = '', nonzero = false, currencyBefore = false;
    for (const part of formatter.formatToParts(Math.abs(scaled))) {
      if (part.type === 'integer' || part.type === 'fraction') {
        number += part.value;
        nonzero ||= part.value !== zero.repeat(part.value.length / zero.length);
      } else if (part.type === 'decimal') {
        number += (currency ? currencyDecimal : decimal) ?? part.value;
      } else if (part.type === 'group') {
        number += (currency ? currencyGrouping : grouping) ?? part.value;
      } else {
        if (part.type === 'currency') currencyBefore = !number;
        const label = (part.type === 'currency' && currency ? currencies?.get(currency) :
          part.type === 'percentSign' ? percent : undefined) ?? part.value;
        if (number) suffix += label;
        else prefix += label;
      }
    }

    const negative = scaled < 0;
    const red = negative && nonzero && (format.negativeStyle === 1 || format.negativeStyle === 3);
    const accounting = !!currency && format.useAccountingStyle === true;
    const parentheses = negative && (accounting || format.negativeStyle === 2 || format.negativeStyle === 3);
    if (nonzero && !parentheses && !red && (negative || format.usesPlusSign)) {
      if (negative ? !minusSign : !plusSign) {
        signs ??= new Intl.NumberFormat(locale, { signDisplay: 'always' });
        const sign = negative ? 'minusSign' : 'plusSign';
        const mark = signs.formatToParts(negative ? -1 : 1).find(part => part.type === sign)?.value;
        if (negative) minusSign = mark ?? '-';
        else plusSign = mark ?? '+';
      }
      number = (negative ? minusSign : plusSign) + number;
    }
    if (currency && parentheses) number = `(${number})`;
    if (accounting) {
      const parts: [string, string] = currencyBefore ? [prefix.trim() + ' ', number + suffix] : [prefix + number + ' ', suffix.trim()];
      return { text: parts.join(''), red, accounting: parts };
    }
    const text = prefix + number + suffix;
    return { text: parentheses && !currency ? `(${text})` : text, red };
  };
}
