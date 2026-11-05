# EPUB、思维导图、Visio 与 3D 资源准备优化

2026-11-04，在[共享读取链路优化](shared-readers-performance.zh-CN.md)后，将范围扩展到四个格式包。没有新增依赖；64 项主入口运行时导出与格式路由保持一致，后端转换边界不变。

后续扩展：[PDF 可见页、共享字体与 15 包发布体积优化](viewport-fonts-packaging-performance.zh-CN.md)。

## 实现

- EPUB CSS 扫描只在遇到 `@`、`u` 或 `U` 时检查 import/URL 语法，避免在每个字符上切片并执行正则。保留注释、字符串、转义、token 边界、import 限定条件和解析器调用顺序。
- MindManager 读取遇到第一个 topic 即确定根节点；查找直属子 topic 时按文档顺序遍历包装元素，在子 topic 处停止深入。后代归属、大小写/命名空间处理与默认 ID 不变，避免为每层包装反复收集整棵后代树。
- Visio 提前跳过不会生成可见项的 `Group`/`Foreign` 容器，不再读取这些容器的全部后代属性与标签；子形状仍从页面的完整形状列表解析。
- EPUB 不透明 iframe 资源和 3D 二进制纹理优先使用原生 `Uint8Array.toBase64()`；Node 使用 Buffer 视图，浏览器兼容路径以 32 KiB 分块、通过 `Reflect.apply` 转换。EPUB 外部二进制资源复用同一包内的编码器。
- 普通 EPUB 资源直接将精确字节视图交给 Blob 快照，省去一次完整复制；SharedArrayBuffer 保留复制路径。MIME、URL、片段、警告和释放行为不变。

## 完整解析与 CSS

Apple M4 Pro / Node.js v20.20.2 / Chromium 147.0.7727.15。新旧实现交替运行，预热 2 轮、测量 7 轮，表中为中位数。每轮核对完整模型、CSS 输出及资源解析调用顺序；EPUB 也核对生成 Blob 的 MIME、长度和完整字节哈希。

| 用例 | 修改前 | 修改后 |
| --- | ---: | ---: |
| MindManager，2,001 个 topic，普通结构 | 4.60 ms | **3.60 ms** |
| 同上，直属子 topic 外有 160 层包装 | 26.80 ms | **3.40 ms** |
| Visio，2,000 个形状，普通结构 | 8.30 ms | 8.80 ms |
| 同上，100 层 Group 容器 | 81.10 ms | **8.70 ms** |
| 扫描 830,000 字节无 URL 的 CSS | 22.00 ms | **1.90 ms** |
| 扫描含 2,000 个真实 URL、字符串与注释的 CSS | 2.20 ms | **1.00 ms** |
| 完整 EPUB，既有样式夹具追加上述大 CSS | 26.20 ms | **6.00 ms** |

MindManager 包含 ZIP 打开、解压、XML 解析和完整节点树生成；Visio 包含 XML 解析和完整图表模型生成。EPUB 包含 ZIP 到书籍模型及资源 Blob 的准备。三类解析使用生产 ESM 入口；单独 CSS 和资源编码使用同一 esbuild 配置构建内部入口。

深包装/分组样例约快 7.9/9.3 倍，目的是验证重复后代扫描的消除。普通 Visio 在本轮略慢，保留了这一对照；这些生成样例不表示所有文档都有相同收益。

## 二进制资源准备

每轮处理 4 个 1 MiB 的二进制切片，均有非零偏移。逐个解码生成的 data URL，并与原始切片核对完整 SHA-256。Blob 工厂捕获资源供计时外读取验证。

| 用例 | 修改前 | 修改后 |
| --- | ---: | ---: |
| 3D 纹理 data URL，原生 Base64 可用 | 36.80 ms | **0.30 ms** |
| 同上，关闭原生接口的兼容路径 | 36.40 ms | **10.10 ms** |
| EPUB 不透明 iframe data URL，原生接口可用 | 54.20 ms | **0.20 ms** |
| 同上，关闭原生接口的兼容路径 | 54.40 ms | **9.60 ms** |
| 普通 EPUB Blob 准备 | 1.00 ms | 0.90 ms |

