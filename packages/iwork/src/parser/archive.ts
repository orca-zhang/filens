import type { ZipEntry } from '@filens/core/zip';
import type {
  IworkArchiveDataEntry,
  IworkArchiveIndex,
  IworkArchiveRecord,
  IworkImageAsset,
  IworkType,
  IworkTypeHint
} from '../types';
import { decodeTypedMessage, getTypeName } from './protobuf';
import { deferRecordValue } from './helpers';
import { openIworkPackage } from './encryption';
import { detectIworkTypeFromZip } from './detect';
import type { IworkArchiveSource } from './load-source';
import { DOCUMENT_IWA_PATH, readIwaMessages, type IwaMessage } from './iwa';

interface IndexedArchivePackage {
  type: IworkType;
  archive: IworkArchiveIndex;
  zip: Map<string, ZipEntry>;
}

export interface LoadedArchivePackage extends IndexedArchivePackage {
  media: Record<string, IworkImageAsset>;
}

export interface ArchiveMediaEntry {
  file: ZipEntry;
  asset: Omit<IworkImageAsset, 'data'>;
}

export interface LoadArchivePackageOptions {
  sourceName?: string;
  password?: string;
  signal?: AbortSignal;
}

export async function loadArchivePackage(
  source: IworkArchiveSource,
  hint: IworkTypeHint = 'auto',
  options: LoadArchivePackageOptions = {}
): Promise<LoadedArchivePackage> {
  const indexed = await indexArchivePackage(source, hint, options);
  const media = await readArchiveMedia(indexArchiveMedia(indexed.zip, indexed.archive));
  return { ...indexed, media };
}

export async function indexArchivePackage(
  source: IworkArchiveSource,
  hint: IworkTypeHint = 'auto',
  options: LoadArchivePackageOptions = {}
): Promise<IndexedArchivePackage> {
  const zip = await openIworkPackage(source, options);
  const documentMessages: IwaMessage[] = [];
  const type = hint === 'auto'
    ? await detectIworkTypeFromZip(zip, options.signal, message => { documentMessages.push(message); })
    : hint;
  const archive = await decodeArchiveZip(zip, type, options, hint === 'auto' ? documentMessages : undefined);
  return { type, archive, zip };
}

async function decodeArchiveZip(
  zip: Map<string, ZipEntry>,
  type: IworkType,
  options: LoadArchivePackageOptions,
  documentMessages?: IwaMessage[]
): Promise<IworkArchiveIndex> {
  const records: Record<string, IworkArchiveRecord> = {};
  const warnings: string[] = [];
  const unsupportedRecordTypes = new Map<number, { count: number; examples: number[] }>();

  const iwaEntries = [...zip.keys()]
    .filter((name) => name.endsWith('.iwa'))
    // These are package paths, so use a deterministic code-unit order rather
    // than initializing locale-aware collation for each document.
    .sort();

  const visit = ({ archiveId, index, info, payload }: IwaMessage) => {
    const typeId = Number(info.type ?? 0);
    const typeName = getTypeName(type, typeId);
    if (!typeName) noteUnsupportedRecordType(unsupportedRecordTypes, typeId, archiveId);

    const nextRecord: IworkArchiveRecord = {
      id: archiveId,
      archiveId,
      messageIndex: index,
      typeId,
      typeName: typeName ?? `unknown:${typeId}`,
      value: null,
      objectReferences: info.objectReferences ?? [],
      dataReferences: info.dataReferences ?? []
    };
    if (typeName) {
      deferRecordValue(nextRecord, () => {
        try {
          return decodeTypedMessage(typeName, payload);
        } catch (error) {
          warnings.push(
            `Failed to decode iWork record ${archiveId} as ${typeName}: ${error instanceof Error ? error.message : String(error)}`
          );
          return null;
        }
      });
    }

    const existing = records[String(archiveId)];
    if (!existing || nextRecord.value != null) records[String(archiveId)] = nextRecord;
  };

  for (const entryName of iwaEntries) {
    options.signal?.throwIfAborted();
    if (entryName === DOCUMENT_IWA_PATH && documentMessages) {
      // Replay type detection's messages in ZIP path order for duplicate records.
      for (const message of documentMessages) visit(message);
      documentMessages.length = 0;
      continue;
    }
    const file = zip.get(entryName);
    if (file) await readIwaMessages(file, visit, { signal: options.signal });
  }

  const references = buildReferenceMaps(records);
  const packageMetadata = Object.values(records).find((record) => record.typeName === 'TSP.PackageMetadata')?.value;
  const dataEntries = normalizeDataEntries(packageMetadata, records);

  for (const [typeId, summary] of unsupportedRecordTypes.entries()) {
    const hint = summary.examples.length ? ` (e.g. archive ${summary.examples.slice(0, 3).join(', ')})` : '';
    warnings.push(`Unsupported iWork record type ${typeId} encountered ${summary.count} time${summary.count === 1 ? '' : 's'}.${hint}`.trim());
  }

  return {
    type,
    records,
    references,
    dataEntries,
    packageMetadata,
    sourceName: options.sourceName,
    warnings
  };
}

