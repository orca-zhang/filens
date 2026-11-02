import type { SevenZipModuleFactory } from './engine';
import { ARCHIVE_VOLUME_LIMITS, isArchiveVolumeName } from '../volumes';

export interface SevenZipEntry {
  path: string;
  directory: boolean;
  size: number;
  modified?: number;
  encrypted: boolean;
}

export interface SevenZipRequest {
  bytes: Uint8Array;
  format: 'rar' | '7z' | 'zip';
  name?: string;
  volumes?: readonly { name: string; bytes: Uint8Array }[];
  password?: string;
  entry?: SevenZipEntry;
  maxEntries: number;
  maxEntryBytes: number;
  wasmUrl?: string;
  wasmModule?: WebAssembly.Module;
}

export interface SevenZipResult { entries?: SevenZipEntry[]; bytes?: Uint8Array }

export class SevenZipError extends Error {
  constructor(message: string, public readonly code?: 'password_required' | 'password_invalid') { super(message); }
}

/** One engine per operation: terminating its worker releases its FS, passwords,
 * solid decompression buffers and any partially extracted output together. */
export async function runSevenZip(request: SevenZipRequest, factory: SevenZipModuleFactory): Promise<SevenZipResult> {
  const name = request.name?.toLowerCase() ?? 'input.archive';
  const files = [{ name, bytes: request.bytes }, ...(request.volumes ?? []).map(file => ({ ...file, name: file.name.toLowerCase() }))];
  if (files.length > ARCHIVE_VOLUME_LIMITS.maxVolumes) throw new Error('Archive contains too many volumes.');
  if (files.reduce((sum, file) => sum + file.bytes.byteLength, 0) > ARCHIVE_VOLUME_LIMITS.maxBytes) throw new Error('Archive volumes exceed the preview input size limit.');
  const names = new Set<string>();
  for (const file of files) {
    if (!file.name || /[/\\\u0000-\u001f\u007f]/.test(file.name) || file.name === '.' || file.name === '..' || names.has(file.name)) throw new Error('Invalid or duplicate archive volume filename.');
    names.add(file.name);
  }
  const extracting = request.entry !== undefined;
  if (request.entry?.encrypted && request.password === undefined) throw new SevenZipError('Archive entry requires a password.', 'password_required');
  if (request.entry && (request.entry.size > request.maxEntryBytes || request.entry.size < 0)) throw new Error('Attachment exceeds the preview size limit.');
  const limit = extracting ? request.entry!.size : 16 * 1024 * 1024;
  const chunks: Uint8Array[] = [];
  let chunk = new Uint8Array(65536), used = 0, total = 0, stderr = '', requestedInput = false;
  let outputError: Error | undefined;
  const engine = await factory({
    ...(request.wasmUrl ? { locateFile: () => request.wasmUrl! } : {}),
    ...(request.wasmModule ? { instantiateWasm(imports: WebAssembly.Imports, receive: (instance: WebAssembly.Instance, module: WebAssembly.Module) => void) {
      const instance = new WebAssembly.Instance(request.wasmModule!, imports);
      receive(instance, request.wasmModule!);
      return instance.exports;
    } } : {}),
    stdin: () => { requestedInput = true; return null as unknown as number; },
    stdout(value) {
      if (value === null) return;
      if (++total > limit) {
        outputError = new Error('Expanded archive exceeds the preview size limit.');
        throw outputError;
      }
      chunk[used++] = value;
      if (used === chunk.length) { chunks.push(chunk); chunk = new Uint8Array(65536); used = 0; }
    },
    stderr(value) { if (value !== null && stderr.length < 65536) stderr += String.fromCharCode(value); }
  });
  engine.FS.mkdir('/archive');
  for (const file of files) engine.FS.writeFile(`/archive/${file.name}`, file.bytes);
  // -so never materializes archive paths or links. -spd and -r- prevent glob
  // expansion and recursive matches. The include switch treats leading @ and -
  // in a filename literally, rather than as list files or command switches.
  const archiveType = /\.(7z|zip)\.\d{3,}$/.test(name) ? `${request.format}.split`
    : request.format === 'rar' && request.bytes[6] === 1 ? 'rar5' : request.format;
  const args = [extracting ? 'x' : 'l', `/archive/${name}`, `-t${archiveType}`, '-bd', '-bsp0', '-sccUTF-8',
    ...(request.password === undefined ? [] : [`-p${request.password}`]),
    ...(extracting ? ['-so', '-bso0', '-bse2', '-spd', '-r-', `-i!${request.entry!.path}`] : ['-slt', '-ba'])];
  let status: number | undefined;
  let failure: unknown;
  try { status = engine.callMain(args) as unknown as number; }
  catch (error) { failure = error; }
  if (outputError) throw outputError;
  if (failure !== undefined || status !== 0) {
    // The upstream Emscripten build throws a numeric C++ exception when header
    // decryption fails. Missing passwords are also observable through stdin.
    const passwordFailure = requestedInput || /wrong password|password is incorrect|encrypted file/i.test(stderr) ||
      (typeof failure === 'number' && request.password !== undefined &&
        ((!extracting && request.format !== 'zip') || request.entry?.encrypted));
    if (passwordFailure) throw new SevenZipError('Unable to decrypt archive.', request.password === undefined ? 'password_required' : 'password_invalid');
    if (request.volumes?.length || isArchiveVolumeName(name) || (request.format === 'rar' && status === 2) || /missing volume|cannot find volume/i.test(stderr)) {
      throw new SevenZipError('Archive volumes are missing or damaged. Select all parts of this archive.');
    }
    throw new SevenZipError(stderr.trim() || 'The archive is damaged or uses an unsupported compression method.');
  }
  chunks.push(chunk.subarray(0, used));
  const output = new Uint8Array(total);
  let offset = 0;
  for (const part of chunks) { output.set(part, offset); offset += part.length; }
  if (extracting) {
    if (total !== request.entry!.size) throw new Error('Archive entry size does not match its metadata.');
    return { bytes: output };
  }
  return { entries: parseSevenZipListing(new TextDecoder().decode(output), request.maxEntries) };
}

