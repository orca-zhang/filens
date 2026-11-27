import { normalizeFontFamilyName } from '../utils/fonts';

const ownedFaces = new WeakSet<FontFace>();

export const fontFamilyKey = (family?: string) => normalizeFontFamilyName(family ?? '').toLowerCase();

export function ownPreviewFontFace(face: FontFace): void { ownedFaces.add(face); }

export function readHostFontFamilies(fontSet: FontFaceSet | undefined): Set<string> {
  const families = new Set<string>();
  fontSet?.forEach?.(face => {
    if (face.status === 'loaded' && !ownedFaces.has(face)) families.add(fontFamilyKey(face.family));
  });
  return families;
}

export function observeHostFontLoads(fontSet: FontFaceSet | undefined, onLoad: (families: string[]) => void): () => void {
  const reported = new WeakSet<FontFace>();
  let stopped = false;
  fontSet?.forEach?.(face => { if (face.status === 'loaded') reported.add(face); });
  const report = (faces: readonly FontFace[]) => {
    if (stopped) return;
    const families = new Set<string>();
    for (const face of faces) {
      if (face.status !== 'loaded' || ownedFaces.has(face) || reported.has(face)) continue;
      reported.add(face);
      families.add(fontFamilyKey(face.family));
    }
    if (families.size) onLoad([...families]);
  };
  const done = (event: FontFaceSetLoadEvent) => report(event.fontfaces ?? []);
  const loading = () => {
    // WebKit can resolve ready for stylesheet faces without emitting loadingdone.
    void fontSet?.ready?.then(set => {
      const faces: FontFace[] = [];
      set.forEach(face => faces.push(face));
      report(faces);
    }).catch(() => {});
  };
  fontSet?.addEventListener?.('loading', loading);
  fontSet?.addEventListener?.('loadingdone', done);
  if (fontSet?.status === 'loading') loading();
  return () => {
    stopped = true;
    fontSet?.removeEventListener?.('loading', loading);
    fontSet?.removeEventListener?.('loadingdone', done);
  };
}
