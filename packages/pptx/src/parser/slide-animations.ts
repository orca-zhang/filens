import type { ChartItem, SlideAnimationStep, SlideChartAnimationTarget, SlideItem, SlideObjectAnimation } from '@filens/core/presentation-support';
import { childElements, children, slideRoot, type OrderedXmlNode, type XmlElement } from './xml';

const first = (node: XmlElement, name: string) => children(node, name)[0] as XmlElement | undefined;
const members = (node: XmlElement, list: string) => {
  const container = first(node, list);
  return container ? childElements(container).filter(child => child.namespace === node.namespace) : [];
};
const time = (value: unknown) => typeof value === 'string' && /^\d+$/.test(value) && Number.isSafeInteger(Number(value))
  ? Number(value) : undefined;
const drawingNamespaces = ['http://schemas.openxmlformats.org/drawingml/2006/main', 'http://purl.oclc.org/ooxml/drawingml/main'];
type Target = { itemIndexes: number[]; paragraphCount?: number; chart?: ChartItem };

export function readSlideAnimations(xml: OrderedXmlNode | null, items: SlideItem[]): SlideAnimationStep[] {
  const slide = slideRoot(xml);
  const timing = slide && first(slide, 'timing');
  const main = timing && mainSequence(members(timing, 'tnLst'));
  if (!main) return [];

  const targets = new Map<string, Target>();
  items.forEach((item, index) => {
    const drawing = item.sourceDrawing?.id;
    const paragraphCount = item.kind === 'shape' || item.kind === 'text' ? item.textFrame?.paragraphs.length : undefined;
    for (const id of new Set([drawing, ...item.sourceGroups?.map(group => group.id) ?? []])) {
      if (!id) continue;
      const target = targets.get(id) ?? {
        itemIndexes: [],
        paragraphCount: id === drawing ? paragraphCount : undefined,
        chart: id === drawing && item.kind === 'chart' ? item : undefined
      };
      target.itemIndexes.push(index);
      targets.set(id, target);
    }
  });

  return members(main, 'childTnLst').flatMap(group => {
    const wrapper = first(group, 'cTn');
    if (!wrapper) return [];
    const conditions = members(wrapper, 'stCondLst');
    const startsOnOpen = conditions.some(condition => condition.attributes.evt === 'onBegin' &&
      first(condition, 'tn')?.attributes.val === main.attributes.id);
    const effects = readEffects(wrapper, time(conditions[0]?.attributes.delay) ?? 0, targets);
    effects.sort((a, b) => a.delayMs - b.delayMs);
    return effects.length ? [{ onClick: !startsOnOpen, effects }] : [];
  });
}

function mainSequence(nodes: XmlElement[]): XmlElement | undefined {
  for (const node of nodes) {
    const timing = first(node, 'cTn');
    if (!timing || timing.attributes.nodeType === 'interactiveSeq') continue;
    if (timing.attributes.nodeType === 'mainSeq') return timing;
    const main = mainSequence(members(timing, 'childTnLst'));
    if (main) return main;
  }
}

function readEffects(node: XmlElement, offset: number, targets: Map<string, Target>): SlideObjectAnimation[] {
  const nodes = members(node, 'childTnLst');
  if (node.attributes.nodeType === 'interactiveSeq' || node.attributes.repeatCount || node.attributes.repeatDur ||
    node.attributes.autoRev === '1' || node.attributes.autoRev === 'true' || first(node, 'iterate')) return [];
  if (['clickEffect', 'withEffect', 'afterEffect'].includes(String(node.attributes.nodeType))) {
    const filters = nodes.filter(child => child.name === 'animEffect');
    const primitives = filters.length ? filters : nodes.every(child => child.name === 'set') ? nodes : [];
    return primitives.flatMap(child => {
      const effect = readEffect(child, offset, targets);
      return effect ? [effect] : [];
    });
  }

  return nodes.flatMap(child => {
    const timing = first(child, 'cTn');
    if (!timing || child.name !== 'par') return [];
    const delay = conditionDelay(timing);
    return delay === undefined ? [] : readEffects(timing, offset + delay, targets);
  });
}

function conditionDelay(node: XmlElement): number | undefined {
  const conditions = members(node, 'stCondLst');
  if (!conditions.length) return 0;
  const values = conditions.flatMap(condition => {
    const delay = time(condition.attributes.delay);
    return condition.attributes.evt === undefined && !childElements(condition).length && delay !== undefined ? [delay] : [];
  });
  return values.length ? Math.min(...values) : undefined;
}

