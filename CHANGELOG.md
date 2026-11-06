# Changelog

## v0.6.6 — 2026-11-06

Compared with v0.6.5.

- Publish **dsh-filens 0.1.7** and the independently switchable **dsh-filens-workspace 0.1.0**. Gather local references and attachments across paginated conversation history, deduplicate files while retaining sources, and return to the exact message or question.
- Group files under short session titles with thumbnail mosaics; render Office/PDF thumbnails and recognizable type covers. Add related files, temporary-file filtering, a narrower file list and a ZimaOS Photos-style details panel.
- Fix clipped zoom percentages, workspace activation/module naming and the duplicate demo pointer. Keep sidebar previews and document tools independently available.
- Release **preview 0.3.6**, **@filens/core 0.1.4**, **@filens/vue 0.1.4**, **@filens/media 0.1.3** and **@filens/panorama 0.1.3**. Localize panorama hints and playback controls through all 28 existing dictionaries; language changes preserve the current video and position. Keep the original video duration during progressive playback.
- Refresh Full offline bundles and **mobile source SDKs 0.1.6** with preview 0.3.6. CLI/OCR 0.5.6 native bytes remain unchanged; Lite stays below 10 MB. npm CLI 0.5.6 still prepares preview 0.3.4 unless assets are supplied explicitly. ZimaOS Mod Store remains 0.5.1.
- Add six separately recorded Chinese/English DSH Desktop demos for Office, 3D/panoramas and the workspace. Use the matching FiLens introduction PPTX; Chinese Office bodies, sheets and headings are localized. Preserve candidate-build provenance and existing benchmark versions.
- Keep download tables, SHA-256 checksums, the build manifest and the ZimaOS banner in the release notes. Publish the workspace dependency before the main DSH adapter and verify public registry integrity.

## v0.6.5 — 2026-11-05

- Highlight the three measured DSH first-open comparisons at the start of both README plugin sections: PPTX **13.56×**, DOCX **16.46×** and PDF **1.73×**, retaining benchmark versions and source reports.
- Preview **0.3.5** reads DWG directly as a CAD model, loads a dedicated **443 KB gzip** CAD reader, caches repeated blocks and retains explicit DWG-to-DXF export. Thirteen drawings cover R14/AC1014–AC1032, with partial 2D limits and bounded expansion.
- Reduce browser ZIP downloads to **5.61 MiB split / 10.59 MiB all-in-one**. Supplied main JS is **3.53 MB gzip / 3.40 MB Brotli**, excluding optional archive sidecars.
- Add horizontal PPTX bars, formatted value labels and basic chart text/axis styles; add Chinese/English introduction decks that follow the demo language; align the compact Tools disclosure control.
- Slim CLI **0.5.6** Lite downloads to **6.90–7.17 MiB** by keeping OCR/preview assets optional, retaining reading, search and conversion. Enforce a strict **<10,000,000-byte** Lite archive budget in native/Windows packaging and release aggregation, with boundary tests. Full bundles include preview **0.3.5**; CLI/OCR binaries and resources remain byte-for-byte unchanged. Mobile source SDKs move to **0.1.5**. DSH **0.1.6** retains its published preview **0.3.4**; ZimaOS versions are unchanged.
- Validate 856 unit checks, 2,128 policy checks, 328/328 WASM conversions, 64 installed browser previews, 22 mobile-bridge checks, 17 offline-HTML checks and native macOS Full/Lite reading, search, conversion and Full OCR, plus Lite previews with separately supplied assets. Linux/Windows payloads are verified against the previous release; native execution and physical mobile devices are not retested.

- npm follow-up: publish **filens-preview 0.3.5** and 11 updated module patches. Verify public tarballs, dependency availability and latest tags; pass fresh-registry installation, strict types, browser previews and production bundling. [npm publication](docs/release-v0.6.5-npm-publication.json).

[Downloads, detailed changes and ZimaOS installation](docs/release-v0.6.5.md) · [Validation](docs/release-v0.6.5-validation.json)

## DSH 0.1.6

