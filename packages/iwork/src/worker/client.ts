import { PreviewPasswordError, type PreviewPasswordErrorCode } from '@filens/core';
import type { IworkPackageSource } from '../parser/load-source';
import type { IworkImageAsset, IworkTypeHint, PagesLayoutMeasurements, ParsedIworkDocument, ParsedNumbersDocument,
  ParsedNumbersSheet, ParsedPagesDocument } from '../types';
import { serveWorkerFile } from './file-source';

export interface NumbersSheetResult {
  sheet: ParsedNumbersSheet;
  media?: Record<string, IworkImageAsset>;
}

export type PagesLayoutResult = Pick<ParsedPagesDocument, 'pages' | 'title' | 'warnings'>;

interface WorkerResponse {
  id: number;
  document?: ParsedIworkDocument;
  sheetResult?: NumbersSheetResult;
  pagesResult?: PagesLayoutResult;
  error?: string;
  errorCode?: PreviewPasswordErrorCode;
  errorName?: string;
  status?: number;
}

type WorkerResult = ParsedIworkDocument | NumbersSheetResult | PagesLayoutResult;

export class IworkWorkerClient {
  private worker: Worker | null = null;
  private destroyed = false;
  private requestId = 0;
  private fileSource?: ReturnType<typeof serveWorkerFile>;
  private readonly pending = new Map<number, { resolve(value: WorkerResult): void; reject(error: Error): void }>();

  constructor() {
    if (typeof Worker === 'undefined') {
      throw new Error('Web Worker is required for iWork preview parsing.');
    }

    this.getWorker();
  }

  private getWorker(): Worker {
    if (this.destroyed) throw new Error('iWork parser worker has been destroyed.');
    if (this.worker) return this.worker;
    this.worker = new Worker(new URL('./iwork-worker.ts', import.meta.url), {
      type: 'module'
    });
    this.worker.addEventListener('message', this.handleMessage);
    this.worker.addEventListener('error', this.handleError);
    return this.worker;
  }

  parse(source: IworkPackageSource, hint?: IworkTypeHint, sourceName?: string, password?: string): Promise<ParsedIworkDocument> {
    if (this.pending.size) this.cancel();
    this.releaseFileSource();
    const id = ++this.requestId;
    // WebKit cannot read a cloned Blob from a worker on an opaque file: page.
    const fileSource = typeof location !== 'undefined' && location.protocol === 'file:' && source instanceof Blob
      ? serveWorkerFile(source) : undefined;
    this.fileSource = fileSource;
    const payload = ArrayBuffer.isView(source)
      ? (source.buffer instanceof ArrayBuffer && source.byteOffset === 0 && source.byteLength === source.buffer.byteLength
        ? source.buffer : source.slice().buffer) : fileSource?.source ?? source;
    return new Promise<ParsedIworkDocument>((resolve, reject) => {
      this.pending.set(id, {
        resolve: value => {
          const document = value as ParsedIworkDocument;
          if (this.fileSource === fileSource && (document.kind !== 'numbers' || password !== undefined)) this.releaseFileSource();
          resolve(document);
        },
        reject: error => {
          if (this.fileSource === fileSource) this.releaseFileSource();
          reject(error);
        }
      });
      this.postRequest(id,
        {
          kind: 'document',
          id,
          source: payload,
          hint,
          sourceName,
          password
        },
        fileSource ? [fileSource.source.port] : payload instanceof ArrayBuffer ? [payload] : []
      );
    });
  }

  parseSheet(index: number, document?: ParsedNumbersDocument): Promise<NumbersSheetResult> {
    const id = ++this.requestId;
    return new Promise<NumbersSheetResult>((resolve, reject) => {
      this.pending.set(id, { resolve: resolve as (value: WorkerResult) => void, reject });
      this.postRequest(id, { kind: 'sheet', id, index, ...(document ? { context: { archive: document.archive, media: document.media } } : {}) });
    });
  }

  reflowPages(measurements: PagesLayoutMeasurements, document?: ParsedPagesDocument): Promise<PagesLayoutResult> {
    const id = ++this.requestId;
    return new Promise<PagesLayoutResult>((resolve, reject) => {
      this.pending.set(id, { resolve: resolve as (value: WorkerResult) => void, reject });
      this.postRequest(id, { kind: 'pages-layout', id, measurements,
        ...(document ? { context: { archive: document.archive, media: document.media } } : {}) });
    });
  }

  cancel(): void {
    this.releaseFileSource();
    if (this.pending.size) {
      this.stopWorker(new DOMException('iWork parsing cancelled.', 'AbortError'));
    } else if (this.worker) {
      // Release the old archive while retaining an idle worker for the next file.
      try { this.worker.postMessage({ kind: 'clear' }); }
      catch { this.stopWorker(new DOMException('iWork parsing cancelled.', 'AbortError')); }
    }
  }

  destroy(): void {
    this.destroyed = true;
    this.stopWorker(new DOMException('iWork parser worker terminated.', 'AbortError'));
  }

  private postRequest(id: number, message: object, transfer: Transferable[] = []): void {
    try { this.getWorker().postMessage(message, transfer); }
    catch (error) {
      const pending = this.pending.get(id);
      this.pending.delete(id);
      pending?.reject(error instanceof Error ? error : new Error(String(error)));
    }
  }

  private stopWorker(error: Error): void {
    this.releaseFileSource();
    const worker = this.worker;
    this.worker = null;
    worker?.removeEventListener('message', this.handleMessage);
    worker?.removeEventListener('error', this.handleError);
    worker?.terminate();
    for (const entry of this.pending.values()) {
      entry.reject(error);
    }
    this.pending.clear();
  }

  private releaseFileSource(): void {
    this.fileSource?.close();
    this.fileSource = undefined;
  }

  private readonly handleMessage = (event: MessageEvent<WorkerResponse>) => {
    const pending = this.pending.get(event.data.id);
    if (!pending) {
      return;
    }

    this.pending.delete(event.data.id);
    if (event.data.errorCode) {
      pending.reject(new PreviewPasswordError(event.data.errorCode));
      return;
    }
    if (event.data.error) {
      const { error, errorName, status } = event.data;
      const failure = errorName === 'TypeError' ? new TypeError(error) : new Error(error);
      if (errorName) failure.name = errorName;
      if (status !== undefined) Object.assign(failure, { status });
      pending.reject(failure);
      return;
    }

    const result = event.data.document ?? event.data.sheetResult ?? event.data.pagesResult;
    if (!result) {
      pending.reject(new Error('iWork parser worker returned an empty result.'));
      return;
    }

    pending.resolve(result);
  };

  private readonly handleError = (event: ErrorEvent) => {
    const error = new Error(event.message || 'iWork parser worker failed.');
    this.stopWorker(error);
  };
}
