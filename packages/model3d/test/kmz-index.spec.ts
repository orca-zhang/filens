import { describe, expect, it } from 'vitest';
import { createKmzIndex, findKmzResource } from '../src/kmz-resources';

describe('KMZ indexed path fallbacks', () => {
  it('keeps exact paths ahead of ambiguous case and suffix matches', () => {
    const index = createKmzIndex(['textures/a.png', 'Textures/A.PNG', 'nested/textures/a.png']);
    expect(findKmzResource(index, 'textures/a.png')).toBe('textures/a.png');
    expect(findKmzResource(index, 'Textures/A.PNG')).toBe('Textures/A.PNG');
    expect(findKmzResource(index, 'TEXTURES/a.png')).toBe('nested/textures/a.png');
    expect(findKmzResource(index, 'A.PNG')).toBeUndefined();
  });

  it('tracks uniqueness at every reversed path segment', () => {
    const index = createKmzIndex(['one/textures/a.png', 'two/other/a.png', 'two/b.png']);
    expect(findKmzResource(index, 'a.png')).toBeUndefined();
    expect(findKmzResource(index, 'textures/a.png')).toBe('one/textures/a.png');
    expect(findKmzResource(index, 'b.png')).toBe('two/b.png');
    expect(findKmzResource(index, 'res/a.png')).toBeUndefined();
    expect(findKmzResource(index, 'missing/a.png')).toBeUndefined();
  });

  it('normalizes duplicates before counting ambiguity and decodes only once', () => {
    const index = createKmzIndex(['one/./a.png', 'one/a.png', 'one/café.png', 'one/color%20.png']);
    expect(findKmzResource(index, '../a.png#x', 'one/model.dae')).toBe('one/a.png');
    expect(findKmzResource(index, 'CAF%C3%89.PNG?x=1')).toBe('one/café.png');
    expect(findKmzResource(index, 'color%2520.png')).toBe('one/color%20.png');
    for (const path of ['', '/', 'data:image/png;base64,AA', 'https://example.test/a.png']) {
      expect(findKmzResource(index, path)).toBeUndefined();
    }
  });

  it('agrees with linear fallbacks across mixed, ambiguous and missing paths', () => {
    const names = Array.from({ length: 160 }, (_, i) => `${i % 7}/textures/asset-${i % 43}.png`);
    names.push('A/TEXTURES/ASSET-1.PNG', 'folder/café.png', 'folder/bad%escape.png');
    const index = createKmzIndex(names);
    const linear = (href: string) => {
      const exact = index.get(href);
      if (exact) return exact;
      const same = [...index].filter(([name]) => name.toLowerCase() === href.toLowerCase());
      if (same.length === 1) return same[0]![1];
      const suffix = [...index].filter(([name]) => name.toLowerCase().endsWith('/' + href.toLowerCase()));
      return suffix.length === 1 ? suffix[0]![1] : undefined;
    };
    for (const path of [...names, ...names.map(s => s.toUpperCase()), ...names.map(s => s.slice(s.indexOf('/') + 1)), 'missing.png']) {
      expect(findKmzResource(index, path)).toBe(linear(path));
    }
  });
});
