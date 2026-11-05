# 批量路径与规则匹配优化

2026-11-04，参考 Common 的路径分段 trie，将重复扫描改为按需建立索引。没有增加运行时依赖，也没有将解析逻辑移到 Go 后端。

KMZ 仍先匹配精确路径，再做不区分大小写的唯一匹配，最后做唯一后缀匹配。大小写索引是 Map；后缀索引将路径段倒序，例如 `models/textures/a.png` 按 `a.png → textures → models` 遍历。节点记录唯一资源或歧义标记，不能把 Common 的“最长前缀命中”直接用于此处。只索引存在前导 `/` 的真后缀，保持旧实现的匹配范围。索引在首次需要对应兜底时建立；只用精确路径的包不会建立这些索引。

内置格式路由在首次使用默认 registry 时编译成扩展名、MIME 两张 Map，由后续默认 registry 共享。保留首条规则优先、已有扩展名时不回退 MIME 等行为。自定义规则数组仍实时查询，以支持调用方修改数组、扩展名和规则顺序。批量调用方也可显式使用导出的 `createFormatRouteResolver(routes)`，建立一份规则索引快照；原有 `resolveFormatRoute` 继续动态读取规则。

OCR 分数处理在 Rust/WASM 内一次扫描 `TextBox[i]` 记录，然后按行编号查询，消除逐行重扫和字符串格式化。保留首条记录优先、缺失分数、无效数值、阈值、正文顺序和来源信息。编号必须为规范的十进制；重复、越界及溢出编号不会导致额外的大数组分配。

实现：[KMZ](../packages/model3d/src/kmz-resources.ts)、[路由](../packages/core/src/preview/formats.ts)、[registry](../packages/core/src/preview/registry.ts)、[OCR](../wasm/converter-core-rust/src/text/ocr_scores.rs)。

## 性能

环境：Apple M4 Pro、Node.js v20.20.2、Chromium；完整浏览器版本、源码/构建哈希和逐次样本见[测量记录](../benchmarks/frontend/2026-11-04/batch-matching.json)。前后实现交替运行，预热 3 轮、测量 9 轮，取中位数。输入创建、模块加载、结果核对和哈希在计时外。KMZ 的首次查询包含基础路径 Map 和实际触发的兜底索引，复用查询在计时前建立索引。路由的 fresh 项指新建 registry，仍复用模块级默认索引；模块首次建表成本没有单独计时。小 KMZ 用例每轮重复 32 次，以降低浏览器计时精度的影响。

| 用例 | 修改前 | 修改后 | 加速 |
| --- | ---: | ---: | ---: |
| KMZ 32 个文件、32 次后缀查找，含建索引 | 0.116 ms | 0.0375 ms | 3.1 倍 |
| KMZ 1 万个文件、512 次后缀查找，含建索引 | 339.9 ms | 4.9 ms | 69 倍 |
| 同上，索引已建立 | 334.9 ms | 0.4 ms | 837 倍 |
| KMZ 1 万个文件、512 次大小写兜底，含建索引 | 142.5 ms | 3.2 ms | 45 倍 |
| KMZ 1 万个文件、512 次缺失路径查询，含建索引 | 319.7 ms | 4.9 ms | 65 倍 |
| 默认格式路由 2 万次查询，复用索引 | 12.2 ms | 2.7 ms | 4.5 倍 |
| OCR 512 行分数解析，WASI 微基准 | 8.485 ms | 0.0358 ms | 237 倍 |
| OCR 4000 行分数解析，WASI 微基准 | 501.0 ms | 0.275 ms | 约 1820 倍 |

对照：1 万文件 KMZ 的 512 次精确路径查询，含创建基础路径 Map，为 2.5 → 2.6 ms；索引复用时均为 0.3 ms。32 文件的精确路径查询均约 0.028 ms。自定义可变规则的 2 万次查询均为 11.5 ms。优化针对反复扫描，精确路径和可变规则没有相同收益。

OCR 微基准从修改前源码提取原始查询表达式，与实际新 helper 分别编译成 WASI 模块，在 Node WASI 中执行。4000 条记录逆序排列；两种实现的输出校验一致，完整生产 WASM 另做逐字段对照。这个数字衡量分数记录解析，不包含 OCR 模型推理、图片准备或整份文档提取；路径数字也不包含解压、网络和渲染。额外索引需要内存，本轮没有测峰值内存。

## 体积

前后 JavaScript 使用相同当前依赖和无关工作区改动重新构建，基线通过 Vite 的 load hook 注入修改前源码。统计包输出的所有 JS chunk，排除 CSS、声明、source map 和外部依赖；逐 chunk gzip 级别 9、Brotli 默认质量 11 后求和。

