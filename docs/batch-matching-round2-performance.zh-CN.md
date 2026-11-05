# 批量匹配第二轮优化

2026-11-04，在[第一轮路径、路由与 OCR 索引优化](batch-matching-performance.zh-CN.md)基础上，继续消除 Office 媒体清单和精确搜索中的重复扫描。所有改动仍在共享 Rust/WASM 核心，没有新增依赖。

## 实现与行为

[媒体清单](../wasm/converter-core-rust/src/text/inspect.rs)：将演示文稿中的幻灯片路径建立为位置 Map，每个 XML 部件查询一次，避免每个图片引用都扫描幻灯片列表。重复路径仍取首次出现的位置。包路径前缀只创建一次；媒体排序键按媒体缓存一次，避免在比较过程中反复扫描引用、克隆文件名。先按文件名排序，再按最早引用页稳定排序，保留原来的 `(最早页码, 文件名)` 顺序。页码选择利用现有有序集合做二分查询，不再逐项扫描，也不额外创建 HashSet。

[精确搜索](../wasm/converter-core-rust/src/text/search.rs)：记录当前文件处理前的结果块数，判断正文是否命中时只比较新增数量，替代对之前所有文件结果块的扫描。精确模式跳过不会参与评分的查询、文件名分词。字面匹配、仅命中文件名的兜底、原始字节位置、评分和 65,536 块截断行为保持一致。BM25 和文件名分词模式保留原来的计算路径。CLI 的原生搜索也引用同一份 Rust 源码，本次没有单独测量原生 CLI 性能。

这里沿用 Common path matcher 的“一次建立索引、批量复用”思路；完整幻灯片路径使用 Map，精确搜索使用当前文件的结果边界，均不需要路径 trie。

## 性能

环境：Apple M4 Pro、Node.js v20.20.2。使用生产 `converter-text.wasm` 和项目现有的前端 `InMemoryWasiHost`，在 Node 中执行完整 WASM 操作。每次创建新实例，计时包含实例化、内存文件读取、JSON/ZIP/XML 解析、提取或搜索、结果序列化和内存文件写入；模块编译、host 初始化、样本生成、读取结果、断言、哈希在计时外。前后交替运行，预热 3 轮，测量 9 轮，取中位数。

| 用例 | 修改前 | 修改后 | 加速 |
| --- | ---: | ---: | ---: |
| 精确搜索，32 个文件名命中 | 0.653 ms | 0.525 ms | 1.24 倍 |
| 精确搜索，1 万个文件名命中 | 64.93 ms | 15.40 ms | **4.22 倍** |
| 精确搜索，1 万个文件均未命中 | 41.42 ms | 12.67 ms | 3.27 倍 |
| 精确搜索，5,000 文件，正文和文件名混合命中 | 26.06 ms | 8.86 ms | 2.94 倍 |
| BM25，1,000 文件，对照 | 29.53 ms | 29.20 ms | 基本持平 |
| 媒体清单，8 页、16 个引用 | 1.354 ms | 1.210 ms | 1.12 倍 |
| 媒体清单，1,000 页、16,000 个引用、1,024 张图 | 348.83 ms | 262.55 ms | **1.33 倍** |

媒体样本使用倒序幻灯片、共享的 1×1 PNG，并执行完整正文提取及清单生成，关闭 OCR 推理；这不是单独查询 Map 的微基准。搜索样本中，1 万文件用例使用中文目录名，未命中用例的收益主要来自省去文件名分词。混合用例有 12,500 个正文或文件名结果块。所有计时轮次也校验完整结果哈希。

这些数字不包含浏览器界面、网络、磁盘读写、CLI 启动和 OCR 模型推理，不能直接当作用户打开整份真实文件或搜索目录的加速倍数。新增幻灯片 Map 和排序缓存需要随幻灯片数、媒体数增长的临时内存；本轮未测峰值内存。

## 体积

本轮重新编译优化前后生产 WASM，构建参数一致：Rust 1.93.0、`text-extraction,postscript`、`wasm32-wasip1` release、`privateRustBuildEnv` 路径映射，Binaryen 131.0.0 使用 `-Oz --strip-debug --strip-producers --enable-bulk-memory --enable-nontrapping-float-to-int`。

| converter-text.wasm | 修改前 | 修改后 | 变化 |
| --- | ---: | ---: | ---: |
| 原始字节 | 8,514,247 | 8,513,670 | −577 |
| gzip，级别 9 | 3,181,362 | 3,181,208 | **−154** |
| Brotli，质量 11 | 2,293,067 | 2,291,397 | −1,670 |

前后均核对非空、`WebAssembly.validate` 和 SHA-256。本轮未修改运行时 JavaScript，体积收益仅对应文本 WASM；没有据此推算完整网页或 CLI 包大小。

## 验证

- 46 项 Rust 文本模块测试通过，包括新增的逐文件兜底回归，以及 65,537 个仅文件名命中的上限测试。
- 24 组生产 WASM 对照通过，除耗时字段外完整响应逐字段一致。覆盖 Unicode、大小写和停用词的字面匹配、空输入、正文和文件名混合命中、截断、BM25 评分与来源/布局；也覆盖媒体顺序、重复幻灯片取首次位置、共享图片、DOCX 无页码引用、图片导出选择/上限和非法参数。
- 另外 5 组既有生产 WASM OCR 响应对照通过，正文、置信度、来源和布局保持一致。
- 转换架构边界检查 2,122 项通过。

原生 release 测试曾因磁盘不足失败，之后使用现有 debug 构建缓存完整跑过同一文本测试集。最初采用 Node 内置 WASI host 时，基线在大文件数输入上出现进程崩溃；Node 20 和另行验证的 Node 22 均复现，未定位根因。这些失败运行没有计入通过结果或性能数据。最终全部大批量 WASM 对照和测量使用项目的前端内存 host，在 Node 20 下正常完成；未使用的 WASI 目录接口只提供抛错入口，确保没有静默绕过实际调用。

## 记录与复跑

- [逐次样本、构建参数、源码及产物哈希、结果哈希](../benchmarks/frontend/2026-11-04/batch-matching-round2.json)
- [优化前两份源码归档](../benchmarks/frontend/2026-11-04/batch-matching-round2-source-baseline.json.gz)，JSON 的 `files` 字段为文件路径到源码的映射。
- [对照脚本](../scripts/benchmark-batch-matching-round2.mjs)

本地已保留 `tmp/batch-matching-round2/before.wasm` 和 `after.wasm`。独立重建基线时，在单独 checkout 中恢复源码归档里的两份文件，再使用上述相同构建参数；不要覆盖正在工作的源码。已有本地产物时：

```sh
node --no-warnings scripts/benchmark-batch-matching-round2.mjs \
  --baseline tmp/batch-matching-round2/before.wasm \
  --wasm tmp/batch-matching-round2/after.wasm \
  --source-baseline benchmarks/frontend/2026-11-04/batch-matching-round2-source-baseline.json.gz \
  --output tmp/batch-matching-round2/replay.json
```

只检查完整结果一致性可添加 `--checks-only`，跳过计时和压缩体积计算。压缩体积计算在所有计时开始前完成。

后续的 BM25 查询权重复用、文件名匹配缓存和 ASCII 规范化优化，见[第三轮报告](batch-matching-round3-performance.zh-CN.md)。
