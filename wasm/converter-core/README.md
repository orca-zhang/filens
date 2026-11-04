# Conversion manifest

This directory retains the public conversion manifest and a thin Go policy adapter used by the wazero host.

All parsing, conversion, and OpenXML generation live in `../converter-core-rust`.

- `manifest/conversions.json`: shared source-to-target policy
- `manifest/manifest.go`: Go host adapter for validation and capability reporting
- `go.mod`: module boundary required by the Go host replacement

EPS/PS and legacy PostScript AI use the on-demand `converter-postscript.wasm`
module, built from the same Rust core and WASI protocol. It emits vector PDF,
preserves EPS bounding boxes and PS pages, and excludes resident font outlines.
The production build enforces a 1 MB compressed download cap for both gzip and
Brotli. See [design preview details](../../docs/design-preview.md) and
[dependency notices](THIRD-PARTY-NOTICES.txt). Distribute the notices with the WASM.

Build and test the production WASI core from the repository root:

```sh
npm run build:wasm
npm run test:wasm
npm run test:wasm-smoke
```
