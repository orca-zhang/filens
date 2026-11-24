# Blue / FiLens v9 优化审查

后续实现与真实模型对照见 [blue-outcome-v9](../../benchmarks/filens-bench/results/2026-11-20/blue-outcome-v9/README.md)。以下保留实施前的审查结论；后续修复不代表通用 outcome 语义判定已经解决。

本轮仅复核已有原始轨迹和候选 Blue 源码；未改运行代码、安装包或评分，未产生新的模型调用。原始归档及其 SHA256SUMS 保持不变。

结论：值得继续优化，先处理 Blue 的任务范围与回答收尾，再减少重复取证，最后评估 CLI 性能。自动选用目前已有主比较 39/39、独立默认工具复测 13/13 的真实调用证据。

## 失败集中度

数据来自[固定归档](../../benchmarks/filens-bench/results/2026-11-20/blue-fresh-install-v9/README.md)。主比较按 manifest 排除两道纯文本控制题，复杂题安装组通过 23/33，失败 10 次。

| 题目 | 主比较成功 | 独立默认工具复测成功 | 观察 |
| --- | ---: | ---: | --- |
| slide-gate | 0/3 | 0/1 | 本地证据完整，随后补充联网、破坏 JSON；复测超时 |
| sheet-cell | 1/3 | 0/1 | 首次检索已有费用行，仍反复查找；主比较 9–12 次工具调用 |
| absent-topic | 0/3 | 1/1 | 重复检索、临时文件和命令审批干扰；完整性判断仍不稳定 |
| cross-file-sum | 2/3 | 0/1 | 费用与预算已返回，复测仍 answers 为空 |
| current-owner | 2/3 | 1/1 | 一次失败伴随审批不可交付 |

前三类占主比较安装组失败的 8/10。其余六类复杂题在主比较各 3/3，通过的两道控制题各 3/3。

## P0：修复本地问题被强制升级为联网研究

证据充分，代码路径与轨迹一致：

1. 适配器将完整 prompt JSON 作为 Blue 的 message 发送，包含 corpus、task、answerSchema 和 instruction。流式入口把它直接作为 routingMessage。
2. 候选 Blue `server/internal/server/chat.go` 的 `shouldPreferDeepSearchReport` / `shouldEnforceDeepSearchMinRounds` 扫描整段字符串，没有区分任务语义与输出协议。slide-gate 中 `RELEASE2041` / “发布”命中 freshness；`citations`、`insufficient_evidence` 及说明中的“报告、引用、证据”命中 analysis。单独的题目没有 analysis 命中。
3. 本地问答例外 `shouldSkipDeepSearchMinRoundsForWorkspaceArtifactTask` 要求有输出文件目标，覆盖不到本题的直接 JSON 回答。
4. `newDeepSearchLoopState` 将 bash 视为具备搜索能力；本地 FiLens 成功不满足联网搜索轮数。收尾代码在模型完成后仍可注入 `buildDeepSearchMinRoundsNudge`，要求继续 web_query 并改为完整研究报告，未保留用户输出格式。
5. [formal/slide-gate-0-filens.json](../../benchmarks/filens-bench/results/2026-11-20/blue-fresh-install-v9/formal/slide-gate-0-filens.json) 中 FiLens 约 3.05 秒返回两项要求；模型先输出正确答案及引用的 JSON，随后继续两次 web_query，最终替换为普通文本。三次主比较最终均不符合协议，耗时 47.34–57.01 秒。独立复测 FiLens 约 3.64 秒成功，之后查找 web_query，117 秒超时。

建议在共享任务意图和范围判断处解决：本地来源限定优先；输出 schema 不作为研究意图；联网研究须有相应请求依据。研究收尾提示也必须保留用户格式约束。需要保留真正的公开信息研究、多来源查证及“本地 + 联网”混合任务，不能一律关闭研究能力或给 FiLens 硬编码特权。

下一轮先补 Harness 数据：本地发布要求问答、纯文本/JSON 两种输入、变更字段名及状态枚举、显式联网研究和混合来源任务。再做确定性收尾回归，验证已得到的 JSON 不被继续搜索替换。当前归档无该 guard 的专用触发日志，因此不宣称已用新回归确认修复。

## P1：减少重复检索并查明有证据仍拒答的原因

按原始 tool_results 统计，主比较 14/39 次安装组运行重复了相同操作、目录、查询和 search-mode，共 46 次重复搜索尝试；独立复测为 3/13 次、8 次重复尝试。统计忽略 blue exec/直接执行、输出格式和重定向的差异，因此其中包括为核查完整性切换 JSON、以及被审批阻止的尝试，不能全部视为可删除或已成功执行的调用。

表格首次搜索已有 Hardware 2100.20、Service 1482.50 和现行预算 3582.70。后续常见重复文本/JSON搜索、写文件再 read、读取同一工作簿，最后仍返回 insufficient_evidence。独立 cross-file-sum 引用了金额和预算，却没有答案。标识符已按字节核对一致，目前没有证据支持“源文件或转换器把项目 ID 改错”的结论。

技能 v9 已明确正向证据充分即回答、多文件计算直接使用来源行，因此继续堆叠相同技能指令的价值有限。应对照 Blue 实际交给模型的工具消息、后置续写指令和最终消息，定位上下文表示或回答判断问题；尚不能断言具体根因。以表格取值、版本比较、跨文件计算各自的回归覆盖，避免简单硬限制调用次数损害复杂问题。

## P1：完善缺失事实取证和无界面审批处理

主比较安装组 12/39 次运行包含 exec_approval_delivery_unavailable，共 16 次工具结果；其中 5 次运行最终失败。独立复测 1/13 次运行遇到该错误，最终通过。审批与失败相关，但这些数量不能证明所有失败由审批导致。

absent-topic 三次主比较都受影响：模型写临时 JSON 或用管道分析已有输出，被告知没有可用的 SSE 审批接收端。优先直接消费 stdout 中的完整性、扫描错误及实体/属性搜索结果，减少无必要的临时文件与管道；同时验证无界面客户端的审批交付及返回状态。保持目录和命令权限边界，不通过放宽权限改善分数。只有完整扫描和有效属性检索才能支持 not_found。

## P2：token 记账、性能及安装覆盖

- 正式 provider 全量账已完整：安装后总 token 从 5,140,970 降至 2,906,058，减少 43.47%。逐题快照漏收 38 个晚完成请求，超时题亦不完整；需要把最终 provider usage 按稳定请求/会话标识归属到题目，保留无 usage 的未知状态。缓存输入是输入子集，不能再次相加。
- 本地检索在可见内部计时中通常约 3 秒，简单题整体约 15–21 秒；表格题达到 72–86 秒。因此先减少模型往返、误联网及重复取证，再独立测冷启动/索引/转换各阶段，决定是否优化 WASM core。不能把整体耗时全部归因于 CLI。
- 自动选用不宜继续扩大修补；仍需 ZimaOS/Linux 实机直接安装，以及运行中安装后的工具发现刷新验证。目前仅验证 macOS arm64，从正确 PATH 启动或重启 gateway。
- Blue 执行框架变更须先补 Harness 数据，再走 selector/execution/budget gates 和 cutover readiness。现有发布门禁仍未通过；本轮审查不改变该状态。

建议顺序：先修并定向复测本地研究误触发；再定位表格/缺失事实的重复取证与拒答；这些回归稳定后才重跑完整比较。所有失败和超时继续保留，不据旧结果推算修复后的得分或 token 收益。
