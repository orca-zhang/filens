# Read-only 7-Zip engine

7-Zip 24.09 at the exact revision in `manifest.json`, compiled with Emscripten
4.0.10, **-O3 and LTO**. This is a throughput-oriented build. It retains the
RAR/RAR5, 7z, ZIP and split-volume handlers, every upstream decoder and crypto
implementation they use, and the existing `l` / `x -so` CLI contract. Ordinary
ZIP, TAR and GZIP previews continue using the shared TypeScript readers.

`7zip-24.09.patch` contains all source changes: Emscripten platform guards
adapted from 7z-wasm 1.2.0, and extraction-only guards for the ZIP writer
interfaces. The build script supplies the complete object selection, flags,
pre/post JavaScript and toolchain version check. Encoders and unrelated archive
handlers are excluded; supported decoding methods and encryption are retained.
The unRAR source **must not be used to develop a RAR-compatible compressor**.
See [the notices](../../THIRD-PARTY-NOTICES.txt) for all license terms.

Activate Emscripten 4.0.10, then run from the repository root:

```sh
npm run build:archive:wasm
node scripts/build-archive-wasm.mjs --check
```

The script fetches and verifies the pinned upstream revision. Set
`FILENS_7ZIP_SOURCE` to an existing clone for an offline rebuild. `--check`
verifies the generated JS, WASM and patch hashes without changing the vendored
files. The JS/WASM are shipped separately and may be replaced together by a
compatible rebuild. No archive WASM is embedded into main JavaScript or HTML.

The full `7z-wasm` npm package is a development-only archive fixture generator;
it is not a runtime dependency.
