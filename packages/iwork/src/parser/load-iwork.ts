import type { IworkSource, LoadIworkOptions, ParsedIworkDocument } from '../types';
import { loadIworkPackageSource } from './load-source';
import { detectIworkTypeByName } from './detect';
import { loadArchivePackage } from './archive';
import { buildParsedDocument } from './semantic';

export async function loadIwork(source: unknown, options: LoadIworkOptions = {}): Promise<ParsedIworkDocument> {
  const input = await loadIworkPackageSource(source as IworkSource, options);
  const hint = options.hint && options.hint !== 'auto' ? options.hint : detectIworkTypeByName(source as IworkSource) ?? 'auto';
  const archivePackage = await loadArchivePackage(input, hint, {
    ...options,
    sourceName: options.sourceName ?? resolveSourceName(source)
  });
  return buildParsedDocument({
    archive: archivePackage.archive,
    media: archivePackage.media
  });
}

function resolveSourceName(source: unknown): string | undefined {
  if (typeof source === 'string') {
    return extractSourceName(source);
  }

  if (typeof File !== 'undefined' && source instanceof File) {
    return source.name;
  }

  return undefined;
}

function extractSourceName(path: string): string | undefined {
  const normalized = path.split('?')[0]?.split('#')[0] ?? '';
  const segments = normalized.split(/[\\/]/).filter(Boolean);
  const fileName = segments.at(-1);
  if (!fileName) {
    return undefined;
  }

  try {
    return decodeURIComponent(fileName);
  } catch {
    return fileName;
  }
}
