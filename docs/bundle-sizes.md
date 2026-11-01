# Bundle sizes / 分包体积

Generated from the production demo by `npm run report:bundle-sizes`. Units are KiB (1 KiB = 1024 bytes). JavaScript and its matching CSS are grouped; WASM and workers are separate.

| Module / core | Raw | gzip | Brotli |
| --- | ---: | ---: | ---: |
| Conversion core WASM (Office detection) | 894.8 KiB | 403.3 KiB | **327.6 KiB** |
| Office decryption WASM (optional) | 370.2 KiB | 160.1 KiB | **127.4 KiB** |
| Image / RAW core WASM | 1099.9 KiB | 298.4 KiB | **216.3 KiB** |
| HEIC / HEIF decoder WASM | 1429.2 KiB | 474.4 KiB | **347.4 KiB** |
| Demo entry | 213.2 KiB | 61.1 KiB | **51.3 KiB** |
| Agent CLI demo UI | 28.8 KiB | 11.4 KiB | **9.3 KiB** |
| Shared vendor dependencies | 1323.0 KiB | 370.4 KiB | **307.7 KiB** |
| PPTX / core runtime | 337.2 KiB | 93.1 KiB | **78.9 KiB** |
| Vue preview host | 162.0 KiB | 47.3 KiB | **37.7 KiB** |
| DOCX / XLSX / PDF | 42.8 KiB | 12.9 KiB | **11.6 KiB** |
| On-demand PDF engine | 435.2 KiB | 128.1 KiB | **106.9 KiB** |
| iWork preview | 35.4 KiB | 11.0 KiB | **9.8 KiB** |
| CAD / mind maps / diagrams | 92.1 KiB | 25.7 KiB | **22.0 KiB** |
| 3D preview | 132.9 KiB | 37.5 KiB | **32.6 KiB** |
| Media / panorama preview | 229.3 KiB | 67.2 KiB | **57.4 KiB** |
| Media decoder loader | 119.5 KiB | 42.8 KiB | **37.4 KiB** |
| Archive preview | 25.0 KiB | 8.0 KiB | **7.1 KiB** |
| Text / ebooks | 28.6 KiB | 9.7 KiB | **8.6 KiB** |
| iWork worker | 882.4 KiB | 182.6 KiB | **152.3 KiB** |
| PDF worker | 1053.3 KiB | 291.1 KiB | **233.1 KiB** |
| truck STEP WASM | 925.5 KiB | 326.4 KiB | **255.0 KiB** |
| truck STEP loader | 2.8 KiB | 1.4 KiB | **1.2 KiB** |

Initial entry, preload, and CSS: **2102.6 KiB raw / 591.8 KiB gzip / 495.3 KiB Brotli**. This excludes HTML, imagery, video, sample files, and later requests. Shared vendor dependencies are included here and must be considered when reading individual module sizes. PDF and iWork have separate workers.

[Exact byte counts and file names](assets/bundle-sizes.json). Compression measurements use the actual build's gzip and Brotli artifacts; server negotiation and caching determine real network transfer. This is a build snapshot, not the size of a published npm tarball.

## Reproduce / 复现

```sh
npm ci
npm run build:vercel
npm run report:bundle-sizes
```

The report updates both README tables and the document core size labels in the READMEs and homepage. The normal NAS build can also be measured with `npm run build:wasm && npm run build:demo`; asset URLs may change the entry size slightly.

本报告对应实际演示站产物，单位为 KiB。JS 与各自 CSS 合并计量，WASM、Worker 和共享第三方依赖独立列出。单个分包体积不等于该格式的全部下载成本；完整首屏还包括 HTML、图片、视频、样例及按需请求。压缩列为构建产物体积，实际网络传输取决于托管配置。
