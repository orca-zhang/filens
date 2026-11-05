# Agent CLI：本地读取文档与交付证据

## 文档读取优化（0.5.4）

转换方向支持 `docx>?`（DOCX 能转成什么）、`?>pdf`（什么能转 PDF）和 `docx>pdf`（检查指定转换）。CLI 用 `capacity 'docx>?'`，DSH 用 `{"query":"docx>?"}`；`--query` 和 stdin JSON 也支持。`?` 表示任意格式，默认只返回真实的跨格式转换对；同格式项（如 `docx>docx`）不列出，计数也不包含。空集合表示没有匹配的跨格式转换，不推测中转。Shell 中必须引用整个表达式，避免 `>` 重定向和 `?` 展开。

以下接口需要 CLI 0.5.4 及其配套 WASM；CLI 0.5.2 不接受新增 JSON 字段。DSH 插件 0.1.1 需配套 CLI 0.5.4。公开 JSON 请求和响应使用 `op`，能力筛选使用 `forOp`；旧字段 `operation` 和 `forOperation` 会报参数错误。

```sh
# 设计稿：只读第 1–3 页原生文字，避免照片 OCR 杂字
filens read deck.pptx --slides 1-3 --ocr never --json
# 返回图片字节供调用方看图，stdout JSON 携带 base64，不解包落盘
filens read deck.pptx --slides 2 --images --max-images 4 --ocr never --json
filens read report.pdf --pages 2,4 --json
# 默认精简能力查询；需要时才展开格式与转换表
filens capacity --op read
filens capacity --query ocr --section formats
filens capacity --from pptx --to pdf
filens capacity 'docx>?'
filens capacity '?>pdf'
filens capacity --section conversionPairs --format tsv
filens inspect unknown-file --json
filens capacity --json
filens capacity --from pptx --section operations,conversionPairs --json
filens capacity --fields formats --json
filens capacity --full --json
```

能力查询的 `--from` / `--to`、`--op`（操作名或别名）和 `--query` 可组合；`--query` 对元数据做不区分大小写的子串匹配，空白分隔的词全部满足。精确的格式名加操作名（例如 `pptx read`）等价于 `--from pptx --op read`，剩余词继续按 AND 匹配。JSON 字段为 `sourceFormat`、`targetFormat`、`forOp`、`query`。`--op` 只筛选操作说明，格式支持由 `formats` 和真实 `conversionPairs` 判断。没有匹配时返回空集合，不推测中转转换。

不加输出参数的 `capacity` 默认返回短签名和格式 / 转换数量；请求转换列表时，按源格式聚合为单行字符串 `csv>xlsx;ppt>pptx`；`--format tsv/csv` 返回真正的三列表 `section,key,value`，布尔能力以正向标记列出。`--json` 保留结构化接口；`--section` 仅取指定部分；`--full` 保留详细说明与诊断。DSH 模型视图也默认精简，使用 `detail: "full"` 可取完整 JSON。

JSON 请求对应字段为 `ocr: "auto" | "never" | "always"`、`ocrMinConfidence`、`slides`、`pages`、`media`、`images`、`maxImages`、`imageNames`、`sourceFormat` / `targetFormat`、`section` / `fields`、`full`。`slides` 目前支持 OpenXML 演示文件，`pages` 支持 PDF；从 1 开始，支持 `1-3,5`，按文档顺序去重，越界返回退出码 2。其他格式不会猜测物理页码。

`auto` 识别内嵌图片及需要 OCR 的 PDF 页；`never` 跳过全部 OCR（兼容 `--no-ocr`）；`always` 强制 PDF 选中页使用 OCR。默认 `ocrMinConfidence: 0.8`，丢弃分数不足或无分数的 OCR 行，并通过 `warnings`、`ocr_low_confidence` 和退出码 3 明示遗漏。设为 0 可保留无分数结果。**这是文字检测分数，不是识别正确率**，高分也可能认错。保留下来的 OCR 同样附带可靠性警告。主动选择 `never` 后，原生文字范围读取完成即成功（没有其他错误或限制时退出码 0），`content.textScope: "native-text"` 明示不包含图片文字；启用 OCR 则为 `"native-and-ocr"`。`content.ocr.results[]` 按可用的页、slide、shape、media 记录 skipped / complete / partial / failed、保留 / 丢弃行数与原因。真实 OCR 失败和低分遗漏仍返回部分结果。

