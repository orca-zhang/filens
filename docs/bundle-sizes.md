# Bundle sizes / 分包体积

Generated from the production demo by `npm run report:bundle-sizes`. Units are KiB (1 KiB = 1024 bytes). JavaScript and its matching CSS are grouped; WASM and workers are separate.

| Module / core | Raw | gzip | Brotli |
| --- | ---: | ---: | ---: |
| Conversion core WASM (Office detection) | 969.1 KiB | 432.0 KiB | **347.3 KiB** |
| Office decryption WASM (optional) | 370.6 KiB | 160.3 KiB | **127.6 KiB** |
| Image / RAW WASM (deployed assets) | 2915.6 KiB | 940.3 KiB | **713.2 KiB** |
| DWG reader WASM (on demand) | 921.8 KiB | 449.2 KiB | **364.4 KiB** |
| Raster preview WASM (on demand) | 1748.0 KiB | 718.0 KiB | **538.0 KiB** |
| PostScript WASM (optional) | 2428.8 KiB | 745.4 KiB | **515.6 KiB** |
| HEIC / HEIF decoder WASM | 1423.8 KiB | 470.2 KiB | **344.5 KiB** |
| Demo entry | 249.5 KiB | 72.2 KiB | **60.2 KiB** |
| Agent CLI demo UI | 25.6 KiB | 9.8 KiB | **8.0 KiB** |
| Shared vendor dependencies | 854.2 KiB | 244.0 KiB | **204.0 KiB** |
| PPTX / core runtime | 386.8 KiB | 108.3 KiB | **91.7 KiB** |
| Vue preview host | 247.2 KiB | 66.0 KiB | **52.5 KiB** |
| DOCX / XLSX / PDF | 51.8 KiB | 16.1 KiB | **14.5 KiB** |
| On-demand DOCX engine | 74.6 KiB | 20.1 KiB | **18.1 KiB** |
| Office attachments | 31.5 KiB | 12.1 KiB | **11.0 KiB** |
| Shared XML compatibility | 29.9 KiB | 10.0 KiB | **9.0 KiB** |
| Shared ZIP compatibility | 43.1 KiB | 13.2 KiB | **11.9 KiB** |
| Encrypted ZIP support | 99.1 KiB | 37.0 KiB | **32.4 KiB** |
| On-demand PDF engine | 435.2 KiB | 128.1 KiB | **106.8 KiB** |
| iWork preview | 40.5 KiB | 12.1 KiB | **10.8 KiB** |
| CAD / mind maps / diagrams | 101.1 KiB | 28.6 KiB | **24.5 KiB** |
| 3D preview | 109.0 KiB | 31.7 KiB | **27.7 KiB** |
| glTF / GLB model loader | 42.7 KiB | 12.6 KiB | **11.2 KiB** |
| FBX model loader | 43.9 KiB | 14.1 KiB | **12.6 KiB** |
| OBJ model loader | 8.5 KiB | 2.9 KiB | **2.6 KiB** |
| MTL model loader | 4.2 KiB | 1.7 KiB | **1.5 KiB** |
| 3DS model loader | 8.4 KiB | 2.8 KiB | **2.5 KiB** |
| LDraw model loader | 24.0 KiB | 8.3 KiB | **7.3 KiB** |
| USDZ model loader | 8.5 KiB | 2.6 KiB | **2.4 KiB** |
| VRML model loader | 178.1 KiB | 46.4 KiB | **39.7 KiB** |
| Media / panorama preview | 465.1 KiB | 128.8 KiB | **108.3 KiB** |
| Media decoder loader | 108.2 KiB | 35.2 KiB | **31.3 KiB** |
| Archive preview | 48.1 KiB | 14.6 KiB | **13.1 KiB** |
| RAR / 7z extraction WASM (optional) | 1089.9 KiB | 429.8 KiB | **332.3 KiB** |
| Archive worker (optional) | 51.6 KiB | 18.2 KiB | **16.3 KiB** |
| Text / ebooks | 18.1 KiB | 6.9 KiB | **6.1 KiB** |
| iWork worker | 901.0 KiB | 188.5 KiB | **157.5 KiB** |
| PDF worker | 1053.3 KiB | 291.1 KiB | **233.1 KiB** |
| truck STEP WASM | 925.5 KiB | 326.4 KiB | **255.0 KiB** |
| truck STEP loader | 2.8 KiB | 1.4 KiB | **1.2 KiB** |

Initial entry, preload, and CSS: **1998.6 KiB raw / 566.6 KiB gzip / 476.1 KiB Brotli**. This excludes HTML, imagery, video, sample files, and later requests. Shared vendor dependencies are included here and must be considered when reading individual module sizes. PDF and iWork have separate workers.

[Exact byte counts and file names](assets/bundle-sizes.json). Compression measurements use the actual build's gzip and Brotli artifacts; server negotiation and caching determine real network transfer. This is a build snapshot, not the size of a published npm tarball.

## Reproduce / 复现

```sh
npm ci
npm run build:vercel
npm run report:bundle-sizes
```

The report updates this document and the document core size labels on the homepage. The normal NAS build can also be measured with `npm run build:wasm && npm run build:demo`; asset URLs may change the entry size slightly.

本报告对应实际演示站产物，单位为 KiB。JS 与各自 CSS 合并计量，WASM、Worker 和共享第三方依赖独立列出。单个分包体积不等于该格式的全部下载成本；完整首屏还包括 HTML、图片、视频、样例及按需请求。压缩列为构建产物体积，实际网络传输取决于托管配置。
