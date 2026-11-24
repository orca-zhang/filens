# FiLens-Bench v0.1 工具层试跑

2026-11-19，Apple M4 Pro / darwin-arm64，使用本地完整 CLI 和现有 OCR 运行时。原始观测、二进制/WASM hash、环境、固定文件 hash 与标签见 [smoke-report.json](smoke-report.json)。绝对用户目录已替换为占位符；本地完整输出留在 `dist/filens-bench-v0.1/tools-DrZRUw/`。

这是合成种子集的工具层验证。**没有运行任何 LLM，也没有 Codex、dsh、Claude、zcode 的最终问答成绩。**

42 个原始文件，包括 32 个无关 TXT；13 道 agent 题中，10 道提供独立指定的字面检索 query。每个 query、每个工具运行 3 次，轮换先后顺序，共 90 次查询。每次启动新进程，不清空 OS 页缓存。

复杂文件部分有 7 个有答案 query，覆盖当前/归档 DOCX 与 XLSX、表格金额、PPTX、PDF、嵌套 ZIP、PNG 和扫描 PDF；另有 1 个不存在编号 query。每个工具有 21 次有答案尝试、3 次无答案尝试。纯文本与长文尾部两个控制 query 单列。

| 工具配置 | 复杂文件候选召回 | 复杂文件 Hit | 查询 p50 / p95 | 语料准备 | 预提取文本 |
| --- | ---: | ---: | ---: | ---: | ---: |
| 原始文件上的 rg | 0% | 0% | 6.90 / 7.93 ms | 0 | 0 |
| FiLens exact，包含 OCR | 100% | 100% | 3014.88 / 3143.57 ms | 0 | 0 |
| FiLens 同一核心预提取 + rg | 100% | 100% | 6.80 / 8.72 ms | 11326.00 ms | 191012 bytes |

查询时延包含该部分 24 次尝试，召回与 Hit 只在 21 次有答案尝试上计算。FiLens 每次扫描完整混合目录、解析文件并执行 OCR；没有按题目预先挑选文件。三种配置均无不完整请求；不存在编号 query 均无误报。两个纯文本控制 query，三种配置均命中。

把全部 10 个 query 算入，原始 rg 的有答案 Hit 为 22.2%；FiLens 和预提取 + rg 为 100%。全部 30 次查询的累计时间分别为约 0.20 秒、91.18 秒和 0.21 秒；预提取方案还需加 11.33 秒准备。这组数据同时展示了 FiLens 的原始复杂文件覆盖，以及重复查询时预提取方案的摊销收益。

预提取使用生成时已知的逻辑文件清单，不计未知压缩成员发现成本；它逐文件启动 CLI，耗时包括落盘和保存观测日志，并非最优批量抽取实现。读取/OCR 的正确性标签由合成源文本指定，未以该次提取结果反向生成答案。PDF 文本流和 Office/ZIP 成员压缩是文件的正常存储形式；不能把此处原始 rg 的失败解释为其纯文本搜索能力不足。

这批 query 以精确标识符为主，样本少且没有语义改写，100% 候选召回不代表通用正确率、证据定位准确率或 agent 最终任务成功率。模型实测、真实文档留出集、全文索引和向量方案仍待采集。

复现入口：

```sh
node benchmarks/filens-bench/bench.mjs prepare --work dist/filens-bench-replay --ocr
node benchmarks/filens-bench/bench.mjs tools --work dist/filens-bench-replay --repeats 3
```

生成器后续可增加任务分类字段，因此复核语料时先比对冻结的 `physicalFiles[].sha256`；报告中的 `corpusSHA256` 对应采集时完整 manifest 字节。源码、二进制或运行时变更后，应保留新报告，不覆盖本次观测。
