# Deploy to Vercel / 部署到 Vercel

## 中文

1. 将代码推送到 GitHub，在 Vercel 中选择 **Add New → Project** 并导入仓库。
2. **Root Directory 保持仓库根目录**，不要改成 `apps/demo`。
3. 点击 **Deploy**。仓库的 `vercel.json` 已配置安装命令、构建命令和输出目录，无需设置环境变量。绑定 GitHub 后，推送代码会自动部署，PR 会生成预览地址，不需要额外 workflow。

部署后的 `/` 是产品首页；`/?lang=zh` 和 `/?lang=en` 可分别分享中文和英文版本。`/?view=preview` 打开预览工作台。将 Vercel 分配的正式域名填入 GitHub 仓库的 **About → Website** 即可。

直接传入文件地址即可跳转预览，无需先打开工作台：

```text
https://filens-six.vercel.app/?url=https%3A%2F%2Fexample.com%2Freport.pdf
```

使用 `encodeURIComponent(fileUrl)` 编码完整文件地址，保留原地址中的查询参数和签名。`url` 支持 HTTP(S) 地址或相对于当前站点的文件路径；下载地址不含扩展名时，可添加 `&name=report.pdf` 指定文件名。可继续搭配 `&lang=zh` 或 `&lang=en`。例如：

```js
const previewUrl = new URL('https://filens-six.vercel.app/');
previewUrl.searchParams.set('url', fileUrl);
previewUrl.searchParams.set('name', 'report.pdf'); // 下载地址无扩展名时使用
```

第三方文件会在预览区域持续显示“资源来自第三方站点”和实际来源域名，加载失败时也会保留该提示。同源文件不显示第三方标记。本地导入或切换示例会清除链接中的远程文件参数。文件由浏览器直接请求，来源站点需允许跨域访问（CORS）；HTTPS 部署请使用 HTTPS 文件地址，避免浏览器拦截混合内容。本机磁盘路径不能通过站点链接读取，请使用导入文件功能。

构建会先用仓库锁定的 Rust 工具链生成两个 WASM 转换模块，再构建前端。首次构建需要下载工具链和依赖。文件预览和转换在浏览器内运行，不需要额外部署服务端。

首页示例、本地文件上传和演示视频可独立使用。工作台的外部音视频和全景样例通过 `/external-samples/` 代理从公开源按需读取，不需要 NAS 文件接口或登录；`vercel.json` 已包含对应路由。Google Drive 代理会移除浏览器来源和请求元数据，确保返回原始文件。原有 NAS 构建仍默认使用 `/modules/filens/`。

本地验证 Vercel 构建：

```sh
npm ci
npm run build:vercel
npm run preview --workspace @filens/demo -- --base=/ --host 127.0.0.1 --port 4175
```

在另一个终端运行首页检查：

```sh
FILENS_E2E_BASE_URL=http://127.0.0.1:4175/ npx playwright test apps/demo/e2e/landing.e2e.ts
```

## English

1. Push the code to GitHub, then select **Add New → Project** in Vercel and import the repository.
2. Keep **Root Directory at the repository root**, rather than `apps/demo`.
3. Select **Deploy**. `vercel.json` supplies the install command, build command, and output directory. No environment variables are required. Vercel's Git integration automatically deploys pushes and creates PR previews; a separate workflow is unnecessary.

The product homepage lives at `/`. Share `/?lang=zh` for Chinese or `/?lang=en` for English; `/?view=preview` opens the workbench. Add the production domain assigned by Vercel to the repository's **About → Website** field.

Pass `?url=` to open a file directly, for example `https://filens-six.vercel.app/?url=https%3A%2F%2Fexample.com%2Freport.pdf`. Encode the complete file URL with `encodeURIComponent(fileUrl)` or `URL.searchParams.set` to preserve query parameters and signatures. HTTP(S) URLs and paths relative to the site are supported. Add `&name=report.pdf` when the download URL has no extension, and optionally `&lang=zh` or `&lang=en`.

Third-party files display a persistent “This resource comes from a third-party site” notice and their source origin, including when loading fails. Same-origin files have no third-party label. Importing a local file or selecting a sample clears the remote URL parameters. Files are fetched directly by the browser, so the source must allow cross-origin access (CORS). Use HTTPS file URLs on HTTPS deployments to avoid mixed-content blocking. Local disk paths require the file import control.

The build generates both WASM converters from source using the repository's pinned Rust toolchain, then builds the frontend. The first build downloads the toolchain and dependencies. Preview and conversion run in the browser, so a separate application server is unnecessary.

Homepage examples, local uploads, and the walkthrough work independently. External workbench media and panorama samples load on demand from public sources through `/external-samples/` proxies, without a NAS file API or login. `vercel.json` includes these routes and strips browser origin and request metadata so Google Drive returns the original file. Existing NAS builds continue to default to `/modules/filens/`.

Use the commands above to validate the Vercel build locally and run the homepage checks against the production output.

## Output directory error / 找不到输出目录

如果出现 `No Output Directory named "dist" found`，先确认 Vercel 部署的分支和提交已包含根目录的 `vercel.json`、`scripts/build-vercel.mjs` 及对应的 `package.json` 改动。本地尚未提交或推送的配置不会被 Git 集成部署读取。

在 **Project Settings → Build and Deployment** 核对以下设置，然后部署包含配置的新提交：

| Setting | Value |
| --- | --- |
| Root Directory | 仓库根目录 / repository root (`.`) |
| Build Command | `npm run build:vercel` |
| Output Directory | `apps/demo/dist` |
| Install Command | `npm ci` |

输出目录相对于 Root Directory。不要将仓库根目录的默认 `dist` 当作演示站输出，也不要将 Root Directory 改为 `apps/demo` 后继续填写 `apps/demo/dist`。

For `No Output Directory named "dist" found`, verify that the deployed branch and commit include the root `vercel.json`, `scripts/build-vercel.mjs`, and matching `package.json` changes. Git deployments cannot read local uncommitted or unpushed files. Check the settings above, then deploy the new commit containing the configuration. Output Directory is relative to Root Directory; the demo emits `apps/demo/dist` from the repository root.

## Optional GitHub Actions / 可选的 GitHub Actions

只有需要从 GitHub Actions 控制正式发布时，才使用 [Deploy to Vercel](../.github/workflows/deploy-vercel.yml)。该流程仅支持 `main` 分支，采用手动触发，避免与 Vercel Git 集成重复发布。

先在 Vercel 创建或导入项目，Root Directory 保持仓库根目录。在 GitHub 仓库的 **Settings → Secrets and variables → Actions** 配置：

| Secret | 来源 / Where to find it |
| --- | --- |
| `VERCEL_TOKEN` | Vercel Account Settings → Tokens |
| `VERCEL_ORG_ID` | Vercel team/account ID; also `orgId` in the local `.vercel/project.json` after `vercel link` |
| `VERCEL_PROJECT_ID` | Vercel Project Settings → General → Project ID |

随后在 **Actions → Deploy to Vercel → Run workflow** 选择 `main`。流程会生成 WASM、构建前端并发布正式站点，完成后在运行摘要显示部署地址。密钥缺失时会在构建前明确报错。

Use this workflow only when you want to control production releases from GitHub Actions. Create/import the Vercel project first, keep its root directory at the repository root, and add the three repository secrets above. Run **Actions → Deploy to Vercel → Run workflow** on `main`. It builds the WASM modules and frontend, deploys production, and prints the deployment URL in the run summary. It is manual to avoid duplicate deployments alongside Vercel's Git integration.
