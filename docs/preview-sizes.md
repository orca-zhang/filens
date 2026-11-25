# Preview 0.3.8 runtime and package sizes

Source runtimes measured 2026-11-24; these include current checkout changes and can differ from the published package with the same base version. Runtime rows use **MB = 1,000,000 bytes**. All-in-one rows use the supplied Zopfli gzip and Brotli quality 11 files; other rows use gzip level 9 and Brotli quality 11. Serve the precompressed files with Content-Encoding to obtain these transfer sizes. Main runtimes include Vue, styles, workers and document/image/STEP WASM. Archive sidecars always stay external. Runtime rows exclude HTML, types, README and notices.

| Runtime | Raw MB | gzip MB | Brotli MB |
| --- | ---: | ---: | ---: |
| Split main runtime | 15.92 | 5.35 | 4.17 |
| All-in-one main JS (precompressed) | 6.89 | 3.69 | 3.56 |
| Optional archive WASM + worker (either build) | 1.17 | 0.46 | 0.36 |
| Split with archive assets | 17.09 | 5.81 | 4.53 |
| All-in-one with archive assets | 8.06 | 4.15 | 3.92 |

[Exact runtime bytes](preview-build-sizes.json).

## Measured npm pack artifact

| Package | Compressed download | Installed file bytes |
| --- | ---: | ---: |
| filens-preview 0.3.8 | 9.76 MiB | 25.50 MiB |

This local npm pack receipt does not establish registry publication. The npm package includes **both** complete runtime directories, archive assets, types, documentation and license notices. MiB = 1,048,576 bytes; excludes the npm cache and filesystem allocation overhead. [Exact package bytes and SHA-256](preview-package-sizes.json).

## Split-only npm pack artifact

| Package | Compressed download | Installed file bytes |
| --- | ---: | ---: |
| filens-preview-split 0.3.8 | 5.64 MiB | 17.03 MiB |

This package omits the all-in-one build. It is a local npm pack receipt; registry publication is recorded separately. [Exact package bytes and SHA-256](preview-split-package-sizes.json).

## Published mobile source SDKs 0.1.9

Each single ZIP retains all offline formats from preview 0.3.8 and stays below **3 MiB**.
These are source SDKs, rather than precompiled AAR/XCFramework files.

| SDK | ZIP transfer | Extracted file bytes before preparation |
| --- | ---: | ---: |
| iOS / Swift Package | 2.969 MiB | 3.083 MiB |
| Android / Java Library | 2.973 MiB | 3.082 MiB |

Run the included `node prepare-runtime.mjs` once on the developer computer before
integration (Node.js 18+ and C++17 compiler required). All data and decoder source
are bundled; preparation works offline. Prepared app assets total
**3.74 MiB** and stream as Brotli. Strong decompression never runs on
the phone. ZIP transfer size is distinct from prepared or installed application size.
Full required third-party notices are retained compressed.

Excludes build tools, build caches and filesystem allocation overhead.
[Exact SDK bytes and SHA-256](mobile-sdk-sizes.json) · [Integration](../sdk/README.md).

CLI measurements are recorded separately in [the npm artifact report](agent-cli-npm-release.json).

Refresh source runtime measurements: `npm run build:preview && npm run report:preview-sizes`. Package and SDK rows use the existing release receipts; measure new release archives separately when preparing a new version.
