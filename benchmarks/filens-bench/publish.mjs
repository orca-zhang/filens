import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import JSZip from 'jszip';
import { renderSiteChart } from './site-chart.mjs';

const root = fileURLToPath(new URL('../../', import.meta.url));
const snapshotPattern = /^converged-\d{4}-\d{2}-\d{2}$/;
const publicFiles = ['baselines.json', 'summary.svg', 'summary.en.svg', 'README.md'];
const escape = value => String(value).replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);
const number = (value, digits = 1) => value == null ? '—' : value.toLocaleString('en-US', { minimumFractionDigits: digits, maximumFractionDigits: digits });

function page(data, prefix, english) {
  const t = (zh, en) => english ? en : zh;
  const summaryChart = english ? 'site-summary.en.svg' : 'site-summary.svg';
  const ordered = [...data.baselines].sort((a, b) =>
    b.metrics.complexQuality.stock - a.metrics.complexQuality.stock ||
    b.metrics.complexQuality.filens - a.metrics.complexQuality.filens);
  const pair = (values, digits = 1, suffix = '') => `${escape(number(values?.stock, digits))}${suffix} → <strong>${escape(number(values?.filens, digits))}${suffix}</strong>`;
  const rows = ordered.map(row => {
    const m = row.metrics, latency = m.complexElapsedSeconds;
    const tokens = m.allTaskTokens ?? m.allTaskTokensKnownSubtotal;
    const evidence = m.evidenceSuccessRate
      ? pair(m.evidenceSuccessRate, 1, '%')
      : `${escape(m.evidenceCompleteComplexTasks.stock)} → <strong>${escape(m.evidenceCompleteComplexTasks.filens)}</strong>`;
    return `<tr><th scope="row">${escape(row.harness)}<small>${escape(row.referenceVersion)}</small></th>
<td>${escape(row.model)}<small>${escape(row.reasoningEffort ?? '')}</small></td>
<td>${pair(m.complexQuality)}</td><td>${evidence}</td>
<td>${latency ? pair({ stock: latency.stockP50, filens: latency.filensP50 }) : pair(m.elapsedSeconds, 3)} s${latency ? '' : `<small>${t('整批耗时', 'whole batch')}</small>`}</td>
<td>${latency ? `${pair({ stock: latency.stockP95, filens: latency.filensP95 })} s` : '—'}</td>
<td>${pair(tokens, 0)}${m.allTaskTokensKnownSubtotal ? `<small>${t('已知小计；存在未知用量', 'Known subtotals; usage is missing')}</small>` : ''}</td></tr>`;
  }).join('\n');
  const details = ordered.map(row => `<article><h3>${escape(row.harness)} · ${escape(row.harnessVersion)}</h3><p>${escape(row.protocol)}</p>${row.caveats.map(note => `<p>${escape(note)}</p>`).join('')}</article>`).join('\n');
  const zip = `filens-bench-${data.snapshot}.zip`;
  return `<!doctype html>
<html lang="${english ? 'en' : 'zh-CN'}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>FiLens-Bench · ${t('复杂文件 Agent 评测', 'Complex-file agent evaluation')}</title>
<meta name="description" content="${t('比较 Agent 正常安装 FiLens 前后的复杂文件查询质量、耗时与 token 用量。独立成绩页、图表、评测方法与结果包。', 'Compare complex-file quality, latency and tokens before and after normal FiLens installation. Dedicated results, charts, methodology and downloadable snapshots.')}">
<style>
:root{color-scheme:dark}*{box-sizing:border-box}body{margin:0;background:#090909;color:#eeede9;font:15px/1.75 system-ui,sans-serif}main,nav,footer{width:min(1200px,calc(100% - 40px));margin:auto}nav{display:flex;gap:24px;flex-wrap:wrap;padding:26px 0;border-bottom:1px solid #ffffff20}nav a:first-child{margin-right:auto;font-weight:700}a{color:#e8c29a;text-underline-offset:4px}a:focus-visible,summary:focus-visible,[tabindex]:focus-visible{outline:2px solid #e8c29a;outline-offset:5px}header{padding:64px 0 36px}h1{font-size:clamp(38px,7vw,68px);line-height:1.15;margin:12px 0;letter-spacing:-.04em}h2{font-size:26px;line-height:1.4}h3{font-size:16px}p{max-width:88ch}.muted,small{color:#aaa79f}.eyebrow{color:#e8c29a;letter-spacing:.15em;font-size:12px}.actions{display:flex;flex-wrap:wrap;gap:16px;margin:24px 0}.button{border:1px solid #ffffff30;border-radius:8px;padding:10px 18px;text-decoration:none}.primary{color:#111;background:#eeede9}section{padding:28px 0;border-top:1px solid #ffffff20}figure{margin:24px 0}figure img{display:block;width:100%;height:auto;border-radius:12px}figcaption{margin-top:8px;color:#aaa79f}.table-scroll{overflow:auto;max-width:100%}table{width:100%;min-width:1080px;border-collapse:collapse;font-size:13px}caption{text-align:left;padding-bottom:12px;color:#aaa79f}th,td{text-align:left;padding:16px 12px;border-bottom:1px solid #ffffff20}thead th{color:#aaa79f;font-weight:500}tbody th{font-weight:600}td{font-variant-numeric:tabular-nums;white-space:nowrap}small{display:block;white-space:normal;font-size:11px}strong{color:#bad4ad}details{padding:18px 0}summary{cursor:pointer;color:#e8c29a}article{padding:12px 0}article p{margin:8px 0;color:#aaa79f}code{overflow-wrap:anywhere}footer{padding:32px 0 48px;color:#aaa79f}@media(max-width:560px){header{padding-top:40px}nav{gap:14px;font-size:13px}h2{font-size:22px}.actions{gap:12px}.button{padding:10px 14px}}
</style></head><body>
<nav aria-label="${t('主导航', 'Main navigation')}"><a href="/">filens ↗</a><a href="#method">${t('评测方法', 'Methodology')}</a><a href="#downloads">${t('结果下载', 'Downloads')}</a><a href="${english ? './' : 'en.html'}" lang="${english ? 'zh-CN' : 'en'}">${t('English', '简体中文')}</a></nav>
<main><header><p class="eyebrow">FILENS-BENCH · ${escape(data.generatedAt)}</p><h1>${t('Agent 能否真正读懂复杂文件？', 'Can your agent read complex files?')}</h1>
<p>${t('在同一 Agent 环境中，比较正常安装 FiLens 前后的回答质量、证据、耗时与 token 用量。', 'Compare answer quality, evidence, latency and token usage before and after a normal FiLens installation, within the same agent environment.')}</p>
<p class="muted">${data.baselines.length} harnesses · ${data.dataset.complexTasks} ${t('道复杂文件题', 'complex-file tasks')} + ${data.dataset.textControlTasks} ${t('道文本控制题', 'text controls')} · CLI ${escape(data.dataset.filensCliVersion)} · ${escape(data.snapshot)}</p>
<div class="actions"><a class="button primary" href="${prefix}${zip}" download>${t('下载公开结果包', 'Download public results')}</a><a class="button" href="${prefix}baselines.json">JSON</a><a class="button" href="https://github.com/orca-zhang/filens/tree/main/benchmarks/filens-bench">${t('协议与复现代码', 'Protocol and reproduction code')} ↗</a></div>
<p class="muted">${t('当前为 v0.1 合成种子集；表格和图表按原生质量分降序。不同模型、适配方式与 WorkBuddy 单批结果只适合描述性参考，请重点比较同一 harness 内变化。', 'This is the v0.1 synthetic seed corpus. The table and chart are sorted by native quality, descending. Models, adaptations and the WorkBuddy single batch differ, so use these results descriptively and focus on paired changes within each harness.')}</p></header>
<section aria-labelledby="scores"><h2 id="scores">${t('配对成绩', 'Paired results')}</h2>
<div class="table-scroll" role="region" aria-label="${t('配对成绩，可横向滚动', 'Paired results, scroll horizontally')}" tabindex="0"><table><caption>${t('原生环境 → 安装 FiLens；质量与证据越高越好，耗时越低越好。', 'Stock → FiLens; higher quality and evidence scores are better, lower latency is better.')}</caption>
<thead><tr><th scope="col">Harness</th><th scope="col">${t('模型 / 推理', 'Model / reasoning')}</th><th scope="col">${t('复杂题质量 / 100', 'Complex quality / 100')}</th><th scope="col">${t('带证据成功', 'Evidence success')}</th><th scope="col">p50 / ${t('整批', 'batch')}</th><th scope="col">p95</th><th scope="col">${t('全题 token', 'All-task tokens')}</th></tr></thead><tbody>${rows}</tbody></table></div>
<details><summary>${t('逐组运行范围、版本与限制', 'Per-harness protocols, versions and caveats')}</summary>${details}</details>
<figure><a href="${prefix}${summaryChart}"><img src="${prefix}${summaryChart}" width="1600" height="1110" alt="${t(`${data.baselines.length} 个 harness 的质量、p50、p95 与 token 四面板配对柱状图`, `Four-panel paired bar charts of quality, p50, p95 and tokens across ${data.baselines.length} harnesses`)}"></a><figcaption>${t('点击查看官网四面板原图。斜线柱为不完整用量小计，不计算节省率。', 'Open the four-panel website chart. Hatched bars show incomplete usage subtotals, without savings percentages.')}</figcaption></figure>
</section>
<section id="method"><h2>${t('评测方法与范围', 'Methodology and scope')}</h2>
<p>${t('两组固定相同问题、模型、语料与设置，Agent 自主选择工具。CLI harness 每题每组重复三次；WorkBuddy 为每组一轮 13 题同批对话。失败和超时保留。', 'Each pair uses the same questions, model, corpus and settings, with autonomous tool choice. CLI harnesses repeat every task three times per condition; WorkBuddy uses one 13-task batch per condition. Failures and timeouts remain included.')}</p>
<p><code>Quality = 100 × (0.70 × ${t('字段准确率', 'field accuracy')} + 0.30 × ${t('证据 F1', 'evidence F1')})</code></p>
<p>${t('质量只统计 11 道复杂文件题，token 覆盖全部 13 题。字段归一化后精确匹配，证据核对文件和原文引句，暂不核对页码或单元格坐标。未知用量不按零计，金额不计价。', 'Quality covers the 11 complex-file tasks; tokens cover all 13 tasks. Normalized fields must match exactly. Evidence checks the file and verbatim quote, but not page or cell coordinates. Missing usage is not zero; costs are not priced.')}</p>
<p>${t('这是经过开发与候选筛选的小型合成题集快照，不是独立留出集盲测。各组候选编号独立；同为 CLI 0.5.7，但没有一致记录共同二进制 SHA-256。', 'This small synthetic snapshot follows development and candidate selection on the same tasks, rather than blind evaluation on an independent holdout. Candidate labels are harness-specific. All rows report CLI 0.5.7, but shared binary SHA-256 identities were not consistently recorded.')}</p>
<p>${t('Codex 有未保存请求；Claude 和 Zcode 存在未知 token 用量，不能据此计算完整节省率。Claude 同日复跑有明显波动。WorkBuddy 仅是单批探索性结果。详见逐组限制和 JSON。', 'Codex has an unsaved request. Claude and Zcode have missing token usage, so complete savings cannot be calculated. Claude shows material same-day rerun variance. WorkBuddy is exploratory single-batch evidence. See per-harness caveats and the JSON.')}</p>
<p><a href="${prefix}README.md">${t('完整中英文方法说明', 'Full bilingual methodology')}</a></p></section>
<section id="downloads"><h2>${t('公开快照与下载', 'Public snapshot downloads')}</h2>
<p>${t('结果包包含汇总成绩 JSON、中英文分组柱状图、评测方法与限制；不含原始问题/回答、调用轨迹或逐次账单。完整运行档案保留在开发环境，公开汇总包不等于完整原始审计记录。', 'The package contains aggregate JSON results, bilingual grouped bar charts, methodology and limitations. Raw prompts/answers, traces and itemized ledgers are not included. Full run archives remain in the development environment; this summary is not a complete raw audit record.')}</p>
<div class="actions"><a href="${prefix}${zip}" download>ZIP ↓</a><a href="${prefix}baselines.json">JSON</a><a href="${prefix}${summaryChart}">SVG</a><a href="${prefix}SHA256SUMS">SHA256SUMS</a></div>
<p>${t('固定版本地址', 'Permanent snapshot')}: <a href="${prefix}${english ? 'en.html' : 'index.html'}">${escape(data.snapshot)}</a></p></section></main>
<footer>FiLens-Bench · <a href="/">filens</a> · <a href="https://github.com/orca-zhang/filens">GitHub</a></footer></body></html>\n`;
}

