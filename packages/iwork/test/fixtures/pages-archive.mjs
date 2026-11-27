import { createIworkArchive } from './iwa-archive.mjs';

export const pagesTallCellText = Array.from({ length: 80 }, (_, i) => `Entry ${i + 1} 中文 e\u0301 👩‍💻. `).join('') +
  '分页👩‍💻e\u0301'.repeat(60);
export const pagesTallMergeText = Array.from({ length: 28 }, (_, i) => `Merged ${i + 1} 文. `).join('') + 'W'.repeat(220);
export const pagesWrappedTableTail = 'A visible line VIII starts here. 中文 e\u0301 👩‍💻 ' +
  'The text wraps across the bottom of the saved body region and continues';

export const pagesLongBodyText = Array.from({ length: 90 }, (_, i) =>
  `Entry ${i + 1} 中文 e\u0301 👩‍💻${i % 15 === 6 ? ' «\uFFFC»' : ''}. `).join('') + '分页👩‍💻e\u0301'.repeat(40);

export const pagesSavedTextLines = [
  ['Ordinary body', 'Page \uFFFC of \uFFFC.'],
  ['Overflowing body', '中文 e\u0301 👩‍💻 and readable text', 'Page \uFFFC of \uFFFC.'],
  [...Array.from({ length: 16 }, (_, index) => `Archived paragraph ${index + 1}`), 'Page \uFFFC of \uFFFC.']
];

export function createPagesSavedColumnsArchive() {
  const ref = identifier => ({ identifier });
  const segments = [
    ['Left column joins ', '\u000cthe right column on page \uFFFC.\n'],
    ['Upper left.\n', 'Upper right.\n', 'Lower left.\n', 'Lower right.\n'],
    ['Saved left.\n', 'Saved right.\n'],
    ['Full-width text.']
  ];
  const body = segments.flat().join('');
  let location = 0;
  const targets = segments.map(page => page.map(text => {
    const skip = Number(text.startsWith('\u000c'));
    const hint = { range: { location: location + skip, length: text.length - skip }, columnCount: 2 };
    location += text.length;
    return hint;
  }));
  const frame = (hint, x, y, width, height) => ({ ...hint, doubleOrigin: { x, y }, doubleSize: { width, height } });
  const [upperLeft, upperRight, lowerLeft, lowerRight] = targets[1];
  const band = (first, last, y, height) => frame({ columnCount: 2, range: {
    location: first.range.location, length: last.range.location + last.range.length - first.range.location
  } }, 20, y, 280, height);
  const pageHints = [
    { targetHints: targets[0] },
    { targetHints: [band(upperLeft, upperRight, 12, 86), frame(upperLeft, 20, 12, 122.5, 86), upperRight,
      band(lowerLeft, lowerRight, 118, 90), lowerLeft, lowerRight] },
    { flowHints: [frame(targets[2][0], 9, 10, 98, 140), frame(targets[2][1], 136, 10, 174, 140)] },
    { targetHints: [{ range: targets[3][0].range }] }
  ];
  return createIworkArchive([
    [1, 10000, 'TP.DocumentArchive', { bodyStorage: ref(2), pageWidth: 400, pageHeight: 320,
      topMargin: 40, bottomMargin: 40, leftMargin: 40, rightMargin: 40, deprecatedLayoutState: ref(3) }, [2, 3]],
    [2, 2001, 'TSWP.StorageArchive', { text: [body], tableLayoutStyle: { entries: [
      { characterIndex: 0, object: ref(4) }, { characterIndex: upperLeft.range.location, object: ref(6) },
      { characterIndex: lowerLeft.range.location, object: ref(9) }, { characterIndex: targets[3][0].range.location, object: ref(7) }
    ] }, tableAttachment: { entries: [{ characterIndex: body.indexOf('\uFFFC'), object: ref(8) }] } }, [4, 6, 7, 8, 9]],
    [3, 10131, 'TP.LayoutStateArchive', { sectionHints: [{ startPageIndex: 0, pageHints }] }, []],
    [4, 2024, 'TSWP.ColumnStyleArchive', { super: { parent: ref(5) } }, [5]],
    [5, 2024, 'TSWP.ColumnStyleArchive', { super: {}, columnProperties: { columns: {
      nonEqualColumns: { first: 0.25, following: [{ gap: 0.125, width: 0.625 }] }
    } } }, []],
    [6, 2024, 'TSWP.ColumnStyleArchive', { super: { parent: ref(5) }, columnProperties: { columns: {
      equalColumns: { count: 2, gap: 0.125 }
    } } }, [5]],
    [7, 2024, 'TSWP.ColumnStyleArchive', { super: { parent: ref(5) }, columnProperties: { columnsNull: true } }, [5]],
    [8, 2043, 'TSWP.NumberAttachmentArchive', { super: { kind: 0 }, numberFormat: 0, stringValue: '99' }, []],
    [9, 2024, 'TSWP.ColumnStyleArchive', { super: { parent: ref(6) }, columnProperties: { columns: {
      nonEqualColumns: { first: 0.25, following: [{ gap: 0.125, width: 0.625 }] }
    } } }, [6]]
  ]);
}

