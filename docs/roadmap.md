# Roadmap

Updated **2026-11-05**, checked against the current repository, including work after the published v0.6.4 release. Checked items are implemented within the stated limits; unchecked items are remaining work. Implementation does not imply full format fidelity or availability in every published artifact.

## Current Delivery

| Area | Current state | Evidence and limits |
| --- | --- | --- |
| Multi-format preview | Shared driver runtime, Vue host, format-based lazy loading, and 450 source-file extensions across document, media, design, CAD/3D, archive, book, text, mind-map, and diagram families. | [Support matrix](support-matrix.md); the internal `cad-json` entry is excluded from the source-format count. |
| Shared conversion | Manifest-gated frontend WASM conversion with optional Office, image, PostScript, graphics, and CAD modules; browser and backend hosts reuse the same core. | [Converter client](../packages/converter-client/README.md), [conversion manifests](../wasm/converter-core/manifest/conversions.json). |
| Passwords and fonts | Office decryption, PDF password handling, encrypted archives, shared font diagnostics, opt-in font packs, host font loading, and similarity-based substitution. | [Password checks](../packages/converter-client/test/password.spec.ts), [font contracts](fonts.md). Coverage remains format-specific. |
| Agent tools | Rust CLI for reading, OCR, cited excerpts, search, conversion, file inspection, duplicates, similar images, and offline browser previews. | [CLI guide](agent-cli.md); CLI operation coverage differs from browser preview coverage. |
| Published delivery | v0.6.4 records CLI 0.5.6, preview 0.3.4, iOS/Android source SDKs 0.1.4, DSH 0.1.6, and scoped npm modules. | [Release notes](releases/v0.6.4.md), [publication record](release-v0.6.4-publication.json). Later repository changes require their own release. |

## Next Delivery Priorities

- Close real-file fidelity gaps in PPTX/iWork, DOCX/XLSX layout, and DWG/STEP geometry, with fixtures for each fix.
- Extend large-file preview behavior: workbook/text virtualization, on-demand book extraction, and PDF text selection/search.
- Finish font coverage beyond the delivered loader: embedded fonts, missing typography metadata, SHX glyphs, and measured layout comparison.
- Complete native Windows/Linux execution checks and physical-device SDK validation before extending platform compatibility claims.
- Keep embedding retrieval and media ASR as optional future work; existing OCR, lexical search, and excerpts remain usable independently.

## Track A: PPTX Quality

### P0: Publish Surface

Status: delivered.

- [x] Root/package README files, public API documentation, and known limitations.
- [x] ESM/CSS exports, package metadata, and external consumer validation for published modules.

### P1: Visible Fidelity Gaps

Status: partially delivered.

- [x] Declarative preset geometry and adjustment-aware text bounds for common shapes.
- [x] Table text style inheritance with local overrides and real-sample regression coverage.
- [x] Explicit warnings for downgraded `bodyPr` behavior and missing/substituted fonts.
- [ ] Extend long-tail shape text bounds, custom-geometry text rectangles, and table style combinations.
- [ ] Improve autofit, wrapping, and text metrics against source Office layouts and available source fonts.

### P2: Real Sample Regression

Status: baseline delivered; corpus expansion continues.

- [x] Retain the remote `vue-office` `test.pptx` as an explicit regression deck, with DOM/style assertions including slides 5, 11, and 13.
- [x] Local fixtures for shape text bounds, table text styles, `bodyPr`, geometry, charts, and media.
- [x] Shared real-sample staging, conversion/preview smoke runners, strict expected-failure handling, and coverage reports.
- [ ] Grow visual/layout comparison coverage for diverse authored decks beyond the existing baselines.

Evidence: [PPTX parser tests](../packages/core/test/load-pptx.spec.ts), [browser regression tests](../apps/demo/e2e/demo.e2e.ts), [real-sample workflow](real-samples.md).

### P3: Geometry Formula Coverage

Status: common formula support delivered; geometry coverage remains partial.

- [x] Evaluate adjustment formulas beyond `val`, including arithmetic, conditionals, min/max, pinning, square roots, and trigonometry.
- [x] Reuse declarative guides, preset definitions, aliases, and adjustment-aware rendering for common shapes.
- [ ] Complete long-tail preset/custom geometry behavior and malformed or unsupported guide cases with focused fixtures.

### P4: Long-tail Office Objects

Status: partially delivered.

