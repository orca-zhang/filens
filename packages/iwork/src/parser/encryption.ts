import { openUnencryptedZipArchive, PreviewPasswordError, type ZipEntry } from '@filens/core/zip';
import { DOCUMENT_IWA_PATH } from './iwa';
import type { IworkArchiveSource } from './load-source';

const verifierName = '.iwpv2';
const blockSize = 16;
const maxIterations = 1_000_000;

export async function openIworkPackage(source: IworkArchiveSource, { password, signal }: { password?: string; signal?: AbortSignal } = {}): Promise<Map<string, ZipEntry>> {
  const zip = unwrapPackageFolder(await openUnencryptedZipArchive(source, { signal }));
  const verifier = zip.get(verifierName);
  if (!verifier) {
    if (zip.has('.iwph')) throw new Error('The iWork encryption verifier is missing.');
    await readNestedIndex(zip, signal);
    return zip;
  }
  if (verifier.size !== undefined && verifier.size !== 104) throw new Error('The iWork encryption verifier is damaged.');
  const header = await verifier.bytes();
  if (header.length !== 104) throw new Error('The iWork encryption verifier is damaged.');
  const view = new DataView(header.buffer, header.byteOffset, header.byteLength);
  if (view.getUint16(0, true) !== 2 || view.getUint16(2, true) !== 1) {
    throw new Error('This iWork encryption format is unsupported.');
  }
  const iterations = view.getUint32(4, true);
  if (!iterations || iterations > maxIterations) throw new Error('The iWork key derivation count is outside the supported range.');
  if (password === undefined) throw new PreviewPasswordError('password_required');
  if (!password) throw new PreviewPasswordError('password_invalid');
  const subtle = globalThis.crypto?.subtle;
  if (!subtle) throw new Error('Encrypted iWork preview requires Web Crypto.');
  const key = await verifyPassword(subtle, header, iterations, password, signal);

  await readNestedIndex(zip, signal);
  for (const [name, entry] of zip) {
    if (entry.directory || !(name.endsWith('.iwa') || name.startsWith('Data/') || name === 'Metadata/BuildVersionHistory.plist')) continue;
    const read = async () => {
      const raw = await entry.bytes();
      const ciphertext = raw.subarray(blockSize, -20);
      if (ciphertext.length < 2 * blockSize || ciphertext.length % blockSize) throw damagedEntry(name);
      // ZIP entries can be views into the package. Copy only if Web Crypto cannot read the backing buffer.
      const input = ciphertext.buffer instanceof ArrayBuffer
        ? new Uint8Array(ciphertext.buffer, ciphertext.byteOffset, ciphertext.byteLength) : ciphertext.slice();
      let decoded: Uint8Array;
      try { decoded = new Uint8Array(await subtle.decrypt({ name: 'AES-CBC', iv: raw.slice(0, blockSize) }, key, input)); }
      catch { throw damagedEntry(name); }
      signal?.throwIfAborted();
      if (decoded.length < blockSize) throw damagedEntry(name);
      return decoded.subarray(blockSize);
    };
    // The outer ZIP stream contains ciphertext. Snappy consumes the decrypted bytes.
    zip.set(name, { ...entry, chunks: undefined, bytes: read, text: async () => new TextDecoder().decode(await read()) });
  }
  return zip;
}

function unwrapPackageFolder(zip: Map<string, ZipEntry>): Map<string, ZipEntry> {
  if (zip.has(DOCUMENT_IWA_PATH) || zip.has('Index.zip')) return zip;
  let root: string | undefined;
  for (const [name, entry] of zip) {
    const separator = name.indexOf('/');
    if (entry.directory || separator < 1) continue;
    const relative = name.slice(separator + 1);
    if (relative !== DOCUMENT_IWA_PATH && relative !== 'Index.zip') continue;
    const prefix = name.slice(0, separator + 1);
    if (root && root !== prefix) throw new Error('The ZIP contains multiple iWork package folders.');
    root = prefix;
  }
  if (!root) return zip;
  const packageEntries = new Map<string, ZipEntry>();
  for (const [name, entry] of zip) {
    if (name.length <= root.length || !name.startsWith(root)) continue;
    const relative = name.slice(root.length);
    packageEntries.set(relative, { ...entry, name: relative });
  }
  return packageEntries;
}

async function readNestedIndex(zip: Map<string, ZipEntry>, signal?: AbortSignal): Promise<void> {
  if (zip.has(DOCUMENT_IWA_PATH)) return;
  const index = zip.get('Index.zip');
  if (!index) return;
  const entries = await openUnencryptedZipArchive(await index.bytes(undefined, signal), { signal });
  if (!entries.has(DOCUMENT_IWA_PATH)) throw new Error('The iWork Index.zip is missing Index/Document.iwa.');
  for (const [name, entry] of entries) if (name.startsWith('Index/')) zip.set(name, entry);
}

async function verifyPassword(subtle: SubtleCrypto, header: Uint8Array, iterations: number, password: string, signal?: AbortSignal): Promise<CryptoKey> {
  const encoded = new TextEncoder().encode(password);
  let passwordKey: CryptoKey;
  try { passwordKey = await subtle.importKey('raw', encoded, 'PBKDF2', false, ['deriveKey']); }
  finally { encoded.fill(0); }
  signal?.throwIfAborted();
  const key = await subtle.deriveKey(
    { name: 'PBKDF2', hash: 'SHA-1', salt: header.slice(8, 24), iterations }, passwordKey,
    { name: 'AES-CBC', length: 128 }, false, ['encrypt', 'decrypt']
  );
  signal?.throwIfAborted();

  // The verifier has no PKCS#7 padding. Append an encrypted padding block for Web Crypto to remove.
  const ciphertext = new Uint8Array(80);
  ciphertext.set(header.subarray(40));
  const padding = await subtle.encrypt({ name: 'AES-CBC', iv: header.slice(88, 104) }, key, new Uint8Array());
  ciphertext.set(new Uint8Array(padding), 64);
  const decoded = new Uint8Array(await subtle.decrypt({ name: 'AES-CBC', iv: header.slice(24, 40) }, key, ciphertext));
  try {
    const digest = new Uint8Array(await subtle.digest('SHA-256', decoded.subarray(0, 32)));
    signal?.throwIfAborted();
    if (digest.some((byte, index) => byte !== decoded[32 + index])) throw new PreviewPasswordError('password_invalid');
    return key;
  } finally { decoded.fill(0); }
}

function damagedEntry(name: string): Error { return new Error(`An encrypted iWork package entry is damaged: ${name}`); }
