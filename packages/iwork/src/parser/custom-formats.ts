import { readNumbersCurrencySymbols, type NumbersFormatting } from './decimal-format';
import { asArray, asObject, readField, readIcuQuotedLiteral, uuidToKey } from './helpers';
import { formatBuiltInNumber, resolveNumbersLocale } from './number-formats';

type ArchiveFormat = Record<string, unknown>;
type RenderNumber = (value: number, showSign?: boolean) => string | undefined;

export interface NumbersCustomFormat {
  date?: string;
  text?: string[];
  number?: (value: number) => string | undefined;
}

function matchesCondition(value: number, type: number | undefined, threshold: number): boolean {
  switch (type) {
    case 0: return value === threshold;
    case 1: return value < threshold;
    case 2: return value <= threshold;
    case 3: return value > threshold;
    case 4: return value >= threshold;
    default: return false;
  }
}

export function createNumbersCustomFormatReader(formatting?: NumbersFormatting) {
  const cache = new WeakMap<ArchiveFormat, NumbersCustomFormat | undefined>();
  const symbols = formatting?.symbols;
  let locale: string | undefined;
  let currencies: Map<string, string> | undefined;
  let defaultMinus: string | undefined;
  const symbol = (camel: string, snake: string) => readField<string>(symbols, [camel, snake]) || undefined;
  const numberingSystem = symbol('numberingSystem', 'numbering_system');
  const localeOptions = { numberingSystem: /^[a-z0-9]{3,8}$/i.test(numberingSystem ?? '') ? numberingSystem : undefined };

  function compileNumber(format: ArchiveFormat | undefined, pattern: unknown): RenderNumber | undefined {
    if (typeof pattern !== 'string') return undefined;
    locale ??= resolveNumbersLocale(formatting?.locale);
    const currency = readField<string>(format, ['currencyCode', 'currency_code']);
    const decimal = (currency && symbol('currencyDecimalSeparator', 'currency_decimal_separator'))
      || symbol('decimalSeparator', 'decimal_separator');
    const grouping = (currency && symbol('currencyGroupingSeparator', 'currency_grouping_separator'))
      || symbol('groupingSeparator', 'grouping_separator');
    const percent = symbol('percentSymbol', 'percent_symbol') ?? '%';
    defaultMinus ??= new Intl.NumberFormat(locale, localeOptions).formatToParts(-1).find(part => part.type === 'minusSign')?.value ?? '-';
    const minus = symbol('minusSign', 'minus_sign') ?? defaultMinus;
    const plus = symbol('plusSign', 'plus_sign') ?? '+';
    const numberPattern = /(?:[#0]+(?:,[#0]+)*(?:\.[#0]+)?|\.[#0]+)(?:E[+-]0+)?/y;
    let prefix = '', suffix = '', usesPercent = false;
    let render: ((magnitude: number) => string | undefined) | undefined;
    for (let index = 0; index < pattern.length;) {
      const literal = readIcuQuotedLiteral(pattern, index);
      numberPattern.lastIndex = index;
      const token = literal ? undefined : numberPattern.exec(pattern)?.[0];
      const char = pattern[index];
      if (token || (!literal && char === '\uE420')) {
        if (render) return undefined;
        if (token) {
          render = decimalRenderer(token, format, locale, localeOptions, decimal, grouping, minus, plus);
          if (!render) return undefined;
        } else {
          const fractionAccuracy = readField<number>(format, ['fractionAccuracy', 'fraction_accuracy']);
          if (!readField(format, ['requiresFractionReplacement', 'requires_fraction_replacement'])) return undefined;
          const fraction = { formatType: 262, fractionAccuracy };
          render = value => formatBuiltInNumber(value, fraction) || undefined;
        }
        index += token?.length ?? 1;
        continue;
      }
      let text = literal?.text ?? char;
      if (!literal && char === '%') {
        usesPercent = true;
        text = percent;
      } else if (!literal && char === '¤' && currency) {
        currencies ??= readNumbersCurrencySymbols(symbols);
        text = (currencies.get(currency.toUpperCase()) ?? currency) + '\u00a0';
      }
      if (render) suffix += text;
      else prefix += text;
      index += literal?.length ?? 1;
    }
    if (!render) return () => prefix;

    const savedScale = readField<number>(format, ['scaleFactor', 'scale_factor']) ?? 1;
    const scale = usesPercent && savedScale === 1 ? 100 : savedScale;
    return (value, showSign = true) => {
      const scaled = value * scale;
      if (!Number.isFinite(scaled)) return undefined;
      const text = render(Math.abs(scaled));
      return text === undefined ? undefined : (showSign && scaled < 0 ? minus : '') + prefix + text + suffix;
    };
  }

  return (reference: ArchiveFormat): NumbersCustomFormat | undefined => {
    const id = uuidToKey(readField(reference, ['customUid', 'custom_uid']));
    const definition = (id ? formatting?.customFormats?.get(id) : undefined)
      ?? asObject(readField(reference, ['customFormat', 'custom_format']));
    if (!definition) return undefined;
    if (cache.has(definition)) return cache.get(definition);
    const format = asObject(readField(definition, ['defaultFormat', 'default_format']));
    const type = readField(format, ['formatType', 'format_type']) ?? readField(reference, ['formatType', 'format_type']);
    const pattern = readField(format, ['customFormatString', 'custom_format_string']);
    let custom: NumbersCustomFormat | undefined;
    if (type === 272 && typeof pattern === 'string' && pattern) {
      custom = { date: pattern };
    } else if (type === 271 && typeof pattern === 'string') {
      custom = { text: pattern.split('\uE421') };
    } else if (type === 270 || type === 274) {
      const fallback = compileNumber(format, pattern);
      const conditions: { type?: number; threshold: number; render: RenderNumber }[] = [];
      for (const condition of asArray<ArchiveFormat>(readField(definition, ['conditions']))) {
        const type = readField<number>(condition, ['conditionType', 'condition_type']);
        const threshold = readField<number>(condition, ['conditionValueDbl', 'condition_value_dbl'])
          ?? readField<number>(condition, ['conditionValue', 'condition_value']);
        if (threshold === undefined || !Number.isFinite(threshold)) continue;
        const rule = asObject(readField(condition, ['conditionFormat', 'condition_format']));
        const render = compileNumber(rule, readField(rule, ['customFormatString', 'custom_format_string']));
        if (render) conditions.push({ type, threshold, render });
      }
      custom = {
        number: conditions.length
          ? value => {
            const comparison = Number(value.toPrecision(15));
            const match = conditions.find(({ type, threshold }) => matchesCondition(comparison, type, threshold));
            return match ? match.render(value, false) : fallback?.(value);
          }
          : fallback
      };
    }
    cache.set(definition, custom);
    return custom;
  };
}

function decimalRenderer(pattern: string, format: ArchiveFormat | undefined, locale: string,
  localeOptions: Intl.NumberFormatOptions, decimal: string | undefined, grouping: string | undefined,
  minus: string, plus: string): ((value: number) => string) | undefined {
  const [mantissa, exponent] = pattern.split('E');
  const [integer, fraction = ''] = mantissa.split('.');
  const group = !exponent && readField(format, ['showThousandsSeparator', 'show_thousands_separator']) === true;
  const integerDigits = integer.replace(/,/g, '').length;
  const integerZeros = readField<number>(format, ['numNonspaceIntegerDigits', 'num_nonspace_integer_digits']) ?? 0;
  const fractionZeros = readField<number>(format, ['numNonspaceDecimalDigits', 'num_nonspace_decimal_digits']) ?? 0;
  if (integerDigits > 21 || fraction.length > 20 || (exponent?.length ?? 0) > 21) return undefined;
  const integerWidth = integer.startsWith('0') ? (group ? integer.length : integerDigits) : 0;
  const fractionWidth = fraction.startsWith('0') && !fractionZeros && !exponent ? fraction.length : 0;
  const minimumFractionDigits = exponent || (!integerDigits && fractionWidth)
    ? fraction.length : Math.min(fraction.length, Math.max(fractionZeros, integerDigits ? 0 : 1));
  const options = {
    ...localeOptions, notation: exponent ? 'scientific' : 'standard', useGrouping: group,
    roundingMode: 'halfEven', maximumFractionDigits: fraction.length, minimumFractionDigits,
    minimumIntegerDigits: Math.max(1, Math.min(integerDigits, integerZeros))
  } as const;
  const formatter = new Intl.NumberFormat(locale, options);
  const [zero = '0'] = formatter.formatToParts(0).find(part => part.type === 'integer')?.value ?? '';
  const decimalMark = decimal ?? (fraction.length
    ? formatter.formatToParts(0.1).find(part => part.type === 'decimal')?.value : undefined) ?? '.';

  return value => {
    let whole = '', digits = '', power = '', powerSign = '';
    for (const part of formatter.formatToParts(value)) {
      switch (part.type) {
        case 'integer': whole += part.value; break;
        case 'group': whole += grouping ?? part.value; break;
        case 'fraction': digits = part.value; break;
        case 'exponentInteger': power = part.value; break;
        case 'exponentMinusSign': powerSign = minus; break;
      }
    }
    if (exponent) {
      const powerPadding = Math.max(0, exponent.length - 1 - [...power].length);
      return whole + (digits ? decimalMark + digits : '')
        + 'E' + (powerSign || (exponent[0] === '+' ? plus : '')) + zero.repeat(powerPadding) + power;
    }
    const digitCount = [...digits].length;
    // Space-filled integer fields can suppress the leading zero when the decimal field is full.
    if (whole === zero && !integerZeros && (fractionWidth || (integerWidth
      && (!fraction.length || fractionZeros || Math.max(1, digitCount) + 2 > fraction.length)))) whole = '';
    if (integerWidth && !integerZeros) whole = ' '.repeat(Math.max(0, integerWidth - [...whole].length)) + whole;
    if (digits || fractionWidth) {
      return whole + decimalMark + digits + ' '.repeat(Math.max(0, fractionWidth - digitCount));
    }
    return whole;
  };
}
