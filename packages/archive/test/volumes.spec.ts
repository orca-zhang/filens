import { describe, expect, it } from 'vitest';
import { isArchiveVolumeName, selectArchiveVolumes } from '../src/volumes';
const files = (...names: string[]) => names.map(name => ({ name }));

describe('archive volume selection', () => {
  it.each([
    ['b.part02.rar', ['b.part03.rar', 'b.part02.rar', 'b.part01.rar'], 'b.part01.rar', 'rar'],
    ['b.7z.003', ['b.7z.003', 'b.7z.001', 'b.7z.002'], 'b.7z.001', '7z'],
    ['b.zip.002', ['b.zip.002', 'b.zip.001'], 'b.zip.001', 'zip'],
    ['b.r00', ['b.r01', 'b.rar', 'b.r00'], 'b.rar', 'rar'],
    ['b.z01', ['b.z02', 'b.z01', 'b.zip'], 'b.zip', 'zip']
  ])('selects the primary part from %s in arbitrary picker order', (selected, names, primary, format) => {
    const set = selectArchiveVolumes(selected, files(...names))!;
    expect(set.format).toBe(format);
    expect(set.primary.name).toBe(primary);
    expect(set.files).toHaveLength(names.length);
    expect(set.files[0]).toBe(set.primary);
  });
  it('keeps different archive families and directories apart and handles extension casing', () => {
    const set = selectArchiveVolumes('docs/Bundle.7z.001', files('docs/Bundle.7z.001', 'docs/BUNDLE.7Z.002', 'other/Bundle.7z.002', 'docs/other.7z.001'))!;
    expect(set.files.map(part => part.name)).toEqual(['docs/Bundle.7z.001', 'docs/BUNDLE.7Z.002']);
  });
  it.each([
    ['b.part02.rar', ['b.part02.rar'], 'b.part01.rar'],
    ['b.7z.001', ['b.7z.001', 'b.7z.003'], 'b.7z.002'],
    ['b.r00', ['b.r00'], 'b.rar'],
    ['b.z01', ['b.z01'], 'b.zip'],
    ['b.zip', ['b.zip', 'b.z02'], 'b.z01']
  ])('reports the missing part of %s', (selected, names, missing) => {
    expect(() => selectArchiveVolumes(selected, files(...names))).toThrow(missing);
  });
  it('rejects duplicate volume numbers and excess parts', () => {
    expect(() => selectArchiveVolumes('b.part1.rar', files('b.part1.rar', 'b.part01.rar'))).toThrow('Duplicate');
    expect(() => selectArchiveVolumes('b.7z.001', files(...Array.from({ length: 257 }, (_, i) => `b.7z.${String(i + 1).padStart(3, '0')}`)))).toThrow('too many');
  });
  it('leaves regular files and single ZIP/RAR archives alone', () => {
    for (const name of ['b.rar', 'b.zip', 'b.7z', 'notes.txt']) expect(selectArchiveVolumes(name, files(name))).toBeUndefined();
    expect(isArchiveVolumeName('b.7z.001')).toBe(true);
    expect(isArchiveVolumeName('b.rar')).toBe(false);
  });
});
