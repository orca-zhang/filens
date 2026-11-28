import { waitForContainerTask } from '@filens/core';
import type { TextLayer } from 'pdfjs-dist';

export const PDF_SEARCH_MATCH_LIMIT = 10_000;
export interface PdfTextMatch { pageIndex: number; start: number; end: number; }

/** Offsets follow PDF.js textDivs, including empty text items and excluding marked-content records. */
export function indexPdfText(items: readonly ({ str?: string; hasEOL?: boolean } | { type: string })[]) {
  let text = '';
  const offsets: number[] = [];
  for (const item of items) {
    if (!('str' in item) || typeof item.str !== 'string') continue;
    offsets.push(text.length);
    text += item.str + (item.hasEOL ? ' ' : '');
  }
  return { text, offsets };
}

function isHighSurrogate(code: number): boolean {
  return code >= 0xd800 && code <= 0xdbff;
}

export function createPdfTextMatcher(query: string, pageIndex: number, limit: number) {
  const matches: PdfTextMatch[] = [];
  if (!query.trim() || limit <= 0) return () => matches;
  const pattern = new RegExp(query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'giu');
  let tail = '', offset = 0;
  return (chunk: string, final = false) => {
    const text = tail + chunk;
    // A trailing high surrogate may pair with the first code unit of the next chunk.
    const searchable = !final && isHighSurrogate(text.charCodeAt(text.length - 1)) ? text.slice(0, -1) : text;
    pattern.lastIndex = 0;
    let match: RegExpExecArray | null, matchedEnd = 0;
    while (matches.length < limit && (match = pattern.exec(searchable))) {
      matchedEnd = pattern.lastIndex;
      matches.push({ pageIndex, start: offset + match.index, end: offset + matchedEnd });
    }
    // Only a possible unfinished match can start in the retained tail.
    let cut = Math.max(matchedEnd, searchable.length - query.length + 1);
    const next = text.charCodeAt(cut);
    if (cut > matchedEnd && isHighSurrogate(text.charCodeAt(cut - 1)) && next >= 0xdc00 && next <= 0xdfff) cut--;
    tail = text.slice(cut);
    offset += cut;
    return matches;
  };
}

export interface PdfTextProgress {
  offsets: number[];
  length: number;
  state?: 'complete' | 'unavailable';
  wake?: () => void;
}

/** Consume rendered runs as they arrive without keeping a second copy of the page. */
export async function matchPdfTextRuns(runs: readonly string[], offsets: readonly number[], length: number,
  matchChunk: ReturnType<typeof createPdfTextMatcher>, limit: number, signal: AbortSignal,
  progress?: PdfTextProgress, onMatches?: (found: PdfTextMatch[]) => void): Promise<PdfTextMatch[] | undefined> {
  let i = 0, chunk = '', deadline = performance.now() + 16;
  while (progress?.state !== 'unavailable') {
    for (; i < runs.length; i++) {
      const run = runs[i], end = offsets[i + 1] ?? progress?.length ?? length;
      // A one-code-unit gap is the same line separator used by indexPdfText.
      chunk += run + (end - offsets[i] > run.length ? ' ' : '');
      if (chunk.length < 8192 && (i + 1) % 512 !== 0) continue;
      const found = matchChunk(chunk);
      if (found.length === limit) return found;
      chunk = '';
      if (performance.now() >= deadline) {
        onMatches?.(found);
        await new Promise(resolve => setTimeout(resolve, 0));
        signal.throwIfAborted();
        deadline = performance.now() + 16;
      }
    }
    if (!progress || progress.state === 'complete') return matchChunk(chunk, true);
    const found = matchChunk(chunk);
    if (found.length === limit) return found;
    onMatches?.(found);
    chunk = '';
    // A render can be discarded while the search yields between batches.
    if (progress.state) continue;
    let wake!: () => void;
    const changed = new Promise<void>(resolve => { wake = progress.wake = resolve; });
    try { await waitForContainerTask(changed, signal); }
    finally { if (progress.wake === wake) progress.wake = undefined; }
  }
}

interface LayerHighlights {
  matches: readonly PdfTextMatch[];
  markedRuns: Set<number>;
  marks: Map<PdfTextMatch, HTMLElement[]>;
  active?: PdfTextMatch;
}

const layerHighlights = new WeakMap<TextLayer, LayerHighlights>();

function firstMatchRun(runs: readonly string[], offsets: readonly number[], length: number, start: number, first: number): number {
  let last = length;
  while (first < last) {
    const middle = (first + last) >>> 1;
    if (offsets[middle] + runs[middle].length <= start) first = middle + 1;
    else last = middle;
  }
  return first;
}