function noteUnsupportedRecordType(
  bucket: Map<number, { count: number; examples: number[] }>,
  typeId: number,
  archiveId: number
): void {
  if (!Number.isFinite(typeId) || typeId <= 0) {
    return;
  }
  const existing = bucket.get(typeId) ?? { count: 0, examples: [] };
  existing.count += 1;
  if (existing.examples.length < 6 && Number.isFinite(archiveId) && archiveId > 0 && !existing.examples.includes(archiveId)) {
    existing.examples.push(archiveId);
  }
  bucket.set(typeId, existing);
}

function buildReferenceMaps(records: Record<string, IworkArchiveRecord>): IworkArchiveIndex['references'] {
  const outgoing: Record<string, number[]> = {};
  const incoming: Record<string, number[]> = {};

  for (const record of Object.values(records)) {
    const refs = Array.from(new Set(record.objectReferences)).filter((value) => Number.isFinite(value) && value > 0);
    outgoing[String(record.id)] = refs;
    for (const ref of refs) {
      const key = String(ref);
      const bucket = incoming[key] ?? [];
      bucket.push(record.id);
      incoming[key] = bucket;
    }
  }

  return {
    outgoing,
    incoming
  };
}

function normalizeDataEntries(
  packageMetadata: unknown,
  records: Record<string, IworkArchiveRecord>
): Record<string, IworkArchiveDataEntry> {
  const entries: Record<string, IworkArchiveDataEntry> = {};
  const metadata = asObject(packageMetadata);
  if (!metadata) {
    return entries;
  }

  const metadataById = buildDataMetadataMap(metadata, records);
  const datas = asArray<Record<string, unknown>>(metadata.datas);
  for (const item of datas) {
    const id = Number(item.identifier ?? 0);
    if (!id) {
      continue;
    }

    const dataMetadata = metadataById[String(id)];
    const fileName = asOptionalString(item.fileName) ?? asOptionalString(dataMetadata?.displayName);
    const preferredFileName = asOptionalString(item.preferredFileName);
    const resolvedPath = resolveDataPath(item, dataMetadata);

    entries[String(id)] = {
      id,
      path: resolvedPath,
      preferredFileName,
      fileName,
      contentType: resolveContentType(resolvedPath || fileName || preferredFileName || '')
    };
  }

  return entries;
}

function resolveDataPath(item: Record<string, unknown>, dataMetadata?: Record<string, unknown>): string {
  const fileName = asOptionalString(item.fileName);
  if (fileName) {
    return `Data/${fileName}`;
  }
  const preferredFileName = asOptionalString(item.preferredFileName);
  if (preferredFileName) {
    return `Data/${preferredFileName}`;
  }

  const locatorPath = normalizeDataLocatorPath(asOptionalString(item.documentResourceLocator));
  if (locatorPath) {
    return locatorPath;
  }

  const appRelativePath = normalizeDataLocatorPath(asOptionalString(dataMetadata?.appRelativePath));
  if (appRelativePath) {
    return appRelativePath;
  }

  const displayName = asOptionalString(dataMetadata?.displayName);
  if (displayName) {
    return `Data/${displayName}`;
  }

  return '';
}

function buildDataMetadataMap(
  packageMetadata: Record<string, unknown>,
  records: Record<string, IworkArchiveRecord>
): Record<string, Record<string, unknown>> {
  const map: Record<string, Record<string, unknown>> = {};
  const entries = asArray<Record<string, unknown>>(readField(packageMetadata, ['dataMetadataEntries']));
  if (entries.length) {
    for (const entry of entries) {
      const id = Number(entry.dataIdentifier ?? 0);
      const metadata = resolveDataMetadataRecord(readField(entry, ['dataMetadata']), records);
      if (id && metadata) {
        map[String(id)] = metadata;
      }
    }
    return map;
  }

  const nestedMap = asObject(readField(packageMetadata, ['dataMetadataMap']));
  const nestedEntries = asArray<Record<string, unknown>>(readField(nestedMap, ['dataMetadataEntries']));
  for (const entry of nestedEntries) {
    const id = Number(entry.dataIdentifier ?? 0);
    const metadata = resolveDataMetadataRecord(readField(entry, ['dataMetadata']), records);
    if (id && metadata) {
      map[String(id)] = metadata;
    }
  }

  return map;
}

