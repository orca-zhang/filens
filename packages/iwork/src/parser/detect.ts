import type { ZipEntry } from '@filens/core/zip';
import type { DetectIworkTypeOptions, IworkSource, IworkType } from '../types';
import { loadIworkPackageSource } from './load-source';
import { openIworkPackage } from './encryption';
import { DOCUMENT_IWA_PATH, readIwaMessages, type IwaMessage } from './iwa';

const EXTENSION_MAP: Record<string, IworkType> = {
  '.key': 'key',
  '.pages': 'pages',
  '.numbers': 'numbers'
};

export async function detectIworkType(source: IworkSource, options: DetectIworkTypeOptions = {}): Promise<IworkType> {
  if (options.hint && options.hint !== 'auto') {
    return options.hint;
  }

  const byName = detectIworkTypeByName(source);
  if (byName) {
    return byName;
  }

  const input = await loadIworkPackageSource(source, options);
  return detectIworkTypeFromZip(await openIworkPackage(input, options), options.signal);
}

export async function detectIworkTypeFromZip(zip: Map<string, ZipEntry>, signal?: AbortSignal,
  onDocumentMessage?: (message: IwaMessage) => void): Promise<IworkType> {
  const entryNames = [...zip.keys()];

  const byArchiveTypes = await detectIworkTypeByArchiveTypes(zip, signal, onDocumentMessage);
  if (byArchiveTypes) {
    return byArchiveTypes;
  }

  if (entryNames.some((entry) => /^Index\/MasterSlide-/i.test(entry))) {
    return 'key';
  }

  if (entryNames.some((entry) => /^Index\/Tables\//i.test(entry))) {
    if (entryNames.some((entry) => /^Metadata\//i.test(entry))) {
      return 'numbers';
    }
    return 'pages';
  }

  if (entryNames.some((entry) => /^Metadata\//i.test(entry))) {
    return 'key';
  }

  throw new Error('Unable to detect iWork document type. Pass an explicit type hint.');
}

export function detectIworkTypeByName(source: IworkSource): IworkType | null {
  if (typeof source === 'string') {
    return detectIworkTypeFromPath(source);
  }

  if (typeof File !== 'undefined' && source instanceof File) {
    return detectIworkTypeFromPath(source.name);
  }

  return null;
}

function detectIworkTypeFromPath(path: string): IworkType | null {
  const normalized = path.toLowerCase().split('?')[0].split('#')[0];
  for (const [extension, type] of Object.entries(EXTENSION_MAP)) {
    if (normalized.endsWith(extension)) {
      return type;
    }
  }
  return null;
}

async function detectIworkTypeByArchiveTypes(zip: Map<string, ZipEntry>, signal?: AbortSignal,
  onDocumentMessage?: (message: IwaMessage) => void): Promise<IworkType | null> {
  const file = zip.get(DOCUMENT_IWA_PATH);
  if (!file) {
    return null;
  }

  const seenTypes = new Set<number>();
  await readIwaMessages(file, message => {
    if (typeof message.info.type === 'number') seenTypes.add(message.info.type);
    onDocumentMessage?.(message);
  }, { signal, readPayload: Boolean(onDocumentMessage) });
  const typeIds = [...seenTypes];
  if (typeIds.some((typeId) => typeId >= 10000 && typeId < 11000)) {
    return 'pages';
  }
  if (typeIds.some((typeId) => typeId >= 12000 || typeId === 3061 || typeId === 6030 || typeId === 6316)) {
    return 'numbers';
  }
  if (typeIds.some((typeId) => typeId === 2 || (typeId >= 4 && typeId <= 148))) {
    return 'key';
  }
  return null;
}
