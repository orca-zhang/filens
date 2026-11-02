import { expect, test } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import JSZip from 'jszip';
import * as cfb from 'cfb';
import SevenZip from '7z-wasm';
import { ZipWriter, Uint8ArrayReader, Uint8ArrayWriter } from '@zip.js/zip.js/lib/zip-core-native.js';

async function encryptedZip(files: Array<{ name: string; data: Uint8Array; password: string }>, zipCrypto = false): Promise<Buffer> {
  const writer = new ZipWriter(new Uint8ArrayWriter(), { useWebWorkers: false });
  for (const file of files) await writer.add(file.name, new Uint8ArrayReader(file.data), { password: file.password, zipCrypto });
  return Buffer.from(await writer.close());
}

async function encrypted7z(files: Record<string, Uint8Array>, password: string, encryptHeaders: boolean): Promise<Buffer> {
  const engine = await SevenZip({ print: () => {}, printErr: () => {} });
  engine.FS.mkdir('/data'); engine.FS.chdir('/data');
  for (const [name, bytes] of Object.entries(files)) engine.FS.writeFile(name, bytes);
  engine.callMain(['a', '/archive.7z', '.', `-p${password}`, `-mhe=${encryptHeaders ? 'on' : 'off'}`, '-bd']);
  return Buffer.from(engine.FS.readFile('/archive.7z'));
}

for (const encryptHeaders of [false, true]) {
  test(`opens password protected 7z with encrypted ${encryptHeaders ? 'filenames' : 'entries'}`, async ({ page }) => {
    const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
    const buffer = await encrypted7z({ '秘密.txt': Buffer.from('SevenZip encrypted preview') }, ' 7z 密码🔐 ', encryptHeaders);
    await page.goto('./?view=preview&lang=zh_CN');
    await page.locator('input[type=file]').setInputFiles({ name: 'protected.7z', mimeType: 'application/x-7z-compressed', buffer });
    if (!encryptHeaders) await page.locator('tr.archivev-row').filter({ hasText: '秘密.txt' }).click();
    const field = page.getByLabel('文档密码', { exact: true });
    await expect(field).toBeVisible();
    await field.fill('wrong'); await field.press('Enter');
    await expect(page.getByRole('alert')).toContainText('密码不正确');
    await field.fill(' 7z 密码🔐 '); await field.press('Enter');
    if (encryptHeaders) await page.locator('tr.archivev-row').filter({ hasText: '秘密.txt' }).click();
    await expect(page.locator('.archivev-entry-preview')).toContainText('SevenZip encrypted preview');
    expect(errors).toEqual([]);
  });
}

for (const version of [4, 5]) {
  test(`opens RAR ${version} entries with independent passwords`, async ({ page }) => {
    const buffer = await readFile(`packages/archive/test/fixtures/rar${version}-encrypted.rar`);
    await page.goto('./?view=preview&lang=zh_CN');
    await page.locator('input[type=file]').setInputFiles({ name: `test${version}.rar`, mimeType: 'application/vnd.rar', buffer });
    for (const [name, password] of [['b.txt', 'password'], ['d.txt', 'password2']]) {
      await page.locator('tr.archivev-row').filter({ hasText: name }).click();
      const field = page.getByLabel('文档密码', { exact: true });
      await expect(field).toBeVisible();
      await field.fill(password); await field.press('Enter');
      await expect(page.locator('.archivev-entry-preview')).toContainText(`This is from ${name}`);
      await page.getByRole('button', { name: 'Back to archive', exact: true }).click();
    }
  });

  test(`unlocks RAR ${version} encrypted filenames`, async ({ page }) => {
    const buffer = await readFile(`packages/archive/test/fixtures/rar${version}-encrypted-filenames.rar`);
    await page.goto('./?view=preview&lang=zh_CN');
    await page.locator('input[type=file]').setInputFiles({ name: `headers${version}.rar`, mimeType: 'application/vnd.rar', buffer });
    const field = page.getByLabel('文档密码', { exact: true });
    await expect(field).toBeVisible();
    await field.fill('wrong'); await field.press('Enter');
    await expect(page.getByRole('alert')).toContainText('密码不正确');
    await field.fill('password'); await field.press('Enter');
    await page.locator('tr.archivev-row').filter({ hasText: 'c.txt' }).click();
    await expect(page.locator('.archivev-entry-preview')).toContainText('This is from c.txt');
  });
}

