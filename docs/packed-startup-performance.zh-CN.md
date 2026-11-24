# 单文件资源还原的启动优化

2026-11-24，对同一份已发布的 `filens-preview@0.3.7` 单文件 JS 替换资源读取器，压缩数据、52 个资源、应用代码、WASM 解码器和公开 API 保持相同。原始 JS SHA-256 为 `fe841d1d8a8284fe322c226be507206afa2a23ecc65e7b67db44b58a64f6a0ad`。

源码中的 Base64 兼容路径改为直接填充字节数组，避免字符串迭代器及逐字符回调。CRC-32 使用 slicing-by-8，每轮校验 8 字节，以显式小端读取保证不依赖主机字节序。完整输入、输出长度、SDK 状态和 CRC 校验均保留。

| 指标 | 发布版读取器 | 优化读取器 |
| --- | ---: | ---: |
| Chromium 原生 Base64，模块导入 | 268.8 ms | 262.9 ms |
| Chromium 强制 Base64 兼容路径，模块导入 | 342.8 ms | 268.5 ms |
| Node 20，首次资源还原 | 218.6 ms | 117.8 ms |
| 完整 JS 的 Brotli 体积 | 3,401,548 bytes | 3,401,239 bytes |

Chromium 原生路径本次改善约 2.2%，兼容路径约 21.7%；原生路径的差异较小，不据此承诺公网性能。Node 20 没有原生 `Uint8Array.fromBase64`，改善约 46.1%，该结果不能直接代表现代浏览器。JS 源码增加 433 bytes，本次 Brotli 结果减少 309 bytes，传输体积基本不变；CRC 表额外使用约 7 KiB 临时内存，没有测峰值内存。

Node.js v20.20.2 / Chromium 159.0.8154.6。两种版本按轮次交替先后顺序，各测 7 次；Node 额外预热一轮。浏览器每次使用新上下文，通过 localhost 加载完整 Brotli JS，计时包括 HTTP 传输、Brotli 解压、JS 解析及资源还原，不包括文件预览渲染或公网延迟。强制兼容路径是在同一 Chromium 中禁用原生 Base64 API，不是旧版浏览器实机测试。

每个版本的 52 个资源均在计时外逐一计算 SHA-256 并比较。浏览器两种 Base64 路径都验证了文本、真实 PDF、STEP 立方体的 12 个三角形和销毁行为，并使用不允许 JavaScript eval 的 CSP。另有随机二进制长度边界、zlib 独立 CRC 参考、已知 CRC 向量、损坏校验拒绝，以及原有字符串、Worker、WASM、语法和缓存确定性测试。

二进制外置方案也做了体积估算：将原始资源整体使用 Brotli 压缩，再加去除资源内嵌的应用代码，合计约 3.482 MB，比当前版大约 2.4%，尚未实现其网络加载器或测量启动时间。现有 split 已按格式加载资源，本轮没有新增另一套 HTTP 构建模式。

改动位于共享前端资源读取器，打包时会自动嵌入；没有引入新依赖或后端转换逻辑。这里只生成忽略目录 `tmp/packed-startup/` 下的对照产物，未覆盖 CDN/npm 的不可变 `0.3.7` 文件，也未发布新包。现有 all-in-one 的同步 ESM、ES2020 构建及离线入口保留。

复现时先准备已发布 SDK（需要项目 Node 依赖和 Playwright Chromium）：

```sh
mkdir -p tmp/packed-startup
npm pack filens-preview@0.3.7 --ignore-scripts --pack-destination tmp/packed-startup
tar -xzf tmp/packed-startup/filens-preview-0.3.7.tgz -C tmp/packed-startup
npm run test:preview:assets
node scripts/benchmark-packed-startup.mjs tmp/packed-startup/package/dist/all-in-one/filens.js
```

[完整采样及资源哈希](packed-startup-benchmark.json)。未覆盖所有支持格式、Safari/Firefox 或多地区网络；后续正式包构建与发布需要走原有发布流程。
