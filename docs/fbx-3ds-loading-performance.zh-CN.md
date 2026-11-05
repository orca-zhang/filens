# FBX、3DS 按需加载与重复代码裁剪

2026-11-04，本轮让普通预览少下载 FBX、3DS 解析代码，并合并模型资源和加载收尾逻辑，没有新增运行时依赖。

## 改动

- FBX、3DS 的同步加载函数独立成模块，预览会话打开对应格式时才导入。应用分包规则将 FBXLoader、NURBS 辅助代码和 TDSLoader 放进对应的可选分包。
- LWO、Collada、FBX、3DS、VRML 的五份相同贴图查找实现合并为一份，保留查找顺序、重复候选路径、同步解析约定、警告和 URL 清理行为。
- 19 处相同的对象场景创建、元数据、相机状态及事件通知合并为一个方法。STEP 的特殊警告行为以及 OBJ、几何体分支各自的处理顺序保留。

现有同步加载 API 保留。收益针对 demo 和独立预览的生产应用构建；完整 `@filens/model3d` 库仍提供同步函数，不能据此推断所有消费方式都会延迟加载。首次打开 FBX、3DS 各增加一次引擎请求，同一页面再次打开复用模块。

## 实测体积

修改前重新构建并保存基线；修改后使用相同命令。首屏统计来自 Chromium 实际导入独立分包入口的静态 JS 请求，逐文件压缩后求和。gzip 使用级别 9，Brotli 使用默认质量 11。

| 首屏静态 JS | 修改前（字节） | 修改后（字节） | 减少（字节） |
| --- | ---: | ---: | ---: |
| 原始大小 | 2,001,042 | 1,942,581 | 58,461 |
| gzip | 566,070 | 550,462 | **15,608** |
| Brotli | 479,822 | 467,162 | 12,660 |

首屏 gzip 减少 **2.76%**，不包含按需引擎、Worker 和独立 WASM。普通文本、STL 预览不会请求 FBX、3DS、VRML 分包。

| 完整产物口径 | 修改前（字节） | 修改后（字节） | 变化 |
| --- | ---: | ---: | ---: |
| 分包版全部 JS/MJS 原始大小，含 Worker | 5,422,179 | 5,416,225 | 减少 5,954 |
| 分包版全部 JS/MJS gzip | 1,487,278 | 1,488,455 | 增加 1,177（0.08%） |
| 分包版全部 JS/MJS Brotli | 1,251,426 | 1,253,806 | 增加 2,380 |
| 单文件版主 JS 原始大小 | 10,973,342 | 10,967,237 | 减少 6,105 |
| 单文件版主 JS gzip | 5,531,818 | 5,531,696 | 减少 122 |
| 单文件版主 JS Brotli | 5,215,192 | 5,214,193 | 减少 999 |

本轮的主要收益是首屏传输量和重复源码减少。完整压缩体积基本持平，不能将首屏差额算成完整安装包的缩减。单文件版四段内联压缩 WASM 与基线逐字节一致。没有测量首屏耗时或峰值内存。

[实际请求、文件哈希和体积记录](../benchmarks/frontend/2026-11-04/fbx-3ds-loading-startup.json)。同期工作区存在其他修改，本表仅比较本轮开始前保存的基线。

## 验证

- 336 项 3D 单元测试通过，含新增贴图候选顺序、格式和警告兼容、字节视图边界、Blob URL、异步结果及取消检查。
- 16 项浏览器回归通过，覆盖取消、资源释放、GLB/USDZ 加载、STEP 初始化以及 STL/GLB/STEP/3MF 几何和渲染一致性。
- 新旧分包版、单文件版各检查 FBX、3DS、VRML，共 12 组生产产物对照。FBX、3DS 均使用有效四面体和材质；VRML 包含平移、Box、IndexedFaceSet 和两种材质。所有模型三角形数量及完整 800×562 RGBA 像素哈希与基线一致。
- 当前分包版验证三个引擎均不在文本/STL 阶段加载；拦截引擎下载时可切换文本，释放请求后重新打开正常，每种引擎仅请求一次，销毁后宿主清空，无页面和预览错误。
- 四组 XML 生产加载检查通过。model3d 声明、demo、独立分包版和单文件版构建通过；转换策略与分类包边界检查通过。

[生产产物模型与像素记录](../benchmarks/frontend/2026-11-04/fbx-3ds-loading-production-smoke.json)；[源码提取一致性、19 处收尾替换和相同 WASM 的绑定](../benchmarks/frontend/2026-11-04/fbx-3ds-loading-bindings.json)；[XML 回归记录](../benchmarks/frontend/2026-11-04/fbx-3ds-loading-xml-smoke.json)。

## 复跑

```sh
npm run build:model3d
FILENS_PREVIEW_BUILD=split npm exec --workspace filens-preview -- vite build
FILENS_PREVIEW_BUILD=all-in-one npm exec --workspace filens-preview -- vite build
npm run build:demo
node scripts/test-model-loader-loading.mjs
node scripts/test-xml-loading.mjs
node scripts/report-preview-startup.mjs
npx playwright test apps/demo/e2e/model3d-cancel.e2e.ts --workers=1

# 运行 3D 单元测试
(cd packages/model3d && npx vitest run)

# 可选：对比修改前保存的 dist（包含 split/、all-in-one/）
node scripts/test-model-loader-loading.mjs --baseline tmp/fbx-3ds-loading-baseline/preview-dist
node scripts/report-preview-startup.mjs --baseline tmp/fbx-3ds-loading-baseline/preview-dist
```

`scripts/test-vrml-loading.mjs` 保留为兼容入口，调用包含三个格式的生产检查。
