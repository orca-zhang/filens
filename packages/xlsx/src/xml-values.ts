export function readPath(source: unknown, path: readonly string[]): unknown {
  for (const part of path) {
    if (!source || typeof source !== 'object') return undefined;
    source = (source as Record<string, unknown>)[part];
  }
  return source;
}

export function readLocalPath(value: unknown, segments: readonly string[]): unknown {
  for (const segment of segments) {
    if (!value || typeof value !== 'object') return undefined;
    const record = value as Record<string, unknown>;
    const key = Object.keys(record).find(key => key.split(':').pop() === segment);
    value = key ? record[key] : undefined;
  }
  return value;
}

export function toArray<T = unknown>(value: unknown): T[] {
  if (value == null) return [];
  return Array.isArray(value) ? (value as T[]) : [value as T];
}
