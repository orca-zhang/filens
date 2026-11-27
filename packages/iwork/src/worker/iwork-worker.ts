import { previewPasswordErrorCode, type PreviewPasswordErrorCode } from '@filens/core/zip';
import { indexArchiveMedia, indexArchivePackage, readArchiveMedia } from '../parser/archive';
import { buildNumbersSheetAt, buildParsedDocument, type SemanticBuildContext } from '../parser/semantic';
import type { IworkArchiveSource } from '../parser/load-source';
import type { IworkTypeHint, PagesLayoutMeasurements, ParsedIworkDocument } from '../types';
import type { NumbersSheetResult, PagesLayoutResult } from './client';
import { readWorkerFile, type WorkerFileSource } from './file-source';
import { NumbersPreviewMedia } from './numbers-media';

interface DocumentRequest {
  kind: 'document';
  id: number;
  source: ArrayBuffer | string | Blob | WorkerFileSource;
  hint?: IworkTypeHint;
  sourceName?: string;
  password?: string;
}

interface SheetRequest {
  kind: 'sheet';
  id: number;
  index: number;
  context?: SemanticBuildContext;
}

interface PagesLayoutRequest {
  kind: 'pages-layout';
  id: number;
  measurements: PagesLayoutMeasurements;
  context?: SemanticBuildContext;
}

type WorkerRequest = DocumentRequest | SheetRequest | PagesLayoutRequest | { kind: 'clear' };

interface ParseResponse {
  id: number;
  document?: ParsedIworkDocument;
  sheetResult?: NumbersSheetResult;
  pagesResult?: PagesLayoutResult;
  error?: string;
  errorCode?: PreviewPasswordErrorCode;
  errorName?: string;
  status?: number;
}

let context: SemanticBuildContext | null = null;
let numbersMedia: NumbersPreviewMedia | undefined;
let sourcePort: MessagePort | undefined;

function closeSourcePort(): void {
  sourcePort?.close();
  sourcePort = undefined;
}

self.addEventListener('message', async (event: MessageEvent<WorkerRequest>) => {
  const request = event.data;
  if (request.kind === 'clear') {
    context = null;
    numbersMedia = undefined;
    closeSourcePort();
    return;
  }
  try {
    if (request.kind === 'pages-layout') {
      if (request.context) context = request.context;
      if (context?.archive.type !== 'pages') throw new Error('No Pages document is loaded.');
      const document = buildParsedDocument(context, { pagesLayoutMeasurements: request.measurements });
      if (document.kind !== 'pages') throw new Error('The Pages layout could not be rebuilt.');
      const { pages, title, warnings } = document;
      self.postMessage({ id: request.id, pagesResult: { pages, title, warnings } } satisfies ParseResponse);
      return;
    }
    if (request.kind === 'sheet') {
      if (request.context) {
        context = request.context;
        numbersMedia = undefined;
      }
      if (context?.archive.type !== 'numbers') {
        throw new Error('No Numbers document is loaded.');
      }
      const sheet = buildNumbersSheetAt(context, request.index);
      if (!sheet) {
        throw new Error(`Numbers sheet ${request.index + 1} was not found.`);
      }
      if (numbersMedia) await numbersMedia.publish([sheet], media => {
        self.postMessage({ id: request.id, sheetResult: { sheet, media } } satisfies ParseResponse);
      });
      else self.postMessage({ id: request.id, sheetResult: { sheet } } satisfies ParseResponse);
      return;
    }

    context = null;
    numbersMedia = undefined;
    closeSourcePort();
    const input = request.source;
    let source: IworkArchiveSource;
    if (input instanceof ArrayBuffer) source = new Uint8Array(input);
    else if (typeof input === 'object' && 'port' in input) {
      sourcePort = input.port;
      source = readWorkerFile(input);
    } else source = input;
    const { archive, zip, type } = await indexArchivePackage(source, request.hint, {
      sourceName: request.sourceName,
      password: request.password
    });
    const mediaEntries = indexArchiveMedia(zip, archive);
    if (type === 'numbers' && !(source instanceof Uint8Array) && request.password === undefined) {
      numbersMedia = new NumbersPreviewMedia(mediaEntries);
      context = { archive, media: {}, indexedMedia: mediaEntries };
    } else context = { archive, media: await readArchiveMedia(mediaEntries) };
    const document = buildParsedDocument(
      context,
      type === 'numbers' ? { numbersSheetIndexes: new Set([0]) } : undefined
    );
    if (document.kind === 'numbers' && numbersMedia) await numbersMedia.publish(document.sheets, media => {
      document.media = media;
      self.postMessage({ id: request.id, document } satisfies ParseResponse);
    });
    else {
      closeSourcePort();
      self.postMessage({ id: request.id, document } satisfies ParseResponse);
    }
  } catch (error) {
    if (request.kind === 'document') {
      context = null;
      numbersMedia = undefined;
      closeSourcePort();
    }
    const response: ParseResponse = {
      id: request.id,
      error: error instanceof Error ? error.message : String(error),
      errorCode: previewPasswordErrorCode(error),
      ...(error instanceof Error ? {
        errorName: error.name,
        ...('status' in error && typeof error.status === 'number' ? { status: error.status } : {})
      } : {})
    };
    self.postMessage(response);
  }
});
