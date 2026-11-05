# 格式识别评测文件集合

当前清单包含 794 个文件、749 份不同内容、452 种后缀。样本只用于测试，不参与生产打包，也不执行其中的程序或脚本。

| 来源 | 数量 | 标签依据 |
| --- | ---: | --- |
| 原有基线 | 513 | 既有转换清单/文件后缀，保留原始 SHA-256 |
| 仓库其他测试目录 | 135 | 测试文件后缀 |
| 外部 file-type 测试文件 | 146 | 固定提交中的测试文件后缀 |

[manifest.json](manifest.json) 记录完整路径、标签、来源分组、大小和 SHA-256。外部文件来自 [sindresorhus/file-type](https://github.com/sindresorhus/file-type/tree/deb45066a4c6aa7d956011c4b59aad53e426ddac/fixture)，固定提交 `deb45066a4c6aa7d956011c4b59aad53e426ddac`；仅获取样本，没有复制其识别实现。上游项目的 MIT 许可保留于 [file-type/LICENSE](file-type/LICENSE)，逐文件来源见 [upstream.json](upstream.json)。仓库内已有文件沿用各自来源说明。

外部筛选规则为 `fixture/fixture.*` 下不超过 128 KiB 的普通文件，排除名称中明确含 invalid/corrupt/truncated/malformed/wrong 的文件。这个筛选无法保证文件完整：上游有少量只提供头部的容器样本，缺少足够结构时识别器应保留歧义。仓库补充样本排除源代码、原始像素和说明/许可文件。

这些后缀标签没有经过独立内容审计；同内容不同后缀和同格式族别名也存在。评测分开报告精确标签、格式族、外层容器、未确定和冲突，同一规则同时应用于旧版和新版。PNM 是 PBM/PGM/PPM 的集合，`.sh` 可能使用明确的 Bash/Zsh 解释器，这些仅算格式族匹配。ZIP 分卷 `.zNN` 只算容器证据。同属 ZIP 的明确不同子格式不会因容器相同而算正确。

完整逐文件结果见 [expanded/report.json](../expanded/report.json)。随机二进制负例和误导性短文本另列，不混入文件标签匹配率。这个集合参与规则开发，不能作为独立留出集或真实世界准确率；零随机负例命中也不能推断真实误判率。

从仓库根目录复现：

```sh
python3 scripts/prepare-format-detection-corpus.py --fetch-upstream
node scripts/evaluate-expanded-detection.mjs
```

已有外部样本时，省略 `--fetch-upstream` 可离线重建清单。准备脚本会校验原始与上游样本哈希；评测脚本还会校验冻结的旧版 WASM 哈希，并要求两个扩展版均保留旧版的精确匹配结果。
