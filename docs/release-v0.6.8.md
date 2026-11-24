# v0.6.8 — Browser preview runtime update

Released 2026-11-24. Browser preview **0.3.8** · iOS and Android source SDKs **0.1.8**. CLI remains **0.5.7** and DSH remains **0.1.10**; those packages retain the preview runtime they currently pin.

Preview 0.3.8 fixes deferred HEIF resources in offline workers and emits declarations that work with NodeNext consumers. Startup work is reduced by grouping packed assets, sharing the compiled decoder, and creating workers and restoring WASM only when needed. The npm packages no longer include the optional precompressed all-in-one sidecars: `filens-preview@0.3.8` is **9.76 MiB** packed, down from **16.22 MiB** in 0.3.7. The split-only `filens-preview-split@0.3.8` package is **5.64 MiB**, 42% smaller than the dual-entry package. Both include the same split runtime; the split-only package omits the all-in-one build.

## Downloads

| Artifact | Download size |
| --- | ---: |
| [Browser runtime: split](https://github.com/orca-zhang/filens/releases/download/v0.6.8/filens-preview-0.3.8-split.zip) | 5.63 MiB |
| [Browser runtime: all-in-one](https://github.com/orca-zhang/filens/releases/download/v0.6.8/filens-preview-0.3.8-all-in-one.zip) | 4.13 MiB |
| [Optional precompressed sidecars](https://github.com/orca-zhang/filens/releases/download/v0.6.8/filens-preview-0.3.8-all-in-one-precompressed.zip) | 6.92 MiB |
| [iOS source SDK](https://github.com/orca-zhang/filens/releases/download/v0.6.8/filens-ios-sdk-0.1.8.zip) | 5.66 MiB |
| [Android source SDK](https://github.com/orca-zhang/filens/releases/download/v0.6.8/filens-android-sdk-0.1.8.zip) | 5.66 MiB |
| [Checksums](https://github.com/orca-zhang/filens/releases/download/v0.6.8/SHA256SUMS) | SHA-256 |

Exact byte counts and hashes are in [the release size report](preview-release-sizes.json). These mobile SDK archives contain source projects and offline assets, not compiled AAR or XCFramework binaries.

## Install

```sh
# Includes split and all-in-one entries
npm install filens-preview@0.3.8

# Split runtime only; smaller install for apps using lazy-loaded modules
npm install filens-preview-split@0.3.8
```

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

This release updates the browser runtime and mobile source SDKs. It does not rebuild the CLI binaries, CLI npm launchers or DSH package. Native iOS and Android device testing was not performed.
