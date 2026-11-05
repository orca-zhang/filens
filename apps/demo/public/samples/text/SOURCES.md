# Original text sample sources

The Text catalog contains 42 project-authored files across 40 format identifiers:
seven documents and notes, eighteen source-code examples, fifteen configuration
files and two logs. All text and code in this directory use the project's MIT
license. Names, places, measurements, exhibitions and operational events are
fictional. No third-party source files, private configuration or real log data
are included.

These files replace the nine short, inline text fixtures and add thirty-three
more examples. The original filenames of those nine examples are retained.
The demo loads the actual files from this directory; the catalog in
`apps/demo/src/text-samples.ts` contains only metadata. Both the Text format
buttons and the text sample chooser use the same native text preview path as
uploaded files.

Documents show original text or markup; Markdown, reStructuredText, AsciiDoc and
LaTeX are displayed as source. Code and configuration use the existing syntax
highlighter and line numbers. Scripts, queries and recipes are illustrative
source material; choosing them in the demo displays their contents without
executing them. The examples are independent studies, not one complete runnable
application.

All files are UTF-8. `notes.txt` includes Chinese, Arabic, Japanese, emoji and
literal tab characters. Makefile recipes also retain their literal tabs.
`station-recovery.log` deliberately uses CRLF line endings and an indented,
multiline diagnostic trace; the other files use LF. No extra runtime engine,
font or image assets are required.

| File | Format | Study |
| --- | --- | --- |
| `notes.txt` | TXT | Mountain field notes / 山间观察手记 |
| `weekend-itinerary.txt` | TXT | Weekend city walk / 周末城市漫游 |
| `README.md` | MD | Open studio handbook / 开放工作室指南 |
| `release-notes.markdown` | MARKDOWN | Product release notes / 产品更新札记 |
| `field-guide.rst` | RST | Nature observation guide / 自然观察指南 |
| `print-workshop.adoc` | ADOC | Print workshop notes / 版画工坊讲义 |
| `observation.tex` | TEX | Observation paper / 观测研究摘要 |
| `preview.ts` | TS | Book search utility / 书目搜索工具 |
| `reading-list.tsx` | TSX | Reading list component / 阅读清单组件 |
| `photo-index.js` | JS | Photo timeline / 照片时间线 |
| `preview.py` | PY | Weather observations / 气象数据整理 |
| `catalog.go` | GO | Exhibition catalog service / 展览目录服务 |
| `palette.rs` | RS | Nature palette utility / 自然色卡工具 |
| `TrailPlanner.java` | JAVA | Trail planner / 徒步路线规划 |
| `rolling-average.c` | C | Sensor rolling average / 传感器滑动均值 |
| `geometry.cpp` | CPP | Trail geometry / 步道几何计算 |
| `Inventory.cs` | CS | Studio inventory / 工作室材料清单 |
| `photo-manifest.sh` | SH | Photo manifest script / 照片清单脚本 |
| `Collect-Notes.ps1` | PS1 | Notes directory report / 笔记目录统计 |
| `reading-room.sql` | SQL | Library monthly report / 借阅月度报表 |
| `studio-tokens.css` | CSS | Studio interface styles / 工作室界面样式 |
| `ReadingCard.vue` | VUE | Vue reading card / Vue 阅读卡片 |
| `typography.diff` | DIFF | Typography adjustment patch / 排版调整补丁 |
| `reading-room.graphql` | GRAPHQL | Reading room query / 书目查询接口 |
| `observation.proto` | PROTO | Sensor message schema / 传感器消息定义 |
| `preview.json` | JSON | Exhibition collection / 展览作品目录 |
| `preview.yaml` | YAML | Workshop schedule / 工坊活动日程 |
| `observatory.yml` | YML | Observation station plan / 观测站采集计划 |
| `preview.toml` | TOML | Photo archive configuration / 照片归档配置 |
| `export.ini` | INI | Print export settings / 印刷导出设置 |
| `studio.conf` | CONF | Static site configuration / 静态站点配置 |
| `preview.xml` | XML | Nature observation record / 自然观察记录 |
| `workspace.jsonc` | JSONC | Editor workspace / 编辑器工作区 |
| `collection.json5` | JSON5 | Sound collection / 声音资料集合 |
| `messages.properties` | PROPERTIES | Interface copy / 中英界面文案 |
| `observatory.env` | ENV | Local observation environment / 本地观测环境 |
| `Dockerfile` | DOCKERFILE | Reading room site image / 阅读室站点镜像 |
| `Makefile` | MAKE | Manuscript build tasks / 文稿构建任务 |
| `workspace.editorconfig` | EDITORCONFIG | Writing workspace conventions / 写作排版约定 |
| `studio.gitignore` | GITIGNORE | Workspace ignore rules / 工作区忽略规则 |
| `preview.log` | LOG | Open studio event log / 展览开放日日志 |
| `station-recovery.log` | LOG | Station recovery log / 采集任务恢复记录 |
