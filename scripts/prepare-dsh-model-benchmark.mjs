import { mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { createColumnStyledWorkbookFixture } from '../packages/xlsx/test/fixtures/workbook.mjs';

const directory = new URL('../tmp/dsh-model-cache/', import.meta.url);
await mkdir(directory, { recursive: true });
const bytes = await createColumnStyledWorkbookFixture(12000, 8);
await writeFile(new URL('large.xlsx', directory), bytes);
console.log(`${fileURLToPath(directory)}large.xlsx: ${bytes.length} bytes, 96000 cells`);
