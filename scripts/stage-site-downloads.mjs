import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import JSZip from 'jszip';

export async function stageSiteDownloads(rootDir) {
  const manifest = JSON.parse(await readFile(path.join(rootDir, 'docs/preview-release-sizes.json'), 'utf8'));
  const previewNpm = JSON.parse(await readFile(path.join(rootDir, 'docs/preview-package-sizes.json'), 'utf8'));
  const splitNpm = JSON.parse(await readFile(path.join(rootDir, 'docs/preview-split-package-sizes.json'), 'utf8'));
  const previewValidation = JSON.parse(await readFile(path.join(rootDir, 'docs/preview-npm-validation.json'), 'utf8'));
  const splitValidation = JSON.parse(await readFile(path.join(rootDir, 'docs/preview-split-npm-validation.json'), 'utf8'));
  const previous = JSON.parse(await readFile(path.join(rootDir, 'docs/release-v0.6.7-publication.json'), 'utf8'));
  const cliVersion = manifest.components.cli ?? JSON.parse(await readFile(path.join(rootDir, 'packaging/agent-release.json'), 'utf8')).version;
  const downloads = path.join(rootDir, 'apps/demo/dist/downloads');
  await mkdir(downloads, { recursive: true });

  const skillDir = path.join(rootDir, 'skills/filens');
  const zip = new JSZip();
  for (const file of await readdir(skillDir, { recursive: true })) {
    if (file.endsWith('.md')) zip.file(`filens/${file.replaceAll(path.sep, '/')}`, await readFile(path.join(skillDir, file)));
  }
  await writeFile(path.join(downloads, 'filens-skill.zip'), await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' }));
  const release = `https://github.com/orca-zhang/filens/releases/download/${manifest.tag}`;
  const cliAssets = previous.assets.filter(asset => asset.file.startsWith(`filens-${cliVersion}-`) || asset.file.startsWith('dsh-filens-'));
  const releaseAssets = [...cliAssets, ...manifest.assets];
  const rows = releaseAssets.map(asset => {
    const optional = asset.kind === 'browser-precompressed-sidecars'
      ? ' · 可选静态托管压缩文件 / optional static-host sidecars'
      : '';
    return `<tr><td><a href="${asset.publicUrl ?? `${release}/${asset.file}`}" download>${asset.file}</a>${optional}</td><td>${(asset.bytes / 1048576).toFixed(2)} MiB</td></tr>`;
  }).join('\n');
  const npmHref = (registry, pkg) => `https://${registry}/${pkg.name}/-/${pkg.file}`;
  const npmPackageRows = [[previewNpm, previewValidation], [splitNpm, splitValidation]]
    .filter(([pkg, validation]) => validation.passed && validation.name === pkg.name && validation.version === pkg.version && validation.source.startsWith('public registry'))
    .map(([pkg]) => `<li><code>npm install ${pkg.name}@${pkg.version}</code> · ${(pkg.bytes / 1048576).toFixed(2)} MiB · <a href="${npmHref('registry.npmjs.org', pkg)}">npmjs</a> · <a href="${npmHref('registry.npmmirror.com', pkg)}">npmmirror</a></li>`);
  const npmPackages = npmPackageRows.join('\n');
  const jsdelivr = `https://cdn.jsdelivr.net/npm/filens-preview@${manifest.components.preview}/dist`;
  await writeFile(path.join(downloads, 'index.html'), `<!doctype html>
<html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>FiLens 下载 / Downloads</title>
<style>body{font:16px/1.6 system-ui,sans-serif;max-width:960px;margin:48px auto;padding:0 20px;background:#101014;color:#eee}a{color:#a5c8ff}h1{margin-bottom:0}nav{display:flex;gap:24px;flex-wrap:wrap}table{width:100%;border-collapse:collapse;margin:24px 0}td,th{padding:12px 8px;border-bottom:1px solid #383840;text-align:left}td:first-child{overflow-wrap:anywhere}td:last-child{white-space:nowrap}</style>
<nav><a href="/">FiLens</a><a href="/?view=agent">Agent 安装指南 / Setup</a><a href="https://github.com/orca-zhang/filens">GitHub</a></nav>
<h1>下载 / Downloads</h1><p>${manifest.tag} · CLI ${cliVersion} · Preview ${manifest.components.preview} · SDK ${manifest.components.mobileSdk}</p>
<p>预览 npm 包（国际 npmjs / 中国大陆 npmmirror）：</p><ul>${npmPackages}</ul>
<p>CDN 备用入口 / CDN fallback: <a href="${jsdelivr}/split/filens.js">按需分包 / Split</a> · <a href="${jsdelivr}/all-in-one/filens.js">单文件 / All-in-one</a>。首选从下方 GitHub Release 下载或安装 npm 包。</p>
<p>CLI npm：<code>npm install -g filens-cli@${cliVersion}</code> / <code>npm install -g filens-cli-lite@${cliVersion}</code>；中国大陆可添加 <code>--registry=https://registry.npmmirror.com</code>。</p>
<p><a href="/SKILL.md">SKILL.md</a> · <a href="filens-skill.zip" download>Skill ZIP（含参考文件 / with references）</a></p>
<p>按操作系统选择 CLI：Full 含离线 OCR 和预览，Lite 按需补充。完整解压后运行；无需 Node.js 或 npm。SDK ZIP 为源码包。<br>Choose the CLI for your OS: Full includes offline OCR and previews; Lite adds them separately. Extract the entire archive; Node.js and npm are not required. SDK ZIPs contain source projects.</p>
<table><thead><tr><th>安装包 / Package</th><th>大小 / Size</th></tr></thead><tbody>${rows}</tbody></table>
<p><a href="${release}/SHA256SUMS">SHA256SUMS</a> · <a href="${release}/filens-release-${manifest.tag}.json">版本清单 / Release manifest</a></p>
<p>版本 ZIP 从 GitHub Releases 直接获取；npm 包可在 npmjs 与 npmmirror 之间选择。FiLens 站点不传输这些包体。<br>Versioned ZIPs come directly from GitHub Releases; choose npmjs or npmmirror for npm packages. FiLens does not serve package bytes.</p></html>\n`);
  console.log(`Staged ${releaseAssets.length} GitHub Release links and ${npmPackageRows.length} npm package choices for ${manifest.tag}.`);
}