- [x] Cached column and pie charts, basic diagram-backed SmartArt, and unsupported-object placeholders/warnings.
- [x] Embedded audio/video items with native playback controls and poster assets, subject to browser codec support.
- [x] Office/PDF attachments can open recursively through shared preview routes with download fallbacks.
- [ ] Extend chart types, source styling, SmartArt layout, and media timing/interaction fidelity.
- [ ] Render OLE object content and expose comments, notes, review metadata, animations, and transitions where appropriate.

Evidence: [object parsing](../packages/core/test/load-pptx.spec.ts), [chart/media rendering checks](../packages/core/test/dom.spec.ts), [attachment checks](../apps/demo/e2e/attachments.e2e.ts).

### P5: Release Readiness

Status: initial releases delivered; validation continues per release.

- [x] External package installs, TypeScript consumer checks, fixture regressions, npm packaging/publication scripts, and a release CI workflow.
- [x] Published preview/module packages with licenses, dependency notices, checksums, size measurements, and validation records.
- [ ] Document a long-term public API compatibility and versioning policy across separately versioned packages.
- [ ] Expand release checks for visual fidelity; complete font collections, full SmartArt parity, and exact autofit without source fonts remain outside current guarantees.

## Track B: Multi-format File Preview Foundation

### M0: Architecture Boundary

Status: delivered; ongoing constraint.

- [x] Monorepo with generic driver contracts, source loading, routes, lifecycle, capabilities, events, and a shared Vue host.
- [x] Separate document, workbook, media, archive, CAD/3D, ebook, text, mind-map, and diagram models/drivers.
- [x] Browser, CLI, backend, desktop plugin, and mobile hosts reuse frontend WASM/TS capabilities.
- [x] Keep parsing/conversion algorithms in the frontend conversion core. Go remains a thin CLI/HTTP host for validation, temporary files, result mapping, output validation, and WASM invocation.

### M1: Native iWork Foundation

Status: delivered.

- [x] Separate `packages/iwork`, vendored protobuf/type-map references and fixtures, worker parsing, and DOM/SVG rendering.
- [x] Native Keynote/Pages/Numbers drivers, Vue integration, navigation, warnings, and cancellation/resource cleanup.

### M2: PPTX Extraction

Status: driver integration delivered; package extraction pending.

- [x] PPTX runs behind the generic driver contracts while preserving existing public exports.
- [ ] Create a dedicated `packages/pptx` and move PPTX parsing/rendering out of `packages/core`, retaining compatibility exports.

### M3: Native Front-end Drivers

Status: initial drivers delivered; fidelity/scalability work remains.

- [x] PDF.js canvas preview with lazy engine loading, visible/nearby page rendering, navigation, zoom/fit, cancellation, and password handling.
- [x] DOCX flow rendering through `docx-preview`, with shared font integration and resource cleanup.
- [x] XLSX/CSV read-only workbooks with sheet switching, cached values/basic formulas, incremental rows, and lifecycle handling.
- [ ] Add PDF text selection/search layers and improve workbook merged cells, styling, formulas, and large-sheet virtualization.

### M4: Optional Conversion Layer

Status: delivered and expanded beyond the original Office-only plan.

- [x] Optional WASM/HTTP/mock adapters outside native renderers, with shared errors, cancellation, lazy module loading, and retry behavior.
- [x] Manifest-approved legacy Office/WPS, OpenDocument/legacy OpenOffice, templates/shows, macro-stripped OpenXML, readable text, and table-like inputs normalize to preview targets.
- [x] Image/RAW/icon decoding, PSD/PSB composites, AI/EPS/PS vector PDF, and DWG drawing models use frontend WASM paths.
- [x] Split and combined WASM builds; backend Go/wazero invokes the same conversion implementation.
- [ ] Improve source-content/layout preservation without treating valid OpenXML output as proof of visual fidelity.