export const pagesAggregateColumnText = 'First column starts here.\n\uFFFC\nLine wraps across the next column: 中文 e\u0301 👩‍💻 and page \uFFFC.';
export const pagesEstimatedColumnOverflowText = pagesLongBodyText.replaceAll('\uFFFC', '');

export function createPagesAggregateColumnsArchive({ overflow = false, savedLayout = true } = {}) {
  const ref = identifier => ({ identifier });
  const savedPrefix = savedLayout === 'prefix' ? 'Saved prefix.\n' : '';
  const leftText = overflow ? Array.from({ length: 9 }, (_, i) => `Archived left ${i + 1}.`).join('\n') + '\n' : '';
  const rightText = overflow ? Array.from({ length: 20 }, (_, i) => `Archived right ${i + 1}.`).join('\n') + '\n' : '';
  const pages = savedLayout && !savedPrefix
    ? [pagesAggregateColumnText, `${leftText}Left stops here.\n\u000cRight starts here.\n${rightText}End of page \uFFFC.`, 'Saved page \uFFFC of \uFFFC.']
    : [`Equal left.\n\uFFFC\nLeft joins \u000cright on page \uFFFC.\n${Array.from({ length: 14 }, (_, i) => `Equal ${i + 1}.`).join('\n')}`,
      `Narrow.\u000cWide on page \uFFFC.${overflow ? `\n${pagesEstimatedColumnOverflowText}` : ''}`, 'Full on page \uFFFC of \uFFFC.'];
  const body = savedPrefix + pages.join('\n');
  let location = savedPrefix.length;
  const targets = pages.map((text, index) => {
    const length = text.length + Number(index < pages.length - 1);
    const range = { location, length };
    location += length;
    return { range };
  });
  const frame = (index, x, y, width, height) => ({ ...targets[index], ...(index === 0 ? { columnCount: 2 } : {}),
    doubleOrigin: { x, y }, doubleSize: { width, height } });
  return createIworkArchive([
    [1, 10000, 'TP.DocumentArchive', { bodyStorage: ref(2), pageWidth: 400, pageHeight: 320,
      topMargin: 40, bottomMargin: 40, leftMargin: 40, rightMargin: 40,
      ...(savedLayout ? { deprecatedLayoutState: ref(3) } : {}) }, savedLayout ? [2, 3] : [2]],
    [2, 2001, 'TSWP.StorageArchive', { text: [body], tableLayoutStyle: { entries: [
      { characterIndex: targets[0].range.location, object: ref(4) }, { characterIndex: targets[1].range.location, object: ref(5) },
      { characterIndex: targets[2].range.location }
    ] }, tableParaStyle: { entries: [{ characterIndex: 0, object: ref(6) }] },
    tableAttachment: { entries: Array.from(body.matchAll(/\uFFFC/g), ({ index: characterIndex }, i) => ({
      characterIndex, object: ref([9, 7, 7, 7, 8][i])
    })) } }, [4, 5, 6, 7, 8, 9]],
    ...(savedLayout ? [[3, 10131, 'TP.LayoutStateArchive', { sectionHints: [{ startPageIndex: 0, pageHints: savedPrefix ? [
      { targetHints: [{ range: { location: 0, length: savedPrefix.length }, doubleOrigin: { x: 12, y: 15 },
        doubleSize: { width: 250, height: 90 } }] }, { pageKind: 2 }
    ] : [
      { targetHints: [frame(0, 0, 12, 320, 112)] }, { flowHints: [frame(1, 16, 24, 288, 150)] },
      { pageKind: 2 }, { targetHints: [targets[2]] }
    ] }] }, []]] : []),
    [4, 2024, 'TSWP.ColumnStyleArchive', { super: {}, columnProperties: { columns: {
      equalColumns: { count: 2, gap: 0.125 }
    } } }, []],
    [5, 2024, 'TSWP.ColumnStyleArchive', { super: {}, columnProperties: { columns: {
      nonEqualColumns: { first: 0.25, following: [{ gap: 0.125, width: 0.625 }] }
    } } }, []],
    [6, 2022, 'TSWP.ParagraphStyleArchive', { super: {}, charProperties: { fontSize: 16 },
      paraProperties: { lineSpacing: { mode: 2, amount: 20 } } }, []],
    [7, 2043, 'TSWP.NumberAttachmentArchive', { super: { kind: 0 }, numberFormat: 0, stringValue: '99' }, []],
    [8, 2043, 'TSWP.NumberAttachmentArchive', { super: { kind: 1 }, numberFormat: 0, stringValue: '99' }, []],
    [9, 2003, 'TSWP.DrawableAttachmentArchive', { drawable: ref(10) }, [10]],
    [10, 3005, 'TSD.ImageArchive', { data: ref(11), super: { geometry: { size: { width: 65, height: 44 } } } }, []],
    [12, 11006, 'TSP.PackageMetadata', { lastObjectIdentifier: 12, datas: [
      { identifier: 11, digest: new Uint8Array(), preferredFileName: 'Column.svg', fileName: 'Column.svg' }
    ] }, []]
  ], { 'Data/Column.svg': new TextEncoder().encode(
    '<svg xmlns="http://www.w3.org/2000/svg" width="65" height="44"><rect width="65" height="44" fill="#345778"/></svg>'
  ) });
}

