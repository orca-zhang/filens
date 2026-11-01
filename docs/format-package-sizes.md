# Format package size audit

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
