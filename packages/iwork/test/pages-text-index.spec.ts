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

  it('uses the larger adjacent paragraph gap when estimating a page', () => {
    const ref = (identifier: number) => ({ identifier });
    const archive: IworkArchiveIndex = {
      type: 'pages',
      records: Object.fromEntries([
        record(1, 'TP.DocumentArchive', { bodyStorage: ref(2), pageHeight: 195 }),
        record(2, 'TSWP.StorageArchive', { text: ['First\nSecond'], tableParaStyle: {
          entries: [{ characterIndex: 0, object: ref(3) }, { characterIndex: 6, object: ref(4) }]
        } }),
        record(3, 'TSWP.ParagraphStyleArchive', { charProperties: { fontSize: 12 },
          paraProperties: { lineSpacing: {}, spaceBefore: 25, spaceAfter: 20 } }),
        record(4, 'TSWP.ParagraphStyleArchive', { charProperties: { fontSize: 12 },
          paraProperties: { lineSpacing: { mode: 2, amount: 16 }, spaceBefore: 18, spaceAfter: 25 } })
      ].map(record => [record.id, record])),
      references: { incoming: {}, outgoing: {} },
      dataEntries: {},
      warnings: []
    };
    const document = buildParsedDocument({ archive, media: {} });
    if (document.kind !== 'pages') throw new Error('Expected Pages document');
    expect(document.pages).toHaveLength(1);
    expect(document.pages[0].canvas.slide.items).toMatchObject([{ textFrame: { paragraphs: [
      { spaceBefore: 0, spaceAfter: 0, lineHeight: 1, lineHeightUnit: 'multiple' },
      { spaceBefore: 20, spaceAfter: 0, lineHeight: 16, lineHeightUnit: 'px' }
    ] } }]);
  });

  it('reserves space for drawable-only paragraphs when Pages has no saved layout', () => {
    const ref = (identifier: number) => ({ identifier });
    const image = (dataId: number) => ({ data: ref(dataId), super: { geometry: { size: { width: 200, height: 180 } } } });
    const archive: IworkArchiveIndex = {
      type: 'pages',
      records: Object.fromEntries([
        record(1, 'TP.DocumentArchive', { bodyStorage: ref(2), pageHeight: 400 }),
        record(2, 'TSWP.StorageArchive', { text: ['\uFFFC\n\uFFFC\nCaption'], tableAttachment: {
          entries: [{ characterIndex: 0, object: ref(3) }, { characterIndex: 2, object: ref(5) }]
        } }),
        record(3, 'TSWP.DrawableAttachmentArchive', { drawable: ref(4) }),
        record(4, 'TSD.ImageArchive', image(10)),
        record(5, 'TSWP.DrawableAttachmentArchive', { drawable: ref(6) }),
        record(6, 'TSD.ImageArchive', image(11))
      ].map(record => [record.id, record])),
      references: { incoming: {}, outgoing: {} },
      dataEntries: {},
      warnings: []
    };
    const document = buildParsedDocument({ archive, media: {} });
    if (document.kind !== 'pages') throw new Error('Expected Pages document');
    expect(document.pages).toHaveLength(2);
    const [first, second] = document.pages.map(page => page.canvas.slide.items);
    expect(first).toMatchObject([{ kind: 'image', mediaId: '10', transform: { y: 72, height: 180 } }]);
    expect(second).toMatchObject([
      { kind: 'image', mediaId: '11', transform: { y: 72, height: 180 } },
      { kind: 'text', transform: { y: 252 }, textFrame: { paragraphs: [{ runs: [{ text: 'Caption' }] }] } }
    ]);
  });
});
