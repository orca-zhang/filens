import type { PreviewSearchState } from './types';

/** Shared PDF/text controls; each session owns its search data and cancellation. */
export class PreviewFindControls {
  readonly element = document.createElement('details');
  private readonly summary = document.createElement('summary');
  private readonly input = document.createElement('input');
  private readonly output = document.createElement('output');
  private readonly previous = document.createElement('button');
  private readonly next = document.createElement('button');
  private readonly clear = document.createElement('button');
  private readonly controller = new AbortController();
  private timer?: ReturnType<typeof setTimeout>;

  constructor(root: HTMLElement, private readonly options: {
    state(): PreviewSearchState | undefined;
    find(query: string): Promise<void>;
    reset(query: string): unknown;
    next(backward?: boolean): void;
    translate?(message: string): string;
  }) {
    const signal = this.controller.signal;
    this.element.className = 'pptxv-find-controls';
    this.element.dataset.previewControls = '';
    this.summary.innerHTML = '<svg viewBox="0 0 20 20" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true"><circle cx="8" cy="8" r="5"/><path d="m12 12 5 5"/></svg>';
    this.input.type = 'search'; this.input.autocomplete = 'off'; this.input.spellcheck = false;
    this.output.setAttribute('aria-live', 'polite');
    for (const [button, label, action] of [
      [this.previous, '↑', () => options.next(true)], [this.next, '↓', () => options.next()],
      [this.clear, '×', () => { void options.find(''); this.input.focus(); }]
    ] as const) {
      button.type = 'button'; button.textContent = label;
      button.addEventListener('click', action, { signal });
    }
    const form = document.createElement('form'); form.setAttribute('role', 'search');
    form.append(this.input, this.output, this.previous, this.next, this.clear);
    form.addEventListener('submit', event => {
      event.preventDefault();
      if (this.input.value === options.state()?.query && options.state()?.total) options.next();
      else void options.find(this.input.value);
    }, { signal });
    const change = (event: Event) => {
      options.reset(this.input.value);
      if (!(event as InputEvent).isComposing && this.input.value.trim()) {
        this.timer = setTimeout(() => { void options.find(this.input.value); }, 150);
      }
    };
    this.input.addEventListener('input', change, { signal });
    this.input.addEventListener('compositionend', change, { signal });
    this.input.addEventListener('keydown', event => {
      if (event.isComposing) return;
      if (event.key === 'Enter' && event.shiftKey) { event.preventDefault(); options.next(true); }
      if (event.key === 'Escape') {
        event.preventDefault(); event.stopPropagation(); void options.find(''); this.element.open = false; root.focus();
      }
    }, { signal });
    root.addEventListener('keydown', event => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'f') {
        event.preventDefault(); event.stopPropagation(); this.element.open = true; this.input.focus(); this.input.select();
      }
    }, { signal });
    this.element.addEventListener('toggle', () => { if (this.element.open) this.input.focus(); }, { signal });
    this.element.append(this.summary, form);
    this.refreshTranslations();
  }

  setQuery(query: string): void { if (this.input.value !== query) this.input.value = query; }
  cancelPending(): void { clearTimeout(this.timer); }
  close(): void { this.cancelPending(); this.setQuery(''); this.element.open = false; }
  destroy(): void { this.cancelPending(); this.controller.abort(); this.element.remove(); }

  refreshTranslations(): void {
    const t = this.options.translate ?? ((message: string) => message);
    for (const [element, key] of [
      [this.summary, 'Find in document'], [this.input, 'Find in document'],
      [this.previous, 'Previous match'], [this.next, 'Next match'], [this.clear, 'Clear']
    ] as const) { element.setAttribute('aria-label', t(key)); element.title = t(key); }
    this.input.placeholder = t('Find in document'); this.update();
  }

  update(): void {
    const search = this.options.state();
    this.output.setAttribute('aria-busy', String(search?.searching ?? false));
    const incomplete = search?.error || search?.truncated;
    const incompleteLabel = this.options.translate?.('Search incomplete') ?? 'Search incomplete';
    const label = `${(search?.activeIndex ?? -1) + 1} / ${search?.total ?? 0}${search?.truncated ? '+' : ''}${incomplete ? ` · ${incompleteLabel}` : ''}`;
    if (this.output.value !== label) this.output.value = label;
    this.output.classList.toggle('is-incomplete', Boolean(incomplete));
    this.output.title = incomplete ? incompleteLabel + (search?.error ? `: ${search.error}` : '') : '';
    this.previous.disabled = this.next.disabled = !search?.total;
  }
}
