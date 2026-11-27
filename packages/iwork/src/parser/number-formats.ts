export interface BuiltInNumberFormat {
  formatType?: number;
  decimalPlaces?: number;
  fractionAccuracy?: number;
  base?: number;
  basePlaces?: number;
  baseUseMinusSign?: boolean;
}

export function resolveNumbersLocale(identifier?: string): string {
  const candidate = identifier?.split('@', 1)[0].replace(/_/g, '-');
  if (candidate) {
    try {
      return Intl.NumberFormat.supportedLocalesOf(candidate)[0] ?? 'en-US';
    } catch {
      // Invalid locale metadata uses the same default as an omitted locale.
    }
  }
  return 'en-US';
}

export function formatBuiltInNumber(value: number, format: BuiltInNumberFormat): string {
  if (!Number.isFinite(value)) return '';
  switch (format.formatType) {
    case 259:
      return formatScientific(value, format.decimalPlaces);
    case 262:
      return formatFraction(value, format.fractionAccuracy);
    case 269:
      return formatRadix(value, format);
    default:
      return '';
  }
}

function formatScientific(value: number, places: number | undefined): string {
  // Numbers uses 253 for automatic precision.
  const decimals = places === 253 ? undefined : places;
  if (decimals !== undefined && (!Number.isInteger(decimals) || decimals < 0 || decimals > 100)) return '';
  const [mantissa, exponent] = value.toExponential(decimals).split('e');
  return `${mantissa}E${exponent[0]}${exponent.slice(1).padStart(2, '0')}`;
}

function roundHalfEven(value: number): number {
  const lower = Math.floor(value);
  return value - lower === 0.5 ? lower + lower % 2 : Math.round(value);
}

function formatFraction(value: number, accuracy: number | undefined): string {
  if (accuracy === undefined) return '';
  const magnitude = Math.abs(value);
  let whole = Math.floor(magnitude);
  const remainder = magnitude - whole;
  let numerator: number;
  let denominator: number;
  if (accuracy >= 0xfffffffd && accuracy <= 0xffffffff && Number.isInteger(accuracy)) {
    const digits = 0x1_0000_0000 - accuracy;
    ({ numerator, denominator } = approximateFraction(remainder, 10 ** digits - 1));
  } else if (Number.isInteger(accuracy) && accuracy > 0 && accuracy <= 999) {
    denominator = accuracy;
    const scaled = magnitude * denominator;
    numerator = scaled < Number.MAX_SAFE_INTEGER ? roundHalfEven(scaled) - whole * denominator
      : roundHalfEven(remainder * denominator);
  } else {
    return '';
  }
  if (numerator === denominator) {
    whole += 1;
    numerator = 0;
  }
  const sign = value < 0 && (whole || numerator) ? '-' : '';
  if (!numerator) return sign + String(whole);
  const fraction = `${numerator}/${denominator}`;
  return sign + (whole ? `${whole} ${fraction}` : fraction);
}

function formatRadix(value: number, { base, basePlaces = 0, baseUseMinusSign }: BuiltInNumberFormat): string {
  if (base === undefined || !Number.isInteger(base) || base < 2 || base > 36
    || !Number.isInteger(basePlaces) || basePlaces < 0 || basePlaces > 1024) return '';
  const magnitude = BigInt(roundHalfEven(Math.abs(value)));
  const negative = value < 0 && magnitude !== 0n;
  if (negative && baseUseMinusSign === false && (base === 2 || base === 8 || base === 16)) {
    const width = Math.max(32, (magnitude - 1n).toString(2).length + 1);
    return BigInt.asUintN(width, -magnitude).toString(base).toUpperCase();
  }
  return (negative ? '-' : '') + magnitude.toString(base).toUpperCase().padStart(basePlaces, '0');
}

/** Find the closest fraction with a bounded denominator using continued fractions. */
export function approximateFraction(value: number, limit: number): { numerator: number; denominator: number } {
  if (Number.isInteger(value)) return { numerator: value, denominator: 1 };
  const maxDenominator = Math.min(limit, Math.floor(Number.MAX_SAFE_INTEGER / (Math.floor(value) + 1)));
  let previousNumerator = 0, previousDenominator = 1, numerator = 1, denominator = 0;
  let current = value;
  for (;;) {
    const term = Math.floor(current);
    const nextDenominator = previousDenominator + term * denominator;
    if (nextDenominator > maxDenominator) break;
    const nextNumerator = previousNumerator + term * numerator;
    previousNumerator = numerator;
    previousDenominator = denominator;
    numerator = nextNumerator;
    denominator = nextDenominator;
    const remainder = current - term;
    if (!remainder) return { numerator, denominator };
    current = 1 / remainder;
  }
  const scale = Math.floor((maxDenominator - previousDenominator) / denominator);
  const boundaryNumerator = previousNumerator + scale * numerator;
  const boundaryDenominator = previousDenominator + scale * denominator;
  const boundaryError = Math.abs(value - boundaryNumerator / boundaryDenominator);
  const convergentError = Math.abs(value - numerator / denominator);
  if (boundaryError < convergentError || (boundaryError === convergentError && boundaryDenominator < denominator)) {
    return { numerator: boundaryNumerator, denominator: boundaryDenominator };
  }
  return { numerator, denominator };
}
