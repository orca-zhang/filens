import type { SlideTransition } from '@filens/core/presentation-support';

const clip = { l: '0 100% 0 0', r: '0 0 0 100%', u: '0 0 100% 0', d: '100% 0 0 0' };

export function playableSlideTransition(transition?: SlideTransition): SlideTransition | undefined {
  return [transition, transition?.fallback].find(candidate => candidate?.effect === 'fade' ||
    candidate?.effect === 'push' || candidate?.effect === 'wipe' || candidate?.effect === 'cut');
}

export function playSlideTransition(
  stage: HTMLElement, incoming: HTMLElement, outgoing: HTMLElement, transition: SlideTransition, onFinish: () => void
): () => void {
  const { effect, throughBlack } = transition;
  const duration = Math.min(60_000, transition.durationMs ?? (transition.speed === 'slow' ? 1000 : transition.speed === 'med' ? 750 : 500));

  const backdrop = stage.ownerDocument.createElement('div');
  backdrop.className = 'pptxv-slide-transition';
  backdrop.dataset.effect = effect;
  backdrop.inert = true;
  backdrop.setAttribute('aria-hidden', 'true');
  backdrop.appendChild(outgoing);
  stage.appendChild(backdrop);
  const effects: Animation[] = [];
  const animate = (target: HTMLElement, frames: Keyframe[]) =>
    effects.push(target.animate(frames, { duration, fill: 'both' }));

  const dir = transition.direction;
  const direction = dir === 'r' || dir === 'u' || dir === 'd' ? dir : 'l';
  if (effect === 'wipe') {
    animate(backdrop, [{ clipPath: 'inset(0)' }, { clipPath: `inset(${clip[direction]})` }]);
  } else if (effect === 'push') {
    const width = parseFloat(stage.style.width), height = parseFloat(stage.style.height);
    const x = direction === 'r' ? width : direction === 'l' ? -width : 0;
    const y = direction === 'd' ? height : direction === 'u' ? -height : 0;
    animate(incoming, [{ translate: `${-x}px ${-y}px` }, { translate: '0px 0px' }]);
    animate(backdrop, [{ translate: '0px 0px' }, { translate: `${x}px ${y}px` }]);
  } else if (throughBlack) {
    backdrop.style.background = 'black';
    const easing = effect === 'cut' ? 'steps(1, end)' : 'linear';
    animate(outgoing, [{ opacity: 1, easing }, { opacity: 0, offset: 0.5 }, { opacity: 0 }]);
    animate(backdrop, [{ opacity: 1 }, { opacity: 1, offset: 0.5, easing }, { opacity: 0 }]);
  } else {
    animate(backdrop, [{ opacity: 1 }, { opacity: 0 }]);
  }
  const finish = () => {
    stop();
    onFinish();
  };
  const reducedMotion = stage.ownerDocument.defaultView?.matchMedia('(prefers-reduced-motion: reduce)');
  const stop = () => {
    effects[0].removeEventListener('finish', finish);
    reducedMotion?.removeEventListener('change', finish);
    effects.forEach(animation => animation.cancel());
    backdrop.remove();
  };
  effects[0].addEventListener('finish', finish, { once: true });
  reducedMotion?.addEventListener('change', finish, { once: true });
  return stop;
}
