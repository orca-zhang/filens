import { createServer } from 'node:http';
import { deflateSync } from 'node:zlib';
import { encodePdfObjects } from './document.mjs';

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

export function createPdfOutlineFixture({ extraBookmarks = 0, pageLinks = false } = {}) {
  const objects = ['', '', '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>'];
  const groups = [], pages = [];
  for (let index = 0; index < 24; index++) {
    if (index % 6 === 0) groups.push({ id: objects.push(''), pages: [] });
    const group = groups.at(-1), id = objects.length + 1;
    group.pages.push(id);
    pages.push(id);
    const rotation = index === 22 ? '/Rotate 90 /UserUnit 2' : '';
    const text = `BT /F1 24 Tf 210 340 Td (Document page ${index + 1}) Tj ET\n`;
    objects.push(`<< /Type /Page /Parent ${group.id} 0 R /MediaBox [0 0 600 800] ${rotation} /Resources << /Font << /F1 3 0 R >> >> /Contents ${id + 1} 0 R >>`,
      `<< /Length ${text.length} >>\nstream\n${text}endstream`);
  }
  const padding = `% ${'x'.repeat(8192)}\n`.repeat(12);
  const outlineMarker = 'held PDF outline', destinationMarker = 'held PDF named destination';
  const outline = objects.push(''), chapter = objects.push(''), sub = objects.push('');
  const link = objects.push(''), names = objects.push('');
  const extra = Array.from({ length: extraBookmarks }, () => objects.push(''));
  objects[0] = `<< /Type /Catalog /Pages 2 0 R /Outlines ${outline} 0 R /Names << /Dests ${names} 0 R >> >>`;
  objects[1] = `<< /Type /Pages /Count 24 /Kids [${groups.map(group => `${group.id} 0 R`).join(' ')}] >>`;
  for (const group of groups) objects[group.id - 1] = `<< /Type /Pages /Parent 2 0 R /Count 6 /Kids [${group.pages.map(id => `${id} 0 R`).join(' ')}] >>`;
  objects[outline - 1] = `<< /Type /Outlines\n${padding}% ${outlineMarker}\n${padding}/First ${chapter} 0 R /Last ${extra.at(-1) ?? link} 0 R /Count ${2 + extra.length} >>`;
  objects[chapter - 1] = `<< /Title (Main chapter) /Parent ${outline} 0 R /Next ${link} 0 R /First ${sub} 0 R /Last ${sub} 0 R /Count -1 /Dest [${pages[5]} 0 R /XYZ 0 380 null] >>`;
  objects[sub - 1] = `<< /Title (Rotated subject) /Parent ${chapter} 0 R /Dest (rotated) >>`;
  objects[link - 1] = `<< /Title (Online reference) /Parent ${outline} 0 R /Prev ${chapter} 0 R /A << /S /URI /URI (https://example.com/spec) >> ${extra.length ? `/Next ${extra[0]} 0 R` : ''} >>`;
  for (const [index, ref] of extra.entries()) {
    const next = index + 1 < extra.length ? `/Next ${extra[index + 1]} 0 R` : '';
    objects[ref - 1] = `<< /Title (Extra bookmark ${index + 1}) /Parent ${outline} 0 R /Prev ${extra[index - 1] ?? link} 0 R ${next} /Dest [${pages[0]} 0 R /Fit] >>`;
  }
  objects[names - 1] = `<<\n${padding}% ${destinationMarker}\n${padding}/Names [(rotated) [${pages[22]} 0 R /XYZ 200 350 null]] >>`;
  if (pageLinks) {
    const addLinks = (page, links) => {
      const ids = links.map(data => objects.push(`<< /Type /Annot /Subtype /Link ${data} >>`));
      objects[page - 1] = objects[page - 1].slice(0, -2) + `/Annots [${ids.map(id => `${id} 0 R`).join(' ')}] >>`;
    };
    addLinks(pages[0], [
      `/Rect [24 696 200 760] /QuadPoints [24 760 180 760 24 740 180 740 24 720 120 720 24 700 120 700]
        /Contents (Jump to chapter) /Dest [${pages[5]} 0 R /XYZ 0 380 null]`,
      '/Rect [24 640 210 672] /Contents (Jump to rotated page) /A << /S /GoTo /D (rotated) >>',
      '/Rect [24 575 200 608] /Contents (Web reference) /A << /S /URI /URI (https://example.com/spec) >>',
      '/Rect [24 524 200 556] /Contents (Unactionable protocol) /A << /S /URI /URI (javascript:void%280%29) >>',
      `/F 2 /Rect [24 480 200 512] /Contents (Hidden link) /Dest [${pages[5]} 0 R /Fit]`
    ]);
    addLinks(pages[22], [`/Rect [210 370 245 420] /Contents (Return to first page) /Dest [${pages[0]} 0 R /Fit]`]);
  }
  // Separate the named index from the final xref range, which is read during open.
  objects.push(`${padding}null`);
  const bytes = Buffer.from(encodePdfObjects(objects));
  return { bytes, outlineOffset: bytes.indexOf(outlineMarker), destinationOffset: bytes.indexOf(destinationMarker) };
}

