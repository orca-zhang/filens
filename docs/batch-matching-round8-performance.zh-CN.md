# 批量匹配第八轮：借用分词切片并复用正文规范化

2026-11-04，接续[第七轮](batch-matching-round7-performance.zh-CN.md)，继续优化共享 Rust/WASM 核心的分词热路径。实现位于 [search.rs](../wasm/converter-core-rust/src/text/search.rs)，未增加运行时依赖。

SIMD 已在[第九轮](batch-matching-round9-performance.zh-CN.md)落地；本页保留第八轮的实现与测量记录。

## 实现与语义

原分词器先生成规范化字符串，再把每个字符追加到当前单词缓冲区；中文双字词还会清空另一个缓冲区并重新写入两个字符。这两类词本来都对应规范化文本中的连续片段，重复复制与缓冲区分配可以省去。

新实现遍历规范化文本的 UTF-8 字符起点，记录单词起点和上一个相邻中文字符的起点。单词、中文单字和双字词都直接借用文本切片交给原有回调，不再逐字符拼接临时单词或双字词字符串。遇到任意非中文字符都会断开中文双字词；单词仍沿用字母、数字、点、连字符和下划线的原有边界规则。

NFKC 与小写转换仍先完成，切片针对规范化后的 UTF-8 字符边界。原始正文的分块与摘录字节偏移没有变化。停用词、首尾标点修剪、复合词拆分、数字编号、中文单字与双字词权重、词的发射顺序均保留。

正文、查询和文件名继续使用同一份分词规则；查询与名称词频表仍在需要保存新词时复制键字符串。本轮省去分词中的两个临时拼接缓冲区，并未消除规范化字符串、特征列表、词频表等全部分配。

BM25 正文的短语判断复用分词时的规范化字符串，只保留每块是否包含完整查询的布尔值。评分不再为短语判断单独规范化正文，也不缓存整块字符串。短语标记独立于查询词频，保留单字符子串可以获得短语分、数字查询仍需词级精确命中等原有规则；拒绝条件、文件名短语缓存和短语加分仍在原位置执行。

短语标记每个 BM25 块占 1 字节，受 65,536 块上限约束，最多增加 64 KiB；文件名模式和字面精确模式不分配此列表。8 MiB 查询特征预算不变，超预算时仍重新分词。文件名词频封顶、浮点评分顺序与排名逻辑均未改动。

## 测量方法

Apple M4 Pro、Node.js v20.20.2，通过前端真实的 `InMemoryWasiHost` 执行生产 `converter-text.wasm`，每次操作使用新实例。计时包含实例创建、内存文件读取、JSON 解析、检索评分、序列化与结果写入；编译、host 初始化、输入生成、输出读取、断言和哈希在计时外。预热 3 轮、测量 9 轮，前后交替，取中位数；所有计时轮次均验证完整响应哈希。小语料另行预热 20 轮、测量 51 轮，核对相同 WASM、输入与完整响应哈希。

线性内存为完整操作后 `memory.buffer.byteLength`，单位 MiB。WASM 内存只增长、不缩小，此值反映其增长高水位，不代表存活堆对象、物理驻留内存或 Node 进程 RSS。不包含浏览器界面、目录扫描、文件提取、磁盘读写、OCR 推理和 CLI 启动耗时。

## 性能

| 用例 | 修改前 | 修改后 | 耗时变化 |
| --- | ---: | ---: | ---: |
| 英文 BM25，32 文件（九轮） | 1.270 ms | 1.011 ms | 见追加采样 |
| 英文 BM25，1,000 文件 | 13.685 ms | 13.161 ms | −3.8% |
| 64 个长文件，深层路径，文件名短语命中 | 106.730 ms | 101.222 ms | −5.2% |
| 同上，文件名短语不命中 | 105.517 ms | 101.702 ms | −3.6% |
| 中文 BM25，64 文件 | 115.135 ms | 99.205 ms | −13.8% |
| 16 查询词、64 文件 | 83.352 ms | 80.367 ms | −3.6% |
| 文件名搜索，1 万英文名称 | 35.240 ms | 36.230 ms | +2.8% |
| 文件名搜索，1 万中文深层路径 | 435.835 ms | 436.327 ms | +0.1% |
| BM25，1 万深层路径，正文为空 | 21.247 ms | 21.067 ms | −0.8% |
| 字面精确搜索，1 万文件 | 15.960 ms | 15.989 ms | +0.2% |
| 16 查询词、6,400 块，缓存超限 | 204.906 ms | 199.336 ms | −2.7% |
| 64 查询词、10,240 块，缓存超限 | 363.584 ms | 351.509 ms | −3.3% |
| 128 查询词、仅两词命中 | 26.144 ms | 24.796 ms | −5.2% |
| 字面精确搜索，5 万乱序深层路径 | 325.518 ms | 328.351 ms | +0.9% |
| 128 种正文词、32 文件 | 162.427 ms | 152.126 ms | −6.3% |
| 256 查询词、仅两词命中 | 27.774 ms | 26.571 ms | −4.3% |
| 文件名搜索，2,000 条混合 Unicode 路径 | 97.127 ms | 97.687 ms | +0.6% |

