import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import JSZip from 'jszip';

export async function stageSiteDownloads(rootDir) {
  const manifest = JSON.parse(await readFile(path.join(rootDir, 'docs/preview-release-sizes.json'), 'utf8'));
  const downloads = path.join(rootDir, 'apps/demo/dist/downloads');
  await mkdir(downloads, { recursive: true });

  const skillDir = path.join(rootDir, 'skills/filens');
  const zip = new JSZip();
  for (const file of await readdir(skillDir, { recursive: true })) {
    if (file.endsWith('.md')) zip.file(`filens/${file.replaceAll(path.sep, '/')}`, await readFile(path.join(skillDir, file)));
  }
  await writeFile(path.join(downloads, 'filens-skill.zip'), await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' }));
  const release = `https://github.com/orca-zhang/filens/releases/download/${manifest.tag}`;
  const rows = manifest.assets.map(asset => {
    const npm = asset.kind === 'npm-package' && asset.name
      ? ` · <a href="https://registry.npmjs.org/${asset.name}/-/${asset.file}">npmjs</a> · <a href="https://registry.npmmirror.com/${asset.name}/-/${asset.file}">npmmirror</a>`
      : '';
    const optional = asset.kind === 'browser-precompressed-sidecars'
      ? ' · 可选静态托管压缩文件 / optional static-host sidecars'
      : '';
    return `<tr><td><a href="${release}/${asset.file}" download>${asset.file}</a>${optional}${npm}</td><td>${(asset.bytes / 1048576).toFixed(2)} MiB</td></tr>`;
  }).join('\n');
  const previewNpm = `https://registry.npmjs.org/filens-preview/-/filens-preview-${manifest.components.preview}.tgz`;
  const previewMirror = `https://registry.npmmirror.com/filens-preview/-/filens-preview-${manifest.components.preview}.tgz`;
  await writeFile(path.join(downloads, 'index.html'), `<!doctype html>
<html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>FiLens 下载 / Downloads</title>
<style>body{font:16px/1.6 system-ui,sans-serif;max-width:960px;margin:48px auto;padding:0 20px;background:#101014;color:#eee}a{color:#a5c8ff}h1{margin-bottom:0}nav{display:flex;gap:24px;flex-wrap:wrap}table{width:100%;border-collapse:collapse;margin:24px 0}td,th{padding:12px 8px;border-bottom:1px solid #383840;text-align:left}td:first-child{overflow-wrap:anywhere}td:last-child{white-space:nowrap}</style>
<nav><a href="/">FiLens</a><a href="/?view=agent">Agent 安装指南 / Setup</a><a href="https://github.com/orca-zhang/filens">GitHub</a></nav>
<h1>下载 / Downloads</h1><p>${manifest.tag} · CLI ${manifest.components.cli} · Preview ${manifest.components.preview} · SDK ${manifest.components.mobileSdk}</p>
<p>JavaScript CDN (ESM): <a href="https://cdn.jsdelivr.net/npm/filens-preview@${manifest.components.preview}/dist/split/filens.js">按需加载版 / Split</a> · <a href="https://cdn.jsdelivr.net/npm/filens-preview@${manifest.components.preview}/dist/all-in-one/filens.js">单文件版 / All-in-one</a></p>
<p>预览 npm 包（包含两种构建）：国际 <a href="${previewNpm}">npmjs</a> · 中国大陆 <a href="${previewMirror}">npmmirror</a>。CLI npmjs：<code>npm install -g filens-cli@${manifest.components.cli}</code> / <code>npm install -g filens-cli-lite@${manifest.components.cli}</code>；中国大陆将命令加上 <code>--registry=https://registry.npmmirror.com</code>。</p>
<p><a href="/SKILL.md">SKILL.md</a> · <a href="filens-skill.zip" download>Skill ZIP（含参考文件 / with references）</a></p>
<p>按操作系统选择 CLI：Full 含离线 OCR 和预览，Lite 按需补充。完整解压后运行；无需 Node.js 或 npm。SDK ZIP 为源码包。<br>Choose the CLI for your OS: Full includes offline OCR and previews; Lite adds them separately. Extract the entire archive; Node.js and npm are not required. SDK ZIPs contain source projects.</p>
<table><thead><tr><th>安装包 / Package</th><th>大小 / Size</th></tr></thead><tbody>${rows}</tbody></table>
<p><a href="${release}/SHA256SUMS">SHA256SUMS</a> · <a href="${release}/filens-release-${manifest.tag}.json">版本清单 / Release manifest</a></p>
<p>版本 ZIP 从 GitHub Releases 直接获取；预览 npm 包可在 npmjs 与 npmmirror 之间选择。FiLens 站点不传输这些包体。<br>Versioned ZIPs come directly from GitHub Releases; choose npmjs or npmmirror for the preview package. FiLens does not serve package bytes.</p></html>\n`);
  console.log(`Staged ${manifest.assets.length} GitHub Release links and the Skill ZIP for ${manifest.tag}.`);
}
