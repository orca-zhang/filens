export const PDF_PAGE_GAP = 16;
// Keep the physical scroll track within browser layout limits.
export const PDF_SCROLL_HEIGHT = 8_000_000;

interface PageSize { width: number; height: number }
type PageScale = (width: number, height: number) => number;

function lowBit(index: number): number {
  const low = (index & -index) >>> 0;
  const high = index / 0x100000000;
  return low || 0x100000000 * (high & -high);
}

/** Unknown pages use the first page's dimensions. Store only size differences. */
export class PdfPageLayout {
  private readonly sizes = new Map<number, PageSize>();
  private readonly deltas = new Map<number, number>();
  private scale: PageScale = () => 1;
  private defaultHeight: number;

  constructor(readonly count: number, private readonly first: PageSize) {
    this.defaultHeight = first.height;
  }

  size(index: number): PageSize { return this.sizes.get(index) ?? this.first; }

  scaleFor(index: number): number {
    const { width, height } = this.size(index);
    return this.scale(width, height);
  }

  height(index: number): number {
    const size = this.sizes.get(index);
    return size ? size.height * this.scale(size.width, size.height) : this.defaultHeight;
  }

  offset(index: number): number {
    let offset = index * (this.defaultHeight + PDF_PAGE_GAP);
    for (; index > 0; index -= lowBit(index)) offset += this.deltas.get(index) ?? 0;
    return offset;
  }

  get totalHeight(): number { return this.offset(this.count) - PDF_PAGE_GAP; }

  resize(scale: PageScale): void {
    this.scale = scale;
    this.defaultHeight = this.first.height * scale(this.first.width, this.first.height);
    this.deltas.clear();
    for (const index of this.sizes.keys()) this.addHeight(index, this.height(index) - this.defaultHeight);
  }

  measure(index: number, width: number, height: number): boolean {
    const previous = this.size(index);
    if (previous.width === width && previous.height === height) return false;
    const oldHeight = this.height(index);
    if (width === this.first.width && height === this.first.height) this.sizes.delete(index);
    else this.sizes.set(index, { width, height });
    this.addHeight(index, this.height(index) - oldHeight);
    return true;
  }

  private addHeight(index: number, delta: number): void {
    if (!delta) return;
    for (let at = index + 1; at <= this.count; at += lowBit(at)) {
      const sum = (this.deltas.get(at) ?? 0) + delta;
      if (sum) this.deltas.set(at, sum);
      else this.deltas.delete(at);
    }
  }

  firstAfter(pixel: number): number {
    let low = 0, high = this.count;
    while (low < high) {
      const middle = low + Math.floor((high - low) / 2);
      if (this.offset(middle + 1) - PDF_PAGE_GAP <= pixel) low = middle + 1;
      else high = middle;
    }
    return low;
  }
}
