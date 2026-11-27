import { chartLabelRuns } from '../chart-label-fonts';
import type { ChartItem, ChartLabelStyle, ChartTextStyle, SlideModel, TextFrame } from '../types';
import type { PreviewFontReference } from './types';

const originals = new WeakMap<object, string>();
export const originalSceneFontFamily = (node: { fontFamily?: string }) => originals.get(node) ?? node.fontFamily;
const faceKey = (family: string, weight: number | undefined, style = 'normal') => JSON.stringify([family.toLowerCase(), weight, style]);

type SceneFontNode = { fontFamily?: string; text?: string; char?: string; bold?: boolean; italic?: boolean };
type VisitFont = (node: SceneFontNode, sample?: () => string, complete?: boolean) => void;

export function visitSlideFontNodes(slides: readonly Pick<SlideModel, 'items'>[], callback: VisitFont): void {
  const frame = (frame: TextFrame | undefined) => {
    for (const paragraph of frame?.paragraphs ?? []) {
      if (paragraph.bullet) callback(paragraph.bullet);
      paragraph.runs.forEach(run => callback(run));
    }
  };
  for (const slide of slides) for (const item of slide.items) {
    if (item.kind === 'text' || item.kind === 'shape') frame(item.textFrame);
    else if (item.kind === 'table') item.cells.forEach(cell => frame(cell.textFrame));
    else if (item.kind === 'chart') visitChartFonts(item, callback);
  }
}

function visitChartFonts(item: ChartItem, callback: VisitFont): void {
  const numeric = () => '0123456789-.,%+Ee';
  const visitStyle = (style: ChartTextStyle | undefined, sample: () => string, complete = false) => {
    const source = style?.fontFamily ? style : item.textStyle;
    if (source) callback(source, sample, complete);
  };
  const visitLabels = (style: ChartLabelStyle | undefined, labels: () => Iterable<string>) => {
    const source = style?.fontFamily || style?.scriptFonts ? style : item.textStyle;
    if (!source) return;
    if (!source.scriptFonts?.eastAsia && !source.scriptFonts?.complex) {
      visitStyle(source, () => boundedFontSample(labels()));
      return;
    }
    const samples = new Map<SceneFontNode, string>();
    for (const label of labels()) {
      for (const { text, face } of chartLabelRuns(label, source)) {
        if (!face?.fontFamily || !text) continue;
        const previous = samples.get(face) ?? '';
        if (previous.length < FONT_SAMPLE_LIMIT) {
          const prefix = previous ? previous + ' ' : '';
          samples.set(face, prefix + text.slice(0, FONT_SAMPLE_LIMIT - prefix.length));
        }
      }
    }
    for (const [face, sample] of samples) callback(face, () => sample, false);
  };
  const visitTitle = (text: string | undefined, lines: ChartItem['titleLines'], style: ChartTextStyle | undefined) => {
    if (lines?.length) {
      for (const line of lines) for (const run of line) {
        if (run.text) visitStyle(run.fontFamily ? run : style, () => run.text, true);
      }
    } else if (text) {
      visitStyle(style, () => text, true);
    }
  };
  visitTitle(item.title, item.titleLines, item.titleStyle);
  const circular = item.chartType === 'pie' || item.chartType === 'doughnut';
  const labelsForCategories = function* (count: number, legend: boolean) {
    for (let index = 0; index < count; index++) {
      const category = item.categories[index];
      yield legend ? category || String(index + 1) : category ?? String(index + 1);
    }
  };
  const legendLabels = function* () { for (const series of item.series) yield series.name; };
  if (item.legendPosition !== 'none' && item.series.length) {
    visitLabels(item.legendStyle, circular ? () => labelsForCategories(item.series[0].values.length, true) : legendLabels);
  }
  if (circular) return;
  const xy = item.chartType === 'scatter' || item.chartType === 'bubble';
  if (!xy && !item.categoryAxis?.hidden && item.categoryAxis?.date?.tickLabelPosition !== 'none') {
    visitLabels(item.categoryAxis?.textStyle, () => labelsForCategories(item.series.reduce(
      (count, series) => Math.max(count, series.values.length), Math.max(item.categories.length, 1)
    ), false));
  }
  if (!item.valueAxis?.hidden && (!xy || item.valueAxis?.tickLabelPosition !== 'none')) {
    visitLabels(item.valueAxis?.textStyle, () => [numeric()]);
  }
  if (xy && !item.xValueAxis?.hidden && item.xValueAxis?.tickLabelPosition !== 'none') {
    visitLabels(item.xValueAxis?.textStyle, () => [numeric()]);
  }
  if (item.secondaryValueAxis && !item.secondaryValueAxis.hidden) visitLabels(item.secondaryValueAxis.textStyle, () => [numeric()]);
  for (const axis of [xy ? item.xValueAxis : item.categoryAxis, item.valueAxis, item.secondaryValueAxis]) {
    if (axis?.title && !axis.hidden) visitTitle(axis.title.text, axis.title.lines, axis.title.textStyle);
  }
  const barIndices = item.chartType === 'combo'
    ? new Set(item.plotGroups?.flatMap(group => group.chartType === 'column' ? group.seriesIndices : []))
    : undefined;
  if (item.chartType === 'line' || item.chartType === 'area' || xy) return;
  item.series.forEach((series, index) => {
    if ((!barIndices || barIndices.has(index)) && series.dataLabels?.showValue && series.values.some(value => value != null)) {
      visitLabels(series.dataLabels.textStyle, () => [numeric()]);
    }
  });
}

