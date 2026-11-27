import { createIworkArchive } from './iwa-archive.mjs';
export { frameIwa } from './iwa-archive.mjs';

/** A serialized ZIP/IWA fixture exercises the real decoder, semantic builder and worker. */
export async function createLargeMergedNumbersArchive({ rowCount = 100_000, columnCount = 1024, emptyAnchor = false,
  hiddenTracks = false, styledBlanks = false, customStrokes = false } = {}) {
  const reference = identifier => ({ identifier });
  const text = (key, legacy = false, style) => {
    const bytes = new Uint8Array(legacy || style ? 20 : 16), view = new DataView(bytes.buffer);
    bytes[0] = legacy ? 4 : 5; bytes[1] = 3;
    if (legacy) view.setUint16(4, 3, true);
    view.setUint32(legacy ? 16 : 12, key, true);
    if (style && !legacy) view.setUint32(16, style, true);
    return bytes;
  };
  const row = (index, column, key, legacy = false, style) => {
    const offsets = new Uint8Array(columnCount * 2); offsets.fill(255);
    new DataView(offsets.buffer).setUint16(column * 2, 0, true);
    return { tileRowIndex: index % 256, cellCount: 1,
      cellOffsetsPreBnc: legacy ? offsets : new Uint8Array(), cellStorageBufferPreBnc: legacy ? text(key, true) : new Uint8Array(),
      ...(!legacy ? { cellOffsets: offsets, cellStorageBuffer: text(key, false, style) } : {}) };
  };
  const positions = [0, Math.floor(rowCount / 2), rowCount - 1];
  const tileIds = [5, 8, 9];
  const records = [
    [1, 12002, 'TN.DocumentArchive', { super: {}, stylesheet: reference(0), sidebarOrder: reference(0), theme: reference(0), sheets: [reference(2)] }, [2]],
    [2, 2, 'TN.SheetArchive', { name: 'Large merged archive', drawableInfos: [reference(3)] }, [3]],
    [3, 6000, 'TST.TableInfoArchive', { super: { geometry: { position: { x: 0, y: 0 }, size: { width: 800, height: 600 } } }, tableModel: reference(4) }, [4]],
    [4, 6001, 'TST.TableModelArchive', { tableName: 'Sparse merged table', numberOfRows: rowCount, numberOfColumns: columnCount,
      defaultRowHeight: 26, defaultColumnWidth: 96,
      ...(customStrokes ? { strokeSidecar: reference(20), mergeOwner: { ownerId: {}, formulaStore: { nextFormulaIndex: 1, formulas: [
        { formulaIndex: 0, formula: { ASTNodeArray: { ASTNode: [
          { ASTNodeType: 67, ASTColonTract: { absoluteRow: [{ rangeBegin: 0, rangeEnd: rowCount - 2 }],
            absoluteColumn: [{ rangeBegin: 0, rangeEnd: columnCount - 1 }] } },
          { ASTNodeType: 16, ASTFunctionNodeIndex: 168, ASTFunctionNodeNumArgs: 1 }
        ] } } }
      ] } } } : {}),
      ...(styledBlanks ? { numberOfHeaderRows: 1, numberOfHeaderColumns: 1, numberOfFooterRows: 1,
        tableStyle: reference(12), headerRowStyle: reference(13), headerColumnStyle: reference(14), footerRowStyle: reference(15) } : {}),
      baseDataStore: { tiles: { tileSize: 256, tiles: positions.map((index, i) => ({ tileid: Math.floor(index / 256), tile: reference(tileIds[i]) })) },
        stringTable: reference(6), ...(customStrokes ? {} : { mergeRegionMap: reference(7) }), ...(hiddenTracks || styledBlanks ? {
          rowHeaders: { bucketHashFunction: 0, buckets: [reference(10)] }, columnHeaders: reference(11)
        } : {}), ...(styledBlanks ? { styleTable: reference(19) } : {}) } },
    [...tileIds, 6, customStrokes ? 20 : 7, ...(hiddenTracks || styledBlanks ? [10, 11] : []),
      ...(styledBlanks ? [12, 13, 14, 15, 19] : [])]],
    [6, 6005, 'TST.TableDataList', { listType: 1, nextListID: 4, entries: ['Large merge origin', 'Stored covered value', 'Last sparse cell']
      .map((string, i) => ({ key: i + 1, refcount: 1, string })) }, []],
    [7, 6107, 'TST.MergeRegionMapArchive', { cellRange: [{ origin: { packedData: 0 },
      size: { packedData: 0, numRows: styledBlanks ? 2 : rowCount - 1, numColumns: styledBlanks ? 2 : columnCount } }] }, []],
    ...positions.map((index, i) => [tileIds[i], 6002, 'TST.Tile', { maxRow: index % 256, maxColumn: columnCount - 1,
      numCells: emptyAnchor && i === 0 ? 0 : 1, numrows: index % 256 + 1,
      rowInfos: emptyAnchor && i === 0 ? [] : [row(index, i === 0 ? 0 : i === 1 ? Math.floor(columnCount / 2) : columnCount - 1,
        i + 1, i === 2 && !styledBlanks, i === 2 && styledBlanks ? 8 : undefined)] }, []])
  ];
  if (hiddenTracks || styledBlanks) {
    for (const [id, size, style, index] of [[10, 26, 16, 4], [11, 96, 17, 4]]) {
      const headers = hiddenTracks ? [{ index: 0, size, hidingState: 1, numberOfCells: 2 }] : [];
      if (styledBlanks) headers.push({ index, size, hidingState: 0, numberOfCells: 1, cellStyle: reference(style) });
      records.push([id, 6006, 'TST.HeaderStorageBucket', { bucketHashFunction: 0,
        headers }, styledBlanks ? [style] : []]);
    }
  }
  if (styledBlanks) {
    const color = (r, g, b) => ({ model: 1, r: r / 255, g: g / 255, b: b / 255, a: 1 });
    records.push([12, 6003, 'TST.TableStyleArchive', { tableProperties: {
      bandedRows: true, bandedFill: { color: color(204, 221, 255) }, vStrokesVisible: false,
      tableBodyHorizontalStroke: { color: color(51, 68, 85), width: 2 },
      headerRowSeparatorStroke: { color: color(51, 102, 153), width: 3 },
      footerRowSeparatorStroke: { color: color(0, 102, 51), width: 4 }
    } }, []]);
    const fills = [[153, 204, 255], [255, 204, 102], [204, 255, 204], [255, 204, 221], [204, 238, 204], [255, 230, 102]];
    fills.forEach((fill, i) => records.push([13 + i, 6004, 'TST.CellStyleArchive', { super: {},
      cellProperties: { cellFill: { color: color(...fill) }, ...(i === 4 ? {
        rightStroke: { color: color(153, 51, 102), width: 1 }
      } : {}) } }, []]));
    records.push([19, 6005, 'TST.TableDataList', { listType: 3, nextListID: 9,
      entries: [{ key: 8, refcount: 1, reference: reference(18) }] }, [18]]);
  }
  if (customStrokes) {
    const solid = (r, g, b, width) => ({ color: { model: 1, r: r / 255, g: g / 255, b: b / 255, a: 1 }, width });
    const layer = (id, rowColumnIndex, runs) => [id, 6306, 'TST.StrokeLayerArchive', { rowColumnIndex,
      strokeRuns: runs.map(([origin, length, order, stroke]) => ({ origin, length, order, stroke })) }, []];
    records.push([20, 6305, 'TST.StrokeSidecarArchive', { rowCount, columnCount,
      topRowStrokeLayers: [reference(21), reference(25)], rightColumnStrokeLayers: [reference(22)],
      bottomRowStrokeLayers: [reference(23)], leftColumnStrokeLayers: [reference(24)] }, [21, 22, 23, 24, 25]],
    layer(21, 0, [[0, columnCount, 1, solid(17, 34, 153, 3)], [1, 3, 2, solid(0, 136, 68, 4)],
      [5, 1, 3, { pattern: { type: 2 } }], [6, 1, 3, { color: { model: 1, r: 1, a: 0 }, width: 3 }],
      [columnCount + 1, 1000, 50, solid(0, 0, 0, 20)]]),
    layer(22, columnCount - 1, [[0, rowCount - 1, 1, solid(153, 85, 17, 3)]]),
    layer(23, rowCount - 2, [[0, columnCount, 1, solid(170, 34, 51, 4)]]),
    layer(24, 0, [[0, rowCount - 1, 1, solid(68, 85, 102, 3)]]),
    layer(25, rowCount - 1, [[columnCount - 1, 1, 4, solid(85, 34, 153, 5)]]));
  }
  return createIworkArchive(records);
}

