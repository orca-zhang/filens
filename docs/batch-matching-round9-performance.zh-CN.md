# 批量匹配第九轮：SIMD 分词扫描与规范化

2026-11-04，接续[第八轮](batch-matching-round8-performance.zh-CN.md)，在共享 Rust/WASM 搜索核心中实现 SIMD ASCII 快路径。原生 CLI 默认启用，前端可选择 SIMD128 WASM，并保留 scalar 回退。转换与解析逻辑仍位于共享核心。

## 实现与边界

- `search-simd` 功能集中在 [search_simd.rs](../wasm/converter-core-rust/src/text/search_simd.rs)。WASM 使用 SIMD128；原生 x86-64 使用基线 SSE2，AArch64 使用基线 NEON；其他目标使用标量实现。
- 至少 32 字节的输入以 16 字节为一组，合并 ASCII 检测与小写转换；首个向量含非 ASCII 时先返回，避免为常见中文输入分配临时输出。后续向量或尾部含 Unicode 时丢弃临时缓冲，按原规则对完整原文执行 NFKC 与小写转换，保留跨字符组合语义。短输入沿用标量路径。
- ASCII 分词用向量比较识别字母、数字和 `.-_`，通过位掩码定位分隔符。单词可跨任意多个向量，继续借用规范化文本切片；停用词、首尾修剪、复合词拆分与数字规则由同一份回调处理。
- 只有证明整段文本为 ASCII 后才开始发射词，混合 UTF-8 不会先发射一部分再重复回退。所有向量读写均限定在完整 16 字节范围内，不要求地址对齐；不足 16 字节的尾部使用标量逻辑。
- 中文分词、词频、块长度、查询特征预算、浮点评分顺序、排名和摘录来源映射保持一致。没有使用 SIMD 浮点归约。

原生 CLI 的默认功能启用 `search-simd`，其解释器资源仍使用 scalar WASM。前端通过 `createWasmCoreRunner({ wasm, simdWasm })` 检测能力并只加载选中的产物；SIMD 加载或编译失败时回退，操作执行错误直接传播，不重复执行。额外能力导入通过 `imports` 提供，WASI 仍由每次调用独立持有。

生产构建用 `--enable-simd` 允许 Binaryen 优化 SIMD 模块；指令审计也发现其把部分内存搬运改成了 `v128.load/store`。因此下表测量的是整个发布模块的收益，包含手写扫描器和优化器转换，不能把所有改善都归因于单个内核。scalar 产物中没有 SIMD 指令。

## WASM 完整操作性能

Apple M4 Pro、Node.js v20.20.2，前端真实 `InMemoryWasiHost`；每次使用新实例。计时包含实例创建、内存文件读取、JSON 解析、搜索、评分、序列化和结果写入；编译、host 初始化、输入生成、输出读取与断言在计时外。前后交替执行，预热 3 轮、测量 9 轮，取中位数；每轮验证完整响应哈希。这里不包含浏览器界面、目录扫描、文件提取、磁盘 I/O、OCR 和 CLI 启动。

| 用例 | scalar | SIMD128 | 耗时变化 |
| --- | ---: | ---: | ---: |
| 英文 BM25，32 文件（九轮） | 0.966 ms | 0.922 ms | 见追加采样 |
| 英文 BM25，1,000 文件 | 12.631 ms | 10.947 ms | −13.3% |
| 64 个长文件，深层目录，文件名短语命中 | 100.529 ms | 82.847 ms | −17.6% |
| 同上，文件名短语不命中 | 101.347 ms | 84.136 ms | −17.0% |
| 中文 BM25，64 文件 | 99.819 ms | 99.751 ms | −0.1% |
| 16 查询词、64 文件 | 81.376 ms | 69.831 ms | −14.2% |
| 文件名搜索，1 万英文名称 | 29.807 ms | 27.025 ms | −9.3% |
| 文件名搜索，1 万中文深层路径 | 433.724 ms | 431.213 ms | −0.6% |
| BM25，1 万深层路径，正文为空 | 20.349 ms | 20.043 ms | −1.5% |
| 字面精确搜索，1 万文件 | 15.187 ms | 15.280 ms | +0.6% |
| 16 查询词、6,400 块，缓存超限 | 198.043 ms | 171.187 ms | −13.6% |
| 64 查询词、10,240 块，缓存超限 | 350.564 ms | 300.227 ms | −14.4% |
| 128 查询词、仅两词命中 | 24.534 ms | 20.959 ms | −14.6% |
| 字面精确搜索，5 万乱序深层路径 | 304.527 ms | 311.913 ms | +2.4% |
| 128 种正文词、32 文件 | 152.031 ms | 125.453 ms | −17.5% |
| 256 查询词、仅两词命中 | 26.065 ms | 22.253 ms | −14.6% |
| 文件名搜索，2,000 条混合 Unicode 路径 | 98.181 ms | 98.695 ms | +0.5% |

