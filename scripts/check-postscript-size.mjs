import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { brotliCompressSync, constants, gzipSync } from 'node:zlib';
import { pathToFileURL } from 'node:url';

// Decimal MB. Check both encodings so gzip-only deployments also meet the cap.
export async function checkPostscriptSize() {
  const bytes = await readFile(new URL('../wasm/converter-core/dist/converter-postscript.wasm', import.meta.url));
  const sizes = { raw: bytes.length, gzip: gzipSync(bytes, { level: 9 }).length,
    brotli: brotliCompressSync(bytes, { params: { [constants.BROTLI_PARAM_QUALITY]: 11 } }).length };
  for (const encoding of ['gzip', 'brotli']) assert(sizes[encoding] <= 1_000_000,
    `PostScript ${encoding} download ${sizes[encoding]} exceeds 1 MB`);
  console.log(`PostScript WASM bytes: ${JSON.stringify(sizes)}; compressed limit: 1000000`);
  return sizes;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await checkPostscriptSize();
