# HEIF decoder build

This is libheif 1.23.5 with libde265 **1.0.18**, compiled to WebAssembly with
Emscripten 3.1.61. The upstream libheif-js 1.23.5 package bundles libde265 1.0.15;
that decoder corrupts the Cr plane of some Apple-edited 10-bit 4:4:4 HEICs.
Updating color profiles alone cannot fix the corrupted samples.

The worker and unit tests import this exact JS/WASM pair. Vite emits the WASM as
a separate asset, and includes both LGPL notices in `THIRD-PARTY-NOTICES.txt`.
The original source code is unmodified; `NOTICE.txt` links both upstream trees.
The generated glue adds Vite ignore comments to fallback asset URLs, since Filens
supplies `wasmBinary` explicitly and emits that lazy asset separately.

To rebuild from verified source archives, source the Emscripten 3.1.61 environment
and run from the repository root:

```sh
node scripts/build-heif-decoder.mjs
npm run test --workspace @filens/converter-client
npm run build --workspace @filens/converter-client
node scripts/test-heif-browser.mjs
```

The script pins libheif commit `413e2a87e6a70b3eccc3a3adc5801179dd2d9e00` and
libde265 1.0.18, checks SHA-256 before extraction, and builds with runtime dynamic
code evaluation disabled. It requires Node 20+, CMake, tar, and the sourced SDK.
No network or native decoder is needed by Filens at runtime.
The browser check requires Playwright Chromium (or `npx playwright install chromium`)
and uses the production Blob worker and separate WASM files. It defaults to the
public synthetic 10-bit fixture. Passing the private HEIC variables below selects
that image; `FILENS_ALPHA_PNG` plus `FILENS_ALPHA_PNG_RGBA` additionally verifies
browser alpha compositing against an independent RGBA reference.

Private edited-Apple regression (the image is deliberately outside this repo):

```sh
FILENS_EDITED_APPLE_HEIF=/path/to/edited.heic \
FILENS_EDITED_APPLE_RGBA=/path/to/independent-srgb.rgba \
npm run test --workspace @filens/converter-client -- --run test/heif-color.spec.ts
```

The reference is full-size straight-alpha, 8-bit sRGB RGBA, independently decoded
and color managed. The test requires a mean absolute byte error below 2. The
public synthetic corpus additionally checks decoder version, varied 10-bit
4:4:4 chroma, alpha, and nested grid color inheritance.
