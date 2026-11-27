import { classifyPreviewFont, splitPreviewFontFamilies, type PreviewFontReference } from '@filens/core';

const subsetScripts = new Set(['cjk-sc', 'cjk-tc', 'japanese', 'korean', 'emoji']);

interface FontSample {
  text: string;
  strings: Set<string>;
  weight?: number;
  complete: boolean;
}

export function sampleDocxFonts(wrapper: Element | null, references: PreviewFontReference[], className: string): PreviewFontReference[] {
  const document = wrapper?.ownerDocument;
  const view = document?.defaultView;
  if (!wrapper?.isConnected || !view || !document) return references;
  const samples = new Map<string, FontSample>();
  for (const { fontFamily, traits } of references) {
    if (fontFamily && subsetScripts.has(classifyPreviewFont(fontFamily, traits).script ?? '')) {
      samples.set(fontFamily.toLowerCase(), { text: '', strings: new Set(), complete: true });
    }
  }
  if (!samples.size) return references;

  const stacks = new Map<string, FontSample[]>();
  const match = (stack: string) => {
    let matches = stacks.get(stack);
    if (!matches) {
      matches = splitPreviewFontFamilies(stack).flatMap(family => samples.get(family.toLowerCase()) ?? []);
      stacks.set(stack, matches);
    }
    return matches;
  };
  const walker = document.createTreeWalker(wrapper, view.NodeFilter.SHOW_ELEMENT | view.NodeFilter.SHOW_TEXT);
  let parent: Element | null = null;
  let style: CSSStyleDeclaration | undefined;
  let visited = 0;
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    // Limit CSS reads even when a long document repeats the same short text.
    if (++visited > 8192) return references;
    if (node.nodeType === view.Node.ELEMENT_NODE) {
      const element = node as Element;
      // Numbering can draw counter styles or symbols with its own run font.
      if (element.localName === 'p' && [...element.classList].some(name => name.startsWith(`${className}-num-`))) {
        for (const pseudo of [undefined, '::before']) {
          for (const sample of match(view.getComputedStyle(element, pseudo).fontFamily)) sample.complete = false;
        }
      } else if (element.localName === 'li') {
        for (const sample of match(view.getComputedStyle(element).fontFamily)) sample.complete = false;
      }
      continue;
    }
    const value = node.nodeValue;
    if (!value?.trim() || !node.parentElement || node.parentElement.localName === 'style') continue;
    if (parent !== node.parentElement) {
      parent = node.parentElement;
      style = view.getComputedStyle(parent);
    }
    if (!style) continue;
    const weight = style.fontWeight === 'bold' ? 700 : Number(style.fontWeight === 'normal' ? 400 : style.fontWeight || 400);
    const supportedStyle = ['', 'normal'].includes(style.fontStyle) && ['', 'none'].includes(style.textTransform)
      && ['', 'normal'].includes(style.fontVariant);
    for (const sample of match(style.fontFamily)) {
      if (!sample.complete) continue;
      // shortcut: one normal face per family, until DOCX resolves variants independently.
      if (!supportedStyle || weight !== 400 && weight !== 700 || sample.weight !== undefined && sample.weight !== weight) {
        sample.complete = false;
        continue;
      }
      sample.weight = weight;
      if (sample.strings.has(value)) continue;
      if (sample.text.length + value.length > 4096) { sample.complete = false; continue; }
      sample.strings.add(value);
      sample.text += value;
    }
  }
  return references.map(ref => {
    const sample = samples.get(ref.fontFamily?.toLowerCase() ?? '');
    return sample?.complete && sample.text
      ? { ...ref, traits: { ...ref.traits, weight: sample.weight }, text: sample.text, textComplete: true }
      : ref;
  });
}
