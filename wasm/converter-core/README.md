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

TIFF (`tif`, `tiff`), TGA, PGM/PBM/PNM, DDS, Radiance HDR, DIB, CUR, PCX,
OpenEXR, JPEG XL, QOI and Farbfeld (`ff`) convert to PNG in
`converter-graphics.wasm`; DWG converts to UTF-8 DXF for the existing 2D viewer.
The module uses the `graphics-preview` feature and is loaded only when needed.
Browser hosts configure `createWasmConverterClient({ wasm, graphicsWasm })`; the
Go shell follows `requiredModule: "graphics"` and invokes the adjacent module.
The combined `converter-core-full.wasm` includes it. TIFF shows only the first
image, DDS only the first surface, JPEG XL only the first frame, and CUR only
the largest image without its hotspot. OpenEXR uses the default image and color
channels. HDR/EXR linear samples are converted to sRGB; raster output is 8-bit RGBA
and does not preserve full HDR range or print profiles. Input is
limited to 64 MiB, raster dimensions to 32768 per side / 32 megapixels, and
decoded raster or DWG section data to 256 MiB. No server-side format parser is used.
