import type { SlideModel, TextFrame } from '../types';
import type { PreviewFontReference } from './types';

const originals = new WeakMap<object, string>();
export const originalSceneFontFamily = (node: { fontFamily?: string }) => originals.get(node) ?? node.fontFamily;
const faceKey = (family: string, weight: number | undefined, style = 'normal') => JSON.stringify([family.toLowerCase(), weight, style]);

function visit(slides: readonly Pick<SlideModel, 'items'>[], callback: (node: { fontFamily?: string; text?: string; char?: string; bold?: boolean; italic?: boolean }) => void) {
  const frame = (frame: TextFrame | undefined) => {
    for (const paragraph of frame?.paragraphs ?? []) {
      if (paragraph.bullet) callback(paragraph.bullet);
      paragraph.runs.forEach(callback);
    }
  };
  for (const slide of slides) for (const item of slide.items) {
    if (item.kind === 'text' || item.kind === 'shape') frame(item.textFrame);
    else if (item.kind === 'table') item.cells.forEach(cell => frame(cell.textFrame));
  }
}

/** Local samples and face variants for lazy font loading; never put samples in state. */
export function collectSlideFontLoadingReferences(slides: readonly Pick<SlideModel, 'items'>[]): PreviewFontReference[] {
  const refs: PreviewFontReference[] = [];
  const families = new Map<string, Map<number, PreviewFontReference>>();
  const aliases = new Map<string, Map<number, PreviewFontReference>>();
  visit(slides, node => {
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
      ref = { fontFamily, traits: weight ? { weight } : undefined, fontStyle, text: '' };
      variants.set(key, ref);
      refs.push(ref);
    }
    const remaining = 4096 - ref.text!.length;
    if (remaining > 0) ref.text += (node.text ?? node.char ?? '').slice(0, remaining);
  });
  return refs;
}

export function applySlideFontMappings(slides: readonly Pick<SlideModel, 'items'>[], refs: readonly PreviewFontReference[]): void {
  const targets = new Map(refs.filter(ref => ref.fontFamily).map(ref => [faceKey(ref.fontFamily!, ref.traits?.weight, ref.fontStyle), ref.resolvedFontFamily]));
  const familyTargets = new Map(refs.filter(ref => ref.fontFamily && ref.traits?.weight === undefined && ref.fontStyle === undefined)
    .map(ref => [ref.fontFamily!.toLowerCase(), ref.resolvedFontFamily]));
  visit(slides, node => {
    const family = originalSceneFontFamily(node);
    if (!family) return;
    originals.set(node, family);
    const key = faceKey(family, node.bold === undefined ? undefined : node.bold ? 700 : 400, node.italic ? 'italic' : 'normal');
    node.fontFamily = (targets.has(key) ? targets.get(key) : familyTargets.get(family.toLowerCase())) ?? family;
  });
}
