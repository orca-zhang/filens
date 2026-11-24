# FiLens for ZimaOS-Blue

此集成保留优化后的 FiLens **v9** 技能正文，补充 Blue 自动发现所需的元数据、3 份引用文档和可重复运行的安装器。CLI 固定为公开 npm 包 **filens-cli@0.5.7**；集成包版本 **9.0.1** 是适配器修订号。

自动选用需要本地 **Blue 0.10.39 + routing fix** 候选版（基于 `60c0872d28aefa880390a937220a0b824729a158`）。下方更新后的候选版还包含本地任务收尾与工具证据修复。修复尚未发布；只装 FiLens 到当前正式版 Blue，不能保证自动选用。安装器会在收据中明确返回 `requiresBlueRoutingFix: true`，不会修改 Blue 的提示词或固定选用策略。

## 直接安装

以下命令在 FiLens 仓库根目录运行。需要 Node.js 20.11+，并使用仓库内已测试的集成归档，避免重新打包造成内容变化。

```sh
fixture="$PWD/benchmarks/filens-bench/results/2026-11-20/blue-fresh-install-v9"
prefix="$HOME/.local/share/filens-blue-v9"
npm install --prefix "$prefix" --ignore-scripts --no-audit --no-fund \
  --registry=https://registry.npmjs.org \
  filens-cli@0.5.7 "$fixture/filens-blue-integration-9.0.1.tgz"
export PATH="$prefix/node_modules/.bin:$PATH"
filens capacity --json
filens-blue-install --workspace "/absolute/path/to/blue/workspace" \
  --cli "$prefix/node_modules/.bin/filens"
```

把 `--workspace` 换成该 Blue profile 的 `agentcore.workspace_dir`。安装成功返回 `installed`；重复运行返回 `unchanged`。已有技能会备份到 workspace 的 `.filens-blue/backups/`，不会被当作第二份技能发现。安装前 CLI 自检失败时不会修改 workspace。

**安装完成后，从包含同一个 `$prefix/node_modules/.bin` 的 PATH 启动或重启 Blue gateway。** 从当前终端启动即可继承；通过服务管理器启动时，在该服务环境中设置 PATH。重启同时清除 Blue 已缓存的技能选择；本次验证覆盖安装后启动，不承诺运行中热安装立即刷新。无需手动指定 FiLens，也无需关闭 Blue 自带文档工具。

## 使用本次验证的 Blue 候选版

本次归档的二进制仅适用于 **macOS arm64**，不适用于 ZimaOS/Linux：

```sh
result="$PWD/benchmarks/filens-bench/results/2026-11-23/blue-sheet-sum-v9"
mkdir -p "$prefix/bin"
gzip -dc "$result/blue-0.10.39-shell-text-darwin-arm64.gz" > "$prefix/bin/blue"
chmod +x "$prefix/bin/blue"
export PATH="$prefix/bin:$prefix/node_modules/.bin:$PATH"
blue version
# 使用你原有 profile/config 参数，从此环境启动 gateway：
blue gateway run
```

其他平台应在上述 Blue 基线应用新归档中的 `blue-shell-evidence.patch` 后自行构建；该完整补丁已包含此前自动发现修复，无需叠加旧补丁。其他平台未经实机测试。该候选版 selector/budget/execution 均已连续两轮通过严格门禁，正式 readiness 的两个值均为 true；尚未合并或发布。

## 复现与原始证据

最新候选位于 [blue-sheet-sum-v9](../../benchmarks/filens-bench/results/2026-11-23/blue-sheet-sum-v9/README.md)，二进制 SHA256 为 `c577e18dbea733797fcaeb9f1d4cdc3c47c1c8d9a5ac071744bb1256e9803903`。它修复 shell JSON 多层转义导致表格与跨文件证据不能正确用于回答的问题，保留退出码、分页和 outcome 检查。全新安装 **13/13 自动调用、13/13 正确**；原两题两轮均通过，换编号/金额及缺项负例 6/6，分页命令一次、日志两页后正常结束。完整 13 题正式 provider 用量 **558,557 tokens**。门禁和调试成本另计，全部原始结果、失败、账单和复现脚本见新报告。此修复需要更新 Blue；FiLens v9、CLI 和安装包未变。

此前固定候选位于 [blue-harness-v9](../../benchmarks/filens-bench/results/2026-11-20/blue-harness-v9/README.md)，二进制 SHA256 为 `3f7ce5708354654fa24c0a4bd1dde009a386ee0a86cd4e064f54ad760eb6ab61`。它继续修复最终报告的 500 字节硬裁切与中文乱码、缺少成功执行证据仍通过验证，以及 shell 默认工作目录与任务目录不一致，并保留完整工具证据、日志分页和有界收尾。相关八包回归通过；该 hash 的 selector/budget 各两轮 203/203，execution 两轮各 87/87，正式 `ready=true`。全新安装 13/13 自动调用 FiLens、文档 11/13，失败为表格和跨文件求和；文档加分页共 722,285 tokens。复现脚本、完整账单和历史失败均在报告中。

上一 [blue-shell-recovery-v9](../../benchmarks/filens-bench/results/2026-11-20/blue-shell-recovery-v9/README.md) 的默认原生工具全新安装中，13 题均调用 FiLens，复杂题 9/11、控制题 2/2；真实分页两次成功，表格和跨文件计算仍拒答。13 题加分页题总用量 738,292 tokens，对照为 734,932，未体现明显节省。历史失败和账单保留。

中间 [blue-discovery-v9](../../benchmarks/filens-bench/results/2026-11-20/blue-discovery-v9/README.md) 完整对照及其分页失败保留；更早的 [blue-shell-evidence-v9](../../benchmarks/filens-bench/results/2026-11-20/blue-shell-evidence-v9/README.md) 保留最初的工具发现阻断证据。

上一轮收尾/证据修复的完整安装对照位于 [blue-outcome-v9](../../benchmarks/filens-bench/results/2026-11-20/blue-outcome-v9/README.md)，含完整 provider token 总账、原始失败、补丁、二进制与复现脚本。两组均安装相同 FiLens v9，用于比较修复前后的 Blue；它不代表通用 outcome 判定已经全部解决。

此前安装/未安装比较位于 [blue-fresh-install-v9](../../benchmarks/filens-bench/results/2026-11-20/blue-fresh-install-v9/README.md)，包含固定安装包、npm integrity、安装收据、题库、评分源码、逐题工具调用和实际 token 用量。

主比较在同一个修复后 Blue 上分别运行未装 FiLens / 全新安装 FiLens，旧文档工具在两组中同等关闭；另以第二个全新 npm prefix 和 Blue profile 验证默认文档工具开启时的自动调用。失败、超时及未完成预跑均保留。模型输出有随机性；复现保证安装步骤、输入与计分方法固定，不承诺分数或 token 数逐次相同。
