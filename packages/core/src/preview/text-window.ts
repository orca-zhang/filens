const BLOCK_LINES = 128;

interface TextBlock { firstLine: number; lastLine: number; start: number; end: number; height: number }
export interface TextWindowView { body: HTMLDivElement; pre: HTMLPreElement; start: number }

/** Bound layout to visible text blocks; measured wrapped heights replace initial estimates. */
export class TextWindow {
  private readonly starts: number[] = [0];
  private readonly blocks: TextBlock[] = [];
  private prefix: number[] = [0];
  private readonly shell = document.createElement('div');
  private readonly before = document.createElement('div');
  private readonly content = document.createElement('div');
  private readonly after = document.createElement('div');
  private readonly mounted = new Map<number, TextWindowView>();
  private readonly controller = new AbortController();
  private readonly observer?: ResizeObserver;
  private frame: number | null = null;
  private width = 0;
  private lineHeight = 20.15;
  private charWidth = 7.8;
  private gutterWidth = 60;
  private allSelected = false;
  private destroyed = false;
  private anchor = 0;

  constructor(private readonly root: HTMLElement, private readonly text: string, private readonly options: {
    family: 'text' | 'code'; wrap: boolean; language?: string;
    render(pre: HTMLPreElement, gutter: HTMLElement, text: string, firstLine: number, lineCount: number, offset: number): void;
    changed(): void;
  }) {
    for (let index = 0; index < text.length; index++) {
      const code = text.charCodeAt(index);
      if (code === 13) { if (text.charCodeAt(index + 1) === 10) index++; this.starts.push(index + 1); }
      else if (code === 10) this.starts.push(index + 1);
    }
    for (let first = 0; first < this.starts.length; first += BLOCK_LINES) {
      const last = Math.min(this.starts.length, first + BLOCK_LINES);
      this.blocks.push({ firstLine: first, lastLine: last, start: this.starts[first], end: this.starts[last] ?? text.length, height: 0 });
    }
    this.shell.className = 'pptxv-native-text-shell'; this.shell.dataset.virtual = 'true';
    this.shell.dataset.family = options.family; this.shell.dataset.wrap = String(options.wrap);
    this.content.className = 'pptxv-text-window';
    for (const spacer of [this.before, this.after]) { spacer.className = 'pptxv-text-spacer'; spacer.setAttribute('aria-hidden', 'true'); }
    this.shell.append(this.before, this.content, this.after); root.replaceChildren(this.shell);
    const probe = document.createElement('pre'); probe.className = 'pptxv-native-text'; probe.textContent = '0000000000';
    probe.style.cssText = 'position:absolute;visibility:hidden;min-width:0;width:max-content;padding:0;white-space:pre';
    root.append(probe); const rect = probe.getBoundingClientRect(); probe.remove();
    this.charWidth = rect.width / 10 || this.charWidth; this.lineHeight = rect.height || this.lineHeight;
    this.gutterWidth = Math.max(52, String(this.starts.length).length * this.charWidth + 15);
    this.shell.style.setProperty('--pptxv-text-gutter-width', `${this.gutterWidth}px`);
    this.estimateHeights();
    const signal = this.controller.signal;
    root.addEventListener('scroll', this.schedule, { passive: true, signal });
    root.addEventListener('pointerdown', () => { this.allSelected = false; }, { signal });
    root.addEventListener('keydown', event => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'a') {
        event.preventDefault(); event.stopPropagation(); this.allSelected = true; this.selectVisible();
      } else if (!['Control', 'Meta', 'Shift'].includes(event.key) && !((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'c')) this.allSelected = false;
    }, { signal });
    root.addEventListener('copy', event => {
      if (!event.clipboardData) return;
      const selection = root.ownerDocument.getSelection();
      const range = selection?.rangeCount ? selection.getRangeAt(0) : undefined;
      const start = range && this.selectionOffset(range.startContainer, range.startOffset);
      const end = range && this.selectionOffset(range.endContainer, range.endOffset);
      if (this.allSelected || (start !== undefined && end !== undefined && end > start)) {
        event.preventDefault(); event.clipboardData.setData('text/plain', this.allSelected ? this.text : this.text.slice(start, end));
      }
    }, { signal });
    root.ownerDocument.addEventListener('selectionchange', () => {
      if (!this.allSelected) return;
      const selection = root.ownerDocument.getSelection();
      const range = selection?.rangeCount ? selection.getRangeAt(0) : undefined;
      this.allSelected = Boolean(range && range.startContainer === this.content && range.startOffset === 0
        && range.endContainer === this.content && range.endOffset === this.content.childNodes.length);
    }, { signal });
    if (typeof ResizeObserver !== 'undefined') {
      this.observer = new ResizeObserver(this.schedule); this.observer.observe(root);
    }
  }

  views(): TextWindowView[] { return [...this.mounted].sort(([a], [b]) => a - b).map(([, view]) => view); }

  rememberPosition(): void { if (!this.destroyed) this.anchor = this.anchorOffset(); }

  anchorOffset(): number {
    const top = this.root.getBoundingClientRect().top;
    for (const { body } of this.views()) {
      for (const line of body.querySelectorAll<HTMLElement>('.pptxv-text-line')) {
        const rect = line.getBoundingClientRect();
        if (rect.height && rect.bottom > top) return Number(line.dataset.textStart);
      }
    }
    const y = Math.max(0, this.root.scrollTop - 18), index = this.blockAt(y), block = this.blocks[index];
    const line = block.firstLine + Math.floor((y - this.prefix[index]) / this.lineHeight);
    return this.starts[Math.min(block.lastLine - 1, line)];
  }

  reveal(offset: number, align = false): void {
    const line = Math.max(0, upperBound(this.starts, offset) - 1), index = Math.floor(line / BLOCK_LINES);
    if (!this.mounted.has(index) || align) {
      this.root.scrollTop = 18 + this.prefix[index]; this.update();
    }
    if (align) {
      const element = this.mounted.get(index)?.body.querySelector<HTMLElement>(`.pptxv-text-line[data-text-start="${this.starts[line]}"]`);
      if (element) this.root.scrollTop += element.getBoundingClientRect().top - this.root.getBoundingClientRect().top + 1;
    }
    this.rememberPosition();
  }

  refresh(): void { this.update(true); }

  destroy(): void {
    this.destroyed = true; this.controller.abort(); this.observer?.disconnect();
    if (this.frame !== null) cancelAnimationFrame(this.frame);
    this.frame = null; this.mounted.clear(); this.blocks.length = 0; this.starts.length = 0; this.prefix = [];
  }

  private readonly schedule = () => {
    if (this.frame !== null || this.destroyed) return;
    this.frame = requestAnimationFrame(() => { this.frame = null; this.update(); });
  };

  private selectVisible(): void {
    if (!this.allSelected) return;
    const selection = this.root.ownerDocument.getSelection();
    const range = this.root.ownerDocument.createRange(); range.selectNodeContents(this.content);
    selection?.removeAllRanges(); selection?.addRange(range);
  }

  private selectionOffset(node: Node, offset: number): number | undefined {
    const element = node.nodeType === Node.ELEMENT_NODE ? node as Element : node.parentElement;
    const line = element?.closest<HTMLElement>('.pptxv-text-line');
    if (!line || !this.content.contains(line)) return undefined;
    const range = this.root.ownerDocument.createRange(); range.selectNodeContents(line); range.setEnd(node, offset);
    return Number(line.dataset.textStart) + range.toString().length;
  }

  private estimateHeights(): void {
    this.width = this.root.clientWidth || 800;
    const columns = Math.max(1, Math.floor((this.width - 36 - this.gutterWidth - 14) / this.charWidth));
    let widest = 1;
    for (const block of this.blocks) {
      let rows = 0;
      for (let line = block.firstLine; line < block.lastLine; line++) {
        let end = this.starts[line + 1] ?? this.text.length;
        while (end > this.starts[line] && /[\r\n]/.test(this.text[end - 1])) end--;
        const length = end - this.starts[line]; widest = Math.max(widest, length);
        rows += this.options.wrap ? Math.max(1, Math.ceil(length / columns)) : 1;
      }
      block.height = rows * this.lineHeight;
    }
    this.shell.style.minWidth = this.options.wrap ? '100%' : `${Math.max(this.width, widest * this.charWidth + this.gutterWidth + 50)}px`;
    this.reindex();
  }

  private reindex(): void {
    this.prefix = [0];
    for (const block of this.blocks) this.prefix.push(this.prefix[this.prefix.length - 1] + block.height);
  }

  private blockAt(pixel: number): number { return Math.min(this.blocks.length - 1, Math.max(0, upperBound(this.prefix, pixel) - 1)); }

  private update(force = false): void {
    if (this.destroyed) return;
    const atBottom = this.root.scrollTop > 0 && this.root.clientHeight > 0 && this.root.scrollHeight > 0
      && this.root.scrollTop + this.root.clientHeight >= this.root.scrollHeight - 2;
    let y = Math.max(0, this.root.scrollTop - 18);
    let resizedLine: number | undefined;
    if ((this.root.clientWidth || 800) !== this.width) {
      const line = Math.max(0, upperBound(this.starts, this.anchor) - 1), index = Math.floor(line / BLOCK_LINES);
      resizedLine = this.starts[line];
      this.estimateHeights(); this.root.scrollTop = 18 + this.prefix[index];
      y = Math.max(0, this.root.scrollTop - 18); force = true;
    }
    const first = Math.max(0, this.blockAt(y) - 1);
    const last = Math.min(this.blocks.length - 1, this.blockAt(y + (this.root.clientHeight || 600)) + 1);
    let changed = force;
    for (const [index, view] of this.mounted) {
      if (index < first || index > last) { this.observer?.unobserve(view.body); view.body.remove(); this.mounted.delete(index); changed = true; }
    }
    let next = this.content.firstChild;
    for (let index = first; index <= last; index++) {
      let view = this.mounted.get(index);
      if (!view) {
        const block = this.blocks[index], body = document.createElement('div'), gutter = document.createElement('div'), pre = document.createElement('pre');
        body.className = 'pptxv-native-text-body';
        gutter.className = 'pptxv-native-text-gutter'; gutter.setAttribute('aria-hidden', 'true');
        pre.className = 'pptxv-native-text'; pre.dataset.family = this.options.family; pre.dataset.wrap = String(this.options.wrap);
        if (this.options.language) pre.dataset.language = this.options.language;
        this.options.render(pre, gutter, this.text.slice(block.start, block.end), block.firstLine, block.lastLine - block.firstLine, block.start);
        body.append(gutter, pre); view = { body, pre, start: block.start }; this.mounted.set(index, view);
        this.observer?.observe(body); changed = true;
      }
      if (next !== view.body) this.content.insertBefore(view.body, next);
      next = view.body.nextSibling;
    }
    this.before.style.height = `${this.prefix[first]}px`;
    this.after.style.height = `${this.prefix[this.blocks.length] - this.prefix[last + 1]}px`;
    if (changed) this.options.changed();
    const anchor = this.blockAt(y), oldTop = this.prefix[anchor];
    let measured = false;
    for (const [index, { body }] of this.mounted) {
      const height = body.getBoundingClientRect().height;
      if (height && Math.abs(height - this.blocks[index].height) > .5) { this.blocks[index].height = height; measured = true; }
    }
    if (measured) {
      this.reindex(); this.before.style.height = `${this.prefix[first]}px`;
      this.after.style.height = `${this.prefix[this.blocks.length] - this.prefix[last + 1]}px`;
      this.root.scrollTop += this.prefix[anchor] - oldTop;
      if (atBottom) this.root.scrollTop = this.root.scrollHeight - this.root.clientHeight;
      this.schedule();
    }
    if (resizedLine !== undefined) {
      const line = this.content.querySelector<HTMLElement>(`.pptxv-text-line[data-text-start="${resizedLine}"]`);
      if (line) this.root.scrollTop += line.getBoundingClientRect().top - this.root.getBoundingClientRect().top + 1;
      this.schedule();
    }
    if (changed) this.selectVisible();
    this.rememberPosition();
  }
}

function upperBound(values: readonly number[], value: number): number {
  let low = 0, high = values.length;
  while (low < high) { const mid = (low + high) >>> 1; if (values[mid] <= value) low = mid + 1; else high = mid; }
  return low;
}
