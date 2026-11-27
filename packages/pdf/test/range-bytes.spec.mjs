import { expect, it } from 'vitest';
import { PdfRangeBytes } from '../src/range-bytes.mjs';

it('allocates only written PDF chunks and reads across a split progressive write', () => {
  const size = 64 * 1024, length = 60 * 1024 * 1024 + 3;
  const bytes = new PdfRangeBytes(length, size);
  bytes.set(Uint8Array.of(7, 8, 9), length - 3);
  bytes.set(Uint8Array.of(1, 2, 3, 4), size - 2);
  bytes.set(Uint8Array.of(5, 6), size + 2);
  expect(bytes.chunks.size).toBe(3);
  expect(bytes.chunks.get(Math.floor(length / size)).byteLength).toBe(3);
  expect([...bytes.subarray(size - 2, size + 4)]).toEqual([1, 2, 3, 4, 5, 6]);
  expect([...bytes.subarray(length - 3, length)]).toEqual([7, 8, 9]);
  expect(bytes.byteAt(length - 1)).toBe(9);
});