- Keep zoom out, the zoom percentage, zoom in and fullscreen beside the DSH address bar for every preview type. Remove page, rotation and manual fit buttons and warning-count badges; retain PPTX keyboard navigation.
- Reuse native zoom where supported and provide shared view zoom/fullscreen for text, Word, archives and media. Keep Word pane fitting independent of user zoom.
- Keep CAD layers and the 3D inspector as compact entries; group worksheet, archive and attachment controls in a Tools menu. Keep audio/video playback, timeline, volume and speed below the player; use a compact 4-character zoom percentage. Preserve driver handlers, independent tabs and fullscreen restoration.
- Shorten the English/Chinese README DSH section and consolidate benchmark tables at the bottom. Expand the featured comparisons to 12 measured scenarios across DSH, XLSX, ZIP, PPTX, RAW and STEP, with dates and stage boundaries.

## DSH 0.1.5

- Rename the preview entry to **FiLens Document Preview** / **FiLens 文档预览**. Keep its description focused on local previews for 400+ formats, including Office, PDF, iWork, CAD/3D, RAW and 360° media. The separate FiLens Tools entry keeps its own tool description. Includes the header controls and fixes from 0.1.4.

## DSH 0.1.4

- Move format controls beside DSH’s address bar: page navigation, zoom, rotation, fullscreen, worksheet tabs, archive search/sort, Office attachments, audio/video playback and the 3D inspector. Omit manual Fit / Width / Height buttons, including fullscreen.
- Preserve original control nodes and handlers, per-tab state and cleanup. Hide retained parent controls while an attachment is open; bring controls into the fullscreen preview and restore them to the header on exit.
- Fix narrow-header overflow, nested scrolling, intercepted button clicks and the misplaced 3D tools opener. Open the inspector below the header without shrinking the canvas; preserve keyboard tabs, Escape and focus restoration.
- Re-record the 3D / panorama GIF, WebP and MP4 with header model/view/section tools, panorama zoom and video seeking/playback. Update the FiLens skill, README SOTA shortlist and current build/package measurements.
- Validate 66 Vue tests, 17 attachment tests, 18 DSH tests, 16 isolated format-loading paths, 12 complete browser previews and six real Desktop formats. Browser fullscreen passes; Desktop native fullscreen is explicitly skipped. [Validation](docs/dsh-header-controls-validation.json).

## DSH 0.1.3

- Add bounded parsed-model reuse for XLSX and iWork, and CPU mesh reuse for STEP: four entries share a 64 MiB accounting budget and expire after 30 idle seconds. Keep mutable formulas/fonts, DOM, workers and GPU resources independent per tab; restore Numbers archives only when a later sheet is requested. Password opens, including decrypted Office outputs, bypass reuse.
- Nine-round Desktop comparison with the preceding PDF-cache build (432 opens): reopened large XLSX **94 → 77 ms**, Pages **177 → 77 ms**, Numbers **176 → 93 ms**, Keynote **177 → 94 ms**, STEP **226 → 109 ms**. Small XLSX stays **68 ms**; Numbers first open rises **193 → 227 ms**. [Full timings, tradeoffs and validation](docs/assets/dsh-plugin/model-reopen-optimization.zh-CN.md).

- Mount the shared split preview runtime directly into DSH's sidebar DOM and move zoom/fullscreen into its existing outer header. Remove the viewer iframe and duplicate inner toolbar; reuse module initialization across opens.
- Load each format driver on first use, keeping route metadata separate from renderers. Share in-flight imports, cached modules, compression and native drivers; use the same path for nested files and converted outputs. Text/PDF opens no longer preload Office, iWork, CAD or Three.js.
- Reduce initial embedded JavaScript from **3.04 MiB to 345 KiB** (about **89%**); TXT first-open resources fall from **3.09 MiB to 449 KiB**. These are raw requested runtime bytes, with document bytes excluded. [Loading evidence](docs/assets/dsh-plugin/format-loading.json).
- Reveal PDF after the first painted page while continuing nearby pages in the background. Preserve complete rendering for non-virtual print/export previews.
- Preserve source-byte ownership, passwords, live appearance, file switching, independent tab controls and cleanup. Support Desktop's cross-origin local modules/WASM with scoped stylesheet lifetime and Blob workers.
- Reuse exact first-page PDF pixels by full content digest, CSS viewport and pixel resolution, bounded to four pages / 16 MiB / 30 idle seconds. Password, URL and non-virtual print/export paths bypass the cache. Every open still validates the PDF; closing releases each document and worker. Remove the extra PDF loading-cover frame.
- Nine-round matched PDF comparison (144 opens): latest FiLens **190 / 77 ms** first / cached versus built-in **329 / 110 ms**, a **1.73× / 1.43×** speedup. Reopened latency falls **51.6%** versus the preceding candidate. Pixel equality and worker cleanup verified. [Results and limits](docs/assets/dsh-plugin/pdf-reopen-optimization.zh-CN.md).
- The separate nine-round Office retest gives PPTX **135 / 81 ms** and DOCX **111 / 94 ms** (first / reopened). Preserve all 324 pre-optimization Office/PDF opens separately. [Full samples](docs/assets/dsh-plugin/performance-retest.zh-CN.md).

