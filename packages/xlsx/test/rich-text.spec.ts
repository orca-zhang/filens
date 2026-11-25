import { describe, expect, it, vi } from 'vitest';
import { createXlsxPreviewDriver, loadXlsxWorkbook, resolveCellValue } from '../src';
import { clonePreviewWorkbook } from '../src/workbook-cache';
import { createRichTextWorkbook } from './fixtures/rich-text-workbook.mjs';

describe('XLSX rich text', () => {
  it('shares rich string records on both worksheet parsers while keeping plain calculation values', async () => {
    const workbook = await loadXlsxWorkbook(await createRichTextWorkbook());
    const [shared, inline] = workbook.sheets;
    const [first, duplicate, plain] = shared.rows[0].cells;
    const [reference, inlineCell, formula] = inline.rows[0].cells;
    const text = '  Before <b>中文</b>²';
    expect(first.value).toBe(text);
    expect(first.richText?.runs).toMatchObject([
      { text: '  Before ' },
      { text: '<b>中文</b>', fontSize: 40, color: '#19334D', underline: 'none', strike: false,
        font: { fontFamily: 'Schedule Face', fontStyle: 'normal', traits: { weight: 400 } } },
      { text: '²', fontSize: 12, underline: 'double', verticalAlign: 'super' }
    ]);
    expect(duplicate.richText).toBe(first.richText);
    expect(reference.richText).toBe(first.richText);
    expect(inlineCell.richText?.runs[1]).toMatchObject({ text: ' 2', color: '#008844', verticalAlign: 'sub', font: { traits: { weight: 700 } } });
    expect(plain.value).toBe('Unformatted text');
    expect(plain.richText).toBeUndefined();
    expect(resolveCellValue(inline, formula)).toBe(String(text.length));

    const clone = clonePreviewWorkbook(workbook);
    const copy = clone.sheets[0].rows[0].cells[0].richText!;
    expect(copy).not.toBe(first.richText);
    expect(copy).toBe(clone.sheets[1].rows[0].cells[0].richText);
    expect(copy.runs[1].font).toBe(clone.fonts?.find(font => font.fontFamily === 'Schedule Face'));
    copy.runs[1].font!.resolvedFontFamily = 'Local Schedule';
    expect(first.richText?.runs[1].font?.resolvedFontFamily).toBeUndefined();
  });

  it('includes the run face in diagnostics and refreshes its mapping without leaking into cached sessions', async () => {
    const canvas = vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null);
    const source = await createRichTextWorkbook();
    const host = document.body.appendChild(document.createElement('div'));
    const session = createXlsxPreviewDriver().createSession(host);
    try {
      await session.load(source, { descriptor: { source, extension: 'xlsx' } });
      expect(session.getState().fonts?.map(font => font.fontFamily)).toContain('Schedule Face');
      const references = session.getFontReferences?.() ?? [];
      expect(references.map(font => font.fontFamily)).toContain('Schedule Face');
      session.refreshFonts?.({ references: references.map(font => font.fontFamily === 'Schedule Face'
        ? { ...font, resolvedFontFamily: 'Local Schedule' } : font), loaded: [], warnings: [], relayout: true });
      const run = () => [...host.querySelectorAll('td span span')].find(node => node.textContent === '<b>中文</b>') as HTMLElement;
      expect(run().style.fontFamily).toContain('Local Schedule');
      await session.load(source, { descriptor: { source, extension: 'xlsx' } });
      expect(run().style.fontFamily).not.toContain('Local Schedule');
    } finally { session.destroy(); host.remove(); canvas.mockRestore(); }
  });
});
