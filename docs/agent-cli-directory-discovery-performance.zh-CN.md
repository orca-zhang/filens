# 原生目录发现：实测与 Windows 估算

当前源码已移除 hdrw 目录读取模块、资源和构建适配。macOS 保留 FTS；Linux 使用 Rust `read_dir`；Windows 在 NTFS 上使用 `GetFileInformationByHandleEx(FileFullDirectoryInfo)`，以 64 KiB 缓冲批量读取名称、属性和大小，不支持时从头回退 `read_dir`。文档解析、转换仍在共享核心。

## 本机对照

2026-11-04，Apple M4 Pro、12 核、24 GiB、macOS arm64。同一批合成目录，每种方式预热一次，再交替启动五个新进程，取 `search.scan.discoveryMs` 中位数。系统缓存保留，没有清空物理磁盘缓存。文件名约 100 字符，每个子目录最多 1000 个文件。

| 文件数 | 旧 hdrw WASI | 旧 CLI 的 FTS | 当前 FTS | 当前 read_dir |
| ---: | ---: | ---: | ---: | ---: |
| 10 | 80 ms | <1 ms | <1 ms | <1 ms |
| 1000 | 190 ms | 1 ms | 1 ms | 2 ms |
| 10000 | 1238 ms | 17 ms | 17 ms | 24 ms |

1 万文件下，原生 `read_dir` 相对旧 hdrw 的目录发现约快 **52 倍**。旧 CLI 自身的 FTS 也为 17 ms，说明目录阶段的主要差别来自 WASI 枚举路径。小目录主要节省 hdrw 解压、模块加载和启动的固定开销。

此处使用本地保留的旧 CLI 作对照，版本与当前 CLI 不同。为避免旧版正文模块缺失，所有对照进程显式指定同一文本 WASM，因此进程总时间还包含 WASM 排名；不能把总时间差全部归因目录读取。表格仅比较目录发现。原始采样和验证范围见 [JSON 记录](agent-cli-directory-discovery-benchmark.json)。这组数据没有执行 Windows NTFS 路径。

## Windows 的工程估算

普通本地 SSD、系统缓存已预热、1 万普通文件分布在适量目录时，当前 NTFS 路径的目录发现可先按 **30–200 ms** 估算；相对 hdrw 以 **5–20 倍** 作为待验证的预期范围。这不是 Windows 实测成绩，也不是保证值。NTFS 批量 API 相比原生 `read_dir` 的额外收益目前未测，可能很小；上表的 52 倍不能归因于 NTFS API。

64 KiB 缓冲每批可容纳数百条普通名称的记录，1 万文件的枚举调用通常为数十次，再加目录打开、属性检查和结束查询。代码直接使用返回的文件大小和属性，无需逐文件查询元数据，也省去目录 WASM 的加载及 JSON 传输。不需要管理员权限，不打开裸盘或遍历全卷 MFT。

文件内容本身的顺序读取速度不由这次改动决定。整体收益取决于目录发现占比：若原来占总耗时 50%，这一阶段快 10 倍，整体约快 1.82 倍；若仅占 5%，整体约快 1.05 倍。PDF 解析、OCR、大文件全文读取仍可能占主要耗时。杀毒扫描、网络盘、冷缓存、机械盘、大量小目录都会改变结果。

## 复现与验证

当前源码的基线对照在 Windows NTFS 主机运行：

```powershell
node scripts/benchmark-agent-walk.mjs
```

默认创建 10000 个合成文件，用文件名模式避开正文解析，预热后交替比较默认后端和 `read-dir`，检查结果一致后输出目录发现和进程总耗时。`FILENS_AGENT_BINARY` 可指定 CLI，`FILENS_BENCH_FILES` 可调整数量（最多 20000）。实际后端记录在输出的 `backend`，非 NTFS 或 API 不支持时会显示 `read-dir`。

本轮已通过 53 项 CLI 单元测试（其中 9 项目录相关测试），FTS 和 `read-dir` 各 44 次真实搜索请求、27 次相似扫描请求。Windows x64、Linux x64 通过编译检查，另已交叉构建 Windows x64 Lite 可执行文件。Windows 原生运行、junction 检查和 NTFS 多批次枚举仍需 Windows 主机或现有 Windows CI 执行。[Windows 测试说明](agent-cli-windows.zh-CN.md)。