const FONT_SAMPLE_LIMIT = 4096;

function boundedFontSample(items: Iterable<string>): string {
  let sample = '';
  for (const item of items) {
    if (sample.length >= FONT_SAMPLE_LIMIT) break;
    if (item) sample += (sample ? ' ' : '') + item.slice(0, FONT_SAMPLE_LIMIT - sample.length);
  }
  return sample.slice(0, FONT_SAMPLE_LIMIT);
}

/** Local samples and face variants for lazy font loading; never put samples in state. */
export function collectSlideFontLoadingReferences(
  slides: readonly Pick<SlideModel, 'items'>[], completeDocument = false
): PreviewFontReference[] {
  const refs: PreviewFontReference[] = [];
  const families = new Map<string, Map<number, PreviewFontReference>>();
  const aliases = new Map<string, Map<number, PreviewFontReference>>();
  visitSlideFontNodes(slides, (node, sample, complete = true) => {
    const fontFamily = originalSceneFontFamily(node);
    if (!fontFamily) return;
    let variants = aliases.get(fontFamily);
    if (!variants) {
      const key = fontFamily.toLowerCase();
      variants = families.get(key);
      if (!variants) families.set(key, variants = new Map());
      aliases.set(fontFamily, variants);
    }
    const weight = node.bold === undefined ? undefined : node.bold ? 700 : 400;
    const fontStyle = node.italic ? 'italic' : 'normal';
    const key = (weight === undefined ? 0 : weight === 400 ? 2 : 4) + (node.italic ? 1 : 0);
    let ref = variants.get(key);
    if (!ref) {
      ref = { fontFamily, traits: weight ? { weight } : undefined, fontStyle, text: '', ...(completeDocument ? { textComplete: true } : {}) };
      variants.set(key, ref);
      refs.push(ref);
    }
    const remaining = FONT_SAMPLE_LIMIT - ref.text!.length;
    const text = remaining > 0 ? sample?.() ?? node.text ?? node.char : undefined;
    if (ref.textComplete && (!complete || text === undefined || text.length > remaining)) ref.textComplete = false;
    if (text) ref.text += text.slice(0, remaining);
  });
  return refs;
}

export function applySlideFontMappings(slides: readonly Pick<SlideModel, 'items'>[], refs: readonly PreviewFontReference[]): void {
  const targets = new Map(refs.filter(ref => ref.fontFamily).map(ref => [faceKey(ref.fontFamily!, ref.traits?.weight, ref.fontStyle), ref.resolvedFontFamily]));
  const familyTargets = new Map(refs.filter(ref => ref.fontFamily && ref.traits?.weight === undefined && ref.fontStyle === undefined)
    .map(ref => [ref.fontFamily!.toLowerCase(), ref.resolvedFontFamily]));
  visitSlideFontNodes(slides, node => {
    const family = originalSceneFontFamily(node);
    if (!family) return;
    originals.set(node, family);
    const key = faceKey(family, node.bold === undefined ? undefined : node.bold ? 700 : 400, node.italic ? 'italic' : 'normal');
    node.fontFamily = (targets.has(key) ? targets.get(key) : familyTargets.get(family.toLowerCase())) ?? family;
  });
}
