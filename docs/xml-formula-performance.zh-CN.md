# XML 按需加载与公式范围求值优化

2026-11-04，本轮调整前端解析和生产构建，没有新增运行时依赖。

常规 PPTX 使用已有的 OpenXML 快速解析器，遇到自定义实体、特殊处理指令等语法才加载通用 XML 库。XLSX 在确认工作簿输入后加载该库，CSV 不加载。两条路径复用同一个生产分包，但各自保留原有解析配置。生产构建直接导出上游 `XMLParser` 类，移除只读预览未使用的 XMLBuilder；原有解析、验证和实体限制实现保留。构建检查会拒绝 XMLBuilder 再次进入产物。

公式范围读取直接传递行列号，省去每个地址的字符串生成、正则匹配和重新解析。`SUM` 按原顺序累加，省去合并参数数组及大数组展开，保持浮点加法顺序。16 万个单元格的求和用例现在可以正确计算，避免触发 JavaScript 函数参数数量上限。

## 体积

修改前重新构建并保存基线，修改后用相同命令构建。分包版在 Chromium 中实际导入入口，统计全部静态 JS 请求；逐文件 gzip 级别 9、Brotli 默认质量 11 后求和。首屏范围不包括按需模块、Worker、独立 WASM 和 CSS。

| 范围 | 修改前 gzip（字节） | 修改后 gzip（字节） | 减少（字节） |
| --- | ---: | ---: | ---: |
| 分包版首屏静态 JS | 623,098 | 611,990 | **11,108** |
| 分包版全部 JS/MJS，包含按需引擎及 Worker | 1,487,306 | 1,485,357 | 1,949 |
| 单文件版主 JS，包含内联引擎及 WASM | 5,061,924 | 5,060,053 | 1,871 |

分包版首屏原始字节从 2,218,045 降至 2,182,891，Brotli 从 527,370 降至 518,181 字节。单文件版 Brotli 基本持平：4,746,774 → 4,746,859 字节。主要收益来自普通预览不再下载通用 XML 库，XMLBuilder 的移除也减少了完整运行时的 gzip 体积。

两个单文件产物的四段内联压缩 WASM 字节逐一核对，哈希完全一致。工作区同期还有其他改动，因此不将跨轮次的历史产物差额归因于本轮优化。

[首屏请求、文件哈希与完整大小](../benchmarks/frontend/2026-11-04/xml-loading-startup.json)；[内联 WASM 对照、源码哈希及 XML 库版本](../benchmarks/frontend/2026-11-04/xml-loading-bindings.json)。

## 公式求值

环境：Apple M4 Pro、Node.js v20.20.2。新旧 XLSX 构建交替运行，预热 2 轮、测量 7 轮，取中位数。输入创建、模块加载、结果核对及完整模型 SHA-256 均在计时外。

| 用例 | 修改前 | 修改后 |
| --- | ---: | ---: |
| 32 个公式各汇总 8,192 个单元格，计入首次建立索引 | **51.0 ms** | **24.4 ms** |
| 同上，索引已建立 | **50.6 ms** | **23.4 ms** |
| 对照：8,192 个单格引用公式，计入建立索引 | 4.92 ms | 5.05 ms |

范围求值约快 2.1 倍，单格引用对照基本持平。每轮使用独立模型、核对所有公式结果及求值后的完整模型哈希；缓存和非缓存索引两种情况分别计时。这是公式求值基准，不代表完整工作簿解析或浏览器渲染耗时，未测量峰值内存。

[各次样本、完整模型哈希及构建哈希](../benchmarks/frontend/2026-11-04/xlsx-formulas.json)。

## 验证

core 的 421 项测试、XLSX 的 48 项测试通过；11 项外部样本测试跳过。最终调整普通 XML 路径的 Promise 分配后，13 项 XML 测试再次通过。新增公式测试覆盖大范围、反向及绝对引用、布尔值、空值、依赖公式、浮点累加顺序、循环引用和不支持的公式。

7 项浏览器回归通过，覆盖 XLSX 字体、增量行、公式、滚动重置、PPTX 字体、文件替换、取消销毁及 TIFF 像素。上传控件的测试定位改为精确匹配“导入文件”，适配页面现有的两个文件输入。

core/XLSX 声明构建及 demo、分包版、单文件版生产构建通过。生产产物的四组浏览器检查分别先打开 XLSX 或需要 XML 回退的 PPTX，确认：

- 文本、CSV、常规 PPTX 在分包版中不请求 XML 引擎。
- 自定义实体 PPTX、两张工作表及公式正常显示，共用一次 XML 分包下载。
- 分包请求尚未返回时可切换到文本，随后重新打开 XLSX/PPTX 正常。
- 单文件版正常显示相同内容，销毁后宿主清空，所有场景没有预览错误或页面异常。

[生产产物检查记录](../benchmarks/frontend/2026-11-04/xml-loading-production-smoke.json)。转换策略和分类包边界检查通过，本轮文件的语法及空白检查通过。

## 复跑

```sh
npm run build:core
npm run build:xlsx
node scripts/benchmark-xlsx-formulas.mjs
# 可选：修改前保存的 XLSX dist
node scripts/benchmark-xlsx-formulas.mjs --baseline tmp/xml-formula-baseline/xlsx-dist

FILENS_PREVIEW_BUILD=split npm exec --workspace filens-preview -- vite build
FILENS_PREVIEW_BUILD=all-in-one npm exec --workspace filens-preview -- vite build
npm run build:demo
node scripts/test-xml-loading.mjs
node scripts/report-preview-startup.mjs
# 可选：修改前保存的预览 dist，包含 split/ 和 all-in-one/
node scripts/report-preview-startup.mjs --baseline tmp/xml-formula-baseline/preview-dist
```

基线应在修改源码前构建并保存。体积比较需要核对同一组引擎输入；性能测量应避开同时运行的构建和测试。
