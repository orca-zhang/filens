import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { minify } from 'terser';
import type { Plugin } from 'vite';

const workerEntry = 'pdfjs-dist/build/pdf.worker.min.mjs';
const workerName = 'pdf.worker.min.mjs';
const developmentName = 'filens-pdf.worker.mjs';
const require = createRequire(import.meta.url);

export function isPdfWorker(file: string): boolean {
  return file.replaceAll('\\', '/').endsWith('/' + workerEntry);
}

export async function readPdfWorker(minified: boolean): Promise<Buffer> {
  const [upstream, storage, attachmentRanges] = await Promise.all([
    readFile(require.resolve('pdfjs-dist/build/pdf.worker.mjs'), 'utf8'),
    readFile(new URL('../packages/pdf/src/range-bytes.mjs', import.meta.url), 'utf8'),
    readFile(new URL('../packages/pdf/src/attachment-ranges.mjs', import.meta.url), 'utf8')
  ]);
  const source = patchAttachments(patchAttachmentRanges(patchRangeStorage(upstream, storage), attachmentRanges));
  if (!minified) return Buffer.from(source);
  const { code } = await minify(source, {
    module: true, ecma: 2020, format: { comments: /@license|@licstart|@preserve|^!|pdfjsVersion/ }
  });
  return Buffer.from(code!);
}

export function pdfWorkerAsset(): Plugin {
  let developmentUrl = '';
  let source: Promise<Buffer> | undefined;
  return {
    name: 'filens-pdf-worker',
    enforce: 'pre',
    configureServer(server) {
      developmentUrl = server.config.base + developmentName;
      server.middlewares.use(async (request, response, next) => {
        if (request.url?.split('?', 1)[0] !== developmentUrl) return next();
        try {
          const bytes = await (source ??= readPdfWorker(false));
          response.setHeader('Content-Type', 'text/javascript; charset=utf-8');
          response.end(bytes);
        } catch (error) { next(error); }
      });
    },
    async load(id) {
      if (!id.endsWith('?url') || !isPdfWorker(id.slice(0, -4))) return;
      if (developmentUrl) return `export default ${JSON.stringify(developmentUrl)};`;
      const reference = this.emitFile({ type: 'asset', name: workerName, source: await (source ??= readPdfWorker(true)) });
      return `export default import.meta.ROLLUP_FILE_URL_${reference};`;
    }
  };
}

