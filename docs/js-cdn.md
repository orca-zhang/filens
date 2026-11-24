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