function readEffect(node: XmlElement, offset: number, targets: Map<string, Target>): SlideObjectAnimation | undefined {
  const behavior = first(node, 'cBhvr');
  const timing = behavior && first(behavior, 'cTn');
  const target = behavior && first(behavior, 'tgtEl');
  const shape = target && first(target, 'spTgt');
  if (!timing || !shape) return undefined;
  const targetId = String(shape.attributes.spid ?? '').replace(/^0+(?=\d)/, '');
  const drawing = targets.get(targetId);
  const delay = conditionDelay(timing);
  const duration = time(timing.attributes.dur);
  if (!drawing || delay === undefined || duration === undefined) return undefined;
  const { itemIndexes, paragraphCount } = drawing;
  let paragraphs: SlideObjectAnimation['paragraphs'];
  let chart: SlideChartAnimationTarget | undefined;
  const subtargets = childElements(shape);
  if (subtargets.length) {
    const [text] = subtargets;
    if (subtargets.length !== 1 || text.namespace !== shape.namespace || itemIndexes.length !== 1) return undefined;
    if (text.name === 'graphicEl' && drawing.chart) {
      const target = children(text, 'chart', drawingNamespaces)[0];
      chart = target && readChartTarget(drawing.chart, target);
      if (!chart) return undefined;
    } else if (text.name === 'txEl' && paragraphCount) {
      const range = first(text, 'pRg');
      const start = time(range?.attributes.st), end = time(range?.attributes.end);
      if (start === undefined || end === undefined || end < start || end >= paragraphCount) return undefined;
      paragraphs = { start, end };
    } else return undefined;
  }
  const base = { targetId, itemIndexes, delayMs: offset + delay, ...(paragraphs ? { paragraphs } : {}), ...(chart ? { chart } : {}) };
  if (node.name === 'set') {
    const attribute = members(behavior!, 'attrNameLst')[0];
    const to = first(node, 'to');
    const value = to && first(to, 'strVal')?.attributes.val;
    if (attribute?.entries[0]?.['#text'] === 'style.visibility' && (value === 'visible' || value === 'hidden')) {
      return { ...base, effect: 'appear', enter: value === 'visible', durationMs: 0 };
    }
  } else {
    const { transition, filter } = node.attributes;
    if (transition !== 'in' && transition !== 'out') return undefined;
    const enter = transition === 'in';
    if (filter === 'fade') return { ...base, effect: 'fade', enter, durationMs: duration };
    const wipe = typeof filter === 'string' && /^wipe\((up|down|left|right)\)$/.exec(filter);
    if (wipe && !chart && itemIndexes.length === 1) {
      return { ...base, effect: 'wipe', enter, direction: wipe[1] as SlideObjectAnimation['direction'], durationMs: duration };
    }
  }
}

function readChartTarget(chart: ChartItem, target: XmlElement): SlideChartAnimationTarget | undefined {
  const { bldStep: step, seriesIdx, categoryIdx } = target.attributes;
  if (step === 'allPts' || step === 'gridLegend') return { step };
  const point = step === 'ptInCategory' || step === 'ptInSeries';
  if (!point && step !== 'series' && step !== 'category') return undefined;

  let seriesIndex: number | undefined;
  if (point || step === 'series') {
    const authored = time(seriesIdx);
    if (authored === undefined) return undefined;
    const found = chart.series.findIndex(series => series.sourceIndex === authored);
    seriesIndex = found >= 0 ? found : authored;
    if (!chart.series[seriesIndex] || (found < 0 && chart.series[seriesIndex].sourceIndex !== undefined)) return undefined;
  }
  if (step === 'series') return { step, seriesIndex };

  const categoryIndex = time(categoryIdx);
  if (categoryIndex === undefined) return undefined;
  // A continuous line or area is a single path. Category-level effects require a matching plot mark.
  let matches = false;
  for (const [index, series] of chart.series.entries()) {
    if ((seriesIndex !== undefined && seriesIndex !== index) || categoryIndex >= series.values.length) continue;
    const type = chart.plotGroups?.find(plot => plot.seriesIndices.includes(index))?.chartType ?? chart.chartType;
    if (type === 'area' || ((type === 'line' || type === 'scatter') && series.line !== null)) return undefined;
    matches = true;
  }
  return matches ? { step, seriesIndex, categoryIndex } : undefined;
}
