/** Named files are kept separate: native RAR/ZIP volumes contain headers and
 * cannot be reconstructed by simply concatenating their bytes. */
export const ARCHIVE_VOLUME_LIMITS = { maxVolumes: 256, maxBytes: 512 * 1024 * 1024 } as const;

type VolumeName = {
  format: 'rar' | '7z' | 'zip';
  kind: 'rar-part' | 'rar-old' | 'numbered' | 'zip';
  key: string;
  base: string;
  index: number;
  width: number;
};

function parseVolumeName(name: string): VolumeName | undefined {
  let match = /^(.*\.part)(\d+)(\.rar)$/i.exec(name);
  if (match) return { format: 'rar', kind: 'rar-part', key: `${match[1]}*.rar`.toLowerCase(), base: match[1], index: Number(match[2]) - 1, width: match[2].length };
  match = /^(.*\.(7z|zip))\.(\d{3,})$/i.exec(name);
  if (match) return { format: match[2].toLowerCase() as '7z' | 'zip', kind: 'numbered', key: `${match[1]}.*`.toLowerCase(), base: match[1], index: Number(match[3]) - 1, width: match[3].length };
  match = /^(.*)\.([r-y])(\d{2})$/i.exec(name);
  if (match) return { format: 'rar', kind: 'rar-old', key: `${match[1]}.rar`.toLowerCase(), base: match[1], index: (match[2].toLowerCase().charCodeAt(0) - 114) * 100 + Number(match[3]) + 1, width: 2 };
  match = /^(.*)\.rar$/i.exec(name);
  if (match) return { format: 'rar', kind: 'rar-old', key: name.toLowerCase(), base: match[1], index: 0, width: 2 };
  match = /^(.*)\.z(\d{2,})$/i.exec(name);
  if (match) return { format: 'zip', kind: 'zip', key: `${match[1]}.zip`.toLowerCase(), base: match[1], index: Number(match[2]) - 1, width: match[2].length };
  match = /^(.*)\.zip$/i.exec(name);
  if (match) return { format: 'zip', kind: 'zip', key: name.toLowerCase(), base: match[1], index: Infinity, width: 2 };
}

export function isArchiveVolumeName(name: string): boolean {
  const parsed = parseVolumeName(name);
  return Boolean(parsed && (parsed.kind === 'numbered' || parsed.kind === 'rar-part' || !/\.(rar|zip)$/i.test(name)));
}

export interface ArchiveVolumeSet<T> { format: 'rar' | '7z' | 'zip'; primary: T; files: T[] }

/** Select a single family in the same directory, regardless of picker order.
 * A lone normal .rar/.zip remains a normal archive. Missing first/intermediate
 * parts are reported before loading any bytes. The engine validates the tail. */
export function selectArchiveVolumes<T extends { name: string }>(name: string, candidates: readonly T[]): ArchiveVolumeSet<T> | undefined {
  const selected = parseVolumeName(name);
  if (!selected) return;
  const parts = candidates.flatMap(file => {
    const info = parseVolumeName(file.name);
    return info?.key === selected.key && info.kind === selected.kind ? [{ file, info }] : [];
  }).sort((a, b) => a.info.index - b.info.index);
  if (!parts.length || (parts.length === 1 && !isArchiveVolumeName(name))) return;
  if (parts.length > ARCHIVE_VOLUME_LIMITS.maxVolumes) throw new Error('Archive contains too many volumes.');
  const seen = new Set<number>();
  for (const { info } of parts) {
    if (seen.has(info.index)) throw new Error('Duplicate archive volume numbers.');
    if (info.index < 0 || (!Number.isSafeInteger(info.index) && !(info.kind === 'zip' && info.index === Infinity))) throw new Error('Invalid archive volume number.');
    seen.add(info.index);
  }
  const numbered = parts.filter(part => part.info.index !== Infinity);
  for (let i = 0; i < numbered.length; i++) {
    if (numbered[i].info.index === i) continue;
    throw new Error(`Missing archive volume: ${volumeFilename(selected, i)}. Select all parts of the archive.`);
  }
  if (selected.kind === 'zip' && !parts.some(part => part.info.index === Infinity)) {
    throw new Error(`Missing archive volume: ${selected.base}.zip. Select all parts of the archive.`);
  }
  const primary = selected.kind === 'zip' ? parts[parts.length - 1].file : parts[0].file;
  return { format: selected.format, primary, files: [primary, ...parts.map(part => part.file).filter(file => file !== primary)] };
}

function volumeFilename(info: VolumeName, index: number): string {
  if (info.kind === 'rar-part') return `${info.base}${String(index + 1).padStart(info.width, '0')}.rar`;
  if (info.kind === 'numbered') return `${info.base}.${String(index + 1).padStart(info.width, '0')}`;
  if (info.kind === 'zip') return `${info.base}.z${String(index + 1).padStart(info.width, '0')}`;
  return index === 0 ? `${info.base}.rar` : `${info.base}.${String.fromCharCode(114 + Math.floor((index - 1) / 100))}${String((index - 1) % 100).padStart(2, '0')}`;
}