function parseSevenZipListing(listing: string, maxEntries: number): SevenZipEntry[] {
  const entries: SevenZipEntry[] = [], paths = new Set<string>();
  for (const block of listing.split(/\r?\n\r?\n/)) {
    if (!block.trim()) continue;
    const fields = new Map<string, string>();
    for (const line of block.split(/\r?\n/)) {
      const separator = line.indexOf(' = ');
      if (separator < 0 || fields.has(line.slice(0, separator))) throw new Error('Unsupported archive entry metadata.');
      fields.set(line.slice(0, separator), line.slice(separator + 3));
    }
    const path = fields.get('Path');
    if (!path || /[\u0000-\u001f\u007f]/.test(path) || paths.has(path)) throw new Error('Unsupported or duplicate archive entry name.');
    paths.add(path);
    if (paths.size > maxEntries) throw new Error('Archive contains too many entries.');
    // Links are never followed or exposed as ordinary files.
    if (fields.get('Symbolic Link') || fields.get('Hard Link') || fields.get('Copy Link') ||
        /(?:^|\s)l[rwx-]{9}/.test(fields.get('Attributes') ?? '')) continue;
    const size = Number(fields.get('Size'));
    if (!Number.isSafeInteger(size) || size < 0) throw new Error('Invalid archive entry size.');
    const directory = fields.get('Folder') === '+' || /^D/.test(fields.get('Attributes') ?? '');
    const modified = Date.parse((fields.get('Modified') ?? '').replace(' ', 'T'));
    entries.push({ path, directory, size, encrypted: fields.get('Encrypted') === '+', modified: Number.isFinite(modified) ? modified : undefined });
  }
  return entries;
}
