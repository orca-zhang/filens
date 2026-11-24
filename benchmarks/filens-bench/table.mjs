import { mean, quantile } from '../../scripts/search-benchmark-metrics.mjs';

const number = value => value === null || value === undefined ? '—' : value.toFixed(1);
const percent = value => value === null || value === undefined ? '—' : `${number(value * 100)}%`;
const seconds = value => value === null || value === undefined ? '—' : `${number(value / 1000)}s`;
const cell = value => String(value).replaceAll('|', '\\|').replaceAll('\n', ' ');
const csv = rows => rows.map(row => row.map(value => `"${String(value ?? '').replaceAll('"', '""')}"`).join(',')).join('\n') + '\n';
const label = condition => condition === 'stock' ? '原生环境' : '正常安装 FiLens';
const harnessKey = name => String(name).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
const harnessLabel = name => ({ codex: 'Codex', dsh: 'DSH', claude: 'Claude / Claude Code', 'claude-code': 'Claude / Claude Code', zcode: 'zcode', workbuddy: 'WorkBuddy', openclaw: 'OpenClaw' })[harnessKey(name)] ?? name;
const plannedHarnesses = [
  { aliases: ['codex'], label: 'Codex' }, { aliases: ['dsh'], label: 'DSH' },
  { aliases: ['claude', 'claude-code'], label: 'Claude / Claude Code' },
  { aliases: ['zcode'], label: 'zcode' }, { aliases: ['workbuddy'], label: 'WorkBuddy' },
  { aliases: ['openclaw'], label: 'OpenClaw' },
];