export function createPdfSearchRangeFixture(heldResource = false) {
  const padding = '% padding before and after the held offset\n'.repeat(10_000);
  const marker = 'text search range marker';
  const blocked = `${padding}% ${marker}\n${padding}`;
  const stream = body => `<< /Length ${body.length} >>\nstream\n${body}endstream`;
  const cmap = 'begincmap\n/CMapName /Identity def\n/CMapType 2 def\n'
    + '1 begincodespacerange\n<00> <ff>\nendcodespacerange\n1 beginbfrange\n<20> <7e> <0020>\nendbfrange\nendcmap\n';
  const objects = ['<< /Type /Catalog /Pages 2 0 R >>', '', '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>'];
  if (heldResource) {
    objects.push('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /ToUnicode 5 0 R >>');
    objects.push(stream(blocked + cmap));
  }
  const kids = [];
  for (let index = 1; index <= 12; index++) {
    const page = objects.length + 1;
    const font = heldResource && index === 6 ? 4 : 3;
    kids.push(`${page} 0 R`);
    objects.push(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 600 800] /Resources << /Font << /F1 ${font} 0 R >> >> /Contents ${page + 1} 0 R >>`);
    const content = '0.08 0.18 0.3 rg 0 0 600 800 re f\n1 1 1 rg\n'
      + `BT /F1 24 Tf 40 740 Td (Document page ${index}) Tj ET\n`;
    objects.push(stream(!heldResource && index === 6 ? blocked + content : content));
  }
  objects[1] = `<< /Type /Pages /Count 12 /Kids [${kids.join(' ')}] >>`;
  const bytes = Buffer.from(encodePdfObjects(objects));
  return { bytes, offset: bytes.indexOf(marker), match: 'Document page 6' };
}

export function createPdfPageTreeRangeFixture(indirectBox = false) {
  const objects = ['<< /Type /Catalog /Pages 2 0 R >>', '', '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>'];
  const groups = Array.from({ length: 4 }, () => ({ ref: objects.push(''), kids: [] }));
  const marker = 'held geometry for page six';
  const padding = `% ${'x'.repeat(8192)}\n`.repeat(12);
  const held = `${padding}% ${marker}\n${padding}`;
  const boxRef = indirectBox ? objects.push(`${held}[0 0 420 630]`) : 0;
  for (let page = 1; page <= 12; page++) {
    const group = groups[Math.floor((page - 1) / 3)], id = objects.length + 1;
    group.kids.push(`${id} 0 R`);
    const box = page === 6 ? indirectBox ? `${boxRef} 0 R` : '[0 0 420 630]' : '[0 0 600 800]';
    objects.push(`<< /Type /Page /Parent ${group.ref} 0 R\n${page === 6 && !indirectBox ? held : ''}`
      + `/MediaBox ${box} /Resources << /Font << /F1 3 0 R >> >> /Contents ${id + 1} 0 R >>`);
    const body = `BT /F1 24 Tf 40 240 Td (Page ${page}) Tj ET\n`;
    objects.push(`<< /Length ${body.length} >>\nstream\n${body}endstream`);
  }
  for (const { ref, kids } of groups) objects[ref - 1] = `<< /Type /Pages /Parent 2 0 R /Count ${kids.length} /Kids [${kids.join(' ')}] >>`;
  objects[1] = `<< /Type /Pages /Count 12 /Kids [${groups.map(({ ref }) => `${ref} 0 R`).join(' ')}] >>`;
  const bytes = Buffer.from(encodePdfObjects(objects));
  return { bytes, offset: bytes.indexOf(marker) };
}

export function createPdfAnnotationRangeFixture(part = 'dictionary') {
  const objects = ['<< /Type /Catalog /Pages 2 0 R >>', '', '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>'];
  const kids = [];
  const marker = `held annotation ${part}`;
  const padding = `% ${'x'.repeat(8192)}\n`.repeat(12);
  const hold = key => key === part ? `${padding}% ${marker}\n${padding}` : '';
  const count = 12;
  const annotation = objects.length + count * 2 + 1, appearance = annotation + 1, assets = appearance + 1;
  for (let page = 1; page <= count; page++) {
    const id = objects.length + 1;
    kids.push(`${id} 0 R`);
    const annots = page === 6 ? ` /Annots [${annotation} 0 R]` : '';
    objects.push(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 600 800] /Resources << /Font << /F1 3 0 R >> >> /Contents ${id + 1} 0 R${annots} >>`);
    const body = `BT /F1 24 Tf 40 740 Td (Page ${page}) Tj ET\n`;
    objects.push(`<< /Length ${body.length} >>\nstream\n${body}endstream`);
  }
  objects[1] = `<< /Type /Pages /Count ${count} /Kids [${kids.join(' ')}] >>`;
  objects.push(`<< /Type /Annot /Subtype /Square\n${hold('dictionary')}/Rect [60 570 120 630] /F 4 /AP << /N ${appearance} 0 R >> >>`);
  const paint = `${hold('appearance')}/Opacity gs 1 0 0 rg 0 0 60 60 re f\n`;
  objects.push(`<< /Type /XObject /Subtype /Form /BBox [0 0 60 60] /Resources ${assets} 0 R /Length ${paint.length} >>\nstream\n${paint}endstream`);
  objects.push(`<<\n${hold('resources')}/ExtGState << /Opacity << /Type /ExtGState /CA 1 /ca 1 >> >> >>`);
  const bytes = Buffer.from(encodePdfObjects(objects));
  return { bytes, offset: bytes.indexOf(marker) };
}

