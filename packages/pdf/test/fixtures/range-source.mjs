import { createServer } from 'node:http';
import { deflateSync } from 'node:zlib';

export function createPdfAttachmentRangeFixture(linkToAttachment = false, compressed = true) {
  const text = 'Small attachment decoded from the PDF.';
  const marker = 'final payload belongs to the large attachment';
  const large = Buffer.alloc(4 * 1024 * 1024, 0x61);
  large.write(marker, large.length / 2);
  const stream = (dict, bytes) => Buffer.concat([Buffer.from(`<< ${dict} /Length ${bytes.length} >>\nstream\n`),
    bytes, Buffer.from('\nendstream')]);
  const action = linkToAttachment ? '/S /GoToE /T << /R /C /N (notes.txt) >> /D [0 /Fit]'
    : '/S /URI /URI (https://example.com/)';
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R /Names << /EmbeddedFiles << /Names [(large.bin) 6 0 R (notes.txt) 5 0 R] >> >> >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 300 300] /Annots [9 0 R] /Resources << >> /Contents 4 0 R >>',
    stream('', Buffer.from('0 0 1 rg 30 30 240 240 re f')),
    '<< /Type /Filespec /F (notes.txt) /EF << /F 7 0 R >> >>',
    '<< /Type /Filespec /F (large.bin) /EF << /F 8 0 R >> >>',
    stream(compressed ? '/Type /EmbeddedFile /Filter /FlateDecode' : '/Type /EmbeddedFile',
      compressed ? deflateSync(text) : Buffer.from(text)),
    stream('/Type /EmbeddedFile', large),
    `<< /Type /Annot /Subtype /Link /Rect [30 30 100 60] /A << ${action} >> >>`
  ];
  const chunks = [Buffer.from('%PDF-1.7\n')], offsets = [];
  let length = chunks[0].length;
  for (const [index, object] of objects.entries()) {
    offsets.push(length);
    const chunk = Buffer.concat([Buffer.from(`${index + 1} 0 obj\n`), Buffer.from(object), Buffer.from('\nendobj\n')]);
    chunks.push(chunk);
    length += chunk.length;
  }
  chunks.push(Buffer.from(`xref\n0 ${offsets.length + 1}\n0000000000 65535 f \n`
    + offsets.map(offset => `${String(offset).padStart(10, '0')} 00000 n \n`).join('')
    + `trailer\n<< /Size ${offsets.length + 1} /Root 1 0 R >>\nstartxref\n${length}\n%%EOF\n`));
  const bytes = Buffer.concat(chunks);
  return { bytes, text, payloadOffset: bytes.indexOf(marker) };
}

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