function resolveDataMetadataRecord(
  value: unknown,
  records: Record<string, IworkArchiveRecord>
): Record<string, unknown> | undefined {
  const inline = asObject(value);
  const identifier = Number(readField<number>(inline, ['identifier']) ?? 0);
  if (identifier) {
    return asObject(records[String(identifier)]?.value);
  }

  return inline;
}

function normalizeDataLocatorPath(value: string | undefined): string {
  if (!value) {
    return '';
  }

  const normalized = value.replace(/\\/g, '/').trim();
  if (!normalized) {
    return '';
  }

  if (normalized.startsWith('Data/')) {
    return normalized;
  }

  const slashIndex = normalized.indexOf('/');
  if (slashIndex >= 0) {
    const root = normalized.slice(0, slashIndex);
    if (root === 'Data' || root === 'Metadata' || root === 'Index') {
      return normalized;
    }
  }

  return `Data/${normalized.replace(/^\/+/, '')}`;
}

function asOptionalString(value: unknown): string | undefined {
  return typeof value === 'string' && value.length ? value : undefined;
}

function asObject(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : undefined;
}

function asArray<T = unknown>(value: unknown): T[] {
  return Array.isArray(value) ? (value as T[]) : [];
}

function readField<T = unknown>(value: Record<string, unknown> | undefined, keys: string[]): T | undefined {
  if (!value) {
    return undefined;
  }
  for (const key of keys) {
    if (key in value) {
      return value[key] as T;
    }
  }
  return undefined;
}

export function indexArchiveMedia(zip: Map<string, ZipEntry>, archive: IworkArchiveIndex): Map<string, ArchiveMediaEntry> {
  const media = new Map<string, ArchiveMediaEntry>();
  for (const entry of Object.values(archive.dataEntries)) {
    if (!entry.path) {
      continue;
    }

    const file = zip.get(entry.path);
    if (!file) {
      continue;
    }

    const id = String(entry.id);
    media.set(id, { file, asset: {
      id, path: entry.path, contentType: entry.contentType ?? 'application/octet-stream', role: resolveMediaRole(entry.path)
    } });
  }
  return media;
}

export async function readArchiveMedia(entries: ReadonlyMap<string, ArchiveMediaEntry>): Promise<Record<string, IworkImageAsset>> {
  const media: Record<string, IworkImageAsset> = {};
  for (const [id, entry] of entries) media[id] = await readMediaEntry(entry);
  return media;
}

export async function readMediaEntry({ file, asset }: ArchiveMediaEntry): Promise<IworkImageAsset> {
  return { ...asset, data: await file.bytes() };
}

function resolveMediaRole(path: string): IworkImageAsset['role'] {
  const normalized = path.toLowerCase();
  if (/\.(mp4|mov|m4v|webm)$/i.test(normalized)) {
    return 'video';
  }
  if (/\.(mp3|m4a|wav|aac)$/i.test(normalized)) {
    return 'audio';
  }
  return 'image';
}

function resolveContentType(path: string): string {
  const normalized = path.toLowerCase();
  if (normalized.endsWith('.png')) return 'image/png';
  if (normalized.endsWith('.jpg') || normalized.endsWith('.jpeg')) return 'image/jpeg';
  if (normalized.endsWith('.gif')) return 'image/gif';
  if (normalized.endsWith('.svg')) return 'image/svg+xml';
  if (normalized.endsWith('.heic')) return 'image/heic';
  if (normalized.endsWith('.tif') || normalized.endsWith('.tiff')) return 'image/tiff';
  if (normalized.endsWith('.webp')) return 'image/webp';
  if (normalized.endsWith('.mov')) return 'video/quicktime';
  if (normalized.endsWith('.mp4') || normalized.endsWith('.m4v')) return 'video/mp4';
  if (normalized.endsWith('.webm')) return 'video/webm';
  if (normalized.endsWith('.mp3')) return 'audio/mpeg';
  if (normalized.endsWith('.m4a')) return 'audio/mp4';
  if (normalized.endsWith('.wav')) return 'audio/wav';
  return 'application/octet-stream';
}

export const __private__ = {
  normalizeDataEntries
};