test('opens an anonymous 7z embedded in Office, then RAR, and returns through both containers', async ({ page }) => {
  const rar = await readFile('packages/archive/test/fixtures/rar5-encrypted.rar');
  const sevenZip = await encrypted7z({ 'inner.rar': rar }, 'outer password', true);
  const buffer = await documentWithAttachment('docx', sevenZip, 'object.bin');
  await page.goto('./?view=preview&lang=zh_CN');
  await page.locator('input[type=file]').setInputFiles({ name: 'parent.docx', mimeType: 'application/octet-stream', buffer });
  await page.locator('.filens-attachments summary').click();
  await page.getByRole('button', { name: 'object.bin', exact: true }).click();
  const field = page.getByLabel('文档密码', { exact: true });
  await expect(field).toBeVisible();
  await page.getByRole('button', { name: '取消', exact: true }).click();
  await expect(page.locator('.filens-attachment-panel')).toHaveCount(0);
  await page.getByRole('button', { name: 'object.bin', exact: true }).click();
  await field.fill('outer password'); await field.press('Enter');
  await page.locator('tr.archivev-row').filter({ hasText: 'inner.rar' }).click();
  await page.locator('tr.archivev-row').filter({ hasText: 'b.txt' }).click();
  await expect(field).toHaveValue('');
  await expect(page.locator('.pptxv-password-filename')).toHaveText('inner.rar › b.txt');
  await field.fill('password'); await field.press('Enter');
  await expect(page.locator('.archivev-entry-preview')).toContainText('This is from b.txt');
  await page.getByRole('button', { name: 'Back to archive', exact: true }).click();
  await page.getByRole('button', { name: 'Back', exact: true }).click();
  await expect(page.locator('tr.archivev-row')).toContainText('inner.rar');
  await page.getByRole('button', { name: '返回文档', exact: true }).click();
  await expect(page.locator('section.docx').first()).toBeVisible();
});

function olePackage(name: string, data: Uint8Array): Uint8Array {
  const strings = Buffer.from(`${name}\0C:\\source\\${name}\0`);
  const temporary = Buffer.from(`C:\\temp\\${name}\0`);
  const stream = Buffer.alloc(6 + strings.length + 4 + temporary.length + 4 + data.length);
  stream.writeUInt32LE(stream.length - 4, 0);
  stream.writeUInt16LE(2, 4);
  strings.copy(stream, 6);
  const offset = 6 + strings.length + 4;
  temporary.copy(stream, offset);
  stream.writeUInt32LE(data.length, offset + temporary.length);
  stream.set(data, offset + temporary.length + 4);
  const file = cfb.utils.cfb_new();
  cfb.utils.cfb_add(file, '\u0001Ole10Native', stream);
  return new Uint8Array(cfb.write(file, { type: 'array' }));
}

async function documentWithAttachment(format: 'docx' | 'xlsx' | 'pptx', source: Uint8Array, name: string): Promise<Buffer> {
  const [sample, root] = format === 'docx' ? ['rich-docx-tables.docx', 'word']
    : format === 'xlsx' ? ['rich-xlsx-data-types.xlsx', 'xl'] : ['sample-deck.pptx', 'ppt'];
  const zip = await JSZip.loadAsync(await readFile(`apps/demo/public/samples/${sample}`));
  zip.file(`${root}/embeddings/${name}`, source);
  return zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' });
}

