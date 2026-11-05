# 复用压缩编码器与 TIFF 按需解码

2026-11-04，本轮缩小生产 JS，并减少 PPTX 中多页 TIFF 的首图解码工作。没有新增运行时依赖，没有修改后端转换逻辑。

生产构建中，JSZip 的原始 DEFLATE 编码器改为通过小型适配器复用已有的 fflate。JSZip 自己的流、元数据和 CRC 处理保留；ZIP 和 TIFF 继续共用 Pako 的解压模块，以保留错误传播及 zlib/gzip 校验行为。Pako 依赖仍存在，但其压缩编码器不再进入生产产物。构建检查会拒绝重复编码器重新进入模块图。开发环境继续使用 Vite 默认预打包。

TIFF 预览此前会解码所有页面，再显示第一张可用图片。现在找到第一张尺寸和像素数据有效的页面就停止解码，保留后续页面的压缩数据。后续未显示页面的压缩内容损坏时，已解码的首图仍可预览；这不改变完整 TIFF 转换或文件验证的规则。

## 受控体积对比

两组构建使用相同的当前应用源码和同一组冻结的 WASM 字节，只切换压缩集成插件。统计 `filens.js` 递归静态导入的所有 JS，逐文件 gzip 级别 9、Brotli 默认质量 11 后求和。分包版不计按需引擎、Worker、独立 WASM；单文件版包含内联引擎和 WASM，独立 Worker 不计入首屏。

| 首屏静态 JS | 修改前（字节） | 修改后（字节） | 减少（字节） |
| --- | ---: | ---: | ---: |
| 分包版原始大小 | 2,236,203 | 2,217,529 | 18,674 |
| 分包版 gzip | 627,391 | 622,939 | **4,452** |
| 分包版 Brotli | 531,455 | 527,167 | 4,288 |
| 单文件版原始大小 | 11,515,108 | 11,493,926 | 21,182 |
| 单文件版 gzip | 4,960,795 | 4,955,401 | **5,394** |
| 单文件版 Brotli | 4,320,435 | 4,316,646 | 3,789 |

包含全部按需模块、Worker 和其他 JS/MJS 资源时，分包版 gzip 合计从 2,469,029 降至 2,464,682 字节，减少 4,347 字节；单文件版从 4,979,324 降至 4,973,930 字节，减少 5,394 字节。CSS、外置 WASM 和许可文件不在此统计范围内。

这组绝对体积包含工作区同期的其他功能，因此只将控制构建的差额归因于本轮优化。[完整大小、WASM 和压缩集成源码哈希](../benchmarks/frontend/2026-11-04/shared-compression-size-control.json)。基线插件对应 Git `66e01abbd36834ca20defc576ceb64d79efbd5b0` 的 `scripts/shared-compression.ts`。

## 性能与结果校验

环境：Apple M4 Pro、Node.js v20.20.2、Chromium 147.0.7727.15。预热 2 轮、测量 7 轮，交替运行新旧实现，取中位数。

| 用例 | 修改前 | 修改后 |
| --- | ---: | ---: |
| 浏览器：1 页 TIFF 生成首图 PNG URL | 3.7 ms | 3.4 ms |
| 浏览器：16 页 TIFF 生成首图 PNG URL | **30.5 ms** | **3.2 ms** |
| Node：读取 100 个 64 KiB ZIP 条目 | 13.02 ms | 12.88 ms |
| Node：单张 TIFF 解压 | 4.56 ms | 4.60 ms |
| Node：约 1 MiB 数据写入 ZIP | 11.19 ms | 11.31 ms |

多页 TIFF 用例的首图生成约快 **9.5 倍**。单页 TIFF、ZIP 兼容读取及写入基本持平，编码器复用的主要收益是体积。

浏览器计时覆盖 `MediaRegistry.getUrl()` 中的 TIFF 解码、RGBA 转换、canvas PNG 编码和 data URL 生成；不计模块加载、输入生成、输出读取、哈希和销毁。每页为 512×512 像素，新旧实现每轮都将生成的 PNG 重新解码，验证尺寸和完整像素 SHA-256，并检查 URL 缓存。Node 基准在计时外验证完整解压结果；ZIP 写入结果再交给原版 JSZip 解压并检查 CRC。以上结果不等于完整文档预览耗时，未测量峰值内存。

[TIFF 浏览器样本和构建哈希](../benchmarks/frontend/2026-11-04/tiff-preview.json)；[压缩兼容检查和吞吐对照](../benchmarks/frontend/2026-11-04/shared-compression.json)。

## 验证与复跑

core 声明构建、421 项核心测试通过，11 项外部样本用例跳过；5 项浏览器回归通过，覆盖 TIFF 完整像素、未显示页损坏、ZIP 读取和 PPTX 生命周期。生产压缩集成的 13 组检查通过，覆盖压缩级别、Unicode、二进制字符串、非零偏移切片、空条目、流式写入、暂停恢复、损坏 DEFLATE、CRC、TIFF 像素和 zlib/gzip 校验和错误。

demo、分包版、单文件版生产构建通过。两种独立产物在 Chromium 中实际打开 ZipCrypto/AES 加密 ZIP、DOCX OLE 附件及两类 TIFF PPTX，检查密码重试、返回文档、完整图片像素和销毁；分包版还检查可选读取器只在使用时各加载一次。[生产产物验证记录](../benchmarks/frontend/2026-11-04/shared-compression-production-smoke.json)。转换策略、分类包边界、脚本语法及 `git diff --check` 通过。

```sh
node scripts/test-shared-compression.mjs
npm run build:core
node scripts/benchmark-tiff-preview.mjs
FILENS_PREVIEW_BUILD=split npm exec --workspace filens-preview -- vite build
FILENS_PREVIEW_BUILD=all-in-one npm exec --workspace filens-preview -- vite build
npm run build:demo
node scripts/report-shared-compression-size.mjs
```

可通过 `--baseline` 做对照。TIFF 基线应在源码修改前构建并保存 core 的 dist；压缩测试和体积脚本接收旧版 `shared-compression.ts` 文件。当前报告所用基线插件可恢复如下：

```sh
mkdir -p tmp/shared-deflate-baseline
git show 66e01abbd36834ca20defc576ceb64d79efbd5b0:scripts/shared-compression.ts > tmp/shared-deflate-baseline/shared-compression.ts
node scripts/test-shared-compression.mjs --bench --baseline tmp/shared-deflate-baseline/shared-compression.ts
node scripts/report-shared-compression-size.mjs --baseline tmp/shared-deflate-baseline/shared-compression.ts
# 已保存修改前 core dist 时
node scripts/benchmark-tiff-preview.mjs --baseline tmp/shared-deflate-baseline/core-dist
```

体积脚本在内存中构建，不覆盖正常生产产物，并为对照冻结同一组 WASM 输入。各脚本自动清理临时打包目录。性能测量应避开同时运行的构建和测试。
