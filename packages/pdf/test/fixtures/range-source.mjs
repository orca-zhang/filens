import { createServer } from 'node:http';

export async function servePdfFixture(bytes, { ranges = true } = {}) {
  const requests = [];
  const pending = new Map();
  let pause;
  const cors = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
    'Access-Control-Allow-Headers': 'Range',
    'Access-Control-Expose-Headers': 'Accept-Ranges, Content-Range, Content-Encoding',
  };
  const server = createServer((request, response) => {
    if (request.method === 'OPTIONS') { response.writeHead(204, cors).end(); return; }
    const range = /^bytes=(\d+)-(\d+)$/.exec(request.headers.range ?? '');
    const begin = ranges && range ? Number(range[1]) : 0;
    const end = ranges && range ? Math.min(Number(range[2]) + 1, bytes.length) : bytes.length;
    if (begin >= end) { response.writeHead(416, cors).end(); return; }
    const partial = Boolean(ranges && range);
    const record = { partial, begin, end, bytesSent: 0, cancelled: false };
    requests.push(record);
    response.once('close', () => {
      pending.delete(response);
      record.cancelled = !response.writableFinished;
    });
    const send = () => {
      record.bytesSent = end - begin;
      response.end(bytes.subarray(begin, end));
    };
    response.writeHead(partial ? 206 : 200, {
      ...cors, 'Content-Type': 'application/pdf', 'Content-Length': end - begin, 'Cache-Control': 'no-store',
      ...(ranges ? { 'Accept-Ranges': 'bytes' } : {}),
      ...(partial ? { 'Content-Range': `bytes ${begin}-${end - 1}/${bytes.length}` } : {}),
    });
    if (ranges && !partial) {
      // A range client can cancel this response as soon as it sees its headers.
      record.bytesSent = Math.min(bytes.length, 16 * 1024);
      response.write(bytes.subarray(0, record.bytesSent));
    } else if (partial && (pause === 'all' || (begin <= pause && pause < end))) {
      pending.set(response, send);
      response.flushHeaders();
    } else send();
  });
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  return {
    url: `http://127.0.0.1:${server.address().port}/remote.pdf?signature=test%2Bkey`,
    requests,
    pauseRanges: (offset = 'all') => { pause = offset; },
    resumeRanges() {
      pause = undefined;
      for (const send of pending.values()) send();
      pending.clear();
    },
    close: () => new Promise(resolve => {
      server.close(resolve);
      server.closeAllConnections();
    }),
  };
}
