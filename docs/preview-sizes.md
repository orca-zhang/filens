# Preview 0.3.2 and mobile SDK sizes

Measured 2026-11-04. Runtime rows use **MB = 1,000,000 bytes**. gzip level 9 and Brotli quality 11 measure build artifacts; actual HTTP transfer depends on hosting. Main runtimes include Vue, styles, workers and document/image/STEP WASM. Archive sidecars always stay external. Runtime rows exclude HTML, types, README and notices.

| Runtime | Raw MB | gzip MB | Brotli MB |
| --- | ---: | ---: | ---: |
| Split main runtime | 10.56 | 3.34 | 2.67 |
| All-in-one main JS | 8.05 | 3.34 | 3.02 |
| Optional archive WASM + worker (either build) | 0.88 | 0.35 | 0.28 |
| Split with archive assets | 11.44 | 3.69 | 2.94 |
| All-in-one with archive assets | 8.94 | 3.69 | 3.30 |

[Exact runtime bytes](preview-build-sizes.json).

## npm package

| Package | Compressed download | Installed file bytes |
| --- | ---: | ---: |
| filens-preview 0.3.2 | 7.14 MiB | 20.40 MiB |

The npm package includes **both** complete runtime directories, archive assets, types, documentation and license notices. MiB = 1,048,576 bytes; excludes the npm cache and filesystem allocation overhead. [Exact package bytes and SHA-256](preview-package-sizes.json).

## Mobile source SDKs 0.1.2

Each SDK includes the complete offline split runtime 0.3.2; these are source SDK ZIPs rather than precompiled AAR/XCFramework files.

| SDK | ZIP download | Extracted file bytes |
| --- | ---: | ---: |
| iOS / Swift Package | 3.59 MiB | 11.43 MiB |
| Android / Java Library | 3.59 MiB | 11.43 MiB |

Excludes build tools, build caches and filesystem allocation overhead. [Exact SDK bytes and SHA-256](mobile-sdk-sizes.json).

CLI measurements are recorded separately in [the npm artifact report](agent-cli-npm-release.json).

Reproduce: `npm run build:preview`, `node scripts/package-preview-npm.mjs --no-build`, `npm run package:sdk:mobile`, then `npm run report:preview-sizes`.
