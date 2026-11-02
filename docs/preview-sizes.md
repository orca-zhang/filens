# Preview 0.3.0 and mobile SDK sizes

Measured 2026-11-02. Runtime rows use **MB = 1,000,000 bytes**. gzip level 9 and Brotli quality 11 measure build artifacts; actual HTTP transfer depends on hosting. Main runtimes include Vue, styles, workers and document/image/STEP WASM. Archive sidecars always stay external. Runtime rows exclude HTML, types, README and notices.

| Runtime | Raw MB | gzip MB | Brotli MB |
| --- | ---: | ---: | ---: |
| Split main runtime | 11.23 | 3.26 | 2.57 |
| All-in-one main JS | 8.85 | 3.26 | 2.90 |
| Optional archive WASM + worker (either build) | 0.88 | 0.35 | 0.28 |
| Split with archive assets | 12.11 | 3.61 | 2.85 |
| All-in-one with archive assets | 9.73 | 3.60 | 3.18 |

[Exact runtime bytes](preview-build-sizes.json).

## npm package

| Package | Compressed download | Installed file bytes |
| --- | ---: | ---: |
| filens-preview 0.3.0 | 6.98 MiB | 21.72 MiB |

The npm package includes **both** complete runtime directories, archive assets, types, documentation and license notices. MiB = 1,048,576 bytes; excludes the npm cache and filesystem allocation overhead. [Exact package bytes and SHA-256](preview-package-sizes.json).

## Mobile source SDKs 0.1.0

Each SDK includes the complete offline split runtime 0.3.0; these are source SDK ZIPs rather than precompiled AAR/XCFramework files.

| SDK | ZIP download | Extracted file bytes |
| --- | ---: | ---: |
| iOS / Swift Package | 3.51 MiB | 12.02 MiB |
| Android / Java Library | 3.51 MiB | 12.02 MiB |

Excludes build tools, build caches and filesystem allocation overhead. [Exact SDK bytes and SHA-256](mobile-sdk-sizes.json).

CLI 0.5.0 and ZimaOS 0.5.1 retain their previous release measurements; this preview/SDK release does not rebuild those components.

Reproduce: `npm run build:preview`, `npm run report:preview-sizes`, `node scripts/package-preview-npm.mjs --no-build`, `npm run package:sdk:mobile`, then `npm run report:preview-sizes`.
