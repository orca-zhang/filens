# 共享读取链路与压缩包交互优化

2026-11-04，将优化范围从 XLSX 扩展到 core 格式路由、共享 ZIP 读取、PPTX XML 视图以及压缩包浏览器，并裁剪 core/archive 的 npm 发布文件。没有新增运行时依赖或改变公开 API，后端 Go 转换边界保持不变。

后续轮次：[EPUB、思维导图、Visio 与 3D 资源准备优化](document-resources-performance.zh-CN.md)；本文保留共享读取与发布包裁剪的历史测量。

## 改动

- 格式推断通过查询/片段位置和最后一个路径分隔符定位文件名，省去两次字符串数组拆分；保留 Windows/Unix 路径、隐藏文件、Dockerfile/Makefile 和分卷文件规则。
- ZIP 索引仅在出现独立 `.` 或 `..` 路径段时拆分并规范化路径。普通条目保留原始字符串，重复分隔符和类似 `...` 的文件名语义不变。这条共享路径用于 Office、EPUB/CBZ、思维导图、图表、iWork 和部分 3D 容器读取。
- PPTX 的有序 XML 转换为查找视图时直接枚举自有字段，减少逐节点的键数组和属性键值对数组；区分空元素、纯文本和复杂子元素时至多检查两个键。通用 XML 回退、属性覆盖及原型相关字段处理保持一致。
- 压缩包目录复用已有名称顺序，其他排序仅在排序选项变化时计算，搜索复用排序结果。键盘上下移动直接使用相邻 DOM 行，省去每次收集并扫描全部行。
- core/archive 与此前 XLSX 一样，在 npm 文件清单中排除 `.map`，声明文件关闭映射生成。构建仍生成本地 JS 映射，hidden 模式去掉发布 JS 中的映射链接。

## 性能对照

Apple M4 Pro / Node.js v20.20.2。前后交替运行，预热 3 轮、测量 9 轮，表中为中位数。输入创建、模块导入、断言和完整输出哈希在计时外，各轮完整输出一致。

| 用例 | 修改前 | 修改后 |
| --- | ---: | ---: |
| 10 万个路径推断扩展名 | 33.31 ms | **21.72 ms** |
| 10 万个路径匹配编译后的格式路由 | 37.72 ms | **24.74 ms** |
| ZIP 索引 1,000 条目并导出完整元数据 | 0.62 ms | **0.43 ms** |
| ZIP 打开并读取 1,000 个条目全文 | 1.35 ms | **0.91 ms** |
| ZIP 索引 20,000 条目并导出完整元数据 | 18.70 ms | **13.66 ms** |
| 20,000 个 XML 部件节点，生成有序/查找两个视图 | 38.09 ms | **34.49 ms** |
| 完整读取 `sample-deck.pptx` | 13.07 ms | 13.06 ms |
| 完整读取 `rich-pptx-shapes.pptx` | 11.30 ms | **10.13 ms** |

格式、ZIP 和完整 PPTX 使用生产 ESM 产物。XML 单项使用同一构建器打包内部入口，包含分词与分组，不含 ZIP 和字节解码。PPTX 每轮在计时前导入新的入口模块，重置运行时生成的 ID，才能逐字段比较完整模型；ZIP、媒体等共享模块继续复用。数据不代表冷启动首屏。

两份完整 PPTX 中，一份基本持平，另一份耗时减少约 10%；不能把路径或 XML 单项的降幅直接推算为所有文档的打开速度。

## 浏览器交互

Chromium 147.0.7727.15，1024 × 768，en-US/UTC。旧版和新版 archive 生产 JS 通过 Vite 解析依赖，共用同一版 core、CSS 和 ZIP 输入；每轮新建会话，交替运行，预热 2 轮、测量 7 轮。逐轮比较完整状态、搜索结果 DOM 和焦点轨迹。

| 用例 | 修改前 | 修改后 |
| --- | ---: | ---: |
| 200 行，200 次上下键操作 | 7.60 ms | **4.70 ms** |
| 5,000 行，200 次上下键操作 | 75.60 ms | **4.70 ms** |
| 200 行，4 次搜索与结果 DOM 重建 | 4.50 ms | 5.00 ms |
| 5,000 行，4 次搜索与结果 DOM 重建 | 21.50 ms | 22.50 ms |
| 200 行，加载至同步 DOM 完成 | 1.90 ms | 1.80 ms |
| 5,000 行，加载至同步 DOM 完成 | 38.60 ms | 37.50 ms |