function pdfWithAttachment(payload: Uint8Array): Buffer {
  const objects: Array<Buffer | string> = [
    '<< /Type /Catalog /Pages 2 0 R /Names << /EmbeddedFiles << /Names [(bundle.zip) 6 0 R] >> >> >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 300 300] /Resources << >> /Contents 4 0 R >>',
    '<< /Length 0 >>\nstream\n\nendstream',
    '<< >>',
    '<< /Type /Filespec /F (bundle.zip) /EF << /F 7 0 R >> >>',
    Buffer.concat([Buffer.from(`<< /Type /EmbeddedFile /Length ${payload.length} >>\nstream\n`), payload, Buffer.from('\nendstream')])
  ];
  const chunks = [Buffer.from('%PDF-1.7\n')];
  const offsets = [0];
  let size = chunks[0].length;
  objects.forEach((object, index) => {
    offsets.push(size);
    const chunk = Buffer.concat([Buffer.from(`${index + 1} 0 obj\n`), Buffer.from(object), Buffer.from('\nendobj\n')]);
    chunks.push(chunk); size += chunk.length;
  });
  chunks.push(Buffer.from(`xref\n0 ${objects.length + 1}\n0000000000 65535 f \n${offsets.slice(1).map(offset => `${String(offset).padStart(10, '0')} 00000 n \n`).join('')}trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${size}\n%%EOF`));
  return Buffer.concat(chunks);
}

for (const zipCrypto of [true, false]) {
  test(`opens encrypted ZIP entries with password retry (${zipCrypto ? 'ZipCrypto' : 'AES'})`, async ({ page }) => {
    const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
    const password = ' ZIP 密码🔐 ';
    const buffer = await encryptedZip([{ name: 'secret.txt', data: Buffer.from('Decrypted ZIP preview'), password }], zipCrypto);
    await page.goto('./?view=preview&lang=zh_CN');
    await page.locator('input[type=file]').setInputFiles({ name: 'encrypted.zip', mimeType: 'application/zip', buffer });
    await page.locator('tr.archivev-row').filter({ hasText: 'secret.txt' }).click();
    const field = page.getByLabel('文档密码', { exact: true });
    await expect(field).toBeVisible();
    await expect(page.locator('.pptxv-password-filename')).toHaveText('encrypted.zip › secret.txt');
    await field.fill('wrong'); await field.press('Enter');
    await expect(page.getByRole('alert')).toContainText('密码不正确');
    await expect(field).toHaveValue('');
    await field.fill(password); await field.press('Enter');
    await expect(field).toHaveCount(0);
    await expect(page.locator('.archivev-entry-preview')).toContainText('Decrypted ZIP preview');
    expect(errors).toEqual([]);
  });
}

for (const format of ['docx', 'xlsx', 'pptx'] as const) {
  test(`previews an embedded file and restores its parent ${format}`, async ({ page }) => {
    const buffer = await documentWithAttachment(format, Buffer.from('An embedded document attachment'), 'notes.txt');
    await page.goto('./?view=preview&lang=zh_CN');
    await page.locator('input[type=file]').setInputFiles({ name: `parent.${format}`, mimeType: 'application/octet-stream', buffer });
    await page.locator('.filens-attachments summary').click();
    await page.getByRole('button', { name: 'notes.txt', exact: true }).click();
    await expect(page.locator('.filens-attachment-preview')).toContainText('An embedded document attachment');
    await page.getByRole('button', { name: '返回文档', exact: true }).click();
    await expect(page.locator('.filens-attachment-panel')).toHaveCount(0);
    const selector = format === 'docx' ? 'section.docx' : format === 'xlsx' ? '.xlsxv-preview' : '.pptxv-slide';
    await expect(page.locator(selector).first()).toBeVisible();
  });
}

