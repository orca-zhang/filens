# filens × DeepSeek Harness 插件提案草稿

用途：用于官方 [GitHub Discussions](https://github.com/deepseek-ai/deepseek-harness/discussions) 的项目介绍与接入咨询。插件包见 [npm dsh-filens](https://www.npmjs.com/package/dsh-filens)，发布文件见 [v0.6.2](https://github.com/IceWhaleTech/filens/releases/tag/v0.6.2)。此社区帖子草稿尚未发送。

## 建议标题

filens integration: local document tools and multi-format previews for DSH

## 可直接使用的中文正文

大家好，我们维护开源项目 [filens](https://github.com/IceWhaleTech/filens)，已完成 DeepSeek Harness 的本地插件组合包 `dsh-filens`，包含可分别启用的两部分：

1. **Agent 文档工具**：复用现有 CLI，提供文档读取、OCR、跨格式搜索和转换，返回原文、来源、完整性、截断状态及可用的证据定位。
2. **文件预览**：复用现有 `filens-preview`，通过第三方渲染器接口接入 DSH 右侧文件预览面板，扩展 Office、iWork、CAD/3D、RAW 等格式的浏览器本地预览；菜单保留适用的 DSH 内置实现。

filens 的文档解析与转换复用同一套前端 WASM 核心。CLI 和预览包已分别发布为 [filens-cli](https://www.npmjs.com/package/filens-cli) 与 [filens-preview](https://www.npmjs.com/package/filens-preview)，自有代码采用 MIT 许可，第三方组件保留各自许可。格式范围和保真度限制见项目文档；DSH 中的支持范围将以集成实测为准。

目前的接入方案是：Host 插件通过 `ctx.tools` 暴露工具，Client 插件通过 `ctx.documentPreviews` 和 `sidebar.right.tab.document` 注册预览正文；两部分随一个 bundle 安装、分别启用。

想向维护者确认：

- 这两个方向是否符合当前推荐的社区插件接入方式？外部插件应优先验证哪个发布版本？
- 如果希望获得官方推荐、内置集成或生态合作，应该通过什么渠道提交演示和材料？
- 是否有适用的开发者激励或分成计划？如果有，申请入口、准入要求和结算规则在哪里？

本地验证涵盖 macOS arm64 上的 DSH Desktop/Web `0.2.1-rc.5`、Web `0.2.2-alpha.3`：五个工具的执行管线、独立启停，以及真实桌面侧栏中的 DOCX、Keynote、STEP、ZIP。没有发送模型提问；工具直接通过 DSH 的执行管线调用。[接入说明](../integrations/deepseek-harness/README.zh-CN.md)与[实测记录](../integrations/deepseek-harness/VALIDATION.md)已准备，插件可通过 `dsh plugin --profile desktop add dsh-filens@0.1.0` 安装。

## 对接材料的最小清单

- **已有**：项目仓库、MIT 许可、CLI 与 Preview npm 包、格式支持说明、图标及现有演示素材。
- **已在本地完成**：DSH 组合包、安装命令、中英文文档、版本范围、测试与实际桌面截图。npm 包、Release 和仓库截图可直接提供公开链接；验证结果详见上述记录。
- **录屏建议**：让 Agent 读取一个文档并返回来源，搜索一组文件，点击命中文件在侧栏查看；再展示一个 iWork 或 CAD/3D 文件。

录屏和样例应使用可公开分发的文件，文案只宣称在 DSH 中实际验证通过的能力。