键盘操作在 5,000 行样例上约快 16 倍。搜索仍需过滤文件名并重建匹配 DOM，本轮没有一致提速，较慢结果也保留。计时包含同步事件处理和焦点变化，排除输入生成、模块加载、校验和哈希；不包含动画帧等待，也不等同于物理按键到屏幕绘制的延迟。

## 发布包与运行时体积

同一 Node 压缩实现，大小单位为字节。npm 包包括包内资源和 WASM，不含依赖。基线使用修改前保存的 dist 和包元数据实际打包，archive CSS 固定为同一份，避免计入此轮以外的样式变化。

| npm `.tgz` | 修改前 | 修改后 | 减少 |
| --- | ---: | ---: | ---: |
| `@filens/core` | 440,943 | **142,090** | 298,853（67.8%） |
| `@filens/archive` | 572,150 | **489,201** | 82,949（14.5%） |
| 合计 | 1,013,093 | **631,291** | **381,802（37.7%）** |

运行时单独统计两个包全部 JS/MJS，包括 archive Worker，逐文件压缩后求和；不计依赖、CSS、WASM 和映射。

| JS/MJS 合计 | 修改前 | 修改后 | 变化 |
| --- | ---: | ---: | ---: |
| 原始字节 | 610,506 | 610,590 | +84 |
| gzip 9 | 150,703 | 150,606 | **−97** |
| Brotli | 127,586 | 127,521 | −65 |

npm 包收益主要来自映射文件，运行时传输大小基本持平。7zip WASM 字节与哈希保持一致并通过 `WebAssembly.validate`；保留按需引擎、格式支持与本地 JS 调试映射。

## 验证与复跑

- 9 个相关包共 **1,621 项单元测试通过，11 项既有测试跳过**（7 项缺少外部样本，4 项原有禁用）：core 445、archive 310、books 30、mindmap 25、diagram 31、model3d 340、iwork 336、xlsx 80、docx 24。
- **19 项 Chromium 回归通过**，覆盖压缩包浏览、搜索/排序、焦点恢复、嵌套容器、媒体/3D 条目、取消、ZIP 大条目/伪造大小与 XLSX 生命周期。
- 实际解包 npm 产物，检查 93 项主入口运行时导出、两个 core 子路径、公开资源与 82 处声明相对引用；确认无映射文件或失效映射链接。打包后的 ZIP 全部字节、PPTX 模型和压缩包资源索引与基线一致。
- core/archive 声明构建、2,122 项转换策略检查及分类包边界检查通过。

最初扩大测试时因磁盘不足未能启动，清理 223.8 MiB 可重建的跨平台 Cargo 依赖缓存后重跑通过；这些失败运行没有计入通过数。未测量峰值内存、网络传输和完整预览启动时间。

[全部采样、包文件清单、源码/产物哈希与验证结果](../benchmarks/frontend/2026-11-04/shared-readers.json)；[本轮修改前的八份源码/配置](../benchmarks/frontend/2026-11-04/shared-readers-source-baseline.json.gz)。基线是包含此前未提交改动的工作区构建，并非 Git HEAD；在独立 checkout 中复原归档文件后构建，避免覆盖当前工作。

```sh
# 修改前保存基线；目录已存在时使用新路径，避免覆盖历史产物
npm run build:core
npm run build:archive
mkdir -p tmp/shared-readers-baseline
cp -R packages/core/dist tmp/shared-readers-baseline/core-dist
cp -R packages/archive/dist tmp/shared-readers-baseline/archive-dist
gzip -dc benchmarks/frontend/2026-11-04/shared-readers-source-baseline.json.gz > tmp/shared-readers-baseline/sources.json
npm pack --workspace @filens/core --workspace @filens/archive --pack-destination tmp/shared-readers-baseline --ignore-scripts --json > tmp/shared-readers-baseline/npm-pack.json

# 应用修改后，采样期间不要并行运行构建或测试
npm run build:core
npm run build:archive
mkdir -p tmp/shared-readers-current
npm pack --workspace @filens/core --workspace @filens/archive --pack-destination tmp/shared-readers-current --ignore-scripts --json > tmp/shared-readers-current/npm-pack.json
node scripts/verify-shared-reader-packages.mjs
node scripts/benchmark-shared-readers.mjs
node scripts/benchmark-archive-controls.mjs
```
