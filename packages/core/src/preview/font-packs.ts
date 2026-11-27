import { fontsourceSubsetIndexes } from './font-subsets';
import type { PreviewFontAsset, PreviewFontPack, PreviewFontTraits } from './types';

const VERSION = '5.2.6';
const MIRRORS = ['https://cdn.jsdelivr.net/npm', 'https://unpkg.com'];
const LATIN: Array<readonly [number, number]> = [[0, 255], [305, 305], [338, 339], [699, 700], [710, 710], [730, 730], [732, 732], [772, 772], [776, 776], [809, 809], [8192, 8303], [8364, 8364], [8482, 8482], [8593, 8593], [8595, 8595], [8722, 8722], [8725, 8725], [65279, 65279], [65533, 65533]];

/** Small manifests only. Font files are fetched lazily, with pinned versions and mirrors. */
export function createWebFontPacks(options: { mirrors?: readonly string[] } = {}): PreviewFontPack[] {
  const mirrors = options.mirrors ?? MIRRORS;
  const definitions: Array<[
    id: string, family: string, subset: string, traits: PreviewFontTraits,
    release?: { version: string; weights: number[] }
  ]> = [
    ['carlito', 'Carlito', 'latin', { serif: false, script: 'latin' }],
    ['caladea', 'Caladea', 'latin', { serif: true, script: 'latin' }],
    ['arimo', 'Arimo', 'latin', { serif: false, script: 'latin' }],
    ['tinos', 'Tinos', 'latin', { serif: true, script: 'latin' }],
    ['cousine', 'Cousine', 'latin', { monospace: true, script: 'latin' }],
    ['noto-sans', 'Noto Sans', 'latin', { serif: false, script: 'latin' }],
    ['noto-serif', 'Noto Serif', 'latin', { serif: true, script: 'latin' }],
    ['noto-sans-mono', 'Noto Sans Mono', 'latin', { monospace: true, script: 'latin' }],
    ['noto-sans-sc', 'Noto Sans SC', 'chinese-simplified', { serif: false, script: 'cjk-sc' }],
    ['noto-sans-tc', 'Noto Sans TC', 'chinese-traditional', { serif: false, script: 'cjk-tc' }],
    ['noto-sans-jp', 'Noto Sans JP', 'japanese', { serif: false, script: 'japanese' }],
    ['noto-sans-kr', 'Noto Sans KR', 'korean', { serif: false, script: 'korean' }],
    ['noto-serif-sc', 'Noto Serif SC', 'chinese-simplified', { serif: true, script: 'cjk-sc' }],
    ['noto-serif-tc', 'Noto Serif TC', 'chinese-traditional', { serif: true, script: 'cjk-tc' }],
    ['noto-serif-jp', 'Noto Serif JP', 'japanese', { serif: true, script: 'japanese' }],
    ['noto-serif-kr', 'Noto Serif KR', 'korean', { serif: true, script: 'korean' }],
    ['noto-color-emoji', 'Noto Color Emoji', 'emoji', { style: 'symbol', script: 'emoji' }, { version: '5.3.2', weights: [400] }],
    ['noto-emoji', 'Noto Emoji', 'emoji', { style: 'symbol', script: 'emoji' }, { version: '5.3.2', weights: [400, 700] }],
    ['stix-two-math', 'STIX Two Math', 'latin', { style: 'text', script: 'math' }, { version: '5.3.0', weights: [400] }],
    ['noto-sans-math', 'Noto Sans Math', 'latin', { style: 'text', script: 'math' }, { version: '5.3.0', weights: [400] }]
  ];
  return definitions.map(([id, fontFamily, subset, traits, release]) => {
    const version = release?.version ?? VERSION;
    const packageName = `@fontsource/${id}@${version}`;
    const styles = traits.script === 'latin' && id !== 'noto-sans-mono' ? ['normal', 'italic'] : ['normal'];
    const source = (file: string) => mirrors.map(base => ({ url: `${base.replace(/\/$/, '')}/${packageName}/${file}` }));
    const subsetIndex = subset !== 'latin' ? {
      packageId: id, sources: source('unicode.json'), requiresSvg: id === 'noto-color-emoji'
    } : undefined;
    return {
      id, version, license: `https://cdn.jsdelivr.net/npm/${packageName}/LICENSE`,
      fonts: (release?.weights ?? [400, 700]).flatMap(weight => styles.map(style => {
        const asset: PreviewFontAsset = {
          id: `${id}-${subset}-${weight}-${style}`, fontFamily,
          traits: { style: 'text', monospace: false, stretch: 100, ...traits, weight },
          coverage: traits.script === 'latin' ? LATIN : undefined,
          descriptors: { weight: String(weight), style },
          sources: source(`files/${id}-${subset}-${weight}-${style}.woff2`)
        };
        if (subsetIndex) fontsourceSubsetIndexes.set(asset, subsetIndex);
        return asset;
      }))
    };
  });
}
