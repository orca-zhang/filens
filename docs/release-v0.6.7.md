# v0.6.7 — FiLens branding and repository update

Released 2026-11-13. CLI **0.5.7** · preview **0.3.7** · iOS/Android source SDKs **0.1.7** · DSH plugin and bundled workspace **0.1.10** · Vue wrapper **0.1.5**.

Preview watermarks and the DSH File workspace footer now display only **FiLens**. This includes fullscreen previews, hidden-toolbar views, standalone browser builds, exported offline HTML and mobile SDK runtimes. Repository, release, installation and source links use **orca-zhang/filens**.

CLI 0.5.7 is rebuilt for macOS arm64, Linux x64/arm64 and Windows x64 so exported HTML includes the updated GitHub link. Its npm launchers pin preview 0.3.7. Full offline bundles include that runtime; Lite can load it with `--assets` or `FILENS_PREVIEW_DIR`. Conversion engines, OCR libraries and models are retained byte-for-byte from verified v0.6.6 bundles.

预览区右下角水印和 DSH 文件工作台页脚统一仅显示 **FiLens**，移除 IceWhale / IceWhaleTech 署名。仓库与下载链接统一使用 **orca-zhang/filens**。完整离线包、移动端源码 SDK 与 DSH 内置工作台均已更新。

## Downloads

| File | Download size |
| --- | ---: |
| [filens-preview-0.3.7-split.zip](https://github.com/orca-zhang/filens/releases/download/v0.6.7/filens-preview-0.3.7-split.zip) | 5.62 MiB |
| [filens-preview-0.3.7-all-in-one.zip](https://github.com/orca-zhang/filens/releases/download/v0.6.7/filens-preview-0.3.7-all-in-one.zip) | 10.61 MiB |
| [filens-ios-sdk-0.1.7.zip](https://github.com/orca-zhang/filens/releases/download/v0.6.7/filens-ios-sdk-0.1.7.zip) | 5.64 MiB |
| [filens-android-sdk-0.1.7.zip](https://github.com/orca-zhang/filens/releases/download/v0.6.7/filens-android-sdk-0.1.7.zip) | 5.65 MiB |
| [filens-0.5.7-macos-arm64-lite.tar.gz](https://github.com/orca-zhang/filens/releases/download/v0.6.7/filens-0.5.7-macos-arm64-lite.tar.gz) | 7.17 MiB |
| [filens-0.5.7-macos-arm64-full.tar.gz](https://github.com/orca-zhang/filens/releases/download/v0.6.7/filens-0.5.7-macos-arm64-full.tar.gz) | 31.91 MiB |
| [filens-0.5.7-linux-x64-lite.tar.gz](https://github.com/orca-zhang/filens/releases/download/v0.6.7/filens-0.5.7-linux-x64-lite.tar.gz) | 7.01 MiB |
| [filens-0.5.7-linux-x64-full.tar.gz](https://github.com/orca-zhang/filens/releases/download/v0.6.7/filens-0.5.7-linux-x64-full.tar.gz) | 33.58 MiB |
| [filens-0.5.7-linux-arm64-lite.tar.gz](https://github.com/orca-zhang/filens/releases/download/v0.6.7/filens-0.5.7-linux-arm64-lite.tar.gz) | 6.90 MiB |
| [filens-0.5.7-linux-arm64-full.tar.gz](https://github.com/orca-zhang/filens/releases/download/v0.6.7/filens-0.5.7-linux-arm64-full.tar.gz) | 31.26 MiB |
| [filens-0.5.7-windows-x64-lite.zip](https://github.com/orca-zhang/filens/releases/download/v0.6.7/filens-0.5.7-windows-x64-lite.zip) | 6.96 MiB |
| [filens-0.5.7-windows-x64-full.zip](https://github.com/orca-zhang/filens/releases/download/v0.6.7/filens-0.5.7-windows-x64-full.zip) | 33.80 MiB |
| [dsh-filens-0.1.10.tgz](https://github.com/orca-zhang/filens/releases/download/v0.6.7/dsh-filens-0.1.10.tgz) | 5.81 MiB |

[SHA256SUMS](https://github.com/orca-zhang/filens/releases/download/v0.6.7/SHA256SUMS) · [Source and validation manifest](https://github.com/orca-zhang/filens/releases/download/v0.6.7/filens-release-v0.6.7.json).

## Installation

```sh
npm install -g filens-cli@0.5.7
# Or: npm install -g filens-cli-lite@0.5.7
npm install filens-preview@0.3.7
# Vue integration: npm install @filens/vue@0.1.5
dsh plugin --profile desktop add dsh-filens@0.1.10
```

DSH also accepts the downloadable `dsh-filens-0.1.10.tgz` through its plugin installer. The file workspace is included in the same package and keeps its independent switch. Mobile ZIPs contain source SDKs with offline resources, rather than precompiled AAR/XCFramework binaries.

## Validation

- 64 previews from an isolated preview-package installation, public TypeScript imports, media checks and 12 previews after production Vite bundling.
- 51 offline HTML cases across Chromium, Firefox and WebKit; 22 mobile runtime/bridge checks across Chromium and WebKit.
- 34 DSH Node tests, 16 isolated format-loading paths, 12 complete browser previews and 25 real Desktop 0.2.2-rc.1 workspace checks.
- Actual computed watermark text checked in normal, hidden-toolbar and fullscreen layouts for split, all-in-one and embedded DSH builds; the DSH workspace footer and GitHub link are also checked.
- Native macOS npm Full/Lite installations, OCR, reading, search, conversion, first-use preview setup and direct execution without Node/Python; archive integrity, privacy and size limits.

Linux/Windows executables are cross-built; native execution was not retested. Physical mobile devices were not retested. WebKit retains the documented iWork `file://` worker restriction, with local HTTP compatibility verified.

[Release checks](https://github.com/orca-zhang/filens/blob/v0.6.7/docs/release-v0.6.7-validation.json) · [Watermark checks](https://github.com/orca-zhang/filens/blob/v0.6.7/docs/release-v0.6.7-branding-validation.json) · [Native payload checks](https://github.com/orca-zhang/filens/blob/v0.6.7/docs/release-v0.6.7-native-validation.json) · [Support matrix](https://github.com/orca-zhang/filens/blob/v0.6.7/docs/support-matrix.md).
