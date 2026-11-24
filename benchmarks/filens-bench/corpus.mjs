// Synthetic fixtures and labels are authored together, before any extractor runs.
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { deflateSync } from 'node:zlib';
import { fileURLToPath } from 'node:url';
import { strToU8, zipSync } from 'fflate';

const root = fileURLToPath(new URL('../../', import.meta.url));
export const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
const xml = text => String(text).replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;');
const zip = files => zipSync(Object.fromEntries(Object.entries(files).map(([name, value]) => [name, [typeof value === 'string' ? strToU8(value) : value, { mtime: new Date(2020, 0, 1) }]])), { level: 9 });
const relType = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/';
const relationships = rows => `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${rows.map(([id, type, target]) => `<Relationship Id="${id}" Type="${relType}${type}" Target="${target}"/>`).join('')}</Relationships>`;
function office(main, mime, files, overrides = []) {
  return zip({
    '[Content_Types].xml': `<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/>${[[main, mime], ...overrides].map(([part, type]) => `<Override PartName="/${part}" ContentType="application/vnd.openxmlformats-officedocument.${type}+xml"/>`).join('')}</Types>`,
    '_rels/.rels': relationships([['r1', 'officeDocument', main]]), ...files,
  });
}
function docx(text) {
  return office('word/document.xml', 'wordprocessingml.document.main', {
    'word/document.xml': `<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>${text.split('\n').map(line => `<w:p><w:r><w:t xml:space="preserve">${xml(line)}</w:t></w:r></w:p>`).join('')}</w:body></w:document>`,
  });
}
function xlsx(rows) {
  return office('xl/workbook.xml', 'spreadsheetml.sheet.main', {
    'xl/workbook.xml': '<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="Costs" sheetId="1" r:id="r1"/></sheets></workbook>',
    'xl/_rels/workbook.xml.rels': relationships([['r1', 'worksheet', 'worksheets/sheet1.xml']]),
    'xl/worksheets/sheet1.xml': `<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>${rows.map((row, r) => `<row r="${r + 1}">${row.map((value, c) => `<c r="${String.fromCharCode(65 + c)}${r + 1}" t="inlineStr"><is><t>${xml(value)}</t></is></c>`).join('')}</row>`).join('')}</sheetData></worksheet>`,
  }, [['xl/worksheets/sheet1.xml', 'spreadsheetml.worksheet']]);
}
function pptx(text) {
  return office('ppt/presentation.xml', 'presentationml.presentation.main', {
    'ppt/presentation.xml': '<p:presentation xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><p:sldIdLst><p:sldId id="256" r:id="r1"/></p:sldIdLst></p:presentation>',
    'ppt/_rels/presentation.xml.rels': relationships([['r1', 'slide', 'slides/slide1.xml']]),
    'ppt/slides/slide1.xml': `<p:sld xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"><p:cSld><p:spTree><p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr/><p:sp><p:nvSpPr><p:cNvPr id="2" name="Decision"/><p:cNvSpPr/><p:nvPr/></p:nvSpPr><p:spPr/><p:txBody><a:bodyPr/><a:lstStyle/>${text.split('\n').map(line => `<a:p><a:r><a:t>${xml(line)}</a:t></a:r></a:p>`).join('')}</p:txBody></p:sp></p:spTree></p:cSld></p:sld>`,
  }, [['ppt/slides/slide1.xml', 'presentationml.slide']]);
}
function pdf(text) {
  const stream = deflateSync(Buffer.from(`BT /F1 12 Tf 40 750 Td (${text.replace(/[()\\]/g, '\\$&')}) Tj ET`));
  const objects = ['<< /Type /Catalog /Pages 2 0 R >>', '<< /Type /Pages /Kids [3 0 R] /Count 1 >>', '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>', '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>', Buffer.concat([Buffer.from(`<< /Length ${stream.length} /Filter /FlateDecode >>\nstream\n`), stream, Buffer.from('\nendstream')])];
  const chunks = [Buffer.from('%PDF-1.4\n')], offsets = [0];
  for (const [i, object] of objects.entries()) {
    offsets.push(chunks.reduce((sum, chunk) => sum + chunk.length, 0));
    chunks.push(Buffer.from(`${i + 1} 0 obj\n`), Buffer.from(object), Buffer.from('\nendobj\n'));
  }
  const start = chunks.reduce((sum, chunk) => sum + chunk.length, 0);
  chunks.push(Buffer.from(`xref\n0 6\n0000000000 65535 f \n${offsets.slice(1).map(offset => `${String(offset).padStart(10, '0')} 00000 n \n`).join('')}trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n${start}\n%%EOF\n`));
  return Buffer.concat(chunks);
}

