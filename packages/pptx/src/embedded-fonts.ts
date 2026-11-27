import { bindPreviewEmbeddedFonts, type ParsedPresentation } from '@filens/core/presentation-support';
import type { PptxArchiveEntry } from './parser/archive';
import { decodeEmbeddedPptxFont } from './decode-embedded-font';

export interface EmbeddedPptxFont {
  family: string;
  faces: Array<{ entry: PptxArchiveEntry; descriptors: FontFaceDescriptors }>;
}

interface PresentationFonts {
  declared: Set<string>;
  aliases: Map<string, string>;
  loaded: Set<string>;
  loading: boolean;
}

const fontsByPresentation = new WeakMap<ParsedPresentation, PresentationFonts>();
let nextAlias = 0;

export function getPptxEmbeddedFonts(presentation: ParsedPresentation | null) {
  return presentation ? fontsByPresentation.get(presentation) : undefined;
}

export function preparePptxEmbeddedFonts(presentation: ParsedPresentation, fonts: EmbeddedPptxFont[], document: Document, signal?: AbortSignal) {
  if (!fonts.length) return;
  const register = signal && fonts.some(font => font.faces.length) ? bindPreviewEmbeddedFonts(document, signal) : undefined;
  const declared = new Set(fonts.map(font => font.family));
  const aliases = new Map<string, string>(), loaded = new Set<string>();
  const state: PresentationFonts = { declared, aliases, loaded, loading: !!register };
  fontsByPresentation.set(presentation, state);
  if (!register || !signal) return;
  for (const { family, faces } of fonts) {
    if (faces.length) aliases.set(family, `filens-pptx-embedded-${++nextAlias}`);
  }
  signal.addEventListener('abort', () => {
    aliases.clear();
    loaded.clear();
    state.loading = false;
  }, { once: true });

  return async () => {
    for (const { family, faces } of fonts) {
      for (const { entry, descriptors } of faces) {
        if (signal.aborted) return false;
        try {
          const data = await decodeEmbeddedPptxFont(await entry.async('uint8array'), signal);
          if (data && await register(aliases.get(family)!, data, descriptors) && !signal.aborted) loaded.add(family);
        } catch { /* Optional font parts must leave the rest of the slide readable. */ }
      }
    }
    state.loading = false;
    return loaded.size > 0;
  };
}