证据块在可用的页、幻灯片、shape 与来源边界处分开；OCR 块带 `source: "ocr"`、可空的 `confidence`、`confidenceKind: "detection"` 和可用的 `page` / `slide` / `shape` / `sourcePart` / `media`；原生文字为 `source: "text"`、`confidence: null`。PPTX 原生块另附 `shapeName`、`placeholder`（没有占位符为 `none`）和 `maxExplicitFontSizePt`；字号只统计 shape 内显式声明的最大值，不解析继承样式，也不推断标题。`content.pages` 包含空页及选中页的范围；摘录中的页范围改用 `sourceStartByte` / `sourceEndByte` 指向完整提取文本，摘录 block 仍定位到摘录文本。大段文本仍可能在同一来源内拆成有界块。

Office OpenXML 读取默认附带 `content.media[]` 与 `mediaScope: "whole-package"`：条目包含名称、格式、像素尺寸、DPI、ICC 存在标记、字节数、SHA-256、`referenced` 和 `usedBy`（部件、幻灯片、shape、关系）。**清单始终覆盖整份包，包括未选中页和未引用图片。** 缺失或无法解析的尺寸、DPI 返回 `null`，不假设 72/96 ppi；目前 DPI / ICC 检查覆盖 PNG、JPEG，其他格式 ICC 状态为 `null`。`media: false` 或 `--no-media` 可省略清单。它不渲染 Office 版面。

`read --images`（JSON `images: true`）额外返回 `content.images[]` 中的内嵌栅格图片与 `imagesInfo` 数量 / 范围说明，当前支持 OpenXML Office。默认只选中所选幻灯片引用的媒体，按 slide 排序；重复 `--image NAME`（JSON `imageNames`）可按清单名称精确选择，也可检查未引用媒体。`--max-images` 默认 4、最大 16。图片会完整解码，必要时校正方向、缩到最长边 1600 像素并编码为 JPEG / PNG；总图片字节上限 8 MiB，剩余图片或解码失败会明确返回部分结果。CLI 通过 stdout JSON 传 base64；DSH 转成模型可见的图片附件，并从文字 / 工具历史中去掉 base64。返回的是内嵌媒体，不代表 Office 整页渲染、页面裁切或叠加文字。清单用 `inspection` 区分头部检查、完整解码、失败和不支持；未引用坏图会警告，但不把原生文字读取判为失败。

`excerpt` 与 `summarize` 使用同一原文选择器，但返回各自的操作名。无查询且全文不超过 `summaryChars` 时直接返回全文，不受比例压缩；长文按完整句段选择，不从句中截断。预算容不下完整片段时返回空摘录及警告，可增加预算或改用 `read`。转换不支持时，错误附带当前 WASM 实际支持的 `supportedTargets` 与原因，不推测未经验证的中转路线。

[English](agent-cli.md) · 简体中文

filens 负责读取本地文档，向上层 Agent 交付文本、来源与证据片段。0.3.0 提供不依赖 LLM 的 `summarize` / `prune`，按密度、BM25 和相似距离选取关键原文，详见[关键内容提取与实例](agent-cli-pruning.zh-CN.md)。改写总结、问答等语义推理由调用方完成。支持中英文意图，以及 text、JSON、Markdown、HTML、YAML、XML、CSV、TSV 输出和布局信息，也保留可选命令与参数。文档解析与裁剪复用共享前端核心；常见文本搜索直接编译同一份 Rust 源码，其他格式及布局按需调用 WASM。

