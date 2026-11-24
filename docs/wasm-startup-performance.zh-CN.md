# 按引擎还原单文件 WASM

此前 all-in-one 把 4 份引擎 WASM 放在同一个 LZMA 组里。首次使用任一引擎时，浏览器会解压 9.39 MB 并创建 4 个 WASM Blob。本轮改为每份 WASM 单独成组，让 HEIF 和 STEP 只还原自己用到的文件。

WASM 加载器已经接受按需函数，因此运行时调用方式不变。压缩器仍按原有长度和 CRC-32 验证，每个资源 SHA-256 保持一致；没有改变解析或转换算法。

## 测量

比较相同当前源码、相同 53 个资源的 all-in-one 构建：只改变 WASM 分组。另以当前 split 构建作为入口选择参考。Node.js v20.20.2、Chromium 159.0.8154.6；每种格式、每种构建在新上下文中冷启动 7 次，按交替顺序运行，中位数如下。计时从模块导入开始，到首次 `onRendered`，包括第一次 Worker 启动；不代表屏幕绘制完成。

| 格式 | 共享 WASM 组 | 单文件分组后 | split 入口 |
| --- | ---: | ---: | ---: |
| 文本 | 123.2 ms | 124.1 ms | 26.1 ms |
| PDF | 178.2 ms | 178.8 ms | 94.7 ms |
| Pages | 266.1 ms | 264.3 ms | 173.2 ms |
| HEIF | 245.2 ms | **182.1 ms** | 60.3 ms |
| STEP | 247.6 ms | **167.2 ms** | 75.1 ms |

单文件 HEIF 减少 **63.1 ms（25.7%）**，STEP 减少 **80.4 ms（32.5%）**。文本、PDF 和 Pages 没有测出明显变化；导入阶段的波动约 1 ms。浏览器 Blob 计数确认文本、PDF、Pages 在首次打开时创建 0 个 WASM Blob；HEIF 从 4 个降为 2 个，STEP 从 4 个降为 1 个。

代价是 Brotli JS 从 **3,436,757 bytes** 增到 **3,574,169 bytes**（+137,412 bytes，约 4.0%）；Zopfli gzip 从 3,575,099 增到 **3,710,836 bytes**。仍低于 4,000,000 bytes 限制。对于单文件并且需要 HEIF 或 STEP 的场景，这个传输增量换来更短的首次引擎启动；对低带宽或只预览文本的页面，split 入口传输更少、启动更快。

分拆版对照值在本机服务器上 Brotli 压缩 JS/CSS，WASM 以原始字节发送。该对照用于展示按需加载形态，不代表 CDN 在所有环境下的具体编码和耗时。

## 精确资源与验证

当前单文件引擎分组，来自 `asset-packing.json` 的资源索引、解码字节及 LZMA 体积：

| 引擎 | 解码字节 | LZMA 组字节 |
| --- | ---: | ---: |
| combined converter core | 5,487,742 | 1,436,546 |
| image converter | 1,492,779 | 353,825 |
| libheif | 1,457,990 | 340,488 |
| STEP | 947,729 | 253,251 |

构建逐一校验资源。小型合成用例验证首次访问只还原对应 WASM 组、第二次访问复用 Blob URL、另一个 WASM 组继续保持惰性，并通过有效模块编译。损坏布局、截断输入和 CRC 错误共 24 个断言均被拒绝。

浏览器对照验证了单文件与 split 的文本、真实 PDF、Pages、HEIF、STEP。实际 gzip、Brotli 响应都能加载；在禁止 JS `eval` 的 CSP 下覆盖文本、PDF、STEP、HEIF、DNG；独立 `file:` HTML 断网覆盖文本、PDF、旧版 DOC、Pages、Numbers、Keynote、HEIF、DNG 和 STEP，没有 HTTP(S) 请求。STEP cube 的三角形数为 12。另有 24 个损坏压缩输入断言拒绝、53 份静态资源 SHA-256 一致及 sidecar 哈希核对。当前构建仍未发布到 CDN/npm。

当前分组后 JS SHA-256：`ae839d001b517f08540314c70d2f3454ad3848c2562703e7533724902e664cb4`。完整逐轮数据、模块请求数和构建哈希见[入口对照报告](preview-entry-benchmark.json)。[上一轮 Worker 延迟初始化](worker-startup-performance.zh-CN.md)。