export function createPagesSavedTextFitArchive() {
  const ref = identifier => ({ identifier });
  const texts = pagesSavedTextLines.map(lines => lines.join('\n'));
  const body = texts.join('\n');
  let location = 0;
  const pageHints = texts.map((text, index) => {
    const length = text.length + Number(index < texts.length - 1);
    const targetHints = [{ range: { location, length }, doubleOrigin: { x: 20, y: 15 },
      doubleSize: { width: 260, height: [120, 88, 90][index] } }];
    location += length;
    return { pageKind: 1, targetHints };
  });
  return createIworkArchive([
    [1, 10000, 'TP.DocumentArchive', { bodyStorage: ref(2), pageWidth: 400, pageHeight: 320,
      topMargin: 40, bottomMargin: 40, leftMargin: 40, rightMargin: 40, deprecatedLayoutState: ref(3) }, [2, 3]],
    [2, 2001, 'TSWP.StorageArchive', { text: [body], tableParaStyle: { entries: [{ characterIndex: 0, object: ref(4) }] },
      tableAttachment: { entries: Array.from(body.matchAll(/\uFFFC/g), ({ index }, ordinal) => ({
        characterIndex: index, object: ref(ordinal % 2 ? 6 : 5)
      })) } }, [4, 5, 6]],
    [3, 10131, 'TP.LayoutStateArchive', { sectionHints: [{ startPageIndex: 0, pageHints }] }, []],
    [4, 2022, 'TSWP.ParagraphStyleArchive', { super: {}, charProperties: { fontSize: 20 },
      paraProperties: { lineSpacing: { mode: 2, amount: 24 } } }, []],
    [5, 2043, 'TSWP.NumberAttachmentArchive', { super: { kind: 0 }, numberFormat: 0, stringValue: '999' }, []],
    [6, 2043, 'TSWP.NumberAttachmentArchive', { super: { kind: 1 }, numberFormat: 0, stringValue: '999' }, []]
  ]);
}

export function createPagesLongBodyArchive({ inlineDrawable = false, savedLayout } = {}) {
  const ref = identifier => ({ identifier });
  const text = savedLayout === 'glyph' ? 'Lead paragraph.\nW\nFinal paragraph.'
    : `Lead paragraph.\n${pagesLongBodyText}\nW\nFinal paragraph.`;
  const anchor = inlineDrawable ? text.indexOf('Entry 46 ') : -1;
  const body = anchor >= 0 ? text.slice(0, anchor) + '\uFFFC' + text.slice(anchor) : text;
  const large = body.lastIndexOf('\nW\n') + 1;
  const prefixEnd = savedLayout === 'grapheme' ? body.indexOf('👩‍💻') + 1 : body.indexOf('Entry 11 ');
  const target = (start, end, x = 0, y = 0, width = 320, height = 240) => ({ pageKind: 1, targetHints: [{
    range: { location: start, length: end - start }, doubleOrigin: { x, y }, doubleSize: { width, height }
  }] });
  const savedPages = savedLayout === 'glyph'
    ? [target(0, large), target(large, large + 2, 20, 25, 120, 130), target(large + 2, body.length)]
    : [target(0, prefixEnd)];
  if (savedLayout === 'prefix') savedPages.push({ pageKind: 2 });
  if (savedLayout === 'gap' || savedLayout === 'overlap') {
    savedPages.push(target(body.indexOf(savedLayout === 'gap' ? 'Entry 13 ' : 'Entry 9 '), body.indexOf('Entry 21 ')));
  }
  return createIworkArchive([
    [1, 10000, 'TP.DocumentArchive', { bodyStorage: ref(2), pageWidth: 400, pageHeight: 320,
      topMargin: 40, bottomMargin: 40, leftMargin: 40, rightMargin: 40,
      ...(savedLayout ? { deprecatedLayoutState: ref(20) } : {}) }, savedLayout ? [2, 20] : [2]],
    [2, 2001, 'TSWP.StorageArchive', { text: [body], tableAttachment: { entries: Array.from(body.matchAll(/\uFFFC/g),
      ({ index }) => ({ characterIndex: index, object: ref(index === anchor ? 7 : 3) })) }, tableCharStyle: { entries: [
        { characterIndex: large, object: ref(4) }, { characterIndex: large + 1, object: ref(5) }
      ] }, tableParaStyle: { entries: [{ characterIndex: large, object: ref(6) }, { characterIndex: large + 2 }] } },
    [3, 4, 5, 6, ...(inlineDrawable ? [7] : [])]],
    [3, 2043, 'TSWP.NumberAttachmentArchive', { super: { kind: 0 }, numberFormat: 0, stringValue: '999' }, []],
    [4, 2021, 'TSWP.CharacterStyleArchive', { super: {}, charProperties: { fontSize: 480, bold: true } }, []],
    [5, 2021, 'TSWP.CharacterStyleArchive', { super: {}, charProperties: { fontSize: 16 } }, []],
    [6, 2022, 'TSWP.ParagraphStyleArchive', { super: {}, paraProperties: { lineSpacing: { mode: 2, amount: 16 } } }, []],
    ...(inlineDrawable ? [
      [7, 2003, 'TSWP.DrawableAttachmentArchive', { drawable: ref(8) }, [8]],
      [8, 3005, 'TSD.ImageArchive', { data: ref(9), super: { geometry: { size: { width: 100, height: 85 } } } }, []]
    ] : []),
    ...(savedLayout ? [[20, 10131, 'TP.LayoutStateArchive', {
      sectionHints: [{ startPageIndex: 0, pageHints: savedPages }]
    }, []]] : [])
  ]);
}

