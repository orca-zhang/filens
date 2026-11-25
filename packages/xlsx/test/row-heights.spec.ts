import { describe, expect, it } from 'vitest';
import { RowHeights } from '../src/row-heights';

describe('variable row heights', () => {
  it('indexes mixed source heights, sparse measurements and pixel boundaries', () => {
    const heights = new RowHeights(5, [26, 90, 40.5, 0, NaN], new Map([[4, 180]]));
    expect([1, 2, 3, 4, 5, 6].map(row => heights.before(row))).toEqual([0, 26, 116, 156.5, 336.5, 362.5]);
    expect([-10, 0, 25.9, 26, 115.9, 116, 156.5, 999].map(pixel => heights.at(pixel))).toEqual([1, 1, 1, 2, 2, 3, 4, 5]);
    expect(heights.set(2, 120)).toBe(true);
    expect(heights.before(3)).toBe(146);
    expect(heights.at(140)).toBe(2);
    expect(heights.set(2, 120.1)).toBe(false);
    expect(heights.set(0, 50)).toBe(false);
    expect(heights.set(6, 50)).toBe(false);
    expect(heights.set(2, Infinity)).toBe(false);
    expect(heights.set(2, 20)).toBe(true);
    expect(heights.height(2)).toBe(90);
  });

  it('updates a distant row without losing a million-row sheet’s cumulative position', () => {
    const heights = new RowHeights(1_048_576, [], new Map([[500_000, 200]]));
    expect(heights.before(1_048_577)).toBe(26 * 1_048_576 + 174);
    heights.set(1_000_000, 80);
    const offset = 26 * 999_999 + 174;
    expect(heights.before(1_000_000)).toBe(offset);
    expect(heights.at(offset + 79)).toBe(1_000_000);
    expect(heights.at(offset + 80)).toBe(1_000_001);
  });

  it('locates measured sparse XLSX rows without a dense source array', () => {
    const count = 1_048_576;
    const heights = new RowHeights(count, undefined, new Map([[3, 64], [count, 70]]));
    expect(heights.before(count)).toBe(26 * (count - 1) + 38);
    expect(heights.at(52 + 63)).toBe(3);
    expect(heights.at(52 + 64)).toBe(4);
    expect(heights.at(heights.before(count + 1) - 1)).toBe(count);
    heights.set(3, 26);
    expect(heights.before(count + 1)).toBe(26 * count + 44);
  });
});
