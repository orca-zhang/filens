| Download | Link | Download size |
| --- | --- | ---: |
| CLI Lite: darwin-arm64 | [filens-0.5.6-macos-arm64-lite.tar.gz](https://github.com/IceWhaleTech/filens/releases/download/v0.6.6/filens-0.5.6-macos-arm64-lite.tar.gz) | 7.17 MiB (7,518,522 bytes) |
| CLI Full (OCR): darwin-arm64 | [filens-0.5.6-macos-arm64-full.tar.gz](https://github.com/IceWhaleTech/filens/releases/download/v0.6.6/filens-0.5.6-macos-arm64-full.tar.gz) | 31.91 MiB |
| CLI Lite: linux-arm64 | [filens-0.5.6-linux-arm64-lite.tar.gz](https://github.com/IceWhaleTech/filens/releases/download/v0.6.6/filens-0.5.6-linux-arm64-lite.tar.gz) | 6.90 MiB (7,237,877 bytes) |
| CLI Full (OCR): linux-arm64 | [filens-0.5.6-linux-arm64-full.tar.gz](https://github.com/IceWhaleTech/filens/releases/download/v0.6.6/filens-0.5.6-linux-arm64-full.tar.gz) | 31.26 MiB |
| CLI Lite: linux-x64 | [filens-0.5.6-linux-x64-lite.tar.gz](https://github.com/IceWhaleTech/filens/releases/download/v0.6.6/filens-0.5.6-linux-x64-lite.tar.gz) | 7.01 MiB (7,353,759 bytes) |
| CLI Full (OCR): linux-x64 | [filens-0.5.6-linux-x64-full.tar.gz](https://github.com/IceWhaleTech/filens/releases/download/v0.6.6/filens-0.5.6-linux-x64-full.tar.gz) | 33.58 MiB |
| CLI Lite: win32-x64 | [filens-0.5.6-windows-x64-lite.zip](https://github.com/IceWhaleTech/filens/releases/download/v0.6.6/filens-0.5.6-windows-x64-lite.zip) | 6.96 MiB (7,296,027 bytes) |
| CLI Full (OCR): win32-x64 | [filens-0.5.6-windows-x64-full.zip](https://github.com/IceWhaleTech/filens/releases/download/v0.6.6/filens-0.5.6-windows-x64-full.zip) | 33.80 MiB |
| Browser runtime: split | [filens-preview-0.3.6-split.zip](https://github.com/IceWhaleTech/filens/releases/download/v0.6.6/filens-preview-0.3.6-split.zip) | 5.62 MiB |
| Browser runtime: all-in-one | [filens-preview-0.3.6-all-in-one.zip](https://github.com/IceWhaleTech/filens/releases/download/v0.6.6/filens-preview-0.3.6-all-in-one.zip) | 10.61 MiB |
| iOS source SDK | [filens-ios-sdk-0.1.6.zip](https://github.com/IceWhaleTech/filens/releases/download/v0.6.6/filens-ios-sdk-0.1.6.zip) | 5.64 MiB |
| Android source SDK | [filens-android-sdk-0.1.6.zip](https://github.com/IceWhaleTech/filens/releases/download/v0.6.6/filens-android-sdk-0.1.6.zip) | 5.65 MiB |
| dsh-filens-workspace 0.1.1 | [dsh-filens-workspace-0.1.1.tgz](https://github.com/IceWhaleTech/filens/releases/download/v0.6.6/dsh-filens-workspace-0.1.1.tgz) | 0.03 MiB |
| dsh-filens 0.1.8 | [dsh-filens-0.1.8.tgz](https://github.com/IceWhaleTech/filens/releases/download/v0.6.6/dsh-filens-0.1.8.tgz) | 5.81 MiB |
| Checksums | [SHA256SUMS](https://github.com/IceWhaleTech/filens/releases/download/v0.6.6/SHA256SUMS) | SHA-256 |
| Build manifest | [filens-release-v0.6.6.json](https://github.com/IceWhaleTech/filens/releases/download/v0.6.6/filens-release-v0.6.6.json) | Versions, sizes and validation |

**14 package downloads + manifest + checksums (16 assets).** Full includes OCR runtime/models and preview 0.3.6. All Lite downloads remain **below 10,000,000 bytes** with reading, search and conversion retained; preview/OCR assets are optional. Mobile ZIPs are source SDKs, not precompiled AAR/XCFramework files. DSH has separate adapter and workspace downloads. MiB = 1,048,576 bytes.

## Changelog

Compared with [v0.6.5](https://github.com/IceWhaleTech/filens/releases/tag/v0.6.5). Components: **DSH 0.1.8**, **File workspace 0.1.1**, **preview 0.3.6**, **mobile source SDKs 0.1.6**, and **CLI/OCR 0.5.6**. Native CLI/OCR and WASM payloads are retained byte-for-byte from verified v0.6.5 archives; Full bundles refresh the preview assets. npm CLI 0.5.6 retains its preview 0.3.4 setup pin. The ZimaOS Mod Store package remains 0.5.1.

### File workspace for DeepSeek Harness

- Open a full-page workspace with its own plugin switch, alongside independent sidebar Preview and document Tools.
- Collect supported local references and attachments from paginated conversation history. Deduplicate files while retaining every source occurrence; return to the exact message or its originating question.
- Collapse sessions into cards with short titles and up to four representative previews. Office/PDF thumbnails use the real renderer; unavailable thumbnails have recognizable file-type covers.
- Find related files by shared message, question, folder or session, with an explanation for each recommendation and no model calls.
- Exclude paths and attachments only after DSH confirms they no longer exist. Refresh rechecks availability; opening removes stale cards, navigation and recommendations after deletion. Keep permission and connection failures visible.
- Hide lock, editor and system temporary artifacts by default, with a reveal button. Useful outputs in OS temporary directories remain visible; filtering does not delete files.
- Add a ZimaOS Photos-style details panel, actual file sizes, a 144–160px reader list and narrow-window layouts. Fix clipped zoom percentages, workspace activation and module naming.

![File workspace recorded in DSH Desktop](https://raw.githubusercontent.com/IceWhaleTech/filens/v0.6.6/docs/assets/dsh-release/file-workspace.en.gif)

Install both plugins, then reopen DSH Desktop:

```sh
dsh plugin --profile desktop add dsh-filens@0.1.8 dsh-filens-workspace@0.1.1
```

### Localized controls and real Desktop demos

- Localize panorama hints, playback controls, tooltips and accessible labels through all 28 existing language dictionaries. Changing language preserves the video and playback position.
- Preserve original video duration while progressive playback updates buffered segments.
- Record six Chinese/English demos separately in the installed DSH Desktop: Office, 3D/panoramas and File workspace. Office uses the matching 14-slide FiLens introduction PPTX; Chinese Word bodies, spreadsheet headings and sheet names are localized.
- Update both READMEs with measured package/runtime sizes and current format counts: **450 preview source extensions** (451 routes including internal `cad-json`) and **349 CLI extensions**. Registration counts are not a claim that every format was retested.

[English demos and release notes](https://github.com/IceWhaleTech/filens/blob/v0.6.6/docs/releases/dsh-filens-0.1.8/release-notes.en.md) · [中文演示与发布说明](https://github.com/IceWhaleTech/filens/blob/v0.6.6/docs/releases/dsh-filens-0.1.8/release-notes.zh-CN.md) · [Media and original recording provenance](https://github.com/IceWhaleTech/filens/blob/v0.6.6/docs/releases/dsh-filens-0.1.8/README.md)

The recordings use the pre-release workspace candidate and preserve its original metadata; they are not fresh performance benchmarks. Existing DSH speed comparisons retain their 0.1.3 measurement versions. Files stay in their original locations; deleted or inaccessible files cannot be previewed, and browser-selected files need reopening after reload.

### npm packages and offline bundles

- Publish `dsh-filens@0.1.8`, `dsh-filens-workspace@0.1.1` and `filens-preview@0.3.6`.
- Publish `@filens/core@0.1.4`, `@filens/vue@0.1.4`, `@filens/media@0.1.3` and `@filens/panorama@0.1.3`, with updated minimum dependency versions.
- Verify the workspace dependency publicly before publishing the main adapter; verify module dependencies before promoting their `latest` tags.
- Refresh browser archives, mobile source SDKs and Full native bundles with preview 0.3.6. Keep parsing and conversion in the shared frontend/WASM core.

Validation includes final packaged-runtime browser tests, offline HTML previews, Chromium/WebKit mobile bridges, desktop workspace regressions and public artifact integrity checks. Linux/Windows native execution and physical mobile-device tests were not repeated. See [release validation](https://github.com/IceWhaleTech/filens/blob/v0.6.6/docs/release-v0.6.6-validation.json) for exact scope.

## Use FiLens on ZimaOS

<p align="center"><a href="https://www.zimaspace.com/en/zimaos?utm_source=github&amp;utm_medium=referral&amp;utm_campaign=filens_zimaos&amp;utm_content=release_banner_en"><img src="https://raw.githubusercontent.com/IceWhaleTech/filens/v0.6.6/docs/assets/readme/zimaos-banner.en.png" alt="ZimaOS: a personal cloud with FiLens integration" width="640" /></a></p>

Install from the official ZimaOS Mod Store:

```sh
sudo zpkg update
sudo zpkg install filens
# For an existing installation:
sudo zpkg upgrade filens
```

[Official Mod Store entry](https://github.com/IceWhaleTech/Mod-Store/tree/main/builtin/filens) · [ZimaOS integration and OCR setup](https://github.com/IceWhaleTech/filens/tree/v0.6.6/packaging/zimaos)

The store package remains 0.5.1 (CLI 0.5.0 / preview 0.2.0); this release does not update the store entry.
