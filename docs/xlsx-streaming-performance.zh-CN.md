# XLSX 流式求和与整行范围读取

2026-11-04，在[首轮有序索引与 bitmap 优化](xlsx-cell-index-performance.zh-CN.md)上继续减少公式求值开销。基线是上一轮完成后的工作区构建，构建 SHA-256 与上一轮报告中的优化后产物一致。

本页保留该轮测量；后续的索引构建、普通单元格读取与发布包裁剪见[最新实测](xlsx-compact-performance.zh-CN.md)。

`SUM(A1:A8192)` 及 `SUM(((A1:A8192)))` 现在直接逐格读取、累加，省去整个范围的临时数值数组和第二次遍历。每个值加入当前 SUM 累加器，保留不同参数之间的浮点顺序；嵌套 SUM 仍独立计算，溢出、依赖缓存、错误回退和循环引用保持一致。只对完整的范围参数使用这条路径；范围算术和错误表达式继续使用通用求值路径，保留报错前的依赖读取行为。

范围完整覆盖某行数据时，[单元格索引](../packages/xlsx/src/cell-index.ts)直接访问该行已有的连续数据。只有裁剪首尾列时才进行列块查找和 bitmap rank 计算。[公式读取](../packages/xlsx/src/parser.ts)也调整为先解析数值，遇到非数值再识别布尔文本，省去普通数值每次两遍大小写转换。

## 同场对照

Apple M4 Pro / Node.js v20.20.2。两版交替运行，预热 2 轮、测量 7 轮，表中为中位数。每次使用独立模型，验证全部公式结果和求值后完整模型哈希。输入创建、复制、模块导入与结果核对均在计时外；标注“索引已建立”的场景在计时前建立索引。

| 用例 | 上一轮版本 | 本轮版本 |
| --- | ---: | ---: |
| 32 个公式，各汇总 8,192 格，包含建立索引 | 15.03 ms | 5.40 ms |
| 同上，索引已建立 | 16.17 ms | 5.55 ms |
| 对照：8,192 个单格引用公式，包含建立索引 | 5.26 ms | 4.98 ms |
| 密集 256 × 256 范围，8 个公式，包含建立索引 | 29.86 ms | 15.99 ms |
| 稀疏百万格范围，仅 256 个数据格，8 个公式，包含建立索引 | 0.285 ms | 0.197 ms |
| 同上，索引已建立 | 0.154 ms | 0.059 ms |
| 对照：2 × 2 范围，1 个公式 | 0.00329 ms | 0.00388 ms |

长列范围的公式求值耗时约减少 64%。宽表的单次测量波动较大，两版全部样本均保留；微秒级对照仅观察固定开销，不作稳定提速判断。这里比较生成模型的公式求值，不代表完整解析、浏览器首屏或其他产品排名；没有测量峰值内存。

另一组使用相同索引基准的长列模型为 15.33 → 5.85 ms（包含建立索引）、14.45 → 4.99 ms（索引已建立）。模型和公式取值与上表首组不同，原始记录分别保存。XLSX 入口 gzip 9 从 10,147 增至 10,496 字节，本轮增加 349 字节。

[范围采样、源码身份、构建体积及差分核对](../benchmarks/frontend/2026-11-04/xlsx-streaming.json) · [既有公式基准复测](../benchmarks/frontend/2026-11-04/xlsx-streaming-controls.json)

## 验证

62 项 XLSX 单元测试通过，包括新增的括号范围、嵌套 SUM 浮点分组、中间结果溢出、范围表达式报错前的依赖求值，以及非数值错误后的停止读取。

[独立新旧版本核对脚本](../scripts/verify-xlsx-formula-equivalence.mjs)对 31 类公式、8 组值和 3 类布局组合执行 744 次完整模型比较，全部一致。组合覆盖正常值、布尔文本、空值、非数值、极大/极小浮点数、乱序和重复坐标，并同时比较依赖单元格的值和 needsCalculation 状态。

3 项 Chromium 工作簿回归、声明构建及 2,122 项转换策略检查通过。测试覆盖公式显示、字体、追加行、工作表切换、文件替换、取消与销毁。

## 复跑

```sh
# 修改前保存上一轮构建
npm run build:xlsx
mkdir -p tmp/xlsx-streaming-baseline
cp -R packages/xlsx/dist tmp/xlsx-streaming-baseline/xlsx-dist

# 应用本轮修改后执行；采样期间避免并行构建、测试
npm run build:xlsx
node scripts/verify-xlsx-formula-equivalence.mjs --baseline tmp/xlsx-streaming-baseline/xlsx-dist
node scripts/benchmark-xlsx-cell-index.mjs --baseline tmp/xlsx-streaming-baseline/xlsx-dist
node scripts/benchmark-xlsx-formulas.mjs --baseline tmp/xlsx-streaming-baseline/xlsx-dist
npm run test --workspace @filens/xlsx
npx playwright test apps/demo/e2e/workbook-lifecycle.e2e.ts --workers=1
npm run verify:conversion-policy
```
