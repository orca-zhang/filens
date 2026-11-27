import type { FillStyle } from '@filens/core';
import { readMediaEntry, type ArchiveMediaEntry } from '../parser/archive';
import type { IworkImageAsset, ParsedNumbersSheet } from '../types';

export class NumbersPreviewMedia {
  private readonly sent = new Set<string>();
  private readonly reads = new Map<string, Promise<IworkImageAsset>>();

  constructor(private readonly entries: ReadonlyMap<string, ArchiveMediaEntry>) {}

  async publish(sheets: readonly ParsedNumbersSheet[], send: (media: Record<string, IworkImageAsset>) => void): Promise<void> {
    const media: Record<string, IworkImageAsset> = {};
    if (this.sent.size !== this.entries.size) {
      for (const sheet of sheets) {
        for (const id of sheetMediaIds(sheet)) {
          if (this.sent.has(id) || media[id]) continue;
          const entry = this.entries.get(id);
          if (!entry) continue;
          let read = this.reads.get(id);
          if (!read) {
            read = readMediaEntry(entry).then(asset => {
              // A stored member can be a view into the complete ZIP or its tail.
              // Clone only that member when the result crosses the worker boundary.
              const { data } = asset;
              if (data.byteLength !== data.buffer.byteLength) asset.data = data.slice();
              return asset;
            }).catch(error => {
              this.reads.delete(id);
              throw error;
            });
            this.reads.set(id, read);
          }
          media[id] = await read;
        }
      }
    }

    // Other sheet requests can complete while this one is reading. Only the
    // first response to publish an asset sends its bytes to the viewer.
    for (const id of Object.keys(media)) if (this.sent.has(id)) delete media[id];
    send(media);
    for (const id of Object.keys(media)) {
      this.sent.add(id);
      this.reads.delete(id);
    }
  }
}

function sheetMediaIds(sheet: ParsedNumbersSheet): Set<string> {
  const ids = new Set<string>();
  const addFill = (fill?: FillStyle) => {
    if (fill?.type === 'picture' && fill.mediaId) ids.add(fill.mediaId);
  };
  addFill(sheet.canvas.slide.background);
  for (const item of sheet.canvas.slide.items) {
    addFill(item.fill);
    if (item.kind === 'image' || item.kind === 'media') ids.add(item.mediaId);
    if (item.kind === 'media' && item.posterMediaId) ids.add(item.posterMediaId);
    if (item.kind === 'table') for (const cell of item.cells) addFill(cell.fill);
  }
  for (const { item } of sheet.tables) {
    const styles = item.blankCellStyles;
    if (!styles) continue;
    addFill(styles.gridPaint.bandedFill);
    for (const paint of Object.values(styles.defaults)) addFill(paint.fill);
    for (const paint of Object.values(styles.rows)) addFill(paint.fill);
    for (const paint of Object.values(styles.columns)) addFill(paint.fill);
  }
  return ids;
}
