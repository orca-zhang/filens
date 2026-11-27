import type { ZipEntry } from '@filens/core/zip';
import { uncompress as snappyUncompress } from 'snappyjs';
import { decodeTypedMessage } from './protobuf';

interface MessageInfo {
  type?: number;
  length?: number;
  objectReferences?: number[];
  dataReferences?: number[];
}

interface ArchiveInfo {
  identifier?: number;
  messageInfos?: MessageInfo[];
}

export interface IwaMessage {
  archiveId: number;
  index: number;
  info: MessageInfo;
  payload: Uint8Array;
}

export const DOCUMENT_IWA_PATH = 'Index/Document.iwa';
const emptyBytes = new Uint8Array();

/** Consume the ZIP stream and Snappy frames in order. Keep a contiguous copy
 * only for a protobuf field or payload that crosses frame boundaries. */
export async function readIwaMessages(file: ZipEntry,
  visit: (message: IwaMessage) => void,
  { signal, readPayload = true }: { signal?: AbortSignal; readPayload?: boolean } = {}): Promise<void> {
  const bytes = new ChunkReader(snappyFrames(file, signal), signal);
  try {
    for (;;) {
      const length = await bytes.readVarUint();
      if (length === undefined) break;
      if (length === 0) { await bytes.drain(); break; }
      const info = decodeTypedMessage('TSP.ArchiveInfo', await bytes.read(length)) as ArchiveInfo;
      const archiveId = Number(info.identifier ?? 0), messages = info.messageInfos ?? [];
      for (const [index, message] of messages.entries()) {
        const size = Number(message.length ?? 0);
        if (!readPayload) await bytes.skip(size);
        visit({ archiveId, index, info: message, payload: readPayload ? await bytes.read(size) : emptyBytes });
      }
    }
  } finally { await bytes.close(); }
}

async function* zipChunks(file: ZipEntry, signal?: AbortSignal): AsyncGenerator<Uint8Array> {
  const chunks = file.chunks?.(signal);
  if (chunks) yield* chunks;
  else yield await file.bytes(undefined, signal);
}

async function* snappyFrames(file: ZipEntry, signal?: AbortSignal): AsyncGenerator<Uint8Array> {
  const bytes = new ChunkReader(zipChunks(file, signal), signal);
  try {
    let header = await bytes.read(4, true);
    // Some packages encode edit history in LZFSE. Snapshot records provide the preview.
    if (header?.[0] === 0x62 && file.name === 'Index/OperationStorage.iwa'
      && /^bvx[-12n$]$/.test(String.fromCharCode(...header))) return;
    while (header) {
      if (header[0] !== 0) throw new Error(`Unsupported iWork snappy chunk header ${header[0]}.`);
      const length = header[1] | (header[2] << 8) | (header[3] << 16);
      yield snappyUncompress(await bytes.read(length));
      header = await bytes.read(4, true);
    }
  } finally { await bytes.close(); }
}

class ChunkReader {
  private readonly source: AsyncIterator<Uint8Array>;
  private bytes: Uint8Array = emptyBytes;
  private offset = 0;

  constructor(chunks: AsyncIterable<Uint8Array>, private readonly signal?: AbortSignal) {
    this.source = chunks[Symbol.asyncIterator]();
  }

  async read(size: number): Promise<Uint8Array>;
  async read(size: number, allowEnd: true): Promise<Uint8Array | undefined>;
  async read(size: number, allowEnd = false): Promise<Uint8Array | undefined> {
    this.signal?.throwIfAborted();
    if (!size) return emptyBytes;
    if (this.offset === this.bytes.length && !await this.advance()) {
      if (allowEnd) return undefined;
      throw unexpectedEnd();
    }
    const first = this.take(size);
    if (first.length === size) return first;
    const parts = [first];
    let read = first.length;
    while (read < size) {
      if (!await this.advance()) throw unexpectedEnd();
      const part = this.take(size - read);
      parts.push(part);
      read += part.length;
    }
    // Allocate only after confirming the full length is present.
    const output = new Uint8Array(size);
    let offset = 0;
    for (const part of parts) {
      output.set(part, offset);
      offset += part.length;
    }
    return output;
  }

  async skip(size: number): Promise<void> {
    this.signal?.throwIfAborted();
    while (size > 0) {
      if (this.offset === this.bytes.length && !await this.advance()) throw unexpectedEnd();
      const count = Math.min(size, this.bytes.length - this.offset);
      this.offset += count;
      size -= count;
    }
  }

  async readVarUint(): Promise<number | undefined> {
    this.signal?.throwIfAborted();
    if (this.offset === this.bytes.length && !await this.advance()) return undefined;
    let value = 0;
    for (let shift = 0; shift <= 28; shift += 7) {
      if (this.offset === this.bytes.length && !await this.advance()) throw unexpectedEnd();
      const byte = this.bytes[this.offset++];
      value += (byte & 0x7f) * 2 ** shift;
      if (byte < 128 && value <= 0xffffffff) return value;
    }
    throw new Error('Invalid iWork archive length.');
  }

  async drain(): Promise<void> {
    do { this.offset = this.bytes.length; } while (await this.advance());
  }

  async close(): Promise<void> { await this.source.return?.(); }

  private take(size: number): Uint8Array {
    const end = Math.min(this.offset + size, this.bytes.length);
    const part = this.bytes.subarray(this.offset, end);
    this.offset = end;
    return part;
  }

  private async advance(): Promise<boolean> {
    for (;;) {
      this.signal?.throwIfAborted();
      const result = await this.source.next();
      this.signal?.throwIfAborted();
      if (result.done) return false;
      if (!result.value.length) continue;
      this.bytes = result.value;
      this.offset = 0;
      return true;
    }
  }
}

function unexpectedEnd(): Error { return new Error('Unexpected end of iWork archive.'); }
