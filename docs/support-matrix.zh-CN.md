# 格式支持矩阵

[English](support-matrix.md) | 简体中文

filens 在现代浏览器中提供只读文件预览。当前完整预览宿主覆盖 **450 种源文件格式**，按扩展名去重统计，包含直接预览与本地 WASM 转换后预览。支持某种格式，不代表完整兼容该格式的原始编辑软件。

已于 **2026-11-05** 对照当前源码核对。Vue 默认路由共注册 **451 个唯一扩展名**：319 种直接预览源格式、131 种转换后预览源格式，以及内部 `cad-json` 图纸模型入口。450 种源文件的统计不包含该内部入口；自定义路由或旧版本的覆盖范围可能不同。

演示台只列出已支持的格式，区分“可预览示例”和“已支持，需导入”。缺少示例不等于缺少解码能力；HEIC/HEIF 已有媒体驱动和本地 WASM 解码兜底，并提供原格式示例。

| 查找内容 | 对应章节 |
| --- | --- |
| 格式、扩展名与预览路径 | [格式总览](#格式总览) |
| 转换源格式、目标格式与运行要求 | [转换支持](#转换支持) |
| PPM 编码、色深、限制与验证 | [PPM 转换](#ppm-转换) |
| 相机 RAW 扩展名与解码限制 | [相机 RAW 转换](#相机-raw-转换) |
| 具体功能与保真度限制 | [保真度与功能明细](#保真度与功能明细) |
| API、Vue 组件、字体与配套资源 | [集成支持](#集成支持) |
| 尚无内置预览路径的格式与工作流 | [暂不支持的格式与工作流](#暂不支持的格式与工作流) |

较长的功能表可点击标题展开。所有表格均可在 GitHub Markdown 中直接阅读；查找扩展名或具体功能时，可使用页面查找功能。

## 阅读说明

<details>
<summary>展开预览路径、功能状态与集成要求</summary>

| 预览路径 | 含义 |
| --- | --- |
| **直接预览（Direct）** | 浏览器预览驱动直接打开源文件，无需转换适配器。部分驱动仍需加载自身的 WASM 依赖，例如 STEP 导入。 |
| **转换后预览（Convert）** | 转换适配器先生成可预览的文件。浏览器 WASM 客户端在本地运行；HTTP 适配器调用配置的服务。 |

| 功能状态 | 含义 |
| --- | --- |
| **支持（Supported）** | 已实现常见内容或操作，具体边界见对应说明。 |
| **部分支持（Partial）** | 已实现可用的功能子集，部分内容、格式或行为会被简化或省略。 |
| **实验性（Experimental）** | 是否可用取决于具体文件、相机元数据、编解码器或回退路径。 |
| **暂不支持（Unavailable）** | 当前发布实现尚未提供该功能。 |

| 适用范围 | 要求或边界 |
| --- | --- |
| 下方格式总览 | 描述 Vue `Preview` 宿主组合的预览路由。 |
| 仅使用核心包的集成 | 需要注册相应包的驱动与路由。 |
| 转换路由 | 需要配置转换适配器。 |
| 渲染与播放 | 结果受浏览器解码能力、可用字体和外部资源影响。 |

</details>

## 格式总览

### Office 与文档

| 格式 | 扩展名 | 预览路径 | 支持范围 | 限制 |
| --- | --- | --- | --- | --- |
| PowerPoint | `pptx` | 直接预览 | 幻灯片、文本、图片、表格与常见形状。 | SmartArt 与样式仅部分支持；见[功能矩阵](#pptx)。 |
| Word | `docx` | 直接预览 | 通过 `docx-preview` 渲染；重复图片复用资源，支持取消与安全切换文件。 | 版式与字体保真度因文件而异。 |
| Excel / CSV | `xlsx`, `csv` | 直接预览 | 只读工作表、基础公式、按批次加载行；支持取消与安全切换文件。 | 计算与样式仅部分支持；见[工作簿矩阵](#文档与工作簿)。 |
| PDF | `pdf` | 直接预览 | 打开 PDF 时才加载 PDF.js 引擎；画布预览、页码导航、缩放 / 适应与按需渲染。 | 暂未提供文本搜索 / 选择层。 |
| Apple iWork | `key`, `pages`, `numbers` | 直接预览 | 原生解析，提供幻灯片、页面与工作表视图。 | 版式与内容保真度仅部分支持；见[iWork 矩阵](#原生-iwork)。 |
| 其他 Office、WPS 与 OpenDocument | [转换扩展名](#转换支持) | 转换后预览 | 统一转换为 `pptx`、`docx` 或 `xlsx`。 | 保真度取决于源文件；宏会被移除。 |

### 图片、音频、视频与全景

| 格式 | 扩展名 | 预览路径 | 支持范围 | 限制 |
| --- | --- | --- | --- | --- |
| 浏览器图片 | `png`, `jpg`, `jpeg`, `gif`, `webp`, `avif`, `apng`, `ico`, `svg`, `bmp` | 直接预览 | 缩放、适应宽度或高度、平移、旋转、全屏。 | 是否可用取决于浏览器解码能力。 |
| HEIC / HEIF | `heic`, `heif` | 直接预览；本地 WASM 回退 | 静态主图；回退保留源位深，支持 ICC 或固定 PQ/HLG 到 sRGB 预览。 | 不支持纯序列文件或增益图还原。回退限制：输入 64 MiB、6400 万像素、单边 16,384 像素、ICC 4 MiB、解码 30 秒。 |
| TIFF | `tif`, `tiff` | 转换 → `png` | 首页、常见压缩、灰度/RGB 与 16 位图像，应用方向信息。 | 需要 `graphicsWasm`；8 位预览，不保留后续页和印刷色彩配置。 |
| 其他位图 | `tga`, `pgm`, `pbm`, `pnm`, `dds`, `hdr`, `dib`, `cur`, `pcx`, `exr`, `jxl`, `qoi`, `ff` | 转换 → `png` | 本地 WASM 解码为 RGBA，含光标/TGA 透明通道、索引色/RGB PCX、DXT DDS 纹理，以及 HDR/EXR 线性采样转 sRGB。 | 输入 64 MiB、3200 万像素；DDS 仅首个表面、JXL 仅首帧、CUR 仅最大图像；EXR 使用默认图像和颜色通道；HDR/EXR 降为 8 位动态范围。 |
| Apple 图标 | `icns` | 转换 → `png` | 提取最大的内嵌 PNG 图标。 | 不解码原始图标平面或 JPEG 2000 数据块。 |
| Windows 应用图标 | `exe`, `dll`, `mui`, `mun` | 转换 → `png` | 共享 WASM 核心从 PE 资源中提取 PNG 或受支持的 DIB 图标。 | 仅预览图标，不执行程序；还可显式调用 APK/IPA 图标提取与 ICO 规范化转换。 |
| PPM 图片 | `ppm` | 转换 → `png` | P3 文本、P6 二进制、注释、任意最大色值与 8/16 位 RGB。 | 多图像流仅读取首张；见[解码、运行时与验证边界](#ppm-转换)。 |
| 相机 RAW | `dng`, `cr2`, `cr3`, `nef` 等，[完整列表](#相机-raw-转换) | 转换 → `jpg` | 提取内嵌 JPEG 或生成轻量传感器预览。 | 不提供完整 RAW 显影。 |
| 音频 | `mp3`, `wav`, `aac`, `m4a`, `flac`, `ogg`, `oga`, `opus` | 直接预览 | 浏览器原生播放与控件。 | 编解码器支持因浏览器而异。 |
| 视频 | `mp4`, `webm`, `mov`, `m4v`, `ogv`, `mkv`, `avi`, `mpeg`, `mpg`, `3gp` | 直接预览 | 浏览器原生播放与控件；可选[本地 MP4/MOV 恢复](browser-media-engine.md)。 | 识别扩展名不代表能够解码；本地恢复需显式开启，无法保留的轨道会报不支持。 |
| 等距柱状全景 | `pano`, `panorama`, `360`；视频：`360v`, `vr360` | 直接预览 | Three.js 球面渲染。 | 视频需要浏览器可解码的媒体源。 |
| 相机原生全景 | `insp`, `insv`, `osv` | 直接预览；按需进行 WASM 处理 | 实验性的标定镜头渲染或已支持的回退路径。 | 依赖相机元数据、编解码器与配套文件；见[要求](#全景与实况照片样例)。 |

### CAD、3D、思维导图与图示

| 格式 | 扩展名 | 预览路径 | 支持范围 | 限制 |
| --- | --- | --- | --- | --- |
| Photoshop | `psd`, `psb` | 转换 → `png` | 前端 WASM 核心解码文件中保存的合成图。 | 8 位 RGB / 灰度；不提供图层编辑或 ICC 处理。[设计稿预览限制](design-preview.md)。 |
| Illustrator / PostScript | `ai`, `eps`, `ps` | 转换 → `pdf` | PDF 兼容 AI 保留 PDF 原始字节；受支持的 PostScript 转为矢量 PDF，PS 保留多页。 | 预览子集；缺失字体或不支持的绘图会明确报错；EPS/PS 模块按需加载。[兼容范围与下载体积](design-preview.md)。 |
| 二维 CAD | `dxf` | 直接预览 | SVG 几何图形、文本、图层、块与栅格图像引用。 | 实体与文本保真度仅部分支持；见[DXF 矩阵](#dxf-cad)。 |
| DWG 图纸 | `dwg` | 转换 → `cad-json` | WASM 直接读取图纸模型，复用 SVG 二维预览器。 | 需要 `cadWasm`、`graphicsWasm` 或合并核心；实体、外部参照和 SHX 字体仅部分覆盖。见[DWG 限制](#dwg-与-cad-图纸模型)。 |
| CAD 图纸模型 | `cad-json` | 直接预览 | DWG 转换输出的内部图纸模型交换格式。 | schema 版本为 1，带 DWG 源格式元数据；不计入源文件格式数量。 |
| CAD 实体 | `step`, `stp` | 直接预览 + truck Rust WASM | 按需加载并三角化，用于查看。 | 不提供 CAD 编辑。 |
| 3D 模型与场景 | `stl`, `obj`, `ply`, `gltf`, `glb`, `3mf` 等，[完整列表](#3d-模型与检查) | 直接预览 | Three.js 网格、材质与场景。 | 材质与资源限制因格式而异。 |
| 刀路、点云、体素、动作与分子 | `gcode`, `gco`, `nc`, `pcd`, `xyz`, `vtk`, `vox`, `bvh`, `pdb`, `nrrd`, `nhdr` | 直接预览 | 支持部分数据子集。 | 见[导入与检查矩阵](#3d-模型与检查)。 |
| 思维导图 | `mm`, `opml`, `xmind`, `mmap` | 直接预览 | FreeMind、OPML、XMind、MindManager 主题树。 | 布局保真度有限；仅提供只读交互。 |
| 流程图与图示 | `drawio`, `dio`, `vdx`, `vsdx` | 直接预览 | diagrams.net 与基础 Visio 页面、形状、标签和连接线。 | Visio 保真度有限；不提供编辑。 |

### 文本、电子书与压缩包

| 格式 | 扩展名 | 预览路径 | 支持范围 | 限制 |
| --- | --- | --- | --- | --- |
| 纯文本 | `txt`, `text`, `log` | 直接预览 | UTF-8 文本显示。 | 只读。 |
| 代码、标记与配置 | 示例：`js`, `ts`, `py`, `go`, `json`, `xml`, `yaml`, `toml`, `ini`, `md`, `tex` | 直接预览 | 语言元数据、行号、不自动换行的源码显示；20 万字符以内提供轻量语法高亮。 | Markdown、LaTeX、Mermaid 等按源码显示。 |
| HTML / XHTML | `html`, `htm`, `shtml`, `xhtml`, `xht`, `xhtm` | 直接预览 | 沙箱 iframe，支持 URL、HTML data URL 与内联片段。 | 沙箱禁用脚本。 |
| EPUB | `epub` | 直接预览 | 按 spine 顺序显示 XHTML 章节，支持 CSS 导入、字体、背景图与 SVG 图片引用，以及本地或应用解析的资源。 | 暂不提供高级电子书导航与主题。 |
| 漫画书 | `cbz`；`cbr`, `cb7`, `cbt` | 直接预览 | CBZ 提供图片页面序列；CBR/CB7/CBT 复用 RAR/7z/TAR 浏览与逐张图片预览。 | 连续翻页阅读仅限 CBZ；CBR/CB7 需要独立压缩包引擎资源。 |
| ZIP 兼容压缩包 | `zip`, `jar`, `war`, `ear`, `apk`, `ipa`, `xpi`, `crx` | 直接预览 | 文件列表、目录与嵌套压缩包浏览、条目预览、提取辅助函数。 | 只读；没有批量解压界面；CRX2/CRX3 读取 ZIP 内容，不验证签名。 |
| ZIPX | `zipx` | 直接预览 + WASM | 复用 ZIP 解码器，支持 Deflate、Deflate64、BZip2、LZMA；提供列表、嵌套浏览和条目预览。 | 需要独立压缩包引擎；部分 WinZip 专有压缩方式可能无法读取。 |
| RAR / 7-Zip | `rar`, `7z` | 直接预览 + WASM | 文件列表、嵌套浏览、条目预览、密码、加密文件名、固实压缩与分卷。 | 需要独立压缩包引擎和完整分卷；受共享压缩包限制约束。 |
| 压缩流 | `bz2`, `bzip2`, `xz`, `lzma`, `lzma86`, `zst`, `zstd`, `z`；TAR 别名 `tbz`, `tbz2`, `txz`, `tlz`, `tzst`, `taz` | 直接预览 + WASM | 单文件解压；压缩的 TAR 直接展开目录；`.cpio.xz` / `.cpio.zst` 也直接展开 CPIO 目录。支持 BCJ 过滤的 LZMA86 和 BZip2/XZ/Zstandard 拼接流。 | 需要独立压缩包引擎；输出上限 128 MiB，也适用于未声明解压大小的流；Unix compress 没有校验和。 |
| AR / Debian / CPIO | `ar`, `deb`, `cpio` | 直接预览 + WASM | 浏览目录、预览条目；Debian 包内的 control/data 压缩包复用同一套嵌套读取器。 | 只读；不安装或运行软件包；归档中的链接不展示。 |
| LHA / XAR / RPM | `lha`, `lzh`, `xar`, `rpm` | 直接预览 + WASM | LHA/LZH 归档条目，含 LH5/LH6；XAR 的 zlib/BZip2 内容；RPM 压缩 CPIO 内容复用嵌套读取器。 | 只读浏览与文件预览，不安装或运行软件包。 |
| Windows 镜像 | `wim`, `esd` | 直接预览 + WASM | 浏览单个或多个映像中的文件，支持 LZX、XPRESS 和 solid LZMS 解码。 | 需要独立压缩包引擎；不支持分卷 SWM 和安装映像。 |
| Cabinet / 光盘镜像 | `cab`, `iso`, `udf` | 直接预览 + WASM | Cabinet 文件浏览，含 MSZIP；ISO 9660 / Joliet / UDF 目录与文件；`.iso` 按需回退至 UDF 读取器。 | 需要独立压缩包引擎；不提供挂载或安装。 |
| TAR / GZIP | `tar`, `tgz`, `tar.gz`, `gz` | 直接预览 | TAR/TGZ 文件列表，支持 PAX / GNU 长路径；GZIP 单文件提取。 | 只读。 |
| 其他可读取输入 | 示例：`fb2`, `eml`, `msg`, `ics`, `vcf` | 转换 → `docx` | 提取内容用于预览。 | 具体转换对以转换清单为准。 |

| 扩展名列表 | 准确范围 |
| --- | --- |
| 代码与可读取输入示例 | 仅为示例，并非完整列表。应用实际启用的格式可通过[路由查询辅助函数](#路由与数据源加载)获取。 |
| 允许的转换对 | 以[共享清单](../wasm/converter-core/manifest/conversions.json)与可选的[图像清单](../wasm/converter-image/manifest/conversions.json)为准。 |

## 转换支持

下列转换用于生成预览文件，不保证保留源文件的全部特性。准确的转换对以上方链接的清单为准。

| 源格式类别 | 源扩展名 | 目标格式 |
| --- | --- | --- |
| PowerPoint 二进制 / WPS 演示 | `ppt`, `pps`, `pot`, `dps`, `dpt` | `pptx` |
| PowerPoint 放映、模板与启用宏的文件 | `pptm`, `ppsx`, `ppsm`, `potx`, `potm` | `pptx` |
| OpenDocument / 旧版 OpenOffice 演示与绘图 | `odp`, `otp`, `fodp`, `sxi`, `sti`, `odg`, `otg`, `fodg`, `sxd`, `std` | `pptx` |
| Word 二进制 / WPS / RTF | `doc`, `dot`, `wps`, `wpt`, `rtf` | `docx` |
| Word 模板与启用宏的文件 | `docm`, `dotx`, `dotm` | `docx` |
| OpenDocument / 旧版 OpenOffice 文本 | `odt`, `ott`, `fodt`, `sxw`, `stw` | `docx` |
| 文本、标记、配置、模板、代码、电子书、消息等可读取内容 | 示例：`txt`, `md`, `html`, `xml`, `yaml`, `js`, `py`, `epub`, `fb2`, `eml`, `mbox`, `msg`, `oft`, `mht`, `mhtml` | `docx` |
| Excel 二进制 / WPS 表格 | `xls`, `xlt`, `et`, `ett` | `xlsx` |
| Excel 模板与启用宏的文件 | `xlsm`, `xltx`, `xltm` | `xlsx` |
| OpenDocument / 旧版 OpenOffice 表格 | `ods`, `ots`, `fods`, `sxc`, `stc` | `xlsx` |
| 表格型输入 | `dbf`, `slk`, `dif`, `csv`, `tsv`, `tab`, `psv`, `json`, `jsonl`, `ndjson`, `jsonlines`, `ldjson` | `xlsx` |
| DWG 图纸 | `dwg` | `cad-json`（默认预览）、`dxf`（显式转换） |
| TIFF 与其他位图 | `tif`, `tiff`, `tga`, `pgm`, `pbm`, `pnm`, `dds`, `hdr`, `dib`, `cur`, `pcx`, `exr`, `jxl`, `qoi`, `ff` | `png` |
| 相机 RAW | [完整 RAW 列表](#相机-raw-转换) | `jpg` |
| Apple 图标 | `icns` | `png` |
| 应用图标 / ICO 规范化 | `apk`, `ipa`, `exe`, `dll`, `mui`, `mun`, `ico` | `png` |
| PPM 图片 | `ppm` | `png` |
| Photoshop 已保存合成图 | `psd`, `psb` | `png` |
| Illustrator / PostScript 设计稿 | `ai`, `eps`, `ps` | `pdf` |

### 默认路由

| 输入 | 默认预览 | 可选转换目标 |
| --- | --- | --- |
| `csv` | 直接作为工作簿预览 | `xlsx` |
| `json` | 直接显示源码 | `docx` 或 `xlsx` |
| `html` | 直接使用沙箱 iframe | `docx` |
| `epub` | 直接使用电子书驱动 | `docx` |
| `dwg` | 转为 `cad-json` 后使用 CAD 驱动 | `dxf` |
| `apk`, `ipa` | 直接浏览压缩包 | `png`（应用图标） |
| `ico` | 直接作为浏览器图片预览 | `png` |
| `ppm` / `image/x-portable-pixmap` | 转为 PNG 后使用图片驱动 | `png` |

| 规则 | 行为 |
| --- | --- |
| 默认优先级 | 直接预览路由优先于转换路由。 |
| 宿主覆盖 | 可提供自定义路由，改为选择转换。 |

### 转换保真度

| 源格式或结果 | 当前边界 |
| --- | --- |
| 启用宏的 OpenXML | 转换前移除宏部件。 |
| 加密 Office | 受支持的现代 OpenXML 和旧版 DOC/XLS/PPT 加密文件可用密码打开。拆分核心需要 `officeWasm`；缺失密码与密码错误分别报错。不代表覆盖所有加密方案。 |
| 旧版二进制、ODF 与表格型输入 | 版式、样式、媒体、图表、公式与嵌入对象可能被简化或省略。 |
| CSV / TSV / TAB / PSV → XLSX | 完整读取，支持 CRLF / CR / LF 与引号内换行；最多 1,000,000 个单元格、每行 16,384 列，并遵守 XLSX 行数上限。超限明确报错，不生成截断工作簿；直接 CSV 预览不使用此转换上限。 |
| PPM | 保留尺寸与 8/16 位 RGB 采样精度；非标准 maxval 按 PNG 范围缩放并取整。注释不写入 PNG 元数据。 |
| 转换警告 | 说明该输入实际使用的回退路径。 |
| 有效的 OpenXML 输出 | 只说明输出结构有效，不代表视觉保真度达标。 |

### 转换运行时

| 组件 | 职责 | 参考 |
| --- | --- | --- |
| 浏览器 WASM 客户端 | `createWasmConverterClient({ wasm, officeWasm, imageWasm, postscriptWasm, graphicsWasm, cadWasm })`；在本地运行共享核心与可选模块，按需加载。 | [转换客户端 API](../packages/converter-client/src/index.ts) |
| 文档 / 全景 / PPM 核心 | 由 Rust 构建的生产转换 WASM；包含 PPM → PNG，无需可选图像模块。 | [Rust 核心](../wasm/converter-core-rust/README.md) |
| 可选 Office 解密模块 | 拆分核心请求 Office 解密时，由 `officeWasm` 提供 `converter-office.wasm`。 | [密码检查](../packages/converter-client/test/password.spec.ts) |
| 可选图像核心 | 由 Rust 构建的独立图像/RAW WASM 模块。 | [Rust 图像模块](../wasm/converter-image-rust/README.md) |
| 可选 CAD 核心 | `cadWasm` 提供精简的 `converter-cad.wasm` DWG 读取器，DWG 优先使用它，再考虑 `graphicsWasm`。 | [WASM 客户端](../packages/converter-client/src/wasm-client.ts) |
| 可选图形核心 | `graphicsWasm` 可配置 `converter-raster.wasm` 处理位图，或配置 `converter-graphics.wasm` 同时处理 DWG 与位图；`converter-core-full.wasm` 已包含两者实现。 | [图形检查](../packages/converter-client/test/graphics-preview.spec.ts) |
| 可选 PostScript 核心 | `postscriptWasm` 提供 `converter-postscript.wasm`，用于 EPS/PS 和非 PDF 兼容 AI。 | [设计稿预览限制](design-preview.md) |
| HTTP 适配器 | 调用配置的转换服务。 | [适配器 API](#路由与数据源加载) |
| Go/wazero 宿主 | 包装同一 WASM 核心的薄壳：CLI/HTTP、校验、临时文件、结果与错误映射、OpenXML 输出校验。 | [Go/wazero 示例](../examples/go-wazero-converter/README.md) |

<sub>浏览器 WASI 输出按需扩容，读取与文件长度只暴露有效字节；支持覆盖、追加和稀疏写入，排他创建不会覆盖已有文件。扩容会保留备用容量，不表示峰值内存下降。[检查记录](../benchmarks/frontend/2026-10-24/converter-io-review.json)。</sub>

### PPM 转换

| 能力 | 支持范围与边界 |
| --- | --- |
| 输入识别 | `.ppm`（大小写不敏感）或 `image/x-portable-pixmap` 路由到文档核心的 PNG 转换；PBM/PGM/PNM 使用图形模块；PAM/PFM 没有默认路由。 |
| P3 / P6 | P3 十进制文本与 P6 二进制 RGB；P6 最大色值超过 255 时，每个采样使用大端双字节。 |
| 头部与文本像素 | ASCII 空白、LF/CRLF 头部、头部注释及 P3 采样间注释。二进制像素中的空白与 `#` 保留为像素数据。 |
| 采样值 | `maxval` 1–255 输出 8 位 PNG；256–65535 输出 16 位 PNG。采样值按 255/65535 范围缩放并取整。 |
| 预览操作 | 转换后的 PNG 使用图片驱动的缩放、适应、平移、旋转和全屏功能。浏览器显示可能降低 16 位精度。 |
| 运行时 | 浏览器 `createWasmConverterClient({ wasm })` 与 Go/wazero 复用 `converter-core.wasm`。HTTP 集成需配置支持此转换对的服务。 |
| 资源限制 | 输入 ≤256 MiB；解码 RGB ≤128 MiB（8 位每像素 3 字节、16 位每像素 6 字节）。这是缓冲区限制，不是整体峰值内存承诺。 |
| 图像流与元数据 | 只转换首张图片；不提供动画、透明通道、注释元数据导出或额外色彩配置转换。 |
| 解码验证 | [Rust 测试](../wasm/converter-core-rust/src/ppm.rs)覆盖注释、maxval 缩放、16 位采样、二进制分隔字节、损坏输入和超大尺寸。 |
| 集成验证 | [WASM 客户端测试](../packages/converter-client/test/converter-client.spec.ts)覆盖 P3/P6、PNG 尺寸与位深、错误输入；[浏览器回归](../apps/demo/e2e/ppm.e2e.ts)检查内置样例及上传 P3/P6/16 位图片的像素。[批处理样例](../examples/go-wazero-converter/fixtures/image/sample.ppm)覆盖 Go/wazero 宿主。 |

### 相机 RAW 转换

| RAW 类别 | 源扩展名 | 目标格式 |
| --- | --- | --- |
| Digital Negative | `dng` | `jpg` |
| Canon（佳能） | `cr2`, `cr3` | `jpg` |
| Nikon（尼康） | `nef`, `nrw` | `jpg` |
| Sony（索尼） | `arw`, `sr2`, `srf` | `jpg` |
| Olympus（奥林巴斯） | `orf` | `jpg` |
| Panasonic / Leica（松下 / 徕卡） | `rw2`, `rwl` | `jpg` |
| Fujifilm / Kodak / Sigma（富士 / 柯达 / 适马） | `raf`, `kdc`, `x3f` | `jpg` |
| Pentax / Samsung（宾得 / 三星） | `pef`, `srw` | `jpg` |
| Epson / Mamiya / Minolta（爱普生 / 玛米亚 / 美能达） | `erf`, `mef`, `mrw` | `jpg` |
| Leaf / Hasselblad / Phase One（利图 / 哈苏 / 飞思） | `mos`, `3fr`, `iiq` | `jpg` |

| 解码路径 | 支持范围 | 限制 |
| --- | --- | --- |
| 内嵌预览 | 核心提取最大的标准 8 位内嵌 JPEG。 | 需要存在合适的内嵌 JPEG。 |
| X3F 传感器预览 | 图片模块在没有 JPEG 或其最长边小于 2048 像素时，从传统 mapped-Huffman、TRUE/Merrill 原始传感器数据生成预览，通过 X3F 属性识别相机。 | 最长边 2048 像素，不放大小图；使用日光白平衡。暂不支持 Quattro 传感器压缩及 CAMF 调整。 |
| 传感器回退 | 可选的 `converter-image.wasm` 提供轻量传感器解码与降采样，应用相机白平衡、sRGB 色彩和 DNG 曝光元数据。已[验证](performance-comparison.zh-CN.md)无内嵌 JPEG 的 DNG、Nikon D3S NEF、Canon 40D sRAW CR2、PEF、ORF 样例。 | 最长边 2048 像素；解码受相机及文件变体影响。无效色彩标定明确报错。 |
| 标定全景 DNG | One RS、X5 可在普通转换前识别标定，生成保留传感器布局的预览并进行静态全景拼缝、曝光匹配与主体保护。 | 需要两个全景 WASM 模块；预览最长边不超过 4096 像素，标定为实验性支持，解码受相机变体影响。未支持的标定保留平面预览。 |
| 完整 RAW 显影 | 暂不支持。 | 不保留全分辨率显影、自定义图片配置或相机编辑效果。 |

Vue 预览同时配置 `converter` 和 `panoramaProcessor` 时启用全景 DNG 识别。参见 [RAW 全景接入](../packages/panorama/README.md)。

<sub>全景与 RAW 会话在切换、取消或销毁时释放自有 URL、画布和播放器，忽略迟到的解析、图片与代理文件结果；旧控件不再影响新预览。已开始的浏览器解码、自定义转换或同步 WASM 可能继续完成，结果被丢弃。[回归检查](../benchmarks/frontend/2026-10-24/panorama-lifecycle-review.json)。</sub>

<sub>全景处理器的取消信号同时覆盖后续分段读取、RAW 显影与接缝 / IMU 处理；伴随文件加载失败不会留下半成品状态，旧请求不会覆盖新文件。[处理器检查](../benchmarks/frontend/2026-10-24/panorama-processor-review.json)。</sub>

## 保真度与功能明细

### PPTX

<details>
<summary>展开 PPTX 内容、几何、样式与暂不支持的功能</summary>

| 功能 | 状态 | 说明 |
| --- | --- | --- |
| 文本框与占位符继承 | 支持 | 原始字体是否可用、浏览器排版行为都会影响保真度。 |
| 图片、组合与表格 | 支持 | 表格文本样式矩阵仅部分覆盖。 |
| 链接与幻灯片导航动作 | 支持 | 支持常见链接与动作；平滑滚动时连续翻页保持目标页，手动滚动可接管。 |
| 基于图示数据的基础 SmartArt | 部分支持 | 不提供完整 SmartArt 兼容性。 |
| 预设形状与调整公式 | 部分支持 | 支持常见 `a:avLst` 调整；其他预设形状与 OOXML 公式仍不完整。 |
| 形状文本边界与 `bodyPr` 行为 | 部分支持 | 自定义几何文本矩形与精确自动适应行为仍不完整。 |
| 主题颜色与字体 | 支持 | 提供浏览器字体回退栈。 |
| 纯色与渐变填充 | 支持 | 图案与图片填充仅部分支持。 |
| 线端、连接与箭头样式 | 支持 | 支持常见情况。 |
| 阴影 | 部分支持 | 部分源效果会被简化。 |
| 不支持内容的占位显示 | 支持 | 可使用占位符表示暂不支持的内容。 |
| 原始字体精确还原 | 部分支持 | 取决于已安装字体、应用提供的 Web 字体与格式元数据。未实现 Office/iWork 内嵌字体加载。 |
| 动画与切换效果 | 暂不支持 | PPTX 渲染器尚未实现。 |
| 图表 | 部分支持 | 使用缓存数据渲染二维柱状图、横向条形图（簇状、堆积和百分比堆积）与饼图，支持标题和图例。柱状图和条形图还支持数值标签、基本文字样式及坐标轴与网格线颜色。其他图表类型与高级格式暂不支持。 |
| 内嵌音频/视频 | 暂不支持 | 独立媒体可播放，不代表幻灯片内媒体可播放。 |
| OLE 对象 | 暂不支持 | 尚未实现嵌入对象渲染。 |
| 批注、备注与审阅元数据 | 暂不支持 | PPTX 渲染器未提供这些内容。 |

</details>

### 原生 iWork

| 运行能力 | 支持范围 |
| --- | --- |
| 检测与解析 | 通过 Worker 原生解析 `.key`、`.pages` 与 `.numbers`。 |
| 文件切换与取消 | 切换、取消或销毁时丢弃过期结果并释放图片；繁忙的解析 Worker 立即终止，下次打开时重建。空闲 Worker 清除旧归档后复用。保留调用方的输入缓冲区。 |
| 导航 | Keynote 幻灯片、Pages 连续页面、Numbers 工作表。 |
| 诊断 | 警告与错误事件。 |

<details>
<summary>展开 iWork 内容与保真度矩阵</summary>

| 功能 | 状态 | 说明 |
| --- | --- | --- |
| Keynote 幻灯片画布 | 支持 | 母版与模板保真度仍不完整。 |
| Pages 多页正文提取 | 支持 | 不能精确复现源文件分页。 |
| Pages 浮动附件 | 部分支持 | 部分位置与内容会被简化。 |
| Pages 节/页面背景与模板页眉页脚 | 支持 | 包括节的页码起始值。 |
| Numbers 工作表画布与合并单元格 | 支持 | 表格保真度仍有限。 |
| Numbers 表格 | 部分支持 | 不提供完整的 Numbers 计算引擎。 |
| 文本片段与段落 | 部分支持 | 部分格式会被简化。 |
| 图片、媒体资源查找、基础形状与线条 | 部分支持 | 不支持的记录会产生警告。 |
| 图表 | 暂不支持 | 图表渲染不在当前覆盖范围内。 |
| 协作元数据 | 暂不支持 | 原生查看器未提供这些内容。 |

</details>

### 文档与工作簿

| 驱动 | 已实现 | 当前限制 |
| --- | --- | --- |
| PDF | PDF.js 按可见区域渲染并释放远处画布；支持页码导航、缩放 / 适应、窗口调整与取消加载。`virtual: false` 可一次性渲染全部页面。 | 暂未提供文本搜索 / 选择层；未打开页面先按首页尺寸估算。默认按需预览不声明全文打印能力，完整渲染模式保留该能力。 |
| DOCX | 通过 `docx-preview` 渲染；同一文档部件内的重复图片复用资源。切换、取消或销毁时释放内嵌图片和字体 URL，丢弃旧渲染结果。 | 效果依赖渲染器、字体与版式；已开始的解析或渲染仍可能在脱离页面的容器中完成。 |
| XLSX | 工作表切换、单元格值、公式缓存值；缺少缓存值时进行基础算术与 `SUM` 计算。 | 不支持的公式显示为公式文本。不提供图表、合并单元格布局、完整样式保真或完整计算引擎。 |
| CSV | UTF-8/浏览器可读取来源的只读表格；支持 CRLF / CR / LF、引号内换行、转义引号和空记录。 | 不提供丰富的类型推断或工作簿样式。 |
| 工作簿行加载 | 滚动时按批次追加行。 | 已加载的行会保留在页面中；不提供大工作表虚拟化。 |

### DWG 与 CAD 图纸模型

| 范围 | 支持内容 | 限制 |
| --- | --- | --- |
| 默认路径 | 前端 WASM 核心将 DWG 读取为 `cad-json`，CAD 驱动直接将模型渲染为 SVG，不经过 DXF 往返转换。 | 可使用 `cadWasm`、通过 `graphicsWasm` 配置的合并图形模块，或合并核心；仍可显式转换为 UTF-8 DXF。 |
| 图纸内容 | 常见二维几何、文本、图层、线型、块/阵列展开、属性、填充、栅格引用和基础尺寸标注。 | DWG 保真度有限；不支持的实体跳过并产生警告，代理对象、外部参照、SHX 字形和完整 CAD 布局尚不完整。下方 DXF 实体列表不代表 DWG 具有完全相同的覆盖范围。 |
| 直接模型输入 | `.cad-json` 或 `application/vnd.filens.cad+json`；`loadCadDrawing()` 加载转换器输出的模型。 | schema 版本为 1，含 DWG 源格式元数据；不是任意 JSON，也不是 CAD 编辑 API。 |
| 文件格式版本 | R14/AC1014 至 AC1032（2018 保存格式）。 | 不支持 R12，R13 尚未验证。见 [13 份图纸的兼容性与性能实测](dwg-preview-optimization.md)；保存格式版本不代表覆盖所有新版 CAD 应用输出。 |
| 验证 | [WASM 集成检查](../packages/converter-client/test/graphics-preview.spec.ts)覆盖 R2000/R2018 图纸模型与显式 DXF 输出。 | 样例用于回归验证，不代表兼容所有 DWG 版本或实体。 |

### DXF CAD

<details>
<summary>展开 DXF SVG 渲染、实体、元数据与已知限制</summary>

| 领域 | 支持范围 | 限制 |
| --- | --- | --- |
| 渲染器 | 将支持的实体渲染为浏览器 SVG。 | 几何、图层、样式与文本仅部分支持。 |
| 常见几何 | `POINT`, `LINE`, `XLINE`, `RAY`, `LEADER`, `CIRCLE`, `ARC`, `ELLIPSE`, `SPLINE`, `LWPOLYLINE`、经典 `POLYLINE`/`VERTEX`、凸度圆弧、常见多段线宽度、`SOLID`, `TRACE`, `3DFACE`。 | 尚未覆盖全部 DXF 实体。 |
| 实心填充 | 多段线、直线边、圆弧边、椭圆弧边与样条边边界；通过多环奇偶填充规则表示孔洞。 | 图案填充与嵌套填充仍不完整。 |
| 块与尺寸标注 | 嵌套 `BLOCK`/`INSERT`、`MINSERT` 阵列、`DIMENSION` 几何块展开；无几何块时提供轻量线性/对齐标注回退。 | 高级块属性与尺寸标注仍不完整。 |
| 栅格引用 | `IMAGE`/`IMAGEDEF` 引用与裁剪；应用解析器支持 URL、Blob、ArrayBuffer 及类型化数组切片。切换、取消、失败或销毁时释放自建图片 URL。 | 无法解析的本地路径会显示占位符并产生警告。 |
| 加载 | 安全切换与取消，丢弃过期的读取和资源解析结果；Base64 数据 URL 按 UTF-8 解码文本。 | 已开始的同步解析和自定义资源解析任务仍可能完成，随后丢弃结果。 |
| 文本实体 | 简单 `TEXT`、`MTEXT`、`ATTRIB`、`ATTDEF`：高度、旋转、宽度因子、倾斜角、对齐点、MTEXT 附着点/方向、内联格式清理与多行渲染。 | 精确文本度量、高级 MTEXT、注释性缩放与布局空间文本行为仍不完整。 |
| 边界与单位 | 实体几何；`$EXTMIN`/`$EXTMAX` 或 `$LIMMIN`/`$LIMMAX` 边界提示；`$INSUNITS`、`$MEASUREMENT`、`$LTSCALE` 元数据。 | 布局与外部参照覆盖仍不完整。 |
| 图层与颜色 | 名称、基础 ACI 颜色、真彩色、透明度、隐藏/关闭/冻结/锁定标志、实体不可见性/颜色覆盖、SVG 属性、Vue 图层开关。 | 覆盖范围仍有限。 |
| 线型 | `LTYPE` 虚线模式、全局/实体（`48`）线型比例、实体/图层 `LINEWEIGHT`。 | 不保证精确复现源样式。 |
| 字体 | TrueType/OpenType 类字体引用映射到 CSS 回退字体。 | 不提供精确 SHX 字形渲染；SHX 引用会产生警告并使用浏览器字体。 |
| DWG | 本地 WASM 读取图纸模型，复用 SVG 二维预览器；仍可按需输出 UTF-8 DXF。 | 单独的部分覆盖范围，见 [DWG 与 CAD 图纸模型](#dwg-与-cad-图纸模型)。 |
| DGN | 暂不支持。 | 没有原生预览路由。 |

</details>

### 3D 模型与检查

| 运行能力 | 支持范围 | 要求或限制 |
| --- | --- | --- |
| Three.js 查看器 | 轨道旋转、缩放、适应视图、全屏。 | 导入覆盖范围因格式而异。 |
| 加载与清理 | 安全切换和取消；丢弃过期模型，释放几何体、材质、纹理及子节点资源 URL。 | 已开始的解析仍可能完成，随后丢弃结果。 |
| 外部材质与数据 | 加载配套资源。 | 可能需要 `resourceResolver`；部分加载器要求同步解析。 |
| 检查控件 | 驱动支持的模型检查功能。 | 基于对象的预览比部分直接几何预览提供更多检查控件。 |

<details>
<summary>展开完整 3D/模型格式列表与导入限制</summary>

| 格式 | 导入范围 | 要求与限制 |
| --- | --- | --- |
| `step`, `stp` | 三角化的 CAD 实体。 | 按需加载 truck Rust WASM，近似几何预览；省略源颜色、名称和装配树，不支持外部零件引用；既有几何筛查 43/44。 |
| `stl`, `obj`, `ply` | ASCII/二进制 STL；OBJ 几何与常见内联顶点颜色；ASCII/小端二进制 PLY 及常见顶点颜色。 | OBJ MTL 库与纹理可使用应用解析的配套资源。 |
| `gltf`, `glb` | 内嵌/data URI glTF、URL 加载的缓冲区/纹理、单文件 GLB。 | 外部缓冲区与纹理可由应用解析。 |
| `3mf`, `amf` | 核心 3MF 网格、构建/组件项、基础材质、颜色组对象/三角形顶点颜色；AMF 对象。 | 不支持的 3MF 纹理、复合材质、多属性与非调色板引用会产生回退警告。 |
| `dae`, `kmz`, `fbx`, `3ds`, `usdz` | Collada、含嵌套/编码路径与纹理的 KMZ 压缩 Collada、FBX、3DS、基于 USDA 的 USDZ。 | DAE/FBX/3DS 的纹理配套文件需要应用同步解析；KMZ 使用包内资源。 |
| `wrl`, `vrml`, `ldr`, `mpd` | VRML 场景；含 MPD 内嵌定义、嵌套本地零件和基础元件的 LDraw 模型。 | VRML 纹理需要应用同步解析；LDraw 外部零件由应用提供。 |
| `md2`, `lwo` | MD2 与 LightWave Object 网格。 | LWO 纹理需要应用同步解析。 |
| `gcode`, `gco`, `nc` | 刀路。 | 支持部分刀路数据。 |
| `pcd`, `xyz`, `vtk`, `vox` | 点云、VTK 多边形网格、VOX 体素场景。 | 支持部分数据子集。 |
| `bvh`, `pdb` | 动作骨架、分子结构。 | 支持范围取决于对应导入器。 |
| `nrrd`, `nhdr` | 三维标量体数据点云；raw、gzip、ASCII，LF / CRLF 换行与二进制字节序。 | 分离式 NHDR 需要应用解析一个外部数据文件；暂不支持多文件列表、四维体数据和行 / 字节跳过。 |

</details>

<details>
<summary>展开 3D 检查能力与 Vue 界面</summary>

| 能力 | 支持范围 | 适用范围或限制 |
| --- | --- | --- |
| 模型元数据 | 格式、边界、网格/线/点/材质数量、材质名称、动画数量、基础三角形/顶点/颜色元数据。 | 可用字段取决于导入器。 |
| 模型树 | 稳定节点 ID、搜索/筛选、显隐、选择/高亮、子树摘要、再次选择时重新聚焦相机。 | 适用于基于对象的预览。 |
| 装配体 | 爆炸视图控件。 | 适用于基于对象的多零件装配体。 |
| 测量 | 点到点表面拾取、悬停预览、表面/最近顶点吸附、自由/X/Y/Z 轴锁定、坐标、XYZ 差值、预览差值与总距离。 | 需要驱动提供测量能力。 |
| 剖切 | 单平面与盒状裁剪；X/Y/Z 控件及根据边界生成的偏移和范围。 | 支持基于对象与直接几何的预览；不提供任意多平面剖切。 |
| 材质 | 整体/逐节点摘要：类型、颜色/自发光、透明度、透明度测试、深度标志、线框、顶点颜色、面朝向、粗糙度/金属度/光泽度/大小、纹理存在状态。 | 材质隔离需要基于对象的预览。 |
| 相机与导出 | 透视/正交投影、前/右/顶/等轴测/自由轨道预设、PNG 快照。 | 控件取决于驱动能力。 |
| 诊断 | 状态与事件中的资源警告。 | 覆盖 glTF/OBJ 资源、缺失的 OBJ 材质/纹理、KMZ 纹理和 LDraw 零件、不支持的 3MF 材质。 |
| Vue 检查面板 | 模型树、摘要、爆炸视图、测量、剖切、相机控件、快照、材质隔离与材质卡片。 | 默认收起，通过画布左上角按钮展开；模型静置时保持不动，支持手动旋转和缩放。具体功能取决于驱动。 |
| 按图层隔离 | 暂不支持。 | 基于对象的预览支持材质隔离。 |
| 其他原生格式 | 暂不支持。 | 导入范围限于上表列出的格式。 |

</details>

<sub>glTF 伴随文件的临时 URL 在加载结束、失败或取消后释放；资源解析器可直接返回 HTTP 地址，调用方提供的 URL 保持归属不变。STEP 的 WASM 初始化失败后可以重新打开。[资源加载检查](../benchmarks/frontend/2026-10-24/model3d-resources-review.json)。</sub>

<sub>体数据预览保留 NHDR 原始编码，修复头信息末字段截断和字节序导致的颜色错误；取消会停止等待资源，截断的二进制数据会明确报错。[体数据检查](../benchmarks/frontend/2026-10-24/volume-preview-review.json)。</sub>

<sub>OBJ 正确保留中文材质名，解析贴图缩放、偏移参数及法线、凹凸、位移贴图；等待使用中的图片加载，失败给出提示，完成或取消后释放自建 URL。[OBJ 检查](../benchmarks/frontend/2026-10-24/obj-resources-review.json)。</sub>

<sub>LDraw 保留 MPD 内嵌定义和零件所在目录，提示缺件及循环引用，并支持取消异步依赖加载；法线平滑避免反复遍历分离曲面，保持原有着色效果。[LDraw 检查](../benchmarks/frontend/2026-10-24/ldraw-resources-review.json)。</sub>

<sub>KMZ 按需解压选中的模型及其图片，按 KML/DAE 所在目录解析路径，并等待纹理就绪后预览；两个公开接口都会释放自建图片 URL，异步预览支持取消并提示缺失或损坏的纹理。[KMZ 检查](../benchmarks/frontend/2026-10-24/kmz-resources-review.json)。</sub>

<sub>3D 文件读取、GLB 解析、STEP 初始化和 3MF 解压等待均可取消；迟到的场景会释放资源，STEP 共享初始化可继续供其他加载使用。同步解析本身仍不能中断。[取消与画面检查](../benchmarks/frontend/2026-10-24/model3d-cancel-review.json)。</sub>

### 全景与实况照片样例

| 来源 | 支持范围 | 要求与限制 |
| --- | --- | --- |
| 等距柱状图片 | 球面图片预览。 | 源图像需要采用等距柱状投影。 |
| 等距柱状视频 | 球面视频播放。 | 需要浏览器可解码的媒体源。 |
| Insta360 `insp` | 实验性支持标定的 One RS 双鱼眼照片与内容感知羽化接缝。 | 需要内嵌镜头标定信息与全景处理器。 |
| Insta360 `insv` | 在已支持的情况下渲染标定原始镜头；无 WebCodecs 时回退到浏览器媒体解码。 | 能否打开取决于标定、编解码器与投影方式。 |
| DJI Osmo `osv` | 有原始镜头源时进行标定渲染；提供实验性代理回退。 | 回退需要通过 `resourceResolver` 提供匹配的相机原生 `.LRF`。无法重建代理中已固化的接缝；准确的回退播放应使用 DJI Studio 拼接的 2:1 导出文件。 |
| 不支持的未拼接双鱼眼视频 | 拒绝预览。 | 没有受支持的标定或回退路径时，不会将其直接映射到球面。 |
| Apple Live Photo 演示 | 真实 iPhone 15 HEIC/MOV 文件对；Apple LivePhotosKit JS 播放 JPEG/H.264 衍生文件以兼容 Chromium。保留原始文件。 | 仅为演示集成，不提供通用 HEIC/MOV 文件对解码。 |
| Android Motion Photo 演示 | 已验证 Pixel 9 Pro XL 与 Samsung Galaxy A34 / S20 FE / Tab S9 样例的静态图片显示。 | WASM 转换核心尚未实现内嵌视频提取。 |

| 集成项 | 配置方式 |
| --- | --- |
| 标定相机处理 | 向驱动或 Vue `Preview` 传入 `panoramaProcessor`，例如 `@filens/panorama` 的 `createWasmPanoramaProcessor({ wasm })`。 |
| 配套镜头流与代理文件 | 通过 `resourceResolver` 解析配套资源。 |

### 电子书、压缩包、思维导图与图示

| 类别 | 支持范围 | 限制或集成说明 |
| --- | --- | --- |
| EPUB / CBZ | EPUB 按 spine 顺序显示章节；支持样式表相对导入、字体/背景图、内联样式、编码路径与 SVG 图片引用，缓存重复资源请求并终止循环导入。EPUB/CBZ 分批解包资源，CBZ 保留自然页码顺序。切换文件、取消或销毁时释放会话资源。 | 仍完整提取书籍，非按需解包；暂不提供高级导航、主题或其他电子书格式的原生预览。其他可读取格式可能存在转换路由。 |
| 压缩包 | 只读浏览、嵌套压缩包、条目预览、通过包辅助函数提取；切换、返回和取消时丢弃旧结果并释放资源。 | 宿主预览器工厂可复用预览选项，并按条目所在目录解析包内配套文件；内置回退支持常见图片、音视频与文本，播放能力取决于浏览器。没有批量解压界面。[检查记录](../benchmarks/frontend/2026-10-24/archive-lifecycle-review.json)。 |
| 演示 ZIP 资源包 | 识别主文件，并使用同包内的配套资源。 | 可识别的主文件包括 glTF/GLB/3MF、DXF、思维导图、draw.io/dio、HTML/XHTML、PNG 与常见文本。 |
| 思维导图 | XML/ZIP 树、缩放、适应视图/宽度/高度并跟随容器调整、SVG 节点选择、提纲/搜索能力标志；切换文件时丢弃旧结果，支持取消与销毁清理。 | XMind 读取 `content.json` / `content.xml`；MindManager 读取 `Document.xml`。不提供复杂编辑或完整布局保真。 |
| 流程图与图示 | 压缩/未压缩的 diagrams.net mxGraph，含缺省尺寸回退；基础 Visio XML/ZIP 页面，含旧 VDX `XForm` / `PageProps` 几何、`Shape` 连接线及 `pages.xml` 清单；常见颜色、圆角/椭圆/菱形、虚线、箭头、选择、缩放与随容器调整的适应视图。切换文件、取消或销毁后丢弃未完成的结果。 | Visio 主要读取缓存几何；不提供完整母版继承、布局保真度或编辑。 |
| 代码 / 文本 | UTF-8 显示、语言元数据、行高对齐的行号；20 万字符以内提供轻量代码高亮。已验证 20 万行，切换、取消或销毁后丢弃未完成的结果。 | 仍完整解码和布局，未做文本虚拟化；不提供内置搜索或更丰富的编辑器控件，大文件跳过高亮。 |
| 浏览器图片 / HTML | 切换、取消或销毁时释放会话创建的 URL，忽略旧节点事件。 | 图片解码仍依赖浏览器；HTML 脚本受沙箱限制。 |
| 音频 / 视频 | 浏览器原生播放；切换、取消或销毁会停止旧播放器。媒体源失败显示错误，可选封面不阻塞播放。 | 依赖浏览器编解码器；`browserMedia: true` 可选开启有界 MP4/MOV 恢复，不提供 HLS/DASH 或通用转码。封面仅读取 ID3 APIC，Blob/File 限前 512 KiB。独立播放不代表支持 Office/iWork 内嵌媒体。 |

## 集成支持

### 路由与数据源加载

| 能力 | 支持范围 |
| --- | --- |
| 输入数据源 | URL `string`、`ArrayBuffer`、`Uint8Array`、`Blob` 与 `File`。 |
| 通用预览运行时 | `createPreviewer()`、包驱动/路由、生命周期、状态、警告/错误事件与数据源切换。 |
| 格式查询 | `listPreviewFormats()`、`listPreviewFormatGroups()`、`listPreviewExtensions()`、`createPreviewAcceptAttribute()`。应传入应用组合后的路由，以反映已启用的包与覆盖项。 |
| PPTX 运行时 | `init()` / `createViewer()`、`preview()`、`destroy()`、缩放/适应视图、幻灯片/键盘导航、虚拟化主视口。 |
| iWork 运行时 | `detectIworkType()`、`loadIwork()`、`createIworkViewer()`、Worker 解析、页面/工作表导航。 |
| Vue 封装 | `PptxPreview`、`IworkPreview` 与通用 `Preview`；直接传入 `src`、工具栏、适用格式的缩略图、数据源切换、警告/错误事件。控件取决于驱动能力。 |
| 转换适配器 | 可选 WASM、HTTP 与 mock 适配器。HTTP 非 2xx 的 JSON 或 `X-Preview-*` 响应会以 `HttpConversionError` 暴露，并携带稳定的转换器元数据。 |
| 内容检测 | 可选 `@filens/converter-client/format-detector` 的 `createAutoFormatDetector()`；独立 SIMD / 标量 WASM 资源，自动回退。 |

内容检测提供路由线索，不代表完整文件校验，也不会自动改变预览路由。见[检测 API 与托管要求](../packages/converter-client/README.md#content-detection-with-optional-simd128)。

<sub>统一运行时在切换或销毁时结束旧预览调用的等待，取消其加载信号并丢弃迟到的结果与事件。加载失败会释放会话，错误可从状态中读取。自定义驱动负责自身资源清理；不响应取消的任务仍可能完成。[回归检查](../benchmarks/frontend/2026-10-24/preview-runtime-review.json)。</sub>

<sub>HTTP / WASM 转换支持 HTTP(S)、Blob URL、以 `/`、`./`、`../` 开头的路径、内联文本和数据 URL；二进制百分号编码保留原始字节。取消会结束等待，共享 WASM 加载保留给其他调用；加载失败后，下次调用可重新获取模块。固定且已消费的 Response 需要替换，同步 WASM 执行仍无法中断。[数据源检查](../benchmarks/frontend/2026-10-24/converter-source-review.json)。</sub>

| 路由参考 | 范围 |
| --- | --- |
| [核心路由定义](../packages/core/src/preview/formats.ts) | 格式定义与默认路由辅助函数。 |
| [Vue 路由组合](../packages/vue/src/defaults.ts) | Vue `Preview` 宿主组合的路由。 |

### 字体与外部资源

| 钩子 / 辅助函数 | 当前使用方 | 限制或集成说明 |
| --- | --- | --- |
| `fontResolver` | 目前由 CAD 驱动用于 DXF 与 DWG 图纸模型。 | 可通过预览选项与 Vue `Preview` 传入；不提供跨驱动的通用字体加载。 |
| `resourceResolver` | CAD 栅格引用、glTF 缓冲区/纹理、OBJ 材质/纹理、支持的 3D 配套资源、缺失的 EPUB 资源、相机全景配套文件。 | 可通过预览选项与 Vue `Preview` 传入；支持的资源类型取决于驱动。 |
| 文件集解析器 | 核心包提供多文件上传与配套资源解析辅助函数。 | 从传入的文件集中解析资源。 |
| 压缩包解析器 | `@filens/archive` 辅助函数可将条目暴露为资源。 | 包括基于 ZIP 的复合资源包。 |

| 字体来源 | 当前行为 |
| --- | --- |
| 浏览器字体与应用提供的 Web 字体 | 影响版式；不保证精确还原原始字体。 |
| SHX 引用 | 使用浏览器字体回退，并产生警告。 |
| Office/iWork 内嵌字体 | 尚未实现加载。 |

## 暂不支持的格式与工作流

下列限制适用于内置预览路径。宿主应用可自行提供驱动或转换路由。

| 领域 | 格式或工作流 | 当前边界 |
| --- | --- | --- |
| 原生 CAD | DGN、FreeCAD 项目、IGES/BREP | 没有原生预览路由；STEP/STP、DXF 与部分 DWG 支持见上文。 |
| BIM | Revit、IFC | 没有原生预览路由。 |
| ECAD / 制造 | Gerber/Excellon、分层 KiCad PCB | 没有原生预览路由。 |
| 设计稿编辑 | PSD/PSB 图层、Illustrator 编辑数据 | 只读合成图或矢量预览；不提供设计稿编辑。[支持子集](design-preview.md)。 |
| 其他 Netpbm 扩展名 | `pam`, `pfm` | 没有默认预览或转换路由；PBM/PGM/PNM 与 PPM 的支持范围见上文。 |
| Office 加载项 | 加载项与嵌入式应用行为 | 不在默认转换策略范围内。 |
| 未列出的转换对 | 清单中不存在的任意转换对 | 不在默认转换策略范围内；宏移除仅适用于列出的启用宏的 OpenXML 源格式。 |
| 编辑 | Office/iWork/CAD/图示创作 | 不提供完整编辑器。 |
| 原应用一致性 | 精确版式与计算行为 | 不作保证；请参考各类别的功能表。 |

| 延伸阅读 | 内容 |
| --- | --- |
| [路线图](roadmap.md) | 计划中的工作。 |
| [项目概览](project-overview.zh-CN.md) | 架构与集成背景。 |
