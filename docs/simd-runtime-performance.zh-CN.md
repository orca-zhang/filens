# SIMD128 文本探测与按需加载

2026-11-04，将可选的 Rust/WASM SIMD 文本扫描接入可直接调用的前端包入口，并优化 ASCII 前缀后接 Unicode 的处理。解析规则仍在共享 Rust/WASM 核心，没有新增第三方依赖或后端解析算法。

## 可直接使用的入口

```ts
import { createAutoFormatDetector } from '@filens/converter-client/format-detector';

const detector = await createAutoFormatDetector();
const result = detector.detect(new Uint8Array(await file.arrayBuffer()));
```

该独立入口包含标量和 SIMD 两份外置 WASM。导入 JS 时不下载 WASM，创建实例时通过一个小模块检查 SIMD128 支持，只下载所选版本。SIMD 下载、编译或初始化失败时回退标量版；探测过程中的异常继续交给调用方。支持自定义异步加载器或预编译模块，见 [包说明](../packages/converter-client/README.md)。

包构建自动生成两种 WASM、声明和资源 URL。主转换入口不导入探测模块。用同一份当前源码和依赖，移除探测入口做控制构建，三个主转换 JS 文件的哈希与当前 dist 一致。声明中的资源 URL 使用 string 类型，避免发布类型文件引用仓库外的 WASM 路径。现有预览的后缀路由继续由调用方使用；内容探测结果是路由证据，不是完整文件有效性验证。

## 核心优化

- SIMD 使用四个 128 位向量处理 64 字节，共用一次高位检查；剩余数据继续使用 16 字节向量和标量尾部。每次加载都在输入切片内，BOM 后的非对齐地址也可处理。
- ASCII 扫描保留已验证的前缀长度和控制字符状态。遇到非 ASCII 后，只对剩余部分执行原 UTF-8 验证和 Unicode 控制字符检查，再组合出已证明有效的完整字符串，避免重新验证和遍历前缀。
- 控制字符判断必须等待 UTF-8 验证完成。因此，前缀含 NUL、末尾含非法 UTF-8 时，仍保留原有“无法识别的二进制”结果；部分文件头截断在多字节字符中间时，也沿用原来的截断规则。
- FF/CR 的允许判断合并为一次掩码比较；TAB/LF、DEL 及其他控制字符的规则保持原样。

单独展开循环没有显著改善所有样本。原有 SIMD 在文件尾部才遇到 Unicode 时，会先扫描 ASCII、再对整段执行 UTF-8 和控制字符检查；复用前缀是本轮新增的主要收益。

## 浏览器对照

Apple M4 Pro、Node.js v20.20.2、Chromium 147.0.7727.15。冻结四份独立 WASM：当前标量、原 16 字节 SIMD、仅展开 64 字节的中间版本、最终复用前缀的 SIMD；全部通过相同 JS ABI 调用。原始产物和哈希归档在下方目录。

预热三轮，四种实现轮换测量九轮，每轮批量重复，归一化到单批次/单次调用。计时包含采样、JS/WASM 输入复制、格式规则和结果解码；排除输入读取、模块编译、实例化、序列化与校验。以下保留标量、原 SIMD 和最终实现，中间版本采样见 JSON。

| 场景 | 标量 | 原 16 字节 SIMD | 最终 SIMD |
| --- | ---: | ---: | ---: |
| 794 个混合文件，完整探测批次 | 2.413 ms | 2.375 ms | 2.325 ms |
| 71 个 ASCII 文本样本 | 0.145 ms | 0.088 ms | 0.088 ms |
| 214 个含 Unicode 的文本样本 | 0.325 ms | 0.345 ms | 0.308 ms |
| 291 个未确定格式的样本 | 0.397 ms | 0.386 ms | 0.353 ms |
| 生成的 8 KiB ASCII 文本，单次探测 | 9.20 µs | 3.08 µs | 2.95 µs |
| 生成的 8 KiB 文本，末尾才出现 Unicode | 9.16 µs | 11.25 µs | 3.03 µs |
| 生成的开头即含 Unicode 的文本 | 9.52 µs | 9.55 µs | 9.57 µs |
| 生成的 NUL 前缀、非法 UTF-8 尾部 | 1.07 µs | 1.81 µs | 1.35 µs |

