# Format package size audit

## 2026-11-02 throughput-oriented engine and embedded WASM

The archive engine now builds from pinned 7-Zip 24.09 source with Emscripten
4.0.10, **-O3 and LTO**. It keeps RAR/RAR5, 7z, ZIP and Split handlers, their
complete upstream decoders and crypto. Extraction-only guards remove writers;
unrelated archive handlers and unused NODEFS/WORKERFS adapters are omitted.
The WASM is **829,684 bytes raw / 330,277 gzip / 259,432 Brotli**, compared with
1,651,931 / 669,463 / 528,497 in the full upstream CLI. This uses a throughput
configuration, not the smallest -Oz build. The source patch, hashes and rebuild
instructions are in [the vendor directory](../packages/archive/vendor/7zip/README.md).
An independent rebuild with the pinned toolchain reproduces both JS and WASM
hashes exactly.

Compiled archive code is cached once and cloned to fresh operation workers;
passwords, files, solid buffers and linear memory remain isolated and are released
on termination. Failed downloads/compiles are retryable. Browsers unable to clone
a WebAssembly.Module retain the external URL-loading path. Browser checks verify
one WASM request across password retries and extraction of several archive types.

The ordinary document ZIP reader is now separate from its lazy encryption
wrapper. iWork never supplied archive passwords; it uses that ordinary reader
and retains its ZIP64/Unicode fallback. Its worker falls from **225,759 to 187,398
bytes gzip**, without bringing in another ZIP encryption implementation. Password
ZIP preview continues using the full wrapper and its existing retry behavior.

All-in-one WASM is gzipped before base64 and inflated on first use, including
HEIF workers. Split HTTP assets stay uncompressed WASM and use streaming
compilation when correctly typed. Native and JavaScript decompression paths are
tested. This reduces embedded base64/JavaScript overhead; it does not imply a
smaller decoded WASM or faster conversion for every document.

| Runtime, including optional archive engine | Before this round raw / gzip / Brotli | Current raw / gzip / Brotli |
| --- | ---: | ---: |
| Split | 13,036,454 / 3,981,755 / 3,148,491 | 12,111,592 / 3,605,254 / 2,847,871 |
| All in one | 14,704,453 / 4,569,944 / 3,467,177 | 9,726,728 / 3,603,632 / 3,177,720 |

Current main runtimes without the optional engine are 3,256,448 bytes gzip
(split) and 3,254,826 (all in one). Compared with the pre-feature baseline,
all-in-one including the engine is below its former 3,767,906 bytes gzip;
split including the new optional engine is above its former 3,199,077 bytes.
The main split runtime is 57,371 bytes gzip larger than that historical baseline.
RAR/7z and multi-volume ZIP remain external in every build and are never embedded
in offline HTML. Each independently deployable directory still contains its own
engine sidecars; npm tarball measurements include both copies.

Validation: 146 archive tests (including additional decoder/filter coverage),
336 iWork tests, password ZIP and attachment tests, 12 archive asset browser
checks, 48 actual standalone previews, and 17 offline HTML checks. These validate
loading, content/extraction and lifecycle behavior; performance measurements are
reported separately and do not imply universal speedups.

The local unpublished npm tarball is **7,318,499 bytes**, down from 8,655,935
at the start of this round (15.5%); installed files total 22,770,717 bytes.
The tarball is 3.9% above the pre-feature published package, while installed
bytes are lower. Both modes pass isolated npm installation and production Vite
re-bundling, including actual RAR password and extraction behavior.

Five alternating Chromium runs per case on macOS arm64, gzip HTTP at 4 MB/s
and 20 ms latency, produced these median timings. Each case uses a fresh
browser context; HTTP caching is retained within a case.

| Measurement | Before | Current |
| --- | ---: | ---: |
| All-in-one page initialization, legacy DOC case | 1,211.8 ms | 1,025.4 ms |
| Split RAR first password prompt | 292.2 ms | 188.8 ms |
| All-in-one RAR first password prompt | 292.3 ms | 191.7 ms |
| Split RAW opening | 287.9 ms | 287.7 ms |
| All-in-one RAW opening | 97.5 ms | 77.4 ms |
| Archive WASM requests, prompt/retry/unlock/extract | 4 | 1 |