function saveRunSelection(textDivs: readonly HTMLElement[], before: ReadonlySet<number> | undefined,
  after: ReadonlySet<number>): (() => void) | undefined {
  const document = textDivs[0]?.ownerDocument;
  if (!document) return;
  const selection = document.getSelection();
  if (!selection?.rangeCount || selection.isCollapsed) return;

  let changed = false;
  const save = (node: Node, offset: number): (() => [Node, number]) => {
    const element = node.nodeType === 1 ? node as Element : node.parentElement;
    const span = element?.closest<HTMLElement>('span:not(.markedContent)');
    const index = span ? textDivs.indexOf(span) : -1;
    if (!span || (!before?.has(index) && !after.has(index))) return () => [node, offset];
    const prefix = document.createRange();
    prefix.selectNodeContents(span);
    prefix.setEnd(node, offset);
    const length = prefix.toString().length;
    changed = true;
    return () => {
      const walker = document.createTreeWalker(span, NodeFilter.SHOW_TEXT);
      let remaining = length;
      for (let text = walker.nextNode() as Text | null; text; text = walker.nextNode() as Text | null) {
        if (remaining <= text.length) return [text, remaining];
        remaining -= text.length;
      }
      return [span, span.childNodes.length];
    };
  };
  if (selection.rangeCount === 1 && selection.anchorNode && selection.focusNode) {
    const anchor = save(selection.anchorNode, selection.anchorOffset), focus = save(selection.focusNode, selection.focusOffset);
    if (changed) return () => selection.setBaseAndExtent(...anchor(), ...focus());
    return;
  }
  const ranges = Array.from({ length: selection.rangeCount }, (_, index) => {
    const range = selection.getRangeAt(index);
    return { start: save(range.startContainer, range.startOffset), end: save(range.endContainer, range.endOffset) };
  });
  if (changed) return () => {
    selection.removeAllRanges();
    for (const { start, end } of ranges) {
      const range = document.createRange();
      range.setStart(...start());
      range.setEnd(...end());
      selection.addRange(range);
    }
  };
}

export function highlightPdfText(layer: TextLayer, offsets: readonly number[], matches: readonly PdfTextMatch[],
  active?: PdfTextMatch): HTMLElement | undefined {
  const previous = layerHighlights.get(layer);
  if (previous?.matches === matches) {
    const activeMarks = active && previous.marks.get(active);
    if (previous.active !== active) {
      const oldMarks = previous.active && previous.marks.get(previous.active);
      for (const mark of oldMarks ?? []) mark.classList.remove('is-active');
      for (const mark of activeMarks ?? []) mark.classList.add('is-active');
      previous.active = active;
    }
    return activeMarks?.[0];
  }
  if (!matches.length && !previous) return;

  const { textDivs, textContentItemsStr: runs } = layer;
  const markedRuns = new Set<number>();
  let first = 0;
  for (const match of matches) {
    // Match order and run offsets are monotonic, including empty text runs.
    first = firstMatchRun(runs, offsets, textDivs.length, match.start, first);
    for (let i = first; i < textDivs.length && offsets[i] < match.end; i++) {
      if (runs[i].length) markedRuns.add(i);
    }
  }
  const restoreSelection = saveRunSelection(textDivs, previous?.markedRuns, markedRuns);
  for (const index of previous?.markedRuns ?? []) {
    if (!markedRuns.has(index)) textDivs[index].textContent = runs[index];
  }
  if (!matches.length) {
    layerHighlights.delete(layer);
    restoreSelection?.();
    return;
  }

  const marks = new Map<PdfTextMatch, HTMLElement[]>();
  let next = 0;
  for (const index of markedRuns) {
    const div = textDivs[index], text = runs[index], document = div.ownerDocument;
    const start = offsets[index], end = start + text.length;
    while (next < matches.length && matches[next].end <= start) next++;
    const markup = document.createDocumentFragment();
    let cursor = 0;
    for (let hit = next; hit < matches.length && matches[hit].start < end; hit++) {
      const match = matches[hit];
      const from = Math.max(0, match.start - start), to = Math.min(text.length, match.end - start);
      if (to <= from) continue;
      markup.append(document.createTextNode(text.slice(cursor, from)));
      const mark = document.createElement('mark');
      mark.className = 'pdfv-search-match';
      mark.classList.toggle('is-active', match === active);
      mark.textContent = text.slice(from, to);
      markup.append(mark);
      const pieces = marks.get(match);
      if (pieces) pieces.push(mark);
      else marks.set(match, [mark]);
      cursor = to;
    }
    markup.append(document.createTextNode(text.slice(cursor)));
    div.replaceChildren(markup);
  }
  restoreSelection?.();
  layerHighlights.set(layer, { matches, markedRuns, marks, active });
  return active ? marks.get(active)?.[0] : undefined;
}

