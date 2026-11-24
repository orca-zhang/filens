# FiLens-Bench · converged-2026-11-24

[中文成绩页](https://filens.cc/bench/) · [English results](https://filens.cc/bench/en.html)

## 中文

这是 2026-11-24 冻结的公开汇总快照，FiLens CLI 版本为 **0.5.7**。包含 `baselines.json`、分组柱状图 `summary.svg`、质量雷达图 `quality-radar.svg` 及本文方法说明。下载页另提供 ZIP 和 SHA-256 校验。

比较同一 harness 正常原生环境与正常安装 FiLens 后的复杂文件处理能力。两组使用相同问题、模型、语料与设置，Agent 自主选择工具；安装组不注入评测专用教程。各 harness 的模型不同，分数用于组内配对比较，不构成跨 harness 排名。

- **题集**：v0.1 合成种子集，共 13 题；11 道复杂文件题计入质量分，2 道纯文本题作为控制。涵盖 Office、PDF、嵌套压缩包、扫描件、跨文件与无答案问题。
- **重复次数**：CLI harness 每组每题三次；WorkBuddy 每组仅一轮 13 题同批对话，属于探索性结果，不与 CLI 独立会话重复测量合并。
- **质量分**：`100 × (0.70 × 字段准确率 + 0.30 × 证据 F1)`。字段归一化后精确匹配；证据检查正确文件与原文引句，尚不核对页码、幻灯片或单元格坐标。
- **耗时**：从问题提交到最终回答结束；p50/p95 统计复杂文件题。WorkBuddy 展示整批耗时。失败与超时保留。
- **Token**：覆盖全部 13 题，只使用 harness 实际报告的用量。未知值不按零计，不对不完整用量计算节省率，金额不计价。
- **候选选择**：每个 harness 采用一个已实测参考版本；`v6`、`v8` 等为各自的 Skill/安装适配编号。主表均记录 CLI 0.5.7，但未一致记录共同二进制 SHA-256，不能证明字节级相同。
- **限制**：题集小且为合成数据；参考版本经历开发与筛选，不是独立留出集盲测。各组失败、缺失用量与 Claude 复跑波动见 `baselines.json` 的 `caveats`。

此公开包只发布汇总成绩、图表、方法与限制，**不包含原始问题/回答、调用轨迹或逐次账单**。完整运行档案保留在开发环境；汇总包不等于完整可审计原始记录。独立运行自己的实验见[评测协议与复现命令](https://github.com/orca-zhang/filens/blob/main/benchmarks/filens-bench/README.zh-CN.md)。

## English

This public summary freezes the **November 24, 2026** snapshot, using FiLens CLI **0.5.7**. It includes `baselines.json`, grouped charts (`summary.svg`), a quality radar (`quality-radar.svg`) and this methodology. The results page provides a ZIP and SHA-256 checksums.

Compare each harness's native environment with its normal FiLens installation, keeping the questions, model, corpus and settings fixed within that pair. Agents choose tools autonomously; no benchmark-specific FiLens tutorial is injected. Models differ across harnesses, so these are within-harness comparisons rather than a cross-harness ranking.

- **Dataset:** v0.1 synthetic seed corpus, with 11 complex-file tasks scored for quality and 2 plain-text controls. Formats include Office, PDF, nested archives and scans, with cross-file and unanswerable questions.
- **Repetitions:** three per task and condition for CLI harnesses. WorkBuddy runs one 13-task batch conversation per condition; its exploratory batch is not pooled with independent CLI sessions.
- **Quality:** `100 × (0.70 × field accuracy + 0.30 × evidence F1)`. Normalized fields must match exactly; evidence must identify the correct file and quote its text. Page, slide and cell coordinates are not yet checked.
- **Latency:** question submission to final answer. CLI p50/p95 cover complex-file tasks; WorkBuddy reports whole-batch duration. Failures and timeouts remain included.
- **Tokens:** all 13 tasks, using reported usage only. Missing usage is unknown, never zero; incomplete totals do not support savings percentages. Monetary amounts are not priced.
- **Selection:** one measured reference per harness. Candidate labels such as `v6` and `v8` identify harness-specific Skill/install adaptations. Every row reports CLI 0.5.7, but shared binary SHA-256 identities were not consistently recorded.
- **Limits:** small synthetic corpus; references were developed and selected on these tasks, not tested blindly on an independent holdout. See each row's `caveats` for failures, missing usage and Claude rerun variance.

This package publishes aggregate results, charts, methodology and limitations. **Raw prompts/answers, traces and itemized ledgers are not included.** Full run archives remain in the development environment; this summary is not a complete raw audit record. See the [protocol and reproduction commands](https://github.com/orca-zhang/filens/blob/main/benchmarks/filens-bench/README.zh-CN.md) to run an independent experiment.
