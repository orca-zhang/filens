import { describe, expect, it } from 'vitest';
import { ColumnWidths } from '../src/column-widths';

describe('source column widths', () => {
  it('uses source boundaries, with defaults for missing and invalid widths', () => {
    const widths = new ColumnWidths(8, [30, 240, 12.5, 0, -2, NaN, Infinity]);
    expect(Array.from({ length: 8 }, (_, i) => widths.width(i + 1))).toEqual([30, 240, 12.5, 96, 96, 96, 96, 96]);
    expect(widths.before(9)).toBe(762.5);
    expect([-20, 0, 29.9, 30, 269.9, 270, 282.5, 762.5, Infinity].map(pixel => widths.at(pixel)))
      .toEqual([1, 1, 1, 2, 2, 3, 4, 8, 8]);
  });

  it('locates a viewport within one very wide column without rereading source tracks', () => {
    let reads = 0;
    const source = new Proxy(Array.from({ length: 16_384 }, (_, index) => index === 8192 ? 10_000 : 24), {
      get(target, key, receiver) { if (typeof key === 'string' && /^\d+$/.test(key)) reads++; return Reflect.get(target, key, receiver); }
    });
    const widths = new ColumnWidths(source.length, source);
    reads = 0;
    expect(widths.at(8192 * 24 + 9000)).toBe(8193);
    expect(widths.at(widths.before(16_385) - 1)).toBe(16_384);
    expect(widths.before(8194) - widths.before(8193)).toBe(10_000);
    expect(reads).toBe(0);
  });

  it('keeps the default width for sheets without source dimensions', () => {
    const widths = new ColumnWidths(16_384);
    expect(widths.before(16_385)).toBe(16_384 * 96);
    expect(widths.at(96 * 8192)).toBe(8193);
    expect(widths.at(Infinity)).toBe(16_384);
  });
});
