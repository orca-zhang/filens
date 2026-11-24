import { createHash } from 'node:crypto';
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import JSZip from 'jszip';

export async function stageSiteDownloads(rootDir) {
  const manifest = JSON.parse(await readFile(path.join(rootDir, 'docs/preview-release-sizes.json'), 'utf8'));
  const downloads = path.join(rootDir, 'apps/demo/dist/downloads');
  const cdn = path.join(rootDir, 'apps/demo/dist/cdn');
  const versionDir = path.join(downloads, manifest.tag);
  await mkdir(versionDir, { recursive: true });
  for (const asset of manifest.assets) {
    let bytes;
    try {
      bytes = await readFile(path.join(rootDir, 'dist/github-release', manifest.tag, asset.file));
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
      const url = `https://github.com/orca-zhang/filens/releases/download/${manifest.tag}/${asset.file}`;
      const response = await fetch(url);
      if (!response.ok) throw new Error(`Download failed: ${asset.file} (HTTP ${response.status})`);
      bytes = Buffer.from(await response.arrayBuffer());
    }
    if (bytes.length !== asset.bytes || createHash('sha256').update(bytes).digest('hex') !== asset.sha256) {
      throw new Error(`Release checksum mismatch: ${asset.file}`);
    }
    await writeFile(path.join(versionDir, asset.file), bytes);
    if (['browser-split', 'browser-all-in-one'].includes(asset.kind)) {
      const mode = asset.kind.slice('browser-'.length);
      const prefix = `filens-preview-${manifest.components.preview}-${mode}/`;
      const directory = path.join(cdn, `filens-preview@${manifest.components.preview}`, mode);
      const zip = await JSZip.loadAsync(bytes);
      if (!zip.file(`${prefix}filens.js`)) throw new Error(`Missing CDN entry: ${asset.file}`);
      for (const entry of Object.values(zip.files)) {
        if (entry.dir) continue;
        const name = entry.unsafeOriginalName ?? entry.name;
        if (!name.startsWith(prefix) || name.includes('\\') || name.split('/').some(part => part === '..' || part === '.')) {
          throw new Error(`Unsafe CDN path: ${name}`);
        }
        const file = path.join(directory, name.slice(prefix.length));
        await mkdir(path.dirname(file), { recursive: true });
        await writeFile(file, await entry.async('nodebuffer'));
      }
    }
  }
  await mkdir(cdn, { recursive: true });
  await writeFile(path.join(cdn, 'filens.js'), `export * from './filens-preview@${manifest.components.preview}/all-in-one/filens.js';\n`);
  await writeFile(path.join(versionDir, 'SHA256SUMS'), manifest.assets.map(asset => `${asset.sha256}  ${asset.file}\n`).join(''));
  await writeFile(path.join(versionDir, 'release.json'), `${JSON.stringify(manifest, null, 2)}\n`);

  const skillDir = path.join(rootDir, 'skills/filens');
  const zip = new JSZip();
  for (const file of await readdir(skillDir, { recursive: true })) {
    if (file.endsWith('.md')) zip.file(`filens/${file.replaceAll(path.sep, '/')}`, await readFile(path.join(skillDir, file)));
  }
  await writeFile(path.join(downloads, 'filens-skill.zip'), await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' }));
  const rows = manifest.assets.map(asset => `<tr><td><a href="${manifest.tag}/${asset.file}" download>${asset.file}</a></td><td>${(asset.bytes / 1048576).toFixed(2)} MiB</td></tr>`).join('\n');
  await writeFile(path.join(downloads, 'index.html'), `<!doctype html>
<html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>FiLens 下载 / Downloads</title>
<style>body{font:16px/1.6 system-ui,sans-serif;max-width:960px;margin:48px auto;padding:0 20px;background:#101014;color:#eee}a{color:#a5c8ff}h1{margin-bottom:0}nav{display:flex;gap:24px;flex-wrap:wrap}table{width:100%;border-collapse:collapse;margin:24px 0}td,th{padding:12px 8px;border-bottom:1px solid #383840;text-align:left}td:first-child{overflow-wrap:anywhere}td:last-child{white-space:nowrap}</style>
<nav><a href="/">FiLens</a><a href="/?view=agent">Agent 安装指南 / Setup</a><a href="https://github.com/orca-zhang/filens">GitHub</a></nav>
<h1>下载 / Downloads</h1><p>${manifest.tag} · CLI ${manifest.components.cli} · Preview ${manifest.components.preview} · SDK ${manifest.components.mobileSdk}</p>
<p>JavaScript CDN (ESM): <a href="/cdn/filens-preview@${manifest.components.preview}/all-in-one/filens.js">单文件版 / All-in-one</a> · <a href="/cdn/filens-preview@${manifest.components.preview}/split/filens.js">按需加载版 / Split</a></p>
<p><a href="/SKILL.md">SKILL.md</a> · <a href="filens-skill.zip" download>Skill ZIP（含参考文件 / with references）</a></p>
<p>按操作系统选择 CLI：Full 含离线 OCR 和预览，Lite 按需补充。完整解压后运行；无需 Node.js 或 npm。SDK ZIP 为源码包。<br>Choose the CLI for your OS: Full includes offline OCR and previews; Lite adds them separately. Extract the entire archive; Node.js and npm are not required. SDK ZIPs contain source projects.</p>
<table><thead><tr><th>安装包 / Package</th><th>大小 / Size</th></tr></thead><tbody>${rows}</tbody></table>
<p><a href="${manifest.tag}/SHA256SUMS">SHA256SUMS</a> · <a href="${manifest.tag}/release.json">版本清单 / Release manifest</a></p>
<p>这些文件与已发布安装包的 SHA-256 一致。<br>Package SHA-256 hashes match the published release.</p></html>\n`);
  console.log(`Staged ${manifest.assets.length} verified release files and the Skill ZIP for ${manifest.tag}.`);
}