export function createPagesLongTableArchive({
  fittedRows = false, dataRows = 9, tallRow = false, tallMerge = false, mergeRow = 2, hideMergeAnchor = false, tallGlyph = false,
  savedFlow = false, packedPartitions = false, rowHeight = 60, firstPartitionRows = 2, partitionSuffix = '', partitionColumns,
  estimatedColumns = false
} = {}) {
  const ref = identifier => ({ identifier });
  const tail = savedFlow === 'long' ? `\n${pagesLongBodyText.replaceAll('\uFFFC', '')}` : '';
  const partitionOnly = savedFlow === 'partition-only';
  const partitioned = savedFlow === 'partition' || partitionOnly;
  const siblingImage = partitionColumns === 'continuation';
  const leadingTables = partitionColumns === 'leading-tables';
  const twoTables = partitionColumns === 'two-tables' || partitionColumns === 'stacked-tables' || leadingTables;
  const lead = savedFlow === 'leading' ? 'Saved lead ' : '';
  const image = savedFlow === 'image';
  const separator = savedFlow === 'split' ? ' ' : '\n';
  const wrappedGrowth = savedFlow === 'wrapped-growth';
  const afterObject = wrappedGrowth ? pagesWrappedTableTail.replace('VIII', '\uFFFC') : `After ${image ? 'image' : 'table'}`;
  const finalParagraph = savedFlow === 'single-growth' ? '' : '\nFinal paragraph.';
  const body = leadingTables
    ? 'Saved lead \uFFFC\nRight lead \uFFFC\nAfter table on page \uFFFC of \uFFFC.\nFinal paragraph.\nSaved next on page \uFFFC of \uFFFC.'
    : partitioned
    ? `${partitionColumns === 'anchor' ? 'Previous column.\n' : ''}Saved lead \uFFFC${partitionSuffix}\nAfter table on page \uFFFC of \uFFFC.\n${twoTables ? 'Right lead \uFFFC' : `Final paragraph.${siblingImage ? '\uFFFC' : ''}`}\nSaved next on page \uFFFC of \uFFFC.`
    : savedFlow
    ? `${lead}\uFFFC ${afterObject} on page \uFFFC of \uFFFC.${tail}${finalParagraph}${separator}Saved next on page \uFFFC of \uFFFC.`
    : 'Before table \uFFFC after table on page \uFFFC of \uFFFC.\nFinal paragraph.';
  const nextPage = body.indexOf('Saved next on page');
  const partitionText = body.indexOf('After table');
  const leadStart = body.indexOf('Saved lead');
  const finalStart = body.indexOf(twoTables ? 'Right lead' : 'Final paragraph.');
  const target = (start, end, x, width) => ({ range: { location: start, length: end - start },
    doubleOrigin: { x, y: 0 }, doubleSize: { width, height: 240 } });
  const attachmentIds = leadingTables ? [3, 29, 9, 10, 9, 10]
    : [3, ...(wrappedGrowth ? [28] : []), 9, 10, ...(siblingImage || twoTables ? [29] : []), 9, 10];
  const labels = ['Heading', ...Array.from({ length: dataRows }, (_, index) => `Row ${index + 1}`),
    tallMerge ? pagesTallMergeText : 'Merged rows'];
  if (tallRow) labels[1] = pagesTallCellText;
  const rowInfos = labels.slice(0, -1).map((_, tileRowIndex) => {
    const keys = [tileRowIndex + 1];
    if (tileRowIndex === mergeRow) keys.push(labels.length);
    else if (tileRowIndex === 1 && tallRow) keys.push(labels.length + 1);
    const cellStorageBuffer = Buffer.alloc(keys.length * 16);
    const cellOffsets = Buffer.alloc(4, 255);
    keys.forEach((key, column) => {
      const offset = column * 16;
      cellOffsets.writeUInt16LE(offset, column * 2);
      cellStorageBuffer[offset] = 5;
      cellStorageBuffer[offset + 1] = tallGlyph && tileRowIndex === 1 && column === 0 ? 9 : 3;
      cellStorageBuffer.writeUInt32LE(8, offset + 8);
      cellStorageBuffer.writeUInt32LE(key, offset + 12);
    });
    return { tileRowIndex, cellCount: keys.length, cellStorageBuffer, cellOffsets,
      cellStorageBufferPreBnc: new Uint8Array(), cellOffsetsPreBnc: new Uint8Array() };
  });
  if (tallRow && mergeRow !== 1) labels.push('Side note');
  const fittedHeight = row => tallRow && row === 1 ? 1000 : tallMerge && row >= mergeRow && row < mergeRow + 2 ? 145 : 60;
  const partitionHints = !partitioned ? [] : [
    [26, 0, firstPartitionRows, 0], [27, firstPartitionRows, rowInfos.length - firstPartitionRows, 1],
    ...(twoTables ? [[32, 0, leadingTables ? 1 : 4, 0],
      [33, leadingTables ? 1 : 4, rowInfos.length - (leadingTables ? 1 : 4), 1]] : [])
  ];
  return createIworkArchive([
    [1, 10000, 'TP.DocumentArchive', { bodyStorage: ref(2), pageWidth: 400, pageHeight: 320,
      topMargin: 40, bottomMargin: 40, leftMargin: 40, rightMargin: 40,
      ...(savedFlow ? { deprecatedLayoutState: ref(20), floatingDrawables: ref(21) } : {}) }, savedFlow ? [2, 20, 21] : [2]],
    [2, 2001, 'TSWP.StorageArchive', { text: [body], tableAttachment: { entries: Array.from(body.matchAll(/\uFFFC/g),
      ({ index }, i) => ({ characterIndex: index, object: ref(attachmentIds[i]) })) },
      ...(estimatedColumns ? { tableLayoutStyle: { entries: [{ characterIndex: 0, object: ref(34) }] } } : {}) },
    [...new Set(attachmentIds), ...(estimatedColumns ? [34] : [])]],
    [3, 2003, 'TSWP.DrawableAttachmentArchive', { drawable: ref(4) }, [4]],
    image ? [4, 3005, 'TSD.ImageArchive', { data: ref(25), super: { geometry: { size: { width: 320, height: 240 } } } }, []]
    : [4, 6000, 'TST.TableInfoArchive', { super: { geometry: { position: { x: 0, y: 0 }, size: { width: 320, height: rowInfos.length * rowHeight } } },
      tableModel: ref(5), ...(fittedRows ? { layoutEngine: { widthHeightCache: { columnsCount: 2,
        rowsFittingEntries: rowInfos.map((_, row) => ({ fittingSize: fittedHeight(row) })) } } } : {}) }, [5]],
    [5, 6001, 'TST.TableModelArchive', { tableName: 'Long report', numberOfRows: rowInfos.length, numberOfColumns: 2,
      defaultRowHeight: rowHeight, defaultColumnWidth: 160, numberOfHeaderRows: 1, repeatingHeaderRowsEnabled: true,
      ...(tallMerge ? { strokeSidecar: ref(11) } : {}),
      baseDataStore: { tiles: { tiles: [{ tileid: 0, tile: ref(6) }] }, stringTable: ref(7), mergeRegionMap: ref(8),
        ...(hideMergeAnchor ? { rowHeaders: { bucketHashFunction: 0, buckets: [ref(13)] } } : {}),
        ...(tallGlyph ? { richTextTable: ref(14) } : {}) } },
    [6, 7, 8, ...(tallMerge ? [11] : []), ...(hideMergeAnchor ? [13] : []), ...(tallGlyph ? [14] : [])]],
    [6, 6002, 'TST.Tile', { maxRow: rowInfos.length - 1, maxColumn: 1, numCells: labels.length, numrows: rowInfos.length, rowInfos }, []],
    [7, 6005, 'TST.TableDataList', { listType: 1, nextListID: labels.length + 1,
      entries: labels.map((string, index) => ({ key: index + 1, refcount: 1, string })) }, []],
    [8, 6107, 'TST.MergeRegionMapArchive', { cellRange: [{ origin: { packedData: (1 << 16) | mergeRow },
      size: { packedData: 0, numRows: 2, numColumns: 1 } }] }, []],
    [9, 2043, 'TSWP.NumberAttachmentArchive', { super: { kind: 0 }, numberFormat: 0 }, []],
    [10, 2043, 'TSWP.NumberAttachmentArchive', { super: { kind: 1 }, numberFormat: 0 }, []],
    ...(estimatedColumns ? [[34, 2024, 'TSWP.ColumnStyleArchive', { super: {}, columnProperties: { columns:
      estimatedColumns === 'unequal' ? { nonEqualColumns: { first: 0.375, following: [{ gap: 0.125, width: 0.5 }] } }
        : { equalColumns: { count: 2, gap: 0.125 } }
    } }, []]] : []),
    ...(wrappedGrowth ? [[28, 2043, 'TSWP.NumberAttachmentArchive', { super: { kind: 0 }, numberFormat: 123, stringValue: 'VIII' }, []]] : []),
    ...(siblingImage ? [
      [29, 2003, 'TSWP.DrawableAttachmentArchive', { drawable: ref(30) }, [30]],
      [30, 3005, 'TSD.ImageArchive', { data: ref(31), super: { geometry: { size: { width: 10, height: 12 } } } }, []]
    ] : []),
    ...(twoTables ? [
      [29, 2003, 'TSWP.DrawableAttachmentArchive', { drawable: ref(30) }, [30]],
      [30, 6000, 'TST.TableInfoArchive', { super: { geometry: { size: { width: 180, height: rowInfos.length * rowHeight } } },
        tableModel: ref(5) }, [5]]
    ] : []),
    ...(tallMerge ? [
      [11, 6305, 'TST.StrokeSidecarArchive', { rowCount: rowInfos.length, columnCount: 2, rightColumnStrokeLayers: [ref(12)] }, [12]],
      [12, 6306, 'TST.StrokeLayerArchive', { rowColumnIndex: 1, strokeRuns: [{ origin: mergeRow, length: 2, order: 1,
        stroke: { color: { model: 1, r: 0, g: 0, b: 1, a: 1 }, width: 2 } }] }, []]
    ] : []),
    ...(hideMergeAnchor ? [[13, 6006, 'TST.HeaderStorageBucket', { bucketHashFunction: 0, headers: [
      { index: mergeRow, size: 60, hidingState: 1, numberOfCells: 2 }
    ] }, []]] : []),
    ...(tallGlyph ? [
      [14, 6005, 'TST.TableDataList', { listType: 8, nextListID: 3, entries: [{ key: 2, refcount: 1, richTextPayload: ref(15) }] }, [15]],
      [15, 6218, 'TST.RichTextPayloadArchive', { storage: ref(16), cellid: { packedData: 1 } }, [16]],
      [16, 2001, 'TSWP.StorageArchive', { kind: 5, text: ['Before W after.'], tableCharStyle: { entries: [
        { characterIndex: 7, object: ref(17) }, { characterIndex: 8, object: ref(18) }
      ] }, tableParaStyle: { entries: [{ characterIndex: 0, object: ref(19) }] } }, [17, 18, 19]],
      [17, 2021, 'TSWP.CharacterStyleArchive', { super: {}, charProperties: { fontSize: 480, bold: true } }, []],
      [18, 2021, 'TSWP.CharacterStyleArchive', { super: {}, charProperties: { fontSize: 16 } }, []],
      [19, 2022, 'TSWP.ParagraphStyleArchive', { super: {}, paraProperties: { lineSpacing: { mode: 2, amount: 16 } } }, []]
    ] : []),
    ...partitionHints.map(([id, row, rows, index]) => [
      id, 6198, 'TST.LayoutHintArchive', { isValid: true, partitionPosition: index, horizontal: false,
        maximumSize: { width: 320, height: 240 }, cellRange: {
          origin: { packedData: packedPartitions ? row : 0, ...(packedPartitions ? {} : { expandedCoord: { row, column: 0 } }) },
          size: { packedData: (2 << 16) | rows }
        } }, []
    ]),
    ...(savedFlow ? [[20, 10131, 'TP.LayoutStateArchive', { sectionHints: [{ startPageIndex: 0, pageHints: [
      { ...(partitioned ? { childHints: [ref(26)] } : {}), targetHints: leadingTables ? [target(0, finalStart, 0, 320)]
        : partitionColumns === 'anchor'
        ? [target(0, leadStart, 0, 132), target(leadStart, partitionText, 145, 175)]
        : [target(0, partitioned ? partitionText : nextPage, 0, 320)] },
      ...(leadingTables ? [
        { childHints: [ref(32)], targetHints: [target(finalStart, partitionText, 0, 320)] },
        { childHints: [ref(27), ref(33)], targetHints: [target(partitionText, nextPage, 13, 287)] }
      ] : partitioned ? [{ childHints: twoTables ? [ref(27), ref(32)] : [ref(27)], ...(siblingImage ? { anchoredAttachmentsMap: [
        { attachment: ref(29), doublePosition: { x: 255, y: 125 } }
      ] } : {}), ...(!partitionOnly ? { targetHints: siblingImage || partitionColumns === 'two-tables'
        ? [target(partitionText, finalStart, 13, 145), target(finalStart, nextPage, 178, 140)]
        : [target(partitionText, nextPage, 13, 287)] } : {}) }] : []),
      { pageKind: 2 },
      { ...(twoTables && !leadingTables ? { childHints: [ref(33)] } : {}),
        targetHints: [{ range: { location: partitionOnly ? partitionText : nextPage, length: body.length - (partitionOnly ? partitionText : nextPage) },
        doubleOrigin: { x: 17, y: 23 }, doubleSize: { width: 268, height: 190 } }] }
    ] }] }, partitionHints.map(([id]) => id)],
    [21, 10010, 'TP.FloatingDrawablesArchive', { pageGroups: [{ pageIndex: leadingTables ? 4 : partitioned ? 3 : 2,
      foregroundDrawables: [{ drawable: ref(22) }] }] }, [22]],
    [22, 3005, 'TSD.ImageArchive', { data: ref(23), super: { geometry: {
      position: { x: 332, y: 55 }, size: { width: 20, height: 24 }
    } } }, []]] : []),
    ...(savedFlow ? [[24, 11006, 'TSP.PackageMetadata', { lastObjectIdentifier: twoTables ? 33 : siblingImage ? 31 : wrappedGrowth ? 28 : partitioned ? 27 : 24, datas: [
      { identifier: 23, digest: new Uint8Array(), preferredFileName: 'Badge.svg', fileName: 'Badge.svg' },
      ...(image ? [{ identifier: 25, digest: new Uint8Array(), preferredFileName: 'Figure.svg', fileName: 'Figure.svg' }] : []),
      ...(siblingImage ? [{ identifier: 31, digest: new Uint8Array(), preferredFileName: 'Marker.svg', fileName: 'Marker.svg' }] : [])
    ] }, []]] : [])
  ], savedFlow ? {
    'Data/Badge.svg': new TextEncoder().encode(
      '<svg xmlns="http://www.w3.org/2000/svg" width="20" height="24"><rect width="20" height="24" fill="#333"/></svg>'
    ),
    ...(image ? { 'Data/Figure.svg': new TextEncoder().encode(
      '<svg xmlns="http://www.w3.org/2000/svg" width="320" height="240"><rect width="320" height="240" fill="#345778"/></svg>'
    ) } : {}),
    ...(siblingImage ? { 'Data/Marker.svg': new TextEncoder().encode(
      '<svg xmlns="http://www.w3.org/2000/svg" width="10" height="12"><rect width="10" height="12" fill="#345778"/></svg>'
    ) } : {})
  } : {});
}

