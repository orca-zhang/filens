function join(records: Uint8Array[]): Uint8Array {
  const result = new Uint8Array(records.reduce((size, record) => size + record.length, 0));
  let offset = 0;
  for (const record of records) {
    result.set(record, offset);
    offset += record.length;
  }
  return result;
}

function emfRecord(type: number, ...values: number[]): Uint8Array {
  const bytes = new Uint8Array(8 + values.length * 4);
  const view = new DataView(bytes.buffer);
  [type, bytes.length, ...values].forEach((value, index) => view.setUint32(index * 4, value, true));
  return bytes;
}

export function buildEmfPoster(): Uint8Array {
  const header = emfRecord(1, 0, 0, 120, 60, 0, 0, 3175, 1588, 0x464d4520, 0x10000,
    0, 0, 2, 0, 0, 0, 120, 60, 32, 16);
  const text = 'Embedded EMF';
  const dx = 76 + text.length * 2;
  const run = new Uint8Array(dx + text.length * 4);
  const runView = new DataView(run.buffer);
  const fields: Array<[number, number]> = [
    [0, 84], [4, run.length], [16, 120], [20, 60], [24, 1], [36, 6], [40, 24],
    [44, text.length], [48, 76], [72, dx]
  ];
  for (const [offset, value] of fields) runView.setUint32(offset, value, true);
  runView.setFloat32(28, 1, true);
  runView.setFloat32(32, 1, true);
  for (let index = 0; index < text.length; index++) {
    runView.setUint16(76 + index * 2, text.charCodeAt(index), true);
    runView.setInt32(dx + index * 4, 7, true);
  }
  const records = [header, emfRecord(39, 1, 0, 0xa05522, 0), emfRecord(37, 1),
    emfRecord(43, 0, 0, 120, 60), emfRecord(22, 24), emfRecord(24, 0xffffff), run, emfRecord(14, 0, 16, 20)];
  const view = new DataView(header.buffer);
  view.setUint32(48, records.reduce((size, record) => size + record.length, 0), true);
  view.setUint32(52, records.length, true);
  return join(records);
}

function wmfRecord(type: number, ...values: number[]): Uint8Array {
  const bytes = new Uint8Array(6 + values.length * 2);
  const view = new DataView(bytes.buffer);
  view.setUint32(0, bytes.length / 2, true);
  [type, ...values].forEach((value, index) => view.setUint16(4 + index * 2, value, true));
  return bytes;
}

export function buildWmfPoster(): Uint8Array {
  const records = [wmfRecord(0x020b, 0, 0), wmfRecord(0x020c, 60, 120),
    wmfRecord(0x02fc, 0, 0x8031, 0x4b, 0), wmfRecord(0x012d, 0), wmfRecord(0x041b, 60, 120, 0, 0), wmfRecord(0)];
  const placeable = new Uint8Array(22);
  const p = new DataView(placeable.buffer);
  p.setUint32(0, 0x9ac6cdd7, true);
  p.setInt16(10, 120, true);
  p.setInt16(12, 60, true);
  p.setUint16(14, 96, true);
  let checksum = 0;
  for (let offset = 0; offset < 20; offset += 2) checksum ^= p.getUint16(offset, true);
  p.setUint16(20, checksum, true);
  const header = new Uint8Array(18);
  const h = new DataView(header.buffer);
  h.setUint16(0, 1, true);
  h.setUint16(2, 9, true);
  h.setUint16(4, 0x0300, true);
  h.setUint32(6, 9 + records.reduce((size, record) => size + record.length / 2, 0), true);
  h.setUint16(10, 1, true);
  h.setUint32(12, Math.max(...records.map(record => record.length / 2)), true);
  return join([placeable, header, ...records]);
}
