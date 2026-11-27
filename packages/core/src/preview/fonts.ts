import type { SlideModel } from '../types';
import { normalizeFontFamilyName, normalizeLocalizedFontAlias } from '../utils/fonts';
import type { PreviewFontCandidate, PreviewFontClassification, PreviewFontDiagnostic, PreviewFontReference } from './types';
import { classifyPreviewFont, getFontFallbackCandidates, rankPreviewFontCandidates } from './font-matching';
import { originalSceneFontFamily, visitSlideFontNodes } from './font-scenes';

const GENERIC_FAMILY = /^(serif|sans-serif|monospace|system-ui|ui-serif|ui-sans-serif|ui-monospace|ui-rounded|cursive|fantasy|emoji|math|fangsong)$/i;
const FONT_PROBE_TEXT = {
  text: 'BESbswy1234567890汉字かな한글',
  emoji: '❤♥⚙⛅✈⏱0123😀🧪',
  math: 'BESδ∫∑√ℝ𝛼𝔻123'
};
type FontProbeKind = keyof typeof FONT_PROBE_TEXT;

/** Collect resolved scene references for runs, tables, bullets and charts. */
export function collectSlideFontReferences(slides: readonly Pick<SlideModel, 'items'>[]): PreviewFontReference[] {
  const references = new Map<string, PreviewFontReference>();
  const families = new Map<string, { key: string; reference: PreviewFontReference }>();
  const add = (fontFamily: string | undefined) => {
    if (!fontFamily) return;
    let family = families.get(fontFamily);
    if (!family) {
      const normalized = normalizeFontFamilyName(fontFamily);
      families.set(fontFamily, family = { key: normalized.toLowerCase(), reference: { fontFamily: normalized } });
    }
    if (family.key) references.set(family.key, family.reference);
  };
  visitSlideFontNodes(slides, node => add(originalSceneFontFamily(node)));
  return [...references.values()];
}