export function createPagesNumberingArchive({ savedLayout = true } = {}) {
  const ref = identifier => ({ identifier });
  const leading = '\u0004😀 Continued \uFFFC (label \uFFFC) — ';
  const lines = ['First page \uFFFC', '\u0004Restart page \uFFFC', `${leading}\uFFFC of \uFFFC, final.`];
  const body = lines.join('\n') + '\n';
  const attachmentIds = [10, 10, 10, 12, 10, 11];
  const starts = lines.map((_, i) => lines.slice(0, i).join('\n').length + Number(i > 0));
  const target = (i, start = Number(lines[i].startsWith('\u0004')), end = lines[i].length) => ({
    targetHints: [{ range: { location: starts[i] + start, length: end - start },
      doubleOrigin: { x: 0, y: 0 }, doubleSize: { width: 440, height: 60 } }]
  });
  const field = (label, id) => ({ text: [`${label}\uFFFC`], tableAttachment: {
    entries: [{ characterIndex: label.length, object: ref(id) }]
  } });

  return createIworkArchive([
    [1, 10000, 'TP.DocumentArchive', { bodyStorage: ref(2), section: ref(3),
      ...(savedLayout ? { deprecatedLayoutState: ref(6) } : {}) }, savedLayout ? [2, 3, 6] : [2, 3]],
    [2, 2001, 'TSWP.StorageArchive', { text: [body], tableSection: {
      entries: [0, 1, 2].map(i => ({ characterIndex: starts[i] + Number(i > 0), object: ref(3 + i) }))
    }, tableAttachment: { entries: Array.from(body.matchAll(/\uFFFC/g), ({ index }, i) => ({
      characterIndex: index, object: ref(attachmentIds[i])
    })) } }, [3, 4, 5, 10, 11, 12]],
    [3, 10011, 'TP.SectionArchive', { sectionPageNumberKind: 0, sectionPageNumberStart: 90, oddSectionTemplatePage: ref(7) }, [7]],
    [4, 10011, 'TP.SectionArchive', { sectionPageNumberKind: 1, sectionPageNumberStart: 1, inheritPreviousHeaderFooter: true }, []],
    [5, 10011, 'TP.SectionArchive', { sectionPageNumberKind: 0, sectionPageNumberStart: 80, inheritPreviousHeaderFooter: true }, []],
    ...(savedLayout ? [[6, 10131, 'TP.LayoutStateArchive', { sectionHints: [{ startPageIndex: 0,
      pageHints: [target(0), target(1), { pageKind: 2 }, target(2, 1, leading.length), target(2, leading.length)] }] }, []]] : []),
    [7, 10143, 'TP.SectionTemplateArchive', { headers: [ref(8)], footers: [ref(9)] }, [8, 9]],
    [8, 2001, 'TSWP.StorageArchive', field('Page ', 10), [10]],
    [9, 2001, 'TSWP.StorageArchive', field('Total ', 11), [11]],
    [10, 2043, 'TSWP.NumberAttachmentArchive', { super: { kind: 0 }, numberFormatName: 'decimal', numberFormat: 0, stringValue: '90' }, []],
    [11, 2043, 'TSWP.NumberAttachmentArchive', { super: { kind: 1, stringEquivalent: '1' }, numberFormat: 0 }, []],
    [12, 2043, 'TSWP.NumberAttachmentArchive', { super: { kind: 0 }, numberFormat: 123, stringValue: 'IV' }, []]
  ]);
}

