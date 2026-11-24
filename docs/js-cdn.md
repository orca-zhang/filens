# JavaScript CDN

FiLens 的发布版预览引擎通过官网静态 CDN 提供，不经过转换服务器或第三方 CDN 代理。

```html
<div id="preview" style="height: 80vh"></div>
<script type="module">
  import { createPreview } from 'https://filens.cc/cdn/filens-preview@0.3.7/all-in-one/filens.js';
  createPreview('#preview', { src: new File(['Hello FiLens'], 'hello.txt') });
</script>
```

| 入口 | 用途 |
| --- | --- |
| `https://filens.cc/cdn/filens.js` | 当前版本单文件版的 ESM 转导出入口，缓存 5 分钟 |
| `https://filens.cc/cdn/filens-preview@0.3.7/all-in-one/filens.js` | 固定版本单文件版，适合跨域嵌入 |
| `https://filens.cc/cdn/filens-preview@0.3.7/split/filens.js` | 固定版本按需加载版，首次加载更小 |

使用 `type="module"` 或动态 `import()`；这些入口不创建全局变量。生产集成推荐固定版本地址，浏览器可缓存一年。所有 CDN 文件允许跨域读取，并提供 `Timing-Allow-Origin` 以便浏览器测量加载耗时。引擎、WASM、Worker 和许可证均从 SHA-256 校验后的已发布 ZIP 原样提取，与 jsDelivr 的同版本 npm 文件对比。

跨域文件来源仍需允许 CORS。发布版 split 的 iWork Worker 和两种构建的 RAR/7z Worker 要求页面与引擎同源；跨域嵌入这些格式时，可使用官网同源预览页或将完整运行目录部署到应用同源地址。单文件版的普通文档不受这一 Worker 限制。

CDN 随 `npm run build:vercel` 发布。版本来自 `docs/preview-release-sizes.json` 的 `components.preview`；升级时需保留仍在使用的旧版 CDN 文件及其发布清单，避免固定版本链接失效。

性能对比：

```sh
node scripts/benchmark-js-cdn.mjs
```

测试交替请求 filens.cc 与 jsDelivr 的相同版本、相同内容：split 入口、单文件入口和归档 WASM。每项先记录首次请求，再各测 7 次；每次建立新连接，允许 CDN 缓存，启用 HTTP/2 和压缩，不使用浏览器本地缓存。报告保留状态、内容哈希、传输字节、首字节耗时、总耗时、缓存与节点响应头。首次请求的边缘缓存状态以响应头为准，不将它等同于全球冷缓存。结果只代表执行机器当时的网络路径。

## 分发优化

单文件版的标准 `filens.js` 地址按 `Accept-Encoding` 分发发布包自带的 `.br` / `.gz` 文件，解压后的 JS 与 npm 发布版一致。响应提供正确的 JavaScript 类型、`Content-Encoding` 和 `Vary: Accept-Encoding`。不带编码质量参数或明确 `q=1` 时走预压缩文件；其他质量权重及 Range 请求交由平台处理，避免发送客户端禁用的编码。

发布包的 Brotli 为 **3,401,548 bytes**，gzip 为 **3,540,936 bytes**。优化前动态 Brotli 实测 **3,594,725 bytes**，gzip **3,603,891 bytes**；分别减少约 **5.4% / 1.7%**。

生产集成直接使用上面的固定版本 URL，可省去便捷入口的转导出模块请求。需要在用户操作后打开预览的应用，可提前建立连接：

```html
<link rel="preconnect" href="https://filens.cc" crossorigin>
```

`.github/workflows/warm-js-cdn.yml` 在主分支 Vercel 部署成功后预热 JS、分块、Worker 与 WASM，也支持在主分支手动运行。脚本以 4 个并发请求读取完整响应，并核对解压后大小，不需要部署密钥或安装 npm 依赖。本地可执行：

```sh
node scripts/warm-js-cdn.mjs
```

预热只覆盖执行节点所访问的 CDN 边缘，不保证全球节点驻留。按需版继续使用独立入口；现有跨域 Worker 限制见上文。

Vercel 动态压缩对仅含 `br;q=0` 等禁用编码的请求会继续选择 Brotli。`vercel.json` 和项目路由 `CDN disabled encoding fallback` 对这类允许 identity 的请求显式使用 identity，防止平台再次压缩。该项目路由已单独发布，适用于当前部署及后续部署。
