# Preview 0.3.3 and mobile SDK sizes

Measured 2026-11-04. Runtime rows use **MB = 1,000,000 bytes**. gzip level 9 and Brotli quality 11 measure build artifacts; actual HTTP transfer depends on hosting. Main runtimes include Vue, styles, workers and document/image/STEP WASM. Archive sidecars always stay external. Runtime rows exclude HTML, types, README and notices.

| Runtime | Raw MB | gzip MB | Brotli MB |
| --- | ---: | ---: | ---: |
| Split main runtime | 13.07 | 4.11 | 3.20 |
| All-in-one main JS | 8.91 | 3.97 | 3.66 |
| Optional archive WASM + worker (either build) | 0.88 | 0.35 | 0.28 |
| Split with archive assets | 13.95 | 4.46 | 3.47 |
| All-in-one with archive assets | 9.79 | 4.32 | 3.93 |

[Exact runtime bytes](preview-build-sizes.json).

## npm package

| Package | Compressed download | Installed file bytes |
| --- | ---: | ---: |
| filens-preview 0.3.3 | 8.50 MiB | 23.67 MiB |

The npm package includes **both** complete runtime directories, archive assets, types, documentation and license notices. MiB = 1,048,576 bytes; excludes the npm cache and filesystem allocation overhead. [Exact package bytes and SHA-256](preview-package-sizes.json).

## Mobile source SDKs 0.1.3

Each SDK includes the complete offline split runtime 0.3.3; these are source SDK ZIPs rather than precompiled AAR/XCFramework files.

| SDK | ZIP download | Extracted file bytes |
| --- | ---: | ---: |
| iOS / Swift Package | 4.33 MiB | 13.85 MiB |
| Android / Java Library | 4.33 MiB | 13.85 MiB |

Excludes build tools, build caches and filesystem allocation overhead. [Exact SDK bytes and SHA-256](mobile-sdk-sizes.json).

CLI measurements are recorded separately in [the npm artifact report](agent-cli-npm-release.json).

Reproduce: `npm run build:preview`, `node scripts/package-preview-npm.mjs --no-build`, `npm run package:sdk:mobile`, then `npm run report:preview-sizes`.
