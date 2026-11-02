# Bundle sizes / 分包体积

Generated from the production demo by `npm run report:bundle-sizes`. Units are KiB (1 KiB = 1024 bytes). JavaScript and its matching CSS are grouped; WASM and workers are separate.

| Module / core | Raw | gzip | Brotli |
| --- | ---: | ---: | ---: |
| Conversion core WASM (Office detection) | 894.8 KiB | 403.3 KiB | **327.6 KiB** |
| Office decryption WASM (optional) | 370.2 KiB | 160.1 KiB | **127.4 KiB** |
| Image / RAW core WASM | 1099.9 KiB | 298.4 KiB | **216.3 KiB** |
| HEIC / HEIF decoder WASM | 1429.2 KiB | 474.4 KiB | **347.4 KiB** |
| Demo entry | 213.6 KiB | 61.3 KiB | **51.6 KiB** |
| Agent CLI demo UI | 28.8 KiB | 11.4 KiB | **9.3 KiB** |
| Shared vendor dependencies | 1407.1 KiB | 406.1 KiB | **339.8 KiB** |
| PPTX / core runtime | 353.8 KiB | 98.8 KiB | **83.6 KiB** |
| Vue preview host | 173.6 KiB | 49.2 KiB | **38.9 KiB** |
| DOCX / XLSX / PDF | 43.7 KiB | 13.2 KiB | **11.8 KiB** |
| On-demand PDF engine | 435.2 KiB | 128.1 KiB | **106.9 KiB** |
| iWork preview | 36.6 KiB | 11.2 KiB | **10.0 KiB** |
| CAD / mind maps / diagrams | 92.1 KiB | 25.7 KiB | **22.0 KiB** |
| 3D preview | 132.8 KiB | 37.5 KiB | **32.6 KiB** |
| Media / panorama preview | 230.0 KiB | 67.1 KiB | **57.3 KiB** |
| Media decoder loader | 125.6 KiB | 46.1 KiB | **40.1 KiB** |
| Archive preview | 32.2 KiB | 10.4 KiB | **9.2 KiB** |
| RAR / 7z extraction WASM (optional) | 810.2 KiB | 322.5 KiB | **253.4 KiB** |
| Archive worker (optional) | 51.2 KiB | 18.1 KiB | **16.2 KiB** |
| Text / ebooks | 29.8 KiB | 9.9 KiB | **8.8 KiB** |
| iWork worker | 883.5 KiB | 183.0 KiB | **152.7 KiB** |
| PDF worker | 1053.3 KiB | 291.1 KiB | **233.1 KiB** |
| truck STEP WASM | 925.5 KiB | 326.4 KiB | **255.0 KiB** |
| truck STEP loader | 2.8 KiB | 1.4 KiB | **1.2 KiB** |

Initial entry, preload, and CSS: **2204.5 KiB raw / 633.2 KiB gzip / 532.2 KiB Brotli**. This excludes HTML, imagery, video, sample files, and later requests. Shared vendor dependencies are included here and must be considered when reading individual module sizes. PDF and iWork have separate workers.

[Exact byte counts and file names](assets/bundle-sizes.json). Compression measurements use the actual build's gzip and Brotli artifacts; server negotiation and caching determine real network transfer. This is a build snapshot, not the size of a published npm tarball.

## Reproduce / 复现

```sh
npm ci
npm run build:vercel
npm run report:bundle-sizes
```

The report updates both README tables and the document core size labels in the READMEs and homepage. The normal NAS build can also be measured with `npm run build:wasm && npm run build:demo`; asset URLs may change the entry size slightly.

本报告对应实际演示站产物，单位为 KiB。JS 与各自 CSS 合并计量，WASM、Worker 和共享第三方依赖独立列出。单个分包体积不等于该格式的全部下载成本；完整首屏还包括 HTML、图片、视频、样例及按需请求。压缩列为构建产物体积，实际网络传输取决于托管配置。
