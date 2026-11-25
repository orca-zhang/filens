import { describe, expect, it } from 'vitest';
import { conditionalFormattingWindow } from '../src/conditional-formatting';
import { conditionalIcons, createConditionalIcon, type ConditionalIconSetName } from '../src/conditional-icons';
import { readIconSet } from '../src/conditional-visual-rules';
import { loadXlsxWorkbook } from '../src/parser';
import type { ParsedSheet } from '../src/types';
import { clonePreviewWorkbook } from '../src/workbook-cache';
import { createConditionalIconWorkbook } from './fixtures/conditional-icon-workbook.mjs';

const at = (sheet: ParsedSheet, row: number, column: number) =>
  sheet.rows.find(entry => entry.index === row)?.cells.find(cell => cell.column === column);

describe('XLSX conditional icon sets', () => {
  it('resolves percentile and formula thresholds from sparse cells and honors exclusive boundaries and reversal', async () => {
    const workbook = await loadXlsxWorkbook(await createConditionalIconWorkbook());
    expect(workbook.warnings).toEqual(['Ignored 2 invalid conditional formatting rules in sheet Icon Rules.']);
    const [sheet] = workbook.sheets;
    const view = conditionalFormattingWindow(sheet, 1, 8, 1, 8)!;
    const icon = (row: number, column: number) => view(row, column, at(sheet, row, column))?.iconSet;
    expect(at(sheet, 1_048_576, 1)?.needsCalculation).toBe(true);
    expect(icon(4, 1)?.icon).toEqual({ set: '3TrafficLights1', index: 0 });
    expect(at(sheet, 1_048_576, 1)?.value).toBe('120');
    expect(icon(6, 1)?.icon?.index).toBe(1);
    expect(icon(5, 1)?.icon?.index).toBe(2);
    expect(icon(7, 1)).toBeUndefined();
    expect(icon(8, 1)).toBeUndefined();
    expect([1, 2, 3, 4, 5].map(row => icon(row, 2)?.icon?.index)).toEqual([4, 3, 2, 1, 0]);
    expect(icon(1, 2)?.showValue).toBe(false);
    expect(icon(1_048_576, 16_384)?.icon).toEqual({ set: '5ArrowsGray', index: 0 });
    expect(icon(500, 6)?.icon).toEqual({ set: '3Flags', index: 2 });
  });

  it('applies standalone Office 2010 custom icons and active formulas before lower-priority rules', async () => {
    const { sheets: [sheet] } = await loadXlsxWorkbook(await createConditionalIconWorkbook());
    const view = conditionalFormattingWindow(sheet, 1, 6, 1, 8)!;
    const icon = (row: number, column: number) => view(row, column, at(sheet, row, column))?.iconSet;
    expect(icon(1, 3)).toEqual({ icon: null, showValue: false });
    expect(icon(2, 3)).toEqual({ icon: { set: '3Stars', index: 1 }, showValue: false });
    expect(icon(3, 3)?.icon).toEqual({ set: '5Boxes', index: 4 });
    expect(icon(4, 3)).toEqual({ icon: { set: '3Flags', index: 2 }, showValue: true });
    expect(icon(5, 3)?.icon).toEqual({ set: '3Triangles', index: 2 });
    expect(icon(2, 5)?.icon).toEqual({ set: '3Stars', index: 0 });
    expect(icon(3, 5)?.icon).toEqual({ set: '3Stars', index: 2 });
    expect(icon(1, 6)).toBeUndefined();
  });

  it('keeps rules on the numeric fast path and evaluates cloned names against their own workbook', async () => {
    const [workbook, general] = await Promise.all([false, true].map(async forceGeneral =>
      loadXlsxWorkbook(await createConditionalIconWorkbook(forceGeneral))));
    expect(workbook.sheets[1]).toEqual(general.sheets[1]);
    expect(workbook.sheets[1].rowCount).toBe(2);
    expect(workbook.sheets[1].conditionalRules?.[0].ranges[0].lastRow).toBe(1_048_576);
    const copy = clonePreviewWorkbook(workbook);
    at(copy.sheets[2], 1, 1)!.value = '110';
    const iconAt = (sheet: ParsedSheet) => conditionalFormattingWindow(sheet, 1, 8, 1, 8)!(5, 1, at(sheet, 5, 1))?.iconSet?.icon;
    expect(iconAt(copy.sheets[0])?.index).toBe(1);
    expect(iconAt(workbook.sheets[0])?.index).toBe(2);
  });

  it('maps every built-in OpenXML icon to a named graphic and rejects invalid cardinality', () => {
    const base = ['3Arrows', '3ArrowsGray', '3Flags', '3TrafficLights1', '3TrafficLights2', '3Signs', '3Symbols', '3Symbols2',
      '4Arrows', '4ArrowsGray', '4RedToBlack', '4Rating', '4TrafficLights', '5Arrows', '5ArrowsGray', '5Rating', '5Quarters'] as const;
    const extended = ['3Stars', '3Triangles', '5Boxes'] as const;
    expect(Object.keys(conditionalIcons).sort()).toEqual([...base, ...extended].sort());
    for (const set of [...base, ...extended]) {
      const count = Number(set[0]);
      const xml = { iconSet: set, cfvo: Array.from({ length: count }, (_, position) => ({ type: 'num', val: String(position) })) };
      const extension = (extended as readonly ConditionalIconSetName[]).includes(set);
      const definition = readIconSet(xml, extension);
      expect(definition?.icons).toHaveLength(count);
      for (const icon of definition!.icons) {
        const graphic = createConditionalIcon(document, icon!.set, icon!.index)!;
        expect(graphic.getAttribute('role')).toBe('img');
        expect(graphic.getAttribute('aria-label')).toBeTruthy();
        expect(graphic.dataset.shape).toBeTruthy();
      }
      expect(readIconSet({ ...xml, cfvo: [...xml.cfvo, { type: 'max' }] }, extension)).toBeUndefined();
    }
  });
});
