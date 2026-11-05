# Rust converter core

Rust WASI implementation of `converter-core`. It covers every pair in `../converter-core/manifest/conversions.json` and now produces the production artifact.

The public conversion policy is read directly from `../converter-core/manifest/conversions.json`; there is no second Rust-only format list.

Build with `npm run build:wasm`; test with `npm run test:wasm` and `npm run test:wasm-smoke`.

## Optional format detection experiment

`src/format_detection.rs` is a name-independent detector, exposed by the separate
`converter-detect` binary only with `format-detection` or one of its extensions.
It does not change production preview/CLI routing
or the normal WASM build. The container variant reuses the existing ZIP/XML
parsers. Other ambiguous containers and generic text deliberately abstain.
Detection evidence is not full-file validation or a calibrated probability.

```sh
cargo test --locked --manifest-path wasm/converter-core-rust/Cargo.toml --no-default-features --features format-detection-containers --bin converter-detect
node scripts/evaluate-format-detection.mjs --output benchmarks/format-detection
```

Run these commands from the repository root. The evaluator builds both native
and optimized WASI variants, checks every corpus sample through the frontend
in-memory WASI host, and records raw/gzip/Brotli size, bounded reads, timing,
exact-label agreement, family matches, abstentions and routing-policy comparisons.
The [report](../../benchmarks/format-detection/README.zh-CN.md) distinguishes this
development corpus from an independently labeled accuracy test.

The `detect-web` cdylib example provides a smaller optional browser ABI for the
same rules. It reads source fragments through one host callback, reuses its
instance and returns static field pointers rather than CLI JSON. Its frontend
binding is `packages/converter-client/src/format-detector.ts` (not imported by
default). JSON detection validates tokens without materializing an object tree.
Run `node scripts/optimize-format-detection.mjs` after the baseline evaluator to
compare both builds against the frozen original artifacts and check Chromium.
See the [optimized report](../../benchmarks/format-detection/optimized/README.zh-CN.md).

Broader detection is split into two additional optional features:

- `format-detection-expanded`: additional binary signatures, TIFF/DNG, EBML/Ogg,
  structured JSON/XML/text, UTF-16 BOMs, and iWork/application/document ZIP metadata.
- `format-detection-compound`: includes the above and CFB root-stream probes for
  legacy Word/Excel/PowerPoint and Outlook messages. Encrypted or conflicting
  containers abstain. CFB files larger than 64 MiB stay ambiguous to bound table
  allocations; the 256 KiB cumulative read budget still applies to every probe.

The expanded probes live in `src/format_detection/probes.rs`. They reuse ZIP/XML,
Snappy, and optionally CFB readers already present in the converter's dependency
tree; no external detector or model is linked. Unknown text remains ambiguous.
The ordinary WASM/preview build does not enable these features.

```sh
CARGO_INCREMENTAL=0 cargo test --locked --manifest-path wasm/converter-core-rust/Cargo.toml --no-default-features --features format-detection-compound --bin converter-detect
python3 scripts/prepare-format-detection-corpus.py --fetch-upstream
node scripts/evaluate-expanded-detection.mjs
```

The [expanded report](../../benchmarks/format-detection/expanded/README.zh-CN.md)
compares the frozen optimized container artifact and both expanded variants on
794 files, including pinned external fixtures. It records size, separate exact/
family/container agreement, per-format results, negative inputs, regressions,
native/browser equivalence, and source/artifact hashes. See the
[corpus provenance](../../benchmarks/format-detection/corpus/README.zh-CN.md).
These fixtures inform development and cannot establish real-world accuracy.

Fixed header signatures use compile-time sorted arrays in
`src/format_detection/signatures.rs`: binary search locates the two-byte unsigned
prefix, then the matching bucket checks full signatures, minimum lengths and
guards. Stable ordering preserves rule priority and fallback when an earlier
candidate fails validation. One shared search records the first match for each
phase independently, preserving the precedence of expanded probes over the
base result. Lookup
cost is O(log N + kL), where k is currently at most two candidates per bucket
and L is signature length. There is no runtime sorting or index heap allocation.
DWG version IDs also use a sorted array and binary search.

Compare with the preserved expanded artifacts without overwriting them:

```sh
node scripts/evaluate-expanded-detection.mjs --output benchmarks/format-detection/indexed-v2 --reference benchmarks/format-detection/indexed --current-inputs
```

`--current-inputs` snapshots current fixture bytes for both native/WASM runs,
records any differences from the frozen corpus hashes, and leaves that corpus
unchanged. Omit it to require all frozen input hashes to match. The
[index report](../../benchmarks/format-detection/indexed-v2/README.zh-CN.md) records
field-by-field output equivalence, artifact sizes and alternating warmed timing
trials against the prior expanded WASM. Timings cover the complete detection
call, including structure parsing and the JS binding; they are not an isolated
binary-search benchmark.

BMFF detection ranks compatible brands in one pass without a temporary vector.
CFB root streams use a family bitset; ZIP probes reuse the archive name index
and only copy up to four candidate XPS paths. XML attributes and shebang words
are inspected without collecting them. The ordinary text path validates UTF-8
once, and JSONL probes check two nonempty lines before processing the remainder.
These changes preserve detection fields and cumulative bytes read.

`format-detection-simd` adds an optional SIMD128 ASCII/control-character scan to
the shared text detector. It works alongside either detection variant. The WASM
function uses explicit 16-byte loads and comparisons, unrolled four vectors per
64-byte iteration, handles its tail without
overreading, and falls back to the existing decoder when any non-ASCII byte is
present. The native build uses the same control policy in scalar code for parity
tests. The standalone frontend detector defaults to SIMD on supported runtimes,
with automatic scalar fallback. The general converter's feature set is unchanged.

