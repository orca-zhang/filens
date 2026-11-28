export type PdfDestination = string | readonly unknown[];

export interface PdfOutlineItem {
  title: string;
  dest: PdfDestination | null;
  url: string | null;
  bold?: boolean;
  italic?: boolean;
  items: PdfOutlineItem[];
}

interface OutlineSource {
  read(signal: AbortSignal): Promise<PdfOutlineItem[] | null>;
  navigate(destination: PdfDestination, signal: AbortSignal): Promise<boolean>;
}

export class PdfOutlineControls {
  readonly element = document.createElement('details');
  private readonly summary = document.createElement('summary');
  private readonly panel = document.createElement('div');
  private readonly status = document.createElement('p');
  private readonly retry = document.createElement('button');
  private source?: OutlineSource;
  private loading?: AbortController;
  private navigating?: AbortController;
  private loaded = false;
  private message = '';

  constructor(private readonly root: HTMLElement, private readonly translate: (message: string) => string) {
    this.element.className = 'pdfv-outline';
    this.element.dataset.previewControls = '';
    this.element.hidden = true;
    this.panel.className = 'pdfv-outline-panel';
    this.status.setAttribute('role', 'status');
    this.retry.type = 'button';
    this.retry.hidden = true;
    this.retry.addEventListener('click', () => { this.summary.focus(); void this.load(); });
    this.panel.append(this.status, this.retry);
    this.element.append(this.summary, this.panel);
    this.element.addEventListener('toggle', () => {
      if (this.element.open) void this.load();
      else this.cancelReads();
    });
    this.element.addEventListener('keydown', event => {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      event.stopPropagation();
      this.element.open = false;
      this.cancelReads();
      this.summary.focus();
    });
    this.refreshTranslations();
  }

  setSource(source?: OutlineSource): void {
    this.cancelReads();
    this.source = source;
    this.loaded = false;
    this.element.open = false;
    this.element.hidden = !source;
    this.panel.replaceChildren(this.status, this.retry);
    this.setMessage('');
  }

  refreshTranslations(): void {
    this.summary.textContent = this.translate('Table of contents');
    this.retry.textContent = this.translate('Retry');
    this.status.textContent = this.message ? this.translate(this.message) : '';
    for (const label of this.panel.querySelectorAll<HTMLElement>('[data-outline-label]')) {
      const key = label.dataset.outlineLabel!;
      if (label.hasAttribute('aria-expanded')) label.setAttribute('aria-label', `${this.translate(key)} ${label.dataset.outlineTitle ?? ''}`.trim());
      else label.textContent = this.translate(key);
    }
  }

  cancelNavigation(): void {
    if (!this.navigating) return;
    this.navigating.abort();
    this.navigating = undefined;
    this.setMessage('');
  }

  private cancelReads(): void {
    this.loading?.abort();
    this.loading = undefined;
    this.cancelNavigation();
    this.panel.removeAttribute('aria-busy');
  }

  private setMessage(message: string, retry = false): void {
    this.message = message;
    this.status.textContent = message ? this.translate(message) : '';
    this.status.hidden = !message;
    this.retry.hidden = !retry;
  }

  private async load(): Promise<void> {
    const source = this.source;
    if (!source || this.loaded || this.loading) return;
    const controller = this.loading = new AbortController();
    this.setMessage('Loading document...');
    this.panel.setAttribute('aria-busy', 'true');
    try {
      const items = await source.read(controller.signal);
      if (controller.signal.aborted) return;
      if (!items?.length) this.setMessage('No table of contents');
      else {
        this.setMessage('');
        const list = document.createElement('ul');
        this.appendItems(list, items);
        this.panel.append(list);
      }
      this.loaded = true;
    } catch {
      if (!controller.signal.aborted) this.setMessage('Table of contents unavailable', true);
    } finally {
      if (this.loading === controller) {
        this.loading = undefined;
        this.panel.removeAttribute('aria-busy');
      }
    }
  }

  private appendItems(list: HTMLUListElement, items: PdfOutlineItem[], start = 0): void {
    const end = Math.min(items.length, start + 100);
    for (const item of items.slice(start, end)) {
      const entry = document.createElement('li'), row = document.createElement('div');
      const title = document.createElement(item.dest !== null ? 'button' : safePdfUrl(item.url) ? 'a' : 'span');
      title.textContent = item.title || this.translate('Untitled');
      if (!item.title) title.dataset.outlineLabel = 'Untitled';
      if (item.bold) title.style.fontWeight = 'bold';
      if (item.italic) title.style.fontStyle = 'italic';
      if (title instanceof HTMLButtonElement) {
        title.type = 'button';
        const dest = item.dest!;
        title.addEventListener('click', () => { void this.navigate(dest); });
      } else if (title instanceof HTMLAnchorElement) {
        title.href = item.url!;
        title.rel = 'noopener noreferrer';
        title.target = '_blank';
      }
      if (item.items.length) {
        const toggle = document.createElement('button'), children = document.createElement('ul');
        toggle.type = 'button';
        toggle.className = 'pdfv-outline-expand';
        toggle.textContent = '›';
        toggle.dataset.outlineTitle = item.title;
        const expand = (open: boolean) => {
          toggle.setAttribute('aria-expanded', String(open));
          toggle.dataset.outlineLabel = open ? 'Collapse' : 'Expand';
          toggle.setAttribute('aria-label', `${this.translate(toggle.dataset.outlineLabel)} ${item.title}`.trim());
          children.hidden = !open;
          if (open && !children.childElementCount) this.appendItems(children, item.items);
        };
        expand(false);
        toggle.addEventListener('click', () => expand(children.hidden));
        row.append(toggle);
        entry.append(row, children);
      } else entry.append(row);
      row.append(title);
      list.append(entry);
    }
    if (end < items.length) {
      const row = document.createElement('li'), more = document.createElement('button');
      more.type = 'button';
      more.dataset.outlineLabel = 'Show more';
      more.textContent = this.translate('Show more');
      more.addEventListener('click', () => {
        const previous = row.previousElementSibling;
        row.remove();
        this.appendItems(list, items, end);
        previous?.nextElementSibling?.querySelector<HTMLElement>('button, a')?.focus();
      }, { once: true });
      row.append(more);
      list.append(row);
    }
  }

  private async navigate(destination: PdfDestination): Promise<void> {
    const source = this.source;
    if (!source) return;
    this.cancelNavigation();
    const controller = this.navigating = new AbortController();
    this.setMessage('Loading document...');
    try {
      const found = await source.navigate(destination, controller.signal);
      if (controller.signal.aborted) return;
      if (found) {
        this.setMessage('');
        this.element.open = false;
        this.root.focus({ preventScroll: true });
      } else this.setMessage('Bookmark unavailable');
    } catch {
      if (!controller.signal.aborted) this.setMessage('Bookmark unavailable');
    } finally { if (this.navigating === controller) this.navigating = undefined; }
  }
}

export function safePdfUrl(url: unknown): url is string {
  return typeof url === 'string' && /^(?:https?:|mailto:|tel:)/i.test(url);
}
