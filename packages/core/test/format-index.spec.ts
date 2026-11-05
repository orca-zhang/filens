import { describe, expect, it } from 'vitest';
import { createFormatRouteResolver, DEFAULT_FORMAT_ROUTES, inferExtensionFromName, resolveFormatRoute, type FormatDefinition } from '../src/preview/formats';
import { PreviewRegistry } from '../src/preview/registry';

describe('compiled format routing', () => {
  it.each([
    [' C:\\docs\\folder/file.PDF?download=/other.png#hash ', 'pdf'],
    ['/docs/?filename=other.png', undefined],
    ['file.md#anchor?download=.zip', 'md'],
    ['\\folder\\.ENV', 'env'],
    ['/folder/Dockerfile.prod?download=1', 'dockerfile'],
    ['/folder/ GNUmakefile ', 'make'],
    ['/folder/.hidden.JSON ', 'json'],
    ['/folder/bundle.7Z.001#part', '7z'],
    ['/folder/name.', undefined]
  ])('infers the final path segment before a query or fragment: %s', (name, expected) => {
    expect(inferExtensionFromName(name)).toBe(expected);
  });

  it('agrees with dynamic lookup for built-in extensions, MIME types and misses', () => {
    const resolve = createFormatRouteResolver(), registry = new PreviewRegistry();
    const descriptors = DEFAULT_FORMAT_ROUTES.flatMap(route => [
      ...route.extensions.flatMap(extension => [{ extension: `.${extension.toUpperCase()}` }, { name: `folder/file.${extension}?x=1` }]),
      ...(route.contentTypes ?? []).map(type => ({ contentType: `${type.toUpperCase()}; charset=utf-8` }))
    ]);
    descriptors.push({ name: 'unknown.xyz' }, { contentType: 'unknown/mime' }, { name: 'Dockerfile' });
    for (const descriptor of descriptors) {
      const expected = resolveFormatRoute(descriptor);
      expect(resolve(descriptor)).toEqual(expected);
      expect(registry.resolve(descriptor)?.route ?? null).toEqual(expected);
    }
  });

  it('keeps first-rule priority and extension-before-MIME semantics', () => {
    const routes: FormatDefinition[] = [
      { extensions: ['one', 'alias'], contentTypes: ['test/type'], family: 'text', driverId: 'first' },
      { extensions: ['one'], contentTypes: ['test/type'], family: 'image', driverId: 'second' }
    ];
    const resolve = createFormatRouteResolver(routes);
    expect(resolve({ extension: 'alias' })).toMatchObject({ sourceFormat: 'alias', targetFormat: 'alias', driverId: 'first' });
    expect(resolve({ contentType: 'test/type' })).toMatchObject({ sourceFormat: 'one', driverId: 'first' });
    expect(resolve({ extension: 'missing', contentType: 'test/type' })).toBeNull();
    expect(resolve({ extension: 'one' })).toMatchObject({ driverId: 'first' });
    routes[0]!.extensions.splice(0, 2, 'changed');
    expect(resolve({ extension: 'alias' })).toMatchObject({ driverId: 'first' });
    expect(resolveFormatRoute({ extension: 'alias' }, { routes })).toBeNull();
  });

  it('keeps custom registry route arrays live', () => {
    const routes: FormatDefinition[] = [{ extensions: ['one'], family: 'text', driverId: 'first' }];
    const registry = new PreviewRegistry({ routes });
    expect(registry.resolve({ extension: 'one' })?.route.driverId).toBe('first');
    routes.unshift({ extensions: ['one'], family: 'image', driverId: 'second' });
    expect(registry.resolve({ extension: 'one' })?.route.driverId).toBe('second');
    routes[0]!.extensions[0] = 'changed';
    expect(registry.resolve({ extension: 'one' })?.route.driverId).toBe('first');
  });
});
