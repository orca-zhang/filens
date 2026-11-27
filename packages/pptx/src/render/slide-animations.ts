import type { SlideAnimationStep, SlideObjectAnimation } from '@filens/core/presentation-support';

const wipe = { up: '100% 0 0', down: '0 0 100%', left: '0 0 0 100%', right: '0 100% 0 0' };
type AnimatedElement = HTMLElement | SVGElement;

export class SlideAnimationPlayer {
  readonly controls: HTMLDivElement;
  private readonly label: HTMLSpanElement;
  private readonly play: HTMLButtonElement;
  private readonly resetButton: HTMLButtonElement;
  private readonly motion?: MediaQueryList;
  private steps: readonly SlideAnimationStep[] = [];
  private shown = -1;
  private active?: Animation[];

  constructor(
    doc: Document, private readonly slide: () => HTMLElement | undefined, private readonly translate: (key: string) => string,
    beforePlay: () => void, private readonly onSettled: () => void
  ) {
    this.controls = doc.createElement('div');
    this.controls.className = 'pptxv-animation-controls';
    this.controls.setAttribute('role', 'group');
    this.label = doc.createElement('span');
    this.play = doc.createElement('button');
    this.resetButton = doc.createElement('button');
    this.play.type = this.resetButton.type = 'button';
    this.controls.append(this.label, this.play, this.resetButton);
    this.motion = doc.defaultView?.matchMedia?.('(prefers-reduced-motion: reduce)');
    this.play.addEventListener('click', () => {
      beforePlay();
      this.playNext();
    });
    this.resetButton.addEventListener('click', () => {
      this.reset();
      this.play.focus({ preventScroll: true });
    });
    this.syncControls();
  }

  get playing(): boolean { return !!this.active; }

  select(steps: readonly SlideAnimationStep[] = []): void {
    this.reset();
    this.steps = steps;
    this.syncControls();
  }

  syncControls(): void {
    const label = this.translate('Slide animations');
    this.controls.hidden = !this.steps.length;
    this.controls.setAttribute('aria-label', label);
    this.label.textContent = label;
    this.play.textContent = this.translate(this.shown >= 0 && this.shown < this.steps.length ? 'Next effect' : 'Play');
    this.resetButton.hidden = this.shown < 0;
    this.resetButton.textContent = this.translate('Reset view');
  }

  paint(): void {
    const root = this.slide();
    if (!root) return;
    const hidden = new Map<AnimatedElement, boolean>();
    this.steps.forEach((step, number) => {
      for (const effect of step.effects) {
        for (const element of elements(root, effect)) {
          if (number < this.shown) hidden.set(element, !effect.enter);
          else if (!hidden.has(element)) hidden.set(element, effect.enter);
        }
      }
    });
    for (const [element, hide] of hidden) {
      const visibility = this.shown >= 0 && hide ? 'hidden' : '';
      element.style.visibility = visibility;
      if (element.parentElement === root) element.style.contentVisibility = visibility;
    }
  }

  reset(): void {
    if (this.shown < 0) return;
    this.shown = -1;
    this.finishStep();
  }

  private playNext(): void {
    const root = this.slide();
    if (!root || !this.steps.length) return;
    if (this.active) this.finishStep();
    if (this.shown < 0 || this.shown >= this.steps.length) {
      this.shown = 0;
      this.paint();
    }
    const { effects } = this.steps[this.shown++];
    if (this.motion?.matches || typeof root.animate !== 'function') {
      this.finishStep();
      return;
    }
    const running = effects.flatMap(effect => elements(root, effect).map(element => {
      const delay = Math.min(effect.delayMs, 60_000);
      const duration = Math.min(effect.durationMs, 60_000 - delay);
      return element.animate(keyframes(element, effect), { delay, duration, fill: 'forwards' });
    }));
    this.active = running;
    this.syncControls();
    this.motion?.addEventListener('change', this.finishStep, { once: true });
    void Promise.all(running.map(animation => animation.finished)).then(() => {
      if (this.active === running) this.finishStep();
    }, () => {});
  }

  private readonly finishStep = () => {
    this.paint();
    this.syncControls();
    if (this.active) {
      this.active.forEach(animation => animation.cancel());
      this.active = undefined;
      this.motion?.removeEventListener('change', this.finishStep);
      this.onSettled();
    }
  };
}

function elements(root: HTMLElement, effect: SlideObjectAnimation): AnimatedElement[] {
  return effect.itemIndexes.flatMap<AnimatedElement>(index => {
    const item = root.children[index] as HTMLElement | undefined;
    if (!item) return [];
    if (effect.chart) {
      const { step, seriesIndex, categoryIndex } = effect.chart;
      const series = seriesIndex === undefined ? '[data-series-index]' : `[data-series-index="${seriesIndex}"]`;
      const category = categoryIndex === undefined ? '' : `[data-category-index="${categoryIndex}"]`;
      const selector = step === 'gridLegend'
        ? '.pptxv-chart-axis,.pptxv-chart-axis-title,.pptxv-chart-category-label,.pptxv-chart-axis-label,.pptxv-chart-gridline,.pptxv-chart-legend'
        : `${series}${category}:not(.pptxv-chart-legend-item)`;
      return [...item.querySelectorAll<SVGElement>(selector)];
    }
    const range = effect.paragraphs;
    if (!range) return [item];
    return Array.from(item.querySelectorAll<HTMLElement>(':scope > .pptxv-text-frame > .pptxv-paragraph'))
      .slice(range.start, range.end + 1);
  });
}

function keyframes(element: AnimatedElement, effect: SlideObjectAnimation): Keyframe[] {
  const subset = effect.paragraphs || effect.chart;
  const visible: Keyframe = { visibility: subset ? 'inherit' : 'visible' };
  const hidden: Keyframe = { visibility: 'hidden' };
  // A descendant's running paragraph effect cannot reveal a hidden drawing.
  if (!subset) {
    visible.contentVisibility = 'visible';
    hidden.contentVisibility = 'hidden';
  }
  if (effect.effect === 'appear') return [effect.enter ? visible : hidden];
  if (effect.effect === 'fade') {
    visible.opacity = element.style.opacity || 1;
    hidden.opacity = 0;
  } else {
    visible.clipPath = 'inset(0)';
    hidden.clipPath = `inset(${wipe[effect.direction!]})`;
  }
  return effect.enter ? [hidden, visible] : [visible, hidden];
}