| 产物 | 原始字节，前 → 后 | gzip 字节，前 → 后 | gzip 变化 |
| --- | ---: | ---: | ---: |
| core 包全部 JS | 504,694 → 505,255 | 117,127 → 117,256 | +129 |
| model3d 包全部 JS | 182,413 → 183,425 | 46,195 → 46,484 | +289 |
| 生产 converter-text.wasm | 8,516,619 → 8,514,247 | 3,182,461 → 3,181,362 | **−1,099** |

JavaScript gzip 合计增加 **418 字节**。文本 WASM 原始大小减少 **2,372 字节**、gzip 减少 **1,099 字节**、Brotli 减少 250 字节。这是很小的体积变化，主要收益是批量查询耗时；没有据此宣称完整网页、CLI 安装包或首屏大小有同等变化。

WASM 前后均用 Rust 1.93.0、`text-extraction,postscript`、`wasm32-wasip1` release 和现有 `privateRustBuildEnv` 编译，再用 Binaryen 131.0.0 执行 `-Oz --strip-debug --strip-producers --enable-bulk-memory --enable-nontrapping-float-to-int`。测量前核对非空、WASM 有效性及 SHA-256，避免将失败构建的空文件计为体积下降。

## 验证与保留项

- core：424 项通过，11 项已有外部样本测试跳过；registry 最终改为共享延迟索引后，3 项专门回归再次通过。
- model3d：340 项通过；最终细节调整后，31 项 KMZ 索引和资源加载测试再次通过。
- Rust 文本模块：45 项通过，包括现有正文/来源测试及新的分数索引测试。
- 生产 WASM：5 组注入 OCR 响应的提取对照通过，涵盖缺失/重复/乱序记录、阈值关闭、非法分数、空结果和 4000 行输入。前后完整结果除耗时字段外逐字段一致，包括正文、置信度、错误、来源和布局。
- Chromium：5 项 KMZ 回归通过，涵盖纹理像素、嵌套路径、重复 URL、取消加载、失败图片及上传流程。平铺/嵌套和同步/异步渲染像素哈希一致。
- core/model3d 的生产及声明构建、转换边界检查（2122 项）通过。

压缩包目录已经有延迟建立的目录索引，通用资源解析器已有精确路径、去根路径和唯一 basename 索引，本轮保留这些实现。摘要的小词表使用任意位置的子串匹配；普通路径 trie 不能直接替换，未添加 Aho–Corasick 依赖，也未声称该路径获得性能收益。图片相似匹配继续使用现有 BK-tree。

## 复跑

当前工作区修改前基线保存在 `tmp/batch-matching-before`。源码基线也保存在[压缩归档](../benchmarks/frontend/2026-11-04/batch-matching-source-baseline.json.gz)，可恢复至单独目录，复跑 JavaScript 体积与匹配性能。该归档不进入运行时产物。

```sh
node --input-type=module <<'JS'
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { gunzipSync } from 'node:zlib';
const snapshot = JSON.parse(gunzipSync(await readFile('benchmarks/frontend/2026-11-04/batch-matching-source-baseline.json.gz')));
for (const [name, source] of Object.entries(snapshot.files)) {
  const target = join('tmp/batch-matching-replay-before', name);
  await mkdir(dirname(target), { recursive: true });
  await writeFile(target, source);
}
JS
node scripts/benchmark-batch-matching.mjs \
  --baseline tmp/batch-matching-replay-before --output tmp/batch-matching-replay.json
```

若要重新比较生产 WASM 大小，还需分别保留前后生产 WASM；本次工作区已有这两个文件：

```sh
node scripts/benchmark-batch-matching.mjs \
  --baseline tmp/batch-matching-before \
  --wasm-after tmp/batch-matching-text-after.wasm \
  --output tmp/batch-matching-replay-with-wasm.json
node --no-warnings scripts/test-ocr-score-index.mjs \
  --wasm tmp/batch-matching-text-after.wasm \
  --baseline tmp/batch-matching-before/wasm/converter-text.wasm
```

若从改动前版本重新实施本轮优化，可先用 `--snapshot <目录>` 保存源码；生产 WASM 构建沿用 `scripts/build-agent-cli.mjs` 中相同的文本模块构建参数。性能测量应避开同时运行的构建和测试，比较结果前先核对基线归档、源码、锁文件和产物哈希。

后续的 Office 媒体清单与精确搜索优化，以及独立的性能、体积和一致性对照，见[第二轮报告](batch-matching-round2-performance.zh-CN.md)。