相对标量，最终实现的 ASCII 文本组约快 39%，全部混合文件约快 4%。尾部 Unicode 用例相对原 SIMD 约快 3.7 倍，相对标量约快 3 倍。开头即含 Unicode 的文本没有同样收益；NUL 后接非法 UTF-8 的压力用例仍比标量慢约 26%，尽管已优于原 SIMD。

这些是热运行时的完整探测调用，不能推算成整个文件预览、下载或冷启动收益。签名命中通常不经过文本 SIMD，保留该控制组的采样，不将其小幅差异归因为 SIMD。微秒级结果来自批量计时，仍受 JIT、缓存和计时精度影响；未测峰值内存。

## 体积与兼容性

| 产物 | 原始字节 | gzip -9 字节 |
| --- | ---: | ---: |
| 当前标量 WASM | 224,259 | 109,909 |
| 原 16 字节 SIMD WASM | 225,033 | 109,997 |
| 仅展开 64 字节的中间 WASM | 225,226 | 110,086 |
| 最终 SIMD WASM | 225,355 | 110,112 |
| 发布的独立探测 JS | 3,200 | 1,297 |

最终 SIMD 比当前标量增加 203 字节 gzip，比原 SIMD 增加 115 字节 gzip。包为兼容不同运行时携带两份 WASM，合计 449,614 个原始字节；正常初始化只下载其中一份，约 110 KB gzip。它们增加 npm 安装体积，未计入主转换 JS 的按需加载路径。表格不是整个 npm 包、依赖树或首次探测耗时。

反汇编确认最终模块包含 `i8x16.bitmask` 等向量指令；标量模块使用禁用 SIMD 的 Binaryen 验证通过。新旧模块的各字段结果一致，涵盖：

- 794 个仓库/外部格式样本，全部先读入固定内存缓冲区，再交给各模块；本轮输入与归档清单哈希一致。
- 55,862 个生成边界用例，覆盖所有字节值、16/48/64/128/8192 字节附近的位置、BOM、中文、emoji、多字节字符截断和控制字符后接非法 UTF-8。
- Chromium 中 794 个格式样本及 7 个压力输入的四版本结果一致；另检查支持探测、标量回退和初始化恢复。
- 从实际 npm tarball 解包，在嵌套 HTTP 路径下检查五种浏览器场景：正常 SIMD、不支持 SIMD、SIMD HTTP 失败、SIMD 文件损坏、标量 HTTP 失败。导入无下载，下载次数和路径符合预期。
- 227 项 converter-client 单测、26 项 SIMD 功能下的 Rust 单测、24 项标量功能下的 Rust 单测通过，另有 2 项既有测试跳过；打包后的导出与 TypeScript 声明可用于实际消费者。

## 复现与归档

```sh
npm run build:converter-client
node scripts/benchmark-simd-detector.mjs
node scripts/test-format-detector-package.mjs
```

单独生成 WASM 可运行 `node scripts/build-format-detector.mjs`。自定义部署目录用 `--output` 指定，生成目录包含两份 WASM、源码/产物校验清单和许可声明。构建前后会核对相关 Rust 源码哈希。

- [性能采样、输入与输出校验](../benchmarks/frontend/2026-11-04/simd-runtime/report.json)
- [当前 WASM 构建清单](../benchmarks/frontend/2026-11-04/simd-runtime/manifest.json)
- [包与运行时验证](../benchmarks/frontend/2026-11-04/simd-runtime/validation.json)
- [原实现源码快照](../benchmarks/frontend/2026-11-04/simd-runtime/baseline/sources.json.gz)
- [性能脚本](../scripts/benchmark-simd-detector.mjs)、[包验证脚本](../scripts/test-format-detector-package.mjs)

样本属于开发与回归集合，性能收益和标签一致不构成独立准确率评估。