## 0.6.4

CLI 0.5.6 · browser preview 0.3.4 · mobile source SDKs 0.1.4 · DSH adapter 0.1.6 (updated in this release).

- Add `filens inspect FILE --json`: bounded content-based format/MIME detection in the shared WASM core, evidence categories, extension comparison and explicit unknown/ambiguous results. Inspect reads at most 256 KiB without copying the entire source into the workspace; refresh both terminal GIFs with real inspection output.
- Expand CLI inputs from 334 to 349 formats: add TGA, DDS, DIB, CUR, PCX, JPEG XL, QOI, Farbfeld, PSD, PSB, ICO, ICNS, AI, EPS and PS to reading/OCR/search through the shared WASM decoders. Ship the expanded CLI as 0.5.6 and update the DSH dependency.
- Expand browser preview coverage from 402 to 450 extensions, including local WASM conversion routes. Add TIFF and other raster formats, JPEG XL, EXR, QOI, Farbfeld, and DWG-to-DXF previews; extend compressed-stream, package and system archive support.
- Improve archive browsing, search, sorting and keyboard navigation; add graphics, text and archive samples, remote-link opening and SVG selection improvements.
- Add an optional content detector at `@filens/converter-client/format-detector`, with lazy SIMD/scalar WASM loading and initialization fallback.
- Deliver precompressed all-in-one preview JavaScript with gzip and Brotli representations each capped at 4,000,000 bytes. Archive sidecars and the complete distribution are measured separately. Packed resources add initialization work; split builds retain lazy loading.
- Preserve archive engine and worker assets when bundling the all-in-one npm export into a Vite application.
- Optimize shared ZIP/XML readers, XLSX indexes and formula evaluation, document resources, font loading, 3D loaders and shared search matching. Preserve excerpt provenance and ranking semantics.
- Improve Apple-edited 10-bit HEIF metadata, color and alpha handling. Refresh DSH preview resources and Office/3D/panorama demonstrations.
- Re-record the public DSH 0.1.2 installation and Office walkthrough. Compare 0.1.1, 0.1.2 and built-in previews across nine rounds per format and **324 actual opens**. 0.1.2 first-open medians are **540 / 294 / 684 ms** for PPTX / DOCX / PDF. Publish cached medians and complete observed ranges, retaining historical timing evidence separately. The complete plugin is 11.93 MiB download / 16.40 MiB unpacked, excluding CLI/OCR dependencies. [Measurements and method](docs/assets/dsh-plugin/README.md).
- Update the `@filens/*` modules, offline Full/Lite CLI bundles, browser builds and mobile source SDKs together. Parsing and conversion remain in the shared frontend WASM core.

See the [full release notes](docs/release-v0.6.4.md), [support matrix](docs/support-matrix.md), and [validation](docs/release-v0.6.4-validation.json) for format limits and checks actually executed.

### Performance details

