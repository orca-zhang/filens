# XLSX 有序分块索引与 bitmap 优化

2026-11-04，将 Rust BTreeMap 的有序键、连续分块思想用于前端 XLSX 公式读取，并结合 bitmap 压缩列占用信息。本页记录首轮实现及测量，后续的流式求和和整行访问优化见[后续实测](xlsx-streaming-performance.zh-CN.md)。实现位于 [cell-index.ts](../packages/xlsx/src/cell-index.ts)，由 [parser.ts](../packages/xlsx/src/parser.ts) 按工作表惰性建立并复用，没有新增依赖。

工作表在预览期间以读取为主，因此采用静态两级目录：先定位已有行，再定位该行的 32 列块。目录使用有序数值数组，每块只有一个 32 位占用 bitmap 和实际存在的单元格引用。单格引用通过二分查找、位测试和 popcount 定位；范围读取通过首尾 bitmap 计算连续数据的边界，按行列顺序访问实际单元格，省去空格扫描及逐格字符串键查找。这是借鉴 B 树布局的静态索引，并未引入动态 B 树或 Rust 运行时。

已有顺序的输入线性建立索引；乱序输入仅排序私有排列，重复坐标保留最后一次声明。坐标使用 Float64Array，避免将完整行列号做 32 位运算导致回绕；bitmap 只处理块内位置。存储随已有行、已有列块和实际单元格数量增长，不随工作表声明的矩形面积增长。

首轮公式实现先按原顺序读取整个范围，再进行 SUM 累加；临时数值数组只包含实际单元格。依赖求值、布尔值、空值、浮点加法顺序、错误回退与循环引用行为保留。索引继续使用 WeakMap 随工作表释放；与原来的公式索引一样，不支持建立后增删坐标，已有单元格对象的值仍可更新。

## 同场对照

Apple M4 Pro / Node.js v20.20.2，修改前保存当前工作区的 XLSX 构建作为基线，修改后使用相同构建命令。基线包含此前尚未提交的 XML 和公式优化，并非 Git HEAD。两版交替执行，预热 2 轮、测量 7 轮，表中为中位数。

| 用例 | 修改前 | 修改后 |
| --- | ---: | ---: |
| 稀疏 4,096 × 256 范围，仅 256 个数据格，8 个公式，包含建立索引 | 513.41 ms | 0.319 ms |
| 同上，索引已建立 | 496.73 ms | 0.121 ms |
| 密集 256 × 256 范围，8 个公式，包含建立索引 | 55.29 ms | 17.22 ms |
| 密集 8,192 × 1 范围，32 个公式，包含建立索引 | 23.84 ms | 12.83 ms |
| 同上，索引已建立 | 23.09 ms | 12.80 ms |
| 对照：2 × 2 范围，1 个公式 | 0.00246 ms | 0.00296 ms |

已有独立公式基准也复跑：32 个公式汇总 8,192 格，包含建立索引为 23.97 → 14.23 ms，索引已建立为 24.40 → 14.49 ms；8,192 个单格引用公式为 4.87 → 4.47 ms。两个测量系列的生成模型和公式不同，分别保留结果。微秒级对照只用于观察固定开销。

输入创建、模型复制、模块加载、结果核对及完整模型 SHA-256 均在计时外。每次运行核对全部公式结果与求值后的完整模型哈希，两版完全一致。以上为生成样例上的公式求值对照，不代表完整工作簿解析、浏览器首屏或同类产品排名；未测量峰值内存。稀疏用例的巨大差距来自跳过空格，不能推导相同比例的实际文件提速。

XLSX 入口 gzip 9 增加 936 字节（约 0.91 KiB），具体原始字节及 gzip 字节记录于结果 JSON。

[完整采样、输入/输出哈希、源码/构建身份及体积](../benchmarks/frontend/2026-11-04/xlsx-cell-index.json) · [既有公式基准复测](../benchmarks/frontend/2026-11-04/xlsx-cell-index-controls.json)

## 验证与复跑

53 项 XLSX 单元测试通过，包括 bitmap 第 31 位、满块、跨块边界、空索引、超过 32 位的稀疏坐标、400 次确定性矩形查询与独立 Map 实现的对照。新增公式回归覆盖整张工作表范围内的稀疏求和、反向范围、乱序和重复坐标、依赖计算以及浮点累加顺序。整表稀疏用例的范围包含 17,179,869,184 个坐标，仅读取 3 个已有单元格。

3 项 Chromium 工作簿回归通过，覆盖公式、字体、追加行、切换工作表、替换文件、取消加载与销毁；声明构建及 2,122 项转换策略检查通过。

```sh
# 在修改源码前保存基线
npm run build:xlsx
mkdir -p tmp/btree-bitmap-baseline
cp -R packages/xlsx/dist tmp/btree-bitmap-baseline/xlsx-dist

# 应用修改后执行；性能采样时避免同时运行构建或测试
npm run build:xlsx
node scripts/benchmark-xlsx-cell-index.mjs --baseline tmp/btree-bitmap-baseline/xlsx-dist
node scripts/benchmark-xlsx-formulas.mjs --baseline tmp/btree-bitmap-baseline/xlsx-dist
npm run test --workspace @filens/xlsx
npx playwright test apps/demo/e2e/workbook-lifecycle.e2e.ts --workers=1
npm run verify:conversion-policy
```
