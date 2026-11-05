import type { PreviewResourceResolver, PreviewSource } from './types';

export interface FileSetResource {
  name: string;
  source: PreviewSource;
  path?: string;
  contentType?: string;
}

export interface FileSetResourceResolverOptions {
  root?: string;
}

export interface FileSetResourceIndex {
  resources: FileSetResource[];
  resolve: PreviewResourceResolver;
  read(name: string): FileSetResource | undefined;
}

export function createFileSetResourceIndex(
  resources: Iterable<FileSetResource | File | Blob>,
  options: FileSetResourceResolverOptions = {}
): FileSetResourceIndex {
  const normalizedResources = [...resources].map(normalizeFileSetResource);
  const root = normalizeResourcePath(options.root ?? '');
  const exact = new Map<string, FileSetResource>();
  const rooted = new Map<string, FileSetResource>();
  const basenameCandidates = new Map<string, FileSetResource | null>();
  const rootPrefix = root ? `${root}/` : '';

  for (const resource of normalizedResources) {
    const name = normalizeResourcePath(resource.name);
    const resourcePath = normalizeResourcePath(resource.path ?? '');
    for (const alias of resourcePath && resourcePath !== name ? [resourcePath, name] : [name]) {
      if (!alias) continue;
      exact.set(alias, resource);
      if (rootPrefix && alias.startsWith(rootPrefix)) {
        rooted.set(alias.slice(root.length + 1), resource);
      }
    }
    const basename = name.slice(name.lastIndexOf('/') + 1);
    if (basename) {
      basenameCandidates.set(basename, basenameCandidates.has(basename) ? null : resource);
    }
  }

  return {
    resources: normalizedResources,
    resolve: (request) => {
      const resource = findFileSetResource(request.source ?? request.name ?? '', exact, rooted, basenameCandidates);
      if (!resource) {
        return undefined;
      }
      return {
        source: resource.source
      };
    },
    read: (name) => findFileSetResource(name, exact, rooted, basenameCandidates)
  };
}

export function createFileSetResourceResolver(
  resources: Iterable<FileSetResource | File | Blob>,
  options: FileSetResourceResolverOptions = {}
): PreviewResourceResolver {
  return createFileSetResourceIndex(resources, options).resolve;
}

function normalizeFileSetResource(resource: FileSetResource | File | Blob): FileSetResource {
  if (resource instanceof Blob) {
    const file = resource as File;
    const name = typeof file.name === 'string' && file.name ? file.name : 'resource';
    return {
      name,
      path: typeof file.webkitRelativePath === 'string' ? file.webkitRelativePath : undefined,
      contentType: resource.type || undefined,
      source: resource
    };
  }
  return resource;
}

function findFileSetResource(
  name: string,
  exact: Map<string, FileSetResource>,
  rooted: Map<string, FileSetResource>,
  basename: Map<string, FileSetResource | null>
): FileSetResource | undefined {
  const normalized = normalizeResourcePath(name);
  if (!normalized) {
    return undefined;
  }
  return exact.get(normalized) ?? rooted.get(normalized) ?? basename.get(normalized.slice(normalized.lastIndexOf('/') + 1)) ?? undefined;
}

function normalizeResourcePath(path: string): string {
  const withoutSuffix = String(path ?? '')
    .trim()
    .replace(/\\/g, '/')
    .replace(/^[a-z]+:\/\/[^/]+\//i, '')
    .replace(/^[a-z]:\//i, '')
    .replace(/^\/+/, '')
    .split(/[?#]/)[0] ?? '';
  const parts: string[] = [];
  for (const part of withoutSuffix.split('/')) {
    if (!part || part === '.') {
      continue;
    }
    if (part === '..') {
      parts.pop();
      continue;
    }
    parts.push(decodeResourcePathPart(part));
  }
  return parts.join('/');
}

function decodeResourcePathPart(part: string): string {
  if (!part.includes('%')) return part;
  try {
    return decodeURIComponent(part);
  } catch {
    return part;
  }
}
