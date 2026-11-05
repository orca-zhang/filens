# Selected performance workloads

Measured on 2026-11-05. These tables show only the latest FiLens implementation against named public baselines. Larger parser cases must have at least 100,000 cells or 16 MiB of expanded content, a baseline median of at least 100 ms, and a measured speed ratio of at least 2×. Selection affects the summary only: all timed samples remain in the raw report. No universal state-of-the-art or rendering-fidelity claim is made.

## Complete sidebar previews

| Sample · first / cached median (ms) | FiLens 0.1.3 | DSH built in | First-open speedup |
| --- | ---: | ---: | ---: |
| PPTX | **135 / 81** | 1830 / 124 | **13.56×** |
| DOCX | **111 / 94** | 1827 / 112 | **16.46×** |

These retained Office measurements use nine paired rounds per format on Apple M4 Pro, macOS arm64 and DSH Desktop 0.2.1-rc.5. PPTX is 659,484 bytes; DOCX is 601,507 bytes. First is first per file/process; application startup is excluded and OS/persistent caches are retained. DOCX follows PPTX and may reuse initialized host code. The built-in path converts Office to PDF; FiLens renders directly. Ratios compare matched medians, not added percentage improvements. [All Office samples and scope](assets/dsh-plugin/performance-retest.zh-CN.md).

PDF, workbook/iWork/STEP reopen behavior and all lower-gain/control cases remain in the [PDF report](assets/dsh-plugin/pdf-reopen-optimization.zh-CN.md) and [model report](assets/dsh-plugin/model-reopen-optimization.zh-CN.md). They are not promoted as headline comparisons.

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
