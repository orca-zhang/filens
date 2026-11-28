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
  const [upstream, storage, rangeRequests] = await Promise.all([
    readFile(require.resolve('pdfjs-dist/build/pdf.worker.mjs'), 'utf8'),
    readFile(new URL('../packages/pdf/src/range-bytes.mjs', import.meta.url), 'utf8'),
    readFile(new URL('../packages/pdf/src/range-requests.mjs', import.meta.url), 'utf8')
  ]);
  let source = patchRangeStorage(upstream, storage);
  source = patchRangeRequests(source, rangeRequests);
  source = replace(source, '    this._reader.cancel(reason);', '    this._reader.cancel(reason).catch(() => {});', 2);
  source = patchTextRanges(source);
  source = patchPageLookupRanges(source);
  source = patchNavigationRanges(source);
  source = patchOperatorRanges(source);
  source = patchAnnotationRanges(source);
  source = patchAttachments(source);
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

export function pdfDocumentPages(): Plugin {
  return {
    name: 'filens-pdf-document-pages',
    enforce: 'pre',
    config: () => ({ optimizeDeps: { exclude: ['pdfjs-dist'] } }),
    transform(code, id) {
      if (!id.split('?')[0].replaceAll('\\', '/').endsWith('/pdfjs-dist/build/pdf.mjs')) return;
      // The display module is imported privately by the preview and uses ES exports.
      const globals = /\{\n  globalThis\._pdfjsTestingUtils = \{[\s\S]*?\n\}\nglobalThis\.pdfjsLib = \{[\s\S]*?\n\};/.exec(code)?.[0];
      if (!globals) throw new Error('PDF.js changed its display globals.');
      code = replace(code, globals, '');
      const mapper = /class PagesMapper \{[\s\S]*?\n\}/.exec(code)?.[0];
      if (!mapper) throw new Error('PDF.js changed its page mapper.');
      // Each transport owns its page count, mapping and cache listener.
      let source = replace(code, mapper, mapper.replace(/^  static (#\w+)/gm, '  $1').replaceAll('PagesMapper.#', 'this.#'));
      source = replace(source, '  #pagesMapper = PagesMapper.instance;\n  constructor(pageIndex,',
        '  get #pagesMapper() { return this._transport.pagesMapper; }\n  constructor(pageIndex,');
      source = replace(source, '  #pagesMapper = PagesMapper.instance;\n  constructor(messageHandler,',
        '  #pagesMapper = new PagesMapper();\n  get pagesMapper() { return this.#pagesMapper; }\n  constructor(messageHandler,');
      return '/*! FiLens modification: document-local page state, offscreen proxy release and range cleanup. */\n'
        + patchPageProxies(patchHttpRangeResponses(patchDisplayRangeCleanup(source)));
    }
  };
}

function patchDisplayRangeCleanup(source: string): string {
  // A fetch reader can already be errored when the transport cancels it.
  source = replace(source, `    this._reader?.cancel(reason);
    this._abortController.abort();`, `    this._reader?.cancel(reason).catch(() => {});
    this._abortController.abort();`, 2);
  const start = source.indexOf('    messageHandler.on("GetRangeReader",'), end = source.indexOf('    messageHandler.on("GetDoc",', start);
  if (start < 0 || end < 0) throw new Error('PDF.js changed its range reader handler.');
  const original = source.slice(start, end);
  let handler = replace(original, '      const rangeReader = this.#networkStream.getRangeReader(data.begin, data.end);',
    `      const stream = this.#networkStream;
      const rangeReader = stream.getRangeReader(data.begin, data.end);`);
  handler = replace(handler, '          if (done) {\n            sink.close();',
    '          if (done) {\n            stream._rangeReaders.delete(rangeReader);\n            sink.close();');
  handler = replace(handler, '        }).catch(reason => {\n          sink.error(reason);',
    '        }).catch(reason => {\n          stream._rangeReaders.delete(rangeReader);\n          sink.error(reason);');
  handler = replace(handler, `        rangeReader.cancel(reason);
        sink.ready.catch(readyReason => {
          if (this.destroyed) {
            return;
          }
          throw readyReason;
        });`, `        stream._rangeReaders.delete(rangeReader);
        rangeReader.cancel(reason);
        // The worker intentionally rejects backpressure when it cancels this stream.
        sink.ready.catch(() => {});`);
  return replace(source, original, handler);
}

function patchHttpRangeResponses(source: string): string {
  source = replace(source, '      this._filename = extractFilenameFromHeader(responseHeaders);',
    `      this._filename = extractFilenameFromHeader(responseHeaders);
      if (allowRangeRequests) {
        stream._rangeValidators = ["ETag", "Last-Modified"].map(name => [name, responseHeaders.get(name)]);
      }`);
  const start = source.indexOf('class PDFFetchStreamRangeReader extends'), end = source.indexOf(';// ./src/display/network.js', start);
  if (start < 0 || end < 0) throw new Error('PDF.js changed its HTTP range reader.');
  const original = source.slice(start, end);
  let reader = replace(original, '    super(stream, begin, end);',
    `    super(stream, begin, end);
    this._remaining = end - begin;
    // The response can fail before the worker asks the reader for its first chunk.
    this._readCapability.promise.catch(() => {});`);
  reader = replace(reader, '      ensureResponseStatus(response.status, url);',
    String.raw`      ensureResponseStatus(response.status, url);
      const contentRange = response.headers.get("Content-Range");
      const range = /^bytes (\d+)-(\d+)\/(\d+)$/i.exec(contentRange ?? "");
      // A CORS response can hide Content-Range; status and length still apply.
      const matches = contentRange === null && response.type === "cors" || range &&
        Number(range[1]) === begin && Number(range[2]) === end - 1 && Number(range[3]) === stream._fullReader.contentLength;
      const length = response.headers.get("Content-Length");
      const encoding = response.headers.get("Content-Encoding");
      if (response.status !== 206 || !matches || length !== null && Number(length) !== this._remaining ||
          encoding && encoding.toLowerCase() !== "identity") {
        throw new Error("Invalid PDF byte range response.");
      }
      if (stream._rangeValidators?.some(([name, value]) => value && response.headers.get(name) !== value)) {
        throw new Error("PDF byte range belongs to a different document revision.");
      }`);
  reader = replace(reader, '    }).catch(this._readCapability.reject);', `    }).catch(reason => {
      this.cancel(reason);
      this._readCapability.reject(reason);
    });`);
  reader = replace(reader, '    if (done) {', `    this._remaining -= value?.byteLength ?? 0;
    if (!this._abortController.signal.aborted && (this._remaining < 0 || done && this._remaining !== 0)) {
      const error = new Error("Invalid PDF byte range response length.");
      this.cancel(error);
      throw error;
    }
    if (done) {`);
  return replace(source, original, reader);
}

function patchPageProxies(source: string): string {
  source = replace(source, '  #pagePromises = new Map();', '  #pagePromises = new Map();\n  #pageMetadata = new Map();\n  #nextPageId = 0;');
  source = replace(source, '    this.#pageRefCache.clear();', '    this.#pageRefCache.clear();\n    this.#pageMetadata.clear();');
  source = replace(source, `    const promise = this.messageHandler.sendWithPromise("GetPage", {
      pageIndex: newPageIndex
    }).then(pageInfo => {`, `    const metadata = this.#pageMetadata.get(newPageIndex);
    const promise = (metadata ? Promise.resolve(metadata) : this.messageHandler.sendWithPromise("GetPage", {
      pageIndex: newPageIndex
    })).then(pageInfo => {`);
  source = replace(source, '      this.#pageCache.set(pageIndex, page);',
    '      page.filensPage = ++this.#nextPageId;\n      this.#pageCache.set(pageIndex, page);');
  source = replace(source, '  async getPageIndex(ref) {', `  releasePage(page) {
    const index = page.pageNumber - 1;
    if (this.destroyed || this.#pageCache.get(index) !== page) return;
    const pageIndex = this.#pagesMapper.getPageId(index + 1) - 1;
    this.#pageMetadata.set(pageIndex, page._pageInfo);
    this.#pageCache.delete(index);
    this.#pagePromises.delete(index);
    void page._destroy();
    page._intentStates.clear();
    this.messageHandler.send("ReleasePage", { pageIndex, ref: page.ref });
  }
  async getPageIndex(ref) {`);
  source = replace(source, '      intent: renderingIntent,\n      cacheKey,',
    '      intent: renderingIntent,\n      cacheKey,\n      filensPage: this.filensPage,');
  source = replace(source, '      page._startRenderPage(data.transparency, data.cacheKey);',
    '      if (page && page.filensPage === data.filensPage) page._startRenderPage(data.transparency, data.cacheKey);');
  source = replace(source, 'messageHandler.on("obj", ([id, pageIndex, type, imageData]) => {',
    'messageHandler.on("obj", ([id, pageIndex, type, imageData, filensPage]) => {');
  source = replace(source, '      if (pageProxy.objs.has(id)) {', `      if (!pageProxy || pageProxy.filensPage !== filensPage) {
        imageData?.bitmap?.close();
        return;
      }
      if (pageProxy.objs.has(id)) {`);
  const start = source.indexOf('  _pumpOperatorList({'), end = source.indexOf('  _abortOperatorList({', start);
  if (start < 0 || end < 0) throw new Error('PDF.js changed its operator-list reader.');
  const pump = source.slice(start, end);
  return replace(source, pump, replace(pump, 'if (this._transport.destroyed) {', 'if (this.destroyed || this._transport.destroyed) {', 2));
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
  if (parts.length !== count + 1) throw new Error(`PDF.js source changed near "${original}".`);
  return parts.join(replacement);
}

function patchRangeRequests(source: string, requests: string): string {
  source = replace(source, 'class ChunkedStreamManager {', requests.replace('export class', 'class') + `
class ChunkedStreamManager {
  #rangeRequests = new PdfRangeRequests(this);`);
  source = replace(source, '  sendRequest(begin, end) {\n    const rangeReader = this.pdfStream.getRangeReader(begin, end);',
    '  sendRequest(begin, end, rangeReader = this.pdfStream.getRangeReader(begin, end), signal) {');
  source = replace(source, '    }).then(data => {\n      if (this.aborted) {', '    }).then(data => {\n      if (this.aborted || signal?.aborted) {');
  source = replace(source, `        begin
      });
    });
  }
  requestAllChunks`, `        begin
      });
    }).finally(() => this.pdfStream._rangeReaders.delete(rangeReader));
  }
  requestAllChunks`);
  source = replace(source, '  _requestChunks(chunks) {', '  _requestChunks(chunks, signal, canCancel) {\n    signal?.throwIfAborted();');
  source = replace(source, '    if (chunksNeeded.size === 0) {\n      return Promise.resolve();',
    '    if (chunksNeeded.size === 0) {\n      this._chunksNeededByRequest.delete(requestId);\n      return Promise.resolve();');
  source = replace(source, '        this.sendRequest(begin, end).catch(capability.reject);', `        if (signal) void this.#rangeRequests.send(begin, end, canCancel);
        else this.sendRequest(begin, end).catch(capability.reject);`);
  source = replace(source, '    return capability.promise.catch(reason => {\n      if (this.aborted) {', `    let ready = capability.promise;
    if (signal) {
      const abort = () => this.#rangeRequests.removeWaiter(requestId, signal.reason);
      signal.addEventListener("abort", abort, { once: true });
      ready = ready.finally(() => signal.removeEventListener("abort", abort));
    }
    return ready.catch(reason => {
      if (this.aborted && !signal) {`);
  source = replace(source, '  requestRange(begin, end) {\n    end = Math.min', '  requestRange(begin, end, signal, canCancel) {\n    end = Math.min');
  source = replace(source, 'return this._requestChunks(chunks);\n  }\n  requestRanges', 'return this._requestChunks(chunks, signal, canCancel);\n  }\n  requestRanges');
  source = replace(source, '  requestRanges(ranges = []) {', '  requestRanges(ranges = [], signal, canCancel) {');
  source = replace(source, 'return this._requestChunks(chunksToRequest);', 'return this._requestChunks(chunksToRequest, signal, canCancel);');
  return replace(source, '    for (const requestId of loadedRequests) {', '    for (const requestId of loadedRequests) {\n      this._chunksNeededByRequest.delete(requestId);');
}

function patchTextRanges(source: string): string {
  // A signal belongs to one text stream, including when another reader needs the same range.
  source = replace(source, '  async ensure(obj, prop, args) {\n    try {',
    '  async ensure(obj, prop, args, signal) {\n    signal?.throwIfAborted();\n    try {');
  source = replace(source, '      await this.requestRange(ex.begin, ex.end);\n      return this.ensure(obj, prop, args);',
    '      await this.streamManager.requestRange(ex.begin, ex.end, signal, true);\n      return this.ensure(obj, prop, args, signal);');
  source = replace(source, '  ensureCatalog(prop, args) {\n    return this.ensure(this.pdfDocument.catalog, prop, args);',
    '  ensureCatalog(prop, args, signal) {\n    return this.ensure(this.pdfDocument.catalog, prop, args, signal);');
  source = replace(source, '  async getContentStream() {\n    const content = await this.pdfManager.ensure(this, "content");',
    '  async getContentStream(signal) {\n    const content = await this.pdfManager.ensure(this, "content", undefined, signal);');
  source = replace(source, `  async loadResources(keys) {
    await (this.#resourcesPromise ??= this.pdfManager.ensure(this, "resources"));
    await ObjectLoader.load(this.resources, keys, this.xref);
  }
  async #getMergedResources(streamDict, keys) {`, `  async loadResources(keys, signal) {
    // Only requests without a cancellation signal reuse the document-lifetime promise.
    if (signal) await this.pdfManager.ensure(this, "resources", undefined, signal);
    else await (this.#resourcesPromise ??= this.pdfManager.ensure(this, "resources"));
    await ObjectLoader.load(this.resources, keys, this.xref, signal);
  }
  async #getMergedResources(streamDict, keys, signal) {`);
  source = replace(source, 'await ObjectLoader.load(localResources, keys, this.xref);',
    'await ObjectLoader.load(localResources, keys, this.xref, signal);');
  source = replace(source, '  async #getMergedResources(streamDict, keys, signal) {\n    const localResources',
    '  async #getMergedResources(streamDict, keys, signal) {\n    signal?.throwIfAborted();\n    const localResources');
  source = replace(source, '    this.xref = xref;\n  }\n  async load() {\n    const {\n      keys,\n      dict',
    '    this.xref = xref;\n  }\n  async load(signal) {\n    const {\n      keys,\n      dict');
  source = replace(source, 'await this.#walk(nodesToVisit);', 'await this.#walk(nodesToVisit, signal);');
  source = replace(source, '  async #walk(nodesToVisit) {', '  async #walk(nodesToVisit, signal) {\n    signal?.throwIfAborted();');
  source = replace(source, '            await this.xref.stream.manager.requestAllChunks();', `            const manager = this.xref.stream.manager;
            if (signal) await manager.requestRange(0, manager.length, signal, true);
            else await manager.requestAllChunks();`);
  source = replace(source, 'await this.xref.stream.manager.requestRanges(pendingRequests);',
    'await this.xref.stream.manager.requestRanges(pendingRequests, signal, true);');
  source = replace(source, 'await this.#walk(nodesToRevisit);', 'await this.#walk(nodesToRevisit, signal);');
  source = replace(source, '  static async load(obj, keys, xref) {', '  static async load(obj, keys, xref, signal) {');
  source = replace(source, 'await objLoader.load();', 'await objLoader.load(signal);');
  source = replace(source, `    intersector = null
  }) {
    const contentStreamPromise = this.getContentStream();
    const resourcesPromise = this.loadResources(RESOURCES_KEYS_TEXT_CONTENT);
    const langPromise = this.pdfManager.ensureCatalog("lang");
    const [contentStream,, lang] = await Promise.all([contentStreamPromise, resourcesPromise, langPromise]);
    const resources = await this.#getMergedResources(contentStream.dict, RESOURCES_KEYS_TEXT_CONTENT);`,
    `    intersector = null,
    signal
  }) {
    const contentStreamPromise = this.getContentStream(signal);
    const resourcesPromise = this.loadResources(RESOURCES_KEYS_TEXT_CONTENT, signal);
    const langPromise = this.pdfManager.ensureCatalog("lang", undefined, signal);
    const [contentStream,, lang] = await Promise.all([contentStreamPromise, resourcesPromise, langPromise]);
    signal?.throwIfAborted();
    const resources = await this.#getMergedResources(contentStream.dict, RESOURCES_KEYS_TEXT_CONTENT, signal);`);
  source = replace(source, '  getPage(pageIndex) {\n    const cachedPromise = this.#pagePromises.get(pageIndex);',
    '  getPage(pageIndex, cache = true, signal) {\n    signal?.throwIfAborted();\n    const cachedPromise = this.#pagePromises.get(pageIndex);');
  source = replace(source, '  #pagePromises = new Map();', '  #pagePromises = new Map();\n  #searchPageRefs = new Map();');
  source = replace(source, '    let promise;\n    if (xfaFactory) {\n      promise = Promise.resolve([Dict.empty, null]);',
    `    let promise;
    const searchRef = this.#searchPageRefs.get(pageIndex);
    if (searchRef) {
      promise = this.xref.fetchAsync(searchRef, undefined, signal).then(dict => [dict, searchRef]);
    } else if (xfaFactory) {
      promise = Promise.resolve([Dict.empty, null]);`);
  source = replace(source, '    promise = promise.then(([pageDict, ref]) => new Page({',
    `    const createPage = ([pageDict, ref]) => new Page({`);
  source = replace(source, '    }));\n    this.#pagePromises.set(pageIndex, promise);\n    return promise;\n  }\n  async checkFirstPage',
    `    });
    promise = promise.then(entry => {
      signal?.throwIfAborted();
      const existing = this.#pagePromises.get(pageIndex);
      if (signal && existing) return existing;
      const ref = entry[1];
      if (!cache && ref && !existing) this.#searchPageRefs.set(pageIndex, ref);
      const page = createPage(entry);
      if (signal && cache) {
        this.#searchPageRefs.delete(pageIndex);
        this.#pagePromises.set(pageIndex, Promise.resolve(page));
      }
      return page;
    });
    // A cancelled lookup is safe to retry because the worker caches only its completed page.
    if (cache && !signal) {
      this.#searchPageRefs.delete(pageIndex);
      this.#pagePromises.set(pageIndex, promise);
    }
    return promise;
  }
  async checkFirstPage`);
  source = replace(source, '  getPage(pageIndex) {\n    return this.pdfDocument.getPage(pageIndex);',
    '  getPage(pageIndex, cache, signal) {\n    return this.pdfDocument.getPage(pageIndex, cache, signal);');
  source = replace(source, `      pdfManager.getPage(pageId).then(function (page) {
        const task = new WorkerTask("GetTextContent: page " + pageIndex);
        startWorkerTask(task);
        const start = verbosity >= VerbosityLevel.INFOS ? Date.now() : 0;
        page.extractTextContent({
          handler,
          task,
          sink,
          includeMarkedContent,
          disableNormalization
        }).then(function () {
          finishWorkerTask(task);
          if (start) {
            info(\`page=\${pageIndex + 1} - getTextContent: time=\` + \`\${Date.now() - start}ms\`);
          }
          sink.close();
        }, function (reason) {
          finishWorkerTask(task);
          if (task.terminated) {
            return;
          }
          sink.error(reason);
        });
      });`, `      const controller = data.filensCancelRanges ? new AbortController() : undefined;
      let task;
      sink.onCancel = () => {
        task?.terminate();
        controller?.abort(new AbortException("PDF text read cancelled."));
      };
      // Reuse a page the renderer already opened. A search alone need not keep it.
      void pdfManager.getPage(pageId, false, controller?.signal).then(async page => {
        if (sink.isCancelled || terminated) return;
        task = new WorkerTask("GetTextContent: page " + pageIndex);
        startWorkerTask(task);
        const start = verbosity >= VerbosityLevel.INFOS ? Date.now() : 0;
        await page.extractTextContent({
          handler,
          task,
          sink,
          includeMarkedContent,
          disableNormalization,
          signal: controller?.signal
        });
        if (task.terminated) return;
        if (start) info("page=" + (pageIndex + 1) + " - getTextContent: time=" + (Date.now() - start) + "ms");
        sink.close();
      }).catch(reason => {
        if (!sink.isCancelled && !task?.terminated && !terminated) sink.error(reason);
      }).finally(() => {
        controller?.abort();
        if (task) finishWorkerTask(task);
      });`);
  source = replace(source, '      if (this.options.ignoreErrors) {\n        warn(`getTextContent - ignoring errors during',
    '      if (task.terminated) return;\n      if (this.options.ignoreErrors) {\n        warn(`getTextContent - ignoring errors during');
  return source;
}

function patchPageLookupRanges(source: string): string {
  source = replace(source, '  async fetchAsync(ref, suppressEncryption) {\n    try {',
    '  async fetchAsync(ref, suppressEncryption, signal) {\n    signal?.throwIfAborted();\n    try {');
  source = replace(source, '      await this.pdfManager.requestRange(ex.begin, ex.end);\n      return this.fetchAsync(ref, suppressEncryption);',
    `      if (signal && this.pdfManager.streamManager) await this.pdfManager.streamManager.requestRange(ex.begin, ex.end, signal, true);
      else await this.pdfManager.requestRange(ex.begin, ex.end);
      return this.fetchAsync(ref, suppressEncryption, signal);`);
  const start = source.indexOf('  async getPageDict(pageIndex) {');
  const end = source.indexOf('  async getAllPageDicts(', start);
  if (start < 0 || end < 0) throw new Error('PDF.js changed its page tree lookup.');
  const original = source.slice(start, end);
  let lookup = replace(original, 'getPageDict(pageIndex)', 'getPageDict(pageIndex, signal)');
  for (const reference of ['currentNode', 'type', 'count', 'kids']) lookup = replace(lookup,
    `xref.fetchAsync(${reference})`, `xref.fetchAsync(${reference}, undefined, signal)`, reference === 'type' ? 2 : 1);
  lookup = replace(lookup, 'if (currentNode === this.toplevelPagesDict &&', 'if (!signal && currentNode === this.toplevelPagesDict &&');
  source = replace(source, original, lookup);
  source = replace(source, 'async #getLinearizationPage(pageIndex) {', 'async #getLinearizationPage(pageIndex, signal) {');
  source = replace(source, '      const obj = await xref.fetchAsync(ref);\n      if (obj instanceof Dict) {\n        let type = obj.getRaw("Type");\n        if (type instanceof Ref) {\n          type = await xref.fetchAsync(type);',
    '      const obj = await xref.fetchAsync(ref, undefined, signal);\n      if (obj instanceof Dict) {\n        let type = obj.getRaw("Type");\n        if (type instanceof Ref) {\n          type = await xref.fetchAsync(type, undefined, signal);');
  source = replace(source, '      warn(`_getLinearizationPage: "${reason.message}".`);\n      return catalog.getPageDict(pageIndex);',
    '      signal?.throwIfAborted();\n      warn(`_getLinearizationPage: "${reason.message}".`);\n      return catalog.getPageDict(pageIndex, signal);');
  source = replace(source, 'promise = this.#getLinearizationPage(pageIndex);', 'promise = this.#getLinearizationPage(pageIndex, signal);');
  source = replace(source, 'promise = catalog.getPageDict(pageIndex);', 'promise = catalog.getPageDict(pageIndex, signal);');
  return replace(source, `    handler.on("GetPage", function (data) {
      return pdfManager.getPage(data.pageIndex).then(function (page) {
        return Promise.all([pdfManager.ensure(page, "rotate"), pdfManager.ensure(page, "ref"), pdfManager.ensure(page, "userUnit"), pdfManager.ensure(page, "view")]).then(function ([rotate, ref, userUnit, view]) {
          return {
            rotate,
            ref,
            refStr: ref?.toString() ?? null,
            userUnit,
            view
          };
        });
      });
    });`, `    handler.on("GetPage", function (data, sink) {
      const read = async signal => {
        const page = await pdfManager.getPage(data.pageIndex, !signal, signal);
        const [rotate, ref, userUnit, view] = await Promise.all(
          ["rotate", "ref", "userUnit", "view"].map(key => pdfManager.ensure(page, key, undefined, signal)));
        return { rotate, ref, refStr: ref?.toString() ?? null, userUnit, view };
      };
      if (!sink) return read();
      const controller = new AbortController();
      sink.onCancel = () => controller.abort(new AbortException("PDF page lookup cancelled."));
      void read(controller.signal).then(info => {
        if (sink.isCancelled || terminated) return;
        sink.enqueue(info);
        sink.close();
      }, reason => {
        if (!sink.isCancelled && !terminated) sink.error(reason);
      }).finally(() => controller.abort());
    });
    handler.on("ReleasePage", ({ pageIndex, ref }) => pdfManager.pdfDocument.releasePage(pageIndex, ref));`);
}

function patchNavigationRanges(source: string): string {
  const start = source.indexOf('  getPageIndex(pageRef) {'), end = source.indexOf('  get baseUrl() {', start);
  if (start < 0 || end < 0) throw new Error('PDF.js changed its outline page lookup.');
  const original = source.slice(start, end);
  let lookup = replace(original, 'getPageIndex(pageRef)', 'getPageIndex(pageRef, signal)');
  lookup = replace(lookup, '    const xref = this.xref;', '    const { xref, pdfManager } = this;');
  for (const ref of ['kidRef', 'kid']) lookup = replace(lookup, `xref.fetchAsync(${ref})`, `xref.fetchAsync(${ref}, undefined, signal)`);
  lookup = replace(lookup, 'return node.getAsync("Parent");', 'return pdfManager.ensure(node, "get", ["Parent"], signal);');
  lookup = replace(lookup, 'return parent.getAsync("Kids");', 'return pdfManager.ensure(parent, "get", ["Kids"], signal);');
  lookup = replace(lookup, 'kidPromises.push(xref.fetchAsync(kid, undefined, signal).then(function (obj) {',
    'kidPromises.push(xref.fetchAsync(kid, undefined, signal).then(async function (obj) {');
  lookup = replace(lookup, 'total += obj.get("Count");', 'const count = await pdfManager.ensure(obj, "get", ["Count"], signal);\n              total += count;');
  lookup = replace(lookup, '    const next = ref => pagesBeforeRef(ref).then(args => {', `    const visited = new RefSet();
    const next = ref => {
      signal?.throwIfAborted();
      if (!(ref instanceof Ref) || visited.has(ref)) throw new FormatError("Invalid bookmark page tree.");
      visited.put(ref);
      return pagesBeforeRef(ref).then(args => {`);
  lookup = replace(lookup, '      return next(parentRef);\n    });', '        return next(parentRef);\n      });\n    };');
  source = replace(source, original, lookup);
  return replace(source, '    handler.on("GetOptionalContentConfig", function (data) {', `    handler.on("GetFilensNavigation", function ({ destination, pageIndex }, sink) {
      const controller = new AbortController(), signal = controller.signal;
      const task = new WorkerTask("PDF navigation");
      startWorkerTask(task);
      sink.onCancel = reason => controller.abort(reason);
      const read = async () => {
        if (pageIndex !== undefined) {
          const page = await pdfManager.getPage(pageIndex, false, signal);
          const annotations = await page._loadParsedAnnotations(signal);
          return annotations.filter(annotation => annotation.data.subtype === "Link" && annotation.mustBeViewed()
            && (annotation.data.dest || annotation.data.url)).map(({ data }) => ({
              rect: data.rect, quadPoints: data.quadPoints, dest: data.dest, url: data.url, label: data.contentsObj?.str
            }));
        }
        if (destination === undefined) return pdfManager.ensureCatalog("documentOutline", undefined, signal);
        const dest = typeof destination === "string" ? await pdfManager.ensureCatalog("getDestination", [destination], signal) : destination;
        if (!Array.isArray(dest)) return null;
        const target = dest[0];
        const index = Number.isInteger(target) ? target : target && Number.isInteger(target.num) && Number.isInteger(target.gen)
          ? await pdfManager.ensureCatalog("getPageIndex", [Ref.get(target.num, target.gen), signal], signal) : -1;
        return index < 0 ? null : { index, dest };
      };
      void read().then(result => {
        if (sink.isCancelled || terminated) return;
        sink.enqueue(result);
        sink.close();
      }, reason => {
        if (!sink.isCancelled && !terminated) sink.error(reason);
      }).finally(() => {
        controller.abort();
        finishWorkerTask(task);
      });
    });
    handler.on("GetOptionalContentConfig", function (data) {`);
}

function patchOperatorRanges(source: string): string {
  source = replace(source, '  async checkFirstPage(recoveryMode = false) {', `  releasePage(pageIndex, ref) {
    this.#pagePromises.delete(pageIndex);
    if (ref) this.#searchPageRefs.set(pageIndex, Ref.get(ref.num, ref.gen));
  }
  async checkFirstPage(recoveryMode = false) {`);
  source = replace(source, `    modifiedIds = null
  }) {
    const contentStreamPromise = this.getContentStream();
    const resourcesPromise = this.loadResources(RESOURCES_KEYS_OPERATOR_LIST);`, `    modifiedIds = null,
    signal
  }) {
    const contentStreamPromise = this.getContentStream(signal);
    const resourcesPromise = this.loadResources(RESOURCES_KEYS_OPERATOR_LIST, signal);`);
  source = replace(source, 'const resources = await this.#getMergedResources(contentStream.dict, RESOURCES_KEYS_OPERATOR_LIST);',
    'const resources = await this.#getMergedResources(contentStream.dict, RESOURCES_KEYS_OPERATOR_LIST, signal);\n      signal?.throwIfAborted();');
  return replace(source, `      pdfManager.getPage(pageId).then(function (page) {
        const task = new WorkerTask(\`GetOperatorList: page \${pageIndex}\`);
        startWorkerTask(task);
        const start = verbosity >= VerbosityLevel.INFOS ? Date.now() : 0;
        page.getOperatorList({
          handler,
          sink,
          task,
          intent: data.intent,
          cacheKey: data.cacheKey,
          annotationStorage: data.annotationStorage,
          modifiedIds: data.modifiedIds,
          pageIndex
        }).then(function (operatorListInfo) {
          finishWorkerTask(task);
          if (start) {
            info(\`page=\${pageIndex + 1} - getOperatorList: time=\` + \`\${Date.now() - start}ms, len=\${operatorListInfo.length}\`);
          }
          sink.close();
        }, function (reason) {
          finishWorkerTask(task);
          if (task.terminated) {
            return;
          }
          sink.error(reason);
        });
      });`, `      const controller = data.filensCancelRanges ? new AbortController() : undefined;
      let task;
      // The evaluator can hold shared work, such as a cached Type 3 font promise.
      if (controller) sink.onCancel = () => controller.abort(new AbortException("PDF page drawing cancelled."));
      void pdfManager.getPage(pageId).then(async page => {
        if (sink.isCancelled || terminated) return;
        task = new WorkerTask("GetOperatorList: page " + pageIndex);
        task.annotationSignal = controller?.signal;
        startWorkerTask(task);
        const start = verbosity >= VerbosityLevel.INFOS ? Date.now() : 0;
        const pageHandler = data.filensPage === undefined ? handler : {
          send(action, value, transfers) {
            // Image decoding can finish after the document worker handler has closed.
            if (terminated) {
              for (const transfer of transfers ?? []) transfer.close?.();
              return;
            }
            if (action === "StartRenderPage") value.filensPage = data.filensPage;
            if (action === "obj") value.push(data.filensPage);
            return handler.send(action, value, transfers);
          },
          sendWithPromise: handler.sendWithPromise.bind(handler)
        };
        const operators = await page.getOperatorList({
          handler: pageHandler,
          sink,
          task,
          intent: data.intent,
          cacheKey: data.cacheKey,
          annotationStorage: data.annotationStorage,
          modifiedIds: data.modifiedIds,
          pageIndex,
          signal: controller?.signal
        });
        if (sink.isCancelled || task.terminated) return;
        if (start) info("page=" + (pageIndex + 1) + " - getOperatorList: time=" + (Date.now() - start) + "ms, len=" + operators.length);
        sink.close();
      }).catch(reason => {
        if (!sink.isCancelled && !task?.terminated && !terminated) sink.error(reason);
      }).finally(() => {
        controller?.abort();
        if (task) finishWorkerTask(task);
      });`);
}

function patchAnnotationRanges(source: string): string {
  source = replace(source, 'static async create(xref, ref, annotationGlobals, idFactory, collectFields, orphanFields, collectByType, pageRef) {',
    'static async create(xref, ref, annotationGlobals, idFactory, collectFields, orphanFields, collectByType, pageRef, signal) {');
  source = replace(source, 'annotationGlobals.pdfManager.ensure(this, "_create", [xref, ref, annotationGlobals, idFactory, collectFields, orphanFields, collectByType, pageIndex, pageRef]);',
    'annotationGlobals.pdfManager.ensure(this, "_create", [xref, ref, annotationGlobals, idFactory, collectFields, orphanFields, collectByType, pageIndex, pageRef], signal);');
  source = replace(source, `  get _parsedAnnotations() {
    const promise = this.pdfManager.ensure(this, "annotations").then(async annots => {`, `  get _parsedAnnotations() {
    return this._loadParsedAnnotations();
  }
  _loadParsedAnnotations(signal) {
    if (this.#areAnnotationsCached) return this._parsedAnnotations;
    const promise = this.pdfManager.ensure(this, "annotations", undefined, signal).then(async annots => {`);
  source = replace(source, '      const orphanFields = fieldObjects?.orphanFields;\n      const annotationPromises = [];',
    '      signal?.throwIfAborted();\n      const orphanFields = fieldObjects?.orphanFields;\n      const annotationPromises = [];');
  source = replace(source, 'this._localIdFactory, false, orphanFields, null, this.ref).catch(function (reason) {',
    'this._localIdFactory, false, orphanFields, null, this.ref, signal).catch(function (reason) {\n          signal?.throwIfAborted();');
  source = replace(source, `    this.#areAnnotationsCached = true;
    return shadow(this, "_parsedAnnotations", promise);`, `    const cache = value => {
      this.#areAnnotationsCached = true;
      return shadow(this, "_parsedAnnotations", value);
    };
    // A scoped draw can abandon its read without putting a rejected promise in the page cache.
    return signal ? promise.then(annotations => {
      signal.throwIfAborted();
      return this.#areAnnotationsCached ? this._parsedAnnotations : cache(Promise.resolve(annotations));
    }) : cache(promise);`);
  source = replace(source, 'await Promise.all([pageListPromise, this._parsedAnnotations, newAnnotationsPromise]);',
    'await Promise.all([pageListPromise, this._loadParsedAnnotations(signal), newAnnotationsPromise]);\n    signal?.throwIfAborted();');
  source = replace(source, '        opListPromises.push(annotation.getOperatorList(partialEvaluator, task, intent, annotationStorage).catch(function (reason) {',
    '        opListPromises.push(annotation.getOperatorList(partialEvaluator, task, intent, annotationStorage).catch(function (reason) {\n          signal?.throwIfAborted();');
  source = replace(source, '    const opLists = await Promise.all(opListPromises);',
    '    const opLists = await Promise.all(opListPromises);\n    signal?.throwIfAborted();');
  source = replace(source, '  async getAsync(key1, key2, key3) {', '  async getAsync(key1, key2, key3, signal) {');
  source = replace(source, 'return this.xref.fetchAsync(value, this.suppressEncryption);',
    'return this.xref.fetchAsync(value, this.suppressEncryption, signal);');
  source = replace(source, `  async loadResources(keys, appearance) {
    const resources = await appearance.dict.getAsync("Resources");
    if (resources) {
      await ObjectLoader.load(resources, keys, resources.xref);`, `  async loadResources(keys, appearance, signal) {
    const resources = await appearance.dict.getAsync("Resources", undefined, undefined, signal);
    if (resources) {
      await ObjectLoader.load(resources, keys, resources.xref, signal);`);
  return replace(source, '    const resources = await this.loadResources(RESOURCES_KEYS_OPERATOR_LIST, appearance);',
    '    const resources = await this.loadResources(RESOURCES_KEYS_OPERATOR_LIST, appearance, task.annotationSignal);\n    task.annotationSignal?.throwIfAborted();');
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
