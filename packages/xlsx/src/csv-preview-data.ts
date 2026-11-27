import type { ParsedSheet } from './types';

const MAX_BLOCK_FIELDS = 4096;
const MAX_BLOCK_TEXT = 256 * 1024;

interface CsvFieldBlock {
  first: number;
  text: string;
  offsets: Uint32Array;
}

/** Store preview text separately from the public row and cell model. */
export class CsvPreviewData {
  /** One start offset per record, followed by the end of the final record. */
  readonly rowOffsets = [0];
  private readonly blocks: CsvFieldBlock[] = [];
  private readonly pending: string[] = [];
  private firstPending = 0;
  private pendingLength = 0;

  appendRow(record: readonly string[]): void {
    for (const field of record) {
      // A field longer than the block budget occupies its own block.
      if (this.pending.length === MAX_BLOCK_FIELDS || this.pendingLength + field.length > MAX_BLOCK_TEXT) this.finishBlock();
      this.pending.push(field);
      this.pendingLength += field.length;
    }
    this.rowOffsets.push(this.firstPending + this.pending.length);
  }

  finishBlock(): void {
    if (!this.pending.length) return;
    const offsets = new Uint32Array(this.pending.length + 1);
    for (let i = 0; i < this.pending.length; i++) offsets[i + 1] = offsets[i] + this.pending[i].length;
    this.blocks.push({ first: this.firstPending, text: this.pending.join(''), offsets });
    this.firstPending += this.pending.length;
    this.pending.length = 0;
    this.pendingLength = 0;
  }

  valueAt(index: number): string {
    if (index >= this.firstPending) return this.pending[index - this.firstPending];
    let first = 0, last = this.blocks.length;
    while (first + 1 < last) {
      const middle = (first + last) >>> 1;
      if (this.blocks[middle].first <= index) first = middle;
      else last = middle;
    }
    const block = this.blocks[first];
    const field = index - block.first;
    return block.text.slice(block.offsets[field], block.offsets[field + 1]);
  }
}

export const csvPreviewData = new WeakMap<ParsedSheet, CsvPreviewData>();
