import {
  analyzePreviewFonts, analyzeLoadedPreviewFonts, buildPreviewFontStack, fontTraitsFromPanose, getPreviewFontWarnings, officeFontTraits, splitPreviewFontFamilies,
  type PreviewFontReference, type PreviewFontTraits, type PreviewFontRefresh
} from '@filens/core';
import { applyDocxEmbeddedFontAliases } from './embedded-fonts';

interface DocxThemeFont { latinTypeface?: string }

interface DocxFontDocument {
  fontTablePart?: {
    fonts?: Array<{ name?: string; family?: string; pitch?: string; embedFontRefs?: unknown[] }>;
    path?: string;
    _package?: { load(path: string): Promise<string | null> };
  };
  documentPart?: { body?: unknown };
  stylesPart?: { styles?: unknown };
  themePart?: { theme?: { fontScheme?: { majorFont?: DocxThemeFont; minorFont?: DocxThemeFont } } };
  parts?: Array<Record<string, unknown>>;
}

const originalStacks = new WeakMap<object, string>();
const rewrittenStacks = new WeakMap<DocxFontDocument, Map<string, string>>();

/** docx-preview omits PANOSE/pitch; read just its existing package's font table. */
export async function readDocxFontTraits(document: DocxFontDocument, ownerDocument: Document): Promise<Map<string, PreviewFontTraits>> {
  const traits = new Map<string, PreviewFontTraits>();
  const part = document.fontTablePart;
  if (!part?.path || !part._package?.load) return traits;
  try {
    const xml = await part._package.load(part.path);
    const Parser = ownerDocument.defaultView?.DOMParser;
    if (!xml || !Parser) return traits;
    const parsed = new Parser().parseFromString(xml, 'application/xml');
    if (parsed.getElementsByTagName('parsererror').length) return traits;
    const attribute = (element: Element, name: string) => [...element.attributes].find(attr => attr.localName === name)?.value;
    for (const font of [...parsed.getElementsByTagNameNS('*', 'font')]) {
      const name = attribute(font, 'name');
      if (!name) continue;
      const value = (localName: string) => {
        const child = [...font.children].find(child => child.localName === localName);
        return child ? attribute(child, 'val') : undefined;
      };
      traits.set(name.toLowerCase(), {
        ...officeFontTraits(value('family')), ...fontTraitsFromPanose(value('panose1')),
        ...officeFontTraits(undefined, value('pitch'))
      });
    }
  } catch { /* Optional metadata must not prevent document rendering. */ }
  return traits;
}

/** Reuse parsed payloads; never traverse package/resource graphs. */
export function prepareDocxFonts(document: DocxFontDocument, ownerDocument: Document, metadata = new Map<string, PreviewFontTraits>(),
  update?: PreviewFontRefresh, aliases: ReadonlyMap<string, string> = new Map()) {
  const previousStacks = rewrittenStacks.get(document);
  const references = new Map<string, PreviewFontReference>();
  for (const font of document.fontTablePart?.fonts ?? []) {
    if (!font.name) continue;
    references.set(font.name.toLowerCase(), {
      fontFamily: font.name, traits: { ...officeFontTraits(font.family, font.pitch), ...metadata.get(font.name.toLowerCase()) },
      embedded: font.embedFontRefs?.length ? true : undefined
    });
  }
  const styles: Array<{ values: Record<string, unknown>; stack: string }> = [];
  const visited = new WeakSet<object>();
  const visit = (value: unknown) => {
    if (!value || typeof value !== 'object' || visited.has(value)) return;
    visited.add(value);
    if (Array.isArray(value)) { value.forEach(visit); return; }
    const record = value as Record<string, unknown>;
    if (record.type === 'symbol' && typeof record.font === 'string' && aliases.size) {
      const stack = originalStacks.get(record) ?? record.font;
      originalStacks.set(record, stack);
      record.font = applyDocxEmbeddedFontAliases(stack, aliases);
    }
    if (typeof record['font-family'] === 'string') {
      // docx-preview copies rewritten stacks while resolving inherited styles.
      const stack = originalStacks.get(record) ?? previousStacks?.get(record['font-family']) ?? record['font-family'];
      originalStacks.set(record, stack);
      styles.push({ values: record, stack });
      for (const fontFamily of splitPreviewFontFamilies(stack)) {
        if (!references.has(fontFamily.toLowerCase())) references.set(fontFamily.toLowerCase(), { fontFamily });
      }
    }
    for (const [key, child] of Object.entries(record)) {
      if (key !== 'parent' && !key.startsWith('_')) visit(child);
    }
  };
  visit(document.documentPart?.body);
  visit(document.stylesPart?.styles);
  for (const part of document.parts ?? []) {
    for (const key of ['body', 'rootElement', 'styles', 'domNumberings', 'notes', 'comments']) visit(part[key]);
  }
  const scheme = document.themePart?.theme?.fontScheme;
  for (const font of [scheme?.majorFont, scheme?.minorFont]) {
    if (!font?.latinTypeface || !aliases.size) continue;
    const stack = originalStacks.get(font) ?? font.latinTypeface;
    originalStacks.set(font, stack);
    font.latinTypeface = applyDocxEmbeddedFontAliases(stack, aliases);
  }
  // Only claim automatic selection for declarations we can actually rewrite.
  const rewritable = new Set(styles.filter(({ stack }) => !/[()]/.test(stack)
    && !splitPreviewFontFamilies(stack).some(family => references.get(family.toLowerCase())?.embedded)));
  const eligibleFamilies = new Set([...rewritable].flatMap(({ stack }) => splitPreviewFontFamilies(stack).map(family => family.toLowerCase())));
  const replacements = new Map(update?.references.map(ref => [ref.fontFamily?.toLowerCase(), ref]));
  for (const [key, ref] of references) {
    const replacement = replacements.get(key);
    if (replacement && eligibleFamilies.has(key)) references.set(key, { ...ref, ...replacement });
  }
  const eligible = [...references.values()].filter(ref => eligibleFamilies.has(ref.fontFamily!.toLowerCase()));
  const fonts = [
    ...(update ? analyzeLoadedPreviewFonts({ ...update, references: eligible }, ownerDocument)
      : analyzePreviewFonts(eligible, ownerDocument, { substitute: true })).fonts,
    ...analyzePreviewFonts([...references.values()].filter(ref => !eligibleFamilies.has(ref.fontFamily!.toLowerCase())), ownerDocument).fonts
  ];
  const targets = new Map(fonts.map(font => [font.fontFamily?.toLowerCase(), font.resolvedFontFamily]));
  const nextStacks = new Map<string, string>();
  for (const style of styles) {
    const { values, stack } = style;
    let rewritten = stack;
    if (rewritable.has(style)) {
      const preferred = splitPreviewFontFamilies(stack).map(family => targets.get(family.toLowerCase())).filter((target): target is string => !!target);
      rewritten = buildPreviewFontStack(stack, family => references.get(family.toLowerCase())?.traits, preferred);
    } else {
      rewritten = applyDocxEmbeddedFontAliases(stack, aliases);
    }
    if (values['font-family'] !== rewritten) values['font-family'] = rewritten;
    if (rewritten !== stack) nextStacks.set(rewritten, stack);
  }
  rewrittenStacks.set(document, nextStacks);
  return { fonts, references: [...references.values()], loadingReferences: eligible,
    warnings: [...new Set([...getPreviewFontWarnings(fonts), ...update?.warnings ?? []])] };
}