长正文与正文词汇用例的耗时减少约 **17%–18%**，稀疏查询约 **15%**，1 万英文名称约 **9%**。中文用例基本持平；5 万文件字面精确搜索回退约 **2.4%**。

小语料另行预热 20 轮、测量 51 轮，保持 WASM、输入和完整响应哈希一致：

| 追加采样用例 | scalar | SIMD128 | 耗时变化 |
| --- | ---: | ---: | ---: |
| 英文 BM25，32 文件 | 0.902 ms | 0.977 ms | +8.4% |
| 英文 BM25，1,000 文件 | 12.676 ms | 10.954 ms | −13.6% |

32 文件在追加采样中仍慢约 **0.076 ms（8.4%）**，九轮结果不足以宣称小批量变快。1,000 文件约减少 **14%**，与主测量方向一致。本轮保留这些取舍。

## 默认原生 CLI

同一台 Apple M4 Pro 上比较 Rust 1.93.0 release 的 `--no-default-features` 与默认 `search-simd` 构建，均直接调用共享搜索源码。每次启动新 CLI 进程，计入真实目录扫描、磁盘读取、原生文本提取、搜索与 JSON 输出，操作系统缓存已预热，OCR 关闭。预热 3 轮、测量 9 轮，前后交替；完整响应仅忽略 `search.scan.discoveryMs`。每轮确认 `ranking=native-rust`、`sharedTextModules=0`。

| 用例 | scalar | NEON | 耗时变化 |
| --- | ---: | ---: | ---: |
| 32 个英文文件 | 7.380 ms | 7.569 ms | +2.6% |
| 1,000 个英文文件 | 30.289 ms | 29.643 ms | −2.1% |
| 32 文件、128 种正文词 | 124.109 ms | 106.277 ms | −14.4% |
| 64 个中文文件 | 104.579 ms | 105.401 ms | +0.8% |

词汇较多的正文完整 CLI 操作加速 **1.17 倍，耗时减少约 14%**；32 文件与中文用例仍有小幅回退。原生 scalar 列表示关闭手写 `search-simd` 快路径，标准库仍可使用目标的默认指令。该测量含进程与 I/O 成本，不能与上表 WASM 操作的绝对时间直接比较。SSE2 已通过交叉编译检查，未在 x86-64 硬件上实测。

## 内存与体积

109 组生产对照中，操作后的 WASM `memory.buffer.byteLength` 全部保持一致。它记录只增长的线性内存高水位，不代表存活堆、物理驻留内存或进程 RSS；本轮没有测得总内存下降。SIMD 规范化仍分配原有结果字符串，遇到较晚的 Unicode 字节会释放未完成的临时缓冲并回退。

| 生产 converter-text.wasm | scalar | SIMD128 | 变化（字节） |
| --- | ---: | ---: | ---: |
| 原始字节 | 8,524,007 | 8,405,267 | −118,740 |
| gzip，级别 9 | 3,186,221 | 3,147,180 | −39,041 |
| Brotli，质量 11 | 2,301,765 | 2,273,547 | −28,218 |

原生 CLI 未压缩二进制由 2,339,600 增至 2,356,128 字节，增加 16,528 字节。同时托管两份 WASM 会增加发布资源总量；前端只请求被选中的版本，SIMD 资产失败时才请求 scalar。

## 验证

- scalar 共享源码的 21 项测试、NEON 功能开启后的 24 项测试通过。新增逐项对照覆盖全部 128 个 ASCII 字节、向量长度与尾部、未对齐切片、跨向量长词、Unicode 回退和词发射顺序。
- 109 组 scalar/SIMD 生产 WASM 完整响应对照通过，其中新增 48 组 ASCII 边界语料，每组返回全部 64 文件，避免差异隐藏在返回上限之外；另含 Unicode 前缀回退和跨向量单词。评分与来源字段严格一致。
- 24 组既有精确搜索与 Office 媒体对照、5 组 OCR 对照通过；仅忽略 `metrics.elapsedMs`。
- 6 组真实生产模块经公开前端 runner 的完整响应对照通过，SIMD 加载一次、scalar 未被加载；确认产物含真实 SIMD 扫描指令。加上上述 109+24+5 组，共 **144 组生产 WASM 完整响应对照**。
- 4 组完整原生 CLI 响应在每轮测量中保持一致；旧第八轮与新 scalar 的 59 组响应对照也通过。
- 90 项相关前端测试通过，覆盖 SIMD 选择、真实指令执行、能力不足、下载/编译失败回退、执行失败不重试，以及现有转换、密码、WASI I/O 和生命周期。补齐测试夹具类型声明后，converter-client TypeScript 检查通过。
- 转换架构边界检查 2,122 项通过。

