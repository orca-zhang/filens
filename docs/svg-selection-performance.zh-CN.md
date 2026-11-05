# SVG 选择交互优化

2026-11-04，思维导图和流程图共用前端核心中的 `bindPreviewSvgSelection`。每张 SVG 只绑定一个点击事件和一个键盘事件，节点保留原有可聚焦属性、标签和 Enter/空格操作。初始化时建立 ID 索引，选择时只更新前后选中的元素，保留重复 ID 同时高亮的行为。切页、替换文件及销毁时移除监听器和索引，旧 SVG 事件不再影响当前页面。没有新增运行时依赖。

## 实测范围

环境：Apple M4 Pro、Node.js v20.20.2、Chromium 147.0.7727.15。比较本轮修改前保存的 mindmap/diagram 构建产物与当前产物，复用相同核心库和样式。每类合成文档含 2,000 个节点，两个实现交替运行；预热 2 次，随后 7 次取中位数。模块已加载，使用同一浏览器页面，每次重新创建并销毁会话。

计时内连续派发 500 次节点形状点击，包含事件处理、状态更新和 class 更新，排除模块下载、布局、绘制和用户输入等待。每次校验节点数、状态事件数、最终选中 ID；初始及选择后的完整 SVG SHA-256 在所有轮次与两个实现之间一致。

| 用例 | 修改前 | 修改后 |
| --- | ---: | ---: |
| 思维导图：500 次选择 | 117.2 ms | 1.2 ms |
| 流程图：500 次选择 | 143.5 ms | 1.2 ms |
| 每张 SVG 的点击及键盘监听器 | 4,000 个 | 2 个 |

完整加载至 `load()` 返回基本持平：思维导图 9.3 → 9.1 ms，流程图 11.9 → 11.9 ms。以上选择处理收益不代表完整加载或用户可见交互延迟同比下降；未测量峰值内存。

[机器可读结果与各次样本](../benchmarks/frontend/2026-11-04/svg-selection.json)保留完整 SVG 哈希及参与测量的构建文件哈希。

## 复跑

```sh
npm run build:core
npm run build:mindmap
npm run build:diagram
node scripts/benchmark-svg-selection.mjs
# 可选：与修改前保存的 dist 比较
node scripts/benchmark-svg-selection.mjs --baseline tmp/svg-selection-baseline
```

基线目录需要包含修改前的 `mindmap-dist/index.js`、`diagram-dist/index.js` 及各自的构建分包。基线应在修改源码前构建并复制保存；当前模式不需要基线。测量时不要同时运行其他构建或测试，临时打包目录会自动清理。

## 验证

相关单元测试 64 项通过，浏览器回归 12 项通过；1 项真实 VSDX 外部语料测试因缺少语料跳过。覆盖重复及特殊字符 ID、嵌套图形点击、Enter/空格、取消选择、旧页面事件、切页、文件替换、销毁、缩放及自适应布局。

core、mindmap、diagram 声明构建和 demo、split、all-in-one 生产构建通过。两种独立预览产物均在 Chromium 中打开思维导图和流程图，验证鼠标、键盘选择及销毁。转换策略与分类包边界检查通过。
