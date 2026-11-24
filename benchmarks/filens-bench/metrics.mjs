import assert from 'node:assert/strict';
import { mean, metrics, quantile } from '../../scripts/search-benchmark-metrics.mjs';

export const answerSchema = {
  type: 'object', additionalProperties: false, required: ['status', 'answers', 'citations'],
  properties: {
    status: { type: 'string', enum: ['answered', 'not_found', 'insufficient_evidence'] },
    answers: { type: 'array', items: { type: 'object', additionalProperties: false, required: ['key', 'value'], properties: { key: { type: 'string' }, value: { type: 'string' } } } },
    citations: { type: 'array', items: { type: 'object', additionalProperties: false, required: ['source', 'quote'], properties: { source: { type: 'string' }, quote: { type: 'string' } } } },
  },
};
const normalize = value => String(value).normalize('NFKC').replace(/\s+/gu, ' ').trim();
// OCR and rendered text can differ only in spacing (for example, before a Chinese unit).
// Citation matching is whitespace-insensitive while preserving all non-whitespace characters.
const normalizeCitation = value => String(value).normalize('NFKC').replace(/\s/gu, '');
export function validAnswer(value) {
  return value && Object.keys(value).sort().join() === 'answers,citations,status' &&
    ['answered', 'not_found', 'insufficient_evidence'].includes(value.status) &&
    Array.isArray(value.answers) && value.answers.every(item => item && Object.keys(item).sort().join() === 'key,value' && typeof item.key === 'string' && typeof item.value === 'string') &&
    Array.isArray(value.citations) && value.citations.every(item => item && Object.keys(item).sort().join() === 'quote,source' && typeof item.source === 'string' && typeof item.quote === 'string') &&
    new Set(value.answers.map(item => item.key)).size === value.answers.length;
}
export function extractJsonObject(text, accept = () => true) {
  const source = String(text);
  let result = null;
  for (let start = source.indexOf('{'); start >= 0; start = source.indexOf('{', start + 1)) {
    let depth = 0, inString = false, escaped = false;
    for (let i = start; i < source.length; i++) {
      const char = source[i];
      if (inString) {
        if (escaped) escaped = false;
        else if (char === '\\') escaped = true;
        else if (char === '"') inString = false;
      } else if (char === '"') inString = true;
      else if (char === '{') depth++;
      else if (char === '}' && --depth === 0) {
        try {
          const candidate = JSON.parse(source.slice(start, i + 1));
          if (candidate && !Array.isArray(candidate) && accept(candidate)) result = candidate;
        } catch {}
        break;
      }
    }
  }
  return result;
}
export function scoreAnswer(task, response, documents, operational = true) {
  const zero = { accuracy: 0, evidencePrecision: 0, evidenceRecall: 0, quality: 0, success: false };
  if (!operational || !validAnswer(response)) return { ...zero, protocolValid: validAnswer(response) === true };
  const entries = Object.entries(task.answers);
  if (!entries.length) {
    const correct = response.status === 'not_found' && !response.answers.length && !response.citations.length;
    return { accuracy: Number(correct), evidencePrecision: null, evidenceRecall: null, quality: correct ? 100 : 0, success: correct, protocolValid: true };
  }
  const supplied = new Map(response.answers.map(item => [item.key, item.value]));
  const accuracy = response.status === 'answered' ? entries.filter(([key, value]) => normalize(supplied.get(key) ?? '') === normalize(value)).length / Math.max(entries.length, supplied.size) : 0;
  const valid = response.citations.filter(citation => {
    const doc = documents.find(doc => doc.source === citation.source);
    const quote = normalizeCitation(citation.quote);
    return doc && quote.length > 0 && normalizeCitation(doc.text).includes(quote) &&
      task.evidence.some(proof => proof.source === citation.source && quote.includes(normalizeCitation(proof.anchor)));
  });
  const precision = response.citations.length ? valid.length / response.citations.length : 0;
  const recall = task.evidence.filter(proof => valid.some(citation => citation.source === proof.source && normalizeCitation(citation.quote).includes(normalizeCitation(proof.anchor)))).length / task.evidence.length;
  const f1 = precision + recall ? 2 * precision * recall / (precision + recall) : 0;
  return { accuracy, evidencePrecision: precision, evidenceRecall: recall, quality: 100 * (.7 * accuracy + .3 * f1),
    success: accuracy === 1 && precision === 1 && recall === 1, protocolValid: true };
}
export function validateRows(rows, manifest) {
  const keys = new Set();
  for (const row of rows) {
    for (const key of ['system', 'harness', 'harnessVersion', 'model', 'reasoningEffort']) assert.ok(typeof row[key] === 'string' && row[key].length > 0, `Missing identity: ${key}`);
    assert.ok(manifest.tasks.some(task => task.id === row.taskId), `Unknown task: ${row.taskId}`);
    assert.ok(typeof row.condition === 'string' && row.condition.length > 0);
    assert.ok(Number.isInteger(row.repeat) && row.repeat >= 0);
    assert.ok(Number.isFinite(row.elapsedMs) && row.elapsedMs >= 0);
    assert.ok(typeof row.operational === 'boolean');
    const key = JSON.stringify([row.system, row.condition, row.taskId, row.repeat]);
    assert.ok(!keys.has(key), `Duplicate observation: ${key}`);
    keys.add(key);
  }
  for (const system of new Set(rows.map(row => row.system))) {
    const identities = rows.filter(row => row.system === system).map(row => JSON.stringify([row.harness, row.harnessVersion, row.model, row.reasoningEffort]));
    assert.equal(new Set(identities).size, 1, `Inconsistent identity: ${system}`);
  }
}
export const latency = rows => ({ n: rows.length, p50Ms: quantile(rows.map(row => row.elapsedMs), .5), p95Ms: quantile(rows.map(row => row.elapsedMs), .95) });
export function scoreRows(rows, manifest, budgetMs = 120000, expectedRepeats = 1, conditions = ['stock', 'filens']) {
  validateRows(rows, manifest);
  assert.ok(rows.length > 0, 'No observations');
  assert.equal(new Set(rows.map(row => row.model)).size, 1, 'Main matrix requires one fixed model; score other models separately');
  assert.equal(new Set(rows.map(row => row.reasoningEffort)).size, 1, 'Main matrix requires one reasoning setting');
  assert.ok(rows.every(row => conditions.includes(row.condition) && row.repeat < expectedRepeats), 'Observation outside declared schedule');
  const systems = [...new Set(rows.map(row => row.system))];
  for (const system of systems) for (const condition of conditions) for (const task of manifest.tasks) for (let repeat = 0; repeat < expectedRepeats; repeat++) {
    assert.ok(rows.some(row => row.system === system && row.condition === condition && row.taskId === task.id && row.repeat === repeat), `Missing observation: ${system}/${condition}/${task.id}/${repeat}; retain failures as operational:false`);
  }
  const scored = rows.map(row => ({ ...row, score: scoreAnswer(manifest.tasks.find(task => task.id === row.taskId), row.response, manifest.documents, row.operational) }));
  const configurations = systems.flatMap(system => conditions.map(condition => ({ system, condition, key: `${system}/${condition}` })));
  const summary = Object.fromEntries(configurations.map(({ system, condition, key }) => {
    const group = scored.filter(row => row.system === system && row.condition === condition);
    const summarize = subset => ({ attempts: subset.length, quality: mean(subset.map(row => row.score.quality)), accuracy: mean(subset.map(row => row.score.accuracy)),
      evidencePrecision: mean(subset.map(row => row.score.evidencePrecision).filter(value => value !== null)), evidenceRecall: mean(subset.map(row => row.score.evidenceRecall).filter(value => value !== null)),
      successRate: mean(subset.map(row => Number(row.score.success))), scoreAtBudget: 100 * mean(subset.map(row => Number(row.score.success && row.elapsedMs <= budgetMs))),
      operationalFailures: subset.filter(row => !row.operational).length, protocolFailures: subset.filter(row => !row.score.protocolValid).length, latency: latency(subset),
      meanToolCalls: mean(subset.map(row => row.toolCalls).filter(Number.isFinite)),
      meanInputTokens: mean(subset.map(row => row.usage?.input_tokens).filter(Number.isFinite)), meanOutputTokens: mean(subset.map(row => row.usage?.output_tokens).filter(Number.isFinite)),
      successesPerMinute: subset.filter(row => row.score.success).length * 60000 / Math.max(1, subset.reduce((sum, row) => sum + row.elapsedMs, 0)) });
    const { harness, harnessVersion, model, reasoningEffort } = group[0];
    const primary = group.filter(row => manifest.tasks.find(task => task.id === row.taskId).track !== 'text-control');
    const controls = group.filter(row => manifest.tasks.find(task => task.id === row.taskId).track === 'text-control');
    return [key, { system, condition, harness, harnessVersion, model, reasoningEffort,
      scope: primary.length ? 'complex-files' : 'text-control-only', ...summarize(primary.length ? primary : controls),
      totalMeasuredMs: group.reduce((sum, row) => sum + row.elapsedMs, 0),
      allTasks: summarize(group), textControls: summarize(controls),
      families: Object.fromEntries([...new Set(manifest.tasks.map(task => task.family))].map(family => [family, summarize(group.filter(row => manifest.tasks.find(task => task.id === row.taskId).family === family))])) }];
  }));
  const pairs = [];
  for (const [i, first] of configurations.entries()) for (const second of configurations.slice(i + 1)) {
    if (first.system !== second.system && first.condition !== second.condition) continue;
    const usePrimary = manifest.tasks.some(task => task.track !== 'text-control');
    const paired = scored.filter(row => row.system === first.system && row.condition === first.condition && (!usePrimary || manifest.tasks.find(task => task.id === row.taskId).track !== 'text-control')).flatMap(a => {
      const b = scored.find(row => row.system === second.system && row.condition === second.condition && row.taskId === a.taskId && row.repeat === a.repeat);
      return b ? [{ a, b }] : [];
    });
    const bothCorrect = paired.filter(({ a, b }) => a.score.success && b.score.success);
    pairs.push({ first: first.key, second: second.key, comparison: first.system === second.system ? 'within-system' : 'across-systems', pairedAttempts: paired.length, qualityGainSecondMinusFirst: mean(paired.map(({ a, b }) => b.score.quality - a.score.quality)),
      successGainSecondMinusFirst: mean(paired.map(({ a, b }) => Number(b.score.success) - Number(a.score.success))),
      bothCorrect: bothCorrect.length, medianSpeedupFirstOverSecond: quantile(bothCorrect.filter(({ b }) => b.elapsedMs > 0).map(({ a, b }) => a.elapsedMs / b.elapsedMs), .5) });
  }
  const matrix = Object.fromEntries(conditions.map(condition => [condition, Object.fromEntries(systems.map(system => [system, summary[`${system}/${condition}`]]))]));
  return { model: rows[0].model, reasoningEffort: rows[0].reasoningEffort, budgetMs, expectedRepeats, expectedTaskIds: manifest.tasks.map(task => task.id), matrix, summary, pairs, observations: scored };
}
export function retrievalMetrics(found, task, complete) {
  // Incomplete requests retain diagnostic hits but receive zero retrieval credit.
  if (!complete && !task.retrieval.relevant.length) return { empty: false, falsePositive: found.length > 0 };
  return metrics(complete ? found : [], task.retrieval.relevant, false);
}