export async function createWideSparseNumbersArchive({ rowCount = 4096, columnCount = 2048 } = {}) {
  const ref = identifier => ({ identifier });
  const v5 = key => {
    const bytes = Buffer.alloc(16);
    bytes[0] = 5; bytes[1] = 3;
    bytes.writeUInt32LE(8, 8);
    bytes.writeUInt32LE(key, 12);
    return bytes;
  };
  const legacy = Buffer.alloc(20), empty = new Uint8Array();
  legacy[0] = 4; legacy[1] = 3;
  legacy.writeUInt16LE(3, 4);
  legacy.writeUInt32LE(3, 16);
  const modernOffsets = Buffer.alloc(columnCount * 2, 255), legacyOffsets = Buffer.from(modernOffsets);
  modernOffsets.writeUInt16LE(0, 0);
  modernOffsets.writeUInt16LE(4, (columnCount - 1) * 2);
  legacyOffsets.writeUInt16LE(0, (columnCount - 1) * 2);
  const modern = Buffer.concat([v5(1), v5(2)]);
  const tiles = Array.from({ length: Math.ceil(rowCount / 256) }, (_, index) => ({ tileid: index, tile: ref(6 + index) }));
  return createIworkArchive([
    [1, 12002, 'TN.DocumentArchive', { super: {}, stylesheet: ref(0), sidebarOrder: ref(0), theme: ref(0), sheets: [ref(2)] }, [2]],
    [2, 2, 'TN.SheetArchive', { name: 'Wide sparse rows', drawableInfos: [ref(3)] }, [3]],
    [3, 6000, 'TST.TableInfoArchive', { super: { geometry: { position: { x: 0, y: 0 }, size: { width: 800, height: 600 } } }, tableModel: ref(4) }, [4]],
    [4, 6001, 'TST.TableModelArchive', { numberOfRows: rowCount, numberOfColumns: columnCount, numberOfHeaderRows: 1,
      defaultRowHeight: 26, defaultColumnWidth: 96, baseDataStore: { tiles: { tileSize: 256, tiles }, stringTable: ref(5) } },
    [5, ...tiles.map(tile => tile.tile.identifier)]],
    [5, 6005, 'TST.TableDataList', { listType: 1, nextListID: 4, entries: ['Row start', 'Modern edge', 'Legacy edge']
      .map((string, i) => ({ key: i + 1, refcount: 1, string })) }, []],
    ...tiles.map(({ tileid, tile }) => {
      const numrows = Math.min(256, rowCount - tileid * 256);
      const rowInfos = Array.from({ length: numrows }, (_, tileRowIndex) => tileRowIndex % 2 === 0
        ? { tileRowIndex, cellCount: 2, hasWideOffsets: true, storageVersion: 5, cellStorageBuffer: modern, cellOffsets: modernOffsets,
          cellOffsetsPreBnc: empty, cellStorageBufferPreBnc: empty }
        : { tileRowIndex, cellCount: 1, cellOffsetsPreBnc: legacyOffsets, cellStorageBufferPreBnc: legacy });
      return [tile.identifier, 6002, 'TST.Tile', { maxRow: numrows - 1, maxColumn: columnCount - 1,
        numCells: numrows + Math.ceil(numrows / 2), numrows, rowInfos }, []];
    })
  ]);
}