- Defer DOCX, ZIP compatibility, encrypted ZIP and OLE attachment readers. Load GLB/glTF, OBJ/MTL, USDZ, LDraw, FBX, 3DS and VRML engines when their format is opened; retain synchronous public loader APIs. Share in-flight imports and permit retries after import failures.
- Reuse the core ZIP index and selective inflation across EPUB/CBZ, mind maps, Visio and 3MF. Write native large-entry inflation directly into its output buffer; normalize only paths containing actual dot segments. Keep ZIP64 and legacy Unicode compatibility readers available.
- Defer the general XML parser for ordinary PPTX and CSV, remove the unused XMLBuilder from production, and reduce temporary allocations when building PPTX XML views. Share DEFLATE encoding through fflate while retaining Pako decompression and CRC/error behavior.
- Extend the XLSX numeric/shared-string fast path to column styles and simple sheetData attributes. Cache column-style lookups, reuse attribute matchers and keep the general parser for complex XML, rich text and formulas.
- Build compact row/bitmap cell indexes, read sparse ranges without walking empty coordinates, and stream SUM values without temporary range arrays. Preserve duplicate-coordinate precedence, floating-point order, overflow, dependency errors and cycles.
- Decode only the first usable TIFF page for preview. Reduce Blob copies and share preview/download URLs; use native or bounded Base64 paths for media, EPUB and model textures.
- Read only referenced EPUB assets, scan CSS URL/import candidates directly, traverse MindManager wrappers without repeatedly collecting descendants, and avoid unnecessary Visio container-property reads while retaining child shapes.
- Index uploaded-resource aliases and KMZ fallback paths while preserving exact-match priority and ambiguity. Share default extension/MIME route indexes; keep custom route arrays live.
- Reuse archive listing order and cached sort results during filtering; move keyboard focus through adjacent result rows without collecting the whole DOM list on every keypress.
- Index iWork character styles and Pages paragraph ranges. Reuse bounded font samples and per-call classifications; use a current-document CAD layer set and delegated SVG selection events with ID indexes.
- Find PDF viewport pages with ordered geometry queries and release only active page tasks/canvases. The later first-page pixel cache and XLSX/iWork/STEP model cache are detailed in the DSH 0.1.3 section above.
- Reduce search work through per-file exact-match boundaries, precomputed query weights, sparse numeric query features, on-demand filename tokenization, direct body query-feature extraction and borrowed normalized text slices. Select the best files before sorting their candidate excerpts, preserving ranking and provenance.
- Add SIMD ASCII normalization/token scanning in the shared search core (WASM SIMD128, native SSE2/NEON, scalar fallback), plus optional SIMD content detection. Index OCR line scores and Office media references once instead of rescanning for each row or reference.
- Exclude source maps from frontend npm packages while retaining local hidden maps. Keep all-in-one precompressed main JavaScript below 4,000,000 bytes per gzip/Brotli artifact, with external archive resources counted separately. Compression adds decode work; individual staged benchmark gains are not cumulative multipliers.

### Bug fixes and compatibility

- Fix missing archive WASM/worker assets after rebundling the all-in-one npm export with Vite, which prevented RAR/7z previews.
- Fix SUM ranges exceeding the JavaScript argument limit; a 160,000-cell range now evaluates without expanding it into function arguments.
- Encode Unicode EPUB stylesheet strings as UTF-8 before Base64 in opaque frames.
- Correct Apple-edited 10-bit HEIF grid/nested-grid color inheritance without mixing auxiliary alpha/thumbnail/tone-map profiles; include the 10-bit HEVC 4:4:4 chroma fix and reference-pixel checks.
- Delay unsupported ZIP compression errors until the affected entry is read, so unused attachments do not block supported document parts. Reject forged inflated sizes and honor cancellation on cached reads.
- Reject truncated PCX scanlines and out-of-bounds CUR image directories; bound raster dimensions before allocation and report missing optional graphics modules explicitly.
- Keep a successfully decoded TIFF first page previewable when an unused later page has corrupt compressed data.
- Prevent late remote downloads from replacing a newer local selection; clear old previews on remote errors, retain source notices and restore the right source on browser history navigation. Preserve manual format-category selection when asynchronous route registration finishes.
- Ignore obsolete file reads, imports, parser replies and render tasks after replacement or destruction, releasing late model scenes, textures, URLs and listeners. Preserve archive filters, sort order, scroll and keyboard focus; detached controls and SVGs cannot alter the current document.
- Fix published Vue declarations referencing a sibling workspace path instead of @filens/media, and remove invalid declaration/source-map references from distribution files.
- Support DSH Desktop cross-origin local modules/WASM and Blob workers, scope shared styles to live viewers and preserve host source-buffer ownership and independent tab controls.
- Isolate formulas, resolved fonts and STEP resources between cached sessions; invalidate changed file contents and PDF viewport/resolution; restore Numbers archive context for lazy sheets after cache hits. Password opens bypass model reuse even after Office decryption; cache failures fall back to normal parsing/rendering.

### ZimaOS

The full release notes include the linked **ZimaOS banner**, official Mod Store installation/update commands and offline HTML/OCR guidance. The ModStore package uses its own version: **0.5.1** (CLI 0.5.0 / preview 0.2.0).

[Compare with v0.6.3](https://github.com/IceWhaleTech/filens/compare/v0.6.3...main).
