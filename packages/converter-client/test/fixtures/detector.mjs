// Tiny real WASM detector ABI: grows memory and returns a fixed text record.
// No Rust build or archived experimental artifacts are needed for unit tests.
import { i32, set32 } from './wasi.mjs';
const unsigned = value => { const bytes = []; do { const next = value & 127; value >>>= 7; bytes.push(next | (value ? 128 : 0)); } while (value); return bytes; };
const vector = items => [...unsigned(items.length), ...items.flat()];
const string = text => vector([...new TextEncoder().encode(text)]);
const section = (id, bytes) => [id, ...unsigned(bytes.length), ...bytes];
export function createDetectorFixture({ trap = false } = {}) {
  const data = new Uint8Array(80), view = new DataView(data.buffer);
  // Data starts at address 8; strings start at address 64.
  for (const [offset, value] of [[0, 64], [4, 3], [16, 67], [20, 4], [24, 71], [28, 7]]) view.setUint32(offset, value, true);
  data.set(new TextEncoder().encode('txttextfixture'), 56);
  const code = [0, ...(trap ? [0] : [...set32(44, [0x20, 0]), ...i32(1), 0x40, 0, 0x1a, ...i32(8)]), 0x0b];
  return new Uint8Array([0, 97, 115, 109, 1, 0, 0, 0,
    ...section(1, [1, 0x60, 1, 0x7f, 1, 0x7f]),
    ...section(3, [1, 0]),
    ...section(5, [1, 0, 1]),
    ...section(7, vector([[...string('memory'), 2, 0], [...string('filens_detect'), 0, 0]])),
    ...section(10, [1, ...unsigned(code.length), ...code]),
    ...section(11, [1, 0, ...i32(8), 0x0b, ...unsigned(data.length), ...data])
  ]);
}
