export interface PreviewTouchGestureOptions {
  getScale(): number;
  setScale(scale: number, anchor?: { x: number; y: number }): void;
  pan?(deltaX: number, deltaY: number): void;
  enabled?(): boolean;
  minScale?: number;
  maxScale?: number;
  signal?: AbortSignal;
}

/** Pinch content while leaving single-finger scrolling and controls to the browser. */
export function bindPreviewTouchGestures(element: HTMLElement, options: PreviewTouchGestureOptions): () => void {
  const controller = new AbortController();
  const signal = controller.signal;
  const identifiers = new Set<number>();
  const targets = new Set<EventTarget>();
  const handled = new WeakSet<Event>();
  let previous: Touch[] = [];
  let pinched = false;
  const previousTouchAction = element.style.touchAction ?? '';
  const touchAction = options.pan ? 'none' : 'pan-x pan-y';
  element.style.touchAction = touchAction;
  const points = (event: TouchEvent) => Array.from(event.touches).filter(touch => identifiers.has(touch.identifier));
  const distance = (touches: Touch[]) => touches.length < 2 ? 0
    : Math.hypot(touches[1]!.clientX - touches[0]!.clientX, touches[1]!.clientY - touches[0]!.clientY);
  const reset = () => {
    for (const target of targets) {
      target.removeEventListener('touchmove', move as EventListener);
      target.removeEventListener('touchend', end as EventListener);
      target.removeEventListener('touchcancel', cancel);
    }
    targets.clear();
    identifiers.clear();
    previous = [];
    pinched = false;
  };
  const cancel = () => reset();
  const move = (event: TouchEvent) => {
    if (handled.has(event)) return;
    handled.add(event);
    if (options.enabled?.() === false) { reset(); return; }
    const current = points(event);
    if (!current.length) return;
    if (options.pan || current.length > 1 || pinched) event.preventDefault();
    if (current.length > 1 && previous.length > 1) {
      pinched = true;
      const before = distance(previous), after = distance(current);
      const oldScale = options.getScale();
      if (before > 0 && after > 0 && Number.isFinite(oldScale) && oldScale > 0) {
        const rect = element.getBoundingClientRect();
        const x = (current[0]!.clientX + current[1]!.clientX) / 2 - rect.left;
        const y = (current[0]!.clientY + current[1]!.clientY) / 2 - rect.top;
        const left = element.scrollLeft, top = element.scrollTop;
        const nextScale = Math.max(options.minScale ?? 0.1, Math.min(options.maxScale ?? 8, oldScale * after / before));
        if (nextScale !== oldScale) {
          options.setScale(nextScale, { x, y });
          if (!options.pan) {
            const ratio = options.getScale() / oldScale;
            element.scrollLeft = (left + x) * ratio - x;
            element.scrollTop = (top + y) * ratio - y;
          }
        }
      }
    } else if (current.length === 1 && previous.length === 1 && current[0]!.identifier === previous[0]!.identifier) {
      options.pan?.(current[0]!.clientX - previous[0]!.clientX, current[0]!.clientY - previous[0]!.clientY);
    }
    previous = current;
  };
  const end = (event: TouchEvent) => {
    if (handled.has(event)) return;
    handled.add(event);
    previous = points(event);
    if (!previous.length) reset();
  };
  element.addEventListener('touchstart', (event) => {
    if (options.enabled?.() === false) return;
    const target = event.target as Element | null;
    if (!identifiers.size && target?.closest?.('button, input, select, textarea, video, audio, [contenteditable="true"]')) return;
    for (const touch of Array.from(event.changedTouches)) identifiers.add(touch.identifier);
    previous = points(event);
    pinched ||= previous.length > 1;
    if (options.pan || pinched) event.preventDefault();
    if (event.target && !targets.has(event.target)) {
      // Keep receiving a gesture when zooming replaces its original DOM content.
      targets.add(event.target);
      event.target.addEventListener('touchmove', move as EventListener, { passive: false, signal });
      event.target.addEventListener('touchend', end as EventListener, { signal });
      event.target.addEventListener('touchcancel', cancel, { signal });
    }
  }, { passive: false, signal });
  const dispose = () => controller.abort();
  signal.addEventListener('abort', () => {
    reset();
    if (element.style.touchAction === touchAction) element.style.touchAction = previousTouchAction;
    options.signal?.removeEventListener('abort', dispose);
  }, { once: true });
  if (options.signal?.aborted) dispose();
  else options.signal?.addEventListener('abort', dispose, { once: true });
  return dispose;
}
