| Download | Link | Download size |
| --- | --- | ---: |
| CLI Lite: darwin-arm64 | [filens-0.5.6-macos-arm64-lite.tar.gz](https://github.com/IceWhaleTech/filens/releases/download/v0.6.5/filens-0.5.6-macos-arm64-lite.tar.gz) | 7.17 MiB (7,518,519 bytes) |
| CLI Full (OCR): darwin-arm64 | [filens-0.5.6-macos-arm64-full.tar.gz](https://github.com/IceWhaleTech/filens/releases/download/v0.6.5/filens-0.5.6-macos-arm64-full.tar.gz) | 31.89 MiB |
| CLI Lite: linux-x64 | [filens-0.5.6-linux-x64-lite.tar.gz](https://github.com/IceWhaleTech/filens/releases/download/v0.6.5/filens-0.5.6-linux-x64-lite.tar.gz) | 7.01 MiB (7,353,756 bytes) |
| CLI Full (OCR): linux-x64 | [filens-0.5.6-linux-x64-full.tar.gz](https://github.com/IceWhaleTech/filens/releases/download/v0.6.5/filens-0.5.6-linux-x64-full.tar.gz) | 33.56 MiB |
| CLI Lite: linux-arm64 | [filens-0.5.6-linux-arm64-lite.tar.gz](https://github.com/IceWhaleTech/filens/releases/download/v0.6.5/filens-0.5.6-linux-arm64-lite.tar.gz) | 6.90 MiB (7,237,880 bytes) |
| CLI Full (OCR): linux-arm64 | [filens-0.5.6-linux-arm64-full.tar.gz](https://github.com/IceWhaleTech/filens/releases/download/v0.6.5/filens-0.5.6-linux-arm64-full.tar.gz) | 31.24 MiB |
| CLI Lite: win32-x64 | [filens-0.5.6-windows-x64-lite.zip](https://github.com/IceWhaleTech/filens/releases/download/v0.6.5/filens-0.5.6-windows-x64-lite.zip) | 6.96 MiB (7,296,027 bytes) |
| CLI Full (OCR): win32-x64 | [filens-0.5.6-windows-x64-full.zip](https://github.com/IceWhaleTech/filens/releases/download/v0.6.5/filens-0.5.6-windows-x64-full.zip) | 33.78 MiB |
| Browser runtime: split | [filens-preview-0.3.5-split.zip](https://github.com/IceWhaleTech/filens/releases/download/v0.6.5/filens-preview-0.3.5-split.zip) | 5.61 MiB |
| Browser runtime: all-in-one | [filens-preview-0.3.5-all-in-one.zip](https://github.com/IceWhaleTech/filens/releases/download/v0.6.5/filens-preview-0.3.5-all-in-one.zip) | 10.59 MiB |
| iOS source SDK | [filens-ios-sdk-0.1.5.zip](https://github.com/IceWhaleTech/filens/releases/download/v0.6.5/filens-ios-sdk-0.1.5.zip) | 5.63 MiB |
| Android source SDK | [filens-android-sdk-0.1.5.zip](https://github.com/IceWhaleTech/filens/releases/download/v0.6.5/filens-android-sdk-0.1.5.zip) | 5.64 MiB |
| DSH plugin 0.1.6 (unchanged) | [dsh-filens-0.1.6.tgz](https://github.com/IceWhaleTech/filens/releases/download/v0.6.5/dsh-filens-0.1.6.tgz) | 6.53 MiB |
| Checksums | [SHA256SUMS](https://github.com/IceWhaleTech/filens/releases/download/v0.6.5/SHA256SUMS) | SHA-256 |
| Build manifest | [filens-release-v0.6.5.json](https://github.com/IceWhaleTech/filens/releases/download/v0.6.5/filens-release-v0.6.5.json) | Versions, sizes and validation |

**13 package downloads + manifest + checksums (15 assets).** Full includes OCR runtime/models and preview 0.3.5. Lite retains reading, search and conversion with OCR/preview assets optional. All four Lite archives are **below 10,000,000 bytes (10 MB)**; native packaging and release aggregation reject archives at or above this limit. Mobile ZIPs are source SDKs. MiB = 1,048,576 bytes.

## Changelog

Compared with [v0.6.4](https://github.com/IceWhaleTech/filens/releases/tag/v0.6.4). Components: **browser preview 0.3.5**, **iOS/Android source SDKs 0.1.5**, and **CLI 0.5.6** with smaller Lite bundles and refreshed Full preview assets. The CLI/OCR binaries and resources are retained byte-for-byte from their verified v0.6.4 bundles. **DSH 0.1.6 is unchanged and still embeds preview 0.3.4.** This release updates GitHub downloads; npm versions are unchanged.

### Direct DWG previews and smaller downloads

- Decode DWG into the versioned `cad-json` drawing model and render it directly, removing DXF serialization and reparsing from previews. Explicit DWG → DXF export remains in the shared frontend WASM core.
- Load the dedicated CAD reader independently from raster decoders in the split build. Its **442,809-byte gzip** engine is **77.6% smaller** than the graphics engine distributed in preview 0.3.4. The shared host and renderer are additional assets. Existing `graphicsWasm` integrations retain their combined-engine fallback; custom hosts can supply `cadWasm`.
- Cache reusable block definitions while preserving each insertion's transform, layer and color. Retain model/paper space, nested INSERT/MINSERT, placed attributes, dimension blocks, RAY/XLINE and visible constant attributes. Skip invisible attribute metadata and variable templates with explicit diagnostics for unsupported content.
- Cover **13 drawings across R14/AC1014 through AC1032**. AC1032 is the 2018 saved-file format, also used by newer CAD applications. This remains a partial 2D preview: R12 is unsupported, R13 is unverified, and complex/proxy entities, external references and SHX fonts retain documented limits.
- Enforce bounded input, decompression, object/vertex counts, nesting and TypeScript block expansion. Buffer JSON transport and validate the model envelope without building a second full JSON tree in WASM.
- Keep the all-in-one main JS at **3.53 MB gzip / 3.40 MB Brotli**, with supplied precompressed files below the 4,000,000-byte delivery budget. The optional archive WASM/worker remain external. Complete downloads are **5.61 MiB split (11.8% smaller)** and **10.59 MiB all-in-one (11.0% smaller)**.

[DWG corpus, timings and compatibility limits](https://github.com/IceWhaleTech/filens/blob/v0.6.5/docs/dwg-preview-optimization.md) · [Final runtime bytes](https://github.com/IceWhaleTech/filens/blob/v0.6.5/docs/preview-build-sizes.json) · [Exact downloadable assets](https://github.com/IceWhaleTech/filens/releases/download/v0.6.5/filens-release-v0.6.5.json)

### Presentation previews and demo fixes

- Render cached horizontal bar charts alongside column and pie charts, including clustered, stacked and percent-stacked bars, negative/missing values and reversed category order.
- Preserve chart titles, legends, axis/grid colors and basic text styles; show formatted value labels for bar/column charts and reserve room for readable category labels.
- Add Chinese and English 14-slide FiLens introduction samples. Choose the default deck and sample URL from the interface language, and switch the selected introduction when the language changes.
- Highlight the three retained DSH comparisons at the start of both README plugin sections: PPTX **13.56×**, DOCX **16.46×** and PDF **1.73×** faster first previews than built in, with measurement versions and reports.
- Give the compact **Tools** menu a consistent disclosure arrow and align the button across browsers. Clarify local-demo and hosted-demo links in both READMEs.

### Offline packages and validation

- Reduce Lite downloads to **6.90–7.17 MiB**, retaining the original reading/search/conversion payloads and removing bundled preview assets. Enforce a strict **<10,000,000-byte** archive budget in native packaging, Windows test bundles and release aggregation, including manifest-only refreshes. Boundary checks accept 9,999,999 bytes and reject 10,000,000.
- Refresh Full bundles with preview **0.3.5**, retaining the original CLI/OCR payloads. Lite users can download and extract `filens-preview-0.3.5-all-in-one.zip`, then run `filens preview report.pdf --assets /path/to/filens-preview-0.3.5-all-in-one --no-open`; `FILENS_PREVIEW_DIR` or a `preview/` directory beside the executable also works. Verify archive integrity, exact extracted files, embedded WASM and Full precompressed JS.
- Refresh both mobile source SDKs to **0.1.5**, carrying the same split runtime and archive sidecars. Chromium and WebKit mobile bridges pass **22 checks**; physical-device and precompiled AAR/XCFramework validation remain outside this release.
- Pass **856 unit checks**, **2,128 conversion-policy checks**, **328/328 real-WASM conversion jobs**, and Go wrapper tests. The installed preview package passes **64 real browser previews**, public TypeScript imports and production consumer bundling checks; standalone HTML passes **17 Chromium checks** with network access blocked.
- Verify macOS Full/Lite with an empty PATH, automatic local conversion resources, text reading, search, conversion and Full OCR. Confirm Lite has no bundled viewer and exports correctly with separately supplied preview assets. Verify three exported TXT/DWG HTML previews after the CLI exits, with the browser offline. Linux/Windows native execution is not repeated; their unchanged binaries/resources are checked against the prior published archives.
- Keep parsing and conversion in the frontend WASM/TypeScript core. Go remains a thin wrapper. Retain MIT and bundled third-party notices, including the CAD reader's MIT distribution notices.

[Release validation](https://github.com/IceWhaleTech/filens/blob/v0.6.5/docs/release-v0.6.5-validation.json) · [Native/offline checks](https://github.com/IceWhaleTech/filens/blob/v0.6.5/docs/release-v0.6.5-native-validation.json) · [Support matrix](https://github.com/IceWhaleTech/filens/blob/v0.6.5/docs/support-matrix.md) · [Full changelog](https://github.com/IceWhaleTech/filens/blob/v0.6.5/CHANGELOG.md)

## Use FiLens on ZimaOS

<p align="center"><a href="https://www.zimaspace.com/en/zimaos?utm_source=github&amp;utm_medium=referral&amp;utm_campaign=filens_zimaos&amp;utm_content=release_banner_en"><img src="https://raw.githubusercontent.com/IceWhaleTech/filens/v0.6.5/docs/assets/readme/zimaos-banner.en.png" alt="ZimaOS: a personal cloud with FiLens integration" width="640" /></a></p>

Bring local document previews to your personal cloud. Install FiLens from the official ZimaOS [Mod Store](https://github.com/IceWhaleTech/Mod-Store/tree/main/builtin/filens), without Node.js or npm:

```sh
sudo zpkg update
sudo zpkg install filens
```

Upgrade an existing installation with `sudo zpkg upgrade filens`. Download exported offline HTML to your computer to view it; ZimaOS does not launch a browser on the server. [Installation, preview export and OCR configuration](https://github.com/IceWhaleTech/filens/blob/v0.6.5/packaging/zimaos/README.md).

ZimaOS ModStore uses its own component versions: **0.5.1** (CLI **0.5.0**, preview **0.2.0**).
