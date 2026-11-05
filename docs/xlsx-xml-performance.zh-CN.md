# XLSX 工作表 XML 解析优化

2026-11-04，在[索引与发布包裁剪版本](xlsx-compact-performance.zh-CN.md)上继续优化完整 XLSX 读取。普通数值/共享字符串样例快约 10%；带简单 `sheetData` 属性的样例可进入快速解析路径，从 235.71 ms 降到 56.47 ms。该结果针对生成样例，不代表所有 XLSX 文件都有同等收益。

## 实现

- 单元格属性、值、数值、布尔值和引用的正则表达式提升到模块作用域，避免逐格创建。带游标的属性匹配每次执行前都设置位置，拒绝输入后也不会污染下次读取。
- 属性解析使用固定字段对象，仅保存实际读取的 `r`、`s`、`t`、`customFormat`，继续检查其他属性的语法。
- `sheetData` 的简单属性通过检查后可使用快速路径；列样式元数据的前缀定位同步支持带属性的标签。实体、引号内的 `>`、注释、富文本、公式和其他不支持的 XML 继续交给通用解析器。
- 列样式缓存改用数组，仅缓存实际读取的列，不展开声明范围；保留第一个匹配声明、无样式重叠、显式零样式和行/单元格覆盖的语义。

没有新增依赖或改变公开 API。此前 npm 包排除源码映射的设置继续保留。

## 完整解析对照

Apple M4 Pro / Node.js v20.20.2。每个工作表为 2,000 行 × 64 列，共 128,000 格，混合数值和共享字符串。预热 2 轮，交替测量 7 轮，表中为中位数。计时包括 ZIP 索引、解压与解析；输入生成、模块导入、完整模型哈希与渲染在计时外。每次比较完整工作簿模型，结果全部一致。

| 用例 | 修改前 | 修改后 |
| --- | ---: | ---: |
| 无列样式 | 55.83 ms | **50.28 ms** |
| 带列样式 | 67.31 ms | **59.60 ms** |
| 带列样式及简单 `sheetData` 属性 | 235.71 ms | **56.47 ms** |
| 通用 XML 路径，带列样式 | 232.88 ms | 231.11 ms |

前两项耗时分别减少 9.9% 和 11.5%。带属性样例从通用解析切换到快速路径，约为原来的 4.17 倍速度；通用 XML 路径基本持平。通用路径的夹具现在使用注释强制回退，避免属性已被支持后误测到快速路径，因此应使用本轮成对数据比较。

本轮没有修改公式逻辑，保留公式对照的全部采样，包括较慢的结果：

| 公式对照 | 修改前 | 修改后 |
| --- | ---: | ---: |
| 32 个 SUM，各汇总 8,192 格，包含建立索引 | 4.80 ms | 4.79 ms |
| 同上，索引已建立 | 4.70 ms | 5.04 ms |
| 8,192 个单格引用公式 | 4.97 ms | 5.14 ms |

这些数毫秒级测量会受 JIT、GC 和调度影响，本轮不据此宣称公式提速。未测量峰值内存或浏览器首屏，也不用于其他产品的性能排名。

## 体积代价

同一构建命令和 Node 压缩实现，大小单位为字节。npm 包只计算 `@filens/xlsx` 自身，运行时只计算其 JS 入口。

| 范围 | 修改前 | 修改后 | 增加 |
| --- | ---: | ---: | ---: |
| npm `.tgz` | 13,115 | 13,195 | 80 |
| npm 包展开后 | 41,974 | 42,107 | 133 |
| 运行时 JS 原始大小 | 34,767 | 34,900 | 133 |
| 运行时 JS gzip 9 | 10,456 | 10,532 | **76** |
| 运行时 JS Brotli | 9,324 | 9,427 | 103 |

这轮以少量代码换取解析速度，包体略有增长。此前排除源码映射带来的 npm 包体积收益仍保留，不能将 npm 包体积与网页运行时传输大小混用。

## 验证

- 80 项 XLSX 单元测试通过，新增带普通/命名空间属性的完整模型比较、实体和特殊字符回退、正则游标重置覆盖；字体测试继续覆盖快速和通用两条路径。
- 48 类公式 × 8 组取值 × 3 类布局，共 1,152 次完整模型及依赖缓存状态比较全部一致。
- 实际 npm 产物解包检查通过：10 项运行时导出、公开路径、声明相对引用、无映射文件或失效映射链接，CSV/XLSX 模型与基线一致。
- 声明构建、3 项 Chromium 工作簿回归和 2,122 项转换策略检查通过。

[全部采样、npm 文件清单、源码和产物 SHA-256、验证结果](../benchmarks/frontend/2026-11-04/xlsx-xml.json)

## 复跑

基线是应用本轮修改前的工作区构建，包含此前未提交的优化，并非 Git HEAD。当前会话已保存在 `tmp/xlsx-xml-baseline/`；在新环境复跑需先保存同一版本。

```sh
# 应用本轮修改前保存基线；使用新目录，避免覆盖历史产物
npm run build:xlsx
mkdir -p tmp/xlsx-xml-baseline
cp -R packages/xlsx/dist tmp/xlsx-xml-baseline/xlsx-dist
npm pack --workspace @filens/xlsx --pack-destination tmp/xlsx-xml-baseline --ignore-scripts --json

# 应用修改后，采样期间不要并行运行构建或测试
npm run build:xlsx
mkdir -p tmp/xlsx-xml-current
npm pack --workspace @filens/xlsx --pack-destination tmp/xlsx-xml-current --ignore-scripts --json
node scripts/benchmark-xlsx-columns.mjs --baseline tmp/xlsx-xml-baseline/xlsx-dist
node scripts/benchmark-xlsx-formulas.mjs --baseline tmp/xlsx-xml-baseline/xlsx-dist
node scripts/verify-xlsx-formula-equivalence.mjs --baseline tmp/xlsx-xml-baseline/xlsx-dist
node scripts/verify-xlsx-package.mjs --package tmp/xlsx-xml-current/filens-xlsx-0.1.0.tgz --baseline tmp/xlsx-xml-baseline/xlsx-dist
npm run test --workspace @filens/xlsx
npx playwright test apps/demo/e2e/workbook-lifecycle.e2e.ts --workers=1
npm run verify:conversion-policy
```