Password retry and subsequent entry opening timings are broadly unchanged in
these UI measurements. This is a small fixture set on one machine; the complete
samples and exact size snapshots are in [the optimization report](preview-size-optimization.json).
Compare other build directories with
`FILENS_BENCH_BEFORE=/path/to/before FILENS_BENCH_AFTER=/path/to/after node scripts/benchmark-preview-runtime.mjs`.

## 2026-11-02 archive engine and compression dependencies (earlier snapshot)

RAR/7z and multi-volume ZIP now use the same optional frontend engine. Its worker
and WASM always ship separately, including the all-in-one build. The former
worker accidentally contained a base64 WASM fallback in addition to the external
WASM; an inline worker added another base64 layer. The host now supplies the
external URL, and build checks reject embedded archive WASM or a missing sidecar.
The engine and worker together are **690,723 bytes gzip / 547,379 bytes Brotli**.
Ordinary ZIP and ZIP-based document previews do not request them.

The format packages already declare shared JSZip/fflate dependencies rather than
embedding a copy per package. One further duplication remained inside JSZip's
prebundled browser distribution: it embedded pako while TIFF used the installed
pako. Demo and standalone builds now select JSZip's original modules, sharing
that installed pako. Three.js continues to share the installed fflate 0.8.2.
No compression algorithms or compatibility fallbacks were replaced.

| Current source build | ZIP dependency sharing saves (gzip / Brotli) | Main runtime gzip | External archive assets gzip | Total gzip |
| --- | ---: | ---: | ---: | ---: |
| Split | 14,531 / 10,314 bytes | 3,291,032 | 690,723 | 3,981,755 |
| All in one | 13,724 / 7,467 bytes | 3,879,221 | 690,723 | 4,569,944 |

The ZIP savings compare otherwise identical builds with the archive engine
already external. The main runtime includes attachments and encryption added
since the historical audit below, so these totals have a different feature set.
CLI self-contained HTML retains ordinary document and ZIP support; RAR/7z or
multi-volume ZIP require the local HTTP `--mode serve` path and separate assets.
Current [measurements](preview-build-sizes.json) distinguish main and archive bytes.

Validation includes 125 archive unit tests, 31 attachment/password browser
regressions, 12 built archive asset browser checks, 48 real previews from the two
standalone builds, and 17 offline HTML checks including the RAR HTTP fallback.

## 2026-11-01 historical audit

The 2026-11-01 audit found avoidable dependency bundling in the individual npm
format packages. The complete preview consumer built from those libraries fell
from **4,250,834 to 3,798,183 bytes gzip** (452,651 bytes / 10.6% smaller), with
all formats and engines retained. Brotli fell from 3,000,421 to 2,907,767 bytes
(92,654 bytes / 3.1%). These totals include dependencies, workers and WASM;
they are not sums of dependency-excluding package sizes.

## Findings and changes

| Area | Finding | Change |
| --- | --- | --- |
| Diagram, ebook, mind map, DOCX, 3D | Multiple library outputs contained their own JSZip implementation | Leave declared npm dependencies for the application bundler to share |
| Core, XLSX, archive, diagram | XML and compression dependencies were embedded independently | Apply the same dependency policy, including package subpaths |
| Panorama and 3D | Panorama embedded Three.js; 3D embedded its addon modules | Share Three.js and its addon subpaths through the declared dependency |
| iWork | Full protobufjs included a .proto text parser despite pre-generated JSON schemas; eager schema initialization retained unused main-thread parsing | Use protobufjs/light and initialize the schema only when parsing is requested; retain every schema and decoding path |
| PDF | A library worker URL became a Base64 JavaScript module | Emit the original worker as an MJS asset; retain the existing worker boundary |
| Demo/standalone source builds | Three.js vendors the same fflate 0.8.2 code used elsewhere | Resolve that vendored copy to the shared fflate dependency |

