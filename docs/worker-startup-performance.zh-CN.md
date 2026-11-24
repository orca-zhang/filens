# Worker 按需还原

2026-11-24，继续优化 all-in-one 的模块初始化。此前已将 WASM 延迟还原，但普通资源组仍包含 PDF、iWork、媒体 Worker，导入模块时会还原约 2.11 MB 的 Worker 代码并创建 Blob。

本轮让 Vite 的内联 Worker 在构造时才读取源代码、创建 Blob，保留原有 data URL 回退、Worker 参数和 URL 撤销行为。单文件 PDF Worker URL 改为首次打开时创建并缓存，普通 split URL 仍然可用。100,000 bytes 以上的非 WASM 资源各自压缩，其他字符串共享一个 LZMA 组，WASM 继续共享一组。当前共五组；启动所需普通资源由 **2,303,642 bytes 降为 193,520 bytes**。

没有增加网络请求、运行时依赖或 JS 代码求值器。打包器继续逐字节验证所有静态资源，浏览器保留长度、解码状态和 CRC-32 检查。改动仅涉及前端打包和加载，没有改变格式解析或转换算法。

## 同一批当前源码资源的对照

比较修改前保存的真实构建与修改后的真实构建，**53 个资源的类型、顺序、长度和 SHA-256 全部相同**。这两份构建含工作区已有的其他修改，与上一轮发布版固定输入的绝对耗时不能直接比较。

Node.js v20.20.2 / Chromium 159.0.8154.6。本机 localhost 提供实际 Brotli 文件，每个格式、版本、Base64 路径各七次冷启动，交替版本顺序，每次使用新的浏览器上下文；计时包括传输、HTTP 解压、JS 解析和模块初始化。每个格式单独从未导入模块开始。下表为原生 Base64 路径的中位数：

| 指标 | 修改前 | 修改后 |
| --- | ---: | ---: |
| 模块导入（文本用例） | 130.0 ms | **106.5 ms** |
| 导入至首次文本 onRendered | 143.0 ms | **119.8 ms** |
| 导入至首次 PDF onRendered | 185.4 ms | 184.3 ms |
| 导入至首次 Pages onRendered | 278.1 ms | 262.2 ms |
| 导入至首次 HEIF onRendered | 268.0 ms | 242.8 ms |
| Node 首次普通资源还原 | 18.60 ms | 1.43 ms |
| Node 全部资源还原合计 | 104.41 ms | 105.02 ms |
| 完整 JS Brotli | 3,427,643 bytes | 3,436,757 bytes |
| 完整 JS Zopfli gzip | 3,568,793 bytes | 3,575,099 bytes |

导入减少约 **18.1%**，首次文本减少约 **16.2%**。Brotli 增加 **9,114 bytes（0.27%）**，gzip 增加 6,306 bytes，均低于现有 4,000,000 bytes 限制。全部还原的工作量基本持平，优化主要来自按使用时机分配工作。

PDF 的模块导入也更快，但首次打开后的阶段由 55.9 ms 增至 78.7 ms；完整首次打开基本持平。PDF Worker 的还原成本被推迟，后续会复用 URL。Pages 和 HEIF 避免了其他未使用 Worker 的还原，因此完整首次预览也有收益。

强制禁用 `Uint8Array.fromBase64` 后，文本导入从 132.9 ms 降至 107.3 ms，首次文本从 145.9 ms 降至 120.4 ms。此路径在同一 Chromium 测量，不代表旧浏览器实机。`onRendered` 不表示屏幕已完成绘制；这些数据也不包含公网 CDN 延迟。

## 验证与限制

浏览器记录到：新构建导入和文本预览均不创建 Worker Blob；PDF、Pages、HEIF 各自只创建本格式的 Worker Blob。另行重复打开 PDF，确认继续渲染并复用 Worker URL。

资源测试覆盖分组延迟还原、重复访问缓存、Base64 兼容路径、精确字符串与 WASM 字节，以及每组截断、错误布局和 CRC 损坏拒绝。内联 Worker 测试覆盖无 Blob、Blob Worker 构造失败、data URL 回退、命名选项及正常/错误路径的 URL 清理。PDF 生命周期测试 21 项通过，覆盖普通字符串 URL 和延迟 URL。

当前 iWork 的 protobuf 回退本来就需要动态函数；修改前构建在禁止 JavaScript `unsafe-eval` 的 CSP 下同样失败，Worker 内容哈希没有改变。iWork 对照及在线验证单独使用允许该行为的脚本策略；其他格式保留禁止 JavaScript eval 的验证。此限制没有在本轮修改。

完整构建验证使用实际 gzip、Brotli HTTP 响应和独立 `file:` HTML 断网加载，覆盖文本、PDF、旧版 DOC、STEP、Pages、Numbers、Keynote、HEIF、DNG，并重复打开 PDF。STEP 验证 12 个三角形；离线 HTML 使用 Blob 模块，无 HTTP(S) 请求。

当前源码构建 SHA-256：`ace26750d226208b5425c610b8b303cbee25d3188c1de1e0e7407083e39fb9cd`。尚未发布到 CDN/npm，已有版本 URL 没有被覆盖。没有测 Safari、Firefox、全部格式、多地区公网和峰值内存。单文件仍下载全部资源；低带宽或只需少数格式时可继续使用 split 入口。

## 复现

修改前构建快照位于忽略目录 `tmp/lazy-workers/before/build/`，修改后位于 `tmp/lazy-workers/after/build/`；两者哈希、资源列表及全部采样写入报告。先准备本地 WASM 产物，然后在 `packages/preview/` 构建修改后的代码：

```sh
FILENS_PREVIEW_BUILD=all-in-one node ../../node_modules/vite/bin/vite.js build --outDir ../../tmp/lazy-workers/after/build
```

回到仓库根目录，依次运行以避免构建和验证 CPU 负载干扰计时：

```sh
node scripts/benchmark-worker-startup.mjs tmp/lazy-workers/before/build tmp/lazy-workers/after/build
npm run test:preview:assets
npm exec --workspace @filens/pdf -- vitest run test/preview-driver.spec.ts
node scripts/test-packed-preview-transport.mjs --directory tmp/lazy-workers/after/build
```

[完整采样及两版资源哈希](worker-startup-benchmark.json) · [构建及功能验证](worker-startup-validation.json) · [上一轮 WASM 延迟还原](grouped-startup-performance.zh-CN.md)。