test('opens OLE ZIP payloads, keeps nested passwords independent, and can cancel or return', async ({ page }) => {
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
  const inner = await encryptedZip([{ name: 'inside.txt', data: Buffer.from('Deeply nested document payload'), password: 'inner secret' }]);
  const outer = await encryptedZip([{ name: 'inner.zip', data: inner, password: 'outer secret' }]);
  const buffer = await documentWithAttachment('docx', olePackage('bundle.zip', outer), 'oleObject1.bin');
  await page.goto('./?view=preview&lang=zh_CN');
  await page.locator('input[type=file]').setInputFiles({ name: 'parent.docx', mimeType: 'application/octet-stream', buffer });
  await page.locator('.filens-attachments summary').click();
  await page.getByRole('button', { name: 'oleObject1.bin', exact: true }).click();
  await expect(page.locator('.filens-attachment-navigation')).toContainText('bundle.zip');
  await page.locator('tr.archivev-row').filter({ hasText: 'inner.zip' }).click();
  const field = page.getByLabel('文档密码', { exact: true });
  await expect(field).toBeVisible();
  await field.fill('outer secret'); await field.press('Enter');
  await page.locator('tr.archivev-row').filter({ hasText: 'inside.txt' }).click();
  await expect(field).toHaveValue('');
  await expect(page.locator('.pptxv-password-filename')).toHaveText('inner.zip › inside.txt');
  await page.getByRole('button', { name: '取消', exact: true }).click();
  await expect(field).toHaveCount(0);
  await page.locator('tr.archivev-row').filter({ hasText: 'inside.txt' }).click();
  await field.fill('inner secret'); await field.press('Enter');
  await expect(page.locator('.archivev-entry-preview')).toContainText('Deeply nested document payload');
  await page.getByRole('button', { name: '返回文档', exact: true }).click();
  await expect(page.locator('section.docx').first()).toBeVisible();
  expect(errors).toEqual([]);
});

test('opens an encrypted ZIP embedded in a PDF', async ({ page }) => {
  const archive = await encryptedZip([{ name: 'notes.txt', data: Buffer.from('PDF embedded ZIP payload'), password: 'pdf zip' }]);
  await page.goto('./?view=preview&lang=zh_CN');
  await page.locator('input[type=file]').setInputFiles({ name: 'attachments.pdf', mimeType: 'application/pdf', buffer: pdfWithAttachment(archive) });
  await page.locator('.filens-attachments summary').click();
  await page.getByRole('button', { name: 'bundle.zip', exact: true }).click();
  await page.locator('tr.archivev-row').filter({ hasText: 'notes.txt' }).click();
  const field = page.getByLabel('文档密码', { exact: true });
  await expect(field).toBeVisible();
  await field.fill('pdf zip'); await field.press('Enter');
  await expect(page.locator('.archivev-entry-preview')).toContainText('PDF embedded ZIP payload');
  await page.getByRole('button', { name: '返回文档', exact: true }).click();
  await expect(page.locator('canvas.pdfv-page[data-rendered="true"]')).toBeVisible();
});

test('cancels an encrypted Office attachment and clears its prompt when replacing the parent', async ({ page }) => {
  const encrypted = await readFile('packages/converter-client/test/fixtures/password/agile.docx');
  const buffer = await documentWithAttachment('docx', encrypted, 'protected.docx');
  await page.goto('./?view=preview&lang=zh_CN');
  await page.locator('input[type=file]').setInputFiles({ name: 'parent.docx', mimeType: 'application/octet-stream', buffer });
  await page.locator('.filens-attachments summary').click();
  await page.getByRole('button', { name: 'protected.docx', exact: true }).click();
  const field = page.getByLabel('文档密码', { exact: true });
  await expect(field).toBeVisible();
  await field.fill('must be cleared');
  await page.getByRole('button', { name: '取消', exact: true }).click();
  await expect(page.locator('.filens-attachment-panel')).toHaveCount(0);
  await expect(page.locator('section.docx').first()).toBeVisible();
  await page.getByRole('button', { name: 'protected.docx', exact: true }).click();
  await expect(field).toHaveValue('');
  await page.locator('input[type=file]').setInputFiles({ name: 'replacement.txt', mimeType: 'text/plain', buffer: Buffer.from('Replaced the parent and attachment') });
  await expect(field).toHaveCount(0);
  await expect(page.locator('.wb-preview-stage')).toContainText('Replaced the parent and attachment');
  await expect(page.locator('.filens-attachment-panel')).toHaveCount(0);
});

