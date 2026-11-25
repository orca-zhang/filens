// Frame existing recordings with the FiLens logo palette.
import assert from 'node:assert/strict';
import { chromium } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const output = path.join(root, 'docs/assets/readme');
const logo = (await readFile(path.join(root, 'apps/demo/public/brand/filens-icon-180.png'))).toString('base64');
const temporary = await mkdtemp(path.join(os.tmpdir(), 'filens-readme-frames-'));
const browser = await chromium.launch();
const recordings = [
  {
    input: 'docs/assets/readme/demo.gif', name: 'preview', title: 'Every file. <span>One workspace.</span>',
    subtitle: 'Office, iWork, CAD, 3D and panoramas — rendered locally in your browser.',
    label: 'filens — browser previews', badge: 'LOCAL FIRST · BROWSER NATIVE',
    source: 'Original screen recording · playback accelerated · original content preserved',
  },
  ...['en', 'zh-CN'].map(locale => ({
    input: `docs/assets/dsh-release/office-preview.${locale}.gif`, name: `dsh-preview.${locale}`,
    title: locale === 'en' ? 'Inside your Agent. <span>Files come alive.</span>' : '在 Agent 身边，<span>打开文件的全部可能。</span>',
    subtitle: locale === 'en' ? 'Read Word, explore sheets and present slides in the same sidebar.' : '阅读 Word、切换工作表、全屏演示幻灯片，都在同一个侧栏。',
    label: 'filens — DeepSeek Harness', badge: 'LOCAL FIRST · NATIVE PREVIEWS',
    source: locale === 'en' ? 'Actual DSH 0.1.10 recording · original UI, captions and timing preserved' : 'DSH 0.1.10 实机录屏 · 保留原始界面、字幕与播放速度',
  })),
];

function ffmpeg(args) {
  execFileSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', ...args], { stdio: 'inherit' });
}

try {
  await mkdir(output, { recursive: true });
  for (const recording of recordings) {
    const input = path.join(root, recording.input);
    const probe = JSON.parse(execFileSync('ffprobe', ['-v', 'error', '-show_streams', '-show_format', '-of', 'json', input]));
    const { width, height } = probe.streams[0];
    const contentWidth = 1206, contentHeight = Math.round(contentWidth * height / width);
    const frameHeight = 42 + contentHeight, canvasHeight = 189 + frameHeight + 82;
    const page = await browser.newPage({ viewport: { width: 1280, height: canvasHeight }, deviceScaleFactor: 1 });
    await page.setContent(`<!doctype html><meta charset="utf-8"><style>
      *{box-sizing:border-box}html,body{margin:0;overflow:hidden;color:#1d2047;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI","PingFang SC",sans-serif}
      body{min-height:100vh;padding:29px 36px;background:radial-gradient(ellipse at 87% 8%,#f3bfff9e,transparent 44%),radial-gradient(ellipse at 6% 0%,#b5eeffb0,transparent 52%),linear-gradient(140deg,#f6fcff,#eeebff 55%,#ffeef8)}
      body:before{content:"";position:absolute;inset:0;background-image:radial-gradient(#696ab326 .8px,transparent .8px);background-size:22px 22px;pointer-events:none}
      .top{position:relative;display:flex;align-items:center;justify-content:space-between;height:34px}.brand{font-size:24px;letter-spacing:-1px;font-weight:730;display:flex;gap:10px;align-items:center}
      .mark{width:32px;height:32px}
      .badge{border:1px solid #bcbaf4;border-radius:20px;padding:7px 13px;color:#4f488b;background:#ffffff91;font-size:11px;letter-spacing:1.4px}
      h1{position:relative;font-size:43px;line-height:1.12;font-weight:650;letter-spacing:-1.3px;margin:23px 0 10px}
      h1 span{color:transparent;background:linear-gradient(100deg,#0076a8,#5840c7 48%,#a02f91);background-clip:text}
      p{position:relative;margin:0;color:#53577c;font-size:15px}
      .window{position:absolute;left:36px;top:189px;width:1208px;height:${frameHeight + 1}px;border:1px solid #b9b6ea;border-radius:16px;background:#f5f4ff;box-shadow:0 12px 40px #5b489f28;overflow:hidden}
      .chrome{height:41px;background:linear-gradient(100deg,#edfbff,#f1efff 54%,#ffecfa);border-bottom:1px solid #d9d7f1;display:flex;align-items:center;padding:0 17px;gap:7px}
      i{width:9px;height:9px;border-radius:50%;background:#3ebdeb}i:nth-child(2){background:#8572ef}i:nth-child(3){background:#dc6fba}
      .name{color:#53577c;font-size:11px;letter-spacing:.7px;margin:auto}.status{font-size:10px;color:#554592;letter-spacing:1px}
      footer{position:absolute;left:36px;right:36px;bottom:29px;display:flex;justify-content:space-between;color:#545479;font-size:11px}
    </style><div class="top"><div class="brand"><img class="mark" src="data:image/png;base64,${logo}" alt="">filens</div><div class="badge">${recording.badge}</div></div>
    <h1>${recording.title}</h1><p>${recording.subtitle}</p>
    <div class="window"><div class="chrome"><i></i><i></i><i></i><span class="name">${recording.label}</span><span class="status">ON DEVICE</span></div></div>
    <footer><span>${recording.source}</span><span>filens.cc</span></footer>`);
    await page.evaluate(() => document.fonts.ready);
    await page.locator('.mark').evaluate(img => img.decode());
    assert.ok(await page.locator('h1').evaluate(node => node.scrollWidth <= node.clientWidth && node.getBoundingClientRect().bottom < 170), 'Demo heading overflows');
    const background = path.join(temporary, `${recording.name}.png`);
    await page.screenshot({ path: background });
    await page.close();
    const target = path.join(output, `${recording.name}.gif`);
    ffmpeg(['-i', input, '-framerate', '12', '-loop', '1', '-i', background, '-filter_complex',
      `[0:v]fps=12,scale=${contentWidth}:${contentHeight}:flags=lanczos[clip];[1:v][clip]overlay=37:231:shortest=1,split[a][b];[a]palettegen=max_colors=128:stats_mode=diff[p];[b][p]paletteuse=dither=bayer:bayer_scale=3:diff_mode=rectangle`,
      '-gifflags', '+transdiff', '-loop', '0', target]);
    const result = JSON.parse(execFileSync('ffprobe', ['-v', 'error', '-show_format', '-of', 'json', target]));
    assert.ok(Math.abs(Number(result.format.duration) - Number(probe.format.duration)) < .15, 'Framing changed playback duration');
    console.log(`Framed ${path.relative(root, target)}`);
  }
  await writeFile(path.join(output, 'demo-frames.json'), JSON.stringify({
    style: 'FiLens logo palette',
    sources: recordings.map(({ input, name }) => ({ input, output: `${name}.gif` })),
    editing: 'Presentation frame only. Source UI and captions retained; sampled at 12 fps. No new product or timing claims.',
  }, null, 2) + '\n');
} finally {
  await browser.close();
  await rm(temporary, { recursive: true, force: true });
}
