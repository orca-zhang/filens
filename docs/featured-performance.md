# Selected performance workloads

Updated 2026-11-05. This selection contains 12 scenarios across DSH, XLSX, ZIP, PPTX, RAW and STEP. Each workload keeps its latest recorded result against a named baseline; browser dates and stage boundaries are stated below. Larger synthetic parser cases retain the existing thresholds (100,000 cells or 16 MiB expanded, baseline median at least 100 ms and speed ratio at least 2×). Tiny examples and marginal gains remain in the full reports. No universal state-of-the-art or rendering-fidelity claim is made.

## Complete sidebar previews

| Sample · first / cached median (ms) | FiLens 0.1.3 | DSH built in | First-open speedup |
| --- | ---: | ---: | ---: |
| PPTX | **135 / 81** | 1830 / 124 | **13.56×** |
| DOCX | **111 / 94** | 1827 / 112 | **16.46×** |
| PDF | **190 / 77** | 329 / 110 | **1.73×** |

These retained Office measurements use nine paired rounds per format on Apple M4 Pro, macOS arm64 and DSH Desktop 0.2.1-rc.5. PPTX is 659,484 bytes; DOCX is 601,507 bytes. First is first per file/process; application startup is excluded and OS/persistent caches are retained. DOCX follows PPTX and may reuse initialized host code. The built-in path converts Office to PDF; FiLens renders directly. Ratios compare matched medians, not added percentage improvements. [All Office samples and scope](assets/dsh-plugin/performance-retest.zh-CN.md).

PDF uses a separate nine-round paired run after first-page pixel reuse, on the same machine and DSH version with a 689,455-byte sample. Cached opens are **1.43×** faster than built in (**110 → 77 ms**, **30.0%** less time); first opens are **1.73×** faster. Each renderer starts a fresh process per round and opens/closes the file four times: first medians use nine opens and cached medians pool the next 27. Timing includes document reading, validation and rendering to ready plus two animation frames; application startup is excluded and OS/persistent caches remain. Each open still validates the PDF and closing releases its worker. [PDF samples, ranges and method](assets/dsh-plugin/pdf-reopen-optimization.zh-CN.md).

Workbook/iWork/STEP reopen behavior and lower-gain/control cases remain in the [model report](assets/dsh-plugin/model-reopen-optimization.zh-CN.md).

## Complete parsing calls on larger inputs

| Larger parsing workload | Baseline | Baseline / FiLens median (ms) | Speedup |
| --- | --- | ---: | ---: |
| XLSX · 2,000 × 64, 128,000 cells | SheetJS CE 0.20.3 | 150.94 / **61.72** | **2.45×** |
| XLSX · 8,000 × 64, 512,000 cells | SheetJS CE 0.20.3 | 615.71 / **213.50** | **2.88×** |
| ZIP · 10,000 entries, 18.34 MiB expanded | JSZip 3.10.1 | 700.55 / **55.52** | **12.62×** |
| ZIP · 2,500 entries, 36.23 MiB expanded | JSZip 3.10.1 | 247.99 / **95.37** | **2.60×** |

v20.20.2, Apple M4 Pro, darwin/arm64. FiLens uses core 0.1.2 and XLSX 0.1.1. Input generation, module download/import, garbage collection, output verification/hashing, networking and rendering are outside timing. Each of eleven rounds alternates library order; the first two are warmups and the next nine are measured. GC runs before each call outside timing. ZIP cases open a fresh archive every time and read every XML entry, including decompression. XLSX cases parse the whole workbook into each library's own model, including ZIP decompression and metadata. SheetJS uses its default read options with array input; no artificial slowdown options are added.

Every round verifies all 128,000 or 512,000 cell values, or every ZIP entry's complete text. Common-value equivalence does not establish identical styling, formula, encryption, error or rendering behavior. The workbooks mix numbers, shared strings and column/row/cell font declarations. ZIP documents are synthetic XML resource workloads. Results on one machine do not establish performance for all real-world files, browsers or devices; peak memory was not measured.

SheetJS CE 0.20.3 is downloaded from its [official CDN](https://cdn.sheetjs.com/xlsx-0.20.3/package/xlsx.mjs); its source digest is recorded alongside the FiLens build digests. JSZip 3.10.1 comes from the workspace dependency. [Raw per-round samples, input hashes and value hashes](../benchmarks/frontend/2026-11-05/featured-scenarios.json).

Reproduce after building core/XLSX with:

```sh
node --expose-gc scripts/benchmark-featured-scenarios.mjs
```

## Browser preview and geometry workloads

**PPTX, RAW and STEP: latest recorded browser comparisons**

| Workload | FiLens (ms) | Baseline (ms) | Speedup | Measured |
| --- | ---: | --- | ---: | --- |
| PPTX · 11.1 MB, 13 slides, complete parse | **28.5** | pptx-preview 1.0.7: 56.6 | **1.99×** | Oct 23–24 |
| NEF · Nikon D3S, sensor → preview canvas | **152.7** | LibRaw-Wasm 1.6.0 half-size: 326.7 | **2.14×** | Oct 23–24 |
| DNG · Pentax K-r, sensor → preview canvas | **167.7** | LibRaw-Wasm 1.6.0 fast half-size: 314.4 | **1.87×** | Oct 23–24 |
| STEP · as1_pe_203 assembly, geometry import | **61.2** | occt-import-js 0.0.23: 195.0 | **3.19×** | Nov 1 |
| STEP · tailturbine, geometry import | **50.6** | occt-import-js 0.0.23: 153.9 | **3.04×** | Nov 1 |

All dates are in 2026. RAW inputs have no embedded JPEG; preview resolution/tone differs from LibRaw. STEP compares parsing/tessellation and validated geometry, with different triangulations; scene construction and drawing are excluded. PPTX measures complete parsing. These are the latest recorded runs for each workload, with inputs/modules ready before timing. [Browser methods, confidence intervals and raw evidence](performance-comparison.md).
