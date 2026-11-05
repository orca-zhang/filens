import { describe, expect, it } from 'vitest';
import { createCadPreviewDriver, loadCadDrawing } from '../src';
import type { CadModel, ModelEntity, ModelGeometry } from '../src/cad-model';

const point = (x = 0, y = 0) => ({ x, y, z: 0 });
const entity = (kind: ModelGeometry): ModelEntity => ({ kind, layer: '0', color: { type: 'by_layer' },
  lineweight: { type: 'by_layer' }, visible: true, props: {}, attributes: [] });
const model = (...entities: ModelEntity[]): CadModel => ({ schema_version: 1, source: { format: 'dwg', version: 'AC1032' },
  units: { unit: 'millimeter' }, layers: [{ ...entity({ type: 'point', position: point() }), name: 'WALLS',
    color: { type: 'aci', index: 3 }, frozen: false, locked: false }],
  models: [{ kind: 'model', entities }], blocks: [], text_styles: [], linetypes: [], warnings: [] });
const load = (drawing: CadModel) => loadCadDrawing(JSON.stringify(drawing));

describe('native DWG drawing model', () => {
  it('preserves block transforms, ByBlock colors, layer inheritance and world-space attributes', () => {
    const line = entity({ type: 'line', start: point(1, 1), end: point(3, 1) });
    line.color = { type: 'by_block' };
    const insert = entity({ type: 'insert', block: 'INNER', position: point(10, 20), scale: { x: 2, y: 2, z: 1 },
      rotation: Math.PI / 2, columns: 1, rows: 1, column_spacing: 0, row_spacing: 0 });
    insert.layer = 'WALLS'; insert.color = { type: 'rgb', r: 220, g: 80, b: 10 };
    insert.attributes = [{ value: 'A-01', position: point(12, 23), invisible: false,
      display: { height: 2, rotation: 0, halign: 'center', valign: 'middle' } }];
    const source = model(insert);
    source.blocks = [{ name: 'INNER', base_point: point(1, 1), entities: [line] }];
    const drawing = load(source);
    expect(drawing.entities[0]).toMatchObject({ type: 'line', layer: 'WALLS', color: '#dc500a', start: { x: 10, y: 20 } });
    expect(drawing.entities[0].type === 'line' && drawing.entities[0].end.y).toBeCloseTo(24);
    expect(drawing.entities[1]).toMatchObject({ type: 'text', value: 'A-01', point: { x: 12, y: 23 }, horizontalAlign: 'center' });
  });

  it('reuses nested block geometry without retaining an earlier insertion transform or color', () => {
    const line = entity({ type: 'line', start: point(), end: point(1, 0) });
    line.color = { type: 'by_block' };
    const insert = (block: string, x: number) => entity({ type: 'insert', block, position: point(x, 0),
      scale: point(1, 1), rotation: 0, columns: 1, rows: 1, column_spacing: 0, row_spacing: 0 });
    const inner = insert('INNER', 5);
    inner.color = { type: 'by_block' };
    const first = insert('OUTER', 10), second = insert('OUTER', 20);
    first.color = { type: 'rgb', r: 220, g: 80, b: 10 }; first.layer = 'WALLS';
    second.color = { type: 'rgb', r: 10, g: 80, b: 220 }; second.layer = 'OTHER';
    const source = model(first, second);
    source.blocks = [{ name: 'INNER', base_point: point(), entities: [line] },
      { name: 'OUTER', base_point: point(), entities: [inner] }];
    expect(load(source).entities).toMatchObject([
      { type: 'line', start: { x: 15, y: 0 }, end: { x: 16, y: 0 }, color: '#dc500a', layer: 'WALLS' },
      { type: 'line', start: { x: 25, y: 0 }, end: { x: 26, y: 0 }, color: '#0a50dc', layer: 'OTHER' }
    ]);
  });

  it.each(['RAY', 'XLINE'])('repairs decoded %s geometry and removes its obsolete mapping warning', type => {
    const ray = entity({ type: 'unknown', type_name: `dwg.${type}` });
    ray.props = { 'dwg.point': [2, 3, 0], 'dwg.direction': [1, 0, 0] };
    const source = model(ray); source.warnings = [{ message: `1 ${type} entities mapped to Unknown` }];
    expect(load(source)).toMatchObject({ entities: [{ type: 'construction-line', point: { x: 2, y: 3 },
      direction: { x: 1, y: 0 }, ray: type === 'RAY' }], warnings: [] });
  });

  it('expands dimension blocks and falls back to definition points when the block is missing', () => {
    const dim = entity({ type: 'dimension', block: '*D1', points: [point(0, 1), point(3, 1)], measurement: 3 });
    const source = model(dim);
    source.blocks = [{ name: '*D1', base_point: point(), entities: [entity({ type: 'line', start: point(0, 2), end: point(3, 2) })] }];
    expect(load(source).entities[0]).toMatchObject({ type: 'line', start: { x: 0, y: 2 } });
    source.blocks = [];
    expect(load(source).entities[0]).toMatchObject({ type: 'dimension', text: '3', start: { x: 0, y: 1 } });
  });

  it('draws visible constant attributes and skips invisible metadata and variable templates', () => {
    const definitions = [0, 2, 3].map(flags => {
      const definition = entity({ type: 'unknown', type_name: 'dwg.ATTDEF' });
      definition.props = { 'dwg.flags': flags, 'dwg.insertion_point': [1, 2, 0], 'dwg.height': 3, 'dwg.default': 'A-01' };
      return definition;
    });
    const drawing = load(model(...definitions));
    expect(drawing.entities).toMatchObject([{ type: 'text', value: 'A-01', point: { x: 1, y: 2 }, height: 3 }]);
    expect(drawing.warnings).toEqual([]);
  });

  it('bounds insert arrays and cyclic block expansion', () => {
    const insert = entity({ type: 'insert', block: 'B', position: point(), scale: { x: 1, y: 1, z: 1 }, rotation: 0,
      rows: 1, columns: 1_000_000, row_spacing: 1, column_spacing: 1 });
    const source = model(insert);
    source.blocks = [{ name: 'B', base_point: point(), entities: [entity({ type: 'point', position: point() })] }];
    expect(() => load(source)).toThrow('INSERT array exceeds');
    if (insert.kind.type === 'insert') { insert.kind.columns = -1; insert.kind.rows = -1; }
    expect(() => load(source)).toThrow('INSERT array exceeds');
    if (insert.kind.type === 'insert') insert.kind.rows = 1;
    if (insert.kind.type === 'insert') insert.kind.columns = 1;
    source.blocks[0].entities = [insert];
    expect(load(source).warnings.join(' ')).toContain('cyclic');
  });

  it('keeps DWG diagnostics when fonts and resources are resolved', async () => {
    const source = model(entity({ type: 'unknown', type_name: 'dwg.ACAD_TABLE' }));
    const host = document.body.appendChild(document.createElement('div'));
    const session = createCadPreviewDriver().createSession(host, { fontResolver: () => 'sans-serif', resourceResolver: () => null });
    const bytes = new TextEncoder().encode(JSON.stringify(source));
    try {
      await session.load(bytes, { descriptor: { source: bytes, extension: 'cad-json' } });
      expect(session.getState().warnings.join(' ')).toContain('ACAD_TABLE');
    } finally { session.destroy(); host.remove(); }
  });
});
