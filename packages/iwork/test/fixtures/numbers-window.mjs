// Sparse semantic models isolate grid rendering from Numbers archive parsing.
export function createNumbersWindowFixture(rowCount = 100_000, columnCount = 1024) {
  const table = (id, rows, columns) => ({
    id, kind: 'table', order: 0, groupPath: [], fill: { type: 'none' },
    transform: { x: 0, y: 0, width: 800, height: 600, rotation: 0, flipH: false, flipV: false },
    rows: Array(rows).fill(26), columns: Array(columns).fill(96),
    cells: [[0, 0, `${id} first`], [rows - 1, columns - 1, `${id} last`]].map(([row, column, text]) => ({
      row, column, rowSpan: 1, colSpan: 1, isMergedContinuation: false, fill: { type: 'none' },
      textFrame: { paragraphs: [{ runs: [{ text }] }] }
    }))
  });
  const sheets = [0, 1].map(index => ({
    id: `sheet-${index}`, index, name: `Sheet ${index + 1}`, loaded: true,
    canvas: {
      id: `sheet-${index}`, title: `Sheet ${index + 1}`, width: 800, height: 600,
      slide: { id: `sheet-${index}`, index, width: 800, height: 600,
        background: { type: 'solid', color: '#ffffff', alpha: 1 }, items: [], warnings: [] }
    },
    tables: (index ? [table('other', 2, 2)] : [table('large', rowCount, columnCount), table('tail', 3, 2)])
      .map(item => ({ id: item.id, item }))
  }));
  return { kind: 'numbers', archive: { type: 'numbers', records: {}, references: { outgoing: {}, incoming: {} }, dataEntries: {}, warnings: [] }, media: {}, warnings: [], sheets };
}

export function createNumbersPictureFixture(rowCount = 5000, columnCount = 64) {
  const document = createNumbersWindowFixture(rowCount, columnCount);
  const table = document.sheets[0].tables[0].item;
  table.rows = Array.from({ length: rowCount }, (_, index) => index % 11 === 0 ? 64 : 26);
  for (const row of new Set([0, Math.floor(rowCount / 2), rowCount - 1])) {
    for (const [column, mediaId] of [[0, 'picture-tall'], [columnCount - 1, 'picture-wide']]) {
      let cell = table.cells.find(cell => cell.row === row && cell.column === column);
      if (!cell) {
        cell = { row, column, rowSpan: 1, colSpan: 1, isMergedContinuation: false, fill: { type: 'none' }, textFrame: { paragraphs: [{ runs: [{ text: `Picture ${row + 1}:${column + 1}` }] }] } };
        table.cells.push(cell);
      }
      cell.fill = { type: 'picture', mediaId };
    }
  }
  document.media = Object.fromEntries([['picture-tall', 80, 240], ['picture-wide', 240, 80]].map(([id, width, height]) => [id, {
    id, path: `Data/${id}.svg`, contentType: 'image/svg+xml',
    data: new TextEncoder().encode(`<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}"><rect width="100%" height="100%" fill="#2563eb"/></svg>`)
  }]));
  return document;
}

export function createNumbersMergedFixture() {
  const document = createNumbersPictureFixture();
  const table = document.sheets[0].tables[0].item;
  Object.assign(table.cells.find(cell => cell.row === 0 && cell.column === 0), { rowSpan: 3, colSpan: 4 });
  Object.assign(table.cells.find(cell => cell.row === 2500 && cell.column === 0), { rowSpan: 1000, colSpan: 64 });
  // Covered values remain in the semantic model but must not produce extra grid cells.
  table.cells.push({ row: 1, column: 1, rowSpan: 1, colSpan: 1, isMergedContinuation: true, fill: { type: 'none' },
    textFrame: { paragraphs: [{ runs: [{ text: 'Covered Numbers value' }] }] } });
  return document;
}

export function createNumbersStyledFixture() {
  const document = createNumbersWindowFixture(2000, 64), table = document.sheets[0].tables[0].item;
  table.rows[0] = 160;
  const borders = { top: { width: 2, color: '#b91c1c', dash: 'dash' }, right: { width: 1, color: '#0369a1' },
    bottom: { width: 3, color: '#047857', compound: 'double' }, left: { width: .5, color: '#111827' } };
  table.cells[0] = { ...table.cells[0], fill: { type: 'solid', color: '#fef3c7' }, borders,
    textFrame: { padding: { top: 6, right: 10, bottom: 8, left: 12 }, verticalAlign: 'bottom', wrap: 'square', paragraphs: [
      { align: 'right', runs: [
        { text: 'Revenue ', fontFamily: 'Courier New', fontSize: 18, bold: true, underline: true, color: '#b91c1c', highlightColor: '#fde68a', href: 'https://example.com/report' },
        { text: '2026', fontFamily: 'Georgia', fontSize: 14, italic: true, strike: true, baselineShift: .2, color: '#0369a1' }
      ] },
      { align: 'left', marginLeft: 2, indent: 1, spaceBefore: 3, spaceAfter: 2, lineHeight: 1.25,
        runs: [{ text: 'Source wrapping stays readable.', fontFamily: 'Georgia', fontSize: 14 }] }
    ] } };
  const cell = (row, column, text, fill) => ({ row, column, rowSpan: 1, colSpan: 1, isMergedContinuation: false, fill,
    textFrame: { padding: { top: 4, right: 4, bottom: 4, left: 4 }, verticalAlign: 'top', wrap: 'none',
      paragraphs: [{ runs: [{ text, fontFamily: 'Courier New', fontSize: 14 }] }] } });
  const gradient = { type: 'gradient', angle: 90, stops: [{ position: 0, color: '#eff6ff' }, { position: 1, color: '#60a5fa' }] };
  table.cells.push(cell(1, 0, 'Gradient', gradient));
  table.cells.push(cell(1, 1, 'Pattern', { type: 'pattern', pattern: 'smGrid', foregroundColor: '#0f172a', backgroundColor: '#e2e8f0' }));
  const merged = cell(90, 1, 'Merged styled', gradient);
  merged.rowSpan = 150; merged.colSpan = 20; merged.borders = borders;
  merged.textFrame.verticalAlign = 'middle'; merged.textFrame.paragraphs[0].align = 'center';
  Object.assign(merged.textFrame.paragraphs[0].runs[0], { fontFamily: 'Georgia', fontSize: 20, bold: true });
  table.cells.push(merged);
  table.cells[1] = cell(1999, 63, 'Styled last', { type: 'solid', color: '#d1fae5' });
  return document;
}

export function createNumbersColumnWidthFixture() {
  const document = createNumbersStyledFixture(), table = document.sheets[0].tables[0].item;
  table.columns = table.columns.map((_, index) => [40, 220, 56, 360][index % 4]);
  table.columns[30] = 2400;
  table.cells.push({ ...table.cells[1], row: 0, column: 30,
    textFrame: { paragraphs: [{ runs: [{ text: 'Wide source column' }] }] } });
  document.sheets[0].tables[1].item.columns = [36, 280];
  return document;
}
