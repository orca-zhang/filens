import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import JSZip from 'jszip';
import protobuf from 'protobufjs/light.js';
import snappy from 'snappyjs';

let schema;
async function root() {
  const descriptor = resolve(dirname(fileURLToPath(import.meta.url)), '../../src/generated/iwork-proto.json');
  return schema ??= readFile(descriptor, 'utf8')
    .then(json => protobuf.Root.fromJSON(JSON.parse(json)));
}

export async function createIworkArchive(records, files = {}) {
  const schema = await root();
  const chunks = [];
  for (const [identifier, typeId, typeName, value, objectReferences] of records) {
    const type = schema.lookupType(typeName), error = type.verify(value);
    if (error) throw new Error(`${typeName}: ${error}`);
    const payload = type.encode(value).finish();
    const header = schema.lookupType('TSP.ArchiveInfo').encode({ identifier,
      messageInfos: [{ type: typeId, length: payload.length, objectReferences }] }).finish();
    chunks.push(protobuf.Writer.create().uint32(header.length).finish(), header, payload);
  }
  const bytes = Buffer.concat(chunks), blocks = [];
  for (let start = 0; start < bytes.length; start += 64 * 1024) blocks.push(bytes.subarray(start, start + 64 * 1024));
  const zip = new JSZip(); zip.file('Index/Document.iwa', frameIwa(blocks), { date: new Date('2020-01-01T00:00:00Z'), createFolders: false });
  for (const [path, data] of Object.entries(files)) zip.file(path, data, { createFolders: false });
  return zip.generateAsync({ type: 'uint8array', compression: 'DEFLATE' });
}

export function frameIwa(blocks) {
  const frames = [];
  for (const block of blocks) {
    const compressed = snappy.compress(block), header = Buffer.alloc(4);
    header.writeUIntLE(compressed.length, 1, 3);
    frames.push(header, compressed);
  }
  return Buffer.concat(frames);
}
