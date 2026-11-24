# DSH 0.1.11 渲染性能复测

2026-11-24（Asia/Shanghai）。实际运行 **DSH Desktop 0.2.3-alpha.2 / Electron 44.11.5**，插件为 **dsh-filens 0.1.11**，共享预览 **0.3.8**。Apple M4 Pro、12 核、24 GiB、macOS arm64。每种格式 9 轮配对，合计 **36 次新进程、216 次实际打开**，正式计时全部成功，无重试或排除计时样本。

0.1.12 仅补齐 Cordis 4.2 兼容声明，渲染与工作台代码和本次实测的 0.1.11 逐文件 SHA-256 相同。

| 格式 · 首开 / 缓存中位数（ms） | FiLens 0.1.11 | DSH 内置 | 首开提速 |
| --- | ---: | ---: | ---: |
| PPTX | **126 / 92** | 1325 / 111 | **10.52×** |
| DOCX | **108 / 92** | 1312 / 112 | **12.15×** |
| PDF | **200 / 108** | 343 / 108 | **1.72×** |

缓存打开的提速分别为 PPTX **1.21×**、DOCX **1.22×**、PDF **1.00×**。PDF 缓存打开均为 **108 ms**，本轮没有缓存速度优势。首页、安装说明和精选性能表统一使用本轮结果，早期报告保留原日期与版本。

## 方法与边界

- 每轮轮换渲染器顺序，每种渲染器使用新的实际 Desktop 进程与隔离配置；两组使用相同插件包，Tools 与 File workspace 均关闭，只在 FiLens 组启用侧栏预览，并断言实际注册状态。
- Office 每个进程按 PPTX、DOCX 顺序各打开四次；PDF 在单独进程中首先打开四次。每次关闭文档标签后再打开。首开中位数来自 9 次首次打开，缓存中位数来自其余 27 次。
- 从 `sidebarRight.openResource` 前计时，到实际预览 ready 加两帧；内置 Office 经实际 Office 转 PDF 服务，内置 PDF 等待可见 canvas。包含读取、解析/转换和渲染，不含应用启动，不调用模型。
- 保留系统文件缓存和持久转换缓存，不代表冷磁盘性能。正式计时不与构建、功能测试或视频编码并行。
- 仅限本机和三份合成文档，衡量时延，不证明版式保真度或其他文件与平台的表现。早期 DSH 0.2.1-rc.5 / FiLens 0.1.3 的结果属于历史数据，不能和本轮当作同一个对照版本。

## 原始记录

- [Office 全部样本](office-preview-0.1.11-dsh-0.2.3-alpha.2.json)
- [PDF 全部样本](pdf-preview-0.1.11-dsh-0.2.3-alpha.2.json)
- [汇总、环境和报告 SHA-256](performance-0.1.11.json)

复现命令（使用已装好同一插件包、按上述条件配置的两个隔离 profile）：

```sh
node scripts/benchmark-dsh-office-preview.mjs --home /path/to/filens-profile --builtin-home /path/to/builtin-profile --rounds 9 --output office.json
node scripts/benchmark-dsh-office-preview.mjs --home /path/to/filens-profile --builtin-home /path/to/builtin-profile --rounds 9 --only-pdf --output pdf.json
```

通过 `DSH_DESKTOP_EXECUTABLE` 指定测试用 Desktop 可执行文件，保持用户现有安装和配置独立。

## English

Measured 2026-11-24 with **dsh-filens 0.1.11 / preview 0.3.8 / DSH Desktop 0.2.3-alpha.2** on Apple M4 Pro, macOS arm64. Nine paired rounds per format, 36 fresh processes and 216 successful opens. First-open speedups are **10.52× PPTX**, **12.15× DOCX**, and **1.72× PDF**. Cached PDF opens are equal at **108 ms**, or **1.00×**. Timing includes reads, parsing/conversion and rendering to ready plus two animation frames, excluding app startup. Filesystem and persistent caches remain. Office and PDF use separate runs; DOCX follows PPTX. These are latency results on three authored files, not a fidelity or universal performance claim. Complete samples, machine details and hashes are linked above.