中文 BM25 的完整操作耗时减少 **13.8%**，词汇较多的正文减少 **6.3%**；长正文与稀疏查询约减少 3%–5%。文件名模式、字面精确模式的收益有限，1 万英文名称仍回退约 2.8%。这些结果不能推广成所有输入的固定加速比。

32 文件用例的九轮结果波动明显，追加预热 20 轮、测量 51 轮，以相同产物、输入与响应哈希复核：

| 追加采样用例 | 修改前 | 修改后 | 耗时变化 |
| --- | ---: | ---: | ---: |
| 英文 BM25，32 文件 | 0.926 ms | 1.032 ms | +11.4% |
| 英文 BM25，1,000 文件 | 13.404 ms | 12.818 ms | −4.4% |

小批量仍回退约 **0.11 ms（11.4%）**，不能使用九轮样本宣称其变快。仅借用切片的中间版本也有约 0.12 ms 回退；随后加入规范化复用改善了中文正文，但没有消除小语料回退。保留中间版本原始测量和源码，便于核查这项取舍。

## 内存与体积取舍

| WASM 线性内存用例 | 修改前 | 修改后 |
| --- | ---: | ---: |
| 64 个长文件，深层路径，文件名短语命中 | 8.625 MiB | 8.688 MiB |
| 同上，文件名短语不命中 | 8.625 MiB | 8.688 MiB |
| 中文 BM25，64 文件 | 6.625 MiB | 6.625 MiB |
| 64 查询词、10,240 块，缓存超限 | 23.375 MiB | 23.375 MiB |
| 128 种正文词、32 文件 | 11.375 MiB | 11.438 MiB |
| 256 查询词、仅两词命中 | 5.000 MiB | 5.000 MiB |

59 组对照中，三组的线性内存高水位各增加 64 KiB，其余保持一致。本轮减少了临时复制与重复规范化，但短语标记需要额外空间，不能宣称总内存下降。

| 生产 converter-text.wasm | 修改前 | 修改后 | 变化（字节） |
| --- | ---: | ---: | ---: |
| 原始字节 | 8,523,615 | 8,524,007 | +392 |
| gzip，级别 9 | 3,185,719 | 3,186,226 | +507 |
| Brotli，质量 11 | 2,301,259 | 2,301,020 | −239 |

运行时 JavaScript 未改动。最终 WASM SHA-256：`e7771ecdd18820d76b25fd1e3c1fbc5789430c89875c79620fc8e9f015a46879`。

## 验证

- 21 项共享搜索源码测试通过。新增测试逐项比较混合文本的词发射顺序与权重，验证标点、拉丁字符、数字、表情和组合字符会断开中文双字词，并对照单字符子串、全角与组合字符的短语分。完整词频表参考对照也核对短语命中；0/1/128 字节与默认特征预算的评分一致性测试通过。
- 59 组本轮生产 WASM 完整响应对照通过。在第七轮 55 组基础上，新增双字词断开、规范化后单词切片、2,000 条混合 Unicode 深层路径，以及全角短语跨分块用例；继续包含评分、排序、摘录偏移、来源信息、缓存超限和 5 种输出格式对照。
- 24 组精确搜索与 Office 媒体操作、5 组 OCR 响应对照再次通过，合计 **88 组完整响应对照**。仅忽略 `metrics.elapsedMs`，评分等字段严格比较；OCR 推理使用固定 host 响应，实际执行生产解析、过滤与来源映射。
- 转换架构边界检查 2,122 项通过。