/** Local, synchronous diagnostics. Never fetches fonts or treats FontFaceSet.check as proof. */
export function analyzePreviewFonts(
  references: readonly PreviewFontReference[],
  documentLike: Document | undefined = typeof document === 'undefined' ? undefined : document,
  options: { substitute?: boolean; candidates?: readonly PreviewFontCandidate[]; ignoreFamily?: (family: string) => boolean; availableFamilies?: ReadonlySet<string> } = {}
): { fonts: PreviewFontDiagnostic[]; warnings: string[] } {
  const fonts = new Map<string, PreviewFontDiagnostic>();
  const classifications = new Map<string, Map<PreviewFontReference['traits'], PreviewFontClassification>>();
  const availability = new Map<string, boolean | undefined>();
  let context: CanvasRenderingContext2D | null | undefined;
  const measure = (family: string, kind: FontProbeKind): number | undefined => {
    try {
      if (context === undefined) context = documentLike?.createElement('canvas').getContext('2d') ?? null;
      if (!context) return undefined;
      context.font = `normal 400 32px ${family}`;
      const width = context.measureText(FONT_PROBE_TEXT[kind]).width;
      return Number.isFinite(width) && width > 0 ? width : undefined;
    } catch {
      return undefined;
    }
  };
  const baselines = new Map<string, number | undefined>();
  const probe = (family: string, kind: FontProbeKind): boolean | undefined => {
    if (options.availableFamilies?.has(family.toLowerCase())) return true;
    if (options.ignoreFamily?.(family)) return false;
    const key = `${kind}:${family.toLowerCase()}`;
    if (availability.has(key)) return availability.get(key);
    // A CSS stack is not one font. The browser may silently choose any member.
    if (family.includes(',') || /[\x00-\x1f\x7f]/.test(family)) return undefined;
    if (GENERIC_FAMILY.test(family)) return documentLike ? true : undefined;
    let result: boolean | undefined = false;
    const candidates = new Set([family, normalizeLocalizedFontAlias(family)]);
    for (const baseline of ['monospace', 'serif', 'sans-serif']) {
      const baselineKey = `${kind}:${baseline}`;
      if (!baselines.has(baselineKey)) baselines.set(baselineKey, measure(baseline, kind));
      const baselineWidth = baselines.get(baselineKey);
      for (const candidate of candidates) {
        const width = measure(`${quoteFamily(candidate)}, ${baseline}`, kind);
        if (width == null || baselineWidth == null) result = undefined;
        else if (Math.abs(width - baselineWidth) > 0.1) {
          availability.set(key, true);
          return true;
        }
      }
    }
    availability.set(key, result);
    return result;
  };

  for (const reference of references) {
    const fontFamily = normalizeFontFamilyName(reference.fontFamily ?? '') || undefined;
    const fontFile = reference.fontFile?.trim() || undefined;
    if (!fontFamily && !fontFile) continue;
    let resolvedFontFamily = normalizeFontFamilyName(reference.resolvedFontFamily ?? '') || undefined;
    let target = resolvedFontFamily ?? fontFamily;
    const unsupported = reference.browserUnsupported || /\.shx$/i.test(fontFile ?? '');
    const familyKey = fontFamily ?? '';
    let variants = classifications.get(familyKey);
    if (!variants) classifications.set(familyKey, variants = new Map());
    let classification = variants.get(reference.traits);
    if (!classification) {
      classification = classifyPreviewFont(familyKey, reference.traits);
      variants.set(reference.traits, classification);
    }
    const script = classification.script;
    const probeKind = script === 'emoji' || script === 'math' ? script : 'text';
    let found = target && (!unsupported || resolvedFontFamily) ? probe(target, probeKind) : undefined;
    let substitutionReason: string | undefined;
    let matchScore: number | undefined;
    let coverage: PreviewFontDiagnostic['coverage'];
    if (options.substitute && found === false && fontFamily && !resolvedFontFamily && !unsupported && !reference.embedded) {
      const candidates = new Map<string, PreviewFontCandidate>();
      for (const family of getFontFallbackCandidates(fontFamily, reference.traits)) candidates.set(family.toLowerCase(), { fontFamily: family });
      for (const candidate of options.candidates ?? []) candidates.set(candidate.fontFamily.toLowerCase(), candidate);
      const replacement = rankPreviewFontCandidates(reference, [...candidates.values()])
        .find(match => !GENERIC_FAMILY.test(match.candidate.fontFamily) && probe(match.candidate.fontFamily, probeKind) === true);
      if (replacement) {
        resolvedFontFamily = target = replacement.candidate.fontFamily;
        found = true;
        matchScore = replacement.score;
        coverage = replacement.coverage;
        substitutionReason = classification.monospace ? 'monospace' : classification.style === 'handwriting' ? 'handwriting'
          : classification.style === 'decorative' ? 'decorative' : probeKind !== 'text' ? probeKind
            : classification.serif === true ? 'serif' : classification.serif === false ? 'sans-serif' : 'similar-traits';
        const details = replacement.reasons.filter(reason => ['weight', 'stretch', 'average-width', 'PANOSE', 'glyph-coverage'].includes(reason));
        if (details.length) substitutionReason += `, ${details.join(', ')}`;
      }
    }
    let status: PreviewFontDiagnostic['status'] = 'unknown';
    let source = reference.source ?? 'unknown';
    if (unsupported && !resolvedFontFamily) {
      status = 'unsupported';
      source = 'fallback';
    } else if (found === false && !reference.embedded) {
      status = 'missing';
      source = 'fallback';
    } else if (found === true) {
      status = resolvedFontFamily && (unsupported || resolvedFontFamily.toLowerCase() !== fontFamily?.toLowerCase())
        ? 'substituted' : 'available';
      source = substitutionReason ? 'fallback' : reference.source ?? (GENERIC_FAMILY.test(target!) ? 'fallback' : 'environment');
    }
    const diagnostic: PreviewFontDiagnostic = {
      fontFamily, fontFile, styleName: reference.styleName, resolvedFontFamily, status, source,
      classification, substitutionReason, matchScore, coverage, embedded: reference.embedded
    };
    const key = JSON.stringify([fontFamily?.toLowerCase(), fontFile?.toLowerCase(), reference.styleName, resolvedFontFamily?.toLowerCase(), source, classification, reference.embedded]);
    if (!fonts.has(key)) fonts.set(key, { ...diagnostic, classification: { ...classification } });
  }
  const diagnostics = [...fonts.values()];
  return { fonts: diagnostics, warnings: getPreviewFontWarnings(diagnostics) };
}

/** Drivers with existing format-specific warnings can select which diagnostics need a warning. */
export function getPreviewFontWarnings(fonts: readonly PreviewFontDiagnostic[]): string[] {
  const warnings = new Map<string, string>();
  const warn = (warning: string) => {
    const key = warning.toLowerCase();
    if (!warnings.has(key)) warnings.set(key, warning);
  };
  for (const font of fonts) {
    const label = font.fontFamily ?? font.fontFile;
    if (!label) continue;
    if (font.status === 'unsupported') {
      warn(`Font "${label}" cannot be rendered directly by the browser; fallback fonts may change layout.`);
    } else if (font.status === 'missing') {
      warn(`Font "${font.resolvedFontFamily ?? label}" was not detected; fallback fonts may change layout.`);
    } else if (font.status === 'substituted') {
      warn(font.substitutionReason
        ? `Font "${label}" is automatically substituted with "${font.resolvedFontFamily}" (${font.substitutionReason}); text layout may differ.`
        : `Font "${label}" is mapped to "${font.resolvedFontFamily}"; text layout may differ.`);
    }
  }
  return [...warnings.values()];
}

function quoteFamily(family: string): string {
  return `"${family.replace(/["\\]/g, '\\$&')}"`;
}
