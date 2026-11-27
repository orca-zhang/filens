import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import JSZip from 'jszip';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

export async function readFixture(fileName: string): Promise<Uint8Array> {
  const buffer = await fs.readFile(path.join(ROOT, fileName));
  return new Uint8Array(buffer);
}

export async function repackageIworkFixture(source: Uint8Array, folder: string, nestedIndex: boolean): Promise<Uint8Array> {
  const original = await JSZip.loadAsync(source);
  const result = new JSZip();
  const root = folder ? result.folder(folder)! : result;
  const index = nestedIndex ? new JSZip() : root;
  for (const file of Object.values(original.files)) {
    if (!file.dir) (file.name.startsWith('Index/') ? index : root).file(file.name, await file.async('uint8array'));
  }
  if (nestedIndex) root.file('Index.zip', await index.generateAsync({ type: 'uint8array' }));
  return result.generateAsync({ type: 'uint8array' });
}
