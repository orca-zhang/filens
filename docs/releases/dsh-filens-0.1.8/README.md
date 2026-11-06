# DSH 插件 0.1.8 · 发布材料

版本：`dsh-filens@0.1.8`、`dsh-filens-workspace@0.1.1`，随 [v0.6.6](https://github.com/IceWhaleTech/filens/releases/tag/v0.6.6) 发布。录制使用正式升版前的源码构建，其客户端、工作台和预览内核与本机验证的 `0.1.7-workspace.8` 候选包一致；当时源码元数据为 0.1.6、预览元数据为 0.3.5，原始证据保留。正式包使用预览 0.3.6。0.1.8 / 工作台 0.1.1 另加入缺失文件过滤：会话扫描和刷新会通过 DSH 检查文件及附件，确认不存在的条目不进入工作台；权限和连接错误仍保留。演示录制版本保持不变，这项补丁通过新增桌面回归验证。

[打开素材预览页](review.html) · [中文发布说明](release-notes.zh-CN.md) · [English release notes](release-notes.en.md) · [中文短文案](announcement.zh-CN.md) · [English announcement](announcement.en.md)

## 动图与视频

每组使用对应语言的 DSH 界面、文件名、示例会话和单语字幕，中文、英文分别录制。字幕位于画面下方。录制环境为本机安装的 DSH Desktop，隔离配置、合成会话、真实文件渲染，不调用模型，不读取个人会话。

Office 录屏使用 FiLens 介绍 PPT 的对应语言版本；中文片段中的 Word 正文、Excel 表头和工作表名称也已翻译。封面、翻页与工作表切换均在 DSH 中实际操作并检查。

| 内容 | 中文 GIF | English GIF | 中文视频 | English video |
| --- | --- | --- | --- | --- |
| Office 侧栏预览 | [GIF](../../assets/dsh-release/office-preview.zh-CN.gif) | [GIF](../../assets/dsh-release/office-preview.en.gif) | [MP4](../../assets/dsh-release/office-preview.zh-CN.mp4) | [MP4](../../assets/dsh-release/office-preview.en.mp4) |
| 3D 与 360° 全景 | [GIF](../../assets/dsh-release/3d-and-panorama.zh-CN.gif) | [GIF](../../assets/dsh-release/3d-and-panorama.en.gif) | [MP4](../../assets/dsh-release/3d-and-panorama.zh-CN.mp4) | [MP4](../../assets/dsh-release/3d-and-panorama.en.mp4) |
| 文件工作台 | [GIF](../../assets/dsh-release/file-workspace.zh-CN.gif) | [GIF](../../assets/dsh-release/file-workspace.en.gif) | [MP4](../../assets/dsh-release/file-workspace.zh-CN.mp4) | [MP4](../../assets/dsh-release/file-workspace.en.mp4) |

GIF 适合 README 和社区帖子；MP4 更适合上传社交平台，WebP 保留更好的渐变和模型材质。每份素材旁的 `*-recording.json` 记录版本、样例来源与字节数、操作检查、剪辑时间和文件校验值。旧版安装演示保留，避免将候选构建演示描述为公开 npm 安装。

## 本次发布内容

新增可独立启停的文件工作台：从会话历史收集支持格式的本地文件引用和附件，以短会话标题、分组缩略图展示；打开后可以查看相关文件，返回原消息或对应提问。加入临时文件默认隐藏及手动显示、无缩略图文件的类型封面、紧凑阅读列表和 Photos 风格的详情面板。侧栏和工作台使用同一套预览内核。

正式包使用预览内核 0.3.6、CLI 0.5.6，支持清单登记 451 个扩展名；这是格式清单数量，不代表本轮逐一实测了 451 种格式。

这次演示不重新测量性能。现有 README 的 0.1.3 性能数字保留原版本与方法，不能作为 0.1.7 的新测试结果。

## 安装材料

先完全退出 DSH，安装两个正式插件，再重新打开。两个包均作为 profile 的直接依赖，工作台、侧栏预览和工具可分别启停：

```sh
dsh plugin --profile desktop add dsh-filens@0.1.8 dsh-filens-workspace@0.1.1
```

## 验证与范围

- 已有工作台桌面回归覆盖 22 项，包括分组缩略图、临时文件、来源消息与提问定位、独立开关、详情面板和窄窗口；[原始记录](../../assets/dsh-workspace/session-validation.json)。
- 360° 环视提示、播放控件、悬浮说明和无障碍标签已接入现有 28 语种词典；中文／英文实机验证包含暂停时切换语言并保持进度。
- 本轮六段录制各自断言预览与交互成功，最终产物的尺寸、时长和校验值见 [素材清单](../../assets/dsh-release/manifest.json)。
- 原生录制在 macOS arm64 / DSH Desktop 0.2.1-rc.5 完成；本轮没有新增 Windows/Linux 原生验证。
- 索引记录引用，不备份原文件。移动、删除或无权读取的文件可能无法打开；临时文件只隐藏，不删除。本机手选文件刷新后需重新选择。
- 相关文件依据消息、提问、目录和会话关系排序，不调用模型。全景样例使用 `.pano` / `.360v` 扩展名选择球面预览，不代表自动识别所有全景文件。

## 复现录制

需安装 DSH Desktop、仓库依赖、ffmpeg/ffprobe、img2webp、zstd 和带 Pillow 的 Python。对已构建的本地插件目录执行；`--workspace-dir` 指向工作台包目录：

```sh
npm --prefix integrations/deepseek-harness run build
node scripts/localize-dsh-showcase.mjs
node scripts/capture-dsh-release.mjs --locale zh-CN --workspace-dir integrations/deepseek-harness/workspace
node scripts/capture-dsh-release.mjs --locale en --workspace-dir integrations/deepseek-harness/workspace
```

支持 `--capture-only` 和 `--encode-only` 分步录制与编码。临时 profile、原始录屏与中间帧放在忽略目录，不进入发布材料。素材署名和许可见[素材说明](../../assets/dsh-release/README.md)。
