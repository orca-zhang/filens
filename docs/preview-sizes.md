# Preview 0.3.4 and mobile SDK sizes

Measured 2026-11-05. Runtime rows use **MB = 1,000,000 bytes**. All-in-one rows use the supplied Zopfli gzip and Brotli quality 11 files; other rows use gzip level 9 and Brotli quality 11. Serve the precompressed files with Content-Encoding to obtain these transfer sizes. Main runtimes include Vue, styles, workers and document/image/STEP WASM. Archive sidecars always stay external. Runtime rows exclude HTML, types, README and notices.

| Runtime | Raw MB | gzip MB | Brotli MB |
| --- | ---: | ---: | ---: |
| Split main runtime | 18.10 | 6.11 | 4.73 |
| All-in-one main JS (precompressed) | 7.26 | 3.99 | 3.85 |
| Optional archive WASM + worker (either build) | 1.17 | 0.46 | 0.36 |
| Split with archive assets | 19.27 | 6.57 | 5.09 |
| All-in-one with archive assets | 8.43 | 4.45 | 4.21 |

[Exact runtime bytes](preview-build-sizes.json).

## npm package

| Package | Compressed download | Installed file bytes |
| --- | ---: | ---: |
| filens-preview 0.3.4 | 18.26 MiB | 35.40 MiB |

The npm package includes **both** complete runtime directories, archive assets, types, documentation and license notices. MiB = 1,048,576 bytes; excludes the npm cache and filesystem allocation overhead. [Exact package bytes and SHA-256](preview-package-sizes.json).

## Mobile source SDKs 0.1.4

Each SDK includes the complete offline split runtime 0.3.4; these are source SDK ZIPs rather than precompiled AAR/XCFramework files.

| SDK | ZIP download | Extracted file bytes |
| --- | ---: | ---: |
| iOS / Swift Package | 6.38 MiB | 19.14 MiB |
| Android / Java Library | 6.39 MiB | 19.14 MiB |

Excludes build tools, build caches and filesystem allocation overhead. [Exact SDK bytes and SHA-256](mobile-sdk-sizes.json).

CLI measurements are recorded separately in [the npm artifact report](agent-cli-npm-release.json).

Reproduce: `npm run build:preview`, `node scripts/package-preview-npm.mjs --no-build`, `npm run package:sdk:mobile`, then `npm run report:preview-sizes`.
