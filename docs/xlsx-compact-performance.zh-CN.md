# XLSX 索引构建优化与发布包裁剪

2026-11-04，在[流式求和版本](xlsx-streaming-performance.zh-CN.md)上继续优化，保留 XLSX/CSV、公式、字体与公开导出。

后续轮次：[工作表 XML 解析优化](xlsx-xml-performance.zh-CN.md)，记录普通解析和带属性工作表的性能变化及体积代价；本文保留本轮历史数据。

有序工作表现在直接建立 bitmap 索引，省去预先展开全部单元格引用和行坐标的两份临时数组。乱序输入仅排序私有行列表，依次合并、排序一行的数据；稳定排序保留重复坐标最后一次声明的语义，不修改输入模型。

普通单元格读取和已有缓存值直接返回，只有实际计算公式时才建立循环检测集合、进入递归求值。范围算术仍按原来的顺序读取依赖并报错，但使用范围标记替代最终不会返回给用户的数值数组。列名转换合并为共享实现；通用 XML 单元格解析直接读取已确认的对象字段，去掉重复路径数组和私有包装函数。

## 包体积

修改前后使用同一构建命令、Node.js v20.20.2 压缩实现以及真实 `npm pack`。大小单位为字节，npm 包大小只计算 `@filens/xlsx` 自身，不包含依赖。

| 范围 | 修改前 | 修改后 | 减少 |
| --- | ---: | ---: | ---: |
| npm `.tgz` | 40,826 | 13,115 | **27,711（67.9%）** |
| npm 包展开后 | 140,582 | 41,974 | 98,608（70.1%） |
| 运行时 JS 原始大小 | 35,178 | 34,767 | 411 |
| 运行时 JS gzip 9 | 10,514 | 10,456 | 58 |
| 运行时 JS Brotli | 9,383 | 9,324 | 59 |

主要包体收益来自不再发布源码映射。构建仍生成本地 JS 映射，使用 hidden 模式省去运行时的映射链接；npm 文件清单排除 `.map`，声明文件停止生成映射。运行时 JS 本身只小幅缩小，不能将 npm 包的降幅解读为网页运行时的同等降幅。ESM 库仍使用原有压缩和 tree shaking 配置。

## 性能对照

Apple M4 Pro / Node.js v20.20.2。两版交替运行，预热 2 轮、测量 7 轮，表中为中位数。每次使用独立模型，核对完整结果；输入创建、复制、模块导入及完整模型哈希在计时外。

| 用例 | 修改前 | 修改后 |
| --- | ---: | ---: |
| 131,072 个数据格的宽表，仅建立索引并读取 A1 | 2.07 ms | **1.13 ms** |
| 131,072 个数据格的长表，同上 | 2.54 ms | **1.64 ms** |
| 同一长表倒序输入，同上 | 12.19 ms | **5.94 ms** |
| 密集 256 × 256 范围，8 个 SUM，包含建立索引 | 9.42 ms | **5.35 ms** |
| 32 个 SUM，各汇总 8,192 格，包含建立索引 | 5.03 ms | 4.54 ms |
| 同上，索引已建立 | 5.40 ms | 4.49 ms |
| 8,192 个单格引用公式 | 4.31 ms | 4.02 ms |

完整 XLSX 解析另测 2,000 × 64 模型：普通数值表为 53.45 → 53.18 ms，带列样式数值表为 58.96 → 62.78 ms，通用 XML 路径为 222.20 → 219.92 ms。整体解析没有一致收益，带列样式的数值表在本轮较慢。所有样本均保留；小于数毫秒的计时容易受 JIT、GC 和调度影响。

这些是生成模型上的项目内对照，不代表完整浏览器首屏或其他产品排名，未测量峰值内存。临时数组的移除来自代码路径检查，不由本轮推导峰值内存降幅。

[全部采样、npm 文件清单、产物/源码 SHA-256 及验证结果](../benchmarks/frontend/2026-11-04/xlsx-compact.json)

## 验证

- 73 项 XLSX 单元测试通过，覆盖乱序回退、重复坐标、bitmap 边界、公式优先级、循环引用以及错误前的依赖读取顺序。
- 48 类公式 × 8 组取值 × 3 类布局，共 1,152 次新旧完整模型比较全部一致，同时核对依赖缓存状态。
- 实际解包 npm 产物后，检查 10 项运行时导出、公开文件路径、声明相对引用、不含映射文件或失效映射链接；导入打包后的入口，CSV/XLSX 完整模型与基线一致。
- 3 项 Chromium 工作簿回归、声明构建和 2,122 项转换策略检查通过。

## 复跑

```sh
# 在应用本轮修改前，用新目录保存工作区基线
npm run build:xlsx
mkdir -p tmp/xlsx-compact-baseline
cp -R packages/xlsx/dist tmp/xlsx-compact-baseline/xlsx-dist
npm pack --workspace @filens/xlsx --pack-destination tmp/xlsx-compact-baseline --ignore-scripts --json

# 应用修改后，性能采样期间不要并行运行构建或测试
npm run build:xlsx
mkdir -p tmp/xlsx-compact-current
npm pack --workspace @filens/xlsx --pack-destination tmp/xlsx-compact-current --ignore-scripts --json
node scripts/verify-xlsx-package.mjs --package tmp/xlsx-compact-current/filens-xlsx-0.1.0.tgz --baseline tmp/xlsx-compact-baseline/xlsx-dist
node scripts/verify-xlsx-formula-equivalence.mjs --baseline tmp/xlsx-compact-baseline/xlsx-dist
node scripts/benchmark-xlsx-cell-index.mjs --baseline tmp/xlsx-compact-baseline/xlsx-dist
node scripts/benchmark-xlsx-formulas.mjs --baseline tmp/xlsx-compact-baseline/xlsx-dist
node scripts/benchmark-xlsx-columns.mjs --baseline tmp/xlsx-compact-baseline/xlsx-dist
npm run test --workspace @filens/xlsx
npx playwright test apps/demo/e2e/workbook-lifecycle.e2e.ts --workers=1
npm run verify:conversion-policy
```
