# 复用已编译的资源解码器

all-in-one 的每个 LZMA 资源组都会创建独立的解码器实例和 WASM 内存。此前每个组还会重复把相同的 20,283-byte LZMA 解码器字节编译成 `WebAssembly.Module`。本轮让资源组共享一个延迟编译的 `WebAssembly.Module`，每组仍使用自己的实例和内存。

编译仍推迟到第一个资源组被读取时。资源组独立解码、长度/CRC 校验、错误处理和缓存保持原样；没有增加依赖或更改引擎资源。

## 结果

本机 Chromium 159，当前源码，7 次冷启动中位数，对比“独立资源组、每组重新编译”与共享已编译模块：

| 用例 | 每组编译 | 复用模块 |
| --- | ---: | ---: |
| 首次文本预览 | 119.7 ms | 123.0 ms |
| PDF | 179.0 ms | 179.5 ms |
| Pages | 254.7 ms | 260.4 ms |
| HEIF | 177.8 ms | 179.9 ms |
| STEP | 162.8 ms | 166.7 ms |

计时没有显示稳定的毫秒级收益，本机波动范围已覆盖这些差值。本轮确认的是重复编译被消除：模块导入时编译 1 次；打开 PDF、Pages、HEIF 或 STEP 后仍为 1 次。原实现对应次数分别为 2、2、4、2。HEIF 少编译 3 次；模块复用增加 **104 bytes Brotli**，新包为 **3,574,273 bytes**，仍低于 4 MB。

split 入口的同机参考值为文本 25.9 ms、PDF 78.9 ms、Pages 175.7 ms、HEIF 59.9 ms、STEP 75.0 ms。需要最低首屏耗时仍优先选择 split；本轮让单文件资源组减少重复编译。

## 验证

资源测试覆盖两个不同 WASM 组按需解码、URL 缓存、有效模块编译及损坏输入拒绝（24 个断言）。浏览器实测确认模块编译只发生一次，并验证文本、PDF、Pages、HEIF 和 STEP 首开。随后使用实际 gzip、Brotli 响应，禁止 JS `eval` 的 CSP，以及断网 `file:` HTML 验证文本、DOC、PDF、Pages、Numbers、Keynote、HEIF、DNG 和 STEP。

当前构建 SHA-256：`cd15f40418a2af625537eb54386044c7d4cdf354d008a2c569cb4efcd86e5202`。完整采样在[入口基准报告](preview-entry-benchmark.json)，功能和传输结果在[验证报告](decoder-startup-validation.json)。构建尚未发布到 CDN/npm。