test('downloads unsupported attachments without blocking the parent document', async ({ page }) => {
  const payload = Buffer.from([1, 2, 3, 0, 255]);
  const buffer = await documentWithAttachment('docx', payload, 'opaque.custom-file');
  await page.goto('./?view=preview&lang=zh_CN');
  await page.locator('input[type=file]').setInputFiles({ name: 'parent.docx', mimeType: 'application/octet-stream', buffer });
  await page.locator('.filens-attachments summary').click();
  await page.getByRole('button', { name: 'opaque.custom-file', exact: true }).click();
  await expect(page.locator('.filens-attachment-status')).toContainText('Unsupported preview format');
  const downloading = page.waitForEvent('download');
  await page.getByRole('button', { name: '下载附件', exact: true }).filter({ visible: true }).click();
  const download = await downloading;
  expect(download.suggestedFilename()).toBe('opaque.custom-file');
  expect(await readFile((await download.path())!)).toEqual(payload);
  await page.getByRole('button', { name: '返回文档', exact: true }).click();
  await expect(page.locator('section.docx').first()).toBeVisible();
});

test('downloads the original bytes of a corrupt OLE attachment and restores its parent', async ({ page }) => {
  const file = cfb.utils.cfb_new();
  cfb.utils.cfb_add(file, '\u0001Ole10Native', new Uint8Array([255, 255, 255, 255, 2, 0]));
  const payload = Buffer.from(cfb.write(file, { type: 'array' }));
  const buffer = await documentWithAttachment('docx', payload, 'broken.bin');
  await page.goto('./?view=preview&lang=zh_CN');
  await page.locator('input[type=file]').setInputFiles({ name: 'parent.docx', mimeType: 'application/octet-stream', buffer });
  await page.locator('.filens-attachments summary').click();
  await page.getByRole('button', { name: 'broken.bin', exact: true }).click();
  await expect(page.locator('.filens-attachment-status')).toContainText('truncated');
  const downloading = page.waitForEvent('download');
  await page.locator('.filens-attachment-navigation').getByRole('button', { name: '下载附件', exact: true }).click();
  const download = await downloading;
  expect(download.suggestedFilename()).toBe('broken.bin');
  expect(await readFile((await download.path())!)).toEqual(payload);
  await page.getByRole('button', { name: '返回文档', exact: true }).click();
  await expect(page.locator('section.docx').first()).toBeVisible();
});

async function splitFiles(format: '7z' | 'zip' = '7z') {
  const engine = await SevenZip({ print: () => {}, printErr: () => {} });
  engine.FS.writeFile('notes.txt', Buffer.from('Multipart archive preview payload'));
  engine.callMain(['a', `/bundle.${format}`, 'notes.txt', '-v80b', '-pvolume password', ...(format === '7z' ? ['-mhe=on'] : ['-mem=AES256']), '-bd']);
  return engine.FS.readdir('/').filter(name => name.startsWith(`bundle.${format}.`)).sort().map(name => ({
    name, mimeType: 'application/octet-stream', buffer: Buffer.from(engine.FS.readFile(`/${name}`))
  }));
}

for (const format of ['7z', 'zip'] as const) {
  test(`previews shuffled encrypted ${format} volumes selected together`, async ({ page }) => {
    const files = await splitFiles(format);
    await page.goto('./?view=preview&lang=zh_CN');
    await page.locator('input[type=file]').setInputFiles([...files].reverse());
    if (format === 'zip') await page.locator('tr.archivev-row').filter({ hasText: 'notes.txt' }).click();
    const field = page.getByLabel('文档密码', { exact: true });
    await expect(field).toBeVisible();
    await field.fill('wrong'); await field.press('Enter');
    await expect(page.getByRole('alert')).toContainText('密码不正确');
    await field.fill('volume password'); await field.press('Enter');
    if (format === '7z') await page.locator('tr.archivev-row').filter({ hasText: 'notes.txt' }).click();
    await expect(page.locator('.archivev-entry-preview')).toContainText('Multipart archive preview payload');
  });
}

