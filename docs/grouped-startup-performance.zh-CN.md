# 按使用时机还原单文件资源

2026-11-24，在 [Base64 / CRC 优化](packed-startup-performance.zh-CN.md)基础上，将单文件中的普通资源与 WASM 分成两个独立 LZMA 组。每组内继续共享字典，保留长度、SDK 状态及 CRC-32 校验。单文件仍包含所有内容，不增加请求，不使用 JavaScript eval，不引入依赖，也不改变后端转换逻辑。

单文件构建的 WASM 导入改为加载函数。共享 WASI 和 STEP 加载器本来就支持这种函数；HEIF 在创建 Worker 时解析这两个 WASM URL，再把字符串传给 Worker。文本和普通 PDF 不再还原未使用的 WASM。首次使用任一 WASM 时还原 WASM 组，后续复用 Blob URL 和现有模块缓存。

## 固定发布版输入对照

使用同一份 `filens-preview@0.3.7` 单文件 JS、相同的 52 个静态资源及应用代码。仅替换读取器、重组压缩数据，并将 WASM 绑定及媒体 URL 解析改成与新源码一致的延迟形式。源码输入 SHA-256 为 `fe841d1d8a8284fe322c226be507206afa2a23ecc65e7b67db44b58a64f6a0ad`。

| 指标 | 上一轮读取器 | 本轮分组 |
| --- | ---: | ---: |
| Chromium 原生 Base64，模块导入 | 277.7 ms | **157.5 ms** |
| Chromium 强制 Base64 兼容路径，模块导入 | 277.3 ms | **157.2 ms** |
| 原生路径，导入加首次文本预览 | 293.8 ms | **173.6 ms** |
| 完整 JS Brotli | 3,401,239 bytes | 3,401,455 bytes |
| Node，首次普通资源还原 | 125.3 ms | 36.0 ms |
| Node，普通资源及首次 WASM 还原合计 | 125.3 ms | 121.8 ms |

相比上一轮，原生路径导入中位数减少约 **43.3%**，导入加首次文本预览减少约 **40.9%**，传输增加 **216 bytes（约 0.0064%）**。这是本机 localhost 结果，不是公网加速承诺。分组后的第一次 WASM 还原在 Node 中单独约 85.5 ms；其工作从启动阶段推迟，未被消除。

普通资源组还原后为 2,272,118 bytes，WASM 组为 9,344,837 bytes。导入、文本和普通 PDF 阶段实际记录到零个 WASM Blob；打开 STEP 后才创建四个 WASM Blob。两种版本的 52 个资源逐一核对 SHA-256 一致，并验证文本、PDF、STEP 的 12 个三角形、销毁行为及禁止 JavaScript eval 的 CSP。

Node.js v20.20.2 / Chromium 159.0.8154.6。三种版本（原始发布版、上一轮读取器、本轮分组）按轮次交替顺序，各测 7 次，浏览器每次创建新上下文，Node 额外预热一轮。浏览器计时包括 localhost Brotli HTTP 传输、解压、解析及模块初始化。首次文本指标再加上 `createPreview()` 到 `onRendered` 的时间，未包含实际屏幕绘制完成时间。强制兼容路径在同一 Chromium 中禁用原生 Base64 API，并非旧浏览器实机。

## 当前源码构建

同时从当前有其他修改的工作区构建了真实 all-in-one 产物，输出到忽略目录 `tmp/lazy-packed/current-build/`，没有覆盖已发布文件。该构建包含 53 个资源，与上述固定输入不能直接作体积归因比较；打包器逐个验证了所有资源。实际发布侧文件为 Brotli **3,427,643 bytes**、Zopfli gzip **3,568,793 bytes**，都低于现有 4 MB 限制。构建保留同步 ESM、ES2020、内嵌资源和独立的可选归档引擎。

源码中的测试覆盖延迟还原、重复访问 URL 复用、每组损坏输入拒绝、字符串及 Worker 精确还原、WASM URL 加载失败时的 Worker 清理。当前构建的浏览器验证与固定发布版对照分别执行，避免把工作区其他修改算入本轮收益。

离线验证发现 `file:` 页面内的 HEIF Worker 无法读取由页面创建的 `blob:null/` WASM URL。已在页面中读取这些资源，再将独立字节缓冲区转移给 Worker；正常 HTTP 页面继续传 URL。校验包括读取失败、取消后迟到的读取结果，以及 Worker 和计时器清理。所有 HEIF 解码、颜色处理和 PNG 编码仍在原有前端 WASM 中执行。这项兼容性修复没有计入上面的固定输入分组对照。

真实构建分别通过 gzip、Brotli HTTP 加载与独立 `file:` HTML 断网加载，覆盖文本、PDF、旧版 DOC、STEP、HEIF 和 DNG；离线模块使用与 CLI 相同的 Blob 方式，没有 HTTP(S) 请求。转换客户端的相关测试为 51 项通过、1 项原有用例跳过。

## 复现

准备项目依赖、Playwright Chromium 和已发布的 SDK 后：

```sh
mkdir -p tmp/grouped-startup
npm pack filens-preview@0.3.7 --ignore-scripts --pack-destination tmp/grouped-startup
tar -xzf tmp/grouped-startup/filens-preview-0.3.7.tgz -C tmp/grouped-startup
npm run test:preview:assets
npm exec --workspace @filens/converter-client -- vitest run test/media-runtime.spec.ts
node scripts/benchmark-packed-startup.mjs --grouped tmp/grouped-startup/package/dist/all-in-one/filens.js
```

构建当前源码并验证实际传输文件（需先有项目 WASM 产物，在 `packages/preview/` 执行构建）：

```sh
FILENS_PREVIEW_BUILD=all-in-one node ../../node_modules/vite/bin/vite.js build --outDir ../../tmp/lazy-packed/current-build
```

回到仓库根目录：

```sh
node scripts/test-packed-preview-transport.mjs --directory tmp/lazy-packed/current-build
```

[完整对照采样、资源哈希](grouped-startup-benchmark.json) · [当前源码构建验证](grouped-startup-validation.json)。改动尚未发布到 CDN/npm；没有覆盖所有格式、Safari/Firefox、多地区网络或峰值内存。分组只推迟单文件内的解码，减少下载仍应使用现有 split 入口。
