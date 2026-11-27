// Deterministic, uncompressed PDF with varying page sizes, vector art and searchable text.
export function createPdfFixture(pageCount = 100, mixedSizes = false, rotation = 0, textCommands, pagesPerGroup = 0, artItems = 60, userUnit = 1) {
  const objects = ['<< /Type /Catalog /Pages 2 0 R >>', '', '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>'];
  const groups = [];
  if (pagesPerGroup) for (let index = 0; index < pageCount; index += pagesPerGroup) {
    groups.push(objects.push(''));
  }
  const pages = [];
  for (let index = 0; index < pageCount; index++) {
    const width = mixedSizes && index % 3 === 1 ? 800 : 600;
    const height = mixedSizes && index % 3 === 1 ? 600 : mixedSizes && index % 3 === 2 ? 1000 : 800;
    const pageId = objects.length + 1;
    pages.push(`${pageId} 0 R`);
    const art = Array.from({ length: artItems }, (_, item) => {
      const x = 40 + (item % 6) * 80, y = 90 + Math.floor(item / 6) * 36;
      return `${(item % 7) / 7} 0.4 0.7 rg ${x} ${y} 62 22 re f`;
    }).join('\n');
    const textArt = textCommands ? textCommands(index, height) : `1 1 1 rg BT /F1 24 Tf 40 ${height - 60} Td (Document page ${index + 1}) Tj ET\n`;
    const stream = `0.08 0.18 0.3 rg 0 0 ${width} ${height} re f\n${art}\n${textArt}`;
    const parent = pagesPerGroup ? groups[Math.floor(index / pagesPerGroup)] : 2;
    const units = userUnit === 1 ? '' : ` /UserUnit ${userUnit}`;
    objects.push(`<< /Type /Page /Parent ${parent} 0 R /MediaBox [0 0 ${width} ${height}] /Rotate ${rotation}${units} /Resources << /Font << /F1 3 0 R >> >> /Contents ${pageId + 1} 0 R >>`);
    objects.push(`<< /Length ${stream.length} >>\nstream\n${stream}endstream`);
  }
  for (const [index, id] of groups.entries()) {
    const kids = pages.slice(index * pagesPerGroup, (index + 1) * pagesPerGroup);
    objects[id - 1] = `<< /Type /Pages /Parent 2 0 R /Count ${kids.length} /Kids [${kids.join(' ')}] >>`;
  }
  const rootKids = groups.length ? groups.map(id => `${id} 0 R`) : pages;
  objects[1] = `<< /Type /Pages /Count ${pageCount} /Kids [${rootKids.join(' ')}] >>`;
  let text = userUnit === 1 ? '%PDF-1.4\n' : '%PDF-1.7\n', offsets = [0];
  for (let index = 0; index < objects.length; index++) {
    offsets.push(text.length);
    text += `${index + 1} 0 obj\n${objects[index]}\nendobj\n`;
  }
  const xref = text.length;
  text += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  text += offsets.slice(1).map(offset => `${String(offset).padStart(10, '0')} 00000 n \n`).join('');
  text += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return new TextEncoder().encode(text);
}

export function createDensePdfSearchFixture() {
  return createPdfFixture(12, false, 0, (index, height) => {
    if (index) return `1 1 1 rg BT /F1 12 Tf 40 ${height - 50} Td (Unrelated page ${index + 1}) Tj ET\n`;
    const hits = 'X '.repeat(100);
    return '1 1 1 rg\n' + Array.from({ length: 101 }, (_, line) =>
      `BT /F1 5 Tf 40 ${height - 55 - line * 7} Td (${hits}) Tj ET\n`).join('');
  }, 0, 0);
}