export function createWidePdfRangeFixture() {
  const objects = ['<< /Type /Catalog /Pages 2 0 R >>', '', '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>'];
  const kids = [];
  const marker = 'held content on the second wide page';
  const padding = `% ${'x'.repeat(8192)}\n`.repeat(12);
  for (let page = 1; page <= 4; page++) {
    const id = objects.length + 1;
    kids.push(`${id} 0 R`);
    objects.push(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 12000 300] /Resources << /Font << /F1 3 0 R >> >> /Contents ${id + 1} 0 R >>`);
    const paint = '0.08 0.18 0.3 rg 0 0 12000 300 re f\n1 0 0 rg 4690 150 20 20 re f\n'
      + `1 1 1 rg BT /F1 24 Tf 40 200 Td (Wide page ${page}) Tj ET\n`;
    const body = page === 2 ? `${padding}% ${marker}\n${padding}${paint}` : paint;
    objects.push(`<< /Length ${body.length} >>\nstream\n${body}endstream`);
  }
  objects[1] = `<< /Type /Pages /Count ${kids.length} /Kids [${kids.join(' ')}] >>`;
  const bytes = Buffer.from(encodePdfObjects(objects));
  return { bytes, offset: bytes.indexOf(marker) };
}

export async function servePdfFixture(bytes, { ranges = true, rangeResponse } = {}) {
  const requests = [];
  const pending = new Map();
  let pause, prefixBytes = 0;
  const cors = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
    'Access-Control-Allow-Headers': 'Range',
    'Access-Control-Expose-Headers': 'Accept-Ranges, Content-Range, Content-Encoding, ETag',
    ETag: '"fixture-v1"',
    'Last-Modified': 'Wed, 01 Jan 2020 00:00:00 GMT',
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
    const override = partial ? rangeResponse?.({ begin, end }) : undefined;
    const body = override?.body ?? bytes.subarray(begin, end);
    const send = () => {
      response.end(body.subarray(record.bytesSent));
      record.bytesSent = body.length;
    };
    const headers = {
      ...cors, 'Content-Type': 'application/pdf', 'Content-Length': end - begin, 'Cache-Control': 'no-store',
      ...(ranges ? { 'Accept-Ranges': 'bytes' } : {}),
      ...(partial ? { 'Content-Range': `bytes ${begin}-${end - 1}/${bytes.length}` } : {}),
      ...override?.headers
    };
    for (const name of Object.keys(headers)) if (headers[name] === undefined) delete headers[name];
    response.writeHead(override?.status ?? (partial ? 206 : 200), headers);
    if (ranges && !partial) {
      // A range client can cancel this response as soon as it sees its headers.
      record.bytesSent = Math.min(bytes.length, 16 * 1024);
      response.write(bytes.subarray(0, record.bytesSent));
    } else if (partial && (pause === 'all' || pause?.some(offset => begin <= offset && offset < end))) {
      pending.set(response, { send, record });
      record.bytesSent = Math.min(prefixBytes, body.length);
      if (record.bytesSent) response.write(body.subarray(0, record.bytesSent));
      else response.flushHeaders();
    } else send();
  });
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  return {
    url: `http://127.0.0.1:${server.address().port}/remote.pdf?signature=test%2Bkey`,
    requests,
    pauseRanges(offset = 'all', prefix = 0) {
      pause = offset === 'all' ? offset : [offset].flat();
      prefixBytes = prefix;
    },
    disconnectRange(offset) {
      for (const [response, { record }] of pending) {
        if (record.begin <= offset && offset < record.end) response.destroy();
      }
    },
    resumeRanges() {
      pause = undefined;
      for (const { send } of pending.values()) send();
      pending.clear();
    },
    close: () => new Promise(resolve => {
      server.close(resolve);
      server.closeAllConnections();
    }),
  };
}
