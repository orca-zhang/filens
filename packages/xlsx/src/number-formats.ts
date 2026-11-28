import SSF from 'ssf';
import { dbNumberProfile, formatDbDateField, formatDbGeneral, type DbNumberProfile } from './db-number-formats';
import { dayMilliseconds, excelDateParts, excelDateSerial, excelWeekday, isExcelDateSerial } from './excel-calendar';
import { indexedColor } from './indexed-colors';
import { numberFormatLocales } from './number-format-locales';
import { formatLayoutNumber } from './question-number-formats';
import type { ParsedCell, ParsedSheet } from './types';

const numericValue = /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?$/i;
const localeDirective = /^\[\$[^\]]*?-([0-9a-f]{3,8})\]$/i;
const namedLocaleDirective = /^\[\$[^\]]*?-([a-z]{2,3}(?:-[a-z0-9]{1,8})*)(?:,([0-9a-f]{1,4}))?\]$/i;
const dateName = /^(?:m{3,5}|d{3,4}|am\/pm)$/i;
const dateField = /^(?:y{1,4}|[mdhs]{1,2}|\[[hms]{1,2}\](?:\.0{1,3})?|\.0{1,3})$/i;
const eraField = /^(?:g{1,3}|e{1,2})$/i;
const cjkLiteral = /[\p{Script=Han}\p{Script=Hangul}]/u;
const dateNameFormatters = new Map<string, Intl.DateTimeFormat | undefined>();
const groupedDecimalFormatters = new Map<string, Intl.NumberFormat>();
const MAX_GROUPED_DECIMAL_FORMATTERS = 64;
const regionalMasks = new Map<string, { code: string; sections: string[][]; numeric: boolean[] }>();
let lastNumberLocale: string | undefined;
let lastSeparators: { decimal: string; group: string } | undefined;
const systemDateTimeDirective = /\[\$-(?:0*f[84]00|x-sys(?:date|time))\]/i;
const systemDateTimeFormatters = new Map<string, Intl.DateTimeFormat>();
const formatTokens = /"[^"]*"|[\\_*][\s\S]|\[[^\]]*\]|general|am\/pm|[Ee][+-]|m+|d+|[\s\S]/giu;
const dbDateTokens = new RegExp(String.raw`\[ss?\]\.0{1,3}(?!0)|\.0{1,3}(?!0)|y+|h+|s+|g+|e+|上午/下午|a/p|${formatTokens.source}`, 'giu');
const textFormatTokens = new RegExp(`standard|am/pm|a/p|t+|j+|a+|${formatTokens.source}`, 'giu');
const scientificFormat = /[Ee][+-][#0?]/;
const spacedPercent = /[ \u00a0\u202f]%/;
const dbNumberDirective = /\[DBNum([1-4])\]/i;
const formatColor = /\[(black|white|red|green|blue|yellow|magenta|cyan|color *(\d{1,2}))\]/i;
const namedColors = ['black', 'white', 'red', 'green', 'blue', 'yellow', 'magenta', 'cyan'];
const formatCondition = /^\[(?:<=?|>=?|<>|=)-?\d+(?:\.\d*)?\]$/;
const textFractionMarker = '\u0007';
const textFormatColors = {
  de: ['schwarz', 'weiß', 'rot', 'grün', 'blau', 'gelb', 'magenta', 'cyan'],
  fr: ['noir', 'blanc', 'rouge', 'vert', 'bleu', 'jaune', 'magenta', 'cyan']
};
// Excel's decimal numeral IDs with ten consecutive Unicode digits.
const decimalNumerals = new Map(
  [...'٠۰०০੦૦୦௦౦೦൦๐໐༠၀ ០᠐'].flatMap((zero, index): [number, string][] => zero === ' ' ? [] :
    [[index + 2, Array.from({ length: 10 }, (_, digit) => String.fromCodePoint(zero.codePointAt(0)! + digit)).join('')]])
);

// SSF maps these four currency IDs to non-currency aliases in its default table.
const dollarFormats = [
  '$#,##0_);($#,##0)', '$#,##0_);[Red]($#,##0)',
  '$#,##0.00_);($#,##0.00)', '$#,##0.00_);[Red]($#,##0.00)'
];

// SSF's built-in accounting codes are private.
const accountingFormats = [
  '_(* #,##0_);_(* \\(#,##0\\);_(* "-"_);_(@_)',
  '_("$"* #,##0_);_("$"* \\(#,##0\\);_("$"* "-"_);_(@_)',
  '_(* #,##0.00_);_(* \\(#,##0.00\\);_(* "-"??_);_(@_)',
  '_("$"* #,##0.00_);_("$"* \\(#,##0.00\\);_("$"* "-"??_);_(@_)'
];

export function builtinNumberFormat(id: number): number | string | undefined {
  if (!Number.isInteger(id)) return undefined;
  if (id >= 5 && id <= 8) return dollarFormats[id - 5];
  if (id === 64 || id === 66) return dollarFormats[id - 63];
  if ((id >= 1 && id <= 22) || (id >= 27 && id <= 31) || (id >= 37 && id <= 81)) return id;
  return undefined;
}

interface NumberSpacing {
  kind: 'pad' | 'fill';
  glyph: string;
  offset: number;
}

export interface FormattedCellValue { text: string; color?: string; spacing?: NumberSpacing[]; alignRight?: boolean }
interface DbDateFormat { section: number; locale: string; kind: number; profile: DbNumberProfile }
interface LocaleFormat { locale?: string; calendar: number; numeral: number; gannen: boolean }

export function formatCellValue(raw: string, type: ParsedCell['valueType'], code: string | number,
  date1904 = false, palette?: ParsedSheet['numberFormatPalette']): FormattedCellValue {
  // Number format codes in Excel can be up to 255 characters.
  if (code === 0 || (typeof code === 'string' && /^general$/i.test(code))) return { text: formatGeneralNumber(raw, type) };
  if (!raw || type === 'boolean' || type === 'error' || (typeof code === 'string' && (!code || code.length > 255))) return { text: raw };
  let value: string | number = raw;
  if (type === 'date') {
    const serial = excelDateSerial(raw, date1904);
    if (serial === undefined || serial < 0) return { text: raw };
    value = serial;
  } else if (type !== 'text') {
    const trimmed = raw.trim();
    if (!numericValue.test(trimmed)) return { text: raw };
    value = Number(trimmed);
    if (!Number.isFinite(value)) return { text: raw };
  }
  return formatWorkbookValue(value, code, date1904, palette, raw) ?? { text: raw };
}

function numberSeparators() {
  const locale = globalThis.navigator?.language;
  if (!locale || locale === 'en-US') return;
  if (locale !== lastNumberLocale) {
    lastNumberLocale = locale;
    try {
      const parts = new Intl.NumberFormat(locale).formatToParts(123456.7);
      const decimal = parts.find(part => part.type === 'decimal')?.value ?? '.';
      const group = parts.find(part => part.type === 'group')?.value ?? ',';
      lastSeparators = decimal === '.' && group === ',' ? undefined : { decimal, group };
    } catch { lastSeparators = undefined; }
  }
  return lastSeparators;
}

export function formatGeneralNumber(value: string, type: ParsedCell['valueType']): string {
  if (type !== undefined || !value.includes('.')) return value;
  const separators = numberSeparators();
  return separators && numericValue.test(value.trim()) ? value.replace('.', separators.decimal) : value;
}

function regionalNumericMask(code: string, value: number): string | undefined {
  if (!code) return code;
  let mask = regionalMasks.get(code);
  if (!mask) {
    const sections = formatSections(code);
    const numeric = sections.map(tokens => !SSF.is_date(tokens.map(token =>
      /^e[+-]$/.test(token) ? token.toUpperCase() : token).join('')));
    // Keep authored literals separate from separators produced by the numeric mask.
    const protect = (token: string) => token.replace(/[.,]/g, mark => mark === '.' ? '\u0005' : '\u0006');
    const prepared = sections.map((tokens, index) => tokens.map(token => numeric[index]
      && (token.startsWith('"') || token.startsWith('\\') || token.startsWith('[$'))
      ? token.startsWith('[$') ? token.replace(/^\[\$[^-\]]*/, protect) : protect(token)
      : token).join('')).join(';');
    mask = { code: prepared, sections, numeric };
    if (regionalMasks.size >= MAX_GROUPED_DECIMAL_FORMATTERS) regionalMasks.delete(regionalMasks.keys().next().value!);
    regionalMasks.set(code, mask);
  }
  if (mask.numeric.every(Boolean)) return mask.code;
  if (!mask.numeric.some(Boolean)) return undefined;
  return mask.numeric[activeSection(mask.sections, value)] ? mask.code : undefined;
}

function normalizeTextFormat(code: string, locale: string, language: keyof typeof textFormatColors,
  separators: ReturnType<typeof numberSeparators>): string {
  const group = separators?.group;
  const groupIsSpace = group === '\u00a0' || group === '\u202f' || group === ' ';
  return formatSections(code, textFormatTokens).map(section => {
    const tokens = section.map(token => {
      if (/^standard$/i.test(token)) return 'General';
      if (/^\[(?:<=?|>=?|<>|=)-?\d+,\d+\]$/.test(token) && separators?.decimal === ',') return token.replace(',', '.');
      if (token[0] === '[' && token.endsWith(']')) {
        const color = namedColors[textFormatColors[language].indexOf(token.slice(1, -1).toLowerCase())];
        if (color) return `[${color}]`;
      }
      if (language === 'de' ? /^t{1,4}$/i.test(token) : /^j{1,4}$/i.test(token)) return 'd'.repeat(token.length);
      if (language === 'de' ? /^(?:jj|jjjj)$/i.test(token) : /^(?:aa|aaaa)$/i.test(token)) return 'y'.repeat(token.length);
      return token;
    });
    if (SSF.is_date(tokens.map(token => /^[Ee][+-]$/.test(token) ? token.toUpperCase() : token).join(''))) {
      const clock = tokens.map(token => /^[\u00a0\u202f]$/.test(token) ? `"${token}"` : token).join('');
      // Keep SSF's time rounding while preserving a comma authored before fractional seconds.
      const format = separators?.decimal === ',' ? clock.replace(
        /"[^"]*"|[\\_*][\s\S]|(\[ss?\]|ss?),(0{1,3})(?!0)|\[[^\]]*\]/gi,
        (token, seconds?: string, fraction?: string) => seconds ? `${seconds}.${fraction}"${textFractionMarker}"` : token
      ) : clock;
      if (tokens.some(token => numberFormatLocale(token)) || !tokens.some(token => dateName.test(token))) return format;
      // A TEXT formula uses the viewer's date names unless it requests a specific locale.
      return `[$-${locale}]${format}`;
    }
    // Inspect only bare placeholders and separators. Preserve conventional workbook masks
    // such as #,##0 and #,##0.00 when the formula can be read in either notation.
    const mask = tokens.map(token => token.length === 1 ? token : '|').join('');
    const canonical = /[#0?](?:,[#0?]+)+\.[#0?]/.test(mask);
    const localGroup = group === '.' ? /#\.[#0?]{3}(?![#0?])|[#0?]\.[#0?]{3}\.[#0?]{3}|[#0?]\.(?![#0?])/.test(mask)
      : groupIsSpace && /[#0?][ \u00a0\u202f][#0?]{3}(?![#0?])/.test(mask);
    const localDecimal = /,[#0?]/.test(mask) && !/#(?:,[#0?]{3})+(?![#0?,])/.test(mask);
    const regional = separators?.decimal === ',' && !canonical && (localGroup || localDecimal);
    return tokens.map((token, index) => {
      if (regional && token === ',') return '.';
      if (regional && group === '.' && token === '.') return ',';
      if (groupIsSpace && /^[ \u00a0\u202f]$/.test(token) && /[#0?]/.test(mask[index - 1] ?? '') &&
        /^[#0?]{3}(?![#0?]| *\/)/.test(mask.slice(index + 1))) return ',';
      if (/^[\u00a0\u202f]$/.test(token) && tokens[index + 1] !== '%') return `"${token}"`;
      return token;
    }).join('');
  }).join(';');
}

export function formatFormulaText(value: string | number, code: string, date1904 = false): string | undefined {
  const text = formatWorkbookValue(value, code, date1904, undefined, undefined, globalThis.navigator?.language)?.text;
  if (typeof value === 'number' && text?.includes(textFractionMarker) && !code.includes(textFractionMarker)) {
    return text.replace(/\.(.{1,3})\u0007/gu, ',$1');
  }
  return text;
}

export function formatWorkbookValue(value: string | number, code: string | number, date1904 = false,
  palette?: ParsedSheet['numberFormatPalette'], invalidDateFallback?: string, textLocale?: string): FormattedCellValue | undefined {
  if ((typeof code === 'string' && code.length > 255) || (typeof value === 'number' && !Number.isFinite(value))) return undefined;
  try {
    const separators = typeof value === 'number' ? numberSeparators() : undefined;
    const language = textLocale?.split('-')[0];
    if (textLocale && code && typeof code === 'string' && (language === 'de' || language === 'fr')) {
      code = normalizeTextFormat(code, textLocale, language, separators);
    }
    const saved = typeof code === 'number' ? SSF.get_table()[code] ?? accountingFormats[code - 41] ?? code : code;
    const regional = separators && typeof saved === 'string' && typeof value === 'number'
      ? regionalNumericMask(saved, value) : undefined;
    const original = regional ?? saved;
    const locale = typeof original === 'string' && original.includes('[$') ? activeLocale(original, value) : undefined;
    const extendedDb = locale && locale.numeral >= 0x1b && locale.numeral <= 0x27;
    const dbNumber = typeof original === 'string' && typeof value === 'number' && (extendedDb || dbNumberDirective.test(original))
      ? prepareDbNumberFormat(original, value, extendedDb ? locale?.numeral : undefined) : undefined;
    const nativeDigits = typeof value === 'number' && !dbNumber && locale ? decimalNumerals.get(locale.numeral) : undefined;
    const prepared = dbNumber?.code ?? (nativeDigits && typeof original === 'string'
      ? original.replace(formatTokens, protectFormatDigits) : original);
    const digits = dbNumber?.digits ?? nativeDigits;
    const layout = typeof prepared === 'string' && (/[_*?]/.test(prepared) || scientificFormat.test(prepared) || spacedPercent.test(prepared))
      ? prepareNumberLayout(prepared, value, digits) : undefined;
    const source = layout?.code ?? prepared;
    const selection = typeof source === 'string' && (formatColor.test(source) || systemDateTimeDirective.test(source))
      ? selectNumberFormat(source, value, palette) : undefined;
    const selected = selection?.code ?? source;
    const format = typeof selected === 'string' && !dbNumber?.date ? normalizeFormatLiterals(selected, value, date1904) : selected;
    let text: string;
    if (typeof value === 'number' && selection?.systemFormat) {
      if (isExcelDateSerial(value, date1904)) text = formatSystemDateTime(selection.systemFormat, value, date1904);
      else if (invalidDateFallback !== undefined) text = invalidDateFallback;
      else return undefined;
    } else if (typeof value === 'number' && typeof format === 'string' && (dbNumber?.date || (locale && SSF.is_date(format)))) {
      text = formatLocalizedDate(format, value, date1904, dbNumber?.date);
    } else {
      const numericFormat = typeof format === 'string' && format.includes('[$-') ? format.replace(formatTokens, token =>
        token.startsWith('[$-') && numberFormatLocale(token) ? '' : token) : format;
      text = (typeof value === 'number' && typeof numericFormat === 'string' ? formatGroupedDecimal(numericFormat, value) : undefined)
        ?? SSF.format(numericFormat, value, { date1904 });
    }
    // SSF resolves these legacy built-in aliases internally.
    if (separators && (regional !== undefined || (typeof saved === 'number' && saved >= 59 && saved <= 70))) {
      text = text.replace(/[.,\u0005\u0006]/g, mark => mark === '.' ? separators.decimal : mark === ',' ? separators.group
        : mark === '\u0005' ? '.' : ',');
    }
    if (digits) {
      text = text.replace(/\u0002\d+\u0003|\u0004\d|\d/g, token => token.length === 1 ? digits[Number(token)]
        : token[0] === '\u0004' ? token[1] : token);
    }
    const result: FormattedCellValue = text && selection?.color ? { text, color: selection.color } : { text };
    if (layout?.controls.length) {
      const spacing: NumberSpacing[] = [];
      let removed = 0;
      result.text = text.replace(/\u0002(\d+)\u0003/g, (marker, rawIndex: string, offset: number) => {
        const control = layout.controls[Number(rawIndex)];
        if (!control) return marker;
        spacing.push({ ...control, offset: offset - removed });
        const fallback = control.kind === 'pad' ? ' ' : '';
        removed += marker.length - fallback.length;
        return fallback;
      });
      if (spacing.length) result.spacing = spacing;
    }
    if (layout?.questionNumber) result.alignRight = true;
    return result;
  } catch {
    return undefined;
  }
}

function prepareNumberLayout(code: string, value: string | number, digits?: string) {
  const controls: Omit<NumberSpacing, 'offset'>[] = [];
  let questionNumber = false;
  const marker = (kind: NumberSpacing['kind'], glyph: string) => {
    const index = controls.push({ kind, glyph }) - 1;
    // Controls excluded from SpreadsheetML literals let SSF carry layout through formatting.
    return `\u0002${index}\u0003`;
  };
  code = code.replace(formatTokens, token => {
    if (token.length < 2 || (token[0] !== '_' && token[0] !== '*')) return token;
    return `"${marker(token[0] === '_' ? 'pad' : 'fill', token.slice(1))}"`;
  });
  if (typeof value === 'number' && (code.includes('?') || scientificFormat.test(code) || spacedPercent.test(code))) {
    const sections = formatSections(code);
    const index = sections.length <= 4 ? activeSection(sections, value) : -1;
    const tokens = sections[index];
    const first = tokens?.findIndex(token => /^[#0?.]$/.test(token)) ?? -1;
    if (tokens && first >= 0) {
      let end = first + 1;
      while (end < tokens.length && /^(?:[#0-9?., /%\u00a0\u202f]|[Ee][+-])$/.test(tokens[end])) end++;
      while (/^[ \u00a0\u202f]$/.test(tokens[end - 1])) end--;
      const mask = tokens.slice(first, end).join('');
      const scientific = scientificFormat.test(mask);
      // SSF recognizes lowercase e as a year token, so normalize the exponent for this check.
      const dateCode = scientific ? tokens.slice(0, first).join('') + mask.toUpperCase() + tokens.slice(end).join('') : tokens.join('');
      if ((tokens.includes('?') || scientific || spacedPercent.test(mask)) && !SSF.is_date(dateCode) &&
        !tokens.slice(end).some(token => /^[#0?]$/.test(token))) {
        const number = formatLayoutNumber(mask, Math.abs(value), glyph => marker('pad', digits?.[Number(glyph)] ?? glyph));
        if (number) {
          tokens.splice(first, end - first, `"${number.text}"`);
          const count = sections.length < 4 && hasTextPlaceholder(sections.at(-1)!) ? sections.length - 1 : sections.length;
          if (number.nonzero && value < 0 && count === 1) tokens.unshift('"-"');
          code = sections.map(section => section.join('')).join(';');
          questionNumber = mask.includes('?');
        }
      }
    }
  }
  return { code, controls, questionNumber };
}

function formatGroupedDecimal(code: string, value: number): string | undefined {
  // SSF handles the common #,##0 masks, but cannot write padded integer groups or optional grouped decimals.
  const match = /^(\$?)([#0]{1,3}(?:,[#0]{3})+)(?:\.([#0]+))?$/.exec(code);
  if (!match) return undefined;
  const [, prefix, integerMask, fraction = ''] = match;
  const integer = integerMask.replace(/,/g, ''), firstZero = integer.indexOf('0');
  const minimumIntegerDigits = firstZero < 0 ? 0 : integer.length - firstZero;
  if (minimumIntegerDigits <= 1 && !fraction.includes('#')) return undefined;
  if (minimumIntegerDigits > 21 || fraction.length > 20) return undefined;
  const integerDigits = Math.max(1, minimumIntegerDigits);
  const minimumFractionDigits = fraction.lastIndexOf('0') + 1, maximumFractionDigits = fraction.length;
  const key = `${integerDigits}/${minimumFractionDigits}/${maximumFractionDigits}`;
  let formatter = groupedDecimalFormatters.get(key);
  if (!formatter) {
    formatter = new Intl.NumberFormat('en-US', { minimumIntegerDigits: integerDigits, minimumFractionDigits, maximumFractionDigits });
    if (groupedDecimalFormatters.size >= MAX_GROUPED_DECIMAL_FORMATTERS) {
      groupedDecimalFormatters.delete(groupedDecimalFormatters.keys().next().value!);
    }
    groupedDecimalFormatters.set(key, formatter);
  }
  const unsigned = formatter.format(Math.abs(value));
  const [whole, decimals = ''] = unsigned.split('.');
  const sign = value < 0 && /[1-9]/.test(unsigned) ? '-' : '';
  return sign + prefix + (whole === '0' && !minimumIntegerDigits ? '' : whole) + (fraction ? '.' + decimals : '');
}

function normalizeFormatLiterals(code: string, value: string | number, date1904: boolean): string {
  // In a date, a bare dot separates fields unless it introduces fractional seconds.
  if (/[ymdhs]\.(?!0)|\.[ymdhs]/i.test(code)) {
    code = formatSections(code, dbDateTokens).map(section => {
      const format = section.join('');
      return SSF.is_date(format) ? section.map(token => token === '.' ? '"."' : token).join('') : format;
    }).join(';');
  }
  if (!code.includes('°') && !/\[ss?\]\.0/i.test(code) && !cjkLiteral.test(code)) return code;
  return code.replace(/"[^"]*"|[\\_*][\s\S]|\[ss?\]\.0{1,3}(?!0)|\[[^\]]*\]|上午\/下午|[°\p{Script=Han}\p{Script=Hangul}]/giu, token => {
    if (token === '°' || ([...token].length === 1 && cjkLiteral.test(token))) return `"${token}"`;
    if (typeof value !== 'number' || !isExcelDateSerial(value, date1904) || !/^\[ss?\]\.0/i.test(token)) return token;
    const [seconds, decimals] = token.split('.');
    // Round the total seconds and fractional part together to keep their carry in sync.
    const scale = 10 ** decimals.length, ticks = Math.round(value * (dayMilliseconds / 1000) * scale);
    const whole = String(Math.floor(ticks / scale)).padStart(seconds.length - 2, '0');
    return `"${whole}.${String(ticks % scale).padStart(decimals.length, '0')}"`;
  });
}

function formatSections(code: string, tokenizer = formatTokens): string[][] {
  const sections: string[][] = [[]];
  for (const token of code.match(tokenizer)!) {
    if (token === ';') sections.push([]);
    else sections[sections.length - 1].push(token);
  }
  return sections;
}

function hasTextPlaceholder(tokens: string[]): boolean { return tokens.some(token => token.includes('@')); }

function activeSection(sections: string[][], value: string | number): number {
  const probes = sections.map((tokens, index) => `${tokens.filter(token => formatCondition.test(token)).join('')}`
    + `"${index}${hasTextPlaceholder(tokens) ? '@' : ''}"`);
  return Number(SSF.format(probes.join(';'), typeof value === 'string' ? 'text' : value)[0]);
}

function protectFormatDigits(token: string): string {
  const protect = (literal: string) => literal.replace(/\d/g, digit => `\u0004${digit}`);
  if (token.startsWith('"')) return protect(token);
  if (/^\\\d$/.test(token)) return `"${protect(token[1])}"`;
  return token.startsWith('[$') ? token.replace(/^\[\$[^-\]]*/, protect) : token;
}

function prepareDbNumberFormat(code: string, value: number, numeral?: number):
  { code: string; digits?: string; date?: DbDateFormat } | undefined {
  const sections = formatSections(code);
  if (sections.length > 4) return undefined;
  const index = activeSection(sections, value), tokens = sections[index];
  const directive = tokens?.find(token => dbNumberDirective.exec(token)?.[0] === token);
  if (!tokens || (!directive && numeral === undefined)) return undefined;
  const dateCode = tokens.map(token => /^general$/i.test(token) ? 'General'
    : /^[Ee][+-]$/.test(token) ? token.toUpperCase() : token).join('');
  if (systemDateTimeDirective.test(dateCode)) return undefined;
  const localeTag = tokens.find(token => numberFormatLocale(token));
  const extendedLocale = numeral === 0x27 ? 'ko-KR' : numeral === undefined ? undefined
    : ['ja-JP', 'zh-CN', 'zh-TW', 'ko-KR'][Math.floor((numeral - 0x1b) / 3)];
  const locale = (directive ? undefined : extendedLocale)
    ?? (localeTag ? numberFormatLocale(localeTag)?.locale : globalThis.navigator?.language);
  const kind = directive ? Number(directive.at(-2)) : numeral === 0x27 ? 4 : (numeral! - 0x1b) % 3 + 1;
  const profile = dbNumberProfile(locale, kind);
  if (SSF.is_date(dateCode)) {
    if (!locale || !profile || (!/^ja(?:-|$)/i.test(locale) && tokens.some(token => /^[ge]$/i.test(token)))) return undefined;
    return { code, date: { section: index, locale, kind, profile } };
  }
  const numericSections = sections.length - Number(sections.length < 4 && hasTextPlaceholder(sections.at(-1)!));
  sections[index] = tokens.map(token => {
    // SSF inserts a dollar sign for a locale-only tag in a numeric format.
    if (token === localeTag && token.startsWith('[$-')) return '';
    if (!profile) return token;
    if (token === directive) return '';
    if (/^general$/i.test(token)) return `"${formatDbGeneral(numericSections > 1 ? Math.abs(value) : value, profile)}"`;
    return protectFormatDigits(token);
  });
  // SSF short-circuits on a leading General before selecting a section.
  if (/^general$/i.test(sections[0][0])) sections[0].unshift('[DBNum0]');
  return { code: sections.map(section => section.join('')).join(';'), digits: profile?.digits };
}

function selectNumberFormat(code: string, value: string | number, palette?: ParsedSheet['numberFormatPalette']):
  { code: string; color?: string; systemFormat?: 'date' | 'time' } | undefined {
  const sections = formatSections(code);
  if (sections.length > 4) return undefined;
  const colors: (string | undefined)[] = [];
  const systemFormats: ('date' | 'time' | undefined)[] = [];
  for (const tokens of sections) {
    const conditions = tokens.filter(token => formatCondition.test(token));
    const system = typeof value === 'number' && tokens.find(token => systemDateTimeDirective.exec(token)?.[0] === token);
    systemFormats.push(system ? (/f800|sysdate/i.test(system) ? 'date' : 'time') : undefined);
    const directive = tokens.find(token => formatColor.exec(token)?.[0] === token);
    const match = directive ? formatColor.exec(directive) : undefined;
    let color: string | undefined;
    if (match && match[2] === undefined) color = indexedColor(namedColors.indexOf(match[1].toLowerCase()));
    else if (match) {
      const paletteIndex = Number(match[2]);
      if (paletteIndex >= 1 && paletteIndex <= 56) color = indexedColor(paletteIndex + 7, palette);
    }
    colors.push(color);
    // A section with only color and conditions displays its value in General format.
    if (color && tokens.length === conditions.length + 1) tokens.push('General');
  }
  if (!colors.some(Boolean) && !systemFormats.some(Boolean)) return undefined;
  // Let SSF select the section, while keeping the original numeric rendering intact.
  const index = activeSection(sections, value);
  return { code: sections.map(tokens => tokens.join('')).join(';'), color: colors[index], systemFormat: systemFormats[index] };
}

function formatSystemDateTime(kind: 'date' | 'time', value: number, date1904: boolean): string {
  const locale = globalThis.navigator?.language;
  const key = `${locale}/${kind}`;
  let formatter = systemDateTimeFormatters.get(key);
  if (!formatter) {
    formatter = new Intl.DateTimeFormat(locale || undefined, {
      timeZone: 'UTC', calendar: 'gregory', ...(kind === 'date' ? { dateStyle: 'full' } : { timeStyle: 'medium' })
    });
    systemDateTimeFormatters.set(key, formatter);
  }
  if (kind === 'time') {
    const secondsPerDay = dayMilliseconds / 1000;
    return formatter.format(Math.round(value * secondsPerDay) % secondsPerDay * 1000);
  }
  const serial = Math.floor(value);
  const { year, month, day } = excelDateParts(serial, date1904);
  const synthetic = !date1904 && (serial === 0 || serial === 60);
  const sampleDay = synthetic && serial === 60 ? 28 : day || 1;
  const date = new Date(Date.UTC(year, month - 1, sampleDay));
  const weekdayOffset = excelWeekday(serial, date1904) - date.getUTCDay();
  if (!synthetic && !weekdayOffset) return formatter.format(date);
  // Intl uses the Gregorian calendar, so restore Excel's early weekdays and synthetic days.
  const weekday = weekdayOffset && formatter.formatToParts(+date + weekdayOffset * dayMilliseconds)
    .find(part => part.type === 'weekday')?.value;
  const options = formatter.resolvedOptions();
  return formatter.formatToParts(date).map(part => {
    if (part.type === 'weekday' && weekday) return weekday;
    if (part.type === 'day' && synthetic) {
      return new Intl.NumberFormat(options.locale, {
        numberingSystem: options.numberingSystem, useGrouping: false, minimumIntegerDigits: [...part.value].length
      }).format(day);
    }
    return part.value;
  }).join('');
}

function numberFormatLocale(directive: string): LocaleFormat | undefined {
  if (!directive.startsWith('[$')) return undefined;
  const id = localeDirective.exec(directive)?.[1];
  const named = id ? undefined : namedLocaleDirective.exec(directive);
  if (!id && !named) return undefined;
  const legacy = parseInt(id ?? '0', 16);
  // Modern tags put the same calendar and numeral bytes after the comma.
  const extensions = named ? parseInt(named[2] ?? '0', 16) : legacy >>> 16;
  const calendar = extensions & 0x7f, numeral = (extensions >>> 8) & 0x7f;
  const locale = named?.[1] ?? numberFormatLocales[legacy & 0xffff]
    ?? (calendar === 3 ? 'ja-JP' : calendar === 4 ? 'zh-TW' : calendar === 5 ? 'ko-KR' : calendar === 7 ? 'th-TH' : undefined);
  return { locale, calendar, numeral, gannen: /^ja(?:-|$).*?-x-gannen(?:-|$)/i.test(locale ?? '') };
}

function activeLocale(code: string, value: string | number): LocaleFormat | undefined {
  const sections = formatSections(code);
  if (sections.length > 4) return undefined;
  const tokens = sections[sections.length === 1 ? 0 : activeSection(sections, value)];
  for (const token of tokens ?? []) {
    const locale = numberFormatLocale(token);
    if (locale) return locale;
  }
  return undefined;
}

function formatLocalizedDate(code: string, value: number, date1904: boolean, dbDate?: DbDateFormat): string {
  const fields: { locale: string; token: string; native?: DbDateFormat; calendarUnit?: boolean;
    era?: 'japanese' | 'roc'; gannen?: boolean; yearOffset?: number }[] = [];
  const localized = formatSections(code, dbDateTokens).map((tokens, section) => {
    const native = dbDate?.section === section ? dbDate : undefined;
    const directive = tokens.find(token => numberFormatLocale(token));
    const regional = directive ? numberFormatLocale(directive) : undefined;
    const locale = native?.locale ?? regional?.locale;
    if (!locale) return tokens.join('');
    const calendar = regional?.calendar;
    const eraCalendar = calendar === 3 || (!calendar && /^ja(?:-|$)/i.test(locale)) ? 'japanese'
      : calendar === 4 || (!calendar && /^zh-(?:hant-)?tw(?:-|$)/i.test(locale)) ? 'roc' : undefined;
    const yearOffset = calendar === 7 ? 543 : calendar === 5 ? 2333 : undefined;
    let previous = '';
    return tokens.map((token, at) => {
      if (token === directive && token.startsWith('[$-')) return '';
      const era = eraCalendar && eraField.test(token) ? eraCalendar : undefined;
      const offsetYear = yearOffset && /^y{1,4}$/i.test(token) ? yearOffset : undefined;
      const numeric = native && (era || dateField.test(token));
      if (!numeric && !era && !offsetYear && !dateName.test(token)) {
        if (/^(?:a\/p|上午\/下午)$/i.test(token)) previous = token;
        return token;
      }
      // Keep the field so SSF still selects sections, resolves minutes and rounds time.
      const index = fields.length, field = token.toLowerCase();
      const minutes = numeric && /^m/.test(field) && (/^(?:h|\[h)/.test(previous)
        || /^s/i.test(tokens.slice(at + 1).find(part => dateField.test(part) || dateName.test(part)) ?? ''));
      fields.push({ locale, token: field, era, gannen: regional?.gannen, yearOffset: offsetYear, native: numeric ? native : undefined,
        calendarUnit: Boolean(numeric && /^[mde]/.test(field) && !minutes) });
      previous = field;
      return `"\u0000${index}:"${token}"\u0001"`;
    }).join('');
  }).join(';');
  const formatted = SSF.format(dbDate ? normalizeFormatLiterals(localized, value, date1904) : localized, value, { date1904 });
  if (!fields.length || !formatted.includes('\u0000')) return formatted;
  const date = SSF.parse_date_code(value, { date1904 });
  return formatted.replace(/\u0000(\d+):([^\u0001]*)\u0001/g, (_, index: string, fallback: string) => {
    const field = fields[Number(index)];
    if (!field) return fallback;
    if (date && field.era) {
      fallback = localizedEraField(field.token, date, field.era, field.gannen) ?? fallback;
      if (field.token.startsWith('g') || fallback === '元') return fallback;
    } else if (date && field.yearOffset) {
      const year = date.y + field.yearOffset;
      fallback = field.token.length <= 2 ? String(year % 100).padStart(2, '0') : String(year).padStart(4, '0');
    }
    if (field.native) {
      const { profile, locale, kind } = field.native;
      return formatDbDateField(fallback, profile, locale, kind, Boolean(field.calendarUnit));
    }
    return date && dateName.test(field.token) ? localizedDateName(field.locale, field.token, date, fallback) : fallback;
  });
}

function localizedEraField(token: string, date: SSF.SSF$Date, calendar: 'japanese' | 'roc', gannen?: boolean): string | undefined {
  const narrow = token === 'g', era = narrow ? 'narrow' : 'long';
  const key = `${calendar}/era/${era}`;
  let formatter = dateNameFormatters.get(key);
  if (!formatter) {
    formatter = new Intl.DateTimeFormat(calendar === 'japanese' ? 'ja-JP' : 'zh-TW',
      { timeZone: 'UTC', calendar, year: 'numeric', era });
    dateNameFormatters.set(key, formatter);
  }
  const year = token.startsWith('e');
  const part = formatter.formatToParts(Date.UTC(date.y, date.m - 1, Math.max(1, date.d)))
    .find(item => item.type === (year ? 'year' : 'era'))?.value;
  if (!part) return undefined;
  if (year) {
    const value = part === '元' ? '1' : part;
    return calendar === 'japanese' && gannen && value === '1' ? '元' : value.padStart(token.length, '0');
  }
  return token === 'gg' ? [...part][0] : part;
}

function localizedDateName(locale: string, token: string, date: SSF.SSF$Date, fallback: string): string {
  if (/^\d+$/.test(fallback)) return fallback;
  const part = token === 'am/pm' ? 'dayPeriod' : token[0] === 'm' ? 'month' : 'weekday';
  const width = token.length === 3 ? 'short' : 'long';
  const monthForm = token === 'mmmm'
    ? /^ru(?:-[a-z0-9]{1,8})*?-x-(genlower|genupper|nomlower)(?:-|$)/i.exec(locale)?.[1].toLowerCase()
    : undefined;
  const genitive = monthForm === 'genlower' || monthForm === 'genupper';
  const key = `${locale}/${part}/${width}${genitive ? '/genitive' : ''}`;
  if (!dateNameFormatters.has(key)) {
    const options: Intl.DateTimeFormatOptions = {
      timeZone: 'UTC',
      calendar: 'gregory',
      // ICU uses the contextual (genitive) month when the day is included.
      ...(genitive ? { day: 'numeric' } : {}),
      ...(part === 'dayPeriod' ? { hour: 'numeric', hour12: true } : { [part]: width }),
    };
    dateNameFormatters.set(key, Intl.DateTimeFormat.supportedLocalesOf(locale).length
      ? new Intl.DateTimeFormat(locale, options) : undefined);
  }
  const formatter = dateNameFormatters.get(key);
  if (!formatter) return fallback;
  // Use representative dates so Excel's fictitious February 29, 1900 keeps its names.
  const sample = part === 'month' ? Date.UTC(2024, date.m - 1, 1)
    : part === 'weekday' ? Date.UTC(2024, 0, 7 + date.q)
    : Date.UTC(2024, 0, 1, fallback === 'PM' ? 15 : 3);
  if (part === 'dayPeriod') return formatter.formatToParts(sample).find(item => item.type === part)?.value ?? fallback;
  if (monthForm) {
    const month = formatter.formatToParts(sample).find(item => item.type === 'month')?.value;
    if (!month) return fallback;
    return monthForm === 'genupper' ? month.toUpperCase() : month.toLowerCase();
  }
  const name = formatter.format(sample);
  return token === 'mmmmm' ? [...name][0] ?? fallback : name;
}
