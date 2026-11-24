import assert from 'node:assert/strict';
import { test } from 'node:test';
import { randomBytes } from 'node:crypto';
import { encodeArithmetic, decodeArithmetic } from './codec.mjs';
const cdf = new Uint16Array(256 * 257);
for (let row = 0; row < 256; row++) for (let i = 0; i <= 256; i++) cdf[row * 257 + i] = i * 128;
test('arithmetic model round-trips empty, repeated, unicode, all-byte and random inputs', () => {
  for (const input of [Buffer.alloc(0), Buffer.alloc(3000, 255), Buffer.from('中文🙂'.repeat(300)), Buffer.from(Array.from({length:256},(_,i)=>i)), randomBytes(20000)]) {
    assert.deepEqual(Buffer.from(decodeArithmetic(encodeArithmetic(input, cdf), cdf, input.length)), input);
  }
  const broken = cdf.slice(); broken[4] = 0;
  assert.throws(() => decodeArithmetic(new Uint8Array([0]), broken, 10), /Invalid model/);
});
