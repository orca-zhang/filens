# 合并预览包压缩到 4 MB 以内

2026-11-04，合并版主 JS 的两种预压缩产物均达到目标，按 **1 MB = 1,000,000 字节**计算。

| 可部署产物 | 实际字节 | MB |
| --- | ---: | ---: |
| `all-in-one/filens.js.gz` | **3,983,554** | **3.984** |
| `all-in-one/filens.js.br` | **3,845,830** | **3.846** |
| `all-in-one/filens.js`，未进行 HTTP 压缩 | 7,234,076 | 7.234 |

同一构建中，封装前 JS 为 10,971,889 字节，普通 gzip 9 为 5,533,015 字节。封装后的普通 gzip 9 为 4,023,190 字节；使用构建生成的 Zopfli gzip 进一步减少 39,636 字节，最终比封装前 gzip 减少 **1,549,461 字节，约 28.0%**。Brotli 从 5,214,691 减少到 3,845,830 字节。

这里的 4 MB 指合并版主运行时，包含 Vue、CSS、文档、图片、HEIF、STEP、PDF/iWork Worker 等现有内容。RAR/7z/多卷 ZIP 等格式的外置归档引擎和 Worker 仍单独部署，另计 gzip 458,709 字节；连同它们的全部运行时为 gzip **4,442,263 字节**。许可文件、HTML、类型声明和同时包含两种构建的 npm 安装包另计。当前结果是本地源码构建，没有发布 npm。

## 实现和取舍

合并版将四个 WASM 引擎、Worker 数据、CSS 和较大的静态字符串合并压缩，共 52 项。共享 LZMA 字典能复用单独 gzip 无法跨引擎利用的重复数据。运行时使用内联的 20,283 字节 LZMA SDK WASM 解码器，检查解码状态、完整输入、输出长度和 CRC-32，再恢复字符串与 WASM Blob URL。

构建逐项校验恢复后的字符串、Worker Base64 和完整 WASM 字节；不删格式或改写转换算法。普通 JS 仍是 ESM，使用 Terser 的安全压缩选项，不需要 JavaScript `eval`、`Function`、顶层 await 或额外 JS 模块请求。ES2020 构建和不允许 JS `unsafe-eval` 的 CSP 已实测。解码器依赖的 ABI、来源、二进制哈希及许可放在 `packages/preview/vendor/lzma`，许可合并进随包通知。新增压缩工具均为根项目构建依赖，预览分发包保持零 npm 运行时依赖。

合并压缩带来初始化成本。localhost 的 Chromium 三次样本中，原 gzip 版本导入中位数为 188.9 ms，新 gzip 为 338.1 ms，新 Brotli 为 341.2 ms。这是本机样本，不能用于推断所有设备的加载耗时。此时会恢复约 13.55 MB 静态数据，不能把本次体积收益表述为首载 CPU 或内存优化；没有测量峰值内存。分包版保持按需加载，适合优先考虑初始化耗时的场景。

## 部署

部署构建生成的 `.gz`、`.br`，为对应的 `filens.js` 请求设置匹配的 `Content-Encoding: gzip` 或 `br`，以及 JavaScript 内容类型。nginx 可使用 `gzip_static on;`。普通服务器重新做 gzip 9 约为 4.023 MB，**需要使用随构建提供的 `.gz` 才符合 gzip 的 4 MB 目标**。也可使用 `.br`。

构建会检查两种压缩文件均不超过 4,000,000 字节，并输出哈希和编码信息；超过限制直接失败。`dist/preview/filens-all-in-one.js.gz` 和 `.br` 是相同产物的副本。

[最终交付核验](../benchmarks/frontend/2026-11-04/preview-4mb-delivery-verification.json)记录主 JS 和两种压缩文件的 SHA-256，并核对解压结果、交付副本和解码器许可完整性。

## 验证

- 52 项静态资源逐字节恢复，四个原 WASM 保留；解码器测试覆盖 Unicode、孤立代理项、Worker Base64、标签模板、属性名称、静态模块路径、缓存确定性，以及六种损坏输入/边界情况。
- 实际 HTTP gzip、Brotli 响应均能加载文本和 STEP，保持一个主 JS 请求；两种压缩文件解压后与发布 JS 完全一致，大小、哈希、CSP 和 ES2020 检查通过。
- 29 项真实 CLI HTTP 预览通过，含文档、PDF、iWork、设计、RAW、STEP、应用图标和加密 Office；同一会话的 28 种语言切换与实例消息覆盖通过。
- Chromium、Firefox、WebKit 共 51 项 HTML 检查通过。报告明确记录 WebKit 的 iWork `file:` Worker 限制及外置 RAR 引擎所需的本地 HTTP 兼容路径，不将这些案例算作离线直接渲染。
- split 与合并版均通过 WAV、MOV 边界及 HEIC 检查；三种 HEIC WASM 解码像素与独立参考一致。
- FBX、3DS、VRML 的六组新旧合并产物对照中，三角形数量和完整 RGBA 像素哈希一致；四组 XML 按需加载回归通过。
- 默认完整预览构建、转换策略和分类包边界检查通过。

[资源、体积和 SHA-256](../benchmarks/frontend/2026-11-04/preview-4mb-packing.json)；[实际 HTTP 编码、CSP 和导入耗时](../benchmarks/frontend/2026-11-04/preview-4mb-transport.json)；[解码边界检查](../benchmarks/frontend/2026-11-04/preview-4mb-codec-tests.json)；[29 项预览](../benchmarks/frontend/2026-11-04/preview-4mb-preview-validation.json)；[51 项 HTML](../benchmarks/frontend/2026-11-04/preview-4mb-html-validation.json)；[模型像素对照](../benchmarks/frontend/2026-11-04/preview-4mb-model-validation.json)；[XML 回归](../benchmarks/frontend/2026-11-04/preview-4mb-xml-validation.json)。

```sh
npm run build:preview
node scripts/test-packed-preview-assets.mjs
node scripts/test-packed-preview-transport.mjs
FILENS_PREVIEW_TEST_MODES=all-in-one node scripts/test-preview.mjs
FILENS_HTML_TEST_BROWSERS=chromium,firefox,webkit node scripts/test-preview-html.mjs
node scripts/test-media-preview.mjs
node scripts/test-model-loader-loading.mjs --variants all-in-one
node scripts/test-xml-loading.mjs
```
