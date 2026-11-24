# 依赖安全审查报告

检查时间：2026-11-19（Asia/Shanghai）。扫描范围：4 份 npm 锁文件、5 份 Cargo 锁文件和 GitHub 当前开放 Dependabot 告警。

## 结果

- GitHub 有 80 条开放 Dependabot 告警（严重 4、高 35、中 33、低 8）；本地版本范围核对显示 75 条已升级、5 条已移除、0 条仍处于受影响版本。此核对不会关闭线上告警。
- npm 审计发现 0 项不同公告；覆盖的全量和生产依赖审计均为 0 项。
- RustSec（cargo-audit 0.23.0）在 5 份 Cargo.lock 中发现 0 项已知漏洞；另有 9 条未维护、2 条不健全 API、0 个撤回版本告警。

## RustSec 告警

- 未维护：`cgmath@0.18.0`（RUSTSEC-2026-0196），见 `benchmarks/rust-engines/Cargo.lock`、`wasm/converter-step-rust/Cargo.lock`。`cgmath` is unmaintained
- 未维护：`chrono@0.4.45`（RUSTSEC-2026-0543），见 `benchmarks/rust-engines/Cargo.lock`、`wasm/converter-step-rust/Cargo.lock`。chrono is unmaintained
- 未维护：`proc-macro-error@1.0.4`（RUSTSEC-2024-0370），见 `benchmarks/rust-engines/Cargo.lock`、`wasm/converter-step-rust/Cargo.lock`。proc-macro-error is unmaintained
- 不健全 API：`cgmath@0.18.0`（RUSTSEC-2026-0197），见 `benchmarks/rust-engines/Cargo.lock`、`wasm/converter-step-rust/Cargo.lock`。`Matrix{2,3,4}::swap_columns` can trigger undefined behavior for identical indices
- 未维护：`unsafe-libyaml@0.2.11`（RUSTSEC-2024-0449），见 `cli/Cargo.lock`。unsafe-libyaml is unmaintained
- 未维护：`paste@1.0.15`（RUSTSEC-2024-0436），见 `wasm/converter-core-rust/Cargo.lock`。paste - no longer maintained
- 未维护：`ttf-parser@0.25.1`（RUSTSEC-2026-0192），见 `wasm/converter-core-rust/Cargo.lock`。`ttf-parser` is unmaintained

## 已处理项

- `picomatch@4.0.8-filens.1`：从 `picomatch@4.0.7` 更新。单分支重复 extglob 中未转义的 * 或 ? 按字面字符处理。回归检查：[`scripts/picomatch-hotfix.test.mjs`](../scripts/picomatch-hotfix.test.mjs)。补丁记录：[`vendor/picomatch/FILENS-PATCH.md`](../vendor/picomatch/FILENS-PATCH.md)。
- `iwork@0.4.0`：本地 vendored 适配器使用 zip@9.1.3，移除了有漏洞的 zip@2.6.1。回归检查：[`wasm/converter-core-rust/src/zip_io.rs`](../wasm/converter-core-rust/src/zip_io.rs)。补丁记录：[`wasm/converter-core-rust/vendor/iwork/FILENS-PATCH.md`](../wasm/converter-core-rust/vendor/iwork/FILENS-PATCH.md)。
- `Go 转换器宿主`：删除 Go CLI、HTTP、Agent 与文本提取宿主，保留共享 Rust/WASM 核心和非 Go 样例资源。验证：本地 Dependabot 版本核对将 Go 告警标记为依赖已移除。
- `calamine@0.38.0`：从 `calamine@0.37.0` 更新。修复恶意 XLS/XLSB/CFB 输入可触发 panic 或 OOM 的解析问题。验证：Rust WASM 构建与转换回归检查。
- `msoffice-crypto@0.1.0 / secure-gate@0.9.0`：从 `msoffice-crypto 0.1.0-rc.13 / secure-gate 0.9.0-rc.17` 更新。改用正式版依赖，移除被撤回的 secure-gate 预发布版本。验证：Rust WASM 构建与转换回归检查。

## 审查边界

- `cgmath@0.18.0`：未发现受影响 API 的调用点。公告涉及索引相同的 Matrix2/3/4::swap_columns 调用；STEP 适配器和固定版本 truck 源码中未找到该 API 的调用点。
- `unsafe-libyaml@0.2.11`：仅用于 YAML 序列化。CLI 只调用 serde_yaml::to_writer 输出 YAML，没有在该路径解析用户提供的 YAML；该 crate 仍含未维护的 unsafe 实现。
- `ttf-parser@0.25.1`：运行时解析器维护风险。text-extraction 功能用它解析文档内嵌字体；RustSec 没有报告已知漏洞，但上游已停止维护。
- `paste, proc-macro-error`：仅构建期依赖。cargo tree 显示它们通过过程宏构建依赖进入；目前没有已知运行时漏洞。
- `chrono@0.4.45`：STEP 解析器维护风险。它经 truck-stepio 进入 STEP 解析依赖；RustSec 报告维护状态，没有报告已知漏洞。
- 本地版本核对不会关闭 GitHub 告警，也不会修补已发布的软件包。
- npm 将受影响包数量和不同公告分别统计；传递依赖链不代表独立漏洞。
- RustSec 扫描了所有已提交 Cargo.lock，并将未维护、不健全 API 和撤回版本与已知漏洞分开列出。
- GitHub Code Scanning API 返回 HTTP 404，当前令牌也缺少 admin:repo_hook 权限；因此无法判断该仓库是否有代码扫描结果。
- 公告和版本范围匹配不等于漏洞可利用，也不替代运行行为验证。

机器可读明细：[security-dependencies.json](./security-dependencies.json)。
