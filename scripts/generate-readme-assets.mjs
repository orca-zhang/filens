// Run after capture-homepage-demo.mjs. Requires Playwright Chromium and FFmpeg.
// Add --overview-only to preserve the existing animated preview (no FFmpeg needed).
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const input = path.join(root, 'apps/demo/public/home');
const output = path.join(root, 'docs/assets/readme');
const overviewOnly = process.argv.includes('--overview-only');
await mkdir(output, { recursive: true });
const previews = [
  ['PPTX', 'presentation', '#a6eeff', 'P'],
  ['DOCX', 'document', '#b6d7ff', 'W'],
  ['XLSX', 'spreadsheet', '#d8ccff', 'X'],
  ['PDF', 'pdf', '#ffcaed', 'F'],
  ['KEYNOTE', 'iwork', '#a5dcff', 'K'],
  ['CAD', 'cad', '#c0ceff', 'D'],
  ['3D', 'model', '#e2c8ff', '3'],
  ['360°', 'panorama', '#fed0d9', '°'],
  ['VIDEO', 'video', '#aceaff', '▶'],
  ['MUSIC', 'music', '#c6d4ff', '♪'],
  ['ARCHIVE', 'archive', '#e6c8ff', 'Z'],
  ['EBOOK', 'ebook', '#ffd7be', 'E']
];
const assets = await Promise.all(previews.map(async ([label, file, color, icon]) => ({
  label, color, icon,
  src: `data:image/webp;base64,${(await readFile(path.join(input, `${file}.webp`))).toString('base64')}`
})));

const browser = await chromium.launch();
try {
  const page = await browser.newPage();
  const overview = await page.evaluate(async (assets) => {
    const canvas = document.createElement('canvas');
    canvas.width = 1680;
    canvas.height = 24 + Math.ceil(assets.length / 4) * 316;
    const ctx = canvas.getContext('2d');
    const background = ctx.createLinearGradient(0, 0, canvas.width, canvas.height);
    background.addColorStop(0, '#dcf6ff');
    background.addColorStop(.48, '#eae8ff');
    background.addColorStop(.8, '#f9e0f5');
    background.addColorStop(1, '#ffeae1');
    ctx.fillStyle = background;
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    const glow = ctx.createRadialGradient(180, 0, 0, 180, 0, 950);
    glow.addColorStop(0, '#ffffffdc');
    glow.addColorStop(1, '#ffffff00');
    ctx.fillStyle = glow;
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = '#6b64b720';
    for (let x = 11; x < canvas.width; x += 22) {
      for (let y = 11; y < canvas.height; y += 22) {
        ctx.beginPath(); ctx.arc(x, y, .8, 0, Math.PI * 2); ctx.fill();
      }
    }
    for (const [index, asset] of assets.entries()) {
      const x = 24 + (index % 4) * 414;
      const y = 24 + Math.floor(index / 4) * 316;
      const image = new Image();
      image.src = asset.src;
      await image.decode();
      ctx.save();
      ctx.shadowColor = '#4d43a42b';
      ctx.shadowBlur = 14;
      ctx.shadowOffsetY = 4;
      ctx.fillStyle = '#ffffffed';
      ctx.strokeStyle = '#ffffff';
      ctx.beginPath();
      ctx.roundRect(x, y, 390, 292, 14);
      ctx.fill();
      ctx.stroke();
      ctx.restore();
      ctx.fillStyle = asset.color;
      ctx.beginPath();
      ctx.roundRect(x + 18, y + 14, 30, 32, 6);
      ctx.fill();
      ctx.fillStyle = '#292b55';
      ctx.font = 'bold 20px system-ui, sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText(asset.icon, x + 33, y + 38);
      ctx.textAlign = 'left';
      ctx.fillStyle = '#292b55';
      ctx.font = '600 18px system-ui, sans-serif';
      ctx.fillText(asset.label, x + 60, y + 37);
      ctx.save();
      ctx.beginPath();
      ctx.roundRect(x + 10, y + 60, 370, 222, 8);
      ctx.clip();
      ctx.drawImage(image, x + 10, y + 60, 370, 222);
      ctx.restore();
    }
    return canvas.toDataURL('image/webp', 0.9).split(',')[1];
  }, assets);
  await writeFile(path.join(output, 'overview.webp'), Buffer.from(overview, 'base64'));
} finally {
  await browser.close();
}

// Speed up the actual recording for a small inline preview. The original MP4
// remains available for full-speed playback and captions.
if (!overviewOnly) {
  execFileSync('ffmpeg', [
    '-hide_banner', '-loglevel', 'error', '-y',
    '-i', path.join(input, 'filens-demo.mp4'),
    '-filter_complex', '[0:v]setpts=0.45*PTS,fps=5,scale=720:-1:flags=lanczos,split[a][b];[a]palettegen=max_colors=96:stats_mode=diff[p];[b][p]paletteuse=dither=bayer:bayer_scale=3',
    '-loop', '0', path.join(output, 'demo.gif')
  ], { stdio: 'inherit' });
}
console.log(overviewOnly ? 'Generated README overview.' : 'Generated README overview and animated preview.');
