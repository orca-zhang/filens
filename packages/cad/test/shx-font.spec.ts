import { describe, expect, it, vi } from 'vitest';
import { createCadPreviewDriver } from '../src';
import { layoutShxText, parseShxFont, type ShxFont } from '../src/shx-font';
import { createShxDxf, createShxFixture, testShxFont } from './fixtures/shx.mjs';

const budget = () => ({ instructions: 20_000, strokes: 10_000 });
const layout = (font: ShxFont, labels: string[], big?: ShxFont) =>
  layoutShxText(labels, font, big, 4, 'left', 'baseline', budget());
const big = createShxFixture('bigfont 1.0', [
  [0x93fa, [7, 0, 0xfe, 0x81, 2, 1, 2, 4, 2, 0x80, 0]],
  [0xfe81, [0x44, 0x40, 0]]
], [4, 0, 2, 4, 0], [[0x81, 0x9f]]);

describe('SHX strokes', () => {
  it('uses pen advances, width and per-line anchoring', () => {
    const font = parseShxFont(testShxFont);
    const result = layoutShxText(['AA', 'A'], font, undefined, 4, 'center', 'top', budget());
    expect(result?.path).toBe('M-10 4L-10 0L-6 0L-6 4M0 4L0 0L4 0L4 4M-5 9L-5 5L-1 5L-1 9');
    expect(result?.bounds).toEqual({ minX: -10, maxX: 10, minY: 0, maxY: 9 });
  });

  it('runs Unicode subshapes, position stack, scaling, and complete vertical-only instructions', () => {
    const font = parseShxFont(createShxFixture('unifont 1.0', [
      [0x41, [5, 14, 9, 9, 20, 0, 0, 7, 0x20, 0xac, 6, 3, 2, 0x40, 4, 2, 0]],
      [0x20ac, [8, 4, 4, 0]]
    ], [4, 0, 2, 0, 0, 0]));
    expect(layout(font, ['A€'])?.path).toBe('M0 0L4 -4M0 0L2 0M2 0L6 -4');
  });

  it('emits circular, fractional and bulge arcs, with clockwise SVG sweep', () => {
    const font = parseShxFont(createShxFixture('shapes 1.0', [
      [65, [10, 2, 0, 10, 2, 0x82, 11, 0, 0, 0, 2, 2, 12, 2, 0, 129, 0]]
    ], [4, 0, 0, 0]));
    const result = layout(font, ['A']);
    expect(result?.path).toMatch(/^M0 0A2 2 0 0 0 -4 -[\de.-]+A2 2 0 0 0 0 0A2 2 0 0 1 -2 2A2 2 0 0 0 -4 0A1 1 0 0 1 -2 0$/);
    expect(result?.bounds).toEqual({ minX: -4, maxX: 0, minY: -2, maxY: 2 });
  });

  it('looks up packed code-page glyphs and scales Big Font primitives in two axes', () => {
    const font = parseShxFont(testShxFont), jp = parseShxFont(big, 'shift_jis');
    const result = layout(font, ['A日'], jp);
    expect(result?.path).toBe('M0 0L0 -4L4 -4L4 0M12 -1L12 -5L14 -5');
    expect(result?.bounds).toEqual({ minX: 0, maxX: 18, minY: -5, maxY: 0 });
    expect(result?.fonts).toEqual(new Set([font, jp]));
    expect(layout(font, ['日'], parseShxFont(big))).toBeUndefined();
  });

  it('rejects truncated files and isolates recursive or truncated glyph programs', () => {
    expect(() => parseShxFont(testShxFont.subarray(0, -6))).toThrow();
    const font = parseShxFont(createShxFixture('shapes 1.0',
      [[65, [7, 65, 0]], [66, [9, 1]], [67, [0x40, 0]]], [4, 0, 0, 0]));
    expect(layout(font, ['A'])).toBeUndefined();
    expect(layout(font, ['B'])).toBeUndefined();
    expect(layout(font, ['C'])?.path).toBe('M0 0L4 0');
  });
});

describe('CAD SHX sidecars', () => {
  it('decodes a legacy DXF, resolves each sidecar once, keeps missing text readable and preserves paths on refresh', async () => {
    const dxf = createShxDxf({ labels: ['A@@', 'AA', 'A?'], secondary: 'japanese', legacy: true, hidden: true });
    const source = Uint8Array.from(dxf, character => character.charCodeAt(0));
    source.set([0x93, 0xfa], dxf.indexOf('@@'));
    const resourceResolver = vi.fn(({ name }) => name === 'japanese.shx' ? big : testShxFont);
    const host = document.createElement('div'), session = createCadPreviewDriver().createSession(host, { resourceResolver });
    try {
      await session.load(source, { descriptor: { source, extension: 'dxf' } });
      expect(resourceResolver.mock.calls.map(([request]) => request)).toEqual([
        { family: 'cad', sourceFormat: 'dxf', source: 'fonts\\stroke.shx', relation: 'font', name: 'stroke.shx' },
        { family: 'cad', sourceFormat: 'dxf', source: 'japanese.shx', relation: 'font', name: 'japanese.shx' }
      ]);
      expect([...host.querySelectorAll('[data-shx-text]')].map(node => node.getAttribute('aria-label'))).toEqual(['A日', 'AA']);
      expect(host.querySelector('text')?.textContent).toBe('A?');
      expect(session.getState().warnings.join()).toMatch(/glyphs are missing or unsupported/);
      expect(session.getState().fonts).toEqual(expect.arrayContaining([
        expect.objectContaining({ fontFile: 'fonts\\stroke.shx', status: 'available', source: 'application' }),
        expect.objectContaining({ fontFile: 'japanese.shx', status: 'available', source: 'application' })
      ]));
      session.toggleLayer?.('LABELS', true);
      session.refreshFonts?.({ references: [...session.getFontReferences!()], loaded: [], warnings: [], relayout: true });
      expect(host.querySelector('[data-shx-text]')?.hasAttribute('display')).toBe(false);
      expect(session.getState().fonts?.filter(font => font.status === 'available')).toHaveLength(2);
    } finally { session.destroy(); }
  });

  it('gives explicit browser aliases priority over sidecars', async () => {
    const source = new TextEncoder().encode(createShxDxf());
    const resourceResolver = vi.fn(() => testShxFont);
    const host = document.createElement('div'), session = createCadPreviewDriver().createSession(host, { resourceResolver, fontResolver: () => 'system-ui' });
    try {
      await session.load(source, { descriptor: { source, extension: 'dxf' } });
      expect(resourceResolver).not.toHaveBeenCalled();
      expect(host.querySelector('text')?.textContent).toBe('AA');
    } finally { session.destroy(); }
  });
});
