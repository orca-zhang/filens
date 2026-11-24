import assert from 'node:assert/strict';

const count = value => Number.isInteger(value) && value >= 0 ? value : null;
const csv = rows => rows.map(row => row.map(value => `"${String(value ?? '').replaceAll('"', '""')}"`).join(',')).join('\n') + '\n';
const display = value => value === null ? '未知' : value.toLocaleString('en-US');
const displayTotal = value => value.total === null ? `${display(value.knownSubtotal)}*` : display(value.total);

export function ledger(report, manifest) {
  const entries = report.observations.map(row => {
    const input = count(row.usage?.input_tokens), cached = count(row.usage?.cached_input_tokens), writes = count(row.usage?.cache_write_input_tokens);
    const output = count(row.usage?.output_tokens), reasoning = count(row.usage?.reasoning_output_tokens);
    if (input !== null && cached !== null && writes !== null) assert.ok(cached + writes <= input, `Cache tokens exceed total input: ${row.taskId}`);
    if (output !== null && reasoning !== null) assert.ok(reasoning <= output, `Reasoning tokens exceed total output: ${row.taskId}`);
    return { attemptId: `${row.system}/${row.condition}/${row.taskId}/${row.repeat + 1}`, system: row.system, harness: row.harness, model: row.model,
      condition: row.condition, taskId: row.taskId, track: manifest.tasks.find(task => task.id === row.taskId)?.track ?? 'calibration', repeat: row.repeat + 1,
      elapsedMs: row.elapsedMs, operational: row.operational, quality: row.score?.quality ?? null, success: row.score?.success ?? null, toolCalls: row.toolCalls,
      inputTokens: input, cachedInputTokens: cached, cacheWriteInputTokens: writes,
      uncachedInputTokens: input !== null && cached !== null && writes !== null ? input - cached - writes : null,
      outputTokens: output, reasoningOutputTokens: reasoning, totalTokens: input !== null && output !== null ? input + output : null,
      amount: null, pricingStatus: 'unpriced', reportedUsage: row.usage ?? null };
  });
  const fields = ['inputTokens', 'cachedInputTokens', 'cacheWriteInputTokens', 'uncachedInputTokens', 'outputTokens', 'reasoningOutputTokens', 'totalTokens'];
  const summarize = rows => {
    const successes = rows.filter(row => row.success).length;
    const totals = Object.fromEntries(fields.map(field => [field, {
      total: rows.every(row => row[field] !== null) ? rows.reduce((sum, row) => sum + row[field], 0) : null,
      knownSubtotal: rows.reduce((sum, row) => sum + (row[field] ?? 0), 0), unknownAttempts: rows.filter(row => row[field] === null).length,
    }]));
    return { attempts: rows.length, successes,
      elapsedMs: rows.every(row => Number.isFinite(row.elapsedMs)) ? rows.reduce((sum, row) => sum + row.elapsedMs, 0) : null,
      knownElapsedMs: rows.reduce((sum, row) => sum + (Number.isFinite(row.elapsedMs) ? row.elapsedMs : 0), 0), totals,
      tokensPerSuccessfulTask: successes && totals.totalTokens.total !== null ? totals.totalTokens.total / successes : null,
      amount: null, pricingStatus: 'unpriced' };
  };
  const groups = Object.fromEntries([...new Set(entries.map(row => `${row.system}/${row.condition}`))].map(key => [key, summarize(entries.filter(row => `${row.system}/${row.condition}` === key))]));
  const primaryGroups = Object.fromEntries(Object.keys(groups).map(key => [key, summarize(entries.filter(row => `${row.system}/${row.condition}` === key && row.track === 'complex'))]));
  const result = { schema: 'filens-bench-ledger-v1', scope: 'All attempts in the supplied run, including controls and failures. Amounts intentionally unpriced.',
    accounting: 'Input includes cache reads/writes; output includes reasoning. Total = input + output. Cache and reasoning columns are subsets, never added again. Unknown usage is not zero.',
    summary: summarize(entries), groups, primaryGroups, entries };
  const headers = ['attemptId', 'system', 'harness', 'model', 'condition', 'taskId', 'track', 'repeat', 'elapsedMs', 'operational', 'quality', 'success', 'toolCalls', ...fields, 'amount', 'pricingStatus'];
  const lines = ['# FiLens-Bench 用量明细账单', '', '金额按用户要求暂不计价。以下用量来自 harness 实际报告，包含评分运行中的全部题目、控制题、失败与超时；预检和校准另列。', '',
    '输入已包含缓存读取/写入，输出已包含推理 token；合计只计算输入 + 输出。未知用量不是零；总量未知时同时保留已知小计。', '',
    '| 配置 | 尝试数 | 输入 | 缓存输入 | 缓存写入 | 非缓存输入 | 输出 | 推理（输出子集） | 合计 | 用量未知次数 | 每次成功任务 token | 金额 |',
    '| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | --- |'];
  for (const [key, group] of Object.entries(groups)) lines.push(`| ${key} | ${group.attempts} | ${fields.map(field => displayTotal(group.totals[field])).join(' | ')} | ${group.totals.totalTokens.unknownAttempts} | ${group.tokensPerSuccessfulTask === null ? '未知' : display(Math.round(group.tokensPerSuccessfulTask))} | 未计价 |`);
  if (entries.some(row => row.track === 'complex')) {
    lines.push('', '## 复杂文件题 token 对比', '', '与评分主榜同范围，不含纯文本控制题。变化 = 安装后 / 原生 − 1；正值表示消耗增加。', '',
      '| Harness | 原生输入小计 | FiLens 输入小计 | 输入变化 | 原生输出小计 | FiLens 输出小计 | 原生合计小计 | FiLens 合计小计 | 合计变化 | 用量未知（原生 / FiLens） |',
      '| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |');
    const change = (a, b) => a === null || b === null || a === 0 ? '未知' : `${b >= a ? '+' : ''}${((b / a - 1) * 100).toFixed(1)}%`;
    for (const system of new Set(entries.map(row => row.system))) {
      const a = primaryGroups[`${system}/stock`]?.totals, b = primaryGroups[`${system}/filens`]?.totals;
      if (!a || !b) continue;
      lines.push(`| ${entries.find(row => row.system === system).harness} | ${displayTotal(a.inputTokens)} | ${displayTotal(b.inputTokens)} | ${change(a.inputTokens.total, b.inputTokens.total)} | ${displayTotal(a.outputTokens)} | ${displayTotal(b.outputTokens)} | ${displayTotal(a.totalTokens)} | ${displayTotal(b.totalTokens)} | ${change(a.totalTokens.total, b.totalTokens.total)} | ${a.totalTokens.unknownAttempts} / ${b.totalTokens.unknownAttempts} |`);
    }
  }
  lines.push('', '* 带星号的数字是已知用量小计；未知次数没有 harness 用量报告（例如被外层超时终止），不按文本长度估算。逐次执行的题目、组别、轮次、成绩、耗时、工具调用和所有 token 分项见 [ledger.csv](ledger.csv)；原始报告值及未知用量覆盖情况见 [ledger.json](ledger.json)。', '',
    'Codex CLI 提供每次答题 turn 的合计用量，不提供其中每次模型 HTTP 请求的分项；dsh 的答题用量由逐步报告累加。明细不根据字符数估算缺失 token。', '');
  return { data: result, csv: csv([headers, ...entries.map(row => headers.map(field => row[field]))]), markdown: lines.join('\n') };
}
