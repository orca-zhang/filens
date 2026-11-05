interface SuffixNode {
  children: Map<string, SuffixNode>;
  // null means that more than one normalized archive path has this suffix.
  value: string | null;
}

export class KmzResourceIndex extends Map<string, string> {
  private folded?: Map<string, string | null>;
  private suffixes?: SuffixNode;

  findFolded(path: string): string | undefined {
    if (!this.folded) {
      this.folded = new Map();
      for (const [name, original] of this) {
        const key = name.toLowerCase();
        this.folded.set(key, this.folded.has(key) ? null : original);
      }
    }
    return this.folded.get(path.toLowerCase()) ?? undefined;
  }

  findSuffix(path: string): string | undefined {
    if (!path) return undefined;
    if (!this.suffixes) {
      this.suffixes = { children: new Map(), value: null };
      for (const [name, original] of this) {
        const parts = name.toLowerCase().split('/');
        let node = this.suffixes;
        // Only proper suffixes: the old fallback requires a preceding slash.
        for (let i = parts.length - 1; i > 0; i--) {
          const part = parts[i]!;
          const child = node.children.get(part);
          if (child) {
            child.value = null;
            node = child;
          } else {
            const next: SuffixNode = { children: new Map(), value: original };
            node.children.set(part, next);
            node = next;
          }
        }
      }
    }
    const parts = path.toLowerCase().split('/');
    let node: SuffixNode | undefined = this.suffixes;
    for (let i = parts.length - 1; i >= 0; i--) {
      node = node.children.get(parts[i]!);
      if (!node) return undefined;
    }
    return node.value ?? undefined;
  }
}

function normalizeKmzPath(value: string): string {
  const parts: string[] = [];
  for (const part of value.replace(/\\/g, '/').split('/')) {
    if (!part || part === '.') continue;
    if (part === '..') parts.pop();
    else parts.push(part);
  }
  return parts.join('/');
}

export function createKmzIndex(names: string[]): KmzResourceIndex {
  return new KmzResourceIndex(names.map(name => [normalizeKmzPath(name), name]));
}

export function findKmzResource(index: KmzResourceIndex, href: string, relativeTo = ''): string | undefined {
  let path = href.trim().replace(/\\/g, '/').split(/[?#]/, 1)[0] ?? '';
  if (/^[a-z][a-z\d+.-]*:/i.test(path)) return undefined;
  try { path = decodeURIComponent(path); } catch { /* Preserve malformed producer escapes. */ }
  const directory = relativeTo.slice(0, relativeTo.lastIndexOf('/') + 1);
  const candidates = [...new Set([
    ...(path.startsWith('/') ? [] : [normalizeKmzPath(directory + path)]), normalizeKmzPath(path)
  ])];
  for (const candidate of candidates) {
    const exact = index.get(candidate);
    if (exact) return exact;
  }
  for (const candidate of candidates) {
    const folded = index.findFolded(candidate);
    if (folded !== undefined) return folded;
  }
  return index.findSuffix(candidates[candidates.length - 1]!);
}
