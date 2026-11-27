import { Buffer } from 'node:buffer';

const outlineName = 'ABCDEF+LiberationSans';
const stream = bytes => Buffer.concat([
  Buffer.from(`<< /Length ${bytes.length} >>\nstream\n`), Buffer.from(bytes), Buffer.from('\nendstream')
]);

// The first page uses system fallback and PDF glyph operators, and the last
// page points to a distinct embedded TrueType program.
export function createPdfFontInventoryFixture(fontBytes, pageCount = 40) {
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '',
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>',
    '<< /Type /Font /Subtype /Type3 /FontBBox [0 0 600 700] /FontMatrix [.001 0 0 .001 0 0] /CharProcs << /A 5 0 R >> /Encoding << /Type /Encoding /Differences [65 /A] >> /FirstChar 65 /LastChar 65 /Widths [600] /Resources << >> >>',
    stream(Buffer.from('600 0 0 0 600 700 d1 0 0 600 700 re f')),
    `<< /Type /Font /Subtype /TrueType /BaseFont /${outlineName} /Encoding /WinAnsiEncoding /FirstChar 65 /LastChar 90 /Widths [${'650 '.repeat(26)}] /FontDescriptor 7 0 R >>`,
    `<< /Type /FontDescriptor /FontName /${outlineName} /Flags 32 /FontBBox [-500 -300 1400 1100] /Ascent 900 /Descent -200 /CapHeight 680 /ItalicAngle 0 /StemV 80 /FontFile2 8 0 R >>`,
    Buffer.concat([
      Buffer.from(`<< /Length ${fontBytes.length} /Length1 ${fontBytes.length} >>\nstream\n`),
      Buffer.from(fontBytes), Buffer.from('\nendstream')
    ])
  ];
  const kids = [];
  for (let index = 0; index < pageCount; index++) {
    const id = objects.length + 1;
    kids.push(`${id} 0 R`);
    const first = index === 0;
    const last = index === pageCount - 1;
    const fonts = `/F1 3 0 R ${first ? '/F2 4 0 R' : ''} ${last ? '/F3 6 0 R' : ''}`;
    const text = [
      `BT /F1 18 Tf 35 750 Td (Plain font page ${index + 1}) Tj ET`,
      first ? 'BT /F2 24 Tf 35 690 Td (A) Tj ET' : '',
      last ? 'BT /F3 24 Tf 35 630 Td (EMBEDDED) Tj ET' : ''
    ].join('\n');
    objects.push(
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 600 800] /Resources << /Font << ${fonts} >> >> /Contents ${id + 1} 0 R >>`,
      stream(Buffer.from(text))
    );
  }
  objects[1] = `<< /Type /Pages /Count ${pageCount} /Kids [${kids.join(' ')}] >>`;
  const chunks = [Buffer.from('%PDF-1.4\n%\xFF\xFF\xFF\xFF\n', 'latin1')];
  const offsets = [0];
  let size = chunks[0].length;
  objects.forEach((object, index) => {
    offsets.push(size);
    const entry = Buffer.concat([Buffer.from(`${index + 1} 0 obj\n`), Buffer.from(object), Buffer.from('\nendobj\n')]);
    chunks.push(entry);
    size += entry.length;
  });
  chunks.push(Buffer.from(
    `xref\n0 ${offsets.length}\n0000000000 65535 f \n${offsets.slice(1).map(offset => `${String(offset).padStart(10, '0')} 00000 n \n`).join('')}`
    + `trailer\n<< /Size ${offsets.length} /Root 1 0 R >>\nstartxref\n${size}\n%%EOF\n`
  ));
  return Buffer.concat(chunks);
}