Exact allowed pairs and default precedence follow the [support matrix](support-matrix.md#conversion-support) and manifests, rather than a second extension list in this roadmap. Office add-ins and unlisted pairs remain outside the default policy.

### M5: General File Preview Families

Status: broad foundation delivered; remaining work is family-specific.

- [x] Image zoom/pan/rotate/fit/fullscreen; native audio/video playback; HEIC/HEIF fallback; RAW/raster/icon previews; optional bounded MP4/MOV recovery.
- [x] Text/code with line numbers, language metadata, and bounded lightweight highlighting; sandboxed HTML/XHTML preview.
- [x] Spherical image/video panoramas and experimental calibrated Insta360/DJI paths with resource-resolved companions.
- [x] ZIP/TAR/GZIP and optional 7-Zip WASM archive browsing, nested entry previews, encrypted/multi-volume archives, and resource-resolver helpers.
- [x] EPUB chapter and CBZ image readers with packaged resources and cleanup.
- [x] Native DXF SVG rendering and frontend-WASM DWG → `cad-json` for the same renderer; explicit DWG → DXF remains available.
- [x] STEP/STP uses lazy truck Rust WASM; common mesh/scene, toolpath, point-cloud, voxel, skeleton, molecule, and volume formats use the shared 3D host.
- [x] 3D tree/selection, measurements, clipping, exploded views, material inspection, camera presets, snapshots, and format-specific resource diagnostics.
- [x] FreeMind/OPML/XMind/MindManager trees and diagrams.net/basic Visio viewers with navigation, zoom/fit, and selection.
- [x] Host font/resource resolvers, file-set/ZIP-backed sidecars, ZIP primary-file promotion, and recursive document attachments.
- [ ] Text search/wrap controls, encoding safeguards, and virtualization; on-demand ebook extraction and richer reader navigation/themes.
- [ ] DWG entity/layout/xref coverage, exact CAD text/SHX rendering, and STEP topology/trimmed-surface cases still failing the geometry screen.
- [ ] Gerber/Excellon and layered KiCad PCB preview after selecting and validating a frontend parser; DGN, IFC/Revit, and other unregistered CAD formats remain future work.
- [ ] Broader camera calibration, motion-photo video extraction, and media codec coverage before advertising general support; HLS/DASH and general transcoding remain pending.

Evidence: [per-family limits](support-matrix.md#fidelity-and-feature-details), [design previews](design-preview.md), [DWG audit](dwg-preview-optimization.md), [STEP remaining issues](upstream/truck/remaining-issues.md), [browser media engine](browser-media-engine.md).

## Track C: Native iWork Fidelity

### I0: Ship the MVP

Status: delivered.

- [x] Fixture-based `.key`/`.pages`/`.numbers` tests, ESM/CSS exports, Vue wrapper, and demo integration.
- [x] Worker lifecycle, safe replacement/cancellation, lazy Numbers sheets, and font-ready layout refresh.

### I1: Pages Semantics

- [x] Multi-page body model, section/page backgrounds, template headers/footers, page-number start values, and warnings for unsupported records.
- [ ] Improve exact pagination/body flow, floating drawables/attachments, section inheritance, and header/footer fidelity.

### I2: Numbers Semantics

- [x] Sheet canvases, merged-cell parsing/fixtures, sparse table handling, row loading, and shared workbook-grid rendering.
- [ ] Refine merged-cell edge cases, sizing/header/style inheritance, rich text, and number formats; full Numbers calculation remains unavailable.

### I3: Keynote Fidelity

- [x] Slide canvases, text, images, basic shapes/lines, template/style inheritance, and real-file regression tests.
- [ ] Improve placeholder/master inheritance, specialized shapes/media, charts, and common real-world deck fidelity.

Evidence: [iWork package](../packages/iwork/README.md), [iWork tests](../packages/iwork/test), [feature limits](support-matrix.md#native-iwork).

## Track D: Encrypted Document Support

### E0: Detection, Errors, and Safe Password Input

Status: browser/host contracts delivered; credential handling work remains.

- [x] Shared `password_required` / `password_invalid` errors, host-controlled password callbacks, Vue password UI/retry/cancel behavior, and Go CLI/HTTP error mapping.
- [x] Conversion credentials can arrive through structured stdin JSON/options instead of process arguments; preview state does not expose passwords.
- [ ] Add hidden CLI prompts or secret-provider hooks and broaden credential/decrypted-buffer lifetime audits and best-effort clearing.
- [ ] Expand fixtures distinguishing unsupported encryption, damaged metadata, signatures, DRM, and enterprise rights management.

### E1: Office and WPS Decryption

Status: common Office schemes delivered; broader variant validation remains.

- [x] Frontend WASM decryption for Agile/Standard encrypted OpenXML, legacy DOC/XLS/PPT RC4 CryptoAPI, and legacy XLS XOR fixtures.
- [x] Decrypt before existing normalization; split `officeWasm` loads only when required, while combined cores work without an addon.
- [x] Go hosts forward credentials to the same WASM core; missing/wrong passwords, Unicode passwords, damaged ciphertext, addon failure/retry, and cancellation have regression checks.
- [ ] Expand WPS-specific/other encryption variants and empty-password, damaged-metadata, large-file, and repeated-open fixtures before widening compatibility claims.

### E2: PDF and Additional Containers

Status: PDF and common encrypted archives delivered; remaining schemes pending.

- [x] PDF.js receives passwords and maps missing/wrong-password failures into the shared preview contract.
- [x] ZIP ZipCrypto/AES and RAR/7z encrypted archives, including encrypted filenames, solid archives, and supported multi-volume sets.
- [ ] Expand PDF encryption/permission-only fixtures and evaluate password-protected iWork and remaining archive encryption schemes.
- [ ] Audit decrypted-data lifetime across preview, extraction, OCR, search, and Agent workflows; password opens must not enter reusable document caches.

DRM, certificate-bound access, hardware keys, and enterprise rights management require separate host integrations. Evidence: [Office password tests](../packages/converter-client/test/password.spec.ts), [PDF password tests](../packages/pdf/test/preview-driver.spec.ts), [archive limits](support-matrix.md#ebooks-archives-mind-maps-and-diagrams).

## Track E: On-demand Font Coverage

### F0: Font Discovery and Diagnostics

- [x] Shared `PreviewItemState.fonts` and layout-drift warnings for PPTX, iWork, CAD, DOCX, XLSX, and partial PDF renderer inventories; lazy sheet/page updates and conservative availability/source metadata.
- [ ] Preserve omitted typography such as XLSX rich-text runs and chart fonts; obtain original PDF font names/embedded provenance through a supported engine API.

### F1: Optional Font Packs

- [x] Opt-in lazy Latin and SC/TC/JP/KR packs with pinned Fontsource WOFF2 manifests, regular/bold and supported italic faces, mirrors/self-hosting, deduplicated leases, source routing, bounded retries, and readable failure fallback.
- [x] Only manifests ship in core; versioned browser caching, licensing, CORS, privacy, and lifetime behavior are documented.
- [ ] Add dedicated Emoji/math and further style coverage, glyph-driven subsets, and document/language-driven coverage beyond current full regional files.

### F2: Embedded and Host-provided Fonts

- [x] `fontResolver` URL/mirror/byte assets, CSS face descriptors, aliases, explicit request authorization, and font-ready refresh across participating drivers while retaining navigation/zoom/scroll.
- [x] Replacement/abort/destruction discards stale loads and releases owned fonts; first preview does not wait for downloads.
- [ ] Extract/use supported embedded Office/iWork fonts subject to format/licensing rules; declarations alone do not establish loaded availability. PDF fonts remain controlled by PDF.js.
- [ ] Improve post-load measurement, wrapping, pagination/autofit, external font-readiness handling, and source-layout comparison.

### F3: CAD Fonts

- [x] SHX/style/Big Font discovery, host font mapping, and explicit missing-glyph/fallback diagnostics.
- [ ] Add supported SHX glyph-to-path rendering; browser font mapping alone cannot reproduce SHX outlines or legacy encodings.

### F4: Similarity-based Font Substitution

- [x] Shared family classification, Office PANOSE/pitch traits, local SFNT TTF/OTF metadata/cmap reading, and host/pack candidate ranking by traits and sampled coverage.
- [x] Visible target/score/reason, conservative unknown results, fallback candidates, managed loads, and layout refresh while preserving explicit mappings and symbol/SHX boundaries.
- [ ] Extend measured text metrics and supported font containers/styles/subsets, and compare wrapping/pagination when better candidates load.

Evidence and API details for F0–F4: [font diagnostics and on-demand loading](fonts.md).

## Track F: Optional Embedding and Media ASR

Status: planned. OCR, BM25/exact/filename search, and model-free excerpts are delivered separately; embedding retrieval and audio/video ASR are not implemented.

### AI0: Shared Optional Inference Contracts

- [ ] Define capability/provider contracts with model availability, supported inputs, resource limits, cancellation, and unavailable-provider errors.
- [ ] Keep parsing, conversion, chunking, demuxing, and audio preprocessing in the frontend WASM/TS core; hosts provide transport, temporary files, and optional model runtimes.
- [ ] Load models/runtimes on demand, keep Lite model-free, and require explicit host configuration for remote providers.

### AI1: Embedding and Hybrid Retrieval

- [ ] Define document/query vectors with model identity, version, dimensions, and normalization metadata.
- [ ] Add optional vector retrieval and BM25/vector fusion over shared chunks, preserving source paths, UTF-8 offsets, and available citation layout.
- [ ] Keep storage request-local by default and retain model-free search; evaluate paraphrase/cross-language recall, download cost, latency, and memory before claiming semantic retrieval.

### AI2: Video, Audio, and Music ASR

- [ ] Add optional transcription only for containers/codecs decoded by the shared media path.
- [ ] Return source paths, timestamped segments, language, available speaker/confidence metadata, and explicit partial/truncated/error results.
- [ ] Reuse transcripts for subtitles, extraction, search, and Agent evidence with timeline citations.
- [ ] Bound duration, segment size, memory, and inference time; support cancellation and temporary-buffer cleanup.
- [ ] Report silence/music without speech explicitly and evaluate sung-vocal transcription before claiming lyrics support.

## Track G: Agent CLI and Local File Workflows

### G0: Local Reading and Evidence

Status: delivered.

- [x] Rust CLI, capability discovery, structured `op` requests, eight output serializers, bounded Chinese/English intent handling, and memory-backed workspaces.
- [x] Shared-core text extraction, OCR callbacks, page/slide selection, evidence spans/layout, media inventories, selected images, and model-free cited excerpts.
- [x] Full/Lite packaging, native RapidOCR NCNN, verified model downloads, explicit incomplete/error results, and `setup-ocr`.
- [ ] Improve extraction/OCR fidelity and broader real-file evidence coverage; general question answering, paraphrasing, and translation remain the calling Agent's responsibility.

### G1: Search and File Inspection

Status: delivered; coverage/performance validation continues.

- [x] BM25, exact, and filename search across directories and supported nested archives, with source offsets and bounded partial results.
- [x] SHA-256 duplicate-file detection and perceptual similar-image grouping in the shared WASM core.
- [x] Bounded content inspection with MIME/evidence/extension-mismatch metadata, optional SIMD/scalar browser detection, and `filens inspect`.
- [ ] Extend format/scale regressions and native platform benchmarks; content detection remains routing evidence, not full-file validation.

### G2: Conversion and Offline Preview

Status: delivered.

- [x] Manifest-backed conversion using the frontend engines, atomic output commits, explicit overwrite handling, and preservation of existing files on failure.
- [x] Export portable preview HTML or serve through loopback HTTP, with bundled preview resources and ZimaOS integration.
- [ ] Improve large-file export costs and external-engine portability; optional archive engines and WebKit iWork previews retain documented HTTP-mode requirements.

Evidence: [CLI guide](agent-cli.md), [search](agent-cli-search.zh-CN.md), [archive search](agent-cli-search-archives.zh-CN.md), [similarity](agent-cli-similarity.md), [inspection validation](agent-cli-inspect-validation.json).

## Track H: Distribution, Integrations, and Performance

### H0: Packages and Application Hosts

Status: initial delivery published.

- [x] Scoped npm modules, standalone split/all-in-one `filens-preview`, native CLI Full/Lite installers/offline archives, and ZimaOS packaging.
- [x] iOS/Android source SDKs wrapping the same offline frontend/WASM runtime, with source SDK ZIPs and bridge tests.
- [x] DeepSeek Harness tools/sidebar plugin with local CLI integration, format-based lazy preview loading, shared controls, and browser/Desktop validation.
- [ ] Complete native Windows/Linux execution and physical iOS/Android checks; cross-built packages and browser bridge checks do not establish device compatibility.
- [ ] Provide precompiled mobile artifacts/registry integration if required; remote SPM, XCFramework, and Maven publication are not delivered.

### H1: Runtime Cost and Release Validation

Status: optimizations and measurement infrastructure delivered; continuing work.

- [x] Lazy format drivers/engines, shared ZIP/XML/compression paths, bounded caches, worker/runtime reuse, and obsolete-result/resource cleanup regressions.
- [x] Recorded browser/CLI comparisons, package/download/unpacked size reports, external package checks, release privacy checks, notices, and publication-integrity records.
- [ ] Expand representative large-file memory, cold-start, cancellation, and visual regressions as new formats and fixes land; keep workload/stage/platform limits attached to performance claims.

Evidence: [preview delivery](../packages/preview/README.md), [SDK scope](../sdk/README.md), [DSH integration](../integrations/deepseek-harness/README.md), [performance comparisons](performance-comparison.md), [release validation](release-v0.6.4-validation.json), [native validation limits](release-v0.6.4-native-validation.json).
