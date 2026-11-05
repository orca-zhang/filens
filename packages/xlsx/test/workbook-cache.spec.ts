import { webcrypto } from 'node:crypto';
import JSZip from 'jszip';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { previewModelCache, type PreviewLoadContext } from '@filens/core';
import * as parser from '../src/parser';
import { loadPreviewWorkbook } from '../src/workbook-cache';
import { createColumnStyledWorkbookFixture, createWorkbookFixture } from './fixtures/workbook.mjs';

const context = (extension = 'xlsx'): PreviewLoadContext => ({ descriptor: { extension, name: `same.${extension}` } });
beforeEach(() => { previewModelCache.clear(); vi.stubGlobal('crypto', webcrypto); });
afterEach(() => { previewModelCache.clear(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

describe('workbook preview reuse', () => {
  it('reuses parsing while isolating cells, formulas and font aliases between tabs', async () => {
    const bytes = await createColumnStyledWorkbookFixture(3, 8), parse = vi.spyOn(parser, 'loadXlsxWorkbook');
    const first = await loadPreviewWorkbook(bytes, context()), expected = structuredClone(first);
    first.sheets[0].rows[0].cells[0].value = 'tab 1'; first.fonts![0].resolvedFontFamily = 'tab font';
    const second = await loadPreviewWorkbook(bytes, context());
    expect(second).toEqual(expected); expect(parse).toHaveBeenCalledOnce();
    expect(second.fonts![0]).not.toBe(first.fonts![0]);
    const cell = second.sheets[0].rows[0].cells[0]; expect(second.fonts).toContain(cell.font);
    const formulas = await createWorkbookFixture(), one = await loadPreviewWorkbook(formulas, context());
    const formula = one.sheets[0].rows[0].cells.find(cell => cell.formula)!;
    formula.value = 'calculated'; formula.needsCalculation = false;
    const two = await loadPreviewWorkbook(formulas, context());
    expect(two.sheets[0].rows[0].cells.find(cell => cell.formula)).toMatchObject({ value: '', needsCalculation: true });
  });
  it('invalidates by content even for identical filenames and preserves borrowed input', async () => {
    const source = await createWorkbookFixture(), saved = source.slice();
    const task = loadPreviewWorkbook(source, context()); source.fill(0); const first = await task;
    expect(first.sheets[0].name).toBe('First');
    const zip = await JSZip.loadAsync(saved); zip.file('xl/workbook.xml', (await zip.file('xl/workbook.xml')!.async('string')).replace('First', 'Changed'));
    const next = await loadPreviewWorkbook(await zip.generateAsync({ type: 'uint8array' }), context());
    expect(next.sheets[0].name).toBe('Changed');
  });
  it('bypasses password and CSV input and refuses a pre-aborted cache hit', async () => {
    const bytes = await createWorkbookFixture(); await loadPreviewWorkbook(bytes, context());
    const parse = vi.spyOn(parser, 'loadXlsxWorkbook');
    await loadPreviewWorkbook(bytes, { descriptor: { extension: 'xlsx', password: 'secret' } });
    expect(parse).toHaveBeenCalledOnce();
    await loadPreviewWorkbook(new TextEncoder().encode('a,b'), context('.CSV')); expect(previewModelCache.size).toBe(1);
    const controller = new AbortController(); controller.abort();
    await expect(loadPreviewWorkbook(bytes, { ...context(), signal: controller.signal })).rejects.toMatchObject({ name: 'AbortError' });
  });
});
