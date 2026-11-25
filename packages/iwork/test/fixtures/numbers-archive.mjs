import { readFile } from 'node:fs/promises';
import JSZip from 'jszip';
import protobuf from 'protobufjs/light.js';
import snappy from 'snappyjs';

let schema;
async function root() {
  return schema ??= readFile(new URL('../../src/generated/iwork-proto.json', import.meta.url), 'utf8')
    .then(json => protobuf.Root.fromJSON(JSON.parse(json)));
}

/** A serialized ZIP/IWA fixture exercises the real decoder, semantic builder and worker. */
export async function createLargeMergedNumbersArchive({ rowCount = 100_000, columnCount = 1024, emptyAnchor = false } = {}) {
  const schema = await root();
  const reference = identifier => ({ identifier });
  const text = (key, legacy = false) => {
    const bytes = new Uint8Array(legacy ? 20 : 16), view = new DataView(bytes.buffer);
    bytes[0] = legacy ? 4 : 5; bytes[1] = 3;
    if (legacy) view.setUint16(4, 3, true);
    view.setUint32(legacy ? 16 : 12, key, true); return bytes;
  };
  const row = (index, column, key, legacy = false) => {
    const offsets = new Uint8Array(columnCount * 2); offsets.fill(255);
    new DataView(offsets.buffer).setUint16(column * 2, 0, true);
    return { tileRowIndex: index % 256, cellCount: 1,
      cellOffsetsPreBnc: legacy ? offsets : new Uint8Array(), cellStorageBufferPreBnc: legacy ? text(key, true) : new Uint8Array(),
      ...(!legacy ? { cellOffsets: offsets, cellStorageBuffer: text(key) } : {}) };
  };
  const positions = [0, Math.floor(rowCount / 2), rowCount - 1];
  const tileIds = [5, 8, 9];
  const records = [
    [1, 12002, 'TN.DocumentArchive', { super: {}, stylesheet: reference(0), sidebarOrder: reference(0), theme: reference(0), sheets: [reference(2)] }, [2]],
    [2, 2, 'TN.SheetArchive', { name: 'Large merged archive', drawableInfos: [reference(3)] }, [3]],
    [3, 6000, 'TST.TableInfoArchive', { super: { geometry: { position: { x: 0, y: 0 }, size: { width: 800, height: 600 } } }, tableModel: reference(4) }, [4]],
    [4, 6001, 'TST.TableModelArchive', { tableName: 'Sparse merged table', numberOfRows: rowCount, numberOfColumns: columnCount,
      defaultRowHeight: 26, defaultColumnWidth: 96,
      baseDataStore: { tiles: { tileSize: 256, tiles: positions.map((index, i) => ({ tileid: Math.floor(index / 256), tile: reference(tileIds[i]) })) },
        stringTable: reference(6), mergeRegionMap: reference(7) } }, [...tileIds, 6, 7]],
    [6, 6005, 'TST.TableDataList', { listType: 1, nextListID: 4, entries: ['Large merge origin', 'Stored covered value', 'Last sparse cell']
      .map((string, i) => ({ key: i + 1, refcount: 1, string })) }, []],
    [7, 6107, 'TST.MergeRegionMapArchive', { cellRange: [{ origin: { packedData: 0 },
      size: { packedData: 0, numRows: rowCount - 1, numColumns: columnCount } }] }, []],
    ...positions.map((index, i) => [tileIds[i], 6002, 'TST.Tile', { maxRow: index % 256, maxColumn: columnCount - 1,
      numCells: emptyAnchor && i === 0 ? 0 : 1, numrows: index % 256 + 1,
      rowInfos: emptyAnchor && i === 0 ? [] : [row(index, i === 0 ? 0 : i === 1 ? Math.floor(columnCount / 2) : columnCount - 1, i + 1, i === 2)] }, []])
  ];
  const chunks = [];
  for (const [identifier, typeId, typeName, value, objectReferences] of records) {
    const type = schema.lookupType(typeName), error = type.verify(value);
    if (error) throw new Error(`${typeName}: ${error}`);
    const payload = type.encode(value).finish();
    const header = schema.lookupType('TSP.ArchiveInfo').encode({ identifier,
      messageInfos: [{ type: typeId, length: payload.length, objectReferences }] }).finish();
    chunks.push(protobuf.Writer.create().uint32(header.length).finish(), header, payload);
  }
  const compressed = snappy.compress(Buffer.concat(chunks));
  const frame = new Uint8Array(compressed.length + 4);
  frame[1] = compressed.length & 255; frame[2] = compressed.length >>> 8 & 255; frame[3] = compressed.length >>> 16 & 255;
  frame.set(compressed, 4);
  const zip = new JSZip(); zip.file('Index/Document.iwa', frame, { date: new Date('2020-01-01T00:00:00Z'), createFolders: false });
  return zip.generateAsync({ type: 'uint8array', compression: 'DEFLATE' });
}
