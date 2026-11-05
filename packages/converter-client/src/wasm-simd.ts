// Validate a small SIMD128 module without fetching or instantiating a converter.
const probe = new Uint8Array([
  0, 97, 115, 109, 1, 0, 0, 0, 1, 5, 1, 96, 0, 1, 123,
  3, 2, 1, 0, 10, 10, 1, 8, 0, 65, 0, 253, 15, 253, 98, 11
]);

export function supportsWasmSimd(): boolean {
  return WebAssembly.validate(probe);
}
