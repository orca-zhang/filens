import type { SlideTransition } from '@filens/core/presentation-support';
import { childElements, children, slideRoot, type OrderedXmlNode, type XmlElement } from './xml';

const compatibility = 'http://schemas.openxmlformats.org/markup-compatibility/2006';
const officeExtensions = 'http://schemas.microsoft.com/office/powerpoint/';
const office2010 = officeExtensions + '2010/main';
const milliseconds = { h: 3_600_000, min: 60_000, s: 1000, ms: 1, 'µs': 0.001, ns: 0.000001 };

export function readSlideTransition(xml: OrderedXmlNode | null): SlideTransition | undefined {
  const slide = slideRoot(xml);
  if (!slide) return undefined;
  const direct = children(slide, 'transition')[0];
  if (direct) return parseTransition(direct);
  for (const alternate of children(slide, 'AlternateContent', [compatibility])) {
    const choice = children(alternate, 'Choice').find(child => {
      const requires = child.attributes.Requires;
      return typeof requires === 'string' && requires.trim().split(/\s+/).every(prefix =>
        child.bindings.get(prefix)?.startsWith(officeExtensions));
    });
    const fallbackBranch = children(alternate, 'Fallback')[0];
    const find = (branch?: XmlElement) => branch && children(branch, 'transition', [slide.namespace])[0];
    const main = find(choice), fallback = find(fallbackBranch);
    if (main) return { ...parseTransition(main), ...(fallback ? { fallback: parseTransition(fallback) } : {}) };
    if (fallback) return parseTransition(fallback);
  }
}

function parseTransition(transition: XmlElement): Omit<SlideTransition, 'fallback'> {
  const effect = childElements(transition).find(child => child.name !== 'sndAc' && child.name !== 'extLst' &&
    (child.namespace === transition.namespace || child.namespace?.startsWith(officeExtensions)));
  const { advClick, advTm, spd } = transition.attributes;
  const duration = Object.entries(transition.attributes).find(([key]) =>
    key.endsWith(':dur') && transition.bindings.get(key.slice(0, -4)) === office2010)?.[1];
  const match = typeof duration === 'string' && /^(\d+(?:\.\d+)?)(h|min|s|ms|µs|ns)?$/.exec(duration.trim());
  const durationMs = match ? Number(match[1]) * milliseconds[(match[2] ?? 'ms') as keyof typeof milliseconds] : undefined;
  const advanceAfterMs = typeof advTm === 'string' && /^\+?\d+$/.test(advTm.trim()) ? Number(advTm) : undefined;
  const throughBlack = effect?.attributes.thruBlk;
  return {
    effect: effect?.name,
    direction: typeof effect?.attributes.dir === 'string' ? effect.attributes.dir : undefined,
    speed: spd === 'fast' || spd === 'med' || spd === 'slow' ? spd : undefined,
    durationMs: Number.isFinite(durationMs) ? durationMs : undefined,
    throughBlack: typeof throughBlack === 'string' ? throughBlack === '1' || throughBlack === 'true' : undefined,
    advanceOnClick: advClick !== '0' && advClick !== 'false',
    advanceAfterMs: advanceAfterMs !== undefined && advanceAfterMs <= 0xffff_ffff ? advanceAfterMs : undefined
  };
}