export async function createModernNumbersArchive({ locale, formattingSymbols } = {}) {
  const ref = identifier => ({ identifier });
  const rowCount = 100_000, columnCount = 2048;
  const key = value => {
    const bytes = Buffer.alloc(4);
    bytes.writeUInt32LE(value);
    return bytes;
  };
  const float = value => {
    const bytes = Buffer.alloc(8);
    bytes.writeDoubleLE(value);
    return bytes;
  };
  const decimal = (coefficient, exponent) => {
    const bytes = Buffer.alloc(16);
    const magnitude = coefficient < 0n ? -coefficient : coefficient;
    bytes.writeBigUInt64LE(BigInt.asUintN(64, magnitude));
    bytes.writeBigUInt64LE((magnitude >> 64n) | (BigInt(exponent + 6176) << 49n)
      | (coefficient < 0n ? 1n << 63n : 0n), 8);
    return bytes;
  };
  const cell = (type, fields, ...data) => {
    const header = Buffer.alloc(12);
    header[0] = 5;
    header[1] = type;
    header.writeUInt32LE(fields, 8);
    return Buffer.concat([header, ...data]);
  };
  const row = (index, cells) => {
    const offsets = Buffer.alloc(cells.length * 2);
    let offset = 0;
    cells.forEach((bytes, column) => {
      offsets.writeUInt16LE(offset / 4, column * 2);
      offset += bytes.length;
    });
    return { tileRowIndex: index % 256, cellCount: cells.length, hasWideOffsets: true, storageVersion: 5,
      cellStorageBufferPreBnc: new Uint8Array(), cellOffsetsPreBnc: new Uint8Array(),
      cellStorageBuffer: Buffer.concat(cells), cellOffsets: offsets };
  };
  const tile = (...rowInfos) => ({
    maxRow: rowInfos.at(-1).tileRowIndex, maxColumn: Math.max(...rowInfos.map(row => row.cellCount)) - 1,
    numCells: rowInfos.reduce((sum, row) => sum + row.cellCount, 0), numrows: rowInfos.at(-1).tileRowIndex + 1, rowInfos
  });
  const dateSeconds = (Date.UTC(1999, 11, 31, 23, 59, 59) - Date.UTC(2001, 0, 1)) / 1000;
  const first = [
    cell(2, 0x3061, decimal(-125n, -3), key(1), key(1), key(1), key(1)),
    cell(5, 0xb004, float(dateSeconds), key(3), key(1), key(2)),
    cell(7, 0x11002, float(129_600), key(4), key(3)),
    cell(6, 0x41002, float(1), key(6), key(4)),
    cell(3, 0x48, key(1), key(2)),
    cell(10, 0x5001, decimal(12345n, -2), key(2), key(5)),
    cell(8, 0),
    cell(2, 1, key(42)), // Short decimal, followed by a separate cell.
    cell(2, 1, decimal(1n, -10))
  ];
  const last = cell(10, 0x5001, decimal(4250n, -2), key(2), key(5));
  const duration = (seconds, format) => cell(7, 0x11002, float(seconds), key(4), key(format));
  const number = (coefficient, exponent, format) => cell(2, 0x3001, decimal(coefficient, exponent), key(1), key(format));
  const currency = (coefficient, exponent, format) => cell(10, 0x5001, decimal(coefficient, exponent), key(2), key(format));
  const date = (seconds, format) => cell(5, 0x9004, float(seconds), key(3), key(format));
  const durationRow = row(1, [
    duration(129659.75, 6), duration(-3661.125, 7), duration(0, 8), duration(61.001, 9),
    duration(1468800, 10), duration(0.001, 11)
  ]);
  const numberRow = row(2, [
    number(-12345n, -9, 12), number(314159265359n, -11, 13), number(-15n, -1, 14),
    number(-255n, 0, 15), number(-255n, 0, 16), number(25n, -2, 17), number(0n, 0, 18)
  ]);
  const decimalRow = row(3, [
    number(25n, -1, 19), number(-123456789n, -3, 20), number(-12345n, -5, 21), number(12345n, -5, 21),
    currency(-9876543215n, -3, 22), currency(-123456n, -2, 23), number(0n, 0, 20)
  ]);
  const dateAt = (year, month, day, hour = 0, minute = 0, second = 0) =>
    (Date.UTC(year, month - 1, day, hour, minute, second) - Date.UTC(2001, 0, 1)) / 1000;
  const dateRow = row(4, [
    date(dateAt(2024, 2, 29, 13, 4, 5) + .123456, 24), date(dateAt(2026, 5, 17), 25),
    date(0, 26), date(dateAt(2026, 5, 17), 27)
  ]);
  const customRow = row(5, [
    number(-123456n, -2, 28), number(0n, 0, 28), number(123456n, -2, 28),
    cell(3, 0x20008, key(2), key(29)), cell(9, 0x20050, key(1), key(2), key(29)),
    currency(4245n, -2, 30), number(125n, -3, 31),
    number(234n, -2, 32), number(12345n, -9, 33), number(-42125n, -3, 34)
  ]);
  const addLegacyNumber = (row, type, value, format) => {
    const bytes = Buffer.alloc(40);
    bytes[0] = 4;
    bytes[1] = type;
    bytes.writeUInt16LE(type === 5 ? 0xce : 0xae, 4); // Cell style, paragraph style, format, formula and a stored value.
    bytes.writeUInt32LE(1, 12);
    bytes.writeUInt32LE(2, 16);
    bytes.writeUInt32LE(format, 20);
    bytes.writeDoubleLE(value, 28);
    bytes.writeUInt32LE(format, 36);
    row.cellOffsetsPreBnc = Buffer.alloc((row.cellCount + 1) * 2, 255);
    row.cellOffsetsPreBnc.writeUInt16LE(0, row.cellCount * 2);
    row.cellStorageBufferPreBnc = bytes;
    row.cellCount += 1;
  };
  addLegacyNumber(durationRow, 7, 129600, 6);
  addLegacyNumber(numberRow, 2, 1234.5, 12);
  addLegacyNumber(decimalRow, 2, 2.5, 19);
  addLegacyNumber(dateRow, 5, dateAt(1999, 12, 31, 23, 59, 59), 24);
  addLegacyNumber(customRow, 2, -2.5, 28);
  const lastRow = Array(columnCount).fill(last);
  lastRow[columnCount - 6] = number(-123456n, -2, 28);
  lastRow[columnCount - 5] = date(0, 26);
  lastRow[columnCount - 4] = currency(-123456n, -2, 23);
  lastRow[columnCount - 3] = number(9999n, -3, 12);
  lastRow[columnCount - 2] = duration(90_000, 8);
  lastRow[columnCount - 1] = cell(10, 0x5041, decimal(4250n, -2), key(2), key(2), key(5));
  const firstDate = { lower: { high: -1, low: -1 }, upper: 7 };
  const secondDate = { lower: { high: -1, low: -2 }, upper: 7 };
  const customNumber = { lower: { high: -1, low: -3 }, upper: 7 };
  const customText = { lower: { high: -1, low: -4 }, upper: 7 };
  const customFormat = (name, formatType, customFormatString, options = {}) => ({
    name, formatTypePreBnc: formatType, formatType, defaultFormat: { formatType, customFormatString, ...options }
  });
  const formats = [
    { formatType: 258, decimalPlaces: 2 },
    { formatType: 261, dateTimeFormat: 'yyyy-MM-dd HH:mm:ss' },
    { formatType: 268, dateTimeFormat: '[h]:mm:ss' },
    { boolTrueString: 'Available', boolFalseString: 'Unavailable' },
    { formatType: 257, currencyCode: 'EUR', decimalPlaces: 2 },
    { formatType: 268, durationStyle: 0, durationUnitLargest: 4, durationUnitSmallest: 8 },
    { formatType: 268, durationStyle: 1, useAutomaticDurationUnits: true },
    { formatType: 268, durationStyle: 2, useAutomaticDurationUnits: true },
    { formatType: 268, durationStyle: 0, useAutomaticDurationUnits: true },
    { formatType: 268, durationStyle: 2, durationUnitLargest: 1, durationUnitSmallest: 2 },
    { formatType: 268, durationStyle: 1, durationUnitLargest: 16, durationUnitSmallest: 4 },
    { formatType: 259, decimalPlaces: 2 },
    { formatType: 262, fractionAccuracy: 0xfffffffd },
    { formatType: 262, fractionAccuracy: 4 },
    { formatType: 269, base: 16, basePlaces: 4, baseUseMinusSign: false },
    { formatType: 269, base: 16, basePlaces: 4, baseUseMinusSign: true },
    { formatType: 262, fractionAccuracy: 2 },
    { formatType: 259, decimalPlaces: 253 },
    { formatType: 256, decimalPlaces: 0, showThousandsSeparator: true },
    { formatType: 256, decimalPlaces: 2, showThousandsSeparator: true, negativeStyle: 2 },
    { formatType: 258, decimalPlaces: 2, negativeStyle: 1 },
    { formatType: 257, currencyCode: 'GBP', decimalPlaces: 2, showThousandsSeparator: true, negativeStyle: 3 },
    { formatType: 257, currencyCode: 'USD', decimalPlaces: 2, showThousandsSeparator: true, useAccountingStyle: true },
    { formatType: 261, dateTimeFormat: 'EEEE, d MMMM y h:mm:ss.SSSSS a G' },
    { formatType: 272, customUid: firstDate },
    { formatType: 272, customUid: secondDate },
    { formatType: 261, dateTimeFormat: 'DDDwwWF' },
    { formatType: 270, customUid: customNumber },
    { formatType: 271, customUid: customText },
    { formatType: 274, customFormat: customFormat('Custom currency', 274, "¤#,###.00' paid'", {
      currencyCode: 'CHF', showThousandsSeparator: true, numNonspaceDecimalDigits: 2
    }) },
    { formatType: 270, customFormat: customFormat('Custom percent', 270, "'5% of '0.0%", {
      scaleFactor: 100, numNonspaceIntegerDigits: 1, numNonspaceDecimalDigits: 1
    }) },
    { formatType: 270, customFormat: customFormat('Custom fraction', 270, '\uE420', {
      requiresFractionReplacement: true, fractionAccuracy: 4
    }) },
    { formatType: 270, customFormat: customFormat('Custom scientific', 270, '0.##E+00') },
    { formatType: 270, customFormat: customFormat('Custom padding', 270, '000,000.00') }
  ];
  return createIworkArchive([
    [1, 12002, 'TN.DocumentArchive', { super: { super: { localeIdentifier: locale, formattingSymbols }, customFormatList: ref(12) },
      stylesheet: ref(0), sidebarOrder: ref(0), theme: ref(0), sheets: [ref(2)] }, [2, 12]],
    [2, 2, 'TN.SheetArchive', { name: 'Modern values', drawableInfos: [ref(3)] }, [3]],
    [3, 6000, 'TST.TableInfoArchive', { super: { geometry: { position: { x: 0, y: 0 }, size: { width: 800, height: 600 } } }, tableModel: ref(4) }, [4]],
    [4, 6001, 'TST.TableModelArchive', { tableName: 'Wide records', numberOfRows: rowCount, numberOfColumns: columnCount,
      numberOfHeaderRows: 1, headerRowTextStyle: ref(17),
      defaultRowHeight: 26, defaultColumnWidth: 152, baseDataStore: {
        tiles: { tileSize: 256, tiles: [{ tileid: 0, tile: ref(5) }, { tileid: Math.floor((rowCount - 1) / 256), tile: ref(6) }] },
        stringTable: ref(7), formatTable: ref(8), styleTable: ref(9), formatTablePreBnc: ref(11), richTextTable: ref(13)
      } }, [5, 6, 7, 8, 9, 11, 13, 17]],
    [5, 6002, 'TST.Tile', tile(row(0, first), durationRow, numberRow, decimalRow, dateRow, customRow), []],
    [6, 6002, 'TST.Tile', tile(row(rowCount - 1, lastRow)), []],
    [7, 6005, 'TST.TableDataList', { listType: 1, nextListID: 3, entries: [
      { key: 1, refcount: 1, string: 'Modern text' }, { key: 2, refcount: 1, string: 'A&B' }
    ] }, []],
    [8, 6005, 'TST.TableDataList', { listType: 2, nextListID: formats.length + 1,
      entries: formats.map((format, index) => ({ key: index + 1, refcount: 1, format })) }, []],
    [9, 6005, 'TST.TableDataList', { listType: 4, nextListID: 3, entries: [
      { key: 1, refcount: 1, reference: ref(10) }, { key: 2, refcount: 1, reference: ref(18) }
    ] }, [10, 18]],
    [10, 6004, 'TST.CellStyleArchive', { super: {}, cellProperties: { cellFill: { color: { model: 1, r: 0, g: 1, b: 0, a: 1 } } } }, []],
    [11, 6005, 'TST.TableDataList', { listType: 2, nextListID: 29,
      entries: [6, 12, 19, 24, 28].map(key => ({ key, refcount: 1, format: formats[key - 1] })) }, []],
    [12, 222, 'TSK.CustomFormatListArchive', {
      uuids: [secondDate, firstDate, customNumber, customText],
      customFormats: [
        customFormat('Epoch', 272, "'Epoch' yyyy/MM/dd kk:mm K"),
        customFormat('Adjacent date fields', 272, 'EEEMdyyyyG'),
        { ...customFormat('Conditional number', 270, "'Ref 007%: '#,###.##", { showThousandsSeparator: true }),
          conditions: [
            { conditionType: 2, conditionValueDbl: 0, conditionFormat: { formatType: 270, customFormatString: "'Zero or below '#,###.##",
              showThousandsSeparator: true } },
            { conditionType: 1, conditionValue: 1, conditionFormat: { formatType: 270, customFormatString: "'Below one'" } }
          ] },
        customFormat('Custom text', 271, 'Tag [\uE421]')
      ]
    }, []],
    [13, 6005, 'TST.TableDataList', { listType: 8, nextListID: 2, entries: [{ key: 1, refcount: 1, richTextPayload: ref(14) }] }, [14]],
    [14, 6218, 'TST.RichTextPayloadArchive', { storage: ref(15), cellid: { packedData: (5 << 16) | 4 } }, [15]],
    [15, 2001, 'TSWP.StorageArchive', { kind: 5, text: ['Styled text'],
      tableCharStyle: { entries: [{ characterIndex: 0, object: ref(16) }, { characterIndex: 6 }] } }, [16]],
    [16, 2021, 'TSWP.CharacterStyleArchive', { super: {}, charProperties: { bold: true } }, []],
    [17, 2022, 'TSWP.ParagraphStyleArchive', { super: {}, charProperties: { bold: true, fontName: 'HelveticaNeue-Bold', fontSize: 16 } }, []],
    [18, 2022, 'TSWP.ParagraphStyleArchive', { super: { parent: ref(17) }, paraProperties: { alignment: 2 },
      charProperties: { bold: false, italic: true, fontColor: { model: 1, r: .8, g: 0, b: .4, a: 1 } } }, [17]]
  ]);
}

