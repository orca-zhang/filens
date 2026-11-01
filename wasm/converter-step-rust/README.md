# Rust STEP core

The production browser STEP parser, unit preparation and tessellation adapter live
in `src/`. They are promoted from the tested refined adapter, with a finite
face-normal fallback for invalid/zero surface normals at degenerate points. No STEP
parsing or meshing is implemented by the TypeScript host or backend.

`npm run build:step:wasm` generates an isolated Cargo manifest, uses the committed
`Cargo.lock`, fetches truck at `78d699b0792b39e27c2bf073b682986701644e91`, checks and
applies `docs/upstream/truck/0004-refine-trimmed-surfaces-and-poles.patch`, and builds
with Rust 1.93.0 / `wasm32-wasip1`. Binaryen `-Oz` strips debug/producers metadata.
The generated manifest and third-party checkout are under `tmp/rust-engines/`;
no third-party source edits are accepted beyond the recorded patch.

The resulting WASM, input hashes, dependency notices and exact compressed sizes
are recorded under `packages/step/vendor/`. Normal browser-library builds verify
those committed inputs and need no Rust toolchain. The initial promotion uses
`node scripts/build-step-wasm.mjs --from-validated`, which accepts only the
already evaluated adapter/lock/patch hashes.

Browser reads use `--binary`: the core writes a 16-byte `FLNSMESH` header
(little-endian uint32 version 1 and vertex count), followed by contiguous
little-endian Float32 positions and normals. The browser host validates the
header, length and finite values and returns typed arrays. Parsing, tessellation,
tolerance and geometry stay in this core. Omitting `--binary` retains the JSON
diagnostic output. All 44 solid fixtures match the previous reader's exact
Float32 vertices/normals and winding; 11 external-only inputs remain rejected.
[Regression evidence](../../docs/assets/rust-engines/binary-transport-regression.json).

This remains an approximate preview core. See
[the geometry checks and remaining sphere discrepancy](../../docs/rust-step-refined.zh-CN.md).