export async function prepare(work, { ocr = false, distractors = 32 } = {}) {
  const corpus = path.join(work, 'corpus');
  await mkdir(corpus, { recursive: true });
  const documents = [], physicalFiles = [], tasks = [];
  async function put(source, bytes, text) {
    await writeFile(path.join(corpus, source), bytes);
    physicalFiles.push({ source, bytes: Buffer.byteLength(bytes), sha256: sha256(bytes) });
    if (text !== undefined) documents.push({ source, text });
  }
  const add = (id, family, question, answers, evidence, query, relevant) => tasks.push({
    id, family, track: ['text', 'long-document'].includes(family) ? 'text-control' : 'complex', question, answerKeys: Object.keys(answers), answers, evidence,
    ...(query ? { retrieval: { query, relevant } } : {}),
  });
  const proof = (source, anchor) => ({ source, anchor });
  const current = 'AURORA2041\n状态：现行；生效日期：2041-06-01。\n项目负责人：林澈。\n现行预算上限：3582.70 元。\n';
  const old = 'AURORA2041\n状态：归档；生效日期：2040-06-01。\n项目负责人：周岚。\n旧预算上限：3582.07 元。\n';
  const rows = [['PROJECT', 'ITEM', 'AMOUNT_CNY'], ['AURORA2041', 'Hardware', '2100.20'], ['AURORA2041', 'Service', '1482.50']];
  const slide = 'RELEASE2041\n发布前必须完成双人复核和离线恢复演练。\nRelease gate: two-person review and offline recovery drill.\n';
  const milestone = 'MILESTONE2041 accepted on 2041-07-19.';
  const archived = 'ARCHIVE2041\n海运签收人：许闻。\n';
  const note = 'TEXT2041\n支持工单的复核周期为 17 天。\n';
  const tail = 'Field observations without approval decisions.\n'.repeat(4000) + 'TAIL2041\n尾部审批码：VIOLET-83。\n';
  const spreadsheetText = rows.map(row => row.join('\t')).join('\n');
  await put('f000.txt', note, note);
  await put('f001.docx', docx(current), current);
  await put('f002.docx', docx(old), old);
  await put('f003.xlsx', xlsx(rows), spreadsheetText);
  await put('f004.pptx', pptx(slide), slide);
  await put('f005.pdf', pdf(milestone), milestone);
  await put('f006.zip', zip({ 'inner.zip': zip({ 'f000.docx': docx(archived) }) }));
  documents.push({ source: 'f006.zip!/inner.zip!/f000.docx', text: archived });
  await put('f007.txt', tail, tail);
  add('text-control', 'text', 'TEXT2041 工单复核周期是多少天？', { days: '17' }, [proof('f000.txt', '17')], 'TEXT2041', ['f000.txt']);
  add('current-owner', 'version', 'AURORA2041 现行项目负责人是谁？忽略归档文件。', { owner: '林澈' }, [proof('f001.docx', '林澈')], 'AURORA2041', ['f001.docx', 'f002.docx', 'f003.xlsx']);
  add('numeric-trap', 'version', 'AURORA2041 现行预算上限是多少元？不要采用旧预算。', { budget: '3582.70' }, [proof('f001.docx', '3582.70')]);
  add('sheet-cell', 'spreadsheet', 'AURORA2041 的 Hardware 费用是多少元？', { hardware: '2100.20' }, [proof('f003.xlsx', '2100.20')], '2100.20', ['f003.xlsx']);
  add('slide-gate', 'slides', 'RELEASE2041 发布前必须完成哪两项工作？使用文件中的中文表述。', { review: '双人复核', drill: '离线恢复演练' }, [proof('f004.pptx', '双人复核'), proof('f004.pptx', '离线恢复演练')], 'RELEASE2041', ['f004.pptx']);
  add('pdf-date', 'pdf', 'MILESTONE2041 的验收日期是什么？使用 YYYY-MM-DD。', { date: '2041-07-19' }, [proof('f005.pdf', '2041-07-19')], 'MILESTONE2041', ['f005.pdf']);
  add('nested-archive', 'archive', 'ARCHIVE2041 的海运签收人是谁？给出压缩包内的完整成员路径。', { receiver: '许闻' }, [proof('f006.zip!/inner.zip!/f000.docx', '许闻')], 'ARCHIVE2041', ['f006.zip!/inner.zip!/f000.docx']);
  add('long-tail', 'long-document', 'TAIL2041 的尾部审批码是什么？', { code: 'VIOLET-83' }, [proof('f007.txt', 'VIOLET-83')], 'TAIL2041', ['f007.txt']);
  add('cross-file-sum', 'multi-hop', '将 AURORA2041 的 Hardware 和 Service 费用相加，再与现行预算上限比较。给出合计及剩余预算，单位元。', { total: '3582.70', remaining: '0.00' }, [proof('f003.xlsx', '2100.20'), proof('f003.xlsx', '1482.50'), proof('f001.docx', '3582.70')]);
  add('absent-topic', 'unanswerable', 'AURORA2041 现行负责人的电话号码是什么？找不到时明确返回 not_found。', {}, []);
  add('absent-id', 'unanswerable', 'UNKNOWN2099X 的批准人是谁？找不到时明确返回 not_found。', {}, [], 'UNKNOWN2099X', []);
  if (ocr) {
    const imageText = await readFile(path.join(root, 'docs/assets/agent-cli/invoice-zh.expected.txt'), 'utf8');
    await put('f008.png', await readFile(path.join(root, 'docs/assets/agent-cli/invoice-zh.png')), imageText);
    await put('f009.pdf', await readFile(path.join(root, 'converter/rapidocr/testdata/scan.pdf')), 'Invoice ID FILENS2026\nTotal 12345.67\nSecond page BRIGHT2027\nLocal OCR test\n');
    add('image-invoice', 'ocr-image', '采购单图片中 FILENS2026 的应付金额是多少元？', { amount: '12345.67' }, [proof('f008.png', '12345.67')], 'FILENS2026', ['f008.png', 'f009.pdf']);
    add('scan-second-page', 'ocr-pdf', '扫描 PDF 第二页的项目标识符是什么？', { identifier: 'BRIGHT2027' }, [proof('f009.pdf', 'BRIGHT2027')], 'BRIGHT2027', ['f009.pdf']);
  }
  for (let i = 0; i < distractors; i++) {
    const text = `Background notebook ${i}. Shelves, weather and travel observations.\n`;
    await put(`d${String(i).padStart(5, '0')}.txt`, text, text);
  }
  // ZIP timestamps are fixed so independent preparations have the same hash.
  const manifest = { schema: 'filens-bench-v1', synthetic: true, ocr, distractors, physicalFiles, documents, tasks };
  await writeFile(path.join(work, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
  return manifest;
}
