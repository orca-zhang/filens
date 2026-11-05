# Preview 0.3.5 runtime and package sizes

Source runtimes measured 2026-11-05; these include current checkout changes and can differ from the published package with the same base version. Runtime rows use **MB = 1,000,000 bytes**. All-in-one rows use the supplied Zopfli gzip and Brotli quality 11 files; other rows use gzip level 9 and Brotli quality 11. Serve the precompressed files with Content-Encoding to obtain these transfer sizes. Main runtimes include Vue, styles, workers and document/image/STEP WASM. Archive sidecars always stay external. Runtime rows exclude HTML, types, README and notices.

| Runtime | Raw MB | gzip MB | Brotli MB |
| --- | ---: | ---: | ---: |
| Split main runtime | 15.83 | 5.32 | 4.15 |
| All-in-one main JS (precompressed) | 6.66 | 3.53 | 3.40 |
| Optional archive WASM + worker (either build) | 1.17 | 0.46 | 0.36 |
| Split with archive assets | 17.00 | 5.78 | 4.51 |
| All-in-one with archive assets | 7.83 | 3.99 | 3.75 |

[Exact runtime bytes](preview-build-sizes.json).

## Measured npm pack artifact

| Package | Compressed download | Installed file bytes |
| --- | ---: | ---: |
| filens-preview 0.3.5 | 16.19 MiB | 31.79 MiB |

This local npm pack receipt does not establish registry publication. The npm package includes **both** complete runtime directories, archive assets, types, documentation and license notices. MiB = 1,048,576 bytes; excludes the npm cache and filesystem allocation overhead. [Exact package bytes and SHA-256](preview-package-sizes.json).

## Published mobile source SDKs 0.1.5

These release snapshots are measured separately from the current source build above. Each SDK includes the complete offline split runtime 0.3.5; these are source SDK ZIPs rather than precompiled AAR/XCFramework files.

| SDK | ZIP download | Extracted file bytes |
| --- | ---: | ---: |
| iOS / Swift Package | 5.63 MiB | 16.98 MiB |
| Android / Java Library | 5.64 MiB | 16.97 MiB |

Excludes build tools, build caches and filesystem allocation overhead. [Exact SDK bytes and SHA-256](mobile-sdk-sizes.json).

CLI measurements are recorded separately in [the npm artifact report](agent-cli-npm-release.json).

Refresh source runtime measurements: `npm run build:preview && npm run report:preview-sizes`. Package and SDK rows use the existing release receipts; measure new release archives separately when preparing a new version.
