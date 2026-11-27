# Preview 0.3.8 runtime and package sizes

Source runtimes measured 2026-11-27; these include current checkout changes and can differ from the published package with the same base version. Runtime rows use **MB = 1,000,000 bytes**. All-in-one rows use the supplied Zopfli gzip and Brotli quality 11 files; other rows use gzip level 9 and Brotli quality 11. Serve the precompressed files with Content-Encoding to obtain these transfer sizes. Main runtimes include Vue, styles, workers and document/image/STEP WASM. The archive worker and WASM and the XLSX regex WASM load on demand. Runtime rows exclude HTML, types, README and notices.

| Runtime | Raw MB | gzip MB | Brotli MB |
| --- | ---: | ---: | ---: |
| Split main runtime | 16.53 | 5.69 | 4.47 |
| All-in-one main JS (precompressed) | 7.44 | 3.97 | 3.81 |
| Optional archive WASM + worker (either build) | 1.17 | 0.46 | 0.36 |
| On-demand XLSX regex WASM (either build) | 0.28 | 0.08 | 0.07 |
| Split with on-demand assets | 17.98 | 6.23 | 4.90 |
| All-in-one with on-demand assets | 8.90 | 4.51 | 4.23 |

[Exact runtime bytes](preview-build-sizes.json).

## Measured npm pack artifact

| Package | Compressed download | Installed file bytes |
| --- | ---: | ---: |
| filens-preview 0.3.8 | 9.76 MiB | 25.50 MiB |

This local npm pack receipt does not establish registry publication. The npm package includes **both** complete runtime directories, on-demand assets, types, documentation and license notices. MiB = 1,048,576 bytes; excludes the npm cache and filesystem allocation overhead. [Exact package bytes and SHA-256](preview-package-sizes.json).

## Split-only npm pack artifact

| Package | Compressed download | Installed file bytes |
| --- | ---: | ---: |
| filens-preview-split 0.3.8 | 5.64 MiB | 17.03 MiB |

This package omits the all-in-one build. It is a local npm pack receipt; registry publication is recorded separately. [Exact package bytes and SHA-256](preview-split-package-sizes.json).

## Published mobile source SDKs 0.1.9

These release snapshots are measured separately from the current source build above. Each SDK includes the complete offline split runtime 0.3.8; these are source SDK ZIPs rather than precompiled AAR/XCFramework files.

| SDK | ZIP download | Extracted file bytes |
| --- | ---: | ---: |
| iOS / Swift Package | 2.97 MiB | 3.08 MiB |
| Android / Java Library | 2.97 MiB | 3.08 MiB |

Excludes build tools, build caches and filesystem allocation overhead. [Exact SDK bytes and SHA-256](mobile-sdk-sizes.json).

CLI measurements are recorded separately in [the npm artifact report](agent-cli-npm-release.json).

Refresh source runtime measurements: `npm run build:preview && npm run report:preview-sizes`. Package and SDK rows use the existing release receipts; measure new release archives separately when preparing a new version.