export async function stageFilensBench(rootDir, output = path.join(rootDir, 'apps/demo/dist/bench')) {
  const published = path.join(rootDir, 'benchmarks/filens-bench/published');
  const { snapshot: latest } = JSON.parse(await readFile(path.join(published, 'latest.json'), 'utf8'));
  assert.match(latest, snapshotPattern, 'Invalid public benchmark snapshot');
  const snapshots = (await readdir(published, { withFileTypes: true })).filter(entry => entry.isDirectory() && snapshotPattern.test(entry.name));
  assert.ok(snapshots.some(entry => entry.name === latest), 'Latest benchmark snapshot is missing');
  for (const { name: snapshot } of snapshots) {
    const source = path.join(published, snapshot);
    const data = JSON.parse(await readFile(path.join(source, 'baselines.json'), 'utf8'));
    assert.equal(data.schemaVersion, 1);
    assert.equal(data.snapshot, snapshot);
    assert.ok(data.baselines.length > 0, 'Public benchmark has no results');
    const destination = path.join(output, 'snapshots', snapshot), zip = new JSZip(), sums = [];
    await mkdir(destination, { recursive: true });
    for (const english of [false, true]) {
      await writeFile(path.join(destination, english ? 'site-summary.en.svg' : 'site-summary.svg'), renderSiteChart(data, english));
    }
    // Only reviewed public artifacts belong on the site; results/ contains local run archives.
    for (const file of publicFiles) {
      const bytes = await readFile(path.join(source, file));
      await writeFile(path.join(destination, file), bytes);
      zip.file(file, bytes, { date: new Date(`${data.generatedAt}T00:00:00Z`) });
      sums.push(`${createHash('sha256').update(bytes).digest('hex')}  ${file}`);
    }
    const archive = `filens-bench-${snapshot}.zip`;
    const bytes = await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' });
    await writeFile(path.join(destination, archive), bytes);
    sums.push(`${createHash('sha256').update(bytes).digest('hex')}  ${archive}`);
    await writeFile(path.join(destination, 'SHA256SUMS'), sums.join('\n') + '\n');
    for (const english of [false, true]) {
      const file = english ? 'en.html' : 'index.html';
      await writeFile(path.join(destination, file), page(data, '', english));
      if (snapshot === latest) await writeFile(path.join(output, file), page(data, `snapshots/${snapshot}/`, english));
    }
  }
  await writeFile(path.join(output, 'latest.json'), JSON.stringify({ snapshot: latest }, null, 2) + '\n');
  return output;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const output = process.argv[2] ? path.resolve(process.argv[2]) : undefined;
  console.log(`FiLens-Bench: ${await stageFilensBench(root, output)}`);
}
