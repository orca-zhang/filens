import { createIworkArchive } from './iwa-archive.mjs';

export const pagesTallCellText = Array.from({ length: 80 }, (_, i) => `Entry ${i + 1} 中文 e\u0301 👩‍💻. `).join('') +
  '分页👩‍💻e\u0301'.repeat(60);
export const pagesTallMergeText = Array.from({ length: 28 }, (_, i) => `Merged ${i + 1} 文. `).join('') + 'W'.repeat(220);
export const pagesWrappedTableTail = 'A visible line starts here. 中文 e\u0301 👩‍💻 ' +
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

export function createPagesAggregateColumnsArchive({ overflow = false } = {}) {
  const ref = identifier => ({ identifier });
  const leftText = overflow ? Array.from({ length: 9 }, (_, i) => `Archived left ${i + 1}.`).join('\n') + '\n' : '';
  const rightText = overflow ? Array.from({ length: 20 }, (_, i) => `Archived right ${i + 1}.`).join('\n') + '\n' : '';
  const pages = [pagesAggregateColumnText, `${leftText}Left stops here.\n\u000cRight starts here.\n${rightText}End of page \uFFFC.`, 'Saved page \uFFFC of \uFFFC.'];
  const body = pages.join('\n');
  let location = 0;
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
      topMargin: 40, bottomMargin: 40, leftMargin: 40, rightMargin: 40, deprecatedLayoutState: ref(3) }, [2, 3]],
    [2, 2001, 'TSWP.StorageArchive', { text: [body], tableLayoutStyle: { entries: [
      { characterIndex: 0, object: ref(4) }, { characterIndex: targets[1].range.location, object: ref(5) },
      { characterIndex: targets[2].range.location }
    ] }, tableParaStyle: { entries: [{ characterIndex: 0, object: ref(6) }] },
    tableAttachment: { entries: Array.from(body.matchAll(/\uFFFC/g), ({ index: characterIndex }, i) => ({
      characterIndex, object: ref([9, 7, 7, 7, 8][i])
    })) } }, [4, 5, 6, 7, 8, 9]],
    [3, 10131, 'TP.LayoutStateArchive', { sectionHints: [{ startPageIndex: 0, pageHints: [
      { targetHints: [frame(0, 0, 12, 320, 112)] }, { flowHints: [frame(1, 16, 24, 288, 150)] },
      { pageKind: 2 }, { targetHints: [targets[2]] }
    ] }] }, []],
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
  savedFlow = false, packedPartitions = false, rowHeight = 60
} = {}) {
  const ref = identifier => ({ identifier });
  const tail = savedFlow === 'long' ? `\n${pagesLongBodyText.replaceAll('\uFFFC', '')}` : '';
  const partitioned = savedFlow === 'partition';
  const lead = savedFlow === 'leading' ? 'Saved lead ' : '';
  const image = savedFlow === 'image';
  const separator = savedFlow === 'split' ? ' ' : '\n';
  const afterObject = savedFlow === 'wrapped-growth' ? pagesWrappedTableTail : `After ${image ? 'image' : 'table'}`;
  const body = partitioned
    ? 'Saved lead \uFFFC\nAfter table on page \uFFFC of \uFFFC.\nFinal paragraph.\nSaved next on page \uFFFC of \uFFFC.'
    : savedFlow
    ? `${lead}\uFFFC ${afterObject} on page \uFFFC of \uFFFC.${tail}\nFinal paragraph.${separator}Saved next on page \uFFFC of \uFFFC.`
    : 'Before table \uFFFC after table on page \uFFFC of \uFFFC.\nFinal paragraph.';
  const nextPage = body.indexOf('Saved next on page');
  const partitionText = body.indexOf('After table');
  const attachmentIds = [3, 9, 10, 9, 10];
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
  return createIworkArchive([
    [1, 10000, 'TP.DocumentArchive', { bodyStorage: ref(2), pageWidth: 400, pageHeight: 320,
      topMargin: 40, bottomMargin: 40, leftMargin: 40, rightMargin: 40,
      ...(savedFlow ? { deprecatedLayoutState: ref(20), floatingDrawables: ref(21) } : {}) }, savedFlow ? [2, 20, 21] : [2]],
    [2, 2001, 'TSWP.StorageArchive', { text: [body], tableAttachment: { entries: Array.from(body.matchAll(/\uFFFC/g),
      ({ index }, i) => ({ characterIndex: index, object: ref(attachmentIds[i]) })) } }, [3, 9, 10]],
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
    ...(partitioned ? [[0, 2], [2, rowInfos.length - 2]].map(([row, rows], index) => [
      26 + index, 6198, 'TST.LayoutHintArchive', { isValid: true, partitionPosition: index, horizontal: false,
        maximumSize: { width: 320, height: 240 }, cellRange: {
          origin: { packedData: packedPartitions ? row : 0, ...(packedPartitions ? {} : { expandedCoord: { row, column: 0 } }) },
          size: { packedData: (2 << 16) | rows }
        } }, []
    ]) : []),
    ...(savedFlow ? [[20, 10131, 'TP.LayoutStateArchive', { sectionHints: [{ startPageIndex: 0, pageHints: [
      { ...(partitioned ? { childHints: [ref(26)] } : {}), targetHints: [{ range: { location: 0, length: partitioned ? partitionText : nextPage },
        doubleOrigin: { x: 0, y: 0 }, doubleSize: { width: 320, height: 240 } }] },
      ...(partitioned ? [{ childHints: [ref(27)], targetHints: [{ range: { location: partitionText, length: nextPage - partitionText },
        doubleOrigin: { x: 13, y: 0 }, doubleSize: { width: 287, height: 240 } }] }] : []),
      { pageKind: 2 },
      { targetHints: [{ range: { location: nextPage, length: body.length - nextPage },
        doubleOrigin: { x: 17, y: 23 }, doubleSize: { width: 268, height: 190 } }] }
    ] }] }, partitioned ? [26, 27] : []],
    [21, 10010, 'TP.FloatingDrawablesArchive', { pageGroups: [{ pageIndex: partitioned ? 3 : 2, foregroundDrawables: [{ drawable: ref(22) }] }] }, [22]],
    [22, 3005, 'TSD.ImageArchive', { data: ref(23), super: { geometry: {
      position: { x: 332, y: 55 }, size: { width: 20, height: 24 }
    } } }, []]] : []),
    ...(savedFlow ? [[24, 11006, 'TSP.PackageMetadata', { lastObjectIdentifier: partitioned ? 27 : 24, datas: [
      { identifier: 23, digest: new Uint8Array(), preferredFileName: 'Badge.svg', fileName: 'Badge.svg' },
      ...(image ? [{ identifier: 25, digest: new Uint8Array(), preferredFileName: 'Figure.svg', fileName: 'Figure.svg' }] : [])
    ] }, []]] : [])
  ], savedFlow ? {
    'Data/Badge.svg': new TextEncoder().encode(
      '<svg xmlns="http://www.w3.org/2000/svg" width="20" height="24"><rect width="20" height="24" fill="#333"/></svg>'
    ),
    ...(image ? { 'Data/Figure.svg': new TextEncoder().encode(
      '<svg xmlns="http://www.w3.org/2000/svg" width="320" height="240"><rect width="320" height="240" fill="#345778"/></svg>'
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