function patchRangeStorage(upstream: string, storage: string): string {
  const start = 'class ChunkedStream extends Stream {';
  const end = 'class ChunkedStreamManager {';
  const first = upstream.indexOf(start), last = upstream.indexOf(end);
  if (first < 0 || last <= first) throw new Error('PDF.js changed its range stream.');
  let stream = upstream.slice(first, last);
  // Keep the original fast contiguous storage for smaller files.
  stream = replace(stream, 'super(new Uint8Array(length), 0, length, null);', `const sparse = length > 16 * 1024 * 1024;
    super(new Uint8Array(sparse ? 0 : length), 0, length, null);
    if (sparse) this.bytes = new PdfRangeBytes(length, chunkSize);`);
  stream = replace(stream, 'return this.bytes[this.pos++];',
    'return this.bytes instanceof PdfRangeBytes ? this.bytes.byteAt(this.pos++) : this.bytes[this.pos++];');
  stream = replace(stream, '  getBaseStreams() {', `  clone() {
    if (!(this.bytes instanceof PdfRangeBytes)) return super.clone();
    return new Stream(this.getByteRange(this.start, this.end).slice(), 0, this.length, this.dict.clone());
  }
  getBaseStreams() {`);
  let source = upstream.slice(0, first) + '/*! FiLens modification: allocate PDF range storage by received chunk. */\n'
    + storage.replace('export class', 'class') + '\n' + stream + upstream.slice(last);
  source = replace(source, 'new Uint8Array(stream.bytes.buffer, stream.start, stream.end - stream.start)',
    'stream.getByteRange(stream.start, stream.end)');
  source = replace(source, 'length: stream.bytes.byteLength', 'length: stream.end');
  source = replace(source, 'then(stream => stream.bytes)', 'then(stream => stream.getByteRange(0, stream.end))');
  source = replace(source, 'return stream.bytes;', 'return stream.getByteRange(0, stream.end);', 2);
  source = replace(source, 'originalData: stream.bytes,', 'originalData: stream.getByteRange(0, stream.end),');
  return source.replace(/^\/\/# sourceMappingURL=.*$/m, '');
}

function replace(source: string, original: string, replacement: string, count = 1): string {
  const parts = source.split(original);
  if (parts.length !== count + 1) throw new Error(`PDF.js changed its worker source near "${original}".`);
  return parts.join(replacement);
}

function patchAttachmentRanges(source: string, requests: string): string {
  source = replace(source, 'class ChunkedStreamManager {', requests.replace('export class', 'class') + `
class ChunkedStreamManager {
  #attachmentRanges = new PdfAttachmentRanges(this);`);
  source = replace(source, '  sendRequest(begin, end) {\n    const rangeReader = this.pdfStream.getRangeReader(begin, end);',
    '  sendRequest(begin, end, rangeReader = this.pdfStream.getRangeReader(begin, end), signal) {');
  source = replace(source, '    }).then(data => {\n      if (this.aborted) {', '    }).then(data => {\n      if (this.aborted || signal?.aborted) {');
  source = replace(source, '  _requestChunks(chunks) {', '  _requestChunks(chunks, signal, canCancel) {\n    signal?.throwIfAborted();');
  source = replace(source, '    if (chunksNeeded.size === 0) {\n      return Promise.resolve();',
    '    if (chunksNeeded.size === 0) {\n      this._chunksNeededByRequest.delete(requestId);\n      return Promise.resolve();');
  source = replace(source, '        this.sendRequest(begin, end).catch(capability.reject);', `        if (signal) void this.#attachmentRanges.send(begin, end, canCancel);
        else this.sendRequest(begin, end).catch(capability.reject);`);
  source = replace(source, '    return capability.promise.catch(reason => {\n      if (this.aborted) {', `    let ready = capability.promise;
    if (signal) {
      const abort = () => this.#attachmentRanges.removeWaiter(requestId, signal.reason);
      signal.addEventListener("abort", abort, { once: true });
      ready = ready.finally(() => signal.removeEventListener("abort", abort));
    }
    return ready.catch(reason => {
      if (this.aborted && !signal) {`);
  source = replace(source, '  requestRange(begin, end) {\n    end = Math.min', '  requestRange(begin, end, signal, canCancel) {\n    end = Math.min');
  source = replace(source, 'return this._requestChunks(chunks);\n  }\n  requestRanges', 'return this._requestChunks(chunks, signal, canCancel);\n  }\n  requestRanges');
  return replace(source, '    for (const requestId of loadedRequests) {', '    for (const requestId of loadedRequests) {\n      this._chunksNeededByRequest.delete(requestId);');
}

function patchAttachments(source: string): string {
  source = replace(source, '  get attachments() {\n    const obj = this.#catDict.get("Names");', `
  /*! FiLens modification: resolve named attachment payloads on demand. */
  get attachmentSpecs() {
    const obj = this.#catDict.get("Names");`);
  source = replace(source, 'attachments[stringToPDFString(key, true)] = fs.serializable;',
    'attachments[stringToPDFString(key, true)] = fs;');
  source = replace(source, '    return shadow(this, "attachments", attachments);\n  }', `    return shadow(this, "attachmentSpecs", attachments);
  }
  get attachments() {
    const specs = this.attachmentSpecs;
    const attachments = specs && Object.create(null);
    if (specs) for (const id of Object.keys(specs)) attachments[id] = specs[id].serializable;
    return shadow(this, "attachments", attachments);
  }
  get filensAttachmentList() {
    return { entries: Object.entries(this.attachmentSpecs ?? {}).map(([id, spec]) => ({ id, filename: stripPath(spec.filename) || "unnamed" })) };
  }
  readFilensAttachment(id, limit) {
    if (!Number.isSafeInteger(limit) || limit < 0) throw new Error("Invalid PDF attachment size limit.");
    return this.attachmentSpecs?.[id]?.readContent(limit) ?? null;
  }`);
  source = replace(source, '  get content() {\n    if (!this.#contentAvailable)', `  get content() {
    return this.readContent();
  }
  readContent(limit) {
    if (!this.#contentAvailable)`);
  source = replace(source, '    if (ef instanceof BaseStream) {\n      return ef.getBytes();\n    }', `    if (ef instanceof BaseStream) {
      if (limit === undefined) return ef.getBytes().slice();
      const tooLarge = () => new Error("Attachment exceeds the expanded preview size limit.");
      if (ef instanceof Stream) {
        if (ef.length > limit) throw tooLarge();
        return ef.getBytes().slice();
      }
      let size = 0;
      for (;;) {
        const length = Math.min(65536, limit - size + 1);
        const bytes = ef.getBytes(length);
        size += bytes.byteLength;
        if (size > limit) throw tooLarge();
        if (bytes.byteLength < length) break;
      }
      ef.reset();
      return size ? ef.getBytes(size).slice() : new Uint8Array(0);
    }`);
  // Rendering ordinary annotations needs only the FileSpecs. A GoToE link still resolves its target.
  source = replace(source, 'docAttachments: this.attachments', 'docAttachments: this.attachmentSpecs');
  source = replace(source, 'pdfManager.ensureCatalog("attachments"),', 'pdfManager.ensureCatalog("attachmentSpecs"),');
  source = replace(source, 'attachment = docAttachments[stringToPDFString(name, true)];',
    'attachment = docAttachments[stringToPDFString(name, true)]?.serializable;');
  return replace(source, 'handler.on("GetAttachments", function (data) {', `handler.on("GetAttachments", function (data, sink) {
      if (data?.filens === "list") return pdfManager.ensureCatalog("filensAttachmentList");
      if (data?.filens === "read") {
        if (!sink) return pdfManager.ensureCatalog("readFilensAttachment", [data.id, data.limit]);
        const controller = new AbortController();
        sink.onCancel = () => controller.abort(new AbortException("PDF attachment read cancelled."));
        const read = async () => {
          const signal = controller.signal, manager = pdfManager.streamManager;
          for (;;) {
            signal.throwIfAborted();
            try {
              return pdfManager.pdfDocument.catalog.readFilensAttachment(data.id, data.limit);
            } catch (error) {
              if (!(error instanceof MissingDataException) || !manager || manager.aborted) throw error;
              await manager.requestRange(error.begin, error.end, signal, data.cancelRanges);
            }
          }
        };
        void read().then(bytes => {
          if (bytes) sink.enqueue(bytes, 0, [bytes.buffer]);
          sink.close();
        }, error => sink.error(error));
        return;
      }`);
}