## 使用与复跑

```sh
npm run build:search:wasm
# 自定义输出位置或仅构建一个版本：
node scripts/build-search-wasm.mjs --output public/wasm --variant both
```

构建器固定现有 Rust 工具链与隐私环境，Rust 编译时不设置全局 `+simd128`，SIMD 内核通过函数属性启用。使用 `wasm32-wasip1` release、`text-extraction,postscript`；SIMD 版本额外启用 `search-simd`。Binaryen 参数保持 `-Oz --strip-debug --strip-producers --enable-bulk-memory --enable-nontrapping-float-to-int`，SIMD 版本增加 `--enable-simd`。

生成的 `search-wasm-build.json` 记录两个产物的功能、哈希和实际 Cargo 依赖路径。34 项输入为 scalar/SIMD 实际源文件、内嵌数据与 Cargo 配置的并集；两者源码完全相同，编译功能不同。编译前后校验输入哈希。新 scalar 因辅助函数重构而与第八轮哈希不同，已另行完整对照。CLI 保留并行工作的 Windows 平台依赖配置，锁文件仅补齐其已有 `windows-sys` 引用。

前端示例：

```ts
import { createWasmCoreRunner } from '@filens/converter-client';

const run = createWasmCoreRunner({
  wasm: '/wasm/converter-text.wasm',
  simdWasm: '/wasm/converter-text-simd.wasm',
  imports: {
    filens_text: {
      host_call: () => { throw new Error('search-text does not request extraction capabilities'); }
    }
  }
});
const corpus = {
  query: 'budget approval', mode: 'bm25', limit: 10, format: 'json',
  files: [{ path: 'report.txt', text: 'Budget approval is pending.', sha256: '', complete: true }]
};
const result = await run({
  args: ['converter-text', '--operation', 'search-text',
    '--input', '/work/corpus.json', '--output', '/work/output',
    '--source', 'json', '--target', 'text', '--result', '/work/result.json'],
  files: { '/work/corpus.json': new TextEncoder().encode(JSON.stringify(corpus)) },
  readFiles: ['/work/result.json']
});
const wire = JSON.parse(new TextDecoder().decode(result.files['/work/result.json']));
```

`search-text` 使用完整提取文本语料，不请求文件提取能力。转换与提取的能力宿主配置仍按各自接口提供。文本 WASM 资源需由应用构建并托管；此配置不会向默认预览入口添加文本模块。

```sh
node --no-warnings scripts/benchmark-batch-matching-round9.mjs \
  --baseline wasm/converter-core/dist/converter-text.wasm \
  --wasm wasm/converter-core/dist/converter-text-simd.wasm \
  --source-baseline benchmarks/frontend/2026-11-04/batch-matching-round9-source-baseline.json.gz \
  --output tmp/batch-matching-round9/replay.json

node scripts/test-search-simd.mjs
node --no-warnings scripts/benchmark-batch-matching-round9-small.mjs \
  --baseline wasm/converter-core/dist/converter-text.wasm \
  --wasm wasm/converter-core/dist/converter-text-simd.wasm
```

主测量脚本添加 `--checks-only` 可跳过计时和压缩。小语料脚本默认对照本轮已发布数据中的产物与输入哈希；重建产物有变化时，用 `--reference` 指向新主测量报告。原生复跑先分别构建 `cargo +1.93.0 build --locked --release --manifest-path cli/Cargo.toml --no-default-features` 与默认版本，各自保存可执行文件，再运行 `scripts/benchmark-search-simd-native.mjs --baseline <scalar可执行文件> --binary <SIMD可执行文件>`。

记录：

- [生产 WASM 逐次计时、输入与输出哈希、内存与体积](../benchmarks/frontend/2026-11-04/batch-matching-round9.json)
- [51 轮小语料追加采样](../benchmarks/frontend/2026-11-04/batch-matching-round9-small.json)
- [完整原生 CLI 测量](../benchmarks/frontend/2026-11-04/batch-matching-round9-native.json)
- [公开前端接口与 SIMD 指令审计](../benchmarks/frontend/2026-11-04/batch-matching-round9-integration.json)
- [34 项共享构建输入归档](../benchmarks/frontend/2026-11-04/batch-matching-round9-source-baseline.json.gz)，JSON 的 `files` 字段可在独立 checkout 恢复
- [第八轮至新 scalar 的完整响应对照](../benchmarks/frontend/2026-11-04/batch-matching-round9-scalar-control.json)
