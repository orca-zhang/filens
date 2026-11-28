type NumericScan = (visit: (value: number, weight: number) => void) => boolean;
export type DeviationMatcher = (value: number, above: boolean, deviations: number) => boolean;

export function deviationMatcher({ center, scale, mean, deviation }: {
  center: number; scale: number; mean: number; deviation: number
}, span: number, count: number, readExact: () => DeviationMatcher | undefined): DeviationMatcher {
  const roundingFactor = 16 * Number.EPSILON * count;
  return (value, above, deviations) => {
    const fromMean = value / scale - center - mean;
    const threshold = deviations * deviation;
    const difference = (above ? fromMean : -fromMean) - threshold;
    // Ambiguous comparisons share one exact scan of the same sparse range.
    const roundingMargin = (span + Math.abs(threshold)) * roundingFactor;
    if (span && Math.abs(difference) <= roundingMargin) return readExact()?.(value, above, deviations) ?? (difference > 0);
    return difference > 0;
  };
}

export function exactDeviationMatcher(scan: NumericScan): DeviationMatcher | undefined {
  const bits = new DataView(new ArrayBuffer(8));
  let exponent = 0;
  function significand(value: number): bigint {
    if (Number.isSafeInteger(value)) {
      exponent = 0;
      return BigInt(value);
    }
    bits.setFloat64(0, value);
    const high = bits.getUint32(0), biased = (high >>> 20) & 0x7ff;
    exponent = Math.max(1, biased) - 1075;
    const leading = (high & 0xfffff) + (biased ? 0x100000 : 0);
    return BigInt((leading * 0x100000000 + bits.getUint32(4)) * (high >>> 31 ? -1 : 1));
  }

  // A shared power-of-two unit makes every binary64 observation an exact integer.
  let unit = 1024, count = 0, sum = 0n, squares = 0n;
  if (!scan((value, weight) => {
    count += weight;
    if (!value) return;
    const coefficient = significand(value);
    if (exponent < unit) {
      const shift = BigInt(unit - exponent);
      sum <<= shift;
      squares <<= 2n * shift;
      unit = exponent;
    }
    const integer = coefficient << BigInt(exponent - unit), copies = BigInt(weight);
    sum += integer * copies;
    squares += integer * integer * copies;
  }) || !count) return undefined;

  const n = BigInt(count);
  const varianceNumerator = n * squares - sum * sum;
  return (value: number, above: boolean, deviations: number): boolean => {
    // Compare n·x − sum with k·sqrt(n·squares − sum²) without rounding a square root.
    const coefficient = significand(value);
    const shift = Math.max(0, unit - exponent);
    const centered = (n * coefficient << BigInt(Math.max(0, exponent - unit))) - (sum << BigInt(shift));
    const directed = above ? centered : -centered;
    if (!varianceNumerator) return directed > 0n;
    if (directed >= 0n && deviations < 0) return true;
    if (directed <= 0n && deviations > 0) return false;
    const squaredThreshold = BigInt(deviations) ** 2n * (varianceNumerator << BigInt(shift * 2));
    return deviations > 0 ? directed * directed > squaredThreshold : directed * directed < squaredThreshold;
  };
}
