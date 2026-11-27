import { createServer, type ServerResponse } from 'node:http';

export async function serveZipFixture(bytes: Buffer, format: string, ranged = true) {
  const requests: { range: string | undefined; begin: number; end: number; sent: number; cancelled: boolean }[] = [];
  let pauseAt = -1;
  const paused = new Map<ServerResponse, () => void>();
  const cors = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
    'Access-Control-Allow-Headers': 'Range',
    'Access-Control-Expose-Headers': 'Content-Range, ETag',
    ETag: '"original"',
  };
  const server = createServer((request, response) => {
    if (request.method === 'OPTIONS') { response.writeHead(204, cors).end(); return; }
    const range = ranged && /^bytes=(\d+)-(\d+)$/.exec(request.headers.range ?? '');
    const begin = range ? Number(range[1]) : 0, end = range ? Number(range[2]) + 1 : bytes.length;
    if (begin >= end || end > bytes.length) { response.writeHead(416, cors).end(); return; }
    const record = { range: request.headers.range, begin, end, sent: 0, cancelled: false };
    requests.push(record);
    response.once('close', () => {
      paused.delete(response);
      record.cancelled = !response.writableFinished;
    });
    response.writeHead(range ? 206 : 200, {
      ...cors, 'Content-Length': end - begin, 'Content-Type': 'application/zip', 'Cache-Control': 'no-store',
      ...(range ? { 'Content-Range': `bytes ${begin}-${end - 1}/${bytes.length}` } : {}),
    });
    const send = () => { record.sent = end - begin; response.end(bytes.subarray(begin, end)); };
    if (begin <= pauseAt && pauseAt < end) {
      paused.set(response, send);
      response.flushHeaders();
    } else send();
  });
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const { port } = server.address() as { port: number };
  return {
    url: `http://127.0.0.1:${port}/remote.${format}?signature=a%2Fb`,
    requests,
    pause: (offset: number) => { pauseAt = offset; },
    resume: (nextPauseAt = -1) => {
      pauseAt = nextPauseAt;
      for (const send of paused.values()) send();
      paused.clear();
    },
    disconnect: () => {
      for (const response of paused.keys()) response.destroy();
      paused.clear();
    },
    close: () => new Promise<void>(resolve => {
      server.close(() => resolve());
      server.closeAllConnections();
    }),
  };
}