`npm run build:format-detector` builds both variants in `wasm/format-detector/dist`.
Building `@filens/converter-client` also builds and packages them as separate WASM
assets. The default loader fetches only SIMD when supported; unsupported runtimes
and failed SIMD downloads/compilation fall back to scalar. Importing the module
does not fetch either artifact. Custom sources remain supported, including a
scalar-only source to explicitly select the portable detector.

```ts
import { createAutoFormatDetector } from '@filens/converter-client/format-detector';

const detector = await createAutoFormatDetector();
const result = detector.detect(fileBytes); // Uint8Array
```

```sh
CARGO_INCREMENTAL=0 cargo test --locked --manifest-path wasm/converter-core-rust/Cargo.toml --no-default-features --features format-detection-compound,format-detection-simd --bin converter-detect
node scripts/evaluate-expanded-detection.mjs --output benchmarks/format-detection/simd --reference benchmarks/format-detection/indexed-v2 --simd
```

The [SIMD report](../../benchmarks/format-detection/simd/README.zh-CN.md) compares
an additional light SIMD artifact against the current portable light build.
It verifies vector instructions in the compiled WASM, compares native/WASM
outputs, exercises every byte value around vector/sample boundaries, and checks
Chromium. Timings separate ASCII and non-ASCII input heads as well as the whole
corpus. Select the SIMD artifact only in runtimes that support WASM SIMD128.
The evaluator can use a reference directory's saved corpus manifest; omit
`--current-inputs` to enforce those hashes without creating temporary copies.

## Current milestone

- Covered: all source/target pairs in the shared conversion manifest, including application icon extraction, BIFF spreadsheets and PowerPoint binary files.
- Production: `../converter-core/dist/converter-core.wasm` is Rust.

Size snapshot from `npm run report:wasm-sizes` (bytes, gzip level 9, Brotli quality 11;
Binaryen 131, `-Oz --converge` for document/Office builds):

| Artifact | Raw | Gzip | Brotli |
| --- | ---: | ---: | ---: |
| `converter-core.wasm` (split, detection only) | 916,303 | 412,942 | 335,464 |
| `converter-office.wasm` (optional decryptor) | 379,079 | 163,967 | 130,417 |
| `converter-core-full.wasm` (combined alternative) | 1,078,852 | 476,846 | 386,568 |
| `converter-image.wasm` (optional) | 1,126,286 | 305,601 | 221,453 |

The combined build retains all conversion routes, application icons and modern/
legacy Office decryption. Sharing the miniz compression backend, XML dependency,
ZIP readers and XML rewrite loop, removing unnecessary Unicode case conversion,
and converging Binaryen reduces its gzip size from 542,228 to 476,846 bytes
(12.1%). The preferred approximately 300 KB target is not reached. The historical
308,888-byte figure used Brotli; its gzip size was 381,175 bytes. See the
[optimization measurements and validation](../../docs/converter-size-impact.md).

RAW conversion in the core only copies the largest standard 8-bit embedded
JPEG. Full sensor decoding lives in the optional `converter-image.wasm` module,
so document and panorama users do not download the RAW decoder and camera data.

PPM conversion runs entirely in this core and produces PNG. Both P3 text and P6
binary RGB are supported, including header comments, arbitrary maximum sample
values (1–65535), and 8/16-bit samples. PNG retains the source sample depth;
values are scaled to the PNG range. Only the first image in a stream is used.
Input is limited to 256 MiB and decoded RGB data to 128 MiB.

The retired Go core was 82.8% larger by Brotli size at equivalent fixture coverage.

## Application icons and size attribution

APK/IPA and PE resource icons convert to PNG in `src/icons.rs`; the Go wrapper
continues to invoke this same core. ICO supports embedded PNG and standard
1/4/8/24/32-bit DIB frames. APK follows compiled application icon references and
resource aliases; IPA uses its main bundle's XML/binary plist and normalizes
Apple CgBI PNGs. Unsupported vector-only or asset-catalog-only icons return a
parse error. Input is limited to 256 MiB, ZIP entries to 10,000, each icon resource
to 16 MiB, decoded DIB/CgBI rasters to 16 megapixels, and raster candidate reads
to 64 MiB across at most 256 candidates. Resource references are depth bounded.

Office decryption is separated from the split core. The earlier increase
was primarily `msoffice-crypto` (AES, hashing, CFB and legacy RC4/XOR support), not
HEIF decoding or language strings. Reproduce a same-source comparison with:

```sh
npm run build:wasm
npm run report:converter-size-impact
```

The split core retains encryption detection but excludes the `office-crypto`
feature. On `engine_unavailable` with `requiredModule: "office"`, hosts invoke
the decrypt-only addon and pass its output back to the core. Missing passwords
produce `password_required` without loading the addon. The combined core retains
integrated decryption and is used by the all-in-one preview to avoid duplication.
Native/text CLI builds also retain integrated crypto through the default feature.
The analysis-only variants remove icon dispatch and then the Office handler from
a temporary source tree; they are never shipped. Exact byte counts
are recorded in [`docs/converter-size-impact.json`](../../docs/converter-size-impact.json).
See the [size explanation](../../docs/converter-size-impact.md) for the measured
contributions. Locale dictionaries live in the Vue/JS host and do not enter WASM.

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
