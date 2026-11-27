import { afterEach, describe, expect, it, vi } from 'vitest';
import JSZip from 'jszip';
import { splitPreviewFontFamilies } from '@filens/core';
import { createDocxPreviewDriver } from '../src';
import { prepareDocxFonts, readDocxFontTraits } from '../src/fonts';
import { fontSubsetDocument } from './fixtures/font-subset-document';

afterEach(() => { vi.restoreAllMocks(); document.body.replaceChildren(); });

function mockAvailability() {
  const context = { font: '', measureText: () => ({ width: context.font.includes('"Liberation Serif"') ? 140 : 100 }) };
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(context as unknown as CanvasRenderingContext2D);
}

describe('DOCX font discovery and substitution', () => {
  it.each([false, true])('samples rendered pages and falls back for uncertain glyphs (long text: %s)', async long => {
    mockAvailability();
    const computed = window.getComputedStyle.bind(window);
    vi.spyOn(window, 'getComputedStyle').mockImplementation((element, pseudo) => {
      if (!pseudo) return computed(element);
      // jsdom parses these rules but has no computed style for pseudo-elements.
      const style = document.createElement('span').style;
      for (const sheet of document.styleSheets) for (const rule of sheet.cssRules) {
        const css = rule as CSSStyleRule;
        if (css.selectorText?.endsWith(':before') && element.matches(css.selectorText.slice(0, -7))) {
          style.fontFamily = css.style.getPropertyValue('font-family');
        }
      }
      return style;
    });
    const host = document.body.appendChild(document.createElement('div'));
    const otherHost = document.body.appendChild(document.createElement('div'));
    const driver = createDocxPreviewDriver();
    const session = driver.createSession(host, { fontLoading: { packs: [] } });
    const other = driver.createSession(otherHost);
    try {
      const sibling = await fontSubsetDocument({ headingFont: 'Conflicting Preview Face' });
      await other.load(sibling, { descriptor: { source: sibling } });
      const source = await fontSubsetDocument({ long });
      await session.load(source, { descriptor: { source } });
      expect(host.querySelectorAll('section.docx')).toHaveLength(2);
      const references = session.getFontReferences!();
      const font = (name: string) => references.find(ref => ref.fontFamily === name);
      expect(font('Noto Emoji')?.text).toBe('😀😺');
      expect(font('Noto Emoji')?.textComplete).toBe(true);
      expect(font('Noto Sans KR')).toMatchObject({ text: '한글', textComplete: true, traits: { weight: 700 } });
      for (const family of ['Noto Sans SC', 'Noto Sans TC', 'Noto Serif JP', 'Noto Serif KR']) {
        expect(font(family)?.fontFamily).toBe(family);
        expect(font(family)?.textComplete).toBeUndefined();
      }
      if (long) {
        expect(font('Noto Sans JP')?.textComplete).toBeUndefined();
      } else {
        expect(font('Noto Sans JP')).toMatchObject({ text: '見出本文注下月日説明', textComplete: true });
        const resolvedFontFamily = 'Web Japanese Face';
        await session.refreshFonts!({
          references: references.map(ref => ref === font('Noto Sans JP') ? { ...ref, resolvedFontFamily } : ref),
          loaded: [{ fontFamily: resolvedFontFamily }], warnings: []
        });
        const body = [...host.querySelectorAll('span')].find(span => span.textContent === '本文')!;
        const otherBody = [...otherHost.querySelectorAll('span')].find(span => span.textContent === '本文')!;
        expect(computed(body).fontFamily).toContain(resolvedFontFamily);
        expect(computed(otherBody).fontFamily).toContain('Conflicting Preview Face');
        expect(session.getFontReferences!().map(ref => ref.fontFamily)).toEqual(references.map(ref => ref.fontFamily));
      }
    } finally { session.destroy(); other.destroy(); }
  });

  it.each([false, true])('uses real font-table metadata and renders a classified fallback (background loading: %s)', async background => {
    mockAvailability();
    let resolveFont!: (response: Response) => void;
    const pendingFont = new Promise<Response>(resolve => { resolveFont = resolve; });
    const faces = new Set<unknown>();
    if (background) {
      vi.stubGlobal('FontFace', class { async load() { return this; } });
      vi.stubGlobal('fetch', vi.fn(() => pendingFont));
      Object.defineProperty(document, 'fonts', { configurable: true, value: { add: (face: unknown) => faces.add(face), delete: (face: unknown) => faces.delete(face) } });
    }
    const zip = new JSZip();
    const ns = 'http://schemas.openxmlformats.org';
    zip.file('[Content_Types].xml', `<Types xmlns="${ns}/package/2006/content-types"><Default Extension="xml" ContentType="application/xml"/><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/></Types>`);
    zip.file('_rels/.rels', `<Relationships xmlns="${ns}/package/2006/relationships"><Relationship Id="doc" Type="${ns}/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>`);
    zip.file('word/_rels/document.xml.rels', `<Relationships xmlns="${ns}/package/2006/relationships"><Relationship Id="fonts" Type="${ns}/officeDocument/2006/relationships/fontTable" Target="fontTable.xml"/></Relationships>`);
    zip.file('word/fontTable.xml', `<w:fonts xmlns:w="${ns}/wordprocessingml/2006/main"><w:font w:name="Unfamiliar Book Face"><w:family w:val="swiss"/><w:panose1 w:val="02020603050405020304"/><w:pitch w:val="variable"/></w:font></w:fonts>`);
    zip.file('word/document.xml', `<w:document xmlns:w="${ns}/wordprocessingml/2006/main"><w:body><w:p><w:r><w:rPr><w:rFonts w:ascii="Unfamiliar Book Face"/></w:rPr><w:t>Classified serif text</w:t></w:r></w:p></w:body></w:document>`);
    const source = await zip.generateAsync({ type: 'uint8array' });
    const host = document.body.appendChild(document.createElement('div'));
    const session = createDocxPreviewDriver().createSession(host, background ? {
      fontLoading: { preferLocal: false, packs: [{ id: 'test', version: '1', fonts: [{ id: 'web-book', fontFamily: 'Web Book', traits: { serif: true, style: 'text', weight: 400 }, sources: [{ url: 'https://fonts.example/book.woff2' }] }] }] }
    } : undefined), warnings = vi.fn();
    session.on('warnings', warnings);
    try {
      await session.load(source, { descriptor: { source, name: 'fonts.docx' } });
      expect(host.textContent).toContain('Classified serif text');
      expect([...host.querySelectorAll<HTMLElement>('span')].some(span => span.style.fontFamily.includes('Liberation Serif'))).toBe(true);
      expect(session.getState().fonts).toMatchObject([{
        fontFamily: 'Unfamiliar Book Face', status: 'substituted', source: 'fallback', resolvedFontFamily: 'Liberation Serif',
        classification: { serif: true, weight: 400, panose: '02020603050405020304', evidence: 'metadata' }, substitutionReason: 'serif, weight'
      }]);
      expect(warnings).toHaveBeenLastCalledWith(session.getState().warnings);
      if (background) {
        const before = host.querySelector('.docxv-document'), root = host.querySelector<HTMLElement>('.docxv-preview')!;
        root.scrollTop = 143;
        resolveFont(new Response(new Uint8Array([1, 2, 3])));
        await vi.waitFor(() => expect(session.getState().fonts?.[0].resolvedFontFamily).toBe('Web Book'));
        expect(host.querySelector('.docxv-document')).not.toBe(before);
        expect(session.getState().fonts).toHaveLength(1);
        expect(host.querySelectorAll('.docxv-document')).toHaveLength(1);
        expect(root.scrollTop).toBe(143);
        expect([...host.querySelectorAll<HTMLElement>('span')].some(span => splitPreviewFontFamilies(span.style.fontFamily)[1] === 'Web Book')).toBe(true);
      }
      session.destroy(); expect(session.getState().fonts).toEqual([]);
      expect(faces.size).toBe(0);
    } finally { session.destroy(); vi.unstubAllGlobals(); if (background) delete (document as unknown as { fonts?: unknown }).fonts; }
  });

  it('preserves theme variables, embedded declarations and explicit stacks while discovering headers and styles', () => {
    mockAvailability();
    const variable = { 'font-family': 'var(--docx-minor-font), Arial' };
    const embedded = { 'font-family': 'Embedded Serif' };
    const header = { cssStyle: { 'font-family': 'Missing Serif, Arial' } };
    const doc = {
      fontTablePart: { fonts: [{ name: 'Embedded Serif', family: 'roman', embedFontRefs: [{}] }] },
      documentPart: { body: { children: [variable, embedded] } },
      parts: [{ body: header }], stylesPart: { styles: [{ values: { 'font-family': 'Style Serif' } }] }
    };
    const result = prepareDocxFonts(doc, document);
    expect(variable['font-family']).toBe('var(--docx-minor-font), Arial');
    expect(embedded['font-family']).toBe('Embedded Serif');
    expect(splitPreviewFontFamilies(header.cssStyle['font-family']).slice(0, 3)).toEqual(['Missing Serif', 'Arial', 'Liberation Serif']);
    expect(result.fonts.find(font => font.fontFamily === 'Embedded Serif')).toMatchObject({ status: 'unknown', embedded: true, resolvedFontFamily: undefined });
    expect(result.fonts.map(font => font.fontFamily)).toContain('Style Serif');
    expect(result.fonts.map(font => font.fontFamily)).toContain('Missing Serif');
  });

  it('keeps a mixed font stack in source order when inserting an embedded alias', () => {
    mockAvailability();
    const stack = { 'font-family': `var(--docx-minorHAnsi-font), 'Archive, Serif', Arial` };
    const doc = { documentPart: { body: stack }, fontTablePart: { fonts: [{ name: 'Archive, Serif', embedFontRefs: [{}] }] } };
    const result = prepareDocxFonts(doc, document, undefined, undefined, new Map([['archive, serif', 'embedded-archive']]));
    expect(stack['font-family']).toBe(`var(--docx-minorHAnsi-font), embedded-archive, 'Archive, Serif', Arial`);
    expect(result.loadingReferences).toEqual([]);
  });

  it('reads alternate namespace prefixes, preferring pitch over broad family and PANOSE', async () => {
    const load = vi.fn(async () => '<x:fonts xmlns:x="urn:word"><x:font x:name="Book Face"><x:family x:val="roman"/><x:panose1 x:val="020B0806050405020304"/><x:pitch x:val="fixed"/></x:font></x:fonts>');
    const traits = await readDocxFontTraits({ fontTablePart: { path: 'word/fonts.xml', _package: { load } } }, document);
    expect(traits.get('book face')).toMatchObject({ serif: false, monospace: true, weight: 700, stretch: 75 });
    expect(load).toHaveBeenCalledTimes(1);
    expect(load).toHaveBeenCalledWith('word/fonts.xml');
  });

  it('does not claim a substitute for renderer-controlled or unused declarations', () => {
    mockAvailability();
    const doc = {
      fontTablePart: { fonts: [{ name: 'Unused Serif', family: 'roman' }, { name: 'Embedded Serif', embedFontRefs: [{}] }] },
      documentPart: { body: [{ 'font-family': 'var(--theme-font), Theme Serif' }, { 'font-family': 'Embedded Serif, Other Serif' }] }
    };
    const initial = prepareDocxFonts(doc, document);
    expect(initial.fonts.every(font => !font.resolvedFontFamily)).toBe(true);
    expect(initial.loadingReferences).toEqual([]);
    const refreshed = prepareDocxFonts(doc, document, undefined, {
      references: [], loaded: [{ fontFamily: 'Liberation Serif', traits: { serif: true } }], warnings: []
    });
    expect(refreshed.fonts.every(font => !font.resolvedFontFamily)).toBe(true);
    expect(refreshed.fonts.some(font => font.fontFamily === 'Unused Serif')).toBe(true);
  });

  it('keeps rendering possible when optional raw font metadata is unavailable', async () => {
    for (const load of [async () => { throw new Error('Unavailable'); }, async () => '<invalid>']) {
      expect(await readDocxFontTraits({ fontTablePart: { path: 'fontTable.xml', _package: { load } } }, document)).toEqual(new Map());
    }
  });
});
