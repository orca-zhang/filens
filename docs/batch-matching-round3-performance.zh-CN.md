# 批量匹配第三轮：BM25 查询计算复用

2026-11-04，接续[第二轮](batch-matching-round2-performance.zh-CN.md)，优化共享 Rust/WASM 搜索核心中的查询权重、文件名短语匹配和 ASCII 规范化。没有新增运行时依赖或后端解析逻辑。

## 实现与行为

改动位于 [search.rs](../wasm/converter-core-rust/src/text/search.rs)：

- 查询词已有稳定的字典顺序，文档频率改为按查询词位置累计，省去逐块更新频率 Map 时的字符串克隆和查表。IDF 与查询权重的乘积只计算一次，评分继续按原来的词顺序、浮点运算顺序求和。
- 同一文件的多个结果块复用文件名短语是否命中的结果。只缓存最近处理的文件，占常数额外空间；正文已命中短语、或被查询词筛选排除的块仍按原来的短路逻辑执行。
- ASCII 字符串的 NFKC 结果等于原字符串，直接使用 ASCII 小写转换。含非 ASCII 字符时保留原来的 NFKC 和逐字符小写规则，保留全角字符、组合字符、中文和数字编号的语义。

CLI 的原生搜索与 WASM 引用同一份检索源码，本次没有单独测量原生 CLI 性能。

## 性能

环境为 Apple M4 Pro、Node.js v20.20.2。通过项目现有前端 `InMemoryWasiHost` 执行生产 `converter-text.wasm` 的完整 `search-text` 操作：每次创建新实例，计时包括实例化、内存文件读取、JSON 解析、搜索、评分、序列化和结果写入。模块编译、host 初始化、样本构造、读取结果、断言和哈希在计时外。前后交替运行，预热 3 轮、测量 9 轮，取中位数。

| 用例 | 修改前 | 修改后 | 加速 |
| --- | ---: | ---: | ---: |
| 英文 BM25，32 文件 | 1.555 ms | 1.062 ms | 1.46 倍 |
| 英文 BM25，1,000 文件 | 29.60 ms | 14.61 ms | **2.03 倍** |
| BM25，64 个长文件，深层中英文目录，文件名命中短语 | 291.75 ms | 133.19 ms | **2.19 倍** |
| 同上，文件名不命中短语 | 290.03 ms | 133.06 ms | 2.18 倍 |
| 中文 BM25，64 文件 | 173.09 ms | 171.20 ms | 基本持平 |
| BM25，16 个查询词、64 文件 | 175.16 ms | 93.31 ms | 1.88 倍 |
| 文件名分词搜索，1 万文件 | 59.30 ms | 33.36 ms | 1.78 倍 |
| 字面精确搜索，1 万文件，对照 | 16.60 ms | 16.30 ms | 基本持平 |

英文正文包含分散的 `budget` 和 `approval`，让多个结果块需要检查文件名短语；长路径用例包含重复的中英文目录段，并分别覆盖文件名短语命中和不命中。中文用例保留完整 Unicode 规范化路径。表中收益对应三项优化的组合，没有把整体加速归因于某一项。

这衡量完整 WASM 搜索操作，不包含文件提取、浏览器界面、磁盘扫描、OCR 推理和 CLI 启动；不能直接作为完整目录搜索的加速倍数。查询预计算需要随查询词数增长的临时向量，原有 8 MiB 特征缓存上限保持不变。本轮未测峰值内存。

## 体积

前后均重新构建生产文本模块：Rust 1.93.0，`text-extraction,postscript`，`wasm32-wasip1` release，使用现有 `privateRustBuildEnv`。Binaryen 131.0.0 参数为 `-Oz --strip-debug --strip-producers --enable-bulk-memory --enable-nontrapping-float-to-int`。

| converter-text.wasm | 修改前 | 修改后 | 变化 |
| --- | ---: | ---: | ---: |
| 原始字节 | 8,513,670 | 8,513,892 | +222 |
| gzip，级别 9 | 3,181,208 | 3,182,520 | **+1,312** |
| Brotli，质量 11 | 2,291,397 | 2,292,987 | +1,590 |

