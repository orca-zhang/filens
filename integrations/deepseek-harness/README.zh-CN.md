# FiLens for DeepSeek Harness

[English](README.md)

`dsh-filens` 统一安装两个可独立启停的插件：

| 入口 | 功能 |
| --- | --- |
| `filens-tools`（`dsh-filens/tools`） | Agent 本地文档读取、OCR、搜索、原文摘录和转换。 |
| `filens-preview`（`dsh-filens`） | 在 DSH 现有侧栏内，用 FiLens 预览 DSH 读取的文件字节。 |

适配层复用 `filens-cli@0.5.2`，从共享前端源码构建 `filens-preview@0.3.2` 运行时，不增加格式解析或转换算法。预览后缀从共享清单生成，共 **397** 个，包括经本地转换后预览的格式；注册数量不代表对所有文件的完整保真承诺。详见[格式边界](../../docs/support-matrix.md)和[验证记录](VALIDATION.md)。

实测版本：macOS arm64 上的 DSH **桌面版/Web 0.2.1-rc.5**、**Web 0.2.2-alpha.3**，Node 24。其他 DSH 版本尚未验证。

## 安装与构建

npm 包为 [`dsh-filens@0.1.0`](https://www.npmjs.com/package/dsh-filens)。安装到对应 profile 后重新启动 DSH：

```sh
dsh plugin --profile desktop add dsh-filens@0.1.0
# Web profile：
dsh plugin --profile web add dsh-filens@0.1.0
```

插件内含 Client、预览 WASM、压缩包 Worker 和许可文件，CLI/OCR 通过 npm 平台依赖安装；无需编译或单独下载模型。安装时保留可选依赖。支持 macOS arm64、Linux x64/arm64 和 Windows x64；本次原生执行验证在 macOS arm64 完成，Linux/Windows 为交叉构建。

从源码打包（Node >=24.9）：

```sh
npm ci
npm --prefix integrations/deepseek-harness ci
npm run package:dsh:npm
```

产物与哈希记录在 `dist/dsh-npm/release.json`。构建直接使用共享前端源码，只分发一份预览运行时。需要本机 CLI/OCR 离线测试包时，先运行 `npm run build:agent`，再运行 `npm --prefix integrations/deepseek-harness run pack:local`；该构建还需 Rust 1.93、Go 和 Xcode 命令行工具，`pack:local` 本身不发布 npm。

Web 安装到相应 profile：

```sh
dsh plugin --profile web add /绝对路径/dsh-filens-0.1.0.tgz
dsh web
```

桌面版先打开一次以初始化 profile，再完全退出，然后执行：

```sh
dsh plugin --profile desktop add /绝对路径/dsh-filens-0.1.0.tgz
```

如果 macOS 的 PATH 中还没有 `dsh`，可使用应用自带的 `/Applications/DeepSeek Harness.app/Contents/Resources/runtime/cli/bin/dsh`。安装后重新打开应用。DSH 会从自己的运行时提供共享依赖，因此包管理器可能打印 peer 警告；实际加载和调用结果见验证记录。

测试可使用 `DSH_HOME=/tmp/filens-dsh-test`，启动和安装时保持同一值。重复构建本地包时，改用新的 tarball 文件名；pnpm 可能保留同一 `file:` 路径的旧内容。

## 使用

首次测试可明确让 Agent 使用下列工具：

| 工具 | 参数示例 |
| --- | --- |
| `filens_capacity` | `{}`：查询格式、转换对和 OCR 健康状态。 |
| `filens_read` | `{"path":"report.pdf","layout":true}` |
| `filens_search` | `{"path":"docs","query":"年度收入","max_results":10}` |
| `filens_excerpt` | `{"path":"report.docx","query":"风险","max_chars":4000}` |
| `filens_convert` | `{"path":"data.csv","output":"data.xlsx"}` |

路径相对于当前 Session 的执行环境与工作目录。路径和查询以 JSON 走 stdin，不拼入 shell 命令。转换不覆盖已有文件；支持的转换对以 `filens_capacity` 为准。摘录选择原文，保留 CLI 的排名、定位和省略信息。

结构化结果为 `{ exit_code, response }`。应检查 `response.ok`、完整性、截断、警告和来源信息。CLI 退出码 **3** 仍保留部分结果；无效 JSON、沙箱执行器错误、输出溢出、超时和取消会成为工具错误。展示给模型的 JSON 有长度限制，结构化值保留完整响应；遇到截断可减少请求量。

从 DSH 文件面板或文件链接打开文件，在现有查看器菜单中可选择 **FiLens** 或适用的内置实现；FiLens 对其注册后缀拥有第三方扩展优先级。

## 配置与独立启停

在对应 profile 的 `cordis.patch.yml` 中配置：

```yaml
- id: filens-tools
  config:
    timeoutMs: 120000
    maxBytes: 131072
    displayChars: 60000
    ocr: true
    # 可选：shell 执行环境中的可执行文件与固定参数
    # command: [filens]
- id: filens-preview
  disabled: false
```

任一入口都可设为 `disabled: true`，也可在 DSH 插件界面操作。纯工具/headless profile 应关闭 `filens-preview`，预览需要 Web/桌面端和 `webServer`。卸载工具入口会取消正在执行的调用并注销五个工具；卸载预览入口会删除客户端注册、资源路由和启动注入，关闭预览会释放 iframe 与 Worker。

默认命令使用 DSH Host 的 Node/Electron 可执行文件及随包 CLI launcher。远程 shell 或容器需要在**实际执行环境内**安装 CLI，并配置 `command: [filens]`；Host 安装路径未必存在于远端。依赖 DSH 的 Bash 兼容 `shell` provider，不支持只有 PowerShell 的组合。默认 CLI 的预构建平台为 macOS arm64、Linux x64/arm64、Windows x64；这里继承 CLI 的平台范围，没有逐个平台实测。

命令经过 `ctx.shell`、Session 工作目录、`shellEnv` 和有效沙箱策略；提权使用 DSH 的 approval 服务。插件不自行授予文件权限。原生可执行文件、OCR 引擎与模型通过 npm 平台可选依赖分发，安装时不要使用 `--omit=optional`。Full CLI 自带模型，普通读取不下载模型。OCR 不可用时先调用 `filens_capacity`；可用 `ocr: false` 关闭。

CLI 默认将输入副本、参数、结果、PDF 渲染图片和 OCR 图片传输放在进程内存中，搜索 worker 共用 **512 MiB 的工作区文件数据额度**，超限报错，不回退到磁盘；此额度不包含 WASM 线性内存、OCR 引擎及传输副本。能力查询、读取、OCR、搜索和摘录已通过 DSH 严格 `read-only` 模式。转换在内存中完成后，仍需权限写最终输出，继续使用同目录暂存与原子提交以避免覆盖或留下半成品。侧栏预览走 DSH 文件读取服务。以上不承诺操作系统不会交换内存页。

默认行为与存储切换：

```sh
filens read report.pdf --json                    # 默认使用内存
filens read report.pdf --workspace disk --json   # 显式使用磁盘临时目录
filens read report.pdf --workspace memory --json # 显式使用内存
```

stdin JSON 也支持 `"workspace": "disk"`。目录遍历器 `hdrw.wasm` 的参数与结果通过 stdin/stdout 交换，只挂载用于读取的 `/scan`，不再创建遍历参数或结果文件。磁盘模式使用同一 WASM 核心，执行完毕或取消后清理临时目录；严格只读模式会拒绝磁盘模式，不会自动切换。内存超限也不会自动落盘。

DSH 可通过现有 `command` 配置传入固定参数，例如 `command: [filens, --workspace, disk]`（CLI 需安装在该 shell 的执行环境中）。默认随包命令无需配置。

新 CLI 要求配套的 OCR 字节输入 ABI；旧 OCR 库会在健康检查中明确报不可用。`pack:local` 会一起构建并打包，不能只替换旧 npm 包中的可执行文件。

## 资源和数据流

Host 的 `/_filens/<digest>/` 只服务构建时枚举的库资源，没有文档路径参数。DSH 通过自己的 Session 文件服务读取文件，然后客户端把字节的**副本**转交预览 iframe；消息同时校验父窗口来源、窗口引用和每个查看器的随机通道。消息中不传 Host 凭据或源文件直链。Web 模式下该可信运行时与 DSH 同源，iframe 不构成独立的身份认证边界。

预览撑满侧栏，界面颜色、字体与语言跟随 DSH；切换外观保留当前文档和页码。文档按格式保留可用的翻页、缩放和键盘操作，Word 页面自动适应侧栏宽度，调整宽度时保留阅读位置。3D 文件隐藏顶部工具栏，窄侧栏也会自动完整取景；直接拖拽旋转、滚轮缩放，双击复位。加载时显示文件名，失败后可展开详情并重试；文件切换会忽略前一个文件的延迟回报。

随包包含压缩包 WASM 和 Worker。CSP 将资源与连接限制在 self/blob/data；现有 iWork 引擎的初始化代码在专用查看器内需要 `unsafe-eval`。预览保留 FiLens 的密码处理及格式限制。DSH 一次提供一个所选文件，依赖其他分卷文件的压缩包未纳入本次验证；原生媒体编解码器和字体也会影响效果。

FiLens 在本地解析文件，但交给 Agent 的文本可能发送到 DSH 配置的模型服务。不能把本地解析等同于整个模型对话都不离开设备。

## 验证与卸载

```sh
npm run build
npm test
npx playwright install chromium
npm run test:browser
# 在专用 filens-test profile 安装本地包后：
DSH_HOME=/tmp/filens-dsh-test npm run test:integration
# 可选：已安装的 macOS 桌面版，同一测试 home 已初始化并安装插件
DSH_TEST_HOME=/tmp/filens-dsh-test npm run test:desktop
```

浏览器测试使用实际构建产物和完整运行时；profile 测试覆盖 DSH 真实 Loader、工具管线、HTTP 服务与启停；桌面测试启动已安装应用，经过真实 Session 文件服务打开文件并保存截图。测试不发送模型提问或使用账号。版本、复现步骤及实测限制见 [VALIDATION.md](VALIDATION.md)。

在同一 profile 中卸载；桌面版需先完全退出：

```sh
dsh plugin --profile web remove dsh-filens
# 或：dsh plugin --profile desktop remove dsh-filens
```

FiLens 自有代码为 MIT。第三方引擎保留各自许可，见 `lib/runtime/THIRD-PARTY-NOTICES.txt`。[接入调研](../../docs/dsh-plugin-feasibility.zh-CN.md)和[社区提案](../../docs/dsh-plugin-proposal.zh-CN.md)整理了贡献渠道；目前未核实开发者分成条件。