[68 条实测案例、OCR 效果与自然语言边界](agent-cli-examples.zh-CN.md)列出实际输出，包括不支持的句式、退化行为和识别错误。

详见[多格式输出、坐标布局与打字机动图](agent-cli-formats-and-layout.zh-CN.md)。

0.3.0 提供[跨文件词项搜索](agent-cli-search.zh-CN.md)：中英文入口、BM25/精确匹配/文件名模式、原文证据和请求内存处理；`prune` 继续在已知文件内提取片段。embedding 语义检索尚未实现，公平对照方法见[文档搜索与客观评价方案](agent-cli-search-evaluation.zh-CN.md)。

0.3.0 提供 [Czkawka 风格的重复文件与相似图片扫描](agent-cli-similarity.zh-CN.md)：`filens duplicates ./files --json`、`filens similar-images ./photos --threshold 8 --json`。支持缩放、重新压缩的图片分组，解析和匹配统一在 WASM 核心中，无需 OCR 或模型。使用 `capacity.operations` 检查 `similar`。

## 一键安装

使用 [`filens-cli`](https://www.npmjs.com/package/filens-cli) 安装自带 OCR 的完整版，或选择 [`filens-cli-lite`](https://www.npmjs.com/package/filens-cli-lite) 轻量版。两者都提供 `filens` 命令：

```sh
# 完整版：默认带原生 RapidOCR NCNN 和模型，无 Python 环境
npm install -g filens-cli
filens '读取 "report.pdf"，以 JSON 输出'
filens '你能做什么？以 JSON 输出'

# 或轻量版：仅 CLI + WASM，需要时补装原生 OCR
npm install -g filens-cli-lite
filens setup-ocr
filens '理解 "scan.pdf"，以 JSON 输出'
```

两种包都提供 `filens` 命令，同一安装位置选择一种即可。npm 自动选择当前平台的二进制组件。支持 macOS 12+ arm64、Linux glibc 2.17+ x64 / arm64、Windows 10/11 x64。npm 启动器需要 Node.js 20.11+；也可以直接运行组件包内的原生二进制。已安装的包无需 Python、ONNX Runtime、Homebrew、CMake 或编译器，安装后读取全程离线。

不做全局安装，也可以临时调用：

```sh
npx --yes filens-cli '你能做什么？以 JSON 输出'
# 或不含 OCR 的轻量版
npx --yes filens-cli-lite '你能做什么？以 JSON 输出'
```

0.5.0 在 macOS arm64 上的原生主程序为 **2.17 MiB**；Lite **8.05 MiB 安装 / 6.14 MiB 下载**，Full **31.25 MiB 安装 / 20.34 MiB 下载**，Full 含 OCR 模型。可选前端预览资源单独计量。总体积按启动器加当前平台组件计算，不含 Node.js、npm 缓存和文件系统开销，见[全平台精确字节数](agent-cli-npm-release.json)。FiLens 自有代码与 npm 包元数据使用 [MIT 协议](../LICENSE)，第三方组件保留各自的许可。

需要离线分发时，也可一条命令安装已经生成的本地 tarball，例如 macOS arm64：

```sh
npm install -g ./dist/npm/filens-cli-0.5.0.tgz ./dist/npm/filens-cli-darwin-arm64-0.5.0.tgz ./dist/npm/filens-ocr-darwin-arm64-0.5.0.tgz
```

此前的 [Rust 迁移测量](agent-cli-rust-size.json)及[相似扫描增量](agent-cli-similarity-size.json)保留为历史记录；当前安装体积以以上 0.5.0 报告为准。

## 从源码构建和发布

`cli/` 中的 CLI 已改为 Rust，文档解析仍复用前端 WASM 核心。Release 开启体积优化、LTO、单 codegen unit、panic abort 和符号 strip；Windows/Linux 的 CLI 使用 UPX `--best --lzma`，并通过 `upx --test` 校验。macOS arm64 的可执行格式不受 UPX 支持，因此跳过。文本 WASM 使用 Binaryen `-Oz` 并移除 debug / producers 信息；WASM 引擎使用 gzip level 9 压缩，运行时按需在本机解压，无需外部解压工具。构建机器可运行 `node scripts/setup-agent-upx.mjs` 安装经 SHA-256 校验的固定版本 UPX；构建/打包脚本的 `--no-upx` 可生成未压缩对照。

0.3.0 提供 Windows x64 安装包。见 [Windows 测试包、实机检查和可复制的 Agent 提示词](agent-cli-windows.zh-CN.md)，实际 Windows 运行结果仍待补充。

轻量版源码构建需要 Node.js 20.11+ 和锁定的 Rust 1.93.0 / WASI 工具链，无需 Go 编译器。Linux 和 Windows 构建还需 Zig 0.16.0 与 `cargo-zigbuild` 0.24.0，其中 Linux 保持 glibc 2.17 兼容。完整版仍使用 Go 1.24+ 重编译独立的 Photos 原生 OCR wrapper；首次构建 macOS 完整版还需 CMake 和 Xcode 命令行工具编译 CPU NCNN 库，Windows 则需要 CMake 和 Ninja。npm 用户直接使用预编译库。OCR wrapper 可用 `FILENS_ZIG` 指定 Zig，cargo-zigbuild 使用 PATH 上的 Zig。

```sh
npm run build:agent:lite
./dist/agent-lite/filens '读取 "report.pdf"，以 JSON 输出'

# 为本地轻量版加装原生 OCR
npm run setup:agent:ocr -- --lite --sources 4

# 完整版：原生 OCR 和模型开箱即用
npm run build:agent
./dist/filens '理解 "meeting notes.docx"，以 JSON 输出'

# 在 macOS arm64 上打包四个平台及两种安装入口
cargo install cargo-zigbuild --locked --version 0.24.0
npm run package:agent:npm
npm run test:agent:npm
npm run publish:agent:npm -- --dry-run
# 维护者完成 npm 登录后，先发布平台组件，再发布两个入口包
npm run publish:agent:npm
```

Agent CLI 的发布版本独立记录在 `packaging/agent-release.json`，不改动私有工作区版本；准备下一次发布前应先更新它，已发布版本不可覆盖。产物、体积和 SHA-256 记录于 `dist/npm/release.json`。打包采用文件白名单，包含 NCNN / C++ 运行时许可与构建来源，不包含源码构建缓存或旧 Python 环境。发布脚本先校验 tarball 和 npm 身份，再写入注册表。Linux 和 Windows 二进制通过交叉编译生成；本地安装测试验证宿主平台，CI 已配置 macOS arm64、Linux x64 / arm64 和 Windows x64 的原生安装及 Windows 便携包测试，本轮尚未执行 CI。

全平台打包会自动更新中英文主 README、npm 说明和 `docs/agent-cli-npm-release.json` 中的可执行文件、Lite 与 Full 体积，并重新打包直到文案中的数字与最终产物一致。已有全平台产物可运行 `npm run report:agent:npm` 重新同步；单平台构建保留全平台文档中的现有数据。

读取和摘录每次接受一个本地文件或包内成员路径，`search` 每次接受一个本地目录或支持的压缩包。ZIP、TAR、GZIP 等会自动展开最多 8 层嵌套，保留 `资料.zip!/附件.tar.gz!/合同.pdf` 路径供再次读取、获取布局或摘录，详见[嵌套压缩包用法与实测](agent-cli-search-archives.zh-CN.md)。自然语言中的路径应加引号，尤其是含空格路径；相对路径以调用方工作目录为准。可选命令为 `read`、`extract`、`understand`、`layout`、`summarize` / `prune`、`search`、`capacity` / `capabilities`，可选参数有 `--json`、`--format text|json|markdown|html|yaml|xml|csv|tsv`、`--layout`、`--input`、`--max-bytes`、`--timeout`、`--wasm`、`--no-ocr`。搜索增加 `--query`、`--search-mode bm25|exact|files`、`--max-results`、`--max-files`、`--max-depth`、`--include-hidden` 和 `--no-cache`，详见[搜索指南](agent-cli-search.zh-CN.md)。

## 浏览器预览（0.5.0）

`filens preview FILE` 首次使用自动安装独立的 `filens-preview@0.2.0`，之后可离线运行；
也可提前运行 `filens setup-preview`。该前端包包含两种构建，安装体积与基础 CLI
分开计量，见[包体积实测](preview-package-sizes.json)。

**CLI 0.5.0 默认生成独立 HTML**，嵌入共享前端引擎、原文件副本和第三方许可说明，
通过 `file://` 打开后 CLI 即退出，无需启动服务器，可离线使用。
`--output preview.html` 保存到指定路径且不覆盖已有文件；`--no-open --json` 返回
文件 URL 和路径。默认临时 HTML 会保留，内含原文件副本，使用后可自行删除。
页面检查 WASM / Worker 能力，显示 GitHub 链接，并通过 CSP 禁止外部连接及资源加载。
浏览器内部失败会显示 `--mode serve` 兼容模式提示，CLI 无法仅凭启动成功判断渲染成功。
Safari / WebKit 的 iWork 预览需使用 HTTP 兼容模式。较大文件可使用兼容模式，避免 Base64 嵌入产生的额外体积与内存占用。

`--mode serve --no-open --json` 保留原来的 HTTP 地址、常驻服务及 Ctrl-C 退出行为；
`--port` 未配合显式 `--mode` 时也使用 HTTP 模式。
`capacity.preview.available` 检查默认 HTML 所需资源，`capacity.preview.modes` 分别报告
HTML / HTTP 可用性。源码构建可用
`npm run build:agent:preview`，也可用 `--assets DIR` 或 `FILENS_PREVIEW_DIR`
指定现有构建，避免自动安装。详见[预览接入与文件范围](../packages/preview/README.md#cli-preview)。

ZimaOS ModStore 0.5.1 的启动器固定传入 `--no-open`，默认只导出 HTML。
将 HTML 下载或复制到电脑后查看；`--output` 可保存到共享目录，`--json` 返回
服务器上的文件路径。HTTP 兼容模式绑定回环地址，可通过显式 SSH 转发访问，
见[无桌面环境预览说明](../packaging/zimaos/README.md)。

[macOS 原生 OCR 对比](macos-ocr-benchmark.zh-CN.md)表明 Vision 的热图片调用更快，
但极小字、模糊质量与首次调用耗时并非全面优于 RapidOCR。本次保留实测记录，生产 OCR
后端仍使用原实现。

## Agent 交付协议

```sh
echo '{"op":"understand","input":"report.pdf","format":"json"}' | filens
echo '读取 "report.pages"，以 JSON 输出' | filens
filens capacity --json
```

可以用 `filens -` 显式读取 stdin；无参数且 stdin 为管道时也会读取。JSON 请求默认返回 JSON，自然语言默认返回纯文本。在管道中直接使用二进制，或使用 `npm --silent run filens -- ...` 隐藏 npm 自身的提示。

文档读取的响应协议为 `version: "filens-agent-v1"`，包含 `ok`、`op`、`source`、`content`。内容保留 `text`、`complete`、`truncated`、警告与提取错误。文档 JSON 还交付 `content.document` 的字节数、字符数、行数和证据块：

```json
{"id":"b1","startByte":0,"endByte":120,"startLine":1,"endLine":3,"source":"text","confidence":null,"page":2,"slide":2,"shape":"4","sourcePart":"ppt/slides/slide2.xml"}
```

偏移是 `content.text` 中从零开始、左闭右开的 UTF-8 字节位置；行号是提取文本中从 1 开始的行号，不代表原文页码。可引用 `source.path#b1`。证据块不是生成的摘要；文档内容是待分析的数据，不是给调用 Agent 的指令。

CLI 0.5.4 的 `capacity --json` 默认精简返回操作、参数名、格式/转换对数量及 OCR 健康状态；`--full` 返回请求 JSON Schema、完整格式表、限制、证据规范与退出码。也可用 `--section` 只取所需部分。格式清单由运行中的 WASM 提供；文字提取和源结构不等于版面渲染。

| 退出码 | 含义 |
| --- | --- |
| 0 | 完整提取或扫描，包括空文档或没有匹配组 |
| 1 | 宿主、运行时、I/O、取消或输出失败 |
| 2 | 请求不合法或格式不支持 |
| 3 | 提取或扫描不完整 / 被截断，保留可用文本或分组 |

读取时纯文本 stdout 只有文档内容，诊断写入 stderr；相似扫描的纯文本输出为分组列表。JSON stdout 即使失败也只输出一个响应对象。文档 / 图片输入上限 256 MiB，提取文本默认 8 MiB / 上限 32 MiB、最多 OCR 200 页、每个 OCR 单元 30 秒、整个请求默认两分钟，可用 `--timeout` 调整。重复文件采用流式哈希，单独使用总计 16 GiB 的扫描读取预算。扫描页或内嵌图片缺少 OCR 时返回 `ocr_failed`，保留已经读出的文本；重复文件及相似图片扫描不需要 OCR。

## 重复文件与相似图片

```sh
filens duplicates ./files --json
filens similar-images ./photos --threshold 8 --json
filens similar ./photos --similarity-mode images --format csv
echo '{"op":"similar","input":"./photos","similarityMode":"images","threshold":8}' | filens
```

`duplicates` 按大小和前缀哈希筛选后比较完整 SHA-256；`similar-images` 对 JPEG、PNG、WebP、GIF、BMP、TIFF 计算感知哈希，可将缩放或重新压缩后的副本分到一组。两者响应均为 `op: "similar"`。图片阈值为汉明距离（0–24，默认 8），不是相似百分比；每组有参考图，可能误匹配，距离 0 也不代表文件完全相同。

结果在 `similarity.groups` 中，成员路径相对 `source.path`。检查 `similarity.complete`、`truncated`、`scan` 和 `processing`；错误或限制会保留可用组并返回退出码 3。默认扫描 2000 个候选文件、深度 32、返回 100 组，可用 `--max-files`、`--max-depth`、`--max-results`、`--include-hidden`、`--timeout` 调整。扫描只报告分组供核对，每次重新计算指纹。限制、参考图分组语义、链接处理、帧 / 方向规则及源码构建见[完整指南](agent-cli-similarity.zh-CN.md)。

## 文件转换与 Agent Skill

```sh
filens convert report.doc report.docx
filens convert data.csv --to xlsx
filens convert photo.dng --output photo.jpg --json
echo '{"op":"convert","input":"report.rtf","output":"report.docx","options":{"locale":"zh-CN"}}' | filens
```

支持的转换格式对由正在运行的 WASM 返回，见 `capacity.conversionPairs`。
CLI 复用前端文档和图片引擎及其输出校验，不另写解析器。可读取不代表可转换；
现有路由包括旧 Office / OpenDocument / 文本转 OpenXML、CSV / JSON 转 XLSX、
相机 RAW 转 JPEG、ICNS / PPM 转 PNG，不支持 DOCX 转 PDF。
`--to` / `--target` 选择目标文件格式，`--format` 选择响应序列化格式；
默认根据输入、输出扩展名推断格式，也可用 `--from` / `--source` 覆盖输入扩展名。
转换默认返回 JSON，包括 `conversion` 元数据和 `output.path`，应检查保真度及警告。

成功后才原子写入目标文件；已有目标需显式 `--force` / `force:true`，不允许覆盖输入本身。
失败或取消保留原有目标。退出码继续使用 0 / 1 / 2 / 3 分类，`error.code` 保留核心具体错误。
`--password`、`--locale` 会透传给 WASM，JSON 请求也可使用 `options` 对象。

[FiLens Skill](../skills/filens/SKILL.md) 带标准 YAML front matter，两个 npm 入口包均包含
`skills/filens/`；源码构建分别放在 `dist/skills/filens/` 和 `dist/agent-lite/skills/filens/`。
将整个 `filens` 技能文件夹复制到目标 Agent 的技能目录即可；本仓库中供 Codex 使用的例子：

```sh
mkdir -p ~/.codex/skills
cp -R skills/filens ~/.codex/skills/
```

## 原生 OCR、图片预处理和文档回调

采用 RapidOCR NCNN：PP-OCRv6 small 检测、mobile v2 方向分类、PP-OCRv3 中英文识别。默认 **最大边长 960、补边 50、OpenMP 线程 2**，开启文字方向分类。检测阶段按比例缩放并对齐网络尺寸，识别阶段单独处理文字行裁剪。Photos 原生运行时负责 EXIF 方向、白色补边、通道 / 归一化和文字行 0 / 180 度分类；WASM 在回调前将透明 PNG 合成到白底。960 是实用默认值，超大扫描件中的细小文字仍可能影响准确率。

独立图片和文档内嵌图片共用 OCR 回调。WASM 负责提取图片、确定阅读顺序、复用重复图片结果，以及决定 PDF 哪些页需要 OCR；Rust 宿主把临时图片路径交给隔离的原生 worker。同一文档中相同图片只识别一次，并在各自位置插入结果。PDF 优先读取文本层，扫描页通过固定版本的 PDFium WASM 渲染。Wasmi 为两个引擎分别设置 512 MiB 内存上限。文档提取仅向文本引擎挂载本次请求的临时目录；相似扫描额外挂载所选根目录，由核心按发现清单读取文件。原有 Go 提取库保留供现有集成使用。

OCR worker 是 CLI 自身的隔离子进程，延迟启动并复用，通过 NCNN JSON ABI 加载库和本地模型，不需要解释器。取消或超时会终止 worker，后续 OCR 单元可启动新进程；线程限制在启动前和原生 load / infer 请求中同时传递。CPU NCNN 库使用内置 SimpleOMP，不依赖外部 libomp / libgomp。

## PDF Unicode 恢复与报告隐私

文本 WASM 会按字体修复支持的 ToUnicode 错误，保留正确映射。
检测到不可用映射时，即使原始提取结果非空，也会转入 OCR；轻量版此时需要
补充 OCR 能力。缺失字体还可能导致数字画错，OCR 无法保证金额和表格可靠。
详见 [PDF 恢复范围与公开样本回归](pdf-unicode.md)。

文件读取留在本机。普通 JSON 响应包含 `source.path` 和提取正文，分享前需要
自行脱敏。PDF 评估器把私有样本和原始响应保存在 Git 忽略的位置，并从公开
报告排除。发布构建映射 Rust 源码路径，所有 OCR wrapper 使用 Go `-trimpath`；
打包和发布前检查文件及 tarball 中的个人路径、签名 URL 和凭据。
详见[发布隐私检查](release-privacy.md)。修复随 0.5.0 发布，旧版 npm 包保持不可变。

## 多源测速下载

```sh
# npm 安装：补装组件；需要重新测速下载时刷新用户缓存
filens setup-ocr
filens setup-ocr --sources 4 --refresh

# 源码安装：下载模型、重新测速或安装完整原生 OCR
npm run download:agent:models -- --sources 4
npm run download:agent:models -- --sources 4 --refresh
npm run setup:agent:ocr -- --lite --sources 4
```

默认 ModelScope、HF Mirror、Hugging Face 三源，第四路为 ModelScope API。参考 Photos 策略：各源并发探测前 256 KiB 的有效速度，选择速度至少为最快源 20% 的 Range 源，每个文件最多四连接下载 1 MiB 分块；不支持 Range、连接失败或校验失败时，回退完整文件下载并继续尝试其他源。多份模型文件也同时下载。

每个文件固定提交、大小和 SHA-256，缓存也校验，只有完整验证的临时文件才替换本地文件。原生库下载复用同一传输层。npm 完整包已经内置模型，常规安装和读取不触发模型下载。清单见 [models.json](../converter/rapidocr/models.json) 与 [runtime.json](../converter/rapidocr/runtime.json)。

源码版测速报告位于 `dist/models/rapidocr-ncnn/download-report.json`；Lite 对应 `dist/agent-lite/models/rapidocr-ncnn/`。npm 按需组件和刷新模型使用 `~/.cache/filens/<版本>/<平台>/`，可用 `FILENS_CACHE_DIR` 指定位置。刷新只修改用户缓存，不写入已安装的包目录。

受控部署可用 `FILENS_TEXT_WASM`、`FILENS_OCR_LIBRARY`、`FILENS_OCR_MODEL_DIR` 指定核心、原生库和模型；源码构建可通过 `FILENS_NCNN_LIBRARY` 提供可移植的 macOS NCNN 库。`--no-ocr` 显式关闭 OCR。

只需要文档正文、希望避免插图或 Logo 的 OCR 杂字时，可运行：

```sh
filens read report.docx --no-ocr --json
filens summarize report.docx --no-ocr --query '预算' --json
filens search ./documents --no-ocr --query '预算' --json
```

这会跳过所有图片和扫描页的文字识别，保留可直接解析的正文；扫描件或重要图中文字仍需开启 OCR。它不是低置信度文字过滤器。已发布 CLI 0.5.2 在跳过图片时仍可能返回退出码 `3`、`ocr_failed` 或不完整标记；CLI 0.5.4 主动选择原生文字范围后可成功完成，用 `textScope: "native-text"` 和跳过警告标明范围，真实失败仍为部分结果。OCR 可能将装饰图案识别为杂字，关键数字、日期和不确定片段应对照原件核实。DSH 的全局配置及单次调用参数见[插件说明](../integrations/deepseek-harness/README.zh-CN.md#减少图片-ocr-噪声)。

## 验证

源码版还提供 `npm run test:agent:search`、`npm run test:agent:prune`、`npm run test:agent:similarity`。相似扫描通过实际 CLI/WASM 检查完整文件判重、图片分组、部分结果、链接、限制和八种输出。原生遍历测试覆盖范围、限制、链接及 NTFS 多批次读取；Windows 原生执行仍需 Windows CI 验证。具体检查及平台范围见[验证记录](agent-cli-similarity-size.json)。

`npm run test:agent` 覆盖中英文意图、JSON / UTF-8 证据、截断与空文档、Lite 注入 OCR、真实 PNG / 双页扫描 PDF / DOCX 内嵌图片、透明 / EXIF / 倒置预处理、取消和重启，以及下载器的并发、损坏源回退和缓存。`npm run test:agent:npm` 覆盖离线安装 Full / Lite tarball，以及无需 Python 的一键补装 OCR；追加 `-- --registry` 可验证全新缓存的公开 npm 安装、平台组件自动选择和临时调用。0.5.0 已在 macOS arm64 上通过 Full / Lite 离线安装和全新缓存的匿名公开 npm 安装验证，包含真实 OCR、转换、嵌套压缩包搜索与读取、布局、一键补装 OCR 和首次预览自动安装。全部 11 个公开包的实际下载校验和与本地 tarball 一致，许可证字段为 MIT；CLI 组件的 latest 为 0.5.0，filens-preview 为 0.2.0。前端包另通过 48 项直接预览、10 项 Vite 打包后预览，以及隔离环境下两个 TypeScript 导出入口检查，见[发布与验证记录](agent-cli-npm-publish.json)。Linux / Windows 已交叉构建，原生安装与运行仍待实机验证。既有转换 CLI / HTTP 示例继续使用原来的接口。

ModStore 0.5.1 内置共享前端单文件引擎，支持无浏览器环境下离线导出 HTML。版本化 raw 下载已验证大小与 SHA-256；索引、CDN 缓存状态和 npm 来源包完整性见[ModStore 发布记录](agent-cli-modstore-publish.json)。
