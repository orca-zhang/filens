import { readFileSync } from 'node:fs';

const escape = value => String(value).replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);
const complete = pair => Number.isFinite(pair?.stock) && Number.isFinite(pair?.filens);
const logoFiles = {
  'WorkBuddy Desktop': 'workbuddy.png',
  'ZimaOS-Blue': 'zimaos-blue.png',
  'Codex CLI': 'codex.png',
  DSH: 'dsh.png',
  'OpenClaw CLI': 'openclaw.png',
  'OpenCode CLI': 'opencode.png',
  'Claude Code CLI': 'claude.png'
};
const logos = Object.fromEntries(Object.entries(logoFiles).map(([harness, filename]) => [
  harness,
  `data:image/png;base64,${readFileSync(new URL(`./assets/harness-logos/${filename}`, import.meta.url)).toString('base64')}`
]));

function renderEnglishChart(data) {
  const ordered = [...data.baselines].sort((a, b) =>
    b.metrics.complexQuality.stock - a.metrics.complexQuality.stock ||
    b.metrics.complexQuality.filens - a.metrics.complexQuality.filens);
  const colors = { stock: '#9baabb', filens: '#168f82' };
  const text = (x, y, value, size = 13, color = '#172a43', anchor = 'start', bold = false) =>
    `<text x="${x}" y="${y}" font-size="${size}" fill="${color}" text-anchor="${anchor}"${bold ? ' font-weight="700"' : ''}>${escape(value)}</text>`;
  const latency = row => row.metrics.complexElapsedSeconds
    ? { stock: row.metrics.complexElapsedSeconds.stockP50, filens: row.metrics.complexElapsedSeconds.filensP50 }
    : row.metrics.elapsedSeconds;
  const tokenPairs = ordered.map(row => row.metrics.allTaskTokens).filter(complete);
  const stats = [
    [`${ordered.filter(row => row.metrics.complexQuality.filens > row.metrics.complexQuality.stock).length}/${ordered.length}`, 'Quality improved'],
    [`${ordered.filter(row => complete(latency(row)) && latency(row).filens < latency(row).stock).length}/${ordered.filter(row => complete(latency(row))).length}`, 'Time fell'],
    [`${tokenPairs.filter(pair => pair.filens < pair.stock).length}/${tokenPairs.length}`, 'Tokens fell']
  ];
  const panels = [
    { id: 'quality', title: 'Complex-task quality', note: `${data.dataset.complexTasks} complex-file tasks · Higher is better`, values: row => row.metrics.complexQuality, max: 100, format: n => n.toFixed(1), tick: n => n.toFixed(0) },
    { id: 'p50', title: 'Complex-task latency p50', note: 'Seconds · Lower is better; WorkBuddy is one batch¹', values: latency, step: 20, format: n => `${n.toFixed(1)}s`, tick: n => `${n.toFixed(0)}s` },
    { id: 'p95', title: 'Complex-task latency p95', note: 'Seconds · Lower is better; WorkBuddy has no p95', values: row => {
      const m = row.metrics.complexElapsedSeconds;
      return m ? { stock: m.stockP95, filens: m.filensP95 } : undefined;
    }, step: 20, format: n => `${n.toFixed(1)}s`, tick: n => `${n.toFixed(0)}s` },
    { id: 'tokens', title: 'All-task token total', note: 'Input + output · Millions · * marks incomplete usage', values: row => row.metrics.allTaskTokens ?? row.metrics.allTaskTokensKnownSubtotal, step: 2000000, format: n => `${(n / 1000000).toFixed(2)}M`, tick: n => `${n / 1000000}M` }
  ];
  const panelsSvg = panels.map((panel, index) => {
    const left = index % 2 === 0 ? 40 : 1010, top = index < 2 ? 170 : 840;
    const width = 950, height = 650, values = ordered.map(panel.values);
    const observed = values.flatMap(pair => [pair?.stock, pair?.filens]).filter(Number.isFinite);
    const max = panel.max ?? Math.max(panel.step, Math.ceil(Math.max(...observed) / panel.step) * panel.step);
    const plotLeft = left + 58, plotWidth = width - 88, bottom = top + 510, plotTop = top + 183, plotHeight = bottom - plotTop;
    const grid = [0, max / 2, max].map(value => {
      const y = bottom - value / max * plotHeight;
      return `<line x1="${plotLeft}" y1="${y}" x2="${plotLeft + plotWidth}" y2="${y}" stroke="#dfe6ed"/>${text(left + 14, y + 4, panel.tick(value), 11, '#758399', 'start')}`;
    }).join('');
    const bars = ordered.map((row, i) => {
      const pair = values[i], center = plotLeft + plotWidth * (i + 0.5) / ordered.length;
      const incomplete = panel.id === 'tokens' && !complete(row.metrics.allTaskTokens);
      const label = row.harness.replace(' Desktop', '').replace(' CLI', '') + (row.metrics.elapsedSeconds ? '¹' : '');
      const logo = logos[row.harness];
      const mark = logo
        ? `<circle cx="${center}" cy="${top + 112}" r="19" fill="#fff" stroke="#dce4ea"/><image x="${center - 15}" y="${top + 97}" width="30" height="30" preserveAspectRatio="xMidYMid meet" xlink:href="${logo}"/>`
        : `<circle cx="${center}" cy="${top + 112}" r="19" fill="#fff" stroke="#dce4ea"/>${text(center, top + 119, 'Z', 21, '#5d6d80', 'middle', true)}`;
      const columns = ['stock', 'filens'].map((condition, j) => {
        const value = pair?.[condition], x = center - 31 + j * 34;
        if (!Number.isFinite(value)) return text(x + 14, bottom - 10, '—', 14, '#758399', 'middle');
        const barHeight = value / max * plotHeight, y = bottom - barHeight;
        const overlay = incomplete ? `<rect x="${x}" y="${y}" width="28" height="${barHeight}" rx="4" fill="url(#unknown)"/>` : '';
        return `<g data-condition="${condition}" data-value="${value}"><rect x="${x}" y="${y}" width="28" height="${barHeight}" rx="4" fill="${colors[condition]}"/>${overlay}${text(x + 14, y - 7, panel.format(value) + (incomplete ? '*' : ''), 11, '#172a43', 'middle', true)}</g>`;
      }).join('');
      let change = '—';
      let changeColor = '#758399';
      if (incomplete) change = 'Partial*';
      else if (complete(pair)) {
        const delta = pair.filens - pair.stock;
        change = panel.id === 'quality'
          ? `${delta > 0 ? '+' : ''}${delta.toFixed(1)} pts`
          : delta === 0 ? '0.0%' : `${delta < 0 ? '−' : '+'}${Math.abs(delta / pair.stock * 100).toFixed(1)}%`;
        const improved = panel.id === 'quality' ? delta > 0 : delta < 0;
        changeColor = improved ? '#168f82' : delta === 0 ? '#758399' : '#c25b5b';
      }
      return `<g data-harness="${escape(row.harness)}">${mark}${text(center, top + 153, label, 11, '#172a43', 'middle', true)}${columns}${text(center, bottom + 35, change, 11, changeColor, 'middle', true)}</g>`;
    }).join('');
    return `<g data-metric="${panel.id}"><rect x="${left}" y="${top}" width="${width}" height="${height}" rx="16" fill="#fff" stroke="#dfe6ed"/>${text(left + 24, top + 42, panel.title, 22, '#172a43', 'start', true)}${text(left + 24, top + 68, panel.note, 13, '#5d6d80')}${grid}${bars}</g>`;
  }).join('\n');
  return `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="2000" height="1660" viewBox="0 0 2000 1660" role="img" aria-labelledby="title desc" font-family="Arial,sans-serif">
<title id="title">FiLens-Bench · Vertical paired benchmark bars</title>
<desc id="desc">Four metric panels use vertical paired bars with a brand mark for each harness. Harnesses are sorted by native quality.</desc>
<defs><pattern id="unknown" width="7" height="7" patternUnits="userSpaceOnUse"><path d="M-2 2L2-2M0 7L7 0M5 9L9 5" stroke="#fff" stroke-width="1.5" opacity=".7"/></pattern></defs>
<rect width="100%" height="100%" fill="#f7f9fb"/>
${text(42, 40, 'FILENS-BENCH · CLI ' + data.dataset.filensCliVersion, 13, '#5d6d80')}
${text(42, 82, 'Complex-file search: quality, latency & tokens', 34, '#172a43', 'start', true)}
${text(42, 113, `${data.generatedAt} · Harnesses sorted by native quality`, 16, '#5d6d80')}
<rect x="42" y="136" width="14" height="14" rx="3" fill="${colors.stock}"/>${text(64, 148, 'Stock tools', 14, '#172a43')}
<rect x="174" y="136" width="14" height="14" rx="3" fill="${colors.filens}"/>${text(196, 148, 'FiLens enabled', 14, '#172a43')}
${stats.map(([value, label], i) => `<rect x="${1368 + i * 190}" y="28" width="174" height="82" rx="12" fill="#fff" stroke="#dfe6ed"/>${text(1385 + i * 190, 61, value, 25, '#168f82', 'start', true)}${text(1385 + i * 190, 88, label, 12, '#5d6d80')}`).join('')}
${panelsSvg}
${text(42, 1534, '* Hatched token bars are known subtotals only; missing usage is unknown.', 14, '#5d6d80')}
${text(42, 1567, '¹ WorkBuddy is one 13-task batch; Blue is one attempt per task and condition. Other CLIs usually repeat each task three times.', 14, '#5d6d80')}
${text(42, 1600, 'Small synthetic snapshot; models and routes differ. Compare paired changes within each harness. Costs are not priced.', 14, '#5d6d80')}
</svg>\n`;
}