const matchHighlightName = 'filens-pdf-search-match';
const activeHighlightName = 'filens-pdf-search-active';
const denseHighlightCount = 512;

interface PdfRangeHighlights {
  matches: readonly PdfTextMatch[];
  pieces: Map<PdfTextMatch, StaticRange[]>;
  rangeCount: number;
  registry: HighlightRegistry;
  normal: Highlight;
  selected: Highlight;
  active?: PdfTextMatch;
  range?: Range;
}

const rangeHighlights = new WeakMap<TextLayer, PdfRangeHighlights>();

export function releasePdfTextHighlights(layer: TextLayer): void {
  const state = rangeHighlights.get(layer);
  if (!state) return;
  rangeHighlights.delete(layer);
  const { registry, normal, selected } = state;
  if (normal.size + selected.size === state.rangeCount) {
    if (registry.get(matchHighlightName) === normal) registry.delete(matchHighlightName);
    if (registry.get(activeHighlightName) === selected) registry.delete(activeHighlightName);
    normal.clear();
    selected.clear();
    return;
  }
  for (const pieces of state.pieces.values()) for (const piece of pieces) {
    normal.delete(piece);
    selected.delete(piece);
  }
}

/** Paint dense results without replacing any of PDF.js's selectable text. */
export function highlightPdfRanges(layer: TextLayer, offsets: readonly number[], matches: readonly PdfTextMatch[],
  active?: PdfTextMatch): PdfRangeHighlights | undefined {
  let state = rangeHighlights.get(layer);
  if (state?.matches !== matches) {
    releasePdfTextHighlights(layer);
    if (matches.length < denseHighlightCount) return;
    const { textDivs, textContentItemsStr: runs } = layer;
    const view = textDivs[0]?.ownerDocument.defaultView, registry = view?.CSS?.highlights;
    if (!registry || typeof view.Highlight !== 'function' || typeof view.StaticRange !== 'function') return;
    // Dense custom highlights take longer to register in Firefox and to paint in WebKit.
    if (!/\b(?:Headless)?Chrom(?:e|ium)\//.test(view.navigator.userAgent)) return;
    highlightPdfText(layer, offsets, []);
    const normal = registry.get(matchHighlightName) ?? new view.Highlight();
    const selected = registry.get(activeHighlightName) ?? new view.Highlight();
    const pieces = new Map<PdfTextMatch, StaticRange[]>();
    let first = 0, rangeCount = 0;
    for (const match of matches) {
      first = firstMatchRun(runs, offsets, textDivs.length, match.start, first);
      for (let i = first; i < textDivs.length && offsets[i] < match.end; i++) {
        const node = textDivs[i].firstChild;
        if (!node || node.nodeType !== 3) continue;
        const startOffset = Math.max(0, match.start - offsets[i]);
        const endOffset = Math.min(node.textContent!.length, match.end - offsets[i]);
        if (endOffset <= startOffset) continue;
        const range = new view.StaticRange({ startContainer: node, startOffset, endContainer: node, endOffset });
        const existing = pieces.get(match);
        if (existing) existing.push(range);
        else pieces.set(match, [range]);
        normal.add(range);
        rangeCount++;
      }
    }
    if (!rangeCount) return;
    if (!registry.has(matchHighlightName)) registry.set(matchHighlightName, normal);
    if (!registry.has(activeHighlightName)) registry.set(activeHighlightName, selected);
    state = { matches, pieces, rangeCount, registry, normal, selected };
    rangeHighlights.set(layer, state);
  }
  if (state.active === active) return state;
  for (const range of state.active ? state.pieces.get(state.active) ?? [] : []) {
    state.selected.delete(range);
    state.normal.add(range);
  }
  const current = active && state.pieces.get(active);
  for (const range of current || []) {
    state.normal.delete(range);
    state.selected.add(range);
  }
  state.active = active;
  state.range = undefined;
  const first = current && current[0];
  if (first) {
    // Scroll to the first piece of a multi-line match.
    const target = first.startContainer.ownerDocument!.createRange();
    target.setStart(first.startContainer, first.startOffset);
    target.setEnd(first.endContainer, first.endOffset);
    state.range = target;
  }
  return state;
}