export function tables(report, manifest) {
  const configurations = Object.values(report.summary);
  const hasPairedConditions = Object.hasOwn(report.matrix, 'stock') && Object.hasOwn(report.matrix, 'filens');
  const singleCondition = Object.keys(report.matrix)[0];
  const systems = [...new Set(configurations.map(row => row.system))];
  const names = systems.map(system => configurations.find(row => row.system === system).harness);
  const actualColumns = systems.map(system => {
    const name = configurations.find(row => row.system === system).harness;
    const rank = plannedHarnesses.findIndex(harness => harness.aliases.includes(harnessKey(name)));
    return { system, name: harnessLabel(name), rank: rank < 0 ? plannedHarnesses.length : rank };
  }).sort((a, b) => a.rank - b.rank || a.name.localeCompare(b.name));
  const columns = [], placed = new Set();
  for (const harness of plannedHarnesses) {
    const matches = actualColumns.filter(column => harness.aliases.includes(harnessKey(configurations.find(row => row.system === column.system).harness)));
    if (matches.length) {
      columns.push(...matches.map(({ system, name }) => ({ system, name })));
      matches.forEach(column => placed.add(column.system));
    } else columns.push({ system: null, name: harness.label });
  }
  columns.push(...actualColumns.filter(column => !placed.has(column.system)).map(({ system, name }) => ({ system, name })));
  const lines = [report.provisional ? '# FiLens-Bench 阶段评分表' : hasPairedConditions ? '# FiLens-Bench 评分表' : '# FiLens-Bench 单组评分表', '',
    ...(report.provisional ? [`阶段结果：当前 ${report.expectedTaskIds.length}/${report.plannedTasks} 题，已完成题目各 ${report.expectedRepeats} 次；正式目标每题 ${report.plannedRepeats} 次，后续结果仍会变化。`, ''] : []),
    ...(!hasPairedConditions ? [`本报告只包含${label(singleCondition)}数据，不含另一组；不计算配对差值。`, ''] : []),
    `模型：${cell(report.model)}；推理设置：${cell(report.reasoningEffort)}；每题重复 ${report.expectedRepeats} 次；截止时间 ${seconds(report.budgetMs)}。`, '',
    '主榜只统计复杂文件题。格内依次为 **质量分 / 带证据成功率 / p50 耗时**；未测试的 harness 留空，不记作零分。', '',
    `| 使用环境 | ${columns.map(column => cell(column.name)).join(' | ')} |`, `| --- | ${columns.map(() => '---:').join(' | ')} |`];
  for (const condition of ['stock', 'filens']) lines.push(`| ${label(condition)} | ${columns.map(({ system }) => {
    const row = report.matrix[condition]?.[system];
    return row ? `${number(row.quality)} / ${percent(row.successRate)} / ${seconds(row.latency.p50Ms)}` : '未测试';
  }).join(' | ')} |`);
  lines.push('', '## 详细成绩', '', '| Harness | 环境 | 尝试数 | 质量分 | 字段准确率 | 带证据成功率 | 预算内成功分 | p50 | p95 | 执行失败 |', '| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |');
  for (const row of configurations) lines.push(`| ${cell(row.harness)} | ${label(row.condition)} | ${row.attempts} | ${number(row.quality)} | ${percent(row.accuracy)} | ${percent(row.successRate)} | ${number(row.scoreAtBudget)} | ${seconds(row.latency.p50Ms)} | ${seconds(row.latency.p95Ms)} | ${row.operationalFailures} |`);
  if (hasPairedConditions) {
    lines.push('', '## 安装后的配对变化', '', '| Harness | 质量变化 | 成功率变化 | 双方答对的配对数 | 双方答对时速度倍数 |', '| --- | ---: | ---: | ---: | ---: |');
    for (const system of systems) {
      const pair = report.pairs.find(pair => pair.first === `${system}/stock` && pair.second === `${system}/filens`);
      if (pair) lines.push(`| ${cell(configurations.find(row => row.system === system).harness)} | ${number(pair.qualityGainSecondMinusFirst)} 分 | ${number(pair.successGainSecondMinusFirst * 100)} pp | ${pair.bothCorrect} | ${number(pair.medianSpeedupFirstOverSecond)}× |`);
    }
    lines.push('', '速度倍数 = 原生耗时 / 安装后耗时，大于 1 表示安装后更快；只计算双方都带证据答对的配对。');
  }
  lines.push('', '## 纯文本控制题', '', '| Harness | 环境 | 尝试数 | 质量分 | 带证据成功率 | p50 |', '| --- | --- | ---: | ---: | ---: | ---: |');
  for (const row of configurations) lines.push(`| ${cell(row.harness)} | ${label(row.condition)} | ${row.textControls.attempts} | ${number(row.textControls.quality)} | ${percent(row.textControls.successRate)} | ${seconds(row.textControls.latency.p50Ms)} |`);
  const taskRows = [];
  lines.push('', '## 逐题成绩', '');
  lines.push(hasPairedConditions
    ? '| Harness | 题目 | 原生质量分 | 安装后质量分 | 原生成功次数 | 安装后成功次数 | 原生 p50 | 安装后 p50 |'
    : '| Harness | 题目 | 环境 | 质量分 | 带证据成功次数 | p50 |');
  lines.push(hasPairedConditions ? '| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: |' : '| --- | --- | --- | ---: | ---: | ---: |');
  for (const system of systems) for (const taskId of report.expectedTaskIds) {
    const rows = report.observations.filter(row => row.system === system && row.taskId === taskId);
    const group = condition => {
      const subset = rows.filter(row => row.condition === condition);
      return { quality: subset.length ? mean(subset.map(row => row.score.quality)) : null, successes: subset.length ? subset.filter(row => row.score.success).length : null, attempts: subset.length, p50Ms: quantile(subset.map(row => row.elapsedMs), .5) };
    };
    const a = group('stock'), b = group('filens'), harness = configurations.find(row => row.system === system).harness;
    if (hasPairedConditions) lines.push(`| ${cell(harness)} | ${cell(taskId)} | ${number(a.quality)} | ${number(b.quality)} | ${a.attempts ? `${a.successes}/${a.attempts}` : '—'} | ${b.attempts ? `${b.successes}/${b.attempts}` : '—'} | ${seconds(a.p50Ms)} | ${seconds(b.p50Ms)} |`);
    else {
      const result = group(singleCondition);
      lines.push(`| ${cell(harness)} | ${cell(taskId)} | ${label(singleCondition)} | ${number(result.quality)} | ${result.attempts ? `${result.successes}/${result.attempts}` : '—'} | ${seconds(result.p50Ms)} |`);
    }
    taskRows.push([system, harness, taskId, manifest.tasks.find(task => task.id === taskId)?.track, a.quality, b.quality, a.successes, a.attempts, b.successes, b.attempts, a.p50Ms, b.p50Ms]);
  }
  lines.push('', '质量分 = 70% 字段准确率 + 30% 证据 F1；任务成功要求答案全部正确且证据完整。无答案题须明确拒答。所有失败、格式错误和超时均保留在分母。', '',
    'Token 对比与逐次用量见 [明细账单](billing.md)；输入、缓存、输出分别列出，金额暂不计价。', '',
    hasPairedConditions
      ? '这是合成种子集的本机实测，小样本结果不代表通用 agent 排名。两组使用相同用户题目，允许 agent 自主发现和选择工具。'
      : '这是合成种子集的本机单组实测，小样本结果不代表通用 agent 排名。本报告不含原生对照。', '');
  const matrixCSV = csv([['system', 'harness', 'condition', 'model', 'attempts', 'quality', 'accuracy', 'successRate', 'scoreAtBudget', 'p50Ms', 'p95Ms', 'operationalFailures', 'meanInputTokens', 'meanOutputTokens', 'meanToolCalls'],
    ...configurations.map(row => [row.system, row.harness, row.condition, row.model, row.attempts, row.quality, row.accuracy, row.successRate, row.scoreAtBudget, row.latency.p50Ms, row.latency.p95Ms, row.operationalFailures, row.meanInputTokens, row.meanOutputTokens, row.meanToolCalls])]);
  return { markdown: lines.join('\n'), matrixCSV, taskCSV: csv([['system', 'harness', 'taskId', 'track', 'stockQuality', 'filensQuality', 'stockSuccesses', 'stockAttempts', 'filensSuccesses', 'filensAttempts', 'stockP50Ms', 'filensP50Ms'], ...taskRows]) };
}
