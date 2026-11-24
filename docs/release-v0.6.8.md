# v0.6.8 — Smaller previews and complete downloads

Released 2026-11-24. CLI **0.5.7** · browser preview **0.3.8** · iOS and Android source SDKs **0.1.8** · DSH plugin and bundled File workspace **0.1.10**.

This release includes the complete CLI Full/Lite downloads for macOS arm64, Linux x64/arm64 and Windows x64, plus the DSH plugin. CLI and DSH archives are carried forward byte-for-byte from v0.6.7 and retain preview **0.3.7**; the standalone browser runtime and mobile source SDKs use preview **0.3.8**.

Preview 0.3.8 fixes deferred HEIF resources in offline workers and emits declarations that work with NodeNext consumers. Startup work is reduced by grouping packed assets, sharing the compiled decoder, and creating workers and restoring WASM only when needed. The npm packages no longer include the optional precompressed all-in-one sidecars: `filens-preview@0.3.8` is **9.76 MiB** packed, down from **16.22 MiB** in 0.3.7. The split-only `filens-preview-split@0.3.8` package is **5.64 MiB**, 42% smaller than the dual-entry package. Both include the same split runtime; the split-only package omits the all-in-one build.

## Downloads

| Artifact | Download size |
| --- | ---: |
| [Browser runtime: split](https://github.com/orca-zhang/filens/releases/download/v0.6.8/filens-preview-0.3.8-split.zip) | 5.63 MiB |
| [Browser runtime: all-in-one](https://github.com/orca-zhang/filens/releases/download/v0.6.8/filens-preview-0.3.8-all-in-one.zip) | 4.13 MiB |
| [Optional precompressed sidecars](https://github.com/orca-zhang/filens/releases/download/v0.6.8/filens-preview-0.3.8-all-in-one-precompressed.zip) | 6.92 MiB |
| [iOS source SDK](https://github.com/orca-zhang/filens/releases/download/v0.6.8/filens-ios-sdk-0.1.8.zip) | 5.66 MiB |
| [Android source SDK](https://github.com/orca-zhang/filens/releases/download/v0.6.8/filens-android-sdk-0.1.8.zip) | 5.66 MiB |
| [filens-0.5.7-macos-arm64-lite.tar.gz](https://github.com/orca-zhang/filens/releases/download/v0.6.8/filens-0.5.7-macos-arm64-lite.tar.gz) | 7.17 MiB |
| [filens-0.5.7-macos-arm64-full.tar.gz](https://github.com/orca-zhang/filens/releases/download/v0.6.8/filens-0.5.7-macos-arm64-full.tar.gz) | 31.91 MiB |
| [filens-0.5.7-linux-x64-lite.tar.gz](https://github.com/orca-zhang/filens/releases/download/v0.6.8/filens-0.5.7-linux-x64-lite.tar.gz) | 7.01 MiB |
| [filens-0.5.7-linux-x64-full.tar.gz](https://github.com/orca-zhang/filens/releases/download/v0.6.8/filens-0.5.7-linux-x64-full.tar.gz) | 33.58 MiB |
| [filens-0.5.7-linux-arm64-lite.tar.gz](https://github.com/orca-zhang/filens/releases/download/v0.6.8/filens-0.5.7-linux-arm64-lite.tar.gz) | 6.90 MiB |
| [filens-0.5.7-linux-arm64-full.tar.gz](https://github.com/orca-zhang/filens/releases/download/v0.6.8/filens-0.5.7-linux-arm64-full.tar.gz) | 31.26 MiB |
| [filens-0.5.7-windows-x64-lite.zip](https://github.com/orca-zhang/filens/releases/download/v0.6.8/filens-0.5.7-windows-x64-lite.zip) | 6.96 MiB |
| [filens-0.5.7-windows-x64-full.zip](https://github.com/orca-zhang/filens/releases/download/v0.6.8/filens-0.5.7-windows-x64-full.zip) | 33.80 MiB |
| [dsh-filens-0.1.10.tgz](https://github.com/orca-zhang/filens/releases/download/v0.6.8/dsh-filens-0.1.10.tgz) | 5.81 MiB |
| [Checksums](https://github.com/orca-zhang/filens/releases/download/v0.6.8/SHA256SUMS) | SHA-256 |

Exact byte counts and hashes are in [the release size report](preview-release-sizes.json). These mobile SDK archives contain source projects and offline assets, not compiled AAR or XCFramework binaries.

## Install

```sh
# Agent CLI: Full includes OCR and offline preview; Lite adds them as needed
npm install -g filens-cli@0.5.7
# Or: npm install -g filens-cli-lite@0.5.7

# DeepSeek Harness: sidebar preview, document tools and File workspace
dsh plugin --profile desktop add dsh-filens@0.1.10

# Includes split and all-in-one entries
npm install filens-preview@0.3.8

# Split runtime only; smaller install for apps using lazy-loaded modules
npm install filens-preview-split@0.3.8
```

The CLI reads, searches, OCRs and converts local documents, and exports portable offline HTML previews. Extract the entire Full or Lite archive when installing without npm; Node.js is not required. DSH also accepts the downloadable `dsh-filens-0.1.10.tgz` through its plugin installer; File workspace is included in that same plugin.

For mainland China, use the npm mirror when the release is available there:

```sh
npm install filens-preview-split@0.3.8 --registry=https://registry.npmmirror.com
```

See the [English README](../README.md#browser-integration-single-file-or-split-modules), [简体中文 README](../README.zh-CN.md#浏览器集成单文件与按需分包) and [standalone integration guide](../packages/preview/README.md).

## Validation

- Built and packed both npm artifacts with Node.js **24.22.3**; isolated offline installs passed NodeNext declarations and license / notice checks.
- Chromium rendered PDF, iWork, RAW, STEP, HEIF and encrypted RAR previews from each installed npm entry after production Vite bundling. Browser tests blocked external requests.
- Chromium media checks passed for native WAV playback, HEIF reference pixels and explicit unsupported MOV codec behavior.
- The preview API passed a Node.js 24 / TypeScript 7.0.2 NodeNext check.
- The mobile browser bridge passed 22 Chromium and WebKit checks across text, CSV, HTML, DOCX, PDF, Pages, EPUB, video, APK and encrypted RAR.
- Release ZIP integrity, asset hashes and npm tarball privacy checks passed.
- All eight CLI archives and the DSH archive match the published v0.6.7 SHA-256 hashes; their contents and embedded preview versions are unchanged.

CLI binaries, CLI npm launchers and the DSH plugin were not rebuilt for this release. Their prior validation remains documented in [v0.6.7](release-v0.6.7.md#validation). Native Linux/Windows execution and physical iOS/Android device tests were not repeated.

## Use FiLens on ZimaOS

<p align="center"><a href="https://www.zimaspace.com/en/zimaos?utm_source=github&amp;utm_medium=referral&amp;utm_campaign=filens_zimaos&amp;utm_content=release_banner_en"><img src="https://raw.githubusercontent.com/orca-zhang/filens/v0.6.8/docs/assets/readme/zimaos-banner.en.png" alt="ZimaOS: a personal cloud with FiLens integration" width="640" /></a></p>

Bring local document previews to your personal cloud. Install FiLens from the official ZimaOS [Mod Store](https://github.com/IceWhaleTech/Mod-Store/tree/main/builtin/filens), without Node.js or npm:

```sh
sudo zpkg update
sudo zpkg install filens
# Upgrade an existing installation:
sudo zpkg upgrade filens
```

[ZimaOS integration, preview export and OCR setup](https://github.com/orca-zhang/filens/tree/main/packaging/zimaos). The ModStore package remains **0.5.1** and uses its own component versions; this release does not update the store entry.
