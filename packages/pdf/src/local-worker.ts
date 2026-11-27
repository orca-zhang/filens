import { waitForContainerTask } from '@filens/core';
import type { PDFWorker } from 'pdfjs-dist';

export interface LocalPdfWorker {
  worker: PDFWorker;
  close(destroying?: Promise<void>): Promise<void>;
}

export async function createLocalPdfWorker(
  WorkerAdapter: typeof PDFWorker, source: string, signal: AbortSignal, onError: (error: Error) => void
): Promise<LocalPdfWorker | undefined> {
  let port: Worker | undefined;
  let startupTimer: ReturnType<typeof setTimeout> | undefined;
  const error = new Error('The local PDF worker stopped unexpectedly.');
  try {
    const response = await fetch(source, { signal });
    if (!response.ok) return;
    const code = await response.text();
    signal.throwIfAborted();
    // A standalone file has an opaque origin. Loading the module directly
    // avoids the Blob-to-Blob import in PDF.js's cross-origin worker wrapper.
    const native = port = new Worker('data:text/javascript;charset=utf-8,' + encodeURIComponent(code),
      { type: 'module', name: 'FiLens PDF' });
    await waitForContainerTask(new Promise<void>((resolve, reject) => {
      startupTimer = setTimeout(() => reject(new Error('The local PDF worker did not start.')), 5000);
      native.onmessage = ({ data }) => {
        if (data?.sourceName === 'worker' && data?.action === 'ready') resolve();
      };
      const fail = (event: Event) => { event.preventDefault(); reject(error); };
      native.onerror = fail;
      native.onmessageerror = fail;
    }), signal);
    signal.throwIfAborted();
    const worker = WorkerAdapter.create({ port: native });
    const fail = (event: Event) => { event.preventDefault(); onError(error); };
    native.onerror = fail;
    native.onmessageerror = fail;
    return {
      worker,
      async close(destroying = Promise.resolve()) {
        native.onerror = native.onmessageerror = null;
        let timeout: ReturnType<typeof setTimeout> | undefined;
        try {
          // Give PDF.js time to release its transport, even if the worker has stopped responding.
          await Promise.race([destroying, new Promise<void>(resolve => { timeout = setTimeout(resolve, 1000); })]);
        } finally {
          clearTimeout(timeout);
          native.terminate();
          worker.destroy();
        }
      }
    };
  } catch {
    if (port) {
      port.onerror = port.onmessageerror = null;
      port.terminate();
    }
    signal.throwIfAborted();
  } finally {
    clearTimeout(startupTimer);
    if (port) port.onmessage = null;
  }
}