兼容路径是在当前 Chromium 中关闭原生 API 的对照，不能当作旧浏览器实测。不透明主机条件在基准中模拟，另有真实 opaque sandbox 浏览器回归。这些时间仅覆盖资源准备，不含 3D 几何解析、图像解码、GPU 上传、渲染和物理显示延迟；0.2–0.3 ms 数据也受计时分辨率影响。

第一版分块实现使用展开语法，纹理兼容路径曾变慢，改用 `Reflect.apply` 后重新测量。早期采样保留在本地 `tmp/document-resources-current/results.json`，上述表格与归档使用最终实现的数据。

## 体积与验证

四个包全部 JS/MJS 逐文件压缩后求和，包含已有动态分包，不含依赖、CSS、WASM 和源码映射；压缩使用同一 Node 的 gzip 9 / 默认 Brotli。

| 运行时 JS/MJS 合计 | 修改前 | 修改后 | 变化 |
| --- | ---: | ---: | ---: |
| 原始字节 | 253,519 | 253,977 | +458 |
| gzip 9 | 67,342 | 67,466 | **+124** |
| Brotli | 58,344 | 58,450 | +106 |

本轮用少量代码换取解析与编码速度；此前 core/archive/XLSX 的发布映射裁剪设置继续保留。没有由此推算完整网页或 npm 依赖树体积，也未测量峰值内存。

- 四个格式包 **438 项单元测试通过**：books 37、mindmap 26、diagram 32、model3d 343。新增覆盖 CSS token 边界、包装节点归属与默认 ID、分组子形状、Base64 空输入/切片/分块边界/三条编码路径、Unicode CSS，以及普通/共享缓冲区的 Blob 快照。
- **18 项浏览器回归通过，1 项真实 VSDX 外部样本测试跳过**。覆盖 EPUB 不透明沙箱内的图片/CSS/字体、MM/OPML/XMind/MindManager、VDX/VSDX、STL/GLB、带纹理 glTF 的完整像素对照、资源释放和取消。
- 一项旧上传测试最初因宽泛选择器同时匹配两个文件输入而失败，限定到主上传控件后单独重跑通过；其余 17 项成功结果保留。
- 四包声明构建、主入口导出/路由比较、2,122 项转换策略及分类包边界检查通过。

[全部最终采样、源码/产物哈希与验证结果](../benchmarks/frontend/2026-11-04/document-resources.json)；[修改前六份源码](../benchmarks/frontend/2026-11-04/document-resources-source-baseline.json.gz)。基线为包含此前未提交修改的工作区构建，并非 Git HEAD。

## 复跑

在修改前保存四包 dist；基准还需 `sources.json` 以构建原版内部入口。新环境应在独立 checkout 中恢复源码归档后构建，避免覆盖当前工作。

```sh
# 修改前保存；已有同名目录时使用新路径
npm run build --workspace @filens/books --workspace @filens/mindmap --workspace @filens/diagram --workspace @filens/model3d
mkdir -p tmp/document-resources-baseline
cp -R packages/ebook/dist tmp/document-resources-baseline/ebook-dist
cp -R packages/mindmap/dist tmp/document-resources-baseline/mindmap-dist
cp -R packages/diagram/dist tmp/document-resources-baseline/diagram-dist
cp -R packages/model3d/dist tmp/document-resources-baseline/model3d-dist
gzip -dc benchmarks/frontend/2026-11-04/document-resources-source-baseline.json.gz > tmp/document-resources-baseline/sources.json

# 应用修改后，测量期间不要并行运行构建或测试
npm run build --workspace @filens/books --workspace @filens/mindmap --workspace @filens/diagram --workspace @filens/model3d
node scripts/benchmark-document-resources.mjs
npm run test --workspace @filens/books --workspace @filens/mindmap --workspace @filens/diagram --workspace @filens/model3d -- --maxWorkers=4 --minWorkers=1
npx playwright test apps/demo/e2e/ebook-sandbox.e2e.ts apps/demo/e2e/ebook-lifecycle.e2e.ts apps/demo/e2e/mindmap-lifecycle.e2e.ts apps/demo/e2e/diagram-preview.e2e.ts apps/demo/e2e/model3d-resources.e2e.ts apps/demo/e2e/model3d-lifecycle.e2e.ts --workers=1
```