// Keep the Chinese chart unchanged; the English page uses the branded vertical-bar layout.
export function renderSiteChart(data, english = false) {
  if (english) return renderEnglishChart(data);
  const t = (zh, en) => english ? en : zh;
  const ordered = [...data.baselines].sort((a, b) =>
    b.metrics.complexQuality.stock - a.metrics.complexQuality.stock ||
    b.metrics.complexQuality.filens - a.metrics.complexQuality.filens);
  const colors = { stock: '#c4ced8', filens: '#e5364b' };
  const text = (x, y, value, size = 12, color = '#172a43', anchor = 'start', bold = false) =>
    `<text x="${x}" y="${y}" font-size="${size}" fill="${color}" text-anchor="${anchor}"${bold ? ' font-weight="700"' : ''}>${escape(value)}</text>`;
  const latency = row => row.metrics.complexElapsedSeconds
    ? { stock: row.metrics.complexElapsedSeconds.stockP50, filens: row.metrics.complexElapsedSeconds.filensP50 }
    : row.metrics.elapsedSeconds;
  const tokens = ordered.map(row => row.metrics.allTaskTokens).filter(complete);
  const stats = [
    [`${ordered.filter(row => row.metrics.complexQuality.filens > row.metrics.complexQuality.stock).length}/${ordered.length}`, t('质量分提高', 'Quality improved')],
    [`${ordered.filter(row => complete(latency(row)) && latency(row).filens < latency(row).stock).length}/${ordered.filter(row => complete(latency(row))).length}`, t('记录耗时缩短', 'Measured time fell')],
    [`${tokens.filter(pair => pair.filens < pair.stock).length}/${tokens.length}`, t('完整 token 组下降', 'Complete token pairs fell')]
  ];
  const panels = [
    { id: 'quality', title: t('复杂题质量', 'Complex-task quality'), note: t(`${data.dataset.complexTasks} 道复杂文件题 · 分数越高越好`, `${data.dataset.complexTasks} complex-file tasks · Higher is better`), values: row => row.metrics.complexQuality, max: 100, format: n => n.toFixed(1), tick: n => n.toFixed(0) },
    { id: 'p50', title: t('复杂题耗时 p50 / 整批', 'Complex-task p50 / batch time'), note: t('秒 · 越低越好；WorkBuddy 为整批用时¹', 'Seconds · Lower is better; WorkBuddy is a whole batch¹'), values: latency, step: 20, format: n => `${n.toFixed(1)}s`, tick: n => n.toFixed(0) },
    { id: 'p95', title: t('复杂题耗时 p95', 'Complex-task p95 latency'), note: t('秒 · 越低越好；WorkBuddy 单批无 p95', 'Seconds · Lower is better; no p95 for WorkBuddy'), values: row => {
      const m = row.metrics.complexElapsedSeconds;
      return m ? { stock: m.stockP95, filens: m.filensP95 } : undefined;
    }, step: 20, format: n => `${n.toFixed(1)}s`, tick: n => n.toFixed(0) },
    { id: 'tokens', title: t('全题 token 总量', 'All-task tokens'), note: t('输入 + 输出 · 百万 token · * 为不完整小计', 'Input + output · Millions · * Incomplete subtotals'), values: row => row.metrics.allTaskTokens ?? row.metrics.allTaskTokensKnownSubtotal, step: 2000000, format: n => `${(n / 1000000).toFixed(2)}M`, tick: n => `${n / 1000000}M` }
  ];
  const charts = panels.map((panel, index) => {
    const left = 44 + (index % 2) * 768, top = 166 + Math.floor(index / 2) * 404;
    const plotLeft = left + 50, plotWidth = 650, bottom = top + 300, plotHeight = 204;
    const values = ordered.map(panel.values);
    const max = panel.max ?? Math.max(panel.step, Math.ceil(Math.max(...values.flatMap(pair => [pair?.stock, pair?.filens]).filter(Number.isFinite)) / panel.step) * panel.step);
    const grid = [0, max / 2, max].map(value => {
      const y = bottom - value / max * plotHeight;
      return `<line x1="${plotLeft}" y1="${y}" x2="${plotLeft + plotWidth}" y2="${y}" stroke="#dfe6ed"/>${text(left + 14, y + 4, panel.tick(value), 10, '#5d6d80')}`;
    }).join('');
    const bars = ordered.map((row, i) => {
      const pair = values[i], center = plotLeft + plotWidth * (i + 0.5) / ordered.length;
      const incomplete = panel.id === 'tokens' && !complete(row.metrics.allTaskTokens);
      const name = row.harness.replace(' Desktop', '').replace(' CLI', '') + (row.metrics.elapsedSeconds ? '¹' : '');
      const columns = ['stock', 'filens'].map((condition, j) => {
        const value = pair?.[condition], x = center - 26 + j * 29;
        if (!Number.isFinite(value)) return text(x + 11, bottom - 10, '—', 13, '#5d6d80', 'middle');
        const height = value / max * plotHeight, y = bottom - height;
        return `<g data-condition="${condition}" data-value="${value}"><rect x="${x}" y="${y}" width="22" height="${height}" rx="4" fill="${colors[condition]}"/>${incomplete ? `<rect x="${x}" y="${y}" width="22" height="${height}" rx="4" fill="url(#unknown)"/>` : ''}${text(x + 11, y - 7, panel.format(value) + (incomplete ? '*' : ''), 9, '#172a43', 'middle')}</g>`;
      }).join('');
      let change = '—';
      if (incomplete) change = t('不完整*', 'Incomplete*');
      else if (complete(pair)) {
        const delta = pair.filens - pair.stock;
        change = panel.id === 'quality'
          ? `${delta > 0 ? '+' : ''}${delta.toFixed(1)}${t(' 分', ' pts')}`
          : delta === 0 ? '0.0%'
            : pair.stock > 0 ? `${delta < 0 ? '↓' : '↑'}${Math.abs(delta / pair.stock * 100).toFixed(1)}%` : '—';
      }
      return `<g data-harness="${escape(row.harness)}">${columns}${text(center, bottom + 23, name, 10.5, '#172a43', 'middle', true)}${text(center, bottom + 46, change, 11, '#e5364b', 'middle', true)}</g>`;
    }).join('');
    return `<g data-metric="${panel.id}"><rect x="${left}" y="${top}" width="744" height="386" rx="15" fill="#fff" stroke="#dde5ec"/>${text(left + 22, top + 34, panel.title, 20, '#172a43', 'start', true)}${text(left + 22, top + 57, panel.note, 12, '#5d6d80')}${grid}${bars}</g>`;
  }).join('\n');
  return `<svg xmlns="http://www.w3.org/2000/svg" width="1600" height="1110" viewBox="0 0 1600 1110" role="img" aria-labelledby="title desc" font-family="Arial,sans-serif">
<title id="title">${escape(t('FiLens-Bench · 官网四面板配对成绩', 'FiLens-Bench · Four-panel paired results'))}</title>
<desc id="desc">${escape(t(`${ordered.length} 个 harness 的质量、p50 / 整批耗时、p95 与 token 分组柱状图。星号表示用量不完整，不计算节省率。`, `Grouped bars for quality, p50 / batch time, p95 and tokens across ${ordered.length} harnesses. Asterisks mark incomplete usage; savings are not calculated.`))}</desc>
<defs><pattern id="unknown" width="7" height="7" patternUnits="userSpaceOnUse"><path d="M-2 2L2-2M0 7L7 0M5 9L9 5" stroke="#fff" stroke-width="1.5" opacity=".65"/></pattern></defs>
<rect width="100%" height="100%" fill="#fbfcfd"/>
${text(48, 39, 'FILENS · BENCHMARK REPORT', 12, '#73849a')}
${text(48, 82, `FiLens-Bench · FiLens CLI ${data.dataset.filensCliVersion}`, 31, '#172a43', 'start', true)}
${text(48, 113, t(`${data.generatedAt} · 按原生质量分降序 · 比较同一 harness 安装前后的变化`, `${data.generatedAt} · Native quality descending · Compare within each harness`), 15, '#5d6d80')}
${stats.map(([value, label], i) => `<rect x="${1042 + i * 172}" y="28" width="160" height="88" rx="12" fill="#fff" stroke="#e1e7ed"/>${text(1060 + i * 172, 57, value, 25, '#e5364b', 'start', true)}${text(1060 + i * 172, 82, label, 11, '#5d6d80')}`).join('')}
<rect x="50" y="133" width="13" height="13" rx="3" fill="${colors.stock}"/>${text(70, 144, t('原生工具', 'Stock tools'))}
<rect x="176" y="133" width="13" height="13" rx="3" fill="${colors.filens}"/>${text(196, 144, 'FiLens')}
${charts}
${text(48, 1005, t(`* 缺失用量按未知处理；斜线柱只显示已知小计，不计算节省率。用量完整的 ${tokens.length} 组中，${tokens.filter(pair => pair.filens < pair.stock).length} 组 token 下降。`, `* Hatched bars show known subtotals only; missing usage is unknown. Tokens fell in ${tokens.filter(pair => pair.filens < pair.stock).length}/${tokens.length} complete-usage pairs.`), 14, '#5d6d80')}
${text(48, 1035, t('¹ WorkBuddy 每组仅一批 13 题；Blue 每题每组仅测一次，其余 CLI 每题每组通常重复三次。', '¹ WorkBuddy: one 13-task batch per condition. Blue: one attempt per task and condition. Other CLIs: usually three repetitions.'), 14, '#5d6d80')}
${text(48, 1065, t('小型合成题集快照；不同模型与路由不作严格排名，请比较同一 harness 内变化。金额未计价。', 'Small synthetic snapshot; models and routes differ. Compare paired changes within each harness. Monetary amounts are not priced.'), 14, '#5d6d80')}
</svg>\n`;
}
