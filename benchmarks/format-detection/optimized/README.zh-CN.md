# 格式识别器浏览器接口优化

两版复用同一份 Rust 识别规则。优化版移除 CLI 参数、路径、JSON 结果序列化和完整文件系统宿主，通过轻量接口按需读取片段，并复用 WASM 实例。JSON 探测复用原解析器做流式校验，不再创建完整对象树；保留数值范围、Unicode 和嵌套检查。ZIP/XML 仍由转换核心已有解析器处理，没有另写容器解析算法。默认后缀路由未变。

| 版本 | 原 WASM gzip -9 | 优化 WASM gzip -9 | 缩减 | 精确标签匹配 |
| --- | --- | --- | --- | --- |
| signatures | 57723 B | 35270 B | 38.9% | 124/513 |
| containers | 108480 B | 86376 B | 20.4% | 165/513 |

共用 JS 宿主独立打包后为 2135 B，gzip -9 为 904 B；上表只比较 WASM，实际按需下载还要计入此宿主。

每版全部样本均与冻结的旧 WASM 输出逐字段一致，并检查带非零偏移的输入视图。识别率、歧义处理和读取预算未改变；WASM 只接收读取请求涉及的字节。原始、gzip、Brotli 字节数、产物与源码哈希见 report.json。

每版另在 Chromium 中核对 13 种格式，输出与旧版一致。宿主只提供片段读取、随机种子和 Rust 错误路径所需的少量接口，不需要完整 WASI 文件系统。

时延比较包含各自宿主与结果传输：旧版每次创建 WASI 实例并读取 JSON 结果，新版复用实例并返回字段；排除文件读取和模块编译。每个文件交替顺序测七次。它衡量接口和实例复用收益，不能当作识别算法本身或浏览器冷启动提速。完整范围和原始计时见 report.json。

准确度边界继承原报告：开发语料的标签一致率不是独立测试集准确率。优化版仍建议作为无后缀/未知后缀的可选兜底，不自动覆盖已识别后缀。

可独立使用生成的绑定和 WASM，实例创建后复用：

```js
import { createFormatDetector } from './format-detector.mjs';
const wasm = await (await fetch('./converter-detect-web-containers.wasm')).arrayBuffer();
const detector = await createFormatDetector(wasm);
const result = detector.detect(fileBytes); // Uint8Array，文件名不参与识别
```

复现：`node scripts/optimize-format-detection.mjs`。需要先有 `node scripts/evaluate-format-detection.mjs` 生成的基线报告和两个 WASM。