for (const version of [4, 5]) {
  test(`previews real RAR ${version} volumes uploaded in reverse order`, async ({ page }) => {
    const { readdir } = await import('node:fs/promises');
    const root = 'packages/archive/test/fixtures/multivolume/';
    const names = (await readdir(root)).filter(name => version === 4 ? name.startsWith('test_rar_') : name.startsWith('test_read_')).sort().reverse();
    const files = await Promise.all(names.map(async name => ({ name, mimeType: 'application/vnd.rar', buffer: await readFile(root + name) })));
    await page.goto('./?view=preview&lang=zh_CN');
    await page.locator('input[type=file]').setInputFiles(files);
    const name = version === 4 ? 'LibarchiveAddingTest.html' : 'cebula.txt';
    await page.locator('tr.archivev-row').filter({ hasText: name }).click();
    await expect(page.locator('.archivev-entry-preview')).toBeVisible();
    await expect(page.locator('.archivev-entry-error')).toHaveCount(0);
    if (version === 4) await expect(page.locator('.archivev-entry-preview iframe')).toBeVisible();
    else await expect(page.locator('.archivev-entry-preview')).toContainText('Cebula');
  });
}

test('opens a split 7z nested in ZIP from any volume and returns to its parent', async ({ page }) => {
  const files = await splitFiles();
  const zip = new JSZip();
  for (const file of files) zip.file(`parts/${file.name}`, file.buffer);
  const buffer = await zip.generateAsync({ type: 'nodebuffer' });
  await page.goto('./?view=preview&lang=zh_CN');
  await page.locator('input[type=file]').setInputFiles({ name: 'outer.zip', mimeType: 'application/zip', buffer });
  await page.locator('tr.archivev-row').filter({ hasText: 'parts/' }).click();
  await page.locator('tr.archivev-row').filter({ hasText: files[files.length - 1].name }).click();
  const field = page.getByLabel('文档密码', { exact: true });
  await expect(field).toBeVisible();
  await field.fill('volume password'); await field.press('Enter');
  await page.locator('tr.archivev-row').filter({ hasText: 'notes.txt' }).click();
  await expect(page.locator('.archivev-entry-preview')).toContainText('Multipart archive preview payload');
  await page.getByRole('button', { name: 'Back to archive', exact: true }).click();
  await page.getByRole('button', { name: 'Back', exact: true }).click();
  await expect(page.locator('tr.archivev-row')).toContainText('parts/');
});

test('collects OLE-wrapped archive volumes embedded in a document', async ({ page }) => {
  const files = await splitFiles();
  const buffer = await documentWithAttachment('docx', olePackage(files[0].name, files[0].buffer), 'oleObject1.bin');
  const zip = await JSZip.loadAsync(buffer);
  for (const [index, file] of files.slice(1).entries()) zip.file(`word/embeddings/oleObject${index + 2}.bin`, olePackage(file.name, file.buffer));
  await page.goto('./?view=preview&lang=zh_CN');
  await page.locator('input[type=file]').setInputFiles({ name: 'volumes.docx', mimeType: 'application/octet-stream', buffer: await zip.generateAsync({ type: 'nodebuffer' }) });
  await page.locator('.filens-attachments summary').click();
  await page.getByRole('button', { name: 'oleObject2.bin', exact: true }).click();
  const field = page.getByLabel('文档密码', { exact: true });
  await expect(field).toBeVisible();
  await field.fill('volume password'); await field.press('Enter');
  await page.locator('tr.archivev-row').filter({ hasText: 'notes.txt' }).click();
  await expect(page.locator('.archivev-entry-preview')).toContainText('Multipart archive preview payload');
  await page.getByRole('button', { name: '返回文档', exact: true }).click();
  await expect(page.locator('section.docx').first()).toBeVisible();
});

test('reports a missing intermediate archive volume by filename', async ({ page }) => {
  const files = await splitFiles();
  await page.goto('./?view=preview&lang=zh_CN');
  await page.locator('input[type=file]').setInputFiles(files.filter((_, index) => index !== 1));
  await expect(page.getByRole('alert')).toContainText('bundle.7z.002');
});