Asset queries remain bundled into published libraries. PDF workers and HEIF WASM
are shipped with their package; bare runtime dependencies are resolved by the
application bundler. The ESM format packages already require npm dependency
resolution. For direct browser deployment, use the standalone preview builds.
No package versions were changed or published.

Individual library files become much smaller after externalizing dependencies,
but those file sizes exclude the dependencies the application still needs.
The complete consumer measurement above includes them. The JSON report records
both levels; dependency rendered-byte figures describe Rollup's pre-minification
module output, not compressed contribution estimates.

## Standalone preview builds

Source-based standalone builds already shared most npm dependencies before this
audit, so their further savings are smaller:

| Build | gzip before | gzip after | Brotli before | Brotli after |
| --- | ---: | ---: | ---: | ---: |
| Split source runtime, all files | 3,206,724 | 3,199,014 | 2,526,777 | 2,522,435 |
| All-in-one source runtime | 3,777,416 | 3,767,869 | 2,833,571 | 2,828,157 |

The different compression methods have different windows and repetition costs;
Brotli and gzip savings are measured independently. All figures compress each
runtime file separately at gzip level 9 / Brotli quality 11 and exclude HTML,
notices, maps and declarations. CSS is embedded in the preview JavaScript.
The individual-library and source-alias consumers use different module graphs
and worker packaging, so their totals are not interchangeable.

## WASM findings

- RAW/image: no duplicated runtime compression/XML backend like the converter
  issue was found. Duplicate syn versions belong to build-time procedural
  macros. Decoder and camera-profile data remain part of its supported behavior.
- STEP: the tree contains runtime itertools 0.10/0.15 and build-time derive/syn
  versions. This is a candidate for a separate measured optimization; it was not
  changed, and no size saving is claimed for it.
- HEIF: the dedicated decoder and browser-native fallback remain unchanged.
  This audit does not establish a minimum possible size for its WASM.
- Combined converter: **476,846 bytes gzip / 386,568 bytes Brotli** after the
  separate core optimization; the approximately 300 KB target remains unmet.
  See [converter measurements](converter-size-impact.md).

## Validation and reproduction

All 12 affected library builds and declarations pass, and the built category
APIs import successfully in Node. All **336 iWork, 311 model3d and 15 PDF tests**
pass, including comparison of more than 1,000 iWork records against protobufjs. Browser checks
exercise **24 previews built from the compiled npm libraries** and **48 previews
from the two source standalone builds**, including actual Office/PDF/iWork,
STEP, RAW, panorama, archives, installer icons, password retries and 28 toolbar
languages. These checks verify loading and rendering readiness; they do not
claim pixel fidelity for every format.

An additional **51 browser regression tests** pass for compiled-package 3D,
archive and panorama consumers. They include archived geometry/texture pixel
comparisons, cancellation, resource cleanup and actual STEP/RAW WASM loading.
The fixtures now use an application bundler to resolve declared npm dependencies;
historical comparison modules are read from their tracked diagnostic archives.

[Exact before/after snapshot](format-package-sizes.json),
[npm consumer browser checks](format-package-validation.json),
[source build browser checks](preview-validation.json).

```sh
npm run build
npm run test:categories
npm run test:unit --workspace @filens/iwork
npm run build:preview
npm run test:preview
npm run report:bundle-sizes
```

The JSON before/after audit is a historical snapshot. Controlled intermediate
library and consumer builds were staged under ignored `tmp/format-size-audit`;
production library and standalone outputs were then rebuilt and tested.

## 中文说明

其他格式包也有可去除的冗余，主要是独立 npm 包各自内嵌 JSZip、XML 库和
Three.js，以及 PDF Worker 的 Base64 膨胀、iWork 不需要的 .proto 文本解析器。
已完成依赖共享、Worker 资源输出和 iWork 初始化调整。用这些 npm 格式包组合
的完整预览，gzip 实测 **4.25 MB → 3.80 MB，减少约 453 KB（10.6%）**；
Brotli 为 **3.00 MB → 2.91 MB**。功能和引擎保留。独立预览源码构建原先已共享
大部分依赖，本次进一步减少约 8–10 KB gzip，不能套用 npm 包组合的节省量。
