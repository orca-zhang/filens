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
  const [upstream, storage] = await Promise.all([
    readFile(require.resolve('pdfjs-dist/build/pdf.worker.mjs'), 'utf8'),
    readFile(new URL('../packages/pdf/src/range-bytes.mjs', import.meta.url), 'utf8')
  ]);
  const source = patchRangeStorage(upstream, storage);
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