export async function createNumbersMediaArchive(padding = 0) {
  const ref = identifier => ({ identifier });
  const superImage = { geometry: { position: { x: 32, y: 32 }, size: { width: 160, height: 90 } } };
  const picture = (marker, width, comment = 0) =>
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="48"><title>${marker}</title><rect width="100%" height="100%" fill="teal"/><!--${'x'.repeat(comment)}--></svg>`;
  const images = [
    ['First.svg', picture('numbers-first-image', 32)],
    ['Later.svg', picture('numbers-large-image', 96, padding)],
    ['Blank.svg', picture('numbers-blank-fill', 48)],
    ['Unused.svg', picture('numbers-unreferenced-image', 64, Math.floor(padding / 2))]
  ];
  return createIworkArchive([
    [1, 12002, 'TN.DocumentArchive', { super: {}, stylesheet: ref(0), sidebarOrder: ref(0), theme: ref(0),
      sheets: [ref(2), ref(3), ref(4)] }, [2, 3, 4]],
    [2, 2, 'TN.SheetArchive', { name: 'Start', drawableInfos: [ref(5)] }, [5]],
    [3, 2, 'TN.SheetArchive', { name: 'Pictures', drawableInfos: [ref(6), ref(7)] }, [6, 7]],
    [4, 2, 'TN.SheetArchive', { name: 'Shared picture', drawableInfos: [ref(6)] }, [6]],
    [5, 3005, 'TSD.ImageArchive', { super: superImage, data: ref(101) }, []],
    [6, 3005, 'TSD.ImageArchive', { super: superImage, data: ref(102) }, []],
    [7, 6000, 'TST.TableInfoArchive', { super: superImage, tableModel: ref(8) }, [8]],
    [8, 6001, 'TST.TableModelArchive', { numberOfRows: 4, numberOfColumns: 3, defaultRowHeight: 26, defaultColumnWidth: 96,
      bodyCellStyle: ref(9), baseDataStore: {} }, [9]],
    [9, 6004, 'TST.CellStyleArchive', { super: {}, cellProperties: { cellFill: { image: { imagedata: ref(103) } } } }, []],
    [10, 11006, 'TSP.PackageMetadata', { lastObjectIdentifier: 10, datas: images.map(([fileName], index) => ({
      identifier: 101 + index, digest: new Uint8Array(), preferredFileName: fileName, fileName
    })) }, []]
  ], Object.fromEntries(images.map(([name, bytes]) => [`Data/${name}`, bytes])));
}

export async function createNumbersPictureFillArchive({ tinted = false } = {}) {
  const ref = identifier => ({ identifier });
  const rowCount = 140, columnCount = 56;
  const styles = [0, 1, 2, 3, 4].map(technique => [10 + technique, 6004, 'TST.CellStyleArchive', { super: {},
    cellProperties: { cellFill: { image: { imagedata: ref(100), technique, fillsize: { width: 36, height: 18 },
      ...(tinted ? { tint: { model: 1, r: 0, g: 0, b: 1, a: .5 } } : {}) } } }
  }, []]);
  const row = (tileRowIndex, entries) => {
    const offsets = Buffer.alloc(columnCount * 2, 255);
    const values = entries.map(([column, style], index) => {
      offsets.writeUInt16LE(index * 20, column * 2);
      const value = Buffer.alloc(20);
      value[0] = 5;
      value[1] = 3;
      value.writeUInt32LE(0x28, 8);
      value.writeUInt32LE(1, 12);
      value.writeUInt32LE(style, 16);
      return value;
    });
    return { tileRowIndex, cellCount: entries.length, cellOffsets: offsets, cellStorageBuffer: Buffer.concat(values),
      cellOffsetsPreBnc: new Uint8Array(), cellStorageBufferPreBnc: new Uint8Array() };
  };
  const geometry = { geometry: { position: { x: 0, y: 0 }, size: { width: 6700, height: 12_000 } } };
  const stripeImage = '<svg xmlns="http://www.w3.org/2000/svg" width="120" height="60">'
    + '<path fill="#e61e1e" d="M0 0h40v60H0z"/>'
    + (tinted ? '<path fill="#209048" fill-opacity=".5" d="M40 0h40v60H40z"/>'
      : '<path fill="#209048" d="M40 0h40v60H40z"/><path fill="#2255dd" d="M80 0h40v60H80z"/><path fill="#ffcb27" d="M0 46h120v14H0z"/>')
    + '</svg>';
  return createIworkArchive([
    [1, 12002, 'TN.DocumentArchive', { super: {}, stylesheet: ref(0), sidebarOrder: ref(0), theme: ref(0), sheets: [ref(2)] }, [2]],
    [2, 2, 'TN.SheetArchive', { name: 'Picture fills', drawableInfos: [ref(3)] }, [3]],
    [3, 6000, 'TST.TableInfoArchive', { super: geometry, tableModel: ref(4) }, [4]],
    [4, 6001, 'TST.TableModelArchive', { tableName: 'Image modes', numberOfRows: rowCount, numberOfColumns: columnCount,
      defaultRowHeight: 82, defaultColumnWidth: 112, baseDataStore: { tiles: { tiles: [{ tileid: 0, tile: ref(5) }] },
        stringTable: ref(6), styleTable: ref(7), columnHeaders: ref(8), mergeRegionMap: ref(9) } }, [5, 6, 7, 8, 9]],
    [5, 6002, 'TST.Tile', { maxRow: 2, maxColumn: 5, numCells: 7, numrows: 3,
      rowInfos: [row(0, styles.map((_, index) => [index, index + 1])), row(1, [[5, 4]]), row(2, [[5, 3]])] }, []],
    [6, 6005, 'TST.TableDataList', { listType: 1, nextListID: 2, entries: [{ key: 1, refcount: 7, string: 'Picture' }] }, []],
    [7, 6005, 'TST.TableDataList', { listType: 4, nextListID: 6, entries: styles.map(([id], index) => ({ key: index + 1,
      refcount: 1, reference: ref(id) })) }, styles.map(([id]) => id)],
    [8, 6006, 'TST.HeaderStorageBucket', { bucketHashFunction: 0, headers: styles.map(([id], index) => ({ index,
      numberOfCells: rowCount, size: 112, hidingState: 0, cellStyle: ref(id) })) }, styles.map(([id]) => id)],
    [9, 6107, 'TST.MergeRegionMapArchive', { cellRange: [[1, 1, 5], [2, 120, 50]].map(([row, numRows, numColumns]) => ({
      origin: { packedData: (5 << 16) | row }, size: { packedData: 0, numRows, numColumns }
    })) }, []],
    ...styles,
    [15, 11006, 'TSP.PackageMetadata', { lastObjectIdentifier: 15, datas: [{ identifier: 100, digest: new Uint8Array(),
      preferredFileName: 'Stripes.svg', fileName: 'Stripes.svg' }] }, []]
  ], { 'Data/Stripes.svg': stripeImage });
}
