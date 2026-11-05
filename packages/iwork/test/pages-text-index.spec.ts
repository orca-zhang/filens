import { describe, expect, it } from 'vitest';
import { buildParsedDocument } from '../src/parser/semantic';
import type { IworkArchiveIndex, IworkArchiveRecord } from '../src/types';

function record(id: number, typeName: string, value: unknown): IworkArchiveRecord {
  return { id, archiveId: 1, messageIndex: id, typeId: id, typeName, value, objectReferences: [], dataReferences: [] };
}

describe('Pages paragraph range indexing', () => {
  it.each([false, true])('maps every hint across variable UTF-16 paragraph lengths (trailing newline: %s)', trailingNewline => {
    const paragraphs = Array.from({ length: 257 }, (_, index) => `第 ${index} 段 😀 ${'abc'.repeat(index % 7)}`);
    let offset = 0;
    const pageHints = paragraphs.map((text, index) => {
      const length = text.length + (index + 1 < paragraphs.length || trailingNewline ? 1 : 0);
      const hint = { targetHints: [{ range: { location: offset, length } }] };
      offset += length;
      return hint;
    });
    const archive: IworkArchiveIndex = {
      type: 'pages',
      records: Object.fromEntries([
        record(1, 'TP.DocumentArchive', {
          bodyStorage: { identifier: 2 }, deprecatedLayoutState: { identifier: 3 },
          pageWidth: 600, pageHeight: 2000, leftMargin: 72, rightMargin: 72, topMargin: 72, bottomMargin: 72
        }),
        record(2, 'TSWP.StorageArchive', { text: [paragraphs.join('\n') + (trailingNewline ? '\n' : '')] }),
        record(3, 'TP.LayoutStateArchive', { sectionHints: [{ startPageIndex: 0, pageHints }] })
      ].map(record => [String(record.id), record])),
      references: { incoming: {}, outgoing: {} },
      dataEntries: {},
      warnings: []
    };
    const document = buildParsedDocument({ archive, media: {} });
    expect(document.kind).toBe('pages');
    if (document.kind !== 'pages') throw new Error('Expected Pages document');
    expect(document.pages).toHaveLength(paragraphs.length);
    expect(document.pages.map(page => page.blocks.flatMap(block =>
      block.paragraphs?.map(paragraph => paragraph.runs.map(run => run.text).join('')) ?? []
    ))).toEqual(paragraphs.map(text => [text]));
  });
});
