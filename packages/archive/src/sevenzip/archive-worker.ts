import SevenZip from '../../vendor/7zip/7zz.js';
import { runSevenZip, type SevenZipRequest } from './runtime';

const scope = self as unknown as {
  onmessage: ((event: MessageEvent<SevenZipRequest>) => void) | null;
  postMessage(message: unknown, transfer?: Transferable[]): void;
};
scope.onmessage = event => {
  void runSevenZip(event.data, SevenZip).then(result => {
    scope.postMessage({ result }, result.bytes ? [result.bytes.buffer as ArrayBuffer] : []);
  }, error => {
    scope.postMessage({ error: { message: error instanceof Error ? error.message : String(error), code: error?.code } });
  });
};