export function createPagesParagraphBreakArchive({ columns = false, savedPrefix = false, afterColumnBreakStartsPage = false } = {}) {
  const ref = identifier => ({ identifier });
  const separator = columns ? '\r\n' : '\n';
  const prefix = savedPrefix ? 'Saved prefix.' + separator : '';
  const columnBreak = (afterColumnBreakStartsPage ? separator : '') + '\u000c';
  const lines = ['Opening page \uFFFC.', 'Before the break.', 'Styled page \uFFFC.',
    columns ? `Same page.${columnBreak}Right of page \uFFFC.` : 'Same physical page \uFFFC.', 'Last on page \uFFFC of \uFFFC.'];
  const body = prefix + (columns ? lines.slice(0, -1).join(separator) + '\u0005' + lines.at(-1) : lines.join(separator));
  let start = prefix.length;
  const entries = lines.slice(0, 4).map((line, index) => {
    const entry = { characterIndex: start, object: ref(index % 2 === 0 ? 5 : 6) };
    start += line.length + separator.length;
    return entry;
  });
  if (columns) {
    entries.push({ characterIndex: body.indexOf('Right of page'), object: ref(10) },
      { characterIndex: body.indexOf('Last on page'), object: ref(11) });
  }
  const fields = Array.from(body.matchAll(/\uFFFC/g), ({ index }) => index);
  return createIworkArchive([
    [1, 10000, 'TP.DocumentArchive', { bodyStorage: ref(2), pageWidth: 400, pageHeight: 320,
      topMargin: 40, bottomMargin: 40, leftMargin: 40, rightMargin: 40,
      ...(savedPrefix ? { deprecatedLayoutState: ref(3) } : {}) }, savedPrefix ? [2, 3] : [2]],
    [2, 2001, 'TSWP.StorageArchive', { text: [body], tableParaStyle: { entries },
      ...(columns ? { tableLayoutStyle: { entries: [{ characterIndex: prefix.length, object: ref(9) }] } } : {}),
      tableAttachment: { entries: fields.map((characterIndex, index) => ({
        characterIndex, object: ref(index === fields.length - 1 ? 8 : 7)
      })) } }, [5, 6, 7, 8, ...(columns ? [9, 10, 11] : [])]],
    ...(savedPrefix ? [[3, 10131, 'TP.LayoutStateArchive', { sectionHints: [{ startPageIndex: 0, pageHints: [
      { targetHints: [{ range: { location: 0, length: prefix.length }, doubleOrigin: { x: 12, y: 15 },
        doubleSize: { width: 250, height: 90 } }] }, { pageKind: 2 }
    ] }] }, []]] : []),
    [4, 2022, 'TSWP.ParagraphStyleArchive', { super: {}, paraProperties: { pageBreakBefore: true } }, []],
    [5, 2022, 'TSWP.ParagraphStyleArchive', { super: { parent: ref(4) } }, [4]],
    [6, 2022, 'TSWP.ParagraphStyleArchive', { super: { parent: ref(4) }, paraProperties: { pageBreakBefore: false } }, [4]],
    [7, 2043, 'TSWP.NumberAttachmentArchive', { super: { kind: 0 }, numberFormat: 0, stringValue: '99' }, []],
    [8, 2043, 'TSWP.NumberAttachmentArchive', { super: { kind: 1 }, numberFormat: 0, stringValue: '99' }, []],
    ...(columns ? [
      [9, 2024, 'TSWP.ColumnStyleArchive', { super: {}, columnProperties: { columns: { equalColumns: { count: 2, gap: 0.125 } } } }, []],
      [10, 2022, 'TSWP.ParagraphStyleArchive', {
        super: { parent: ref(6) }, charProperties: { fontSize: 18 }, paraProperties: { pageBreakBefore: afterColumnBreakStartsPage }
      }, [6]],
      [11, 2022, 'TSWP.ParagraphStyleArchive', { super: { parent: ref(6) }, charProperties: { fontSize: 14 } }, [6]]
    ] : [])
  ]);
}