gzip 增加约 0.041%，换取上述批量英文查询收益；本轮主要收益是耗时。未修改运行时 JavaScript。原始、gzip、Brotli 是各自独立统计，压缩后的变化不必与原始字节变化同向或等量。

所有产物均核对非空、`WebAssembly.validate` 和 SHA-256。工作区同期增加了独立的格式检测构建目标；另外在隔离副本中使用更新后的 manifest 重建优化前搜索源码，产物与最初基线逐字节相同。该对照记录为测量 JSON 的 `baselineControl`，避免把同期改动计成本轮收益。

## 验证

- 9 项共享搜索源码测试通过，包含新增的全部 128 个 ASCII 字符及 Unicode 兼容规范化对照；特征缓存测试同时覆盖 0、128 字节和默认预算，包含同文件多个块、正文短语命中和文件名短语命中。
- 26 组本轮生产 WASM 完整响应对照通过。覆盖中文、组合字符、全角数字、数字编号筛选、空语料、非法查询、评分与排序、来源位置、OCR 来源记录、归档信息、5 种结果格式，以及 6,400 块的特征缓存超限场景。除耗时字段外逐字段一致，评分使用严格数值比较。
- 24 组上一轮完整操作对照再次通过，包括精确搜索边界、65,537 个文件、Office 媒体排序、重复幻灯片位置、DOCX 引用、图片选择和错误映射。
- 5 组生产 WASM OCR 响应对照通过；本轮合计 **55 组完整响应对照**。所有性能轮次也检查结果哈希。
- 转换架构边界检查 2,122 项通过。

完整文本测试入口曾因磁盘空间不足中断，未计为通过。新增的[轻量测试入口](../wasm/converter-core-rust/examples/search_matching.rs)直接包含同一份搜索和停用词源码，运行本次修改相关的全部 9 项搜索测试，减少无关文档解析器的链接开销；没有复制检索实现。构建产物和失败测试缓存的清理没有改动业务源码。

## 记录与复跑

[测量记录](../benchmarks/frontend/2026-11-04/batch-matching-round3.json)包含逐次计时、输入/完整结果哈希、源码/产物哈希、构建参数和隔离基线核对。[基线源码归档](../benchmarks/frontend/2026-11-04/batch-matching-round3-source-baseline.json.gz)的 `files` 字段保存修改前的搜索源码；重建时在单独 checkout 恢复该文件，保持其余构建输入一致。

本地保留了 `tmp/batch-matching-round3/before.wasm`、`after.wasm` 和 `control-before.wasm`：

```sh
node --no-warnings scripts/benchmark-batch-matching-round3.mjs \
  --baseline tmp/batch-matching-round3/before.wasm \
  --wasm tmp/batch-matching-round3/after.wasm \
  --control-baseline tmp/batch-matching-round3/control-before.wasm \
  --source-baseline benchmarks/frontend/2026-11-04/batch-matching-round3-source-baseline.json.gz \
  --output tmp/batch-matching-round3/replay.json
```

`--control-baseline` 可省略；提供时会要求该产物与基线的 SHA-256 一致。添加 `--checks-only` 可跳过计时和压缩体积计算，只核对完整结果。重跑共享源码测试时沿用项目的 Rust 环境设置，避免改变依赖缓存的编译参数：

```sh
node --input-type=module <<'JS'
import { run } from './scripts/agent-rust-build.mjs';
import { privateRustBuildEnv } from './scripts/agent-release-privacy.mjs';
await run('cargo', ['+1.93.0', 'test', '--locked',
  '--manifest-path', 'wasm/converter-core-rust/Cargo.toml',
  '--features', 'text-extraction,postscript', '--example', 'search_matching'], {
  env: { ...privateRustBuildEnv(process.cwd()), CARGO_INCREMENTAL: '0' }
});
JS
```

后续的紧凑查询特征、分词分配优化及内存取舍，见[第四轮报告](batch-matching-round4-performance.zh-CN.md)。
