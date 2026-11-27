import { bindPreviewEmbeddedFonts, splitPreviewFontFamilies, type PreviewFontDiagnostic } from '@filens/core';

interface EmbeddedFontReference { id?: string; key?: string; type?: string }

interface EmbeddedFontPart {
  fonts?: Array<{ name?: string; embedFontRefs?: EmbeddedFontReference[] }>;
  rels?: Array<{ id?: string; type?: string; targetMode?: string }>;
}

interface EmbeddedFontDocument {
  fontTablePart?: EmbeddedFontPart;
  loadResource?(part: EmbeddedFontPart, id: string, type: 'uint8array'): Promise<Uint8Array<ArrayBuffer> | null>;
}

const descriptors = new Map<string, FontFaceDescriptors>([
  ['regular', { weight: '400', style: 'normal' }],
  ['bold', { weight: '700', style: 'normal' }],
  ['italic', { weight: '400', style: 'italic' }],
  ['boldItalic', { weight: '700', style: 'italic' }]
]);
const fontRelationship = /^http:\/\/(?:schemas\.openxmlformats\.org\/officeDocument\/2006|purl\.oclc\.org\/ooxml\/officeDocument)\/relationships\/font$/;
let nextAlias = 0;

export function createDocxEmbeddedFonts(document: EmbeddedFontDocument, ownerDocument: Document, signal: AbortSignal) {
  const aliases = new Map<string, string>();
  const loaded = new Set<string>();
  const part = document.fontTablePart;
  const loadResource = document.loadResource?.bind(document);
  const register = part?.fonts?.some(font => font.embedFontRefs?.length) && bindPreviewEmbeddedFonts(ownerDocument, signal);
  const sources: Array<{ name: string; alias: string; id: string; key?: string; face: FontFaceDescriptors }> = [];
  if (part && loadResource && register) {
    const relationships = new Map(part.rels?.slice().reverse().map(rel => [rel.id, rel]));
    const seen = new Set<string>();
    for (const font of part.fonts ?? []) {
      const name = font.name?.trim().toLowerCase();
      if (!name) continue;
      for (const ref of font.embedFontRefs ?? []) {
        const face = descriptors.get(ref.type ?? '');
        const rel = relationships.get(ref.id);
        if (!face || !ref.id || !rel || !fontRelationship.test(rel.type ?? '')
          || rel.targetMode && rel.targetMode !== 'Internal') continue;
        const slot = JSON.stringify([name, ref.type]);
        if (seen.has(slot)) continue;
        seen.add(slot);
        const alias = aliases.get(name) ?? `filens-docx-embedded-${++nextAlias}`;
        aliases.set(name, alias);
        sources.push({ name, alias, id: ref.id, key: ref.key, face });
      }
    }
  }
  return {
    aliases,
    async load(): Promise<boolean> {
      if (!part || !loadResource || !register) return false;
      for (const source of sources) {
        if (signal.aborted) break;
        try {
          let bytes = await loadResource(part, source.id, 'uint8array');
          if (!bytes || signal.aborted) continue;
          if (source.key) {
            bytes = bytes.slice();
            if (!deobfuscate(bytes, source.key)) continue;
          }
          if (await register(source.alias, bytes, source.face)) loaded.add(source.name);
        } catch { /* A missing, malformed or rejected face leaves the CSS fallback active. */ }
      }
      return loaded.size > 0;
    },
    diagnostics(fonts: PreviewFontDiagnostic[]): PreviewFontDiagnostic[] {
      return loaded.size ? fonts.map(font => loaded.has(font.fontFamily?.toLowerCase() ?? '')
        ? { ...font, status: 'available', source: 'embedded' } : font) : fonts;
    }
  };
}

function deobfuscate(bytes: Uint8Array, guid: string): boolean {
  const value = guid.startsWith('{') && guid.endsWith('}') ? guid.slice(1, -1) : guid;
  if (bytes.length < 32 || !/^[\da-f]{8}-(?:[\da-f]{4}-){3}[\da-f]{12}$/i.test(value)) return false;
  const key = value.replace(/-/g, '');
  for (let i = 0; i < 16; i++) {
    const value = parseInt(key.slice(30 - i * 2, 32 - i * 2), 16);
    bytes[i] ^= value;
    bytes[i + 16] ^= value;
  }
  return true;
}

/** docx-preview emits comma-separated names and simple var(--docx-*-font) tokens. */
export function applyDocxEmbeddedFontAliases(stack: string, aliases: ReadonlyMap<string, string>): string {
  if (!aliases.size) return stack;
  return stack.replace(/(^|,)((?:[^,'"(]|\([^)]*\)|"(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*')+)(?=,|$)/g,
    (part, separator: string, token: string) => {
      const [family] = splitPreviewFontFamilies(token);
      const alias = family && aliases.get(family.toLowerCase());
      if (!alias) return part;
      const name = token.trimStart();
      return `${separator}${token.slice(0, token.length - name.length)}${alias}, ${name}`;
    });
}