## SIMD 可应用的位置

本轮搜索产物没有接入 SIMD。下一步可在共享 Rust/WASM 核心中为 ASCII 检测、大小写转换和分词边界扫描增加可选 `simd128` 路径；每次读取 16 字节，通过比较与位掩码定位非 ASCII 字节或分隔符，剩余不足 16 字节的尾部继续使用标量逻辑。遇到 Unicode 输入时保留现有 NFKC 与中文分词规则。

仓库已有[格式探测的 SIMD 扫描器](../wasm/converter-core-rust/src/format_detection/text_scan.rs)，可参考其有界向量读取和尾部处理；[自动选择模块](../packages/converter-client/src/format-detector-auto.ts)已有能力检测与 scalar 回退模式。搜索若采用同样方案，需要独立构建并对照 scalar/SIMD 产物，优化器启用 `--enable-simd`；只在同一模块中加入运行时分支，无法让不支持 SIMD 的引擎加载包含 SIMD 指令的模块。

查询词索引或 trie 的节点依赖较强，适合先用 SIMD 减少进入索引前的字节扫描成本。BM25 浮点评分维持原有顺序，避免向量归约改变严格对照中的分数与排名。实际收益仍需完整操作测量，不能按一次读取 16 字节推断为 16 倍加速。

## 记录与复跑

- [逐次计时、输入与响应哈希、线性内存及产物大小](../benchmarks/frontend/2026-11-04/batch-matching-round8.json)
- [优化前生产源码、内嵌数据和 Cargo 配置归档](../benchmarks/frontend/2026-11-04/batch-matching-round8-source-baseline.json.gz)，33 项文件保存在 JSON 的 `files` 字段
- [生产 WASM 对照脚本](../scripts/benchmark-batch-matching-round8.mjs)
- [小语料追加采样](../benchmarks/frontend/2026-11-04/batch-matching-round8-small.json)及[脚本](../scripts/benchmark-batch-matching-round8-small.mjs)
- [仅借用切片的中间版本记录](../benchmarks/frontend/2026-11-04/batch-matching-round8-token-slices.json)，保留原九轮测量、51 轮小语料追加采样和中间搜索源码，已由最终版本替代

使用 Rust 1.93.0、`text-extraction,postscript`、`wasm32-wasip1` release、现有 `privateRustBuildEnv`；Binaryen 131.0.0 参数为 `-Oz --strip-debug --strip-producers --enable-bulk-memory --enable-nontrapping-float-to-int`。前后均清除文本目标的构建指纹并强制编译，核对非空、WASM 有效性及 SHA-256。新基线与第七轮优化版逐字节一致。

编译输入来自规范化后的 Cargo `converter-text.d` 依赖路径，并归档 Cargo.toml、Cargo.lock。并行工作在两次构建之间给 Cargo.toml 增加了 `format-detection-simd = ["format-detection"]`，已严格核对其余清单内容一致。该功能未启用；优化构建的 Cargo JSON 确认文本目标仍仅启用 `default,office-crypto,postscript,text-extraction`。实际生产源码仅搜索源码不同，构建前后再次核对输入哈希；清单差异、优化构建清单全文和启用功能记录在 `buildInputAudit` 中。

```sh
node --no-warnings scripts/benchmark-batch-matching-round8.mjs \
  --baseline tmp/batch-matching-round8/before.wasm \
  --wasm tmp/batch-matching-round8/after.wasm \
  --control-baseline tmp/batch-matching-round7/after.wasm \
  --source-baseline benchmarks/frontend/2026-11-04/batch-matching-round8-source-baseline.json.gz \
  --build-input-audit tmp/batch-matching-round8/build-input-audit.json \
  --output tmp/batch-matching-round8/replay.json

node --no-warnings scripts/benchmark-batch-matching-round8-small.mjs \
  --baseline tmp/batch-matching-round8/before.wasm \
  --wasm tmp/batch-matching-round8/after.wasm
```

添加 `--checks-only` 可仅对照完整响应与采集线性内存，跳过计时和压缩计算。共享源码测试沿用[第三轮轻量入口及命令](batch-matching-round3-performance.zh-CN.md#记录与复跑)。从归档重建基线时，在独立 checkout 中恢复 `files` 字段，保持其余依赖和编译参数一致。
