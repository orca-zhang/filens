# FiLens-Bench · converged-2026-11-24

[中文成绩页](https://filens.cc/bench/) · [English results](https://filens.cc/bench/en.html)

## 中文

这是 2026-11-24 冻结的公开汇总快照，FiLens CLI 版本为 **0.5.7**。包含 `baselines.json`、中英文分组柱状图（`summary.svg`、`summary.en.svg`）及本文方法说明。下载页另提供 ZIP 和 SHA-256 校验。

比较同一 harness 正常原生环境与正常安装 FiLens 后的复杂文件处理能力。两组使用相同问题、模型、语料与设置，Agent 自主选择工具；安装组不注入评测专用教程。表格按原生质量分降序排列；各 harness 模型不同，分数主要用于组内配对比较。

### 当前成绩

各组均使用 FiLens CLI **0.5.7**；DSH 插件为 `dsh-filens@0.1.10`。模型在每个配对组内固定：Codex、Claude、Zcode、OpenClaw、OpenCode 使用 GPT-6.1-Sol；DSH 使用 DeepSeek-V4.1-Flash；WorkBuddy 使用 Hy4 flash。质量分统计 11 道复杂题；token 为保存观测的输入与输出总量。

题集为 13 道合成题：11 道计分复杂题覆盖 DOCX 版本冲突、XLSX 单元格与跨文件求和、PPTX 发布门槛、PDF 日期、嵌套 ZIP、两种无答案拒答，以及 PNG/扫描 PDF OCR；另有两道 TXT 控制题，检查工单周期和长文尾部代码。

| Harness / 版本 | 质量分（原生 → FiLens） | 带证据成功 | p50 / 单批耗时（秒） | Token 总量¹（输入 + 输出） |
| --- | ---: | ---: | ---: | ---: |
| WorkBuddy Desktop · `5.11.3.43806934` · v18 | 98.18 → **100.00** | 9/11 → **11/11** | 57.773 → **54.073** | 540,952 → **144,341** |
| Codex CLI · `0.169.0-alpha.11.1` · v6 | 96.7 → **100.0** | 84.8% → **100%** | 33.0 → **24.0** | 2,313,628* → 1,753,149* |
| DSH · `0.2.2-rc.1` · local v8 | 96.1 → **100.0** | 84.8% → **100%** | 18.2 → **9.2** | 3,716,055 → **2,095,331** |
| OpenClaw CLI · `2026.11.6` · v25 | 95.2 → **100.0** | 81.8% → **100%** | 44.9 → **29.0** | 4,606,139 → **2,449,195** |
| OpenCode CLI · `1.19.6` · Skill 0.5.7 | 94.1 → **100.0** | 63.6% → **100%** | 28.5 → **21.4** | 2,176,843 → **1,332,998** |
| Claude Code · `2.1.41` · v5 R1 | 66.7 → **81.8** | 51.5% → **81.8%** | 37.6 → **22.8** | 6,990,001* → 4,045,783* |
| Zcode · `0.17.1-2` · v24 | 50.0 → **100.0** | 30.3% → **100%** | 85.3 → **23.0** | 1,127,085* → 1,982,136* |

质量分 7/7 提高，记录的耗时 7/7 缩短；用量完整的 4 组 token 均下降。¹ CLI 每条件运行 13 题三轮，token 为三轮合计，p50 按复杂题统计；WorkBuddy 每条件仅一轮 13 题 batch，耗时和 token 是整批总量，属于探索性结果。`*` 表示用量不完整，不能据此计算完整 token 节省：Codex 有一条请求未保存，Claude 每个条件有 6 次超时无用量，Zcode 原生组有 19 次无用量。金额未计价；完整 caveat 和数据见 `baselines.json`。

<details>
<summary>题集清单（13 题）</summary>

11 道复杂文件题计入质量分；2 道 TXT 长短文本题作为控制题。`--ocr` 组包含 PNG 发票和扫描 PDF。

| 题目 | 文件 | 检索内容 |
| --- | --- | --- |
| `text-control`（控制） | TXT | `TEXT2041` 工单复核周期 |
| `current-owner` | DOCX 现行版与归档版 | `AURORA2041` 现行负责人，排除旧版 |
| `numeric-trap` | DOCX 现行版与归档版 | 选择现行预算上限，排除旧金额 |
| `sheet-cell` | XLSX | `AURORA2041` 的 Hardware 费用 |
| `slide-gate` | PPTX | `RELEASE2041` 发布前的两项要求 |
| `pdf-date` | 文本 PDF | `MILESTONE2041` 验收日期 |
| `nested-archive` | ZIP → 内层 ZIP → DOCX | `ARCHIVE2041` 海运签收人及完整成员路径 |
| `long-tail`（控制） | 长 TXT（前置约 4,000 行背景文本） | `TAIL2041` 文档尾部审批码 |
| `cross-file-sum` | XLSX + DOCX | Hardware 与 Service 求和，并和现行预算比较 |
| `absent-topic` | DOCX | 语料中没有的现行负责人电话号码，要求拒答 |
| `absent-id` | 无匹配文件 | 不存在的 `UNKNOWN2099X` 批准人，要求拒答 |
| `image-invoice` | PNG 图片 | `FILENS2026` 发票应付金额（OCR） |
| `scan-second-page` | 扫描 PDF 第 2 页 | 项目标识符（OCR） |

</details>

### 评测口径与限制

- **题集**：v0.1 合成种子集，共 13 题；11 道复杂文件题计入质量分，2 道纯文本题作为控制。涵盖 Office、PDF、嵌套压缩包、扫描件、跨文件与无答案问题。
- **重复次数**：CLI harness 每组每题三次；WorkBuddy 每组仅一轮 13 题同批对话，属于探索性结果，不与 CLI 独立会话重复测量合并。
- **质量分**：`100 × (0.70 × 字段准确率 + 0.30 × 证据 F1)`。字段归一化后精确匹配；证据检查正确文件与原文引句，尚不核对页码、幻灯片或单元格坐标。
- **耗时**：从问题提交到最终回答结束；p50/p95 统计复杂文件题。WorkBuddy 展示整批耗时。失败与超时保留。
- **Token**：覆盖每轮全部 13 题，只使用 harness 实际报告的用量；CLI 表为三轮合计，WorkBuddy 为单轮 batch。未知值不按零计，不对不完整用量计算节省率，金额不计价。
- **候选选择**：每个 harness 采用一个已实测参考版本；`v6`、`v8` 等为各自的 Skill/安装适配编号。主表均记录 CLI 0.5.7，但未一致记录共同二进制 SHA-256，不能证明字节级相同。
- **限制**：题集小且为合成数据；参考版本经历开发与筛选，不是独立留出集盲测。各组失败、缺失用量与 Claude 复跑波动见 `baselines.json` 的 `caveats`。

此公开包只发布汇总成绩、图表、方法与限制，**不包含原始问题/回答、调用轨迹或逐次账单**。完整运行档案保留在开发环境；汇总包不等于完整可审计原始记录。独立运行自己的实验见[评测协议与复现命令](https://github.com/orca-zhang/filens/blob/main/benchmarks/filens-bench/README.zh-CN.md)。

## English

This public summary freezes the **November 24, 2026** snapshot, using FiLens CLI **0.5.7**. It includes `baselines.json`, bilingual grouped bar charts (`summary.svg`, `summary.en.svg`) and this methodology. The results page provides a ZIP and SHA-256 checksums.

Compare each harness's native environment with its normal FiLens installation, keeping the questions, model, corpus and settings fixed within that pair. Agents choose tools autonomously; no benchmark-specific FiLens tutorial is injected. Rows are sorted by native quality; models differ across harnesses, so scores are primarily for within-harness paired comparisons.

### Results

Every row uses FiLens CLI **0.5.7**; the DSH plugin is `dsh-filens@0.1.10`. Models are fixed within each pair: GPT-6.1-Sol for Codex, Claude, Zcode, OpenClaw and OpenCode; DeepSeek-V4.1-Flash for DSH; Hy4 flash for WorkBuddy. Quality is scored on 11 complex tasks; token totals sum input and output across saved attempts.

The 13-task synthetic set has 11 scored complex tasks covering DOCX version conflicts, XLSX cell lookup and cross-file sums, PPTX release gates, PDF dates, nested ZIP retrieval, two unanswerable lookups, and OCR on a PNG invoice and scanned PDF. Two TXT controls test a ticket interval and a code at the end of a long document.

| Harness / version | Quality (stock → FiLens) | Evidence success | p50 / batch time (s) | Token total¹ (input + output) |
| --- | ---: | ---: | ---: | ---: |
| WorkBuddy Desktop · `5.11.3.43806934` · v18 | 98.18 → **100.00** | 9/11 → **11/11** | 57.773 → **54.073** | 540,952 → **144,341** |
| Codex CLI · `0.169.0-alpha.11.1` · v6 | 96.7 → **100.0** | 84.8% → **100%** | 33.0 → **24.0** | 2,313,628* → 1,753,149* |
| DSH · `0.2.2-rc.1` · local v8 | 96.1 → **100.0** | 84.8% → **100%** | 18.2 → **9.2** | 3,716,055 → **2,095,331** |
| OpenClaw CLI · `2026.11.6` · v25 | 95.2 → **100.0** | 81.8% → **100%** | 44.9 → **29.0** | 4,606,139 → **2,449,195** |
| OpenCode CLI · `1.19.6` · Skill 0.5.7 | 94.1 → **100.0** | 63.6% → **100%** | 28.5 → **21.4** | 2,176,843 → **1,332,998** |
| Claude Code · `2.1.41` · v5 R1 | 66.7 → **81.8** | 51.5% → **81.8%** | 37.6 → **22.8** | 6,990,001* → 4,045,783* |
| Zcode · `0.17.1-2` · v24 | 50.0 → **100.0** | 30.3% → **100%** | 85.3 → **23.0** | 1,127,085* → 1,982,136* |

Quality improved in 7/7 pairs and measured time fell in 7/7; tokens fell in all 4 pairs with complete usage. ¹ CLI token totals aggregate three 13-task runs per condition; p50 covers complex tasks. WorkBuddy is one exploratory 13-task batch per condition, so its time and tokens are batch totals. `*` marks incomplete usage and cannot support a complete token-savings claim: Codex has one unsaved request, Claude has six timed-out requests per condition without usage, and Zcode stock is missing usage for 19 attempts. Monetary amounts are not priced. See `baselines.json` for all caveats.

<details>
<summary>Test-set inventory (13 tasks)</summary>

11 complex-file tasks count toward quality; two short/long TXT tasks are controls. The `--ocr` set includes a PNG invoice and a scanned PDF.

| Task | File | What it tests |
| --- | --- | --- |
| `text-control` (control) | TXT | Support-ticket review interval for `TEXT2041` |
| `current-owner` | Current and archived DOCX | Find the current `AURORA2041` owner; ignore the archived version |
| `numeric-trap` | Current and archived DOCX | Select the current budget cap, not the stale amount |
| `sheet-cell` | XLSX | `AURORA2041` Hardware expense |
| `slide-gate` | PPTX | Two pre-release requirements for `RELEASE2041` |
| `pdf-date` | Text PDF | Acceptance date for `MILESTONE2041` |
| `nested-archive` | ZIP → inner ZIP → DOCX | `ARCHIVE2041` shipping recipient and full member path |
| `long-tail` (control) | Long TXT (about 4,000 lines of leading background) | Approval code at the end of `TAIL2041` |
| `cross-file-sum` | XLSX + DOCX | Sum Hardware and Service, then compare with the current budget |
| `absent-topic` | DOCX | Refuse an absent current-owner phone number |
| `absent-id` | No matching file | Refuse an approver lookup for nonexistent ID `UNKNOWN2099X` |
| `image-invoice` | PNG image | OCR the payable amount on invoice `FILENS2026` |
| `scan-second-page` | Scanned PDF, page 2 | OCR the project identifier |

</details>

### Methodology and limits

- **Dataset:** v0.1 synthetic seed corpus, with 11 complex-file tasks scored for quality and 2 plain-text controls. Formats include Office, PDF, nested archives and scans, with cross-file and unanswerable questions.
- **Repetitions:** three per task and condition for CLI harnesses. WorkBuddy runs one 13-task batch conversation per condition; its exploratory batch is not pooled with independent CLI sessions.
- **Quality:** `100 × (0.70 × field accuracy + 0.30 × evidence F1)`. Normalized fields must match exactly; evidence must identify the correct file and quote its text. Page, slide and cell coordinates are not yet checked.
- **Latency:** question submission to final answer. CLI p50/p95 cover complex-file tasks; WorkBuddy reports whole-batch duration. Failures and timeouts remain included.
- **Tokens:** input and output across all 13 tasks per run, using reported usage only; CLI totals aggregate three runs, while WorkBuddy is one batch. Missing usage is unknown, never zero; incomplete totals do not support savings percentages. Monetary amounts are not priced.
- **Selection:** one measured reference per harness. Candidate labels such as `v6` and `v8` identify harness-specific Skill/install adaptations. Every row reports CLI 0.5.7, but shared binary SHA-256 identities were not consistently recorded.
- **Limits:** small synthetic corpus; references were developed and selected on these tasks, not tested blindly on an independent holdout. See each row's `caveats` for failures, missing usage and Claude rerun variance.

This package publishes aggregate results, charts, methodology and limitations. **Raw prompts/answers, traces and itemized ledgers are not included.** Full run archives remain in the development environment; this summary is not a complete raw audit record. See the [protocol and reproduction commands](https://github.com/orca-zhang/filens/blob/main/benchmarks/filens-bench/README.zh-CN.md) to run an independent experiment.
