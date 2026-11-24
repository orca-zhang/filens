# AI 启发的无损压缩实验

同一份 `filens-preview@0.3.7` 单文件 JS，SHA-256 为 `fe841d1d8a8284fe322c226be507206afa2a23ecc65e7b67db44b58a64f6a0ad`。其中 52 个静态资源还原后共 11,616,955 bytes。应用逻辑保持原有 ESM，实验只替换静态资源压缩表示与解码器；没有 JavaScript 求值器。

| 方案 | 完整 JS 的 Brotli MB | Node 资源还原中位数 | 本地 Chromium 导入中位数 |
| --- | ---: | ---: | ---: |
| 发布版：共享 LZMA 字典 | 3.401548 | 279 ms | 280 ms |
| 字节特征聚类、相邻资源重排、LZMA 参数搜索 | 3.387847 | 276 ms | 277 ms |
| 学习型字节预测、量化模型、算术编码 | 7.694711 | 1,330 ms | 873 ms |

体积统计包含完整应用代码、压缩资源、模型、解码器和 Base64 开销，MB = 1,000,000 bytes。两种初始化指标运行环境不同：Node 只测解码、校验及资源还原；Chromium 包含本地 HTTP 传输、Brotli 解压、JS 解析和模块初始化，均各测 3 次。不包含公网延迟。

结构搜索共比较 7 个组合。最佳整体减少 **13,701 bytes（0.40%）**；单独调整 LZMA 参数已经省下 12,307 bytes，聚类重排额外贡献 **1,394 bytes**。收益不足以支持更换当前线上打包方式。

学习型模型为实际训练的 `256×256` softmax 字节上下文预测器，只看前一个字节，使用 120 步 Adam 训练。部署时将浮点权重编译为 131,584-byte CDF 表，不携带 PyTorch；模型表和纯 JS 算术解码器都计入最终体积。这个轻量模型捕捉不到长距离重复，结果比现有字典编码大约 **126%**，资源还原慢约 **4.8 倍**。结果只说明这个原型的适用性，不代表所有学习型压缩算法。

三组方案的 52 个资源都逐字节还原核对；Chromium 验证了文本预览和 STEP 立方体的 12 个三角形。没有验证所有支持格式，实验代码不参与线上 CDN 构建。

需要项目 Node 依赖、Playwright Chromium，以及带 NumPy / PyTorch 的 Python。仓库根目录复现：

```sh
mkdir -p dist/ai-compression
npm pack filens-preview@0.3.7 --ignore-scripts --pack-destination dist/ai-compression
tar -xzf dist/ai-compression/filens-preview-0.3.7.tgz -C dist/ai-compression
node benchmarks/ai-compression/extract.mjs dist/ai-compression/package/dist/all-in-one/filens.js
node --test benchmarks/ai-compression/codec.test.mjs
python3 benchmarks/ai-compression/prepare.py
node benchmarks/ai-compression/bench.mjs
node benchmarks/ai-compression/measure-readers.mjs
```

原始结果见 [ai-compression-benchmark.json](../../docs/ai-compression-benchmark.json)。大型实验产物写入忽略的 `dist/ai-compression/`，不提交二进制文件。
