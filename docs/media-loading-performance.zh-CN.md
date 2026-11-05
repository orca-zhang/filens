# 可选读取器分包与媒体 URL 优化

2026-11-04，本轮调整前端构建及 core 媒体注册表，没有新增运行时依赖，公开接口及同步渲染方式保持不变。

加密 ZIP 和 OLE 附件读取器此前虽然使用动态导入，但应用构建的 vendor 规则仍将它们合并到首屏分包。现在 demo 和独立预览共用的规则将它们分别放入 `zip-encrypted`、`office-attachments` 分包；普通文件启动时不请求，首次使用时下载，同一页面内复用模块。单文件版继续内联所有引擎。

`MediaRegistry` 创建 Blob 时直接传入媒体切片，省去 Blob 快照前的一次完整复制；共享缓冲区保留复制路径。无 Blob URL 的环境优先使用原生 `Uint8Array.toBase64()`，Node 使用 Buffer 视图，旧浏览器采用有界分块转换。保留切片偏移、Blob 快照、MIME、URL 缓存及销毁行为。

## 首屏体积

在 Chromium 中导入独立 split 入口，统计实际请求的全部静态 JS，逐文件压缩后求和。排除按需引擎、Worker、WASM、输入文档和网络协议开销；gzip 使用级别 9，Brotli 使用默认质量 11。基线为本轮修改前保存的预览产物。

| 首屏静态 JS | 修改前 | 修改后 |
| --- | ---: | ---: |
| 原始字节 | 2,372,324 | 2,234,730 |
| gzip 字节 | 678,193 | 627,059 |
| Brotli 字节 | 574,244 | 531,077 |

首屏 gzip 减少 51,134 字节，约 **7.5%**。包含所有按需引擎和 Worker 的 split JS/MJS gzip 合计基本持平：1,492,532 → 1,491,607 字节。

历史产物对照期间工作区还有 WASM 资源变化，因此不把历史单文件版的体积差计为本轮收益。另用相同 WASM 资源进行控制构建，只切换本轮媒体注册表源码：单文件主 JS 原始字节为 8,937,588 → 8,937,803，gzip 为 3,993,942 → 3,994,015，基本持平。本轮体积收益主要体现为首屏传输减少。

[首屏请求、逐文件哈希及体积](../benchmarks/frontend/2026-11-04/optional-codecs-startup.json)；[相同 WASM 的单文件控制构建](../benchmarks/frontend/2026-11-04/media-single-size-control.json)包含引擎和源码哈希，基线源码可由其中的 Git 引用恢复。

## 媒体 URL 生成性能

环境：Apple M4 Pro、Node.js v20.20.2、Chromium 147.0.7727.15。使用修改前保存的 core 构建与最终构建，两个实现交替运行，预热 2 轮、测量 7 轮取中位数。每轮重新创建媒体注册表，输入包含非零偏移的二进制切片。

| 用例 | 修改前 | 修改后 |
| --- | ---: | ---: |
| 8 个 4 MiB 媒体生成 Blob URL | 10.4 ms | 9.2 ms |
| 4 个 1 MiB 媒体生成 Base64 URL，原生接口可用 | 48.9 ms | 0.6 ms |
| 同上，关闭原生 Base64 接口，验证兼容路径 | 59.5 ms | 12.1 ms |

Base64 两项均关闭 Blob URL 支持以触发备用路径；兼容路径是在 Chromium 中关闭原生方法的对照，不代表旧浏览器实测。计时只包括首次生成 URL，排除模块加载、输入生成、URL 读取、哈希和销毁。每轮逐个读取全部 URL，核对长度、MIME、缓存复用及完整字节 SHA-256。以上收益不等于完整文档预览提速；未测量峰值内存。

[各次样本、全部媒体哈希及构建哈希](../benchmarks/frontend/2026-11-04/media-registry.json)。

## 复跑

```sh
npm run build:core
node scripts/benchmark-media-registry.mjs
# 可选：与修改前保存的 core dist 比较
node scripts/benchmark-media-registry.mjs --baseline tmp/optional-codecs-baseline/core-dist

FILENS_PREVIEW_BUILD=split npm exec --workspace filens-preview -- vite build
FILENS_PREVIEW_BUILD=all-in-one npm exec --workspace filens-preview -- vite build
node scripts/report-preview-startup.mjs
# 可选：基线目录包含 split/ 和 all-in-one/
node scripts/report-preview-startup.mjs --baseline tmp/optional-codecs-baseline/preview-dist
```

基线应在修改源码前构建并复制保存。比较完整单文件版时，需要固定同一组 WASM 资源。性能测量时不要同时运行构建或测试；当前模式不需要基线，临时基准打包目录会自动清理。

## 验证

core 全部 420 项单元测试通过，11 项外部样本用例跳过；最后调整 Base64 后重新验证 115 项媒体/渲染测试通过，4 项外部样本跳过。新增 11 项媒体测试覆盖切片边界、所有字节值、空输入、共享缓冲区、输入修改后 Blob 快照、分块边界、Node 备用路径及 URL 缓存释放。

32 项浏览器回归通过，覆盖 Office/PDF/OLE 附件、ZipCrypto/AES、密码重试、嵌套压缩包及分卷、PPTX/iWork 生命周期。core 声明构建及 demo、split、all-in-one 生产构建通过。两种独立产物实际打开两类加密 ZIP 和 DOCX 中的 OLE 附件，验证密码重试、返回父文档及销毁；split 还验证启动不请求两个读取器分包，实际使用后各请求一次。转换策略、分类包边界及 `git diff --check` 通过。
