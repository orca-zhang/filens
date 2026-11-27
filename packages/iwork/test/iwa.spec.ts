// @vitest-environment node
import type { ZipEntry } from '@filens/core/zip';
import JSZip from 'jszip';
import { Root, Writer } from 'protobufjs';
import { describe, expect, it, vi } from 'vitest';
import descriptor from '../src/generated/iwork-proto';
import { loadIwork } from '../src';
import { readIwaMessages, type IwaMessage } from '../src/parser/iwa';
import { createModernNumbersArchive, frameIwa } from './fixtures/numbers-archive.mjs';

const schema = Root.fromJSON(descriptor);
const archiveInfo = schema.lookupType('TSP.ArchiveInfo');
const objectReferences = Array.from({ length: 150 }, (_, i) => i + 1);

function archiveParts(payloadLength: number) {
  const header = archiveInfo.encode({
    identifier: 123,
    messageInfos: [{ type: 6002, length: payloadLength, objectReferences }]
  }).finish();
  return { header, prefix: Writer.create().uint32(header.length).finish() };
}

function entryFrom(chunks: ZipEntry['chunks']): ZipEntry {
  const unexpectedRead = async () => { throw new Error('Expected a streamed ZIP entry'); };
  return { name: 'Index/Document.iwa', directory: false, chunks, bytes: unexpectedRead, text: unexpectedRead };
}

describe('streamed iWork archive messages', () => {
  it.each([true, false])('handles split ZIP and Snappy frames with readPayload=%s', async readPayload => {
    const payload = Uint8Array.of(2, 7, 1, 8, 2);
    const { header, prefix } = archiveParts(payload.length);
    expect(prefix).toHaveLength(2);
    const framed: Uint8Array = frameIwa([prefix.subarray(0, 1), prefix.subarray(1),
      header.subarray(0, 20), header.subarray(20), payload.subarray(0, 2), payload.subarray(2)]);
    const file = entryFrom(async function* () {
      for (let i = 0; i < framed.length; i += 3) yield framed.subarray(i, i + 3);
    });
    const messages: IwaMessage[] = [];
    await readIwaMessages(file, message => { messages.push(message); }, { readPayload });
    expect(messages).toMatchObject([{
      archiveId: 123, index: 0, info: { type: 6002, length: payload.length, objectReferences },
      payload: readPayload ? payload : new Uint8Array()
    }]);
  });

  const { prefix, header } = archiveParts(5);
  it.each([
    ['Snappy header', Uint8Array.of(0, 2, 0)],
    ['Snappy body', frameIwa([prefix]).subarray(0, -1)],
    ['archive varint', frameIwa([prefix.subarray(0, 1)])],
    ['archive metadata', frameIwa([prefix, header.subarray(0, -1)])],
    ['message payload', frameIwa([prefix, header, Uint8Array.of(1, 2)])]
  ] as const)('rejects a truncated %s', async (_name, bytes) => {
    const visit = vi.fn();
    await expect(readIwaMessages(entryFrom(async function* () { yield bytes; }), visit)).rejects.toThrow('Unexpected end');
    expect(visit).not.toHaveBeenCalled();
  });

  it('closes the source without reading another chunk on cancellation', async () => {
    const controller = new AbortController(), closed = vi.fn(), extraRead = vi.fn();
    const first = frameIwa([prefix, header, new Uint8Array(5)]);
    const file = entryFrom(async function* () {
      try {
        yield first;
        extraRead();
        yield first;
      } finally { closed(); }
    });
    const reason = new Error('File replaced');
    await expect(readIwaMessages(file, () => controller.abort(reason), { signal: controller.signal })).rejects.toBe(reason);
    expect(closed).toHaveBeenCalledTimes(1);
    expect(extraRead).not.toHaveBeenCalled();
  });

  it('skips LZFSE edit history and still rejects unsupported document compression', async () => {
    const file = entryFrom(async function* () {
      yield Uint8Array.of(0x62, 0x76);
      yield Uint8Array.of(0x78, 0x6e);
    });
    const visit = vi.fn();
    await readIwaMessages({ ...file, name: 'Index/OperationStorage.iwa' }, visit);
    expect(visit).not.toHaveBeenCalled();
    await expect(readIwaMessages(file, visit)).rejects.toThrow('Unsupported iWork snappy chunk header');
  });

  it('keeps ZIP path order for duplicate records when reusing type detection', async () => {
    const zip = await JSZip.loadAsync(await createModernNumbersArchive());
    const value = schema.lookupType('TSWP.StorageArchive').encode({ kind: 5, text: ['Earlier record'] }).finish();
    const header = archiveInfo.encode({ identifier: 15, messageInfos: [{ type: 2001, length: value.length }] }).finish();
    zip.file('Index/A.iwa', frameIwa([Writer.create().uint32(header.length).finish(), header, value]));
    const bytes = await zip.generateAsync({ type: 'uint8array' });
    const detected = await loadIwork(bytes), explicit = await loadIwork(bytes, { hint: 'numbers' });
    expect(detected.archive.records['15'].value).toMatchObject({ text: ['Styled text'] });
    expect(detected.archive).toEqual(explicit.archive);
  });
});
