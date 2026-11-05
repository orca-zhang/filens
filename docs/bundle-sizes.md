# Bundle sizes / 分包体积

Generated from the production demo by `npm run report:bundle-sizes`. Units are KiB (1 KiB = 1024 bytes). JavaScript and its matching CSS are grouped; WASM and workers are separate.

| Module / core | Raw | gzip | Brotli |
| --- | ---: | ---: | ---: |
| Conversion core WASM (Office detection) | 927.9 KiB | 414.3 KiB | **334.3 KiB** |
| Office decryption WASM (optional) | 370.6 KiB | 160.3 KiB | **127.4 KiB** |
| Image / RAW core WASM | 2915.6 KiB | 940.3 KiB | **713.2 KiB** |
| DWG reader WASM (on demand) | 886.8 KiB | 432.4 KiB | **351.8 KiB** |
| Raster preview WASM (on demand) | 1747.7 KiB | 717.4 KiB | **537.7 KiB** |
| PostScript WASM (optional) | 2429.4 KiB | 745.6 KiB | **516.0 KiB** |
| HEIC / HEIF decoder WASM | 1423.8 KiB | 470.2 KiB | **344.5 KiB** |
| Demo entry | 241.8 KiB | 69.5 KiB | **58.1 KiB** |
| Agent CLI demo UI | 34.9 KiB | 13.5 KiB | **11.1 KiB** |
| Shared vendor dependencies | 813.1 KiB | 229.7 KiB | **192.1 KiB** |
| PPTX / core runtime | 384.7 KiB | 108.0 KiB | **91.5 KiB** |
| Vue preview host | 213.8 KiB | 58.2 KiB | **46.5 KiB** |
| DOCX / XLSX / PDF | 51.7 KiB | 16.0 KiB | **14.4 KiB** |
| On-demand DOCX engine | 74.6 KiB | 20.1 KiB | **18.1 KiB** |
| Office attachments | 31.4 KiB | 12.1 KiB | **11.0 KiB** |
| Shared XML compatibility | 27.2 KiB | 8.9 KiB | **8.0 KiB** |
| Shared ZIP compatibility | 41.5 KiB | 12.7 KiB | **11.6 KiB** |
| Encrypted ZIP support | 99.1 KiB | 37.0 KiB | **32.3 KiB** |
| On-demand PDF engine | 435.2 KiB | 128.1 KiB | **106.9 KiB** |
| iWork preview | 40.5 KiB | 12.1 KiB | **10.8 KiB** |
| CAD / mind maps / diagrams | 100.6 KiB | 28.4 KiB | **24.4 KiB** |
| 3D preview | 109.0 KiB | 31.7 KiB | **27.7 KiB** |
| glTF / GLB model loader | 42.7 KiB | 12.6 KiB | **11.2 KiB** |
| FBX model loader | 43.9 KiB | 14.1 KiB | **12.6 KiB** |
| OBJ model loader | 8.5 KiB | 2.9 KiB | **2.6 KiB** |
| MTL model loader | 4.2 KiB | 1.7 KiB | **1.5 KiB** |
| 3DS model loader | 8.4 KiB | 2.8 KiB | **2.5 KiB** |
| LDraw model loader | 24.0 KiB | 8.3 KiB | **7.3 KiB** |
| USDZ model loader | 8.5 KiB | 2.6 KiB | **2.4 KiB** |
| VRML model loader | 178.0 KiB | 46.4 KiB | **39.7 KiB** |
| Media / panorama preview | 464.6 KiB | 128.7 KiB | **108.2 KiB** |
| Media decoder loader | 143.1 KiB | 52.5 KiB | **45.5 KiB** |
| Archive preview | 48.1 KiB | 14.6 KiB | **13.1 KiB** |
| RAR / 7z extraction WASM (optional) | 1089.9 KiB | 429.8 KiB | **332.3 KiB** |
| Archive worker (optional) | 51.5 KiB | 18.2 KiB | **16.3 KiB** |
| Text / ebooks | 18.1 KiB | 6.9 KiB | **6.1 KiB** |
| iWork worker | 884.9 KiB | 183.4 KiB | **153.3 KiB** |
| PDF worker | 1053.3 KiB | 291.1 KiB | **233.1 KiB** |
| truck STEP WASM | 925.5 KiB | 326.4 KiB | **255.0 KiB** |
| truck STEP loader | 2.8 KiB | 1.4 KiB | **1.2 KiB** |

Initial entry, preload, and CSS: **1945.7 KiB raw / 548.5 KiB gzip / 461.4 KiB Brotli**. This excludes HTML, imagery, video, sample files, and later requests. Shared vendor dependencies are included here and must be considered when reading individual module sizes. PDF and iWork have separate workers.

[Exact byte counts and file names](assets/bundle-sizes.json). Compression measurements use the actual build's gzip and Brotli artifacts; server negotiation and caching determine real network transfer. This is a build snapshot, not the size of a published npm tarball.

## Reproduce / 复现

```sh
npm ci
npm run build:vercel
npm run report:bundle-sizes
```

The report updates both README tables and the document core size labels in the READMEs and homepage. The normal NAS build can also be measured with `npm run build:wasm && npm run build:demo`; asset URLs may change the entry size slightly.

本报告对应实际演示站产物，单位为 KiB。JS 与各自 CSS 合并计量，WASM、Worker 和共享第三方依赖独立列出。单个分包体积不等于该格式的全部下载成本；完整首屏还包括 HTML、图片、视频、样例及按需请求。压缩列为构建产物体积，实际网络传输取决于托管配置。
