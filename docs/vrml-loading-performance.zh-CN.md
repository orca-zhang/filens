# WRL/VRML 引擎按需加载

2026-11-04，本轮减少分包版的首屏下载量，没有新增运行时依赖。

WRL/VRML 预览使用的 Three.js VRMLLoader 和 Chevrotain 语法解析器此前会随入口加载。现在预览会话在打开 WRL/VRML 时才导入它们，加载期间沿用已有取消机制。现有同步 `loadVrmlObject()`、`loadVrmlObjectWithWarnings()` 导出保留。

VRML 加载代码及通用资源处理函数从大的预览驱动文件拆出，12 个函数或接口块与基线逐字核对一致，没有改写解析和纹理处理算法。应用构建的分包规则将 VRML 包装层、加载器和语法库统一放入 `model-vrml`，避免它们再次被合并到首屏 vendor 包。

## 实测体积

修改前重新构建并保存预览基线，修改后用相同命令构建。在 Chromium 中实际导入独立分包入口，统计所有静态 JS 请求，逐文件压缩后求和。gzip 使用级别 9，Brotli 使用默认质量 11。首屏不包含按需引擎、Worker、独立 WASM 和 CSS。

| 分包版首屏静态 JS | 修改前（字节） | 修改后（字节） | 减少（字节） |
| --- | ---: | ---: | ---: |
| 原始大小 | 2,182,891 | 1,998,316 | 184,575 |
| gzip | 611,990 | 565,145 | **46,845** |
| Brotli | 518,181 | 478,903 | 39,278 |

首屏 gzip 减少约 **7.7%**。普通文本和 STL 预览不请求 VRML 分包；第一次打开 WRL/VRML 时增加一次按需请求，后续在同一页面复用。

包含所有按需模块和 Worker 的分包版 JS/MJS gzip 合计为 1,485,357 → 1,486,354 字节，增加 997 字节。单文件版主 JS gzip 为 5,530,122 → 5,530,856 字节，增加 734 字节，四段内联压缩 WASM 字节完全一致。完整压缩体积基本持平，本轮收益来自首屏传输减少；单文件版仍包含全部引擎。

以上描述针对 demo 和独立预览的生产应用构建。完整 `@filens/model3d` 库继续提供同步加载函数，不能将本次首屏差额理解为该库所有使用方式都会减少相同下载量。未测量首屏时间或峰值内存。

[首屏实际请求、全部文件哈希及完整大小](../benchmarks/frontend/2026-11-04/vrml-loading-startup.json)；[源码和相同内联 WASM 的绑定](../benchmarks/frontend/2026-11-04/vrml-loading-bindings.json)。同期工作区还有其他功能，因此只比较本轮开始时保存的基线，不叠加跨轮次的历史引擎体积变化。

## 验证

326 项 3D 单元测试通过，覆盖同步 VRML API、纹理解析与警告、资源所有权、取消、生命周期及其他模型格式。16 项浏览器回归通过，覆盖 GLB/USDZ 按需加载、取消后复用、非协作输入、纹理资源释放、STEP 初始化及 STL/GLB/STEP/3MF 几何和像素一致性。

新增生产产物检查实际打开新旧两种构建的 `.wrl`、`.vrml` 文件，包含平移、Box、IndexedFaceSet 和两种材质。所有场景均得到 13 个三角形及相同的 800×562 完整 RGBA 像素哈希，确认实际 WebGL 几何可见。当前分包版还验证：

- 文本和 STL 阶段没有 VRML 引擎请求。
- 引擎请求未返回时切换到文本不会等待原请求；随后重新打开模型正常。
- WRL 和 VRML 共用一次引擎下载，销毁后宿主清空，没有页面或预览错误。

两种当前产物也复跑了四组 XML 按需加载检查，全部通过。[完整生产产物像素与加载记录](../benchmarks/frontend/2026-11-04/vrml-loading-production-smoke.json)。

model3d 声明构建及 demo、分包版、单文件版生产构建通过。转换策略、分类包边界、本轮脚本语法及空白检查通过。

## 复跑

```sh
npm run build:model3d
FILENS_PREVIEW_BUILD=split npm exec --workspace filens-preview -- vite build
FILENS_PREVIEW_BUILD=all-in-one npm exec --workspace filens-preview -- vite build
npm run build:demo
node scripts/test-vrml-loading.mjs
node scripts/test-xml-loading.mjs
node scripts/report-preview-startup.mjs

# 可选：与修改前保存的预览 dist 比较，目录中应包含 split/ 和 all-in-one/
node scripts/test-vrml-loading.mjs --baseline tmp/vrml-loading-baseline/preview-dist
node scripts/report-preview-startup.mjs --baseline tmp/vrml-loading-baseline/preview-dist
```

基线应在修改源码前构建并保存；比较单文件体积时，需要固定同一组引擎资源。
