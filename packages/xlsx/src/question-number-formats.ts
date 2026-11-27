import SSF from 'ssf';

type Pad = (glyph: string) => string;
interface QuestionNumber { text: string; nonzero: boolean }
const decimalFormatters = new Map<number, Intl.NumberFormat>();

function integerDigits(digits: string, mask: string, pad: Pad, grouping = false): string {
  const firstZero = mask.indexOf('0');
  if (firstZero >= 0) digits = digits.padStart(mask.length - firstZero, '0');
  const leading = mask.slice(0, Math.max(0, mask.length - digits.length));
  return leading.replace(/#/g, '').replace(/\?/g, () => pad('0'))
    + (grouping ? digits.replace(/\B(?=(\d{3})+(?!\d))/g, ',') : digits);
}

function roundedDecimal(value: number, places: number): string {
  const precision = Math.min(places, 100);
  let formatter = decimalFormatters.get(precision);
  if (!formatter) {
    try { formatter = new Intl.NumberFormat('en-US', { useGrouping: false, maximumFractionDigits: precision }); }
    catch {
      // Older Intl implementations accept a maximum of 20 fraction digits.
      formatter = new Intl.NumberFormat('en-US', { useGrouping: false, maximumFractionDigits: Math.min(precision, 20) });
    }
    decimalFormatters.set(precision, formatter);
  }
  return formatter.format(value);
}

function maskedDecimal(digits: string, integerMask: string, fractionalMask: string | undefined, pad: Pad): string {
  const [whole, fractional = ''] = digits.split('.');
  const integer = integerDigits(whole === '0' ? '' : whole, integerMask.replace(/,/g, ''), pad, integerMask.includes(','));
  if (fractionalMask === undefined) return integer;
  const decimal = fractionalMask;
  const places = fractional.padEnd(decimal.lastIndexOf('0') + 1, '0');
  let suffix = places;
  for (const token of decimal.slice(places.length)) if (token === '?') suffix += pad('0');
  return integer + '.' + suffix;
}

function decimalQuestionNumber(mask: string, value: number, pad: Pad): QuestionNumber | undefined {
  const match = /^([#0?]+(?:,[#0?]+)*|)(?:\.([#0?]*))?(,*)( *%+|)$/.exec(mask);
  if (!match) return undefined;
  const [, integerMask, fractionalMask, commas, percent] = match;
  let scaled = value;
  for (let i = 0; i < commas.length; i++) scaled /= 1000;
  for (const token of percent) if (token === '%') scaled *= 100;
  if (!Number.isFinite(scaled)) return undefined;
  const digits = roundedDecimal(scaled, fractionalMask?.length ?? 0);
  return { text: maskedDecimal(digits, integerMask, fractionalMask, pad) + percent, nonzero: /[1-9]/.test(digits) };
}

function scientificNumber(mask: string, value: number, pad: Pad): QuestionNumber | undefined {
  const match = /^([#0?]+)(?:\.([#0?]*))?([Ee])([+-])([#0?]+)$/.exec(mask);
  if (!match) return undefined;
  const [, integerMask, fractionalMask, marker, positiveSign, exponentMask] = match;
  const [coefficient, rawExponent] = value.toExponential().split('e');
  const exponent = Number(rawExponent), width = integerMask.length;
  let displayedExponent = Math.floor(exponent / width) * width;
  // Move the decimal in its string form to avoid overflowing or underflowing a power of ten.
  const mantissa = Number(`${coefficient}e${exponent - displayedExponent}`);
  let digits = roundedDecimal(mantissa, fractionalMask?.length ?? 0);
  if (digits.split('.')[0].length > width) {
    // Rounding can carry into the next group of engineering digits.
    digits = '1';
    displayedExponent += width;
  }
  const sign = displayedExponent < 0 ? '-' : positiveSign === '+' ? '+' : '';
  const exponentDigits = integerDigits(String(Math.abs(displayedExponent)), exponentMask, pad);
  return { text: maskedDecimal(digits, integerMask, fractionalMask, pad) + marker + sign + exponentDigits, nonzero: value > 0 };
}

function fractionQuestionNumber(mask: string, value: number, pad: Pad): QuestionNumber | undefined {
  const match = /^(?:([#0?]+)( +))?(\?+)( *)\/( *)(\?+|[1-9]\d*)$/.exec(mask);
  if (!match) return undefined;
  const [, wholeMask, between = '', numeratorMask, left, right, denominatorMask] = match;
  const fixed = denominatorMask[0] !== '?';
  let whole = '', numerator: string, denominator: string;
  if (fixed) {
    const base = Number(denominatorMask), ticks = Math.round(value * base);
    if (!Number.isSafeInteger(base) || !Number.isSafeInteger(ticks)) return undefined;
    if (wholeMask && ticks >= base) whole = String(Math.floor(ticks / base));
    numerator = String(wholeMask ? ticks % base : ticks);
    denominator = denominatorMask;
  } else {
    // Reuse SSF's fraction approximation. Use each side's authored width for layout.
    const slots = '?'.repeat(Math.min(denominatorMask.length, 7));
    const fraction = SSF.format(`${wholeMask ? '# ' : ''}${slots}/${slots}`, value).trim();
    const parts = /^(?:(\d+) +)?(\d+) *\/ *(\d+)$/.exec(fraction);
    if (parts) [, whole = '', numerator, denominator] = parts;
    else if (wholeMask && /^\d+$/.test(fraction)) { whole = fraction; numerator = '0'; denominator = '1'; }
    else return undefined;
  }

  const integer = wholeMask ? integerDigits(whole, wholeMask, pad) + between : '';
  if (wholeMask && numerator === '0') {
    return { text: integer + numeratorMask.replace(/\?/g, () => pad('0')) + left + pad('/') + right
      + [...denominatorMask].map(char => pad(char === '?' ? '0' : char)).join(''), nonzero: /[1-9]/.test(whole) };
  }
  const bottom = fixed ? denominator : denominator + denominatorMask.slice(denominator.length).replace(/\?/g, () => pad('0'));
  return { text: integer + integerDigits(numerator, numeratorMask, pad) + left + '/' + right + bottom,
    nonzero: /[1-9]/.test(whole + numerator) };
}

export function formatLayoutNumber(mask: string, value: number, pad: Pad): QuestionNumber | undefined {
  if (/[Ee][+-]/.test(mask)) return scientificNumber(mask, value, pad);
  return mask.includes('/') ? fractionQuestionNumber(mask, value, pad) : decimalQuestionNumber(mask, value, pad);
}
