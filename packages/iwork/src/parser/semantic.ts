/// <reference lib="es2022.intl" />
import type {
  FillStyle,
  ItemTransform,
  ParsedPresentation,
  SlideItem,
  SlideModel,
  TableItem,
  TextFrame,
  TextParagraph,
  ThemeModel
} from '@filens/core';
import type {
  IworkArchiveIndex,
  IworkArchiveRecord,
  IworkCanvasModel,
  IworkImageAsset,
  PagesBodyBlock,
  PagesLayoutMeasurements,
  PagesTableMeasurement,
  PagesTableSourceRows,
  ParsedIworkDocument,
  ParsedKeynoteDocument,
  ParsedNumbersDocument,
  ParsedNumbersSheet,
  ParsedPagesDocument,
  ParsedPagesPage
} from '../types';
import { buildTableItem, readPackedCellCoordinate } from './table';
import type { NumbersFormatting } from './decimal-format';
import {
  asArray,
  asObject,
  buildAttachmentTextMap,
  buildTextFrameFromStorage,
  colorAlpha,
  colorToHex,
  collectStorageObjectAttributeEntries,
  fillFromValue,
  findRecordByValue,
  getRecord,
  getRefId,
  getRecordValue,
  lineFromValue,
  paddingFromValue,
  pathSourceToGeometry,
  readField,
  resolveMergedStyle,
  shadowFromValue,
  transformFromGeometry,
  uuidToKey,
  verticalAlignFromValue,
  withStyleResolutionCache
} from './helpers';

type AnyObject = Record<string, unknown>;
type ShapeType = Extract<SlideItem, { kind: 'shape' }>['shapeType'];

const PAGES_GLYPH_LINE_HEIGHT = 1.25;

export interface SemanticBuildContext {
  archive: IworkArchiveIndex;
  media: Record<string, IworkImageAsset>;
  indexedMedia?: ReadonlyMap<string, { asset: Omit<IworkImageAsset, 'data'> }>;
  numbersFormatting?: NumbersFormatting;
}

export interface SemanticBuildOptions {
  numbersSheetIndexes?: Set<number>;
  pagesLayoutMeasurements?: PagesLayoutMeasurements;
}

interface PagesLayoutModel {
  width: number;
  height: number;
  leftMargin: number;
  rightMargin: number;
  topMargin: number;
  bottomMargin: number;
  headerMargin?: number;
  footerMargin?: number;
  bodyWidth: number;
  bodyHeight: number;
}

interface PaginatedPagesBodyPage {
  pageIndex: number;
  startParagraph: number;
  endParagraph: number;
  fragments: PaginatedPagesBodyFragment[];
  leadingTableCharacterIndex?: number;
  fitOversizedLine?: boolean;
  savedLayout?: true;
}

interface PagesTextRange {
  location: number;
  length: number;
}

interface PagesParagraphRange {
  start: number;
  end: number;
  text: string;
  markers?: Array<{ offset: number; delta: number }>;
}

interface PagesBodyFragmentRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

interface PaginatedPagesBodyFragment {
  startParagraph: number;
  endParagraph: number;
  rangeStart?: number;
  rangeEnd?: number;
  rect?: PagesBodyFragmentRect;
  columnCount?: number;
  startVisibleOffset?: number;
  endVisibleOffset?: number;
}

interface PagesInlineAttachment {
  characterIndex: number;
  anchorParagraphIndex: number;
  fragmentIndex: number;
  placement: 'standalone' | 'prefix' | 'suffix' | 'middle';
  flowPositioned: boolean;
  flowOffsetY: number;
  item: SlideItem;
  block: PagesBodyBlock;
  startsPage?: true;
  partitioned?: true;
}

interface PagesEstimatedAttachment {
  characterIndex: number;
  height: number;
  table?: { item: TableItem; rowHeights: number[]; headerRows: number; offsetY: number };
}

interface PagesSavedContinuation {
  cutoff: number;
  leadingTableCharacterIndex?: number;
  oversizedPartition?: { item: TableItem; measured: PagesTableMeasurement };
}

interface PagesEstimatedTablePart {
  pageIndex: number;
  rowStart: number;
  rowCount: number;
  headerRows: number;
  height: number;
}

interface PagesTablePart {
  pageIndex: number;
  item: TableItem;
  rowStart: number;
  headerRows: number;
}

interface PagesAttachmentPositionHint {
  pageIndex: number;
  x?: number;
  y?: number;
}

interface PagesTablePartitionHint {
  pageIndex: number;
  rowStart: number;
  rowCount: number;
  columnStart: number;
  columnCount: number;
}

interface PagesTextHintFragment {
  range: PagesTextRange;
  rect?: PagesBodyFragmentRect;
  columnCount?: number;
}

type PagesColumnLayout = { count: number; gap: number } | { tracks: Array<{ x: number; width: number }> };

interface PagesColumnStyleRange {
  start: number;
  end: number;
  columns: PagesColumnLayout;
}

interface PagesBodyLayoutContent {
  text: string;
  paragraphs: TextParagraph[];
  ranges: PagesParagraphRange[];
  drawables: ReadonlyArray<{
    characterIndex: number;
    attachmentItem: SlideItem;
    attachmentObject: AnyObject | undefined;
    attachmentHint?: PagesAttachmentPositionHint;
  }>;
}

interface PagesParagraphMetrics {
  heights: number[];
  offsets: number[];
  totalHeight: number;
}

interface PagesBodyFlowBlock extends PagesBodyBlock {
  fragmentIndex: number;
  firstParagraph?: number;
  startVisibleOffset?: number;
  flowPositioned?: boolean;
  flowOffsetY?: number;
}

interface PagesFloatingGroup {
  backgroundItems: SlideItem[];
  drawableItems: SlideItem[];
  foregroundItems: SlideItem[];
  blocks: PagesBodyBlock[];
  seenRecordIds: Set<number>;
}

interface PagesBodyAttribute {
  index: number;
  refId?: number;
}

interface PagesSectionState {
  sectionRefId?: number;
  sectionPageIndex: number;
  pageNumber: number;
  headerFooterSectionRefId?: number;
}

interface PagesHeaderFooterRefs {
  headers: readonly unknown[];
  footers: readonly unknown[];
}

interface PagesTemplateDecorations {
  background: FillStyle;
  leadingItems: SlideItem[];
  trailingItems: SlideItem[];
  blocks: PagesBodyBlock[];
}

interface PagesResolvedSection {
  sectionRefId?: number;
  section?: Record<string, unknown>;
  sectionTemplate?: Record<string, unknown>;
  pageTemplateRecord?: {
    id: number;
    typeName: string;
    value: Record<string, unknown>;
  };
  headerFooterRefs: PagesHeaderFooterRefs;
  documentPageNumber: number;
  sectionPageIndex: number;
  pageNumber: number;
  pageCount: number;
  headersEnabled: boolean;
  footersEnabled: boolean;
}

const DEFAULT_THEME: ThemeModel = {
  colors: {},
  fonts: {}
};

export function buildParsedDocument(context: SemanticBuildContext, options: SemanticBuildOptions = {}): ParsedIworkDocument {
  return withStyleResolutionCache(context.archive, () => buildDocument(context, options));
}

function buildDocument(context: SemanticBuildContext, options: SemanticBuildOptions): ParsedIworkDocument {
  switch (context.archive.type) {
    case 'key':
      return buildKeynoteDocument(context);
    case 'pages':
      return buildPagesDocument(context, options.pagesLayoutMeasurements);
    case 'numbers':
      return buildNumbersDocument(context, options.numbersSheetIndexes);
    default:
      throw new Error(`Unsupported iWork type: ${context.archive.type satisfies never}`);
  }
}

function buildKeynoteDocument(context: SemanticBuildContext): ParsedKeynoteDocument {
  const documentRecord = findRecordByType(context.archive, 'KN.DocumentArchive', ['show']);
  const show = getRecordValue<Record<string, unknown>>(context.archive, readField(documentRecord?.value as Record<string, unknown>, ['show']));
  const slideTree = asObject(readField(show, ['slideTree', 'slide_tree']));
  const slideNodeRefs = asArray<Record<string, unknown>>(readField(slideTree, ['slides']));
  const size = asObject(readField(show, ['size']));
  const defaultSlideNumberVisible = readField<boolean>(show, ['slideNumbersVisible', 'slide_numbers_visible']) === true;
  const width = Number(readField<number>(size, ['width']) ?? 1024);
  const height = Number(readField<number>(size, ['height']) ?? 768);

  const slides = slideNodeRefs
    .map((slideNodeRef, index) => {
      const slideNode = getRecordValue<Record<string, unknown>>(context.archive, slideNodeRef);
      const slide = getRecordValue<Record<string, unknown>>(context.archive, readField(slideNode, ['slide']));
      if (!slide) {
        return undefined;
      }
      return buildSlideCanvas(
        context,
        slideNode ?? {},
        slide,
        index,
        slideNodeRefs.length || 1,
        width,
        height,
        defaultSlideNumberVisible
      );
    })
    .filter((slide): slide is IworkCanvasModel => Boolean(slide));

  const presentation: ParsedPresentation = {
    size: {
      width,
      height
    },
    theme: DEFAULT_THEME,
    slides: slides.map((canvas) => canvas.slide),
    media: context.media,
    warnings: context.archive.warnings.slice()
  };

  return {
    kind: 'key',
    archive: context.archive,
    warnings: context.archive.warnings.slice(),
    presentation,
    slides
  };
}

function buildPagesDocument(
  context: SemanticBuildContext, measurements?: PagesLayoutMeasurements
): ParsedPagesDocument {
  const tableMeasurements = measurements?.tables;
  const tableSourceRows = new WeakMap<TableItem, PagesTableSourceRows | null>();
  const documentRecord = findRecordByType(context.archive, 'TP.DocumentArchive', ['bodyStorage', 'body_storage', 'pageWidth', 'page_width', 'pageHeight', 'page_height']);
  const documentValue = asObject(documentRecord?.value) ?? {};
  const layout = buildPagesLayout(documentValue);
  const bodyStorage = getRecordValue<Record<string, unknown>>(context.archive, readField(documentValue, ['bodyStorage', 'body_storage']));
  const sectionEntries = bodyStorage ? readPagesBodyAttributes(readField(bodyStorage, ['tableSection', 'table_section'])) : [];

  let bodyFrame: TextFrame | undefined;
  let hasBodyPageNumbers = false;
  let paragraphRanges: PagesParagraphRange[] = [];
  let paginatedBodyPages: PaginatedPagesBodyPage[] = [];
  let paragraphMetrics: PagesParagraphMetrics | undefined;
  const inlineAttachmentsByPage = new Map<number, PagesInlineAttachment[]>();
  const pencilItemsByPage = new Map<number, SlideItem[]>();
  const attachmentPositionHints = buildPagesAttachmentPositionHints(context.archive, documentValue);
  const tablePartitionHints = buildPagesTablePartitionHints(context.archive, documentValue);
  const layoutStatePageCount = resolvePagesLayoutStatePageCount(context.archive, documentValue);
  const continuationOffsets: Array<{ pageIndex: number; count: number }> = [];
  const shiftSavedPage = (pageIndex: number) => {
    let low = 0, high = continuationOffsets.length;
    while (low < high) {
      const middle = Math.floor((low + high) / 2);
      if (continuationOffsets[middle].pageIndex < pageIndex) low = middle + 1;
      else high = middle;
    }
    return pageIndex + (continuationOffsets[low - 1]?.count ?? 0);
  };

  if (bodyStorage) {
    const attachmentText = buildAttachmentTextMap(context.archive, bodyStorage, { documentName: context.archive.sourceName });
    bodyFrame = buildPagesBodyFrame(context.archive, bodyStorage, attachmentText);
    if (bodyFrame) {
      const bodyText = normalizeStorageText(readField(bodyStorage, ['text']));
      paragraphRanges = buildParagraphRanges(bodyText);
      if (attachmentText.size) setPagesRenderedOffsets(paragraphRanges, attachmentText);
      paragraphMetrics = buildPagesParagraphMetrics(bodyFrame.paragraphs, layout.bodyWidth);
      const attachmentEntries = collectStorageObjectAttributeEntries(bodyStorage, [
        'tableAttachment',
        'table_attachment',
        'tableSmartfield',
        'table_smartfield',
        'tableBookmark',
        'table_bookmark',
        'tableFootnote',
        'table_footnote',
        'tableRubyfield',
        'table_rubyfield'
      ])
        .map((entry, index) => ({
          record: getRecord(context.archive, readField(entry, ['object'])),
          index,
          characterIndex: Number(readField<number>(entry, ['characterIndex', 'character_index']) ?? 0)
        }))
        .sort((left, right) => left.characterIndex - right.characterIndex || left.index - right.index);

      hasBodyPageNumbers = attachmentEntries.some(({ record }) => record?.typeName === 'TSWP.NumberAttachmentArchive');
      let drawableOrder = 0;
      const drawableAttachments = attachmentEntries.flatMap(({ record, characterIndex }) => {
        const attachmentObject = asObject(record?.value);
        const drawableRecord = getRecord(context.archive, readField(attachmentObject, ['drawable']));
        const drawable = asObject(drawableRecord?.value);
        if (!drawable || !drawableRecord || !record) return [];
        const attachmentItem = buildDrawableItem(context, drawable, drawableOrder + 1);
        if (!attachmentItem) return [];
        drawableOrder += 1;
        const attachmentHint =
          attachmentPositionHints.get(record.id) ?? attachmentPositionHints.get(drawableRecord.id);
        return [{ characterIndex, attachmentObject, attachmentId: record.id, drawable, attachmentItem, attachmentHint,
          anchorParagraphIndex: findParagraphIndexForCharacter(paragraphRanges, characterIndex) }];
      });

      paginatedBodyPages = paginatePagesBodyParagraphsFromLayoutState(context.archive, documentValue, bodyStorage, layout, {
        text: bodyText, paragraphs: bodyFrame.paragraphs, ranges: paragraphRanges, drawables: drawableAttachments
      });
      const drawablePositions = new Set(drawableAttachments.map(attachment => attachment.characterIndex));
      const savedBodyEnd = resolveSavedPagesBodyEnd(bodyText, paginatedBodyPages, drawablePositions);
      if (savedBodyEnd == null) {
        pushUniqueArchiveWarning(context.archive, 'Pages saved layout ranges are inconsistent with the body; using estimated pagination.');
        paginatedBodyPages = [];
      }
      const estimatedStart = savedBodyEnd ?? 0;
      const resumeSavedBody = paginatedBodyPages.length > 0 && estimatedStart < bodyText.length;
      const estimatedParts = new Map<TableItem, PagesEstimatedTablePart[]>();
      const reflowedPartitions = new Map<string, PagesTablePart[]>();
      const preparedSourceRows = new WeakMap<TableItem, number[]>();
      const continuedRanges: PagesTextRange[] = [];
      const sectionStarts = new Set<number>();
      for (const entry of sectionEntries) {
        if (!entry.refId || entry.index <= 0) continue;
        const index = findParagraphIndexForCharacter(paragraphRanges, entry.index);
        const paragraph = paragraphRanges[index];
        if (index > 0 && /^\u0004*$/.test(paragraph.text.slice(0, entry.index - paragraph.start))) sectionStarts.add(index);
      }
      const estimateAttachments = (from: number, to: number, bodyWidth = layout.bodyWidth, bodyHeight = layout.bodyHeight) => {
        const estimatedAttachments = new Map<number, PagesEstimatedAttachment[]>();
        const first = findPagesDrawableIndex(drawableAttachments, from);
        for (let index = first; index < drawableAttachments.length; index += 1) {
          const { anchorParagraphIndex, characterIndex, attachmentHint, attachmentItem, attachmentObject, drawable } = drawableAttachments[index];
          if (characterIndex >= to) break;
          if (hasAbsolutePagesAttachmentPosition(attachmentHint)) continue;
          const offsetY = asFiniteNumber(readField(attachmentObject, ['vOffset', 'v_offset'])) ?? 0;
          const estimated: PagesEstimatedAttachment = { characterIndex, height: Math.max(0, attachmentItem.transform.height + offsetY) };
          if (attachmentItem.kind === 'table') {
            const left = asFiniteNumber(readField(attachmentObject, ['hOffset', 'h_offset'])) ?? 0;
            const width = fitPagesInlineTableWidth(attachmentItem.transform.width, bodyWidth, left);
            const model = getRecordValue(context.archive, readField(drawable, ['tableModel', 'table_model']));
            const originalHeaderRows = readField<boolean>(model, ['repeatingHeaderRowsEnabled', 'repeating_header_rows_enabled']) === true
              ? Number(readField<number>(model, ['numberOfHeaderRows', 'number_of_header_rows']) ?? 0) : 0;
            const measured = resolvePagesTableMeasurement(attachmentItem, width, tableMeasurements);
            const source = measurements?.sourceRows.get(attachmentItem.id);
            const measuredRows = source && Math.abs(source.width - width) <= 0.5
              ? attachmentItem.rows.map((_, row) => source.heights.get(row) ?? measured?.rows[row]) : measured?.rows;
            const { rowHeights, headerRows, height, sourceRows } = preparePagesTableRows(
              attachmentItem, width, bodyHeight, originalHeaderRows, measuredRows
            );
            if (sourceRows) preparedSourceRows.set(attachmentItem, sourceRows);
            estimated.height = Math.max(0, height + offsetY);
            estimated.table = { item: attachmentItem, rowHeights, headerRows, offsetY };
          }
          const paragraphAttachments = estimatedAttachments.get(anchorParagraphIndex) ?? [];
          paragraphAttachments.push(estimated);
          estimatedAttachments.set(anchorParagraphIndex, paragraphAttachments);
        }
        return estimatedAttachments;
      };
      if (!paginatedBodyPages.length || resumeSavedBody) {
        if (resumeSavedBody) {
          pushUniqueArchiveWarning(context.archive, 'Pages saved layout does not cover the end of the body; estimating the remaining pages.');
        }
        const firstPageIndex = resumeSavedBody ? Math.max(layoutStatePageCount, paginatedBodyPages.at(-1)!.pageIndex + 1) : 0;
        const estimatedPages = paginatePagesBodyParagraphs(
          bodyFrame.paragraphs, paragraphRanges, layout, sectionStarts, estimateAttachments(estimatedStart, bodyText.length),
          estimatedParts, estimatedStart, firstPageIndex
        );
        paginatedBodyPages = paginatedBodyPages.concat(estimatedPages);
      }

      const placeInlineAttachments = () => {
        inlineAttachmentsByPage.clear();
        pencilItemsByPage.clear();
        const tableOnlyPages = new Map<number, PaginatedPagesBodyPage>();
        let continuedIndex = 0;
        for (const [index, attachment] of drawableAttachments.entries()) {
          const attachmentOrder = index + 1;
          const { attachmentObject, attachmentId, drawable, attachmentItem, attachmentHint, anchorParagraphIndex } = attachment;
          const estimated = attachmentItem.kind === 'table' ? estimatedParts.get(attachmentItem) : undefined;
          let range = continuedRanges[continuedIndex];
          while (range && attachment.characterIndex >= range.location + range.length) range = continuedRanges[++continuedIndex];
          const continued = range != null && attachment.characterIndex >= range.location;
          const moved = continued || (resumeSavedBody && attachment.characterIndex >= estimatedStart);
          const savedHint = moved && !hasAbsolutePagesAttachmentPosition(attachmentHint) ? undefined : attachmentHint;
          const pageIndex = estimated?.[0]?.pageIndex ?? (savedHint && !continued
            ? Math.max(0, savedHint.pageIndex)
            : findBodyPageIndexForCharacter(paginatedBodyPages, attachment.characterIndex, anchorParagraphIndex));
          const pageInfo = findPagesBodyPageByIndex(paginatedBodyPages, pageIndex) ?? paginatedBodyPages[paginatedBodyPages.length - 1];
          if (!pageInfo && !savedHint) {
            continue;
          }

          const itemParts = attachmentItem.kind !== 'table' ? [] : estimated
            ? slicePagesTableItems(attachmentItem, estimated)
            : continued ? [] : resolvePagesTableItemPartitions(attachmentItem, pageIndex, tablePartitionHints)
              .flatMap(part => reflowedPartitions.get(part.item.id) ?? [part]);
          const renderParts = itemParts.length
            ? itemParts
            : [{ pageIndex, item: attachmentItem, rowStart: 0, headerRows: 0 }];
          const repeat = estimated?.find(part => part.headerRows > 0)?.headerRows ?? 0;
          const clippedHeader = repeat > 0 && attachmentItem.kind === 'table' && attachmentItem.cells.some(cell =>
            cell.row < repeat && cell.row + cell.rowSpan > repeat);

          for (let partIndex = 0; partIndex < renderParts.length; partIndex += 1) {
            const part = renderParts[partIndex];
            const startsPage = partIndex > 0;
            let partPageInfo = startsPage ? findPagesBodyPageByIndex(paginatedBodyPages, part.pageIndex) ?? tableOnlyPages.get(part.pageIndex) : pageInfo;
            if (!partPageInfo && startsPage && !estimated && pageInfo?.savedLayout && part.pageIndex < layoutStatePageCount) {
              const start = attachment.characterIndex + 1;
              partPageInfo = {
                pageIndex: part.pageIndex, savedLayout: true, leadingTableCharacterIndex: attachment.characterIndex,
                startParagraph: anchorParagraphIndex, endParagraph: anchorParagraphIndex,
                fragments: [{ startParagraph: anchorParagraphIndex, endParagraph: anchorParagraphIndex, rangeStart: start, rangeEnd: start }]
              };
              tableOnlyPages.set(part.pageIndex, partPageInfo);
            }
            const partHint = partIndex === 0 ? savedHint : { pageIndex: part.pageIndex };
            const fragmentIndex = startsPage ? 0
              : resolvePagesAttachmentFragmentIndex(partPageInfo, attachment.characterIndex, anchorParagraphIndex);
            positionPagesAttachmentItem({
              archive: context.archive,
              item: part.item,
              attachmentObject,
              attachmentHint: partHint,
              anchorFragment: partPageInfo?.fragments[fragmentIndex],
              startsPage,
              paragraphRanges,
              characterIndex: attachment.characterIndex,
              anchorParagraphIndex,
              paragraphCount: paragraphRanges.length,
              pageParagraphStart: partPageInfo?.startParagraph ?? 0,
              pageParagraphEnd: partPageInfo?.endParagraph ?? paragraphRanges.length,
              paragraphMetrics,
              layout
            });

            const flowPositioned = !hasAbsolutePagesAttachmentPosition(partHint);
            if (flowPositioned && partPageInfo && part.item.kind === 'table' && part.item.autoFitRows &&
              attachmentItem.kind === 'table' && !tableSourceRows.has(part.item)) {
              if (startsPage && !estimated && partPageInfo.savedLayout) {
                tableSourceRows.set(part.item, {
                  tableId: part.item.id, repeatedHeaders: 0, rows: part.item.rows.map((_, row) => row), savedPartition: true
                });
              } else if (!partPageInfo.savedLayout) {
                const source = preparedSourceRows.get(attachmentItem);
                const rows = part.item.rows.map((_, index) => {
                  if (index < part.headerRows && clippedHeader) return -1;
                  const row = index < part.headerRows ? index : part.rowStart + index - part.headerRows;
                  return source?.[row] ?? row;
                });
                // Split cell content can affect the heights of neighboring rows in the same table.
                const containsSplitCells = source && rows.some((row, index) => index >= part.headerRows && row < 0);
                tableSourceRows.set(part.item, !containsSplitCells && rows.some(row => row >= 0)
                  ? { tableId: attachmentItem.id, repeatedHeaders: part.headerRows, rows } : null);
              }
            }
            const pageBucket = inlineAttachmentsByPage.get(part.pageIndex) ?? [];
            pageBucket.push({
              characterIndex: attachment.characterIndex,
              anchorParagraphIndex,
              fragmentIndex,
              placement: resolvePagesAttachmentPlacement(paragraphRanges, attachment.characterIndex, anchorParagraphIndex),
              flowPositioned,
              flowOffsetY: flowPositioned && !startsPage
                ? Number(readField<number>(attachmentObject, ['vOffset', 'v_offset']) ?? 0)
                : 0,
              ...(startsPage ? { startsPage: true as const } : {}),
              ...(itemParts.length > 1 ? { partitioned: true as const } : {}),
              item: part.item,
              block: {
                id: `pages-attachment-${part.pageIndex + 1}-${attachmentOrder}-${partIndex + 1}`,
                kind: part.item.kind === 'table' ? 'table' : 'drawable',
                item: part.item,
                sourceRecordId: attachmentId
              }
            });
            inlineAttachmentsByPage.set(part.pageIndex, pageBucket);
          }

          const firstRenderPart = renderParts[0];
          const pencilItems = buildPencilAnnotationItems(context, drawable, attachmentOrder, firstRenderPart.item.transform);
          const pagePencilItems = pencilItemsByPage.get(pageIndex) ?? [];
          pagePencilItems.push(...pencilItems);
          pencilItemsByPage.set(pageIndex, pagePencilItems);
        }
        if (tableOnlyPages.size) {
          paginatedBodyPages = [...paginatedBodyPages, ...tableOnlyPages.values()].sort((left, right) => left.pageIndex - right.pageIndex);
        }
      };
      const sourceTransforms = paginatedBodyPages.some(page => page.savedLayout)
        ? drawableAttachments.map(({ attachmentItem }) => ({ ...attachmentItem.transform })) : [];
      placeInlineAttachments();
      const continuations = findSavedPagesContinuations(bodyFrame, paginatedBodyPages, paragraphRanges, layout, inlineAttachmentsByPage, tableMeasurements);
      if (continuations.size) {
        // Draft placement may have fitted an object to the original column.
        drawableAttachments.forEach(({ attachmentItem }, index) => Object.assign(attachmentItem.transform, sourceTransforms[index]));
        const previousParts = Array.from(estimatedParts.values());
        const repaired: PaginatedPagesBodyPage[] = [];
        let inserted = 0;
        for (const page of paginatedBodyPages) {
          const pageIndex = page.pageIndex + inserted;
          const plan = continuations.get(page.pageIndex);
          if (!plan) {
            repaired.push({ ...page, pageIndex });
            continue;
          }
          const { cutoff, leadingTableCharacterIndex, oversizedPartition } = plan;
          const prefix = oversizedPartition ? undefined
            : keepPagesBodyBefore(page, cutoff, paragraphRanges, bodyText.length, leadingTableCharacterIndex);
          const end = page.fragments.at(-1)!.rangeEnd!;
          const rect = oversizedPartition && page.fragments[0].rect;
          const continuationLayout = rect ? { ...layout, bodyWidth: rect.width,
            bodyHeight: Math.max(1, Math.min(rect.height, layout.bodyHeight - rect.y)) } : layout;
          const partition = oversizedPartition?.item;
          const prepared = partition && preparePagesTableRows(partition, partition.transform.width, continuationLayout.bodyHeight,
            0, oversizedPartition.measured.rows);
          const leading = partition && prepared && leadingTableCharacterIndex != null ? {
            characterIndex: leadingTableCharacterIndex,
            table: { item: partition, rowHeights: prepared.rowHeights, headerRows: 0, offsetY: 0 }
          } : undefined;
          const continuation = paginatePagesBodyParagraphs(
            bodyFrame.paragraphs, paragraphRanges, continuationLayout, sectionStarts,
            estimateAttachments(cutoff, end, continuationLayout.bodyWidth, continuationLayout.bodyHeight),
            estimatedParts, cutoff, pageIndex + Number(!!prefix), end, leading
          );
          if (!continuation.length) {
            repaired.push({ ...page, pageIndex });
            continue;
          }
          if (partition && prepared) {
            const parts = slicePagesTableItems(partition, estimatedParts.get(partition) ?? []);
            for (const part of parts) {
              const rows = part.item.rows.map((_, index) => prepared.sourceRows?.[part.rowStart + index] ?? part.rowStart + index);
              tableSourceRows.set(part.item, rows.some(row => row < 0) ? null
                : { tableId: partition.id, repeatedHeaders: 0, rows, savedPartition: true });
            }
            reflowedPartitions.set(partition.id, parts);
            if (rect) for (const nextPage of continuation) nextPage.fragments[0].rect = rect;
          }
          if (prefix) repaired.push({ ...prefix, pageIndex });
          for (const nextPage of continuation) repaired.push(nextPage);
          if (cutoff < end) continuedRanges.push({ location: cutoff, length: end - cutoff });
          inserted += continuation.length + Number(!!prefix) - 1;
          continuationOffsets.push({ pageIndex: page.pageIndex, count: inserted });
        }
        paginatedBodyPages = repaired;
        for (const hint of attachmentPositionHints.values()) hint.pageIndex = shiftSavedPage(hint.pageIndex);
        for (const hint of tablePartitionHints) hint.pageIndex = shiftSavedPage(hint.pageIndex);
        for (const parts of previousParts) {
          for (const part of parts) part.pageIndex = shiftSavedPage(part.pageIndex);
        }
        placeInlineAttachments();
      }
    }
  }

  const floatingGroups = buildPagesFloatingGroups(context, documentValue, shiftSavedPage);
  const bodyPagesByIndex = new Map(paginatedBodyPages.map(page => [page.pageIndex, page]));
  const totalPages = Math.max(
    1,
    (paginatedBodyPages.at(-1)?.pageIndex ?? -1) + 1,
    shiftSavedPage(layoutStatePageCount),
    maxPageIndexFromFloatingGroups(floatingGroups) + 1,
    maxPageIndexFromAttachmentHints(attachmentPositionHints) + 1
  );
  const settings = getRecordValue<Record<string, unknown>>(context.archive, readField(documentValue, ['settings']));
  const sectionStates = buildPagesSectionStates(
    context.archive,
    documentValue,
    bodyPagesByIndex,
    totalPages,
    sectionEntries,
    paragraphRanges
  );
  if (bodyStorage && hasBodyPageNumbers) {
    const attachmentText = buildAttachmentTextMap(context.archive, bodyStorage, {
      documentName: context.archive.sourceName,
      updatePageNumbers: true,
      pageCount: totalPages,
      pageNumberAt: (characterIndex) => {
        const paragraphIndex = findParagraphIndexForCharacter(paragraphRanges, characterIndex);
        const pageIndex = findBodyPageIndexForCharacter(paginatedBodyPages, characterIndex, paragraphIndex);
        return sectionStates[pageIndex]?.pageNumber;
      }
    });
    bodyFrame = buildPagesBodyFrame(context.archive, bodyStorage, attachmentText);
    setPagesRenderedOffsets(paragraphRanges, attachmentText);
    for (const page of paginatedBodyPages) {
      page.fragments = page.fragments.map(fragment => withPagesFragmentTextOffsets(fragment, paragraphRanges));
    }
  }
  const title = findFirstParagraphText(bodyFrame?.paragraphs ?? []) ?? 'Pages document';
  const pages: ParsedPagesPage[] = [];
  let savedPageIndex = 0;
  let previousHeaderFooterRefs: PagesHeaderFooterRefs | undefined;

  for (let pageIndex = 0; pageIndex < totalPages; pageIndex += 1) {
    const items: SlideItem[] = [];
    const blocks: PagesBodyBlock[] = [];
    const bodyFlows: NonNullable<IworkCanvasModel['bodyFlows']>[number][] = [];
    let savedBodyText: IworkCanvasModel['savedBodyText'];
    const bodyPage = bodyPagesByIndex.get(pageIndex);
    const inlineAttachments = (inlineAttachmentsByPage.get(pageIndex) ?? [])
      .slice()
      .sort((left, right) =>
        left.fragmentIndex - right.fragmentIndex ||
        left.anchorParagraphIndex - right.anchorParagraphIndex ||
        left.characterIndex - right.characterIndex
      );
    const floatingGroup = floatingGroups.get(pageIndex);
    const sectionContext = resolvePagesSectionForPage(
      context,
      pageIndex,
      totalPages,
      sectionStates[pageIndex],
      settings,
      previousHeaderFooterRefs
    );
    previousHeaderFooterRefs = sectionContext.headerFooterRefs;
    const templateDecorations = buildPagesTemplateDecorations(context, sectionContext, layout);

    if (templateDecorations.background.type !== 'none' || templateDecorations.background.color || templateDecorations.background.mediaId) {
      // applied below through canvas background; keep item layering separate
    }

    if (templateDecorations.leadingItems.length) {
      items.push(...templateDecorations.leadingItems);
    }

    if (floatingGroup) {
      items.push(...floatingGroup.backgroundItems);
    }

    if (bodyFrame && bodyPage) {
      const bodyFlowBlocks = buildPagesBodyFlowBlocksForPage(
        bodyFrame.paragraphs,
        bodyPage,
        inlineAttachments,
        paragraphRanges,
        pageIndex,
        documentRecord?.id
      );
      if (bodyPage.fitOversizedLine) {
        for (const block of bodyFlowBlocks) {
          block.paragraphs = block.paragraphs?.map(paragraph => fitPagesParagraphLine(paragraph, layout.bodyWidth, layout.bodyHeight));
        }
      }
      savedBodyText = appendPagesBodyItems(bodyFrame, bodyPage, layout, pageIndex, bodyFlowBlocks, items, bodyFlows, paragraphRanges);
      blocks.push(...bodyFlowBlocks.map(toPagesBodyBlock));
    } else if (inlineAttachments.length) {
      for (const attachment of inlineAttachments) {
        items.push(attachment.item);
        blocks.push(attachment.block);
      }
    }

    if (floatingGroup) {
      items.push(...floatingGroup.drawableItems, ...floatingGroup.foregroundItems);
      blocks.push(...floatingGroup.blocks);
    }

    const pagePencilItems = pencilItemsByPage.get(pageIndex);
    if (pagePencilItems?.length) {
      items.push(...pagePencilItems);
    }

    if (templateDecorations.trailingItems.length) {
      items.push(...templateDecorations.trailingItems);
    }
    if (templateDecorations.blocks.length) {
      blocks.push(...templateDecorations.blocks);
    }

    items.forEach((item, order) => {
      item.order = order;
    });

    const canvasTitle = pageIndex === 0
      ? findCanvasTitle(items) ?? title
      : findCanvasTitle(items) ?? `${title} ${pageIndex + 1}`;
    const canvas = createCanvasModel(
      `pages-${pageIndex + 1}`,
      pageIndex,
      layout.width,
      layout.height,
      items,
      canvasTitle,
      templateDecorations.background.type === 'none'
        ? { type: 'solid', color: '#ffffff', alpha: 1 }
        : templateDecorations.background
    );
    if (bodyFlows.length) canvas.bodyFlows = bodyFlows;
    if (savedBodyText?.length) canvas.savedBodyText = savedBodyText;
    if (bodyFlows.length) {
      const sources = items.flatMap((item, index) => {
        const source = item.kind === 'table' ? tableSourceRows.get(item) : undefined;
        return source !== undefined ? [[index, source] as const] : [];
      });
      if (sources.length) canvas.tableSourceRows = sources;
    }
    pages.push({
      id: canvas.id,
      index: pageIndex,
      width: layout.width,
      height: layout.height,
      canvas,
      blocks,
      ...(savedPageIndex < layoutStatePageCount && shiftSavedPage(savedPageIndex) === pageIndex ? { savedPageIndex: savedPageIndex++ } : {})
    });
  }

  return {
    kind: 'pages',
    archive: context.archive,
    warnings: context.archive.warnings.slice(),
    title,
    pages,
    media: context.media
  };
}

function buildPagesBodyFrame(
  archive: IworkArchiveIndex,
  storage: AnyObject,
  attachmentTextMap: ReadonlyMap<number, string[]>
): TextFrame | undefined {
  const frame = buildTextFrameFromStorage(archive, storage, {
    padding: { top: 0, right: 0, bottom: 0, left: 0 },
    attachmentTextMap
  });
  for (const paragraph of frame?.paragraphs ?? []) {
    for (const run of paragraph.runs) run.text = stripObjectMarker(run.text);
  }
  return frame;
}

function buildNumbersDocument(context: SemanticBuildContext, sheetIndexes?: Set<number>): ParsedNumbersDocument {
  const documentRecord = findRecordByType(context.archive, 'TN.DocumentArchive', ['sheets']);
  const documentValue = asObject(documentRecord?.value) ?? {};
  const sheetContext = { ...context, numbersFormatting: numbersDocumentFormatting(context.archive, documentValue) };
  const pageSize = asObject(readField(documentValue, ['pageSize', 'page_size']));
  const defaultPageWidth = Number(readField<number>(pageSize, ['width']) ?? 595);
  const defaultPageHeight = Number(readField<number>(pageSize, ['height']) ?? 842);
  const sheetRefs = asArray<Record<string, unknown>>(readField(documentValue, ['sheets']));
  const sheets = sheetRefs
    .map((sheetRef, index) =>
      !sheetIndexes || sheetIndexes.has(index)
        ? buildNumbersSheet(sheetContext, sheetRef, index, defaultPageWidth, defaultPageHeight)
        : buildNumbersSheetPlaceholder(context, sheetRef, index, defaultPageWidth, defaultPageHeight)
    )
    .filter((sheet): sheet is ParsedNumbersSheet => Boolean(sheet));

  return {
    kind: 'numbers',
    archive: context.archive,
    warnings: context.archive.warnings.slice(),
    sheets,
    media: context.media
  };
}

export function buildNumbersSheetAt(context: SemanticBuildContext, index: number): ParsedNumbersSheet | undefined {
  return withStyleResolutionCache(context.archive, () => buildNumbersSheetAtIndex(context, index));
}

function buildNumbersSheetAtIndex(context: SemanticBuildContext, index: number): ParsedNumbersSheet | undefined {
  const documentRecord = findRecordByType(context.archive, 'TN.DocumentArchive', ['sheets']);
  const documentValue = asObject(documentRecord?.value) ?? {};
  const pageSize = asObject(readField(documentValue, ['pageSize', 'page_size']));
  const sheetRef = asArray<Record<string, unknown>>(readField(documentValue, ['sheets']))[index];
  return buildNumbersSheet(
    { ...context, numbersFormatting: numbersDocumentFormatting(context.archive, documentValue) },
    sheetRef,
    index,
    Number(readField<number>(pageSize, ['width']) ?? 595),
    Number(readField<number>(pageSize, ['height']) ?? 842)
  );
}

function numbersDocumentFormatting(archive: IworkArchiveIndex, document: Record<string, unknown>): NumbersFormatting {
  const application = asObject(readField(document, ['super']));
  const settings = asObject(readField(application, ['super']));
  const customFormats = new Map<string, Record<string, unknown>>();
  for (const ref of [
    readField(document, ['customFormatList', 'custom_format_list']),
    readField(application, ['tablesCustomFormatList', 'tables_custom_format_list']),
    readField(application, ['customFormatList', 'custom_format_list'])
  ]) {
    const list = asObject(getRecordValue(archive, ref));
    const ids = asArray(readField(list, ['uuids']));
    const formats = asArray(readField(list, ['customFormats', 'custom_formats']));
    for (const [index, value] of formats.entries()) {
      const definition = asObject(value);
      const id = uuidToKey(ids[index]);
      if (id && definition) customFormats.set(id, definition);
    }
  }
  return {
    locale: readField<string>(settings, ['localeIdentifier', 'locale_identifier'])
      || readField<string>(settings, ['creationLocaleIdentifier', 'creation_locale_identifier']),
    symbols: asObject(readField(settings, ['formattingSymbols', 'formatting_symbols'])),
    customFormats: customFormats.size ? customFormats : undefined
  };
}

function buildNumbersSheetPlaceholder(
  context: SemanticBuildContext,
  sheetRef: unknown,
  index: number,
  width: number,
  height: number
): ParsedNumbersSheet | undefined {
  const sheet = getRecordValue<Record<string, unknown>>(context.archive, sheetRef);
  if (!sheet) {
    return undefined;
  }
  const name = String(readField<string>(sheet, ['name']) ?? `Sheet ${index + 1}`);
  const canvas = createCanvasModel(`numbers-sheet-${index + 1}`, index, width, height, [], name);
  return { id: canvas.id, index, name, canvas, tables: [], loaded: false };
}

function buildNumbersSheet(
  context: SemanticBuildContext,
  sheetRef: unknown,
  index: number,
  defaultPageWidth: number,
  defaultPageHeight: number
): ParsedNumbersSheet | undefined {
  const sheet = getRecordValue<Record<string, unknown>>(context.archive, sheetRef);
  if (!sheet) {
    return undefined;
  }

  const drawableRefs = asArray<Record<string, unknown>>(readField(sheet, ['drawableInfos', 'drawable_infos']));
  const items: SlideItem[] = [];
  const tables: TableItem[] = [];
  const printMargins = asObject(readField(sheet, ['printMargins', 'print_margins']));
  const leftMargin = Number(readField<number>(printMargins, ['left']) ?? 48);
  const topMargin = Number(readField<number>(printMargins, ['top']) ?? 48);
  const rightMargin = Number(readField<number>(printMargins, ['right']) ?? 48);
  const bottomMargin = Number(readField<number>(printMargins, ['bottom']) ?? 48);
  let maxWidth = defaultPageWidth;
  let maxHeight = defaultPageHeight;

  drawableRefs.forEach((drawableRef, order) => {
    const drawable = getRecordValue<Record<string, unknown>>(context.archive, drawableRef);
    if (!drawable) {
      return;
    }
    const item = buildDrawableItem(context, drawable, order);
    if (!item) {
      return;
    }
    items.push(item);
    if (item.kind === 'table') {
      tables.push(item);
    }
    maxWidth = Math.max(maxWidth, item.transform.x + item.transform.width + rightMargin);
    maxHeight = Math.max(maxHeight, item.transform.y + item.transform.height + bottomMargin);
  });

  const sheetName = String(readField<string>(sheet, ['name']) ?? `Sheet ${index + 1}`);
  const headerFooterItems = buildNumbersHeaderFooterItems(context, {
    sheet,
    orderOffset: items.length,
    pageWidth: defaultPageWidth,
    pageHeight: defaultPageHeight,
    leftMargin,
    topMargin,
    rightMargin,
    bottomMargin
  });
  for (const item of headerFooterItems) {
    items.push(item);
    maxWidth = Math.max(maxWidth, item.transform.x + item.transform.width + rightMargin);
    maxHeight = Math.max(maxHeight, item.transform.y + item.transform.height + bottomMargin);
  }

  const canvas = createCanvasModel(`numbers-sheet-${index + 1}`, index, maxWidth, maxHeight, items, sheetName);
  return {
    id: canvas.id,
    index,
    name: sheetName,
    canvas,
    loaded: true,
    tables: tables.map((table) => ({
      id: table.id,
      item: table
    }))
  };
}

function buildSlideCanvas(
  context: SemanticBuildContext,
  slideNode: Record<string, unknown>,
  slide: Record<string, unknown>,
  index: number,
  pageCount: number,
  width: number,
  height: number,
  defaultSlideNumberVisible = false
): IworkCanvasModel {
  const background = resolveKeynoteSlideBackground(context.archive, slide);
  const localSlideNumberVisible = readField<boolean>(slideNode, ['isSlideNumberVisible', 'is_slide_number_visible']);
  const items = buildKeynoteSlideItems(context, slide, {
    pageNumber: index + 1,
    pageCount,
    slideNumberVisible: localSlideNumberVisible ?? defaultSlideNumberVisible
  });
  items.forEach((item, order) => {
    item.order = order;
  });

  const title = findCanvasTitle(items) ?? `Slide ${index + 1}`;
  return createCanvasModel(`key-slide-${index + 1}`, index, width, height, items, title, background);
}

function resolveKeynoteSlideBackground(
  archive: IworkArchiveIndex,
  slide: Record<string, unknown>,
  visitedSlideIds = new Set<number>()
): FillStyle {
  const slideRecordId = findRecordIdByValue(archive, slide);
  if (slideRecordId != null) {
    if (visitedSlideIds.has(slideRecordId)) {
      return { type: 'solid', color: '#ffffff', alpha: 1 };
    }
    visitedSlideIds.add(slideRecordId);
  }

  const directBackground = readKeynoteSlideBackground(archive, slide);
  if (directBackground.type !== 'none') {
    return directBackground;
  }

  const templateSlide = getRecordValue<Record<string, unknown>>(archive, readField(slide, ['templateSlide', 'template_slide']));
  if (templateSlide) {
    const templateBackground = resolveKeynoteSlideBackground(archive, templateSlide, visitedSlideIds);
    if (templateBackground.type !== 'none') {
      return templateBackground;
    }
  }

  return { type: 'solid', color: '#ffffff', alpha: 1 };
}

function readKeynoteSlideBackground(archive: IworkArchiveIndex, slide: Record<string, unknown>): FillStyle {
  const style = resolveMergedStyle(archive, readField(slide, ['style']));
  const slideProperties = asObject(readField(style, ['slideProperties', 'slide_properties']));
  return fillFromValue(readField(slideProperties, ['fill']));
}

interface KeynoteBuildOptions {
  pageNumber?: number;
  pageCount?: number;
  slideNumberVisible?: boolean;
}

interface DrawableBuildOptions {
  attachmentContext?: {
    pageNumber?: number;
    pageCount?: number;
    pageNumberText?: string;
    pageCountText?: string;
    documentName?: string;
  };
  slide?: Record<string, unknown>;
}

type DrawableRenderItem = SlideItem & {
  opacity?: number;
};

function buildKeynoteSlideItems(
  context: SemanticBuildContext,
  slide: Record<string, unknown>,
  options: KeynoteBuildOptions,
  visitedSlideIds = new Set<number>(),
  suppressedPlaceholderKinds = new Set<number>(),
  hiddenPlaceholderKinds = new Set<number>(),
  seenDrawableIds = new Set<number>()
): SlideItem[] {
  const slideRecordId = findRecordIdByValue(context.archive, slide);
  if (slideRecordId != null) {
    if (visitedSlideIds.has(slideRecordId)) {
      return [];
    }
    visitedSlideIds.add(slideRecordId);
  }

  const items: SlideItem[] = [];
  const localPlaceholderKinds = collectKeynotePlaceholderKinds(context.archive, slide, options.slideNumberVisible);
  const localHiddenPlaceholderKinds = collectHiddenKeynotePlaceholderKinds(context.archive, slide, options.slideNumberVisible);
  const templateSlide = getRecordValue<Record<string, unknown>>(context.archive, readField(slide, ['templateSlide', 'template_slide']));
  if (templateSlide) {
    items.push(
      ...buildKeynoteSlideItems(
        context,
        templateSlide,
        {
          ...options,
          slideNumberVisible: false
        },
        visitedSlideIds,
        new Set([...suppressedPlaceholderKinds, ...localPlaceholderKinds]),
        new Set([...hiddenPlaceholderKinds, ...localHiddenPlaceholderKinds]),
        seenDrawableIds
      )
    );
  }

  const pushDrawable = (drawableRef: unknown, depth = 0, inheritedOpacity?: number) => {
    const drawableRecord = getRecord(context.archive, drawableRef);
    const drawable = asObject(drawableRecord?.value);
    if (!drawable || depth > 16 || (drawableRecord?.id != null && seenDrawableIds.has(drawableRecord.id))) {
      return;
    }

    const freehand = resolveFreehandDrawingArchive(drawable);
    const freehandOpacity = normalizeDrawableOpacity(Number(readField<number>(freehand, ['opacity']) ?? NaN));
    const effectiveOpacity = combineDrawableOpacity(inheritedOpacity, freehandOpacity);
    let item = buildDrawableItem(context, drawable, items.length, {
      slide,
      attachmentContext: {
        pageNumber: options.pageNumber,
        pageCount: options.pageCount,
        pageNumberText: options.pageNumber != null ? String(options.pageNumber) : undefined,
        pageCountText: options.pageCount != null ? String(options.pageCount) : undefined
      }
    });
    if (!item) {
      // Containers have no placeholder visibility to filter, so mark them
      // before descending to protect against malformed cyclic child graphs.
      if (drawableRecord?.id != null) {
        seenDrawableIds.add(drawableRecord.id);
      }
      if (context.archive.type === 'key') {
        items.push(...buildPencilAnnotationItems(context, drawable, items.length, undefined, effectiveOpacity));
      }
    } else {
      const placeholderKind = drawableRecord?.typeName === 'KN.PlaceholderArchive'
        ? Number(readField<number>(drawable, ['kind']) ?? -1)
        : undefined;
      if (
        drawableRecord?.typeName === 'KN.PlaceholderArchive' &&
        (
          hiddenPlaceholderKinds.has(placeholderKind ?? -1) ||
          localHiddenPlaceholderKinds.has(placeholderKind ?? -1) ||
          suppressedPlaceholderKinds.has(placeholderKind ?? -1) ||
          !shouldIncludeKeynotePlaceholderItem(item)
        )
      ) {
        return;
      }

      if (drawableRecord?.id != null) {
        seenDrawableIds.add(drawableRecord.id);
      }
      if (effectiveOpacity != null) {
        const itemOpacity = normalizeDrawableOpacity((item as DrawableRenderItem).opacity ?? NaN);
        item = {
          ...item,
          opacity: combineDrawableOpacity(itemOpacity, effectiveOpacity)
        } as DrawableRenderItem;
      }
      items.push(item);
      if (context.archive.type === 'key') {
        items.push(...buildPencilAnnotationItems(context, drawable, items.length, undefined, effectiveOpacity));
      }
    }

    const childRefs = asArray<unknown>(readField(drawable, ['children']));
    for (const childRef of childRefs) {
      pushDrawable(childRef, depth + 1, effectiveOpacity);
    }

    // Older archives may expose only the spacer shape on a freehand group.
    // It still carries the drawing geometry and is a useful fallback when the
    // group child list is absent.
    if (!childRefs.length) {
      const spacerShape = freehand && readField(freehand, ['spacerShape', 'spacer_shape']);
      if (spacerShape != null) {
        pushDrawable(spacerShape, depth + 1, effectiveOpacity);
      }
    }
  };

  const drawableRefs = asArray<Record<string, unknown>>(readField(slide, ['drawablesZOrder', 'drawables_z_order'])).length
    ? asArray<Record<string, unknown>>(readField(slide, ['drawablesZOrder', 'drawables_z_order']))
    : asArray<Record<string, unknown>>(readField(slide, ['ownedDrawables', 'owned_drawables']));
  for (const drawableRef of drawableRefs) {
    pushDrawable(drawableRef);
  }

  const placeholderRefs = collectKeynotePlaceholderRefs(slide, options.slideNumberVisible);
  for (const placeholderRef of placeholderRefs) {
    pushDrawable(placeholderRef);
  }

  const objectPlaceholderInfoRefs = collectKeynoteObjectPlaceholderInfoRefs(slide);
  for (const infoRef of objectPlaceholderInfoRefs) {
    pushDrawable(infoRef);
  }

  const syntheticPlaceholderItems = buildSyntheticKeynotePlaceholderItems(context.archive, slide, items.length, options);
  for (const item of syntheticPlaceholderItems) {
    items.push(item);
  }

  return items;
}

function createCanvasModel(
  id: string,
  index: number,
  width: number,
  height: number,
  items: SlideItem[],
  title: string,
  background: FillStyle = { type: 'solid', color: '#ffffff', alpha: 1 }
): IworkCanvasModel {
  const slide: SlideModel = {
    id,
    index,
    title,
    background,
    width,
    height,
    items,
    warnings: []
  };
  return {
    id,
    title,
    width,
    height,
    slide
  };
}

function findRecordByType(archive: IworkArchiveIndex, typeName: string, requiredKeys: string[] = []) {
  const records = Object.values(archive.records).filter((record) => record.typeName === typeName);
  return (
    records.find((record) => {
      const value = asObject(record.value);
      return value ? requiredKeys.every((key) => key in value) : false;
    }) ?? records[0]
  );
}

function buildPencilAnnotationItems(
  context: SemanticBuildContext,
  drawable: Record<string, unknown>,
  orderOffset: number,
  parentTransformOverride?: ItemTransform,
  inheritedOpacity?: number
): SlideItem[] {
  const annotationRefs = asArray<unknown>(readFieldInDrawableChain(drawable, ['pencilAnnotations', 'pencil_annotations']));
  if (!annotationRefs.length) {
    return [];
  }

  const parentTransform = parentTransformOverride ?? transformFromGeometry(resolveDrawableGeometry(drawable));
  const items: SlideItem[] = [];
  annotationRefs.forEach((annotationRef, annotationIndex) => {
    const annotation = asObject(getRecordValue(context.archive, annotationRef)) ?? asObject(annotationRef);
    const storageRef = annotation && readField(annotation, ['pencilAnnotationStorage', 'pencil_annotation_storage']);
    const storage = asObject(getRecordValue(context.archive, storageRef)) ?? asObject(storageRef);
    if (!storage) {
      return;
    }

    const origin = asObject(readField(storage, ['strokesBoundingBoxOrigin', 'strokes_bounding_box_origin'])) ??
      asObject(readField(storage, ['strokePointsFrameOrigin', 'stroke_points_frame_origin'])) ??
      asObject(readField(storage, ['renderedFrameOrigin', 'rendered_frame_origin'])) ??
      { x: 0, y: 0 };
    const size = asObject(readField(storage, ['strokesBoundingBoxSize', 'strokes_bounding_box_size'])) ??
      asObject(readField(storage, ['strokePointsFrameSize', 'stroke_points_frame_size'])) ??
      asObject(readField(storage, ['renderedFrameSize', 'rendered_frame_size'])) ??
      { width: parentTransform.width, height: parentTransform.height };
    const rawWidth = Number(readField<number>(size, ['width']) ?? parentTransform.width);
    const rawHeight = Number(readField<number>(size, ['height']) ?? parentTransform.height);
    const width = Number.isFinite(rawWidth) && rawWidth > 0 ? rawWidth : Math.max(parentTransform.width, 1);
    const height = Number.isFinite(rawHeight) && rawHeight > 0 ? rawHeight : Math.max(parentTransform.height, 1);
    const path = asObject(readField(storage, ['drawingPath', 'drawing_path']));
    const geometry = path
      ? pathSourceToGeometry({ path, naturalSize: { width, height } }, width, height)
      : undefined;

    const rasterizedDataId = getRefId(readField(storage, ['rasterizedImage', 'rasterized_image']));
    if (!geometry && rasterizedDataId != null && (context.media[String(rasterizedDataId)] || context.indexedMedia?.has(String(rasterizedDataId)))) {
      items.push({
        id: `pencil-image-${orderOffset}-${annotationIndex + 1}`,
        kind: 'image',
        name: 'Pencil annotation',
        order: orderOffset + annotationIndex,
        groupPath: [],
        transform: {
          x: parentTransform.x + Number(readField<number>(origin, ['x']) ?? 0),
          y: parentTransform.y + Number(readField<number>(origin, ['y']) ?? 0),
          width,
          height,
          rotation: 0,
          flipH: false,
          flipV: false
        },
        fill: { type: 'none' },
        mediaId: String(rasterizedDataId),
        ...(inheritedOpacity != null ? { opacity: inheritedOpacity } : {})
      });
      return;
    }
    if (!geometry) {
      return;
    }

    const color = asObject(readField(storage, ['penColor', 'pen_color']));
    const rawToolType = Number(readField<number>(storage, ['toolType', 'tool_type']) ?? 0);
    const toolType = Number.isFinite(rawToolType) ? rawToolType : 0;
    const rawDrawingScale = Number(readField<number>(storage, ['pencilAnnotationDrawingScale', 'pencil_annotation_drawing_scale']) ?? 1);
    const drawingScale = Number.isFinite(rawDrawingScale) && rawDrawingScale > 0 ? rawDrawingScale : 1;
    const storedWidth = Number(readField<number>(storage, ['penWidth', 'pen_width', 'strokeWidth', 'stroke_width']) ?? NaN);
    const baseWidth = Number.isFinite(storedWidth) && storedWidth > 0
      ? storedWidth
      : toolType === 1
        ? 8
        : 2;
    const alpha = Number(((colorAlpha(color) ?? 1) * (toolType === 1 ? 0.38 : 1)).toFixed(4));
    const item: SlideItem = {
      id: `pencil-${orderOffset}-${annotationIndex + 1}`,
      kind: 'shape',
      name: 'Pencil annotation',
      order: orderOffset + annotationIndex,
      groupPath: [],
      transform: {
        x: parentTransform.x + Number(readField<number>(origin, ['x']) ?? 0),
        y: parentTransform.y + Number(readField<number>(origin, ['y']) ?? 0),
        width,
        height,
        rotation: 0,
        flipH: false,
        flipV: false
      },
      fill: { type: 'none' },
      line: {
        color: colorToHex(color, '#111827'),
        alpha,
        width: Math.max(1, Math.min(32, baseWidth * drawingScale)),
        lineCap: 'round',
        lineJoin: 'round'
      },
      shapeType: pencilGeometryLooksOpen(geometry) ? 'line' : 'unknown',
      geometry
    } as DrawableRenderItem;
    if (inheritedOpacity != null) {
      (item as DrawableRenderItem).opacity = inheritedOpacity;
    }
    items.push(item);
  });

  return items;
}

function resolveFreehandDrawingArchive(drawable: Record<string, unknown>): Record<string, unknown> | undefined {
  return asObject(readField(drawable, [
    'freehandDrawingArchive',
    'freehand_drawing_archive',
    '.TSD.freehandDrawingArchive'
  ]));
}

function combineDrawableOpacity(parent: number | undefined, local: number | undefined): number | undefined {
  if (parent == null) {
    return local;
  }
  if (local == null) {
    return parent;
  }
  return Number(Math.max(0, Math.min(1, parent * local)).toFixed(4));
}

function pencilGeometryLooksOpen(geometry: NonNullable<Extract<SlideItem, { kind: 'shape' }>['geometry']>): boolean {
  if (geometry.type !== 'custom') {
    return false;
  }
  return geometry.paths.some((path) => path.commands.some((command) => command.type !== 'Z')) &&
    geometry.paths.every((path) => path.commands.every((command) => command.type !== 'Z'));
}

function buildDrawableItem(
  context: SemanticBuildContext,
  drawable: Record<string, unknown>,
  order: number,
  options: DrawableBuildOptions = {}
): DrawableRenderItem | undefined {
  const geometry = resolveDrawableGeometry(drawable);
  const transform = transformFromGeometry(geometry);
  const style = resolveMergedStyle(context.archive, resolveDrawableStyleRef(drawable));
  const shapeProps = asObject(readField(style, ['shapeProperties', 'shape_properties']));
  const mediaProps = asObject(readField(style, ['mediaProperties', 'media_properties']));
  const fill = fillFromValue(
    readField(shapeProps, ['fill']) ??
    readField(mediaProps, ['fill']) ??
    readFieldInStyleChain(style, ['shapeProperties', 'shape_properties'], ['fill']) ??
    readFieldInStyleChain(style, ['mediaProperties', 'media_properties'], ['fill']) ??
    readFieldInStyleChain(style, ['graphicStyle', 'graphic_style'], ['fill']) ??
    readFieldInStyleChain(style, [], ['fill']) ??
    readField(style, ['fill'])
  );
  const line = lineFromValue(
    readField(shapeProps, ['stroke']) ??
    readField(mediaProps, ['stroke']) ??
    readFieldInStyleChain(style, ['shapeProperties', 'shape_properties'], ['stroke']) ??
    readFieldInStyleChain(style, ['mediaProperties', 'media_properties'], ['stroke']) ??
    readFieldInStyleChain(style, ['graphicStyle', 'graphic_style'], ['stroke']) ??
    readFieldInStyleChain(style, [], ['stroke']) ??
    readField(style, ['stroke'])
  );
  const shadow = shadowFromValue(
    readField(shapeProps, ['shadow']) ??
    readField(mediaProps, ['shadow']) ??
    readFieldInStyleChain(style, ['shapeProperties', 'shape_properties'], ['shadow']) ??
    readFieldInStyleChain(style, ['mediaProperties', 'media_properties'], ['shadow']) ??
    readFieldInStyleChain(style, ['graphicStyle', 'graphic_style'], ['shadow']) ??
    readFieldInStyleChain(style, [], ['shadow']) ??
    readField(style, ['shadow'])
  );
  const opacity = normalizeDrawableOpacity(
    readField<number>(shapeProps, ['opacity']) ??
    readField<number>(mediaProps, ['opacity']) ??
    asFiniteNumber(readFieldInStyleChain(style, ['shapeProperties', 'shape_properties'], ['opacity'])) ??
    asFiniteNumber(readFieldInStyleChain(style, ['mediaProperties', 'media_properties'], ['opacity'])) ??
    asFiniteNumber(readFieldInStyleChain(style, ['graphicStyle', 'graphic_style'], ['opacity'])) ??
    asFiniteNumber(readFieldInStyleChain(style, [], ['opacity'])) ??
    readField<number>(style, ['opacity'])
  );
  const storageRef = resolveDrawableStorageRef(drawable);
  const pathSource = resolveDrawablePathSource(drawable);
  const geometryModel = pathSourceToGeometry(pathSource, transform.width, transform.height);
  const paragraphStyleRef = readField(shapeProps, ['paragraphStyle', 'paragraph_style']);
  const padding = paddingFromValue(readField(shapeProps, ['padding']), 4);
  const verticalAlign = verticalAlignFromValue(readField(shapeProps, ['verticalAlignment', 'vertical_alignment']));
  const textFrame = buildTextFrameFromStorage(context.archive, storageRef, {
    defaultParagraphStyleRef: paragraphStyleRef,
    padding,
    verticalAlign,
    shapeProperties: shapeProps,
    attachmentContext: {
      ...options.attachmentContext,
      documentName: options.attachmentContext?.documentName ?? context.archive.sourceName
    }
  }) ??
    buildKeynotePlaceholderFallbackTextFrame(drawable, options.slide, padding, verticalAlign) ??
    buildKeynoteInstructionalTextFrame(context.archive, drawable, options.slide, padding, verticalAlign);
  const drawableRecord = findRecordByValue(context.archive, drawable);
  const hyperlink = resolveDrawableHyperlink(drawable);
  const shapeType = resolveShapeType(pathSource);
  const lineLayout = context.archive.type === 'key' &&
    shapeType === 'line' &&
    (transform.width <= 0 || transform.height <= 0) &&
    !textFrameHasVisibleText(textFrame)
    ? buildKeynoteLineLayout(transform, line?.width)
    : undefined;
  const isAutoSizedTextBox = readFieldInDrawableChain(drawable, ['isTextBox', 'is_text_box']) === true &&
    Boolean(textFrame) &&
    (transform.width <= 0 || transform.height <= 0);
  const normalizedTransform = lineLayout || isAutoSizedTextBox
    ? transform
    : ensureDrawableTextTransform(transform, textFrame);

  if (readField(drawable, ['tableModel', 'table_model'])) {
    return buildTableItem(context.archive, drawable, normalizedTransform, order, undefined, context.numbersFormatting);
  }

  const dataId = resolveDrawableDataId(drawable, drawableRecord);
  if (dataId) {
    const media = context.media[dataId] ?? context.indexedMedia?.get(dataId)?.asset;
    const mediaType = resolveDrawableMediaType(drawable, media);
    if (mediaType === 'video' || mediaType === 'audio') {
      return {
        id: `media-${dataId}-${order}`,
        kind: 'media',
        name: media?.path ?? dataId,
        order,
        groupPath: [],
        transform: normalizedTransform,
        fill,
        line,
        shadow,
        href: hyperlink,
        opacity,
        mediaType,
        mediaId: dataId,
        posterMediaId: resolveDrawableThumbnailDataId(drawable, drawableRecord, dataId)
      };
    }
    return {
      id: `image-${dataId}-${order}`,
      kind: 'image',
      name: media?.path ?? dataId,
      order,
      groupPath: [],
      transform: normalizedTransform,
      fill,
      line,
      shadow,
      href: hyperlink,
      opacity,
      mediaId: dataId
    };
  }

  if (lineLayout) {
    return {
      id: `shape-${order}-${lineLayout.transform.x}-${lineLayout.transform.y}`,
      kind: 'shape',
      name: String(readField<string>(drawable, ['title']) ?? 'Shape'),
      order,
      groupPath: [],
      transform: lineLayout.transform,
      fill: { type: 'none' },
      line,
      shadow,
      href: hyperlink,
      opacity,
      shapeType: 'line',
      geometry: lineLayout.geometry
    };
  }

  if (isAutoSizedTextBox && textFrame) {
    return {
      id: `text-${order}-${transform.x}-${transform.y}`,
      kind: 'text',
      name: 'Text',
      order,
      groupPath: [],
      transform,
      fill: { type: 'none' },
      line: undefined,
      shadow: undefined,
      href: hyperlink,
      opacity,
      textFrame
    };
  }

  if (textFrame && (transform.width <= 0 || transform.height <= 0)) {
    return {
      id: `text-${order}-${normalizedTransform.x}-${normalizedTransform.y}`,
      kind: 'text',
      name: 'Text',
      order,
      groupPath: [],
      transform: normalizedTransform,
      fill: {
        type: 'none'
      },
      line,
      shadow,
      href: hyperlink,
      opacity,
      textFrame
    };
  }

  const hasVisibleShapeAppearance = fill.type !== 'none' || Boolean(line) || Boolean(shadow);

  if (
    geometryModel ||
    pathSource ||
    (transform.width > 0 && transform.height > 0 && hasVisibleShapeAppearance)
  ) {
    return {
      id: `shape-${order}-${normalizedTransform.x}-${normalizedTransform.y}`,
      kind: 'shape',
      name: String(readField<string>(drawable, ['title']) ?? 'Shape'),
      order,
      groupPath: [],
      transform: normalizedTransform,
      fill,
      line,
      shadow,
      href: hyperlink,
      opacity,
      shapeType,
      geometry: geometryModel,
      textFrame
    };
  }

  if (textFrame) {
    return {
      id: `text-${order}-${transform.x}-${transform.y}`,
      kind: 'text',
      name: 'Text',
      order,
      groupPath: [],
      transform: normalizedTransform,
      fill: {
        type: 'none'
      },
      line,
      shadow,
      href: hyperlink,
      opacity,
      textFrame
    };
  }

  return undefined;
}

function buildNumbersHeaderFooterItems(
  context: SemanticBuildContext,
  options: {
    sheet: Record<string, unknown>;
    orderOffset: number;
    pageWidth: number;
    pageHeight: number;
    leftMargin: number;
    topMargin: number;
    rightMargin: number;
    bottomMargin: number;
  }
): SlideItem[] {
  const {
    sheet,
    orderOffset,
    pageWidth,
    pageHeight,
    leftMargin,
    topMargin,
    rightMargin,
    bottomMargin
  } = options;
  const showsPageNumbers = readField<boolean>(sheet, ['showPageNumbers', 'show_page_numbers']) !== false;
  const usesStartPageNumber = readField<boolean>(sheet, ['usingStartPageNumber', 'using_start_page_number']) === true;
  const pageNumber = usesStartPageNumber
    ? Number(readField<number>(sheet, ['startPageNumber', 'start_page_number']) ?? 1)
    : 1;
  const headerInset = Number(readField<number>(sheet, ['pageHeaderInset', 'page_header_inset']) ?? 18);
  const footerInset = Number(readField<number>(sheet, ['pageFooterInset', 'page_footer_inset']) ?? 18);
  const pageCount = Math.max(1, Number(readField<number>(sheet, ['lastPageCount', 'last_page_count']) ?? 1));
  const slots: Array<{
    section: 'header' | 'footer';
    ref: unknown;
    slotIndex: number;
    y: number;
  }> = [];

  asArray<unknown>(readField(sheet, ['headers'])).forEach((ref, slotIndex) => {
    slots.push({
      section: 'header',
      ref,
      slotIndex,
      y: Math.max(0, topMargin - headerInset)
    });
  });
  asArray<unknown>(readField(sheet, ['footers'])).forEach((ref, slotIndex) => {
    slots.push({
      section: 'footer',
      ref,
      slotIndex,
      y: Math.max(0, pageHeight - bottomMargin + 6)
    });
  });

  const items: SlideItem[] = [];
  for (const slot of slots) {
    const storage = getRecordValue<Record<string, unknown>>(context.archive, slot.ref);
    if (!storage) {
      continue;
    }
    const textFrame = buildTextFrameFromStorage(context.archive, storage, {
      padding: {
        top: 0,
        right: 0,
        bottom: 0,
        left: 0
      },
      verticalAlign: slot.section === 'header' ? 'top' : 'bottom',
      attachmentContext: {
        documentName: context.archive.sourceName,
        pageNumber,
        pageCount,
        pageNumberText: showsPageNumbers ? undefined : '',
        pageCountText: showsPageNumbers ? undefined : ''
      }
    });
    if (!textFrame || !hasVisibleTextFrame(textFrame)) {
      continue;
    }

    const slotWidth = Math.max((pageWidth - leftMargin - rightMargin) / 3, 48);
    const x = leftMargin + slot.slotIndex * slotWidth;
    const align: TextParagraph['align'] =
      slot.slotIndex === 0 ? 'left' : slot.slotIndex === 1 ? 'center' : 'right';
    const paragraphs = textFrame.paragraphs.map((paragraph) => ({
      ...paragraph,
      align: paragraph.align ?? align
    }));
    items.push({
      id: `numbers-${slot.section}-${slot.slotIndex}`,
      kind: 'text',
      name: `${slot.section}-${slot.slotIndex}`,
      order: orderOffset + items.length,
      groupPath: [],
      transform: {
        x,
        y: slot.y,
        width: slotWidth,
        height: 24,
        rotation: 0,
        flipH: false,
        flipV: false
      },
      fill: {
        type: 'none'
      },
      textFrame: {
        ...textFrame,
        paragraphs
      }
    });
  }

  return items;
}

function buildPagesLayout(documentValue: Record<string, unknown>): PagesLayoutModel {
  // Match Pages' A4 fallback used by the reference iwork-converter when an
  // older archive omits document paper dimensions.
  const width = Number(readField<number>(documentValue, ['pageWidth', 'page_width']) ?? 595);
  const height = Number(readField<number>(documentValue, ['pageHeight', 'page_height']) ?? 842);
  const leftMargin = Number(readField<number>(documentValue, ['leftMargin', 'left_margin']) ?? 72);
  const rightMargin = Number(readField<number>(documentValue, ['rightMargin', 'right_margin']) ?? 72);
  const topMargin = Number(readField<number>(documentValue, ['topMargin', 'top_margin']) ?? 72);
  const bottomMargin = Number(readField<number>(documentValue, ['bottomMargin', 'bottom_margin']) ?? 72);
  const headerMargin = readField<number>(documentValue, ['headerMargin', 'header_margin']);
  const footerMargin = readField<number>(documentValue, ['footerMargin', 'footer_margin']);
  return {
    width,
    height,
    leftMargin,
    rightMargin,
    topMargin,
    bottomMargin,
    headerMargin: Number.isFinite(headerMargin) ? headerMargin : undefined,
    footerMargin: Number.isFinite(footerMargin) ? footerMargin : undefined,
    bodyWidth: Math.max(width - leftMargin - rightMargin, 1),
    bodyHeight: Math.max(height - topMargin - bottomMargin, 1)
  };
}

function paginatePagesBodyParagraphsFromLayoutState(
  archive: IworkArchiveIndex,
  documentValue: Record<string, unknown>,
  bodyStorage: Record<string, unknown>,
  layout: PagesLayoutModel,
  content: PagesBodyLayoutContent
): PaginatedPagesBodyPage[] {
  const { text: bodyText, ranges: paragraphRanges } = content;
  if (!bodyText.length || !paragraphRanges.length) {
    return [];
  }

  const layoutState = resolvePagesLayoutState(archive, documentValue);
  const sectionHints = asArray<Record<string, unknown>>(readField(layoutState, ['sectionHints', 'section_hints']));
  if (!sectionHints.length) {
    return [];
  }

  const pages: PaginatedPagesBodyPage[] = [];
  const textLength = bodyText.length;
  const columnStyles = readPagesColumnStyles(archive, bodyStorage, textLength);

  for (const sectionHint of sectionHints) {
    const startPageIndex = Math.max(0, Number(readField<number>(sectionHint, ['startPageIndex', 'start_page_index']) ?? 0));
    const pageHints = asArray<Record<string, unknown>>(readField(sectionHint, ['pageHints', 'page_hints']));

    for (let localPageIndex = 0; localPageIndex < pageHints.length; localPageIndex += 1) {
      const pageHint = pageHints[localPageIndex];
      const hintFragments = resolvePagesPageHintTextFragments(pageHint);
      if (!hintFragments.length) {
        continue;
      }

      const pageFragments: PaginatedPagesBodyFragment[] = [];
      for (const hintFragment of hintFragments) {
        const fragment = mapPagesTextRangeToParagraphFragment(paragraphRanges, hintFragment, textLength);
        if (!fragment) {
          pushUniqueArchiveWarning(
            archive,
            'Pages layout target hints split body text inside a paragraph; falling back to estimated paragraph pagination.'
          );
          return [];
        }
        if (fragment.endParagraph > fragment.startParagraph) {
          pageFragments.push(fragment);
        }
      }

      if (!pageFragments.length) {
        continue;
      }

      const normalizedPageFragments = normalizePagesPageFragments(pageFragments, columnStyles, layout, content);
      pushPagesPageHintLayoutWarnings(archive, pageHint, hintFragments.length, normalizedPageFragments);

      if (normalizedPageFragments.some((fragment, index) =>
        index > 0 && fragmentsOverlapInPage(normalizedPageFragments[index - 1], fragment, paragraphRanges)
      )) {
        pushUniqueArchiveWarning(
          archive,
          'Pages layout target hints overlap body paragraphs; falling back to estimated paragraph pagination.'
        );
        return [];
      }

      pages.push({
        pageIndex: startPageIndex + localPageIndex,
        startParagraph: normalizedPageFragments[0].startParagraph,
        endParagraph: normalizedPageFragments[normalizedPageFragments.length - 1].endParagraph,
        fragments: normalizedPageFragments,
        savedLayout: true
      });
    }
  }

  return pages
    .sort((left, right) => left.pageIndex - right.pageIndex)
    .filter((page, index, list) =>
      page.endParagraph > page.startParagraph &&
      (index === 0 || list[index - 1].pageIndex !== page.pageIndex)
    );
}

function fragmentsOverlapInPage(
  previous: PaginatedPagesBodyFragment,
  current: PaginatedPagesBodyFragment,
  paragraphRanges: PagesParagraphRange[]
): boolean {
  const previousLastParagraph = previous.endParagraph - 1;
  if (current.startParagraph < previousLastParagraph) {
    return true;
  }
  if (current.startParagraph > previousLastParagraph) {
    return false;
  }

  const previousEndOffset =
    previous.endVisibleOffset ??
    resolvePagesRenderedOffset(paragraphRanges[previousLastParagraph]);
  const currentStartOffset = current.startVisibleOffset ?? 0;
  return currentStartOffset < previousEndOffset;
}

function resolveSavedPagesBodyEnd(text: string, pages: PaginatedPagesBodyPage[], drawablePositions: ReadonlySet<number>): number | undefined {
  if (!pages.length) return 0;

  let end = 0;
  for (const page of pages) {
    for (const fragment of page.fragments) {
      const start = fragment.rangeStart ?? end;
      const rangeEnd = fragment.rangeEnd ?? start;
      if (start < 0 || rangeEnd < start || rangeEnd > text.length) return undefined;
      const discontinuityStart = Math.min(start, end);
      const discontinuity = text.slice(discontinuityStart, start > end ? start : Math.min(end, rangeEnd));
      if (/[^\s\u0004\u0005\uFFFC]/u.test(discontinuity)) return undefined;
      // A saved text column can omit an attachment marker without omitting the drawable.
      for (const { index } of discontinuity.matchAll(/\uFFFC/g)) {
        if (!drawablePositions.has(discontinuityStart + index)) return undefined;
      }
      end = Math.max(end, rangeEnd);
    }
  }
  if (!/[^\s\u0004\u0005]/u.test(text.slice(end))) return text.length;
  const segments = typeof Intl.Segmenter === 'function' ? new Intl.Segmenter().segment(text) : undefined;
  return pagesGraphemeStart(text, end, segments) === end ? end : undefined;
}

function normalizePagesPageFragments(
  fragments: PaginatedPagesBodyFragment[], columnStyles: PagesColumnStyleRange[], layout: PagesLayoutModel, content: PagesBodyLayoutContent
): PaginatedPagesBodyFragment[] {
  const deduped: PaginatedPagesBodyFragment[] = [];

  for (const fragment of fragments) {
    const previous = deduped[deduped.length - 1];
    if (!previous || !pagesFragmentsShareTextBounds(previous, fragment)) {
      deduped.push(fragment);
      continue;
    }

    deduped[deduped.length - 1] = mergePagesEquivalentFragments(previous, fragment);
  }

  const normalized: PaginatedPagesBodyFragment[] = [];
  const containers = new Map<number, PaginatedPagesBodyFragment>();
  for (let index = 0; index < deduped.length; index += 1) {
    const fragment = deduped[index];
    if (!pagesFragmentIsRedundantContainer(deduped, index, content.text)) normalized.push(fragment);
    else if (fragment.rect) containers.set(fragment.rangeStart!, fragment);
  }

  return mergePagesImplicitColumnFragments(positionSavedPagesColumns(normalized, containers, columnStyles, layout, content));
}

function readPagesColumnStyles(archive: IworkArchiveIndex, storage: AnyObject, textLength: number): PagesColumnStyleRange[] {
  const entries = readPagesBodyAttributes(readField(storage, ['tableLayoutStyle', 'table_layout_style']))
    .filter((entry, index, list) => index === 0 || entry.refId !== list[index - 1].refId);
  const layouts = new Map<number, PagesColumnLayout | undefined>();
  return entries.flatMap(({ index: start, refId }, index) => {
    if (refId == null) return [];
    if (!layouts.has(refId)) layouts.set(refId, readPagesColumnLayout(resolveMergedStyle(archive, refId)));
    const columns = layouts.get(refId);
    return columns ? [{ start, end: entries[index + 1]?.index ?? textLength, columns }] : [];
  });
}

function readPagesColumnLayout(style: AnyObject | undefined): PagesColumnLayout | undefined {
  const properties = asObject(readField(style, ['columnProperties', 'column_properties']));
  if (readField(properties, ['columnsNull', 'columns_null']) === true) return undefined;
  const columns = asObject(readField(properties, ['columns']));
  const equal = asObject(readField(columns, ['equalColumns', 'equal_columns']));
  if (equal) {
    const count = asFiniteNumber(readField(equal, ['count'])) ?? 1;
    const gap = asFiniteNumber(readField(equal, ['gap'])) ?? 0;
    return Number.isInteger(count) && count > 1 && gap >= 0 && gap * (count - 1) < 1 ? { count, gap } : undefined;
  }
  const unequal = asObject(readField(columns, ['nonEqualColumns', 'non_equal_columns']));
  const first = asFiniteNumber(readField(unequal, ['first']));
  if (first == null || first <= 0) return undefined;
  const tracks = [{ x: 0, width: first }];
  let x = first;
  for (const track of asArray<AnyObject>(readField(unequal, ['following']))) {
    const gap = asFiniteNumber(readField(track, ['gap']));
    const width = asFiniteNumber(readField(track, ['width']));
    if (gap == null || gap < 0 || width == null || width <= 0) return undefined;
    x += gap;
    tracks.push({ x, width });
    x += width;
  }
  return tracks.length > 1 && x <= 1.001 ? { tracks } : undefined;
}

function positionSavedPagesColumns(
  fragments: PaginatedPagesBodyFragment[], containers: ReadonlyMap<number, PaginatedPagesBodyFragment>,
  styles: PagesColumnStyleRange[], layout: PagesLayoutModel, content: PagesBodyLayoutContent
): PaginatedPagesBodyFragment[] {
  if (styles.length === 0) return fragments;
  const positioned: PaginatedPagesBodyFragment[] = [];
  const bodyRect = { x: 0, y: 0, width: layout.bodyWidth, height: layout.bodyHeight };
  for (let start = 0; start < fragments.length;) {
    const fragment = fragments[start];
    const sourceStart = fragment.rangeStart!;
    let low = 0, high = styles.length;
    while (low < high) {
      const middle = (low + high) >>> 1;
      if (styles[middle].end <= sourceStart) low = middle + 1;
      else high = middle;
    }
    const style = styles[low];
    if (!style || style.start > sourceStart) {
      positioned.push(fragment);
      start += 1;
      continue;
    }

    const parent = containers.get(sourceStart);
    const sourceEnd = Math.min(style.end, parent?.rangeEnd ?? style.end);
    let end = start + 1;
    while (end < fragments.length && fragments[end].rangeEnd! <= sourceEnd &&
      pagesColumnRangesAreAdjacent(content.text, fragments[end - 1].rangeEnd!, fragments[end].rangeStart!)) end += 1;
    const rect = parent && parent.rangeEnd === fragments[end - 1].rangeEnd ? parent.rect :
      start === 0 && end === fragments.length ? bodyRect : undefined;
    const count = 'count' in style.columns ? style.columns.count : style.columns.tracks.length;
    if (end === start + 1 && fragment.rangeEnd! <= sourceEnd && (fragment.columnCount === count ||
      (fragment.columnCount == null && start === 0 && end === fragments.length))) {
      const columns = estimateSavedPagesColumns(fragment, style.columns, count, fragment.rect ?? rect ?? bodyRect, layout, content);
      for (const column of columns) positioned.push(column);
    } else {
      const group = fragments.slice(start, end);
      if (rect && group.length > 1 && group.length <= count && group.some(fragment => !fragment.rect) &&
        group.every(fragment => fragment.columnCount == null || fragment.columnCount === count)) {
        fillSavedPagesColumnRects(group, style.columns, rect);
      }
      for (const column of group) positioned.push(column);
    }
    start = end;
  }
  return positioned;
}

function pagesColumnRangesAreAdjacent(bodyText: string, previousEnd: number, nextStart: number): boolean {
  // A saved column break can omit the layout separator from both ranges.
  return nextStart >= previousEnd && !/[^\s\u0004\u0005]/u.test(bodyText.slice(previousEnd, nextStart));
}

function fillSavedPagesColumnRects(
  fragments: PaginatedPagesBodyFragment[], columns: PagesColumnLayout, rect: PagesBodyFragmentRect
): void {
  const positions = fragments.map((_, index) => pagesColumnRect(columns, rect, index));
  if (positions.some((position, index) => {
    const saved = fragments[index].rect;
    return position.width < 1 || (saved && (Math.abs(saved.x - position.x) > 1 || Math.abs(saved.width - position.width) > 1));
  })) return;
  fragments.forEach((fragment, index) => {
    if (!fragment.rect) {
      fragment.rect = positions[index];
      fragment.columnCount = undefined;
    }
  });
}

function pagesColumnRect(columns: PagesColumnLayout, rect: PagesBodyFragmentRect, index: number): PagesBodyFragmentRect {
  if ('tracks' in columns) {
    const { x, width } = columns.tracks[index];
    return { ...rect, x: rect.x + x * rect.width, width: width * rect.width };
  }
  const width = (1 - columns.gap * (columns.count - 1)) * rect.width / columns.count;
  return { ...rect, x: rect.x + index * (width + columns.gap * rect.width), width };
}

function estimateSavedPagesColumns(
  fragment: PaginatedPagesBodyFragment, columns: PagesColumnLayout, count: number,
  rect: PagesBodyFragmentRect, layout: PagesLayoutModel, content: PagesBodyLayoutContent
): PaginatedPagesBodyFragment[] {
  const result: PaginatedPagesBodyFragment[] = [];
  const sourceStart = fragment.rangeStart!;
  const limit = fragment.rangeEnd!;
  const breaks = Array.from(content.text.slice(sourceStart, limit).matchAll(/\u000c/g), match => sourceStart + match.index + 1);
  let nextBreak = 0;
  for (let index = 0, start = sourceStart; index < count && start < limit; index += 1) {
    const column = pagesColumnRect(columns, rect, index);
    if (column.width < 1 || column.height <= 0) return [fragment];
    const remainingColumns = count - index - 1;
    const boundary = breaks[nextBreak] ?? limit;
    // Leave a column for each explicit break, even if this column needs to scroll.
    const end = remainingColumns === 0 ? limit : breaks.length - nextBreak >= remainingColumns ? boundary
      : estimateSavedPagesColumnEnd(start, boundary, column, layout, content);
    const part = mapPagesTextRangeToParagraphFragment(content.ranges, {
      range: { location: start, length: end - start }, rect: column
    }, content.text.length);
    if (!part || end <= start) return [fragment];
    result.push(part);
    if (end === boundary) nextBreak += 1;
    start = end;
  }
  return result.length ? result : [fragment];
}

function findPagesDrawableIndex(drawables: PagesBodyLayoutContent['drawables'], characterIndex: number): number {
  let low = 0, high = drawables.length;
  while (low < high) {
    const middle = (low + high) >>> 1;
    if (drawables[middle].characterIndex < characterIndex) low = middle + 1;
    else high = middle;
  }
  return low;
}

function estimateSavedPagesColumnEnd(
  start: number, end: number, column: PagesBodyFragmentRect, layout: PagesLayoutModel, content: PagesBodyLayoutContent
): number {
  const { paragraphs, ranges, drawables } = content;
  const availableHeight = Math.max(1, Math.min(column.height, layout.bodyHeight - column.y));
  let position = start;
  let usedHeight = 0;
  let previousParagraph: TextParagraph | undefined;
  let drawableIndex = findPagesDrawableIndex(drawables, start);
  for (let index = findParagraphIndexForCharacter(ranges, start); position < end && index < ranges.length; index += 1) {
    const range = ranges[index];
    const paragraph = paragraphs[index];
    const paragraphEnd = Math.min(range.end, end);
    while (position < paragraphEnd) {
      const drawable = drawables[drawableIndex];
      if (drawable?.characterIndex === position) {
        let bottom = usedHeight;
        do {
          const { attachmentItem: item, attachmentHint: hint, attachmentObject: object } = drawables[drawableIndex++];
          const width = hasAbsolutePagesAttachmentPosition(hint) ? item.transform.width : fitPagesInlineTableWidth(item.transform.width,
            column.width, asFiniteNumber(readField(object, ['hOffset', 'h_offset'])) ?? 0);
          const top = hasAbsolutePagesAttachmentPosition(hint) ? hint.y - layout.topMargin - column.y
            : bottom + (asFiniteNumber(readField(object, ['vOffset', 'v_offset'])) ?? 0);
          bottom = Math.max(bottom, top + estimatePagesSavedItemHeight(item, width));
        } while (drawables[drawableIndex]?.characterIndex === position);
        if (usedHeight > 0 && bottom > availableHeight) return position;
        usedHeight = bottom;
        previousParagraph = undefined;
        position += 1;
        continue;
      }
      const textEnd = Math.min(paragraphEnd, drawable?.characterIndex ?? paragraphEnd);
      const visibleStart = resolvePagesRenderedOffset(range, position);
      const slice = (to: number) => position === range.start && to === range.end ? paragraph : sliceTextParagraph(
        paragraph, visibleStart, resolvePagesRenderedOffset(range, to), resolvePagesRenderedOffset(range));
      const gap = position === range.start ? pagesParagraphGap(paragraph, previousParagraph) : 0;
      const heightAt = (to: number) => {
        const measured = slice(to);
        return measured ? gap + estimateParagraphContentHeight(measured, column.width, true, availableHeight) +
          (to === textEnd && textEnd < paragraphEnd ? measured.spaceAfter ?? 0 : 0) : 0;
      };
      const height = heightAt(textEnd);
      if (usedHeight + height > availableHeight) {
        const offset = position - range.start;
        const last = Math.min(textEnd - range.start, range.text.length);
        if (offset >= last) return usedHeight > 0 ? position : textEnd;
        const segments = typeof Intl.Segmenter === 'function' ? new Intl.Segmenter().segment(range.text) : undefined;
        const first = Math.min(last, pagesGraphemeEnd(range.text, offset, segments));
        const fits = (candidate: number) => usedHeight + heightAt(candidate === last ? textEnd : range.start + candidate) <= availableHeight;
        const firstFits = fits(first);
        if (!firstFits && usedHeight > 0) return position;
        const cut = firstFits ? choosePagesTextEnd(range.text, offset, last, first, segments, fits) : first;
        return cut === last ? textEnd : range.start + cut;
      }
      usedHeight += height;
      if (height > 0) previousParagraph = paragraph;
      position = textEnd;
    }
  }
  return end;
}

function pagesFragmentsShareTextBounds(
  left: PaginatedPagesBodyFragment,
  right: PaginatedPagesBodyFragment
): boolean {
  return left.startParagraph === right.startParagraph &&
    left.endParagraph === right.endParagraph &&
    (left.startVisibleOffset ?? 0) === (right.startVisibleOffset ?? 0) &&
    left.endVisibleOffset === right.endVisibleOffset;
}

function mergePagesEquivalentFragments(
  previous: PaginatedPagesBodyFragment,
  current: PaginatedPagesBodyFragment
): PaginatedPagesBodyFragment {
  return {
    ...previous,
    ...(previous.rect ? {} : current.rect ? { rect: current.rect } : {}),
    ...(previous.columnCount != null ? {} : current.columnCount != null ? { columnCount: current.columnCount } : {})
  };
}

function mergePagesImplicitColumnFragments(
  fragments: PaginatedPagesBodyFragment[]
): PaginatedPagesBodyFragment[] {
  if (fragments.length < 2) {
    return fragments;
  }

  const merged: PaginatedPagesBodyFragment[] = [fragments[0]];

  for (let index = 1; index < fragments.length; index += 1) {
    const current = fragments[index];
    const previous = merged[merged.length - 1];
    if (!previous || !pagesFragmentsCanMergeImplicitColumns(previous, current)) {
      merged.push(current);
      continue;
    }

    merged[merged.length - 1] = {
      ...previous,
      endParagraph: current.endParagraph,
      rangeEnd: current.rangeEnd
    };
  }

  return merged;
}

function pagesFragmentsCanMergeImplicitColumns(
  previous: PaginatedPagesBodyFragment,
  current: PaginatedPagesBodyFragment
): boolean {
  return previous.rect == null &&
    current.rect == null &&
    previous.columnCount != null &&
    previous.columnCount === current.columnCount &&
    previous.startVisibleOffset == null &&
    previous.endVisibleOffset == null &&
    current.startVisibleOffset == null &&
    current.endVisibleOffset == null &&
    previous.rangeEnd != null &&
    current.rangeStart != null &&
    previous.rangeEnd === current.rangeStart &&
    previous.endParagraph === current.startParagraph;
}

function pagesFragmentIsRedundantContainer(
  fragments: PaginatedPagesBodyFragment[],
  index: number,
  bodyText: string
): boolean {
  const fragment = fragments[index];
  const nextFragment = fragments[index + 1];
  if (
    fragment.rangeStart == null ||
    fragment.rangeEnd == null ||
    !nextFragment ||
    nextFragment.rangeStart == null ||
    nextFragment.rangeEnd == null ||
    fragment.rangeStart !== nextFragment.rangeStart ||
    nextFragment.rangeEnd <= fragment.rangeStart ||
    nextFragment.rangeEnd >= fragment.rangeEnd
  ) {
    return false;
  }

  let coveredEnd = nextFragment.rangeEnd;
  for (let scanIndex = index + 2; scanIndex < fragments.length && coveredEnd < fragment.rangeEnd; scanIndex += 1) {
    const candidate = fragments[scanIndex];
    if (
      candidate.rangeStart == null ||
      candidate.rangeEnd == null ||
      !pagesColumnRangesAreAdjacent(bodyText, coveredEnd, candidate.rangeStart) ||
      candidate.rangeEnd > fragment.rangeEnd
    ) {
      return false;
    }
    coveredEnd = candidate.rangeEnd;
  }

  return coveredEnd >= fragment.rangeEnd;
}

function paginatePagesBodyParagraphs(
  paragraphs: TextParagraph[],
  ranges: PagesParagraphRange[],
  layout: PagesLayoutModel,
  sectionStarts: ReadonlySet<number>,
  attachments: ReadonlyMap<number, PagesEstimatedAttachment[]>,
  tableParts: Map<TableItem, PagesEstimatedTablePart[]>,
  bodyStart: number,
  firstPageIndex: number,
  bodyEnd = ranges.at(-1)?.end ?? 0,
  leading?: Pick<PagesEstimatedAttachment, 'characterIndex'> & { table: NonNullable<PagesEstimatedAttachment['table']> }
): PaginatedPagesBodyPage[] {
  const pages: PaginatedPagesBodyPage[] = [];
  const { bodyWidth, bodyHeight } = layout;
  const textLength = ranges.at(-1)?.end ?? 0;
  let pageIndex = firstPageIndex;
  let start = bodyStart, end = bodyStart, usedHeight = 0;
  let hasContent = false;
  let leadingTableCharacterIndex: number | undefined;
  let fitOversizedLine = false;

  const finishPage = (nextStart = end) => {
    if (hasContent) {
      const paragraph = findParagraphIndexForCharacter(ranges, start);
      const sourceStart = start + Number(start === ranges[paragraph].start && ranges[paragraph].text.startsWith('\u0004'));
      const fragment = sourceStart < end
        ? mapPagesTextRangeToParagraphFragment(ranges, { range: { location: sourceStart, length: end - sourceStart } }, textLength)
        : undefined;
      pages.push({
        pageIndex,
        startParagraph: fragment?.startParagraph ?? paragraph,
        endParagraph: fragment?.endParagraph ?? paragraph,
        fragments: [fragment ?? { startParagraph: paragraph, endParagraph: paragraph }],
        leadingTableCharacterIndex,
        ...(fitOversizedLine ? { fitOversizedLine } : {})
      });
    }
    pageIndex += 1;
    start = end = nextStart;
    usedHeight = 0;
    hasContent = false;
    leadingTableCharacterIndex = undefined;
    fitOversizedLine = false;
  };

  const append = (from: number, to: number, height: number, visible: boolean, spaceBefore = 0) => {
    if ((usedHeight > 0 || hasContent) && usedHeight + height + spaceBefore > bodyHeight) finishPage(from);
    if (usedHeight > 0 || hasContent) usedHeight += spaceBefore;
    usedHeight += height;
    hasContent ||= visible;
    end = to;
  };

  const appendTable = (table: NonNullable<PagesEstimatedAttachment['table']>, characterIndex: number, textStart: number, startsPage = false) => {
    const headerRows = Math.min(Math.max(0, table.headerRows), table.rowHeights.length - 1);
    const headerHeight = table.rowHeights.slice(0, headerRows).reduce((sum, height) => sum + height, 0);
    const groups = groupPagesTableRows(table.item, table.rowHeights, headerRows, bodyHeight);
    const parts: PagesEstimatedTablePart[] = [];
    let groupIndex = 0;
    while (groupIndex < groups.length) {
      const first = groupIndex === 0;
      const { start: rowStart, height: firstGroupHeight } = groups[groupIndex];
      const repeat = !first && rowStart >= headerRows && headerHeight + firstGroupHeight <= bodyHeight ? headerRows : 0;
      const offset = first ? Math.max(0, table.offsetY) : 0;
      const repeatedHeight = repeat ? headerHeight : 0;
      if (first && (hasContent || usedHeight > 0) && usedHeight + offset + firstGroupHeight > bodyHeight) {
        finishPage(characterIndex);
      }
      const available = bodyHeight - usedHeight - offset;
      let height = repeatedHeight, rowEnd = rowStart;
      do {
        const group = groups[groupIndex++];
        height += group.height;
        rowEnd = group.end;
      } while (groupIndex < groups.length && height + groups[groupIndex].height <= available);
      parts.push({ pageIndex, rowStart, rowCount: rowEnd - rowStart, headerRows: repeat, height });
      end = textStart;
      usedHeight += height + offset;
      hasContent = true;
      if (startsPage || !first) leadingTableCharacterIndex = characterIndex;
      if (groupIndex < groups.length) finishPage(textStart);
    }
    tableParts.set(table.item, parts);
  };

  if (leading) appendTable(leading.table, leading.characterIndex, bodyStart, true);
  const firstParagraph = findParagraphIndexForCharacter(ranges, bodyStart);
  for (let index = firstParagraph; index < paragraphs.length; index += 1) {
    const paragraph = paragraphs[index];
    const range = ranges[index];
    if (range.start >= bodyEnd) break;
    const rangeStart = Math.max(range.start, bodyStart);
    const rangeEnd = Math.min(range.end, bodyEnd);
    if (sectionStarts.has(index) && (end > start || hasContent)) finishPage(rangeStart);
    const paragraphAttachments = attachments.get(index) ?? [];
    const measuredParagraph = rangeStart === range.start && rangeEnd === range.end ? paragraph
      : sliceTextParagraph(paragraph, resolvePagesRenderedOffset(range, rangeStart), resolvePagesRenderedOffset(range, rangeEnd));
    if (!measuredParagraph && !paragraphAttachments.length) {
      if (!hasContent) start = rangeEnd;
      end = rangeEnd;
      continue;
    }
    const gap = rangeStart === range.start ? pagesParagraphGap(paragraph, paragraphs[index - 1]) : 0;
    const visible = Boolean(collectParagraphVisibleText(measuredParagraph).trim());
    const textHeight = measuredParagraph && (visible || !paragraphAttachments.length)
      ? estimateParagraphContentHeight(measuredParagraph, bodyWidth, true, bodyHeight) : 0;
    const height = paragraphAttachments.reduce((total, item) => total + item.height, textHeight);
    if (height <= bodyHeight || (!visible && !paragraphAttachments.length)) {
      append(rangeStart, rangeEnd, height, visible || paragraphAttachments.length > 0, gap);
      continue;
    }

    const appendText = (from: number, to: number, beforeDrawable: boolean) => {
      if (from >= to) return;
      const textLength = resolvePagesRenderedOffset(range);
      const sliceFrom = (from: number, to: number) => sliceTextParagraph(paragraph,
        resolvePagesRenderedOffset(range, from), resolvePagesRenderedOffset(range, to), textLength);
      const slice = sliceFrom(from, to);
      if (!slice || !collectParagraphVisibleText(slice).trim()) {
        end = to;
        return;
      }
      const measure = (slice: TextParagraph) => estimateParagraphContentHeight(slice, bodyWidth, true, bodyHeight) +
        (beforeDrawable ? slice.spaceAfter ?? 0 : 0);
      const height = measure(slice);
      if (height <= bodyHeight) {
        append(from, to, height, true, from === range.start ? gap : 0);
        return;
      }

      const sourceEnd = Math.min(to - range.start, range.text.length);
      const segments = typeof Intl.Segmenter === 'function' ? new Intl.Segmenter().segment(range.text) : undefined;
      const allowance = Math.min(pagesParagraphFontSize(slice), bodyHeight / 8);
      for (let position = from - range.start; position < sourceEnd;) {
        const characterIndex = range.start + position;
        const endIndex = (offset: number) => offset === sourceEnd ? to : range.start + offset;
        const heightAt = (offset: number) => {
          const part = sliceFrom(characterIndex, endIndex(offset));
          return part ? measure(part) : 0;
        };
        let firstEnd = Math.min(sourceEnd, pagesGraphemeEnd(range.text, position, segments));
        let firstHeight = heightAt(firstEnd);
        while (!firstHeight && firstEnd < sourceEnd) {
          firstEnd = Math.min(sourceEnd, pagesGraphemeEnd(range.text, firstEnd, segments));
          firstHeight = heightAt(firstEnd);
        }
        const spaceBefore = characterIndex === range.start ? gap : 0;
        if ((usedHeight > 0 || hasContent) && usedHeight + spaceBefore + firstHeight + allowance > bodyHeight) {
          finishPage(characterIndex);
        }
        const available = bodyHeight - usedHeight - allowance - (usedHeight > 0 || hasContent ? spaceBefore : 0);
        if (firstHeight > available) {
          append(characterIndex, endIndex(firstEnd), bodyHeight, true);
          fitOversizedLine = true;
          finishPage();
          position = firstEnd;
          continue;
        }
        const next = choosePagesTextEnd(range.text, position, sourceEnd, firstEnd, segments, offset => heightAt(offset) <= available);
        append(characterIndex, endIndex(next), heightAt(next) + allowance, true, spaceBefore);
        position = next;
        if (position < sourceEnd) finishPage();
      }
    };

    let textStart = rangeStart;
    for (const attachment of paragraphAttachments) {
      const { characterIndex, table } = attachment;
      appendText(textStart, characterIndex, true);
      textStart = characterIndex + 1;
      if (!table || attachment.height <= bodyHeight) {
        append(characterIndex, textStart, attachment.height, true);
        continue;
      }

      appendTable(table, characterIndex, textStart);
    }
    appendText(textStart, rangeEnd, false);
  }
  finishPage();
  return pages;
}

function groupPagesTableRows(table: TableItem, heights: number[], headerRows: number, pageHeight: number):
  Array<{ start: number; end: number; height: number }> {
  const ends: number[] = [];
  for (const cell of table.cells) {
    if (cell.isMergedContinuation || cell.rowSpan <= 1) continue;
    ends[cell.row] = Math.max(ends[cell.row] ?? 0, Math.min(heights.length, cell.row + cell.rowSpan));
  }
  if (headerRows > 0) ends[0] = Math.max(ends[0] ?? 0, headerRows + 1);
  const groups: Array<{ start: number; end: number; height: number }> = [];
  for (let start = 0; start < heights.length;) {
    let end = Math.max(start + 1, ends[start] ?? 0);
    let height = heights[start];
    for (let row = start + 1; row < end; row += 1) {
      height += heights[row];
      end = Math.max(end, ends[row] ?? 0);
      if (height > pageHeight) {
        end = start + 1;
        height = heights[start];
        break;
      }
    }
    groups.push({ start, end, height });
    start = end;
  }
  return groups;
}

function pagesParagraphGap(paragraph: TextParagraph, previous: TextParagraph | undefined): number {
  return previous ? Math.max(previous.spaceAfter ?? 0, paragraph.spaceBefore ?? 0) : 0;
}

function pagesParagraphFontSize(paragraph: TextParagraph): number {
  return paragraph.runs.reduce((largest, run) => Math.max(largest, asFiniteNumber(run.fontSize) ?? 0), 0) || 16;
}

function estimateParagraphContentHeight(paragraph: TextParagraph, availableWidth: number, wrap = true, pageHeight = Infinity): number {
  const fontSize = pagesParagraphFontSize(paragraph);
  const baseLineHeight = typeof paragraph.lineHeight === 'number' && Number.isFinite(paragraph.lineHeight) && paragraph.lineHeight > 0
    ? (paragraph.lineHeightUnit === 'multiple' ? paragraph.lineHeight * fontSize : paragraph.lineHeight)
    : fontSize * 1.2;
  const paragraphText = paragraph.runs.map((run) => stripObjectMarker(run.text)).join('');
  const bulletText = paragraph.bullet?.char ?? (paragraph.bullet?.autoType ? '1.' : '');
  const indentAllowance = Math.max(0, (paragraph.marginLeft ?? 0) + Math.abs(paragraph.indent ?? 0));
  const effectiveWidth = Math.max(availableWidth - indentAllowance - 8, fontSize);
  const lineCount = paragraphText.split('\n').reduce((count, line, index) => count + (wrap
    ? estimatePagesWrappedLineCount(`${index === 0 ? bulletText : ''}${line}`, effectiveWidth, fontSize)
    : 1), 0);
  // Exact line spacing can be shorter than a glyph that cannot fit on a page.
  const glyphHeight = fontSize * PAGES_GLYPH_LINE_HEIGHT;
  return Number(Math.max(lineCount * baseLineHeight, glyphHeight > pageHeight ? glyphHeight : 0).toFixed(3));
}

function estimateParagraphGroupHeight(paragraphs: TextParagraph[], availableWidth: number, wrap = true, pageHeight = Infinity): number {
  return Number(
    paragraphs
      .reduce((total, paragraph) => total + estimateParagraphContentHeight(paragraph, availableWidth, wrap, pageHeight) +
        (paragraph.spaceBefore ?? 0) + (paragraph.spaceAfter ?? 0), 0)
      .toFixed(3)
  );
}

function pagesTableColumnOffsets(table: TableItem, width: number): number[] {
  const hiddenColumns = new Set(table.hiddenColumns);
  const columns = [0];
  table.columns.forEach((size, index) => columns.push(columns[index] + (hiddenColumns.has(index) ? 0 : size)));
  const scale = width / (columns.at(-1) || 1);
  return columns.map(offset => offset * scale);
}

function estimatePagesTableRowHeights(
  table: TableItem, columns: number[], minimumHeights: number[], spanning: boolean, pageHeight: number
): number[] {
  const hiddenRows = new Set(table.hiddenRows);
  const heights = minimumHeights.slice();
  for (const cell of table.cells) {
    if (cell.isMergedContinuation || (cell.rowSpan > 1) !== spanning) continue;
    const endColumn = Math.min(cell.column + cell.colSpan, table.columns.length);
    const cellWidth = columns[endColumn] - columns[cell.column];
    if (cellWidth <= 0) continue;
    const frame = cell.textFrame;
    if (!spanning && !table.autoFitRows && !frame.paragraphs.some(paragraph =>
      pagesParagraphFontSize(paragraph) * PAGES_GLYPH_LINE_HEIGHT > pageHeight && collectParagraphVisibleText(paragraph).trim())) continue;
    const endRow = Math.min(cell.row + cell.rowSpan, heights.length);
    let height = 0, lastVisibleRow = -1;
    for (let row = cell.row; row < endRow; row += 1) {
      height += heights[row];
      if (!hiddenRows.has(row)) lastVisibleRow = row;
    }
    if (lastVisibleRow < 0) continue;
    const { left, right, top, bottom } = frame.padding;
    const contentHeight = estimateParagraphGroupHeight(frame.paragraphs, cellWidth - left - right, frame.wrap !== 'none', pageHeight);
    heights[lastVisibleRow] += Math.max(0, top + contentHeight + bottom - height);
  }
  return heights;
}

function estimatePagesSavedItemHeight(item: SlideItem, width: number): number {
  if (item.kind !== 'table' || !item.autoFitRows) return item.transform.height;
  const columns = pagesTableColumnOffsets(item, width);
  const hiddenRows = new Set(item.hiddenRows);
  const minimums = item.rows.map((height, row) => hiddenRows.has(row) ? 0 : height);
  const rowHeights = estimatePagesTableRowHeights(item, columns, minimums, false, Infinity);
  return estimatePagesTableRowHeights(item, columns, rowHeights, true, Infinity).reduce((sum, height) => sum + height, 0);
}

function resolvePagesTableMeasurement(
  item: TableItem, width: number, measurements?: ReadonlyMap<string, PagesTableMeasurement>
): PagesTableMeasurement | undefined {
  const measured = measurements?.get(item.id);
  return measured && measured.rows.length === item.rows.length && Math.abs(measured.width - width) <= 0.5 ? measured : undefined;
}

function preparePagesTableRows(table: TableItem, width: number, pageHeight: number, headerRows: number, measured?: (number | undefined)[]):
  { rowHeights: number[]; headerRows: number; height: number; sourceRows?: number[] } {
  const columns = pagesTableColumnOffsets(table, width);
  const hiddenRows = new Set(table.hiddenRows);
  const minimumHeights = table.rows.map((height, row) => hiddenRows.has(row) ? 0 : Math.max(height, measured?.[row] ?? 0));
  const hasVerticalMerges = table.cells.some(cell => !cell.isMergedContinuation && cell.rowSpan > 1);
  const complete = measured?.every(height => height != null);
  const useMeasured = (heights: number[]) => measured
    ? heights.map((height, row) => measured[row] == null ? height : minimumHeights[row]) : heights;
  const unmergedHeights = complete ? minimumHeights
    : useMeasured(estimatePagesTableRowHeights(table, columns, minimumHeights, false, pageHeight));
  const mergedHeights = hasVerticalMerges && !complete
    ? useMeasured(estimatePagesTableRowHeights(table, columns, unmergedHeights, true, pageHeight)) : unmergedHeights;
  const rowHeights = table.autoFitRows ? mergedHeights : unmergedHeights;
  const originalHeight = rowHeights.reduce((sum, row) => sum + row, 0);
  if (table.autoFitRows) table.transform.height = originalHeight;
  const oversizedMerges = hasVerticalMerges
    ? groupPagesTableRows(table, mergedHeights, 0, Infinity).filter(group => group.end > group.start + 1 && group.height > pageHeight)
    : [];
  const original = { rowHeights, headerRows, height: originalHeight };
  if (!oversizedMerges.length && !rowHeights.some(height => height > pageHeight)) return original;

  const rowsInOversizedMerge = new Uint8Array(rowHeights.length);
  for (const { start, end } of oversizedMerges) rowsInOversizedMerge.fill(1, start, end);
  const rowsWithSplitMerges = new Set<number>();
  const sourceCells = hiddenRows.size ? table.cells.map(cell => {
    if (cell.isMergedContinuation || cell.rowSpan <= 1 || !rowsInOversizedMerge[cell.row] || !hiddenRows.has(cell.row)) return cell;
    // The text belongs to the visible portion of a merge that starts in a hidden row.
    const end = Math.min(rowHeights.length, cell.row + cell.rowSpan);
    let row = cell.row + 1;
    while (row < end && hiddenRows.has(row)) row += 1;
    if (row === end) return cell;
    rowsWithSplitMerges.add(row);
    return { ...cell, row, rowSpan: end - row };
  }) : table.cells;
  const cellsByRow = new Map<number, TableItem['cells']>();
  for (const cell of sourceCells) {
    if (cell.isMergedContinuation || hiddenRows.has(cell.row)) continue;
    if (!rowsInOversizedMerge[cell.row] && rowHeights[cell.row] <= pageHeight) continue;
    const cells = cellsByRow.get(cell.row) ?? [];
    cells.push(cell);
    cellsByRow.set(cell.row, cells);
    if (cell.rowSpan > 1) rowsWithSplitMerges.add(cell.row);
  }

  const headerLimit = Math.max(0, Math.min(headerRows, rowHeights.length));
  const headerHeight = rowHeights.slice(0, headerLimit).reduce((total, height) => total + height, 0);
  const roomBelowHeader = pageHeight - headerHeight;
  const splitCells = new Map<TableItem['cells'][number], TextFrame[]>();
  const rows: number[] = [], heights: number[] = [];
  const sourceRows: number[] = [];
  const rowOffsets: number[] = [];
  for (let row = 0; row < rowHeights.length; row += 1) {
    rowOffsets.push(rows.length);
    // Oversized merges get their content height on the anchor row and its continuations.
    const height = rowsInOversizedMerge[row] ? unmergedHeights[row] : rowHeights[row];
    const cells = cellsByRow.get(row);
    if (!cells?.length || (height <= pageHeight && !rowsWithSplitMerges.has(row))) {
      rows.push(table.rows[row]);
      heights.push(height);
      sourceRows.push(rowsInOversizedMerge[row] ? -1 : row);
      continue;
    }
    const split = (limit: number) => cells.map(cell => {
      const cellWidth = columns[Math.min(columns.length - 1, cell.column + cell.colSpan)] - columns[cell.column];
      return cellWidth > 0 ? splitPagesTableCell(cell.textFrame, cellWidth, limit, limit === pageHeight)
        : [{ frame: cell.textFrame, height: 0 }];
    });
    const savedHeight = table.rows[row];
    const preserveSavedHeight = savedHeight > roomBelowHeader && savedHeight <= pageHeight;
    let limit = row >= headerLimit && roomBelowHeader > 0 && !preserveSavedHeight ? roomBelowHeader : pageHeight;
    let parts = split(limit);
    if (limit < pageHeight && parts.some(chunks => chunks.some(chunk => chunk.height > limit))) {
      limit = pageHeight;
      parts = split(limit);
    }
    const count = parts.reduce((max, part) => Math.max(max, part.length), 1);
    for (let index = 0; index < count; index += 1) {
      const minHeight = index === 0 ? Math.min(savedHeight, limit) : 1;
      const partHeight = parts.reduce((max, chunks) => Math.max(max, chunks[index]?.height ?? 0), minHeight);
      rows.push(partHeight);
      heights.push(partHeight);
      sourceRows.push(-1);
    }
    cells.forEach((cell, index) => {
      const chunks = parts[index];
      splitCells.set(cell, Array.from({ length: cell.rowSpan > 1 ? chunks.length : count }, (_, part) =>
        chunks[part]?.frame ?? { ...cell.textFrame, paragraphs: [] }));
    });
  }
  if (!splitCells.size) return original;

  rowOffsets.push(rows.length);
  table.cells = sourceCells.flatMap(cell => {
    const row = rowOffsets[cell.row];
    const rowEnd = rowOffsets[Math.min(cell.row + cell.rowSpan, table.rows.length)];
    const frames = splitCells.get(cell);
    if (!frames) return [{ ...cell, row, rowSpan: rowEnd - row }];
    return frames.map((textFrame, index) => ({
      ...cell,
      row: row + index,
      rowSpan: index + 1 === frames.length ? rowEnd - row - index : 1,
      textFrame
    }));
  });
  table.rows = rows;
  table.hiddenRows = table.hiddenRows?.map(row => rowOffsets[row]);
  const height = heights.reduce((sum, row) => sum + row, 0);
  table.transform.height = height;
  const repeatRows = rowOffsets[headerLimit];
  return { rowHeights: heights, headerRows: repeatRows === headerLimit ? repeatRows : 0, height, sourceRows };
}

function splitPagesTableCell(frame: TextFrame, width: number, pageHeight: number, fitOversizedLines: boolean):
  Array<{ frame: TextFrame; height: number }> {
  const { top, bottom, left, right } = frame.padding;
  const padding = top + bottom;
  const contentWidth = width - left - right;
  const fontSize = frame.paragraphs.reduce((largest, paragraph) => Math.max(largest, pagesParagraphFontSize(paragraph)), 0);
  // Leave room for line wrapping and font metrics to vary between browsers.
  const allowance = Math.min(fontSize, Math.max(0, (pageHeight - padding) / 8));
  const available = Math.max(1, pageHeight - padding - allowance);
  const wrap = frame.wrap !== 'none';
  const parts: Array<{ frame: TextFrame; height: number }> = [];
  let paragraphs: TextParagraph[] = [], used = 0;
  const flush = () => {
    if (paragraphs.length) parts.push({ frame: { ...frame, paragraphs }, height: used + padding + allowance });
    paragraphs = [];
    used = 0;
  };
  const append = (paragraph: TextParagraph, height: number) => {
    if (paragraphs.length && used + height > available) flush();
    paragraphs.push(paragraph);
    used += height;
  };

  for (const paragraph of frame.paragraphs) {
    const fullHeight = estimateParagraphGroupHeight([paragraph], contentWidth, wrap, pageHeight);
    const text = paragraph.runs.map(run => run.text).join('');
    if (fullHeight <= available || !text) {
      append(paragraph, fullHeight);
      continue;
    }

    const segments = typeof Intl.Segmenter === 'function' ? new Intl.Segmenter().segment(text) : undefined;
    const end = text.length;
    for (let start = 0; start < end;) {
      const firstEnd = pagesGraphemeEnd(text, start, segments);
      const sliceTo = (next: number) => sliceTextParagraph(paragraph, start, next, end);
      const pieceHeight = (next: number) => {
        const part = sliceTo(next);
        return part ? estimateParagraphGroupHeight([part], contentWidth, wrap, pageHeight) : 0;
      };
      const firstHeight = pieceHeight(firstEnd);
      if (paragraphs.length && used + firstHeight > available) flush();
      if (firstHeight > available) {
        if (!fitOversizedLines) {
          const rest = sliceTo(end);
          if (rest) append(rest, pieceHeight(end));
          break;
        }
        const first = sliceTo(firstEnd);
        if (first) {
          const scaled = fitPagesParagraphLine(first, contentWidth, available);
          append(scaled, estimateParagraphGroupHeight([scaled], contentWidth, wrap));
        }
        start = firstEnd;
        if (start < end) flush();
        continue;
      }
      const next = choosePagesTextEnd(text, start, end, firstEnd, segments, offset => used + pieceHeight(offset) <= available);
      const slice = sliceTo(next);
      if (slice) append(slice, pieceHeight(next));
      start = next;
      if (start < end) flush();
    }
  }
  flush();
  return parts.length ? parts : [{ frame, height: padding }];
}

function pagesGraphemeEnd(text: string, start: number, segments: Intl.Segments | undefined): number {
  const segment = segments?.containing(start);
  return segment ? segment.index + segment.segment.length : start + ((text.codePointAt(start) ?? 0) > 0xffff ? 2 : 1);
}

function pagesGraphemeStart(text: string, offset: number, segments: Intl.Segments | undefined): number {
  const unit = text.charCodeAt(offset);
  return segments?.containing(offset)?.index ?? (unit >= 0xdc00 && unit <= 0xdfff &&
    (text.codePointAt(offset - 1) ?? 0) > 0xffff ? offset - 1 : offset);
}

function choosePagesTextEnd(
  text: string, start: number, end: number, firstEnd: number, segments: Intl.Segments | undefined, fits: (offset: number) => boolean
): number {
  let low = firstEnd, high = Math.min(end, low + 1);
  while (high < end && fits(high)) {
    low = high;
    high = Math.min(end, start + (high - start) * 2);
  }
  while (low < high) {
    const middle = Math.ceil((low + high) / 2);
    if (fits(middle)) low = middle;
    else high = middle - 1;
  }
  if (low === end) return end;

  // Prefer a nearby word boundary, then keep any grapheme at the cut intact.
  let next = low;
  for (let at = next; at > start + (next - start) / 2; at -= 1) {
    if (/\s/u.test(text[at - 1])) { next = at; break; }
  }
  return Math.max(firstEnd, pagesGraphemeStart(text, next, segments));
}

function fitPagesParagraphLine(paragraph: TextParagraph, width: number, height: number): TextParagraph {
  const fontSize = pagesParagraphFontSize(paragraph);
  const text = collectParagraphVisibleText(paragraph);
  const bullet = paragraph.bullet?.char ?? (paragraph.bullet?.autoType ? '1.' : '');
  const indent = Math.max(0, (paragraph.marginLeft ?? 0) + Math.abs(paragraph.indent ?? 0));
  const textWidth = estimatePagesTextWidth(bullet + text, fontSize) + indent + 8;
  const lineHeight = paragraph.lineHeightUnit === 'px' ? Math.max(paragraph.lineHeight ?? 0, fontSize * PAGES_GLYPH_LINE_HEIGHT)
    : Math.max(paragraph.lineHeight ?? 0, PAGES_GLYPH_LINE_HEIGHT) * fontSize;
  const textHeight = Math.max(estimateParagraphGroupHeight([paragraph], width),
    lineHeight + (paragraph.spaceBefore ?? 0) + (paragraph.spaceAfter ?? 0));
  const scale = Math.min(1, Math.max(1, width) / textWidth, Math.max(1, height) / textHeight);
  if (scale >= 1) return paragraph;

  return {
    ...paragraph,
    marginLeft: paragraph.marginLeft == null ? undefined : paragraph.marginLeft * scale,
    indent: paragraph.indent == null ? undefined : paragraph.indent * scale,
    spaceBefore: (paragraph.spaceBefore ?? 0) * scale,
    spaceAfter: (paragraph.spaceAfter ?? 0) * scale,
    lineHeight: lineHeight * scale,
    lineHeightUnit: 'px',
    runs: paragraph.runs.map(run => ({
      ...run,
      fontSize: (run.fontSize ?? fontSize) * scale,
      baselineShift: run.baselineShift == null ? undefined : run.baselineShift * scale
    }))
  };
}

function buildPagesParagraphMetrics(paragraphs: TextParagraph[], availableWidth: number): PagesParagraphMetrics {
  const heights = paragraphs.map((paragraph, index) => estimateParagraphContentHeight(paragraph, availableWidth) +
    pagesParagraphGap(paragraph, paragraphs[index - 1]));
  const offsets: number[] = [];
  let totalHeight = 0;
  for (const height of heights) {
    offsets.push(totalHeight);
    totalHeight += height;
  }
  return {
    heights,
    offsets,
    totalHeight
  };
}

function estimatePagesWrappedLineCount(text: string, width: number, fontSize: number): number {
  let lines = 1;
  let lineWidth = 0;
  let spacing = 0;
  for (const [token] of text.matchAll(/[ \t]+|[^ \t]+/g)) {
    const tokenWidth = estimatePagesTextWidth(token, fontSize);
    if (token[0] === ' ' || token[0] === '\t') {
      spacing += tokenWidth;
      continue;
    }
    if (lineWidth > 0 && lineWidth + spacing + tokenWidth > width) {
      lines += 1;
      lineWidth = spacing = 0;
    }
    lineWidth += spacing + tokenWidth;
    spacing = 0;
    const wrapped = Math.max(0, Math.ceil(lineWidth / width) - 1);
    lines += wrapped;
    lineWidth -= wrapped * width;
  }
  return lines;
}

function estimatePagesTextWidth(text: string, fontSize: number): number {
  let units = 0;
  for (const char of text) {
    if (/\s/u.test(char)) {
      units += 0.33;
      continue;
    }
    if (isWideTextCharacter(char)) {
      units += 1;
      continue;
    }
    if (/[MW@%]/u.test(char)) {
      units += 0.95;
      continue;
    }
    if (/[mw]/u.test(char)) {
      units += 0.83;
      continue;
    }
    if (/[A-Z]/u.test(char)) {
      units += 0.64;
      continue;
    }
    if (/[a-z0-9]/u.test(char)) {
      units += 0.56;
      continue;
    }
    units += 0.5;
  }
  return units * fontSize;
}

function isWideTextCharacter(char: string): boolean {
  const codePoint = char.codePointAt(0) ?? 0;
  return (
    (codePoint >= 0x1100 && codePoint <= 0x115f) ||
    (codePoint >= 0x2e80 && codePoint <= 0xa4cf) ||
    (codePoint >= 0xac00 && codePoint <= 0xd7a3) ||
    (codePoint >= 0xf900 && codePoint <= 0xfaff) ||
    (codePoint >= 0xfe10 && codePoint <= 0xfe6f) ||
    (codePoint >= 0xff01 && codePoint <= 0xff60) ||
    (codePoint >= 0xffe0 && codePoint <= 0xffe6) ||
    codePoint >= 0x1f300
  );
}

function findBodyPageIndexForParagraph(pages: PaginatedPagesBodyPage[], paragraphIndex: number): number {
  for (const page of pages) {
    if (paragraphIndex < page.endParagraph || page.pageIndex === pages.length - 1) {
      return page.pageIndex;
    }
  }
  return 0;
}

function findBodyPageIndexForCharacter(
  pages: PaginatedPagesBodyPage[],
  characterIndex: number,
  anchorParagraphIndex: number
): number {
  for (const page of pages) {
    if (page.fragments.some((fragment) =>
      fragmentContainsCharacter(fragment, characterIndex, anchorParagraphIndex)
    )) {
      return page.pageIndex;
    }
  }
  return findBodyPageIndexForParagraph(pages, anchorParagraphIndex);
}

function appendPagesBodyItems(
  bodyFrame: TextFrame,
  page: PaginatedPagesBodyPage,
  layout: PagesLayoutModel,
  pageIndex: number,
  bodyBlocks: PagesBodyFlowBlock[],
  items: SlideItem[],
  bodyFlows: NonNullable<IworkCanvasModel['bodyFlows']>[number][],
  paragraphRanges?: PagesParagraphRange[]
): NonNullable<IworkCanvasModel['savedBodyText']> {
  const savedBodyText: NonNullable<IworkCanvasModel['savedBodyText']>[number][] = [];
  page.fragments.forEach((fragment, fragmentIndex) => {
    let fragmentBlocks = bodyBlocks.filter((block) => block.fragmentIndex === fragmentIndex);
    if (!fragmentBlocks.length) {
      return;
    }
    if (page.savedLayout && fragmentBlocks.length > 1 && fragmentBlocks.every(block => block.kind === 'paragraphs')) {
      // A saved text rectangle needs one frame so its content can rewrap or scroll together.
      fragmentBlocks = [{ ...fragmentBlocks[0], paragraphs: fragmentBlocks.flatMap(block => block.paragraphs ?? []) }];
    }

    const x = layout.leftMargin + (fragment.rect?.x ?? 0);
    const width = Math.max(fragment.rect?.width ?? layout.bodyWidth, 1);
    const defaultHeight = Math.max(fragment.rect?.height ?? layout.bodyHeight, 1);
    let cursorY = layout.topMargin + (fragment.rect?.y ?? 0);
    const bottom = Math.min(cursorY + defaultHeight, layout.height - layout.bottomMargin);
    const saveFlow = (start: number) => bodyFlows.push([start, items.length, bottom]);
    let previousParagraph: TextParagraph | undefined;
    let flowStart = items.length;
    let hasAutoFitTable = false;

    fragmentBlocks.forEach((block, blockIndex) => {
      if (block.kind === 'paragraphs' && block.paragraphs?.length) {
        if (page.savedLayout && fragmentBlocks.length === 1 && block.paragraphs.length === 1) {
          const paragraph = block.paragraphs[0];
          const fontSize = pagesParagraphFontSize(paragraph);
          const availableWidth = Math.min(width, layout.bodyWidth - Math.max(0, fragment.rect?.x ?? 0));
          const availableHeight = Math.min(defaultHeight, layout.bodyHeight - Math.max(0, fragment.rect?.y ?? 0));
          if (availableWidth > 0 && availableHeight > 0 && fontSize * PAGES_GLYPH_LINE_HEIGHT > Math.min(availableWidth, availableHeight)) {
            const text = collectParagraphVisibleText(paragraph).trim();
            const segments = typeof Intl.Segmenter === 'function' ? new Intl.Segmenter().segment(text) : undefined;
            if (text && pagesGraphemeEnd(text, 0, segments) === text.length) {
              block.paragraphs = [fitPagesParagraphLine(paragraph, availableWidth, availableHeight)];
            }
          }
        }
        const nextIsDrawable = Boolean(fragmentBlocks[blockIndex + 1]?.item);
        const paragraphs = block.paragraphs.map((paragraph, index, group) => {
          const spaceBefore = previousParagraph || blockIndex === 0
            ? pagesParagraphGap(paragraph, previousParagraph) : paragraph.spaceBefore;
          previousParagraph = paragraph;
          return {
            ...paragraph,
            spaceBefore,
            spaceAfter: nextIsDrawable && index === group.length - 1 ? paragraph.spaceAfter : 0,
            runs: paragraph.runs.some(run => run.text.length) ? paragraph.runs
              : [{ ...paragraph.runs[0], text: '\u00a0' }]
          };
        });
        const pageFrame: TextFrame = {
          ...bodyFrame,
          paragraphs,
          ...(fragment.columnCount != null ? { columns: fragment.columnCount } : {})
        };
        const isWholeFragmentText =
          fragmentBlocks.length === 1 &&
          blockIndex === 0 &&
          block.kind === 'paragraphs';
        const hasVisibleText = hasVisibleTextFrame(pageFrame);
        const height = isWholeFragmentText && hasVisibleText
          ? defaultHeight
          : Math.max(estimateParagraphGroupHeight(paragraphs, width), 1);
        if (!hasVisibleText) {
          cursorY += height;
          return;
        }
        if (page.savedLayout) {
          const first = block.firstParagraph;
          const source = hasAutoFitTable && first != null && paragraphRanges?.slice(first, first + paragraphs.length)
            .map(({ start, markers }, index) => ({ start, markers, visibleStart: index === 0 ? block.startVisibleOffset ?? 0 : 0 }));
          savedBodyText.push(source ? [items.length, bottom, source] : [items.length, bottom]);
        }
        items.push({
          id: `pages-body-${pageIndex + 1}-${fragmentIndex + 1}-${blockIndex + 1}`,
          kind: 'text',
          name: 'Body',
          order: items.length,
          groupPath: [],
          transform: {
            x,
            y: cursorY,
            width,
            height,
            rotation: 0,
            flipH: false,
            flipV: false
          },
          fill: {
            type: 'none'
          },
          textFrame: pageFrame
        });
        cursorY += height;
        return;
      }

      if (block.item) {
        if (block.flowPositioned) {
          block.item.transform.y = cursorY + (block.flowOffsetY ?? 0);
          hasAutoFitTable ||= block.item.kind === 'table' && block.item.autoFitRows === true;
        } else {
          if (hasAutoFitTable) saveFlow(flowStart);
          flowStart = items.length + 1;
          hasAutoFitTable = false;
        }
        items.push(block.item);
        cursorY = Math.max(cursorY, block.item.transform.y + Math.max(block.item.transform.height, 0));
        previousParagraph = undefined;
      }
    });
    if (hasAutoFitTable) saveFlow(flowStart);
  });
  return savedBodyText;
}

function findSavedPagesContinuations(
  bodyFrame: TextFrame, pages: PaginatedPagesBodyPage[], ranges: PagesParagraphRange[], layout: PagesLayoutModel,
  attachments: ReadonlyMap<number, PagesInlineAttachment[]>, measurements?: ReadonlyMap<string, PagesTableMeasurement>
): Map<number, PagesSavedContinuation> {
  const continuations = new Map<number, PagesSavedContinuation>();
  for (const page of pages) {
    const inline = attachments.get(page.pageIndex);
    if (!page.savedLayout || !inline?.some(attachment => attachment.flowPositioned)) continue;
    const blocks = buildPagesBodyFlowBlocksForPage(bodyFrame.paragraphs, page, inline, ranges, page.pageIndex);
    for (const [fragmentIndex, fragment] of page.fragments.entries()) {
      const flowItems = new Map(inline.filter(attachment => attachment.fragmentIndex === fragmentIndex && attachment.flowPositioned &&
        (attachment.startsPage || (attachment.characterIndex >= fragment.rangeStart! && attachment.characterIndex < fragment.rangeEnd!)))
        .map(attachment => [attachment.item.id, attachment]));
      if (!flowItems.size) continue;
      const probeBlocks = blocks.filter(block => block.fragmentIndex === fragmentIndex).map(block => {
        const item = block.item;
        if (!item) return { ...block, fragmentIndex: 0 };
        const measured = item.kind === 'table' && resolvePagesTableMeasurement(item, item.transform.width, measurements);
        const transform = { ...item.transform, height: measured ? measured.height : estimatePagesSavedItemHeight(item, item.transform.width) };
        return { ...block, fragmentIndex: 0, item: { ...item, transform } };
      });
      const items: SlideItem[] = [];
      const textItems = appendPagesBodyItems(
        bodyFrame, { ...page, fragments: [fragment] }, layout, page.pageIndex, probeBlocks, items, []
      );
      const overflow = textItems.find(([index, bottom]) => items[index].transform.y >= bottom - 0.01);
      if (measurements?.size) {
        let measuredBreak: { cutoff: number; leadingTableCharacterIndex?: number } | undefined;
        for (const { item, characterIndex, startsPage } of flowItems.values()) {
          if (item.kind !== 'table') continue;
          const cutoff = resolvePagesTableMeasurement(item, item.transform.width, measurements)?.textCutoff;
          if (cutoff == null || cutoff < fragment.rangeStart! || cutoff >= fragment.rangeEnd! ||
            (!startsPage && cutoff <= characterIndex) || (measuredBreak && measuredBreak.cutoff <= cutoff)) continue;
          measuredBreak = { cutoff, ...(startsPage ? { leadingTableCharacterIndex: characterIndex } : {}) };
        }
        const bottom = Math.min(layout.topMargin + (fragment.rect?.y ?? 0) + (fragment.rect?.height ?? layout.bodyHeight),
          layout.height - layout.bottomMargin);
        for (let index = 0; index < (overflow?.[0] ?? items.length); index += 1) {
          const item = items[index];
          const attachment = flowItems.get(item.id);
          if (!attachment || item.kind !== 'table' || item.transform.y + item.transform.height <= bottom + 1.5 ||
            (measuredBreak && attachment.characterIndex >= measuredBreak.cutoff)) continue;
          const measured = resolvePagesTableMeasurement(item, item.transform.width, measurements);
          if (!measured) continue;
          if (!attachment.partitioned) {
            continuations.set(page.pageIndex, { cutoff: attachment.characterIndex });
            break;
          }
          if (index === 0 && attachment.startsPage && page.fragments.length === 1 &&
            !inline.some(other => other.startsPage && other !== attachment)) {
            continuations.set(page.pageIndex, { cutoff: fragment.rangeStart!, leadingTableCharacterIndex: attachment.characterIndex,
              oversizedPartition: { item, measured } });
            break;
          }
        }
        if (continuations.has(page.pageIndex)) break;
        if (measuredBreak) {
          continuations.set(page.pageIndex, measuredBreak);
          break;
        }
      }
      if (!overflow) continue;
      const [index, bottom] = overflow;
      for (let before = index - 1; before >= 0; before -= 1) {
        const item = items[before];
        const attachment = flowItems.get(item.id);
        if (!attachment || item.transform.y >= bottom) continue;
        const tolerance = item.kind === 'table' && resolvePagesTableMeasurement(item, item.transform.width, measurements) ? 1.5 : 0.5;
        const moveObject = !attachment.partitioned && item.transform.y + item.transform.height > bottom + tolerance &&
          (item.kind === 'table' || item.transform.height <= layout.bodyHeight);
        continuations.set(page.pageIndex, attachment.startsPage
          ? { cutoff: fragment.rangeStart!, leadingTableCharacterIndex: attachment.characterIndex }
          : { cutoff: attachment.characterIndex + Number(!moveObject) });
        break;
      }
      if (continuations.has(page.pageIndex)) break;
    }
  }
  return continuations;
}

function keepPagesBodyBefore(
  page: PaginatedPagesBodyPage, cutoff: number, ranges: PagesParagraphRange[], bodyLength: number,
  leadingTableCharacterIndex?: number
): PaginatedPagesBodyPage | undefined {
  const fragments = page.fragments.flatMap((fragment, index) => {
    const start = fragment.rangeStart!;
    if (index === 0 && start === cutoff && leadingTableCharacterIndex != null) {
      return [{ ...fragment, rangeEnd: start, endParagraph: fragment.startParagraph }];
    }
    if (start >= cutoff) return [];
    if (fragment.rangeEnd! <= cutoff) return [fragment];
    const shortened = mapPagesTextRangeToParagraphFragment(ranges, {
      range: { location: start, length: cutoff - start }, rect: fragment.rect, columnCount: fragment.columnCount
    }, bodyLength);
    return shortened ? [shortened] : [];
  });
  return fragments.length ? { ...page, endParagraph: fragments.at(-1)!.endParagraph, fragments, leadingTableCharacterIndex } : undefined;
}

function buildPagesBodyFlowBlocksForPage(
  paragraphs: TextParagraph[],
  page: PaginatedPagesBodyPage,
  inlineAttachments: PagesInlineAttachment[],
  paragraphRanges: PagesParagraphRange[],
  pageIndex: number,
  sourceRecordId?: number
): PagesBodyFlowBlock[] {
  const blocks: PagesBodyFlowBlock[] = [];

  page.fragments.forEach((fragment, fragmentIndex) => {
    const fragmentAttachments: PagesInlineAttachment[] = [];
    for (const attachment of inlineAttachments) {
      if (attachment.fragmentIndex !== fragmentIndex) continue;
      if (attachment.startsPage) {
        blocks.push({ ...attachment.block, fragmentIndex, flowPositioned: attachment.flowPositioned, flowOffsetY: attachment.flowOffsetY });
      } else {
        fragmentAttachments.push(attachment);
      }
    }
    if (fragment.startParagraph === fragment.endParagraph) return;
    if (fragmentHasPartialParagraphBounds(fragment, paragraphs)) {
      blocks.push(
        ...buildPagesBodyFlowBlocksForPartialFragment(
          paragraphs,
          fragment,
          fragmentAttachments,
          paragraphRanges,
          pageIndex,
          fragmentIndex,
          sourceRecordId
        )
      );
      return;
    }
    let paragraphCursor = fragment.startParagraph;

    const attachmentsByParagraph = new Map<number, PagesInlineAttachment[]>();
    for (const attachment of fragmentAttachments) {
      const bucket = attachmentsByParagraph.get(attachment.anchorParagraphIndex) ?? [];
      bucket.push(attachment);
      attachmentsByParagraph.set(attachment.anchorParagraphIndex, bucket);
    }

    const anchoredParagraphIndexes = Array.from(attachmentsByParagraph.keys()).sort((left, right) => left - right);
    for (const paragraphIndex of anchoredParagraphIndexes) {
      const leadingParagraphBlock = buildParagraphBlock(
        `pages-paragraphs-${pageIndex + 1}-${fragmentIndex + 1}-${paragraphCursor}-${paragraphIndex}`,
        paragraphs,
        paragraphCursor,
        Math.min(fragment.endParagraph, paragraphIndex),
        sourceRecordId
      );
      if (leadingParagraphBlock) {
        blocks.push({
          ...leadingParagraphBlock,
          fragmentIndex
        });
      }

      const paragraph = paragraphs[paragraphIndex];
      const visibleParagraphLength = resolvePagesRenderedOffset(paragraphRanges[paragraphIndex]);
      let visibleCursor = 0;
      const paragraphAttachments = (attachmentsByParagraph.get(paragraphIndex) ?? [])
        .slice()
        .sort((left, right) => left.characterIndex - right.characterIndex);

      for (const attachment of paragraphAttachments) {
        const splitOffset = resolvePagesRenderedOffset(paragraphRanges[attachment.anchorParagraphIndex], attachment.characterIndex);
        const prefixBlock = buildParagraphSliceBlock(
          `pages-paragraphs-${pageIndex + 1}-${fragmentIndex + 1}-${paragraphIndex}-${visibleCursor}-${splitOffset}`,
          paragraph,
          paragraphIndex,
          visibleCursor,
          splitOffset,
          sourceRecordId
        );
        if (prefixBlock) {
          blocks.push({
            ...prefixBlock,
            fragmentIndex
          });
        }

        blocks.push({
          ...attachment.block,
          fragmentIndex,
          flowPositioned: attachment.flowPositioned,
          flowOffsetY: attachment.flowOffsetY
        });
        visibleCursor = splitOffset;
      }

      const trailingBlock = buildParagraphSliceBlock(
        `pages-paragraphs-${pageIndex + 1}-${fragmentIndex + 1}-${paragraphIndex}-${visibleCursor}-${visibleParagraphLength}`,
        paragraph,
        paragraphIndex,
        visibleCursor,
        visibleParagraphLength,
        sourceRecordId
      );
      if (trailingBlock) {
        blocks.push({
          ...trailingBlock,
          fragmentIndex
        });
      }

      paragraphCursor = Math.min(fragment.endParagraph, paragraphIndex + 1);
    }

    const trailingBlock = buildParagraphBlock(
      `pages-paragraphs-${pageIndex + 1}-${fragmentIndex + 1}-${paragraphCursor}-${fragment.endParagraph}`,
      paragraphs,
      paragraphCursor,
      fragment.endParagraph,
      sourceRecordId
    );
    if (trailingBlock) {
      blocks.push({
        ...trailingBlock,
        fragmentIndex
      });
    }
  });

  return blocks;
}

function fragmentHasPartialParagraphBounds(
  fragment: PaginatedPagesBodyFragment,
  paragraphs: TextParagraph[]
): boolean {
  if ((fragment.startVisibleOffset ?? 0) > 0) {
    return true;
  }

  if (fragment.endVisibleOffset == null || fragment.endParagraph <= fragment.startParagraph) {
    return false;
  }

  const lastParagraph = paragraphs[fragment.endParagraph - 1];
  const lastParagraphLength = lastParagraph?.runs.reduce((length, run) => length + run.text.length, 0) ?? 0;
  return fragment.endVisibleOffset < lastParagraphLength;
}

function buildPagesBodyFlowBlocksForPartialFragment(
  paragraphs: TextParagraph[],
  fragment: PaginatedPagesBodyFragment,
  fragmentAttachments: PagesInlineAttachment[],
  paragraphRanges: PagesParagraphRange[],
  pageIndex: number,
  fragmentIndex: number,
  sourceRecordId?: number
): PagesBodyFlowBlock[] {
  const blocks: PagesBodyFlowBlock[] = [];
  const attachmentsByParagraph = new Map<number, Array<PagesInlineAttachment & { visibleOffset: number }>>();

  for (const attachment of fragmentAttachments) {
    const visibleOffset = resolvePagesRenderedOffset(paragraphRanges[attachment.anchorParagraphIndex], attachment.characterIndex);
    const bucket = attachmentsByParagraph.get(attachment.anchorParagraphIndex) ?? [];
    bucket.push({
      ...attachment,
      visibleOffset
    });
    attachmentsByParagraph.set(attachment.anchorParagraphIndex, bucket);
  }

  for (let paragraphIndex = fragment.startParagraph; paragraphIndex < fragment.endParagraph; paragraphIndex += 1) {
    const paragraph = paragraphs[paragraphIndex];
    const paragraphLength = paragraph?.runs.reduce((length, run) => length + run.text.length, 0) ?? 0;
    const paragraphStart =
      paragraphIndex === fragment.startParagraph
        ? Math.max(0, fragment.startVisibleOffset ?? 0)
        : 0;
    const paragraphEnd =
      paragraphIndex === fragment.endParagraph - 1
        ? Math.min(fragment.endVisibleOffset ?? paragraphLength, paragraphLength)
        : paragraphLength;
    if (paragraphEnd < paragraphStart) {
      continue;
    }

    let visibleCursor = paragraphStart;
    const paragraphAttachments = (attachmentsByParagraph.get(paragraphIndex) ?? [])
      .filter((attachment) => attachment.visibleOffset >= paragraphStart && attachment.visibleOffset <= paragraphEnd)
      .sort((left, right) => left.visibleOffset - right.visibleOffset);

    for (const attachment of paragraphAttachments) {
      const prefixBlock = buildParagraphSliceBlock(
        `pages-paragraphs-${pageIndex + 1}-${fragmentIndex + 1}-${paragraphIndex}-${visibleCursor}-${attachment.visibleOffset}`,
        paragraph,
        paragraphIndex,
        visibleCursor,
        attachment.visibleOffset,
        sourceRecordId
      );
      if (prefixBlock) {
        blocks.push({
          ...prefixBlock,
          fragmentIndex
        });
      }

      blocks.push({
        ...attachment.block,
        fragmentIndex,
        flowPositioned: attachment.flowPositioned,
        flowOffsetY: attachment.flowOffsetY
      });
      visibleCursor = attachment.visibleOffset;
    }

    const trailingBlock = buildParagraphSliceBlock(
      `pages-paragraphs-${pageIndex + 1}-${fragmentIndex + 1}-${paragraphIndex}-${visibleCursor}-${paragraphEnd}`,
      paragraph,
      paragraphIndex,
      visibleCursor,
      paragraphEnd,
      sourceRecordId
    );
    if (trailingBlock) {
      blocks.push({
        ...trailingBlock,
        fragmentIndex
      });
    }
  }

  return blocks;
}

function buildPagesBodyBlocksForPage(
  paragraphs: TextParagraph[],
  page: PaginatedPagesBodyPage,
  inlineAttachments: PagesInlineAttachment[],
  paragraphRanges: PagesParagraphRange[],
  pageIndex: number,
  sourceRecordId?: number
): PagesBodyBlock[] {
  return buildPagesBodyFlowBlocksForPage(
    paragraphs,
    page,
    inlineAttachments,
    paragraphRanges,
    pageIndex,
    sourceRecordId
  ).map(toPagesBodyBlock);
}

function toPagesBodyBlock(block: PagesBodyFlowBlock): PagesBodyBlock {
  return {
    id: block.id,
    kind: block.kind,
    paragraphs: block.paragraphs,
    item: block.item,
    sourceRecordId: block.sourceRecordId
  };
}

function buildPagesFloatingGroups(
  context: SemanticBuildContext,
  documentValue: Record<string, unknown>,
  shiftPage: (pageIndex: number) => number
): Map<number, PagesFloatingGroup> {
  const groups = new Map<number, PagesFloatingGroup>();
  const floatingArchive = getRecordValue<Record<string, unknown>>(context.archive, readField(documentValue, ['floatingDrawables', 'floating_drawables']));
  const pageGroups = asArray<Record<string, unknown>>(readField(floatingArchive, ['pageGroups', 'page_groups']));

  for (const pageGroup of pageGroups) {
    const pageIndex = shiftPage(Math.max(0, Number(readField<number>(pageGroup, ['pageIndex', 'page_index']) ?? 0)));
    const group = groups.get(pageIndex) ?? {
      backgroundItems: [],
      drawableItems: [],
      foregroundItems: [],
      blocks: [],
      seenRecordIds: new Set<number>()
    };
    appendPagesFloatingEntries(context, pageIndex, group, asArray<Record<string, unknown>>(readField(pageGroup, ['backgroundDrawables', 'background_drawables'])), group.backgroundItems);
    appendPagesFloatingEntries(context, pageIndex, group, asArray<Record<string, unknown>>(readField(pageGroup, ['drawables'])), group.drawableItems);
    appendPagesFloatingEntries(context, pageIndex, group, asArray<Record<string, unknown>>(readField(pageGroup, ['foregroundDrawables', 'foreground_drawables'])), group.foregroundItems);
    groups.set(pageIndex, group);
  }

  return groups;
}

function appendPagesFloatingEntries(
  context: SemanticBuildContext,
  pageIndex: number,
  group: PagesFloatingGroup,
  entries: Array<Record<string, unknown>>,
  target: SlideItem[]
): void {
  for (const entry of entries) {
    const drawableRef = readField(entry, ['drawable']);
    const drawableRecord = getRecord(context.archive, drawableRef);
    const drawable = asObject(drawableRecord?.value);
    if (!drawable || (drawableRecord?.id != null && group.seenRecordIds.has(drawableRecord.id))) {
      continue;
    }

    const item = buildDrawableItem(context, drawable, target.length);
    if (!item) {
      continue;
    }

    target.push(item);
    group.blocks.push({
      id: `pages-floating-${pageIndex + 1}-${group.blocks.length + 1}`,
      kind: item.kind === 'table' ? 'table' : 'drawable',
      item,
      sourceRecordId: drawableRecord?.id
    });
    const pencilItems = buildPencilAnnotationItems(context, drawable, target.length);
    target.push(...pencilItems);
    pencilItems.forEach((pencilItem) => {
      group.blocks.push({
        id: `pages-floating-${pageIndex + 1}-${group.blocks.length + 1}`,
        kind: 'drawable',
        item: pencilItem,
        sourceRecordId: drawableRecord?.id
      });
    });
    if (drawableRecord?.id != null) {
      group.seenRecordIds.add(drawableRecord.id);
    }
  }
}

function maxPageIndexFromFloatingGroups(groups: Map<number, PagesFloatingGroup>): number {
  let maxPageIndex = -1;
  for (const pageIndex of groups.keys()) {
    maxPageIndex = Math.max(maxPageIndex, pageIndex);
  }
  return maxPageIndex;
}

function maxPageIndexFromAttachmentHints(hints: Map<number, PagesAttachmentPositionHint>): number {
  let maxPageIndex = -1;
  for (const hint of hints.values()) {
    maxPageIndex = Math.max(maxPageIndex, hint.pageIndex);
  }
  return maxPageIndex;
}

function readPagesBodyAttributes(table: unknown): PagesBodyAttribute[] {
  return asArray<Record<string, unknown>>(readField(asObject(table), ['entries']))
    .map((entry) => ({
      index: Number(readField<number>(entry, ['characterIndex', 'character_index']) ?? 0),
      refId: getRefId(readField(entry, ['object']))
    }))
    .sort((left, right) => left.index - right.index);
}

function buildPagesSectionStates(
  archive: IworkArchiveIndex,
  documentValue: Record<string, unknown>,
  bodyPages: ReadonlyMap<number, PaginatedPagesBodyPage>,
  totalPages: number,
  sectionEntries: PagesBodyAttribute[],
  paragraphRanges: PagesParagraphRange[]
): PagesSectionState[] {
  const states: PagesSectionState[] = [];
  const defaultSectionRefId = getRefId(readField(documentValue, ['section'])) ?? sectionEntries[0]?.refId;
  let previousSectionRefId = defaultSectionRefId;
  let previousSectionPageIndex = 0;
  let pageNumber = 0;
  let headerFooterSectionRefId = defaultSectionRefId;

  for (let pageIndex = 0; pageIndex < totalPages; pageIndex += 1) {
    const bodyPage = bodyPages.get(pageIndex);
    const firstParagraph = bodyPage && paragraphRanges[bodyPage.startParagraph];
    const startCharacterIndex = bodyPage?.leadingTableCharacterIndex ?? bodyPage?.fragments[0]?.rangeStart ?? (firstParagraph
      ? firstParagraph.start + (firstParagraph.text.startsWith('\u0004') ? 1 : 0) : undefined);
    const resolvedSectionRefId = startCharacterIndex != null
      ? resolvePagesSectionRefIdForCharacter(documentValue, startCharacterIndex, sectionEntries)
      : previousSectionRefId ?? defaultSectionRefId;
    const sectionRefId = resolvedSectionRefId ?? previousSectionRefId ?? defaultSectionRefId;
    const startsSection = pageIndex === 0 || sectionRefId !== previousSectionRefId;
    const sectionPageIndex = startsSection ? 1 : previousSectionPageIndex + 1;
    pageNumber += 1;
    if (startsSection) {
      const section = getRecordValue<Record<string, unknown>>(archive, sectionRefId);
      const kind = readField<number>(section, ['sectionPageNumberKind', 'section_page_number_kind']);
      const start = readField<number>(section, ['sectionPageNumberStart', 'section_page_number_start']);
      const validStart = typeof start === 'number' && Number.isInteger(start) && start > 0 ? start : undefined;
      if (kind === 1 || (kind === undefined && validStart !== undefined)) {
        pageNumber = validStart ?? 1;
      } else if (kind !== undefined && kind !== 0) {
        pushUniqueArchiveWarning(archive, `Unsupported Pages section page number kind ${kind}; continuing numbering.`);
      }
      if (pageIndex === 0 || readField<boolean>(section, ['inheritPreviousHeaderFooter', 'inherit_previous_header_footer']) !== true) {
        headerFooterSectionRefId = sectionRefId;
      }
    }

    states.push({
      sectionRefId,
      sectionPageIndex,
      pageNumber,
      headerFooterSectionRefId
    });
    previousSectionRefId = sectionRefId;
    previousSectionPageIndex = sectionPageIndex;
  }

  return states;
}

function resolvePagesSectionRefIdForCharacter(
  documentValue: Record<string, unknown>,
  characterIndex: number,
  sectionEntries: PagesBodyAttribute[]
): number | undefined {
  let sectionRefId = getRefId(readField(documentValue, ['section']));
  for (const entry of sectionEntries) {
    if (entry.index > characterIndex) {
      break;
    }
    if (entry.refId != null) {
      sectionRefId = entry.refId;
    }
  }
  return sectionRefId;
}

function findPagesBodyPageByIndex(
  pages: PaginatedPagesBodyPage[],
  pageIndex: number
): PaginatedPagesBodyPage | undefined {
  return pages.find((page) => page.pageIndex === pageIndex);
}

function hasAbsolutePagesAttachmentPosition(
  hint: PagesAttachmentPositionHint | undefined
): hint is PagesAttachmentPositionHint & { x: number; y: number } {
  return hint != null && Number.isFinite(hint.x) && Number.isFinite(hint.y);
}

function resolvePagesTableItemPartitions(
  item: TableItem,
  startPageIndex: number,
  hints: PagesTablePartitionHint[]
): PagesTablePart[] {
  const firstHint = hints.find((hint) =>
    hint.pageIndex === startPageIndex &&
    hint.rowStart === 0 &&
    hint.columnStart === 0 &&
    hint.columnCount === item.columns.length &&
    hint.rowCount > 0 &&
    hint.rowCount <= item.rows.length
  );
  if (!firstHint) {
    return [];
  }

  const matchedHints = [firstHint];
  let coveredRows = firstHint.rowCount;
  while (coveredRows < item.rows.length) {
    const nextHint = hints.find((hint) =>
      hint.pageIndex > matchedHints[matchedHints.length - 1].pageIndex &&
      hint.rowStart === coveredRows &&
      hint.columnStart === 0 &&
      hint.columnCount === item.columns.length &&
      hint.rowCount > 0 &&
      coveredRows + hint.rowCount <= item.rows.length
    );
    if (!nextHint) {
      return [];
    }
    matchedHints.push(nextHint);
    coveredRows += nextHint.rowCount;
  }

  return slicePagesTableItems(item, matchedHints);
}

function slicePagesTableItems(
  item: TableItem,
  ranges: ReadonlyArray<PagesTablePartitionHint | PagesEstimatedTablePart>
): PagesTablePart[] {
  const parts = ranges.map((range, index) => {
    const { rowStart, rowCount, pageIndex } = range;
    const rowEnd = Math.min(item.rows.length, rowStart + rowCount);
    const headerRows = 'headerRows' in range ? range.headerRows : 0;
    const rows = [...item.rows.slice(0, headerRows), ...item.rows.slice(rowStart, rowEnd)];
    const estimated = 'height' in range;
    const height = estimated ? range.height : rows.reduce((total, rowHeight) => total + rowHeight, 0);
    const hiddenRows = item.hiddenRows
      ?.filter(row => row < headerRows || (row >= rowStart && row < rowEnd))
      .map(row => row < headerRows ? row : headerRows + row - rowStart);
    const table: TableItem = {
      ...item,
      id: `${item.id}-part-${index + 1}`,
      transform: { ...item.transform, height },
      rows,
      cells: [],
      hiddenRows: hiddenRows?.length ? hiddenRows : undefined
    };
    return { pageIndex, item: table, rowStart, rowEnd, headerRows, estimated };
  });
  const repeatedHeaders = parts.filter(part => part.headerRows > 0);
  const maxHeaderRows = repeatedHeaders.reduce((max, part) => Math.max(max, part.headerRows), 0);

  for (const cell of item.cells) {
    if (cell.isMergedContinuation) continue;
    if (cell.row < maxHeaderRows) {
      for (const part of repeatedHeaders) {
        if (cell.row < part.headerRows) {
          part.item.cells.push({ ...cell, rowSpan: Math.min(cell.rowSpan, part.headerRows - cell.row) });
        }
      }
    }
    let low = 0, high = parts.length;
    while (low < high) {
      const mid = Math.floor((low + high) / 2);
      if (parts[mid].rowEnd <= cell.row) low = mid + 1;
      else high = mid;
    }
    const cellEnd = cell.row + Math.max(cell.rowSpan, 1);
    for (let index = low; index < parts.length && parts[index].rowStart < cellEnd; index += 1) {
      const part = parts[index];
      const overlapStart = Math.max(cell.row, part.rowStart);
      part.item.cells.push({
        ...cell,
        row: part.headerRows + overlapStart - part.rowStart,
        rowSpan: Math.min(cellEnd, part.rowEnd) - overlapStart,
        ...(part.estimated && cell.row < part.rowStart ? { textFrame: { ...cell.textFrame, paragraphs: [] } } : {})
      });
    }
  }
  return parts;
}

function buildPagesTablePartitionHints(
  archive: IworkArchiveIndex,
  documentValue: Record<string, unknown>
): PagesTablePartitionHint[] {
  const hints: PagesTablePartitionHint[] = [];
  const layoutState = resolvePagesLayoutState(archive, documentValue);
  const sectionHints = asArray<Record<string, unknown>>(readField(layoutState, ['sectionHints', 'section_hints']));

  for (const sectionHint of sectionHints) {
    const startPageIndex = Math.max(0, Number(readField<number>(sectionHint, ['startPageIndex', 'start_page_index']) ?? 0));
    const pageHints = asArray<Record<string, unknown>>(readField(sectionHint, ['pageHints', 'page_hints']));
    for (let localPageIndex = 0; localPageIndex < pageHints.length; localPageIndex += 1) {
      const childRefs = asArray<unknown>(readField(pageHints[localPageIndex], ['childHints', 'child_hints']));
      for (const childRef of childRefs) {
        const childRecord = getRecord(archive, childRef);
        if (childRecord?.typeName !== 'TST.LayoutHintArchive') {
          continue;
        }
        const childHint = asObject(childRecord.value);
        if (!childHint || readField<boolean>(childHint, ['isValid', 'is_valid']) === false) {
          continue;
        }
        const range = resolvePagesTablePartitionRange(asObject(readField(childHint, ['cellRange', 'cell_range'])));
        if (!range || range.rowCount <= 0 || range.columnCount <= 0) {
          continue;
        }
        hints.push({
          pageIndex: startPageIndex + localPageIndex,
          ...range
        });
      }
    }
  }

  return hints.sort((left, right) => left.pageIndex - right.pageIndex || left.rowStart - right.rowStart);
}

function resolvePagesTablePartitionRange(cellRange: Record<string, unknown> | undefined): Omit<PagesTablePartitionHint, 'pageIndex'> | undefined {
  if (!cellRange) {
    return undefined;
  }
  const origin = asObject(readField(cellRange, ['origin']));
  const expandedOrigin = asObject(readField(origin, ['expandedCoord', 'expanded_coord']));
  const packedOrigin = origin && readPackedCellCoordinate(origin);
  const size = asObject(readField(cellRange, ['size']));
  const rowStart = Number(readField<number>(expandedOrigin, ['row']) ?? packedOrigin?.row ?? 0);
  const columnStart = Number(readField<number>(expandedOrigin, ['column']) ?? packedOrigin?.column ?? 0);
  const packedSize = Number(readField<number>(size, ['packedData', 'packed_data']) ?? 0) >>> 0;
  const rowCount = Number(readField<number>(size, ['numRows', 'num_rows']) ?? (packedSize & 0xffff));
  const columnCount = Number(readField<number>(size, ['numColumns', 'num_columns']) ?? (packedSize >>> 16));
  if (![rowStart, columnStart, rowCount, columnCount].every(Number.isFinite)) {
    return undefined;
  }
  return {
    rowStart: Math.max(0, Math.trunc(rowStart)),
    rowCount: Math.max(0, Math.trunc(rowCount)),
    columnStart: Math.max(0, Math.trunc(columnStart)),
    columnCount: Math.max(0, Math.trunc(columnCount))
  };
}

function buildPagesAttachmentPositionHints(
  archive: IworkArchiveIndex,
  documentValue: Record<string, unknown>
): Map<number, PagesAttachmentPositionHint> {
  const hints = new Map<number, PagesAttachmentPositionHint>();
  const objectIdsByUuid = buildPagesObjectIdsByUuid(archive.packageMetadata);
  const layoutState = resolvePagesLayoutState(archive, documentValue);
  const sectionHints = asArray<Record<string, unknown>>(readField(layoutState, ['sectionHints', 'section_hints']));

  for (const sectionHint of sectionHints) {
    const startPageIndex = Math.max(0, Number(readField<number>(sectionHint, ['startPageIndex', 'start_page_index']) ?? 0));
    const pageHints = asArray<Record<string, unknown>>(readField(sectionHint, ['pageHints', 'page_hints']));
    for (let localPageIndex = 0; localPageIndex < pageHints.length; localPageIndex += 1) {
      const pageHint = pageHints[localPageIndex];
      const pageIndex = startPageIndex + localPageIndex;
      const partitionedAttachmentUuids = asArray<unknown>(readField(pageHint, ['partitionedAttachmentUuids', 'partitioned_attachment_uuids']));
      for (const uuid of partitionedAttachmentUuids) {
        const uuidKey = uuidToKey(uuid);
        const drawableId = uuidKey ? objectIdsByUuid.get(uuidKey) : undefined;
        if (drawableId != null && !hints.has(drawableId)) {
          hints.set(drawableId, { pageIndex });
        }
      }
      const anchoredAttachments = asArray<Record<string, unknown>>(readField(pageHint, ['anchoredAttachmentsMap', 'anchored_attachments_map']));
      for (const anchoredAttachment of anchoredAttachments) {
        const attachmentId = getRefId(readField(anchoredAttachment, ['attachment']));
        const anchorPosition = asObject(readField(anchoredAttachment, ['doublePosition', 'double_position'])) ??
          asObject(readField(anchoredAttachment, ['position']));
        const x = Number(readField<number>(anchorPosition, ['x']) ?? NaN);
        const y = Number(readField<number>(anchorPosition, ['y']) ?? NaN);
        if (attachmentId == null || !Number.isFinite(x) || !Number.isFinite(y)) {
          continue;
        }
        hints.set(attachmentId, {
          pageIndex,
          x,
          y
        });
      }
    }
  }

  return hints;
}

function buildPagesObjectIdsByUuid(packageMetadata: unknown): Map<string, number> {
  const ids = new Map<string, number>();
  const components = asArray<Record<string, unknown>>(readField(asObject(packageMetadata), ['components']));
  for (const component of components) {
    const entries = asArray<Record<string, unknown>>(readField(component, ['objectUuidMapEntries', 'object_uuid_map_entries']));
    for (const entry of entries) {
      const key = uuidToKey(readField(entry, ['uuid']));
      const identifier = Number(readField<number>(entry, ['identifier']) ?? NaN);
      if (key && Number.isFinite(identifier)) {
        ids.set(key, identifier);
      }
    }
  }
  return ids;
}

function resolvePagesPageHintTextFragments(pageHint: Record<string, unknown> | undefined): PagesTextHintFragment[] {
  const targetHints = asArray<Record<string, unknown>>(readField(pageHint, ['targetHints', 'target_hints']));
  const flowHints = asArray<Record<string, unknown>>(readField(pageHint, ['flowHints', 'flow_hints']));
  const textHints = targetHints.length ? targetHints : flowHints;
  const fragments: PagesTextHintFragment[] = [];

  for (const hint of textHints) {
    const range = asObject(readField(hint, ['range'])) ?? asObject(readField(hint, ['anchoredRange', 'anchored_range']));
    const location = Number(readField<number>(range, ['location']) ?? NaN);
    const length = Number(readField<number>(range, ['length']) ?? NaN);
    if (!Number.isFinite(location) || !Number.isFinite(length) || length <= 0) {
      continue;
    }

    const rect = resolvePagesTextHintRect(hint);
    const columnCount = normalizePagesTextHintColumnCount(readField<number>(hint, ['columnCount', 'column_count']));
    fragments.push({
      range: {
        location,
        length
      },
      ...(rect ? { rect } : {}),
      ...(columnCount != null ? { columnCount } : {})
    });
  }

  return fragments.sort((left, right) =>
    left.range.location - right.range.location ||
    (right.range.location + right.range.length) - (left.range.location + left.range.length)
  );
}

function resolvePagesTextHintRect(hint: Record<string, unknown> | undefined): PagesBodyFragmentRect | undefined {
  const origin = asObject(readField(hint, ['doubleOrigin', 'double_origin'])) ?? asObject(readField(hint, ['frameOrigin', 'frame_origin']));
  const size = asObject(readField(hint, ['doubleSize', 'double_size'])) ?? asObject(readField(hint, ['frameSize', 'frame_size']));
  const x = Number(readField<number>(origin, ['x']) ?? NaN);
  const y = Number(readField<number>(origin, ['y']) ?? NaN);
  const width = Number(readField<number>(size, ['width']) ?? NaN);
  const height = Number(readField<number>(size, ['height']) ?? NaN);

  if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(width) || !Number.isFinite(height)) {
    return undefined;
  }

  return {
    x,
    y,
    width,
    height
  };
}

function pushPagesPageHintLayoutWarnings(
  archive: IworkArchiveIndex,
  pageHint: Record<string, unknown> | undefined,
  fragmentCount: number,
  normalizedFragments?: PaginatedPagesBodyFragment[]
): void {
  const textHints = [
    ...asArray<Record<string, unknown>>(readField(pageHint, ['targetHints', 'target_hints'])),
    ...asArray<Record<string, unknown>>(readField(pageHint, ['flowHints', 'flow_hints']))
  ];

  for (const hint of textHints) {
    const columnCount = normalizePagesTextHintColumnCount(readField<number>(hint, ['columnCount', 'column_count'])) ?? 1;
    const normalizedFragmentCount = resolvePagesHintColumnFragmentCount(columnCount, normalizedFragments);
    const effectiveFragmentCount = normalizedFragmentCount ?? fragmentCount;
    if (
      columnCount > 1 &&
      effectiveFragmentCount > 1 &&
      effectiveFragmentCount < columnCount &&
      !pagesTextHintHasExplicitFragmentGeometry(hint)
    ) {
      pushUniqueArchiveWarning(
        archive,
        `Pages text hint column count ${columnCount} is not fully supported; using fragment-based fallback.`
      );
    }
  }
}

function pagesTextHintHasExplicitFragmentGeometry(hint: Record<string, unknown> | undefined): boolean {
  return Boolean(resolvePagesTextHintRect(hint));
}

function resolvePagesHintColumnFragmentCount(
  columnCount: number,
  fragments: PaginatedPagesBodyFragment[] | undefined
): number | undefined {
  if (!fragments?.length) {
    return undefined;
  }

  const matchingFragments = fragments.filter((fragment) =>
    fragment.columnCount === columnCount &&
    fragment.rect == null
  );
  return matchingFragments.length || undefined;
}

function mapPagesTextRangeToParagraphFragment(
  paragraphRanges: PagesParagraphRange[],
  hintFragment: PagesTextHintFragment,
  textLength: number
): PaginatedPagesBodyFragment | undefined {
  if (!paragraphRanges.length) {
    return undefined;
  }

  const startParagraph = findParagraphIndexForCharacter(paragraphRanges, hintFragment.range.location);
  const rangeEnd = Math.min(textLength, hintFragment.range.location + hintFragment.range.length);
  const endParagraph = findParagraphEndIndexForCharacter(paragraphRanges, rangeEnd);
  const normalizedEndParagraph = Math.max(endParagraph, startParagraph + 1);
  if (normalizedEndParagraph <= startParagraph) {
    return undefined;
  }

  return withPagesFragmentTextOffsets({
    startParagraph,
    endParagraph: normalizedEndParagraph,
    rangeStart: hintFragment.range.location,
    rangeEnd,
    rect: hintFragment.rect,
    columnCount: hintFragment.columnCount
  }, paragraphRanges);
}

function withPagesFragmentTextOffsets(fragment: PaginatedPagesBodyFragment, ranges: PagesParagraphRange[]): PaginatedPagesBodyFragment {
  if (fragment.rangeStart == null || fragment.rangeEnd == null || fragment.startParagraph === fragment.endParagraph) return fragment;
  const first = ranges[fragment.startParagraph];
  const last = ranges[fragment.endParagraph - 1];
  const endVisibleOffset = fragment.rangeEnd < last.start + last.text.length
    ? resolvePagesRenderedOffset(last, fragment.rangeEnd) : undefined;
  return {
    ...fragment,
    startVisibleOffset: fragment.rangeStart !== first.start ? resolvePagesRenderedOffset(first, fragment.rangeStart) : undefined,
    endVisibleOffset: endVisibleOffset != null && endVisibleOffset < resolvePagesRenderedOffset(last) ? endVisibleOffset : undefined
  };
}

function normalizePagesTextHintColumnCount(value: number | undefined): number | undefined {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 1) {
    return undefined;
  }
  return Math.max(2, Math.round(value));
}

function resolvePagesLayoutStatePageCount(
  archive: IworkArchiveIndex,
  documentValue: Record<string, unknown>
): number {
  const layoutState = resolvePagesLayoutState(archive, documentValue);
  const sectionHints = asArray<Record<string, unknown>>(readField(layoutState, ['sectionHints', 'section_hints']));
  let maxPageCount = 0;

  for (const sectionHint of sectionHints) {
    const startPageIndex = Math.max(0, Number(readField<number>(sectionHint, ['startPageIndex', 'start_page_index']) ?? 0));
    const pageHints = asArray<Record<string, unknown>>(readField(sectionHint, ['pageHints', 'page_hints']));
    maxPageCount = Math.max(maxPageCount, startPageIndex + pageHints.length);
  }

  return maxPageCount;
}

function resolvePagesLayoutState(
  archive: IworkArchiveIndex,
  documentValue: Record<string, unknown>
): Record<string, unknown> | undefined {
  const preferredLayoutState = getRecordValue<Record<string, unknown>>(
    archive,
    readField(documentValue, ['deprecatedLayoutState', 'deprecated_layout_state', 'layoutState', 'layout_state'])
  );
  if (preferredLayoutState) {
    const sectionHints = asArray<Record<string, unknown>>(readField(preferredLayoutState, ['sectionHints', 'section_hints']));
    if (sectionHints.length) {
      return preferredLayoutState;
    }
    const normalizedLegacyState = normalizeLegacyPagesViewState(documentValue, preferredLayoutState);
    if (normalizedLegacyState) {
      return normalizedLegacyState;
    }
  }

  const layoutStateFromViewStateRoot = resolvePagesLayoutStateFromViewStateRoot(archive);
  if (layoutStateFromViewStateRoot) {
    return layoutStateFromViewStateRoot;
  }

  const layoutState = asObject(findRecordByType(archive, 'TP.LayoutStateArchive')?.value);
  if (layoutState) {
    return layoutState;
  }
  const legacyViewState = asObject(findRecordByType(archive, 'TSK.ViewStateArchive')?.value);
  return legacyViewState ? normalizeLegacyPagesViewState(documentValue, legacyViewState) : undefined;
}

function resolvePagesLayoutStateFromViewStateRoot(
  archive: IworkArchiveIndex
): Record<string, unknown> | undefined {
  const viewStateRecord = findRecordByType(archive, 'TSK.ViewStateArchive');
  const viewStateValue = asObject(viewStateRecord?.value);
  if (!viewStateRecord || !viewStateValue) {
    return undefined;
  }

  const viewStateRoot = getRecordValue<Record<string, unknown>>(
    archive,
    readField(viewStateValue, ['viewStateRoot', 'view_state_root'])
  );
  if (!viewStateRoot) {
    return undefined;
  }

  const layoutStateRef = readField(viewStateRoot, ['layoutState', 'layout_state']);
  const explicitLayoutState = getRecordValue<Record<string, unknown>>(archive, layoutStateRef);
  const explicitSectionHints = asArray<Record<string, unknown>>(readField(explicitLayoutState, ['sectionHints', 'section_hints']));
  if (explicitSectionHints.length) {
    return explicitLayoutState;
  }

  const outgoingRefs = archive.references.outgoing[String(findRecordIdByValue(archive, viewStateRoot) ?? '')] ?? [];
  for (const recordId of outgoingRefs) {
    const record = archive.records[String(recordId)];
    const value = asObject(record?.value);
    if (!value || record?.typeName !== 'TP.LayoutStateArchive') {
      continue;
    }
    const sectionHints = asArray<Record<string, unknown>>(readField(value, ['sectionHints', 'section_hints']));
    if (sectionHints.length) {
      return value;
    }
  }

  return undefined;
}

function normalizeLegacyPagesViewState(
  documentValue: Record<string, unknown>,
  viewState: Record<string, unknown>
): Record<string, unknown> | undefined {
  const bodyStorageId = getRefId(readField(documentValue, ['bodyStorage', 'body_storage']));
  const pageHintTargets = asArray<Record<string, unknown>>(readField(viewState, ['pageHintForTarget', 'page_hint_for_target']));
  const matchingTarget = pageHintTargets.find((entry) => getRefId(readField(entry, ['target'])) === bodyStorageId);
  if (!matchingTarget) {
    return undefined;
  }

  const pageInfos = asArray<Record<string, unknown>>(readField(matchingTarget, ['pageInfos', 'page_infos']));
  if (!pageInfos.length) {
    return undefined;
  }

  const leftMargin = Number(readField<number>(documentValue, ['leftMargin', 'left_margin']) ?? 0);
  const topMargin = Number(readField<number>(documentValue, ['topMargin', 'top_margin']) ?? 0);
  const pageHintMap = new Map<number, Record<string, unknown>>();

  for (const pageInfo of pageInfos) {
    const pageIndex = Math.max(0, Number(readField<number>(pageInfo, ['pageIndex', 'page_index']) ?? 0));
    const bodyPageHint = asObject(readField(pageInfo, ['bodyPageHint', 'body_page_hint']));
    const targetInfos = asArray<Record<string, unknown>>(readField(bodyPageHint, ['targetInfos', 'target_infos']));
    if (!targetInfos.length) {
      continue;
    }

    const targetHints = targetInfos.map((targetInfo) => {
      const rect = asObject(readField(targetInfo, ['rect']));
      const origin = asObject(readField(rect, ['origin']));
      const size = asObject(readField(rect, ['size']));
      return {
        range: readField(targetInfo, ['range']),
        doubleOrigin: {
          x: Number(readField<number>(origin, ['x']) ?? 0) - leftMargin,
          y: Number(readField<number>(origin, ['y']) ?? 0) - topMargin
        },
        doubleSize: {
          width: Number(readField<number>(size, ['width']) ?? 0),
          height: Number(readField<number>(size, ['height']) ?? 0)
        }
      };
    });

    pageHintMap.set(pageIndex, {
      targetHints
    });
  }

  if (!pageHintMap.size) {
    return undefined;
  }

  const maxPageIndex = Math.max(...pageHintMap.keys());
  const pageHints = Array.from({ length: maxPageIndex + 1 }, (_, pageIndex) => pageHintMap.get(pageIndex) ?? {});
  return {
    sectionHints: [
      {
        startPageIndex: 0,
        pageHints
      }
    ]
  };
}

function resolvePagesSectionForPage(
  context: SemanticBuildContext,
  pageIndex: number,
  pageCount: number,
  sectionState: PagesSectionState,
  settings: Record<string, unknown> | undefined,
  previousHeaderFooterRefs?: PagesHeaderFooterRefs
): PagesResolvedSection {
  const { sectionRefId, sectionPageIndex, pageNumber } = sectionState;
  const section = getRecordValue<Record<string, unknown>>(context.archive, sectionRefId);
  const sectionTemplate = legacyPagesSectionTemplate(context.archive, section);
  const pageTemplateRecord = pagesTemplateRecord(context.archive, section, sectionPageIndex);
  const inheritedSectionRefId = sectionState.headerFooterSectionRefId;
  const inheritedSection = inheritedSectionRefId !== sectionRefId
    ? getRecordValue<Record<string, unknown>>(context.archive, inheritedSectionRefId) : undefined;
  const matchPrevious = readField<boolean>(pageTemplateRecord?.value, ['headersFootersMatchPreviousPage', 'headers_footers_match_previous_page']);
  const headerFooterRefs = matchPrevious && previousHeaderFooterRefs ? previousHeaderFooterRefs : inheritedSection
    ? pagesHeaderFooterRefs(context.archive, legacyPagesSectionTemplate(context.archive, inheritedSection),
      pagesTemplateRecord(context.archive, inheritedSection, sectionPageIndex))
    : pagesHeaderFooterRefs(context.archive, sectionTemplate, pageTemplateRecord);

  return {
    sectionRefId,
    section,
    sectionTemplate,
    pageTemplateRecord,
    headerFooterRefs,
    documentPageNumber: pageIndex + 1,
    sectionPageIndex,
    pageNumber,
    pageCount,
    headersEnabled: isPagesHeaderFooterSettingEnabled(settings, 'headers'),
    footersEnabled: isPagesHeaderFooterSettingEnabled(settings, 'footers')
  };
}

function legacyPagesSectionTemplate(archive: IworkArchiveIndex, section: Record<string, unknown> | undefined) {
  const record = getRecord(archive, readField(section, ['userDefinedGuideStorage', 'user_defined_guide_storage']));
  return record?.typeName === 'TP.SectionTemplateArchive' ? asObject(record.value) : undefined;
}

function pagesTemplateRecord(archive: IworkArchiveIndex, section: Record<string, unknown> | undefined, sectionPageIndex: number):
  PagesResolvedSection['pageTemplateRecord'] {
  const record = getRecord(archive, resolvePagesTemplateRef(section, sectionPageIndex));
  const value = asObject(record?.value);
  return record && value ? { id: record.id, typeName: record.typeName, value } : undefined;
}

function pagesHeaderFooterRefs(archive: IworkArchiveIndex, legacyTemplate: Record<string, unknown> | undefined,
  pageTemplate: PagesResolvedSection['pageTemplateRecord']): PagesHeaderFooterRefs {
  const template = pageTemplate?.typeName === 'TP.SectionTemplateArchive' ? pageTemplate.value : legacyTemplate;
  const headers = asArray<unknown>(readField(template, ['headers']));
  const footers = asArray<unknown>(readField(template, ['footers']));
  const storage = headers.length && footers.length ? [] : resolvePagesTemplateStorageRefs(archive, pageTemplate);
  return { headers: headers.length ? headers : storage.slice(0, 3), footers: footers.length ? footers : storage.slice(3, 6) };
}

function isPagesHeaderFooterSettingEnabled(
  settings: Record<string, unknown> | undefined,
  field: 'headers' | 'footers'
): boolean {
  return readField<boolean>(settings, [field]) !== false;
}

function resolvePagesTemplateRef(section: Record<string, unknown> | undefined, pageNumber: number): number | undefined {
  if (!section) {
    return undefined;
  }

  if (pageNumber === 1 && readField<boolean>(section, ['sectionTemplateFirstPageDifferent', 'section_template_first_page_different']) !== false) {
    const firstRef = getRefId(readField(section, ['firstSectionTemplatePage', 'first_section_template_page']));
    if (firstRef != null) {
      return firstRef;
    }
  }

  const evenOddDifferent = Boolean(readField<boolean>(section, ['sectionTemplateEvenOddPagesDifferent', 'section_template_even_odd_pages_different']));
  if (evenOddDifferent) {
    if (pageNumber % 2 === 0) {
      const evenRef = getRefId(readField(section, ['evenSectionTemplatePage', 'even_section_template_page']));
      if (evenRef != null) {
        return evenRef;
      }
    } else {
      const oddRef = getRefId(readField(section, ['oddSectionTemplatePage', 'odd_section_template_page']));
      if (oddRef != null) {
        return oddRef;
      }
    }
  }

  return getRefId(readField(section, ['oddSectionTemplatePage', 'odd_section_template_page'])) ??
    getRefId(readField(section, ['evenSectionTemplatePage', 'even_section_template_page'])) ??
    getRefId(readField(section, ['firstSectionTemplatePage', 'first_section_template_page']));
}

function buildPagesTemplateDecorations(
  context: SemanticBuildContext,
  resolvedSection: PagesResolvedSection,
  layout: PagesLayoutModel
): PagesTemplateDecorations {
  const background = fillFromValue(readField(resolvedSection.pageTemplateRecord?.value, ['backgroundFill', 'background_fill']) ??
    readField(resolvedSection.section, ['backgroundFill', 'background_fill']));
  const leadingItems: SlideItem[] = [];
  const trailingItems: SlideItem[] = [];
  const blocks: PagesBodyBlock[] = [];
  const seen = new Set<number>();

  const appendDrawable = (drawableRef: unknown, target: SlideItem[]) => {
    const drawableRecord = getRecord(context.archive, drawableRef);
    const drawable = asObject(drawableRecord?.value);
    if (!drawable || (drawableRecord?.id != null && seen.has(drawableRecord.id))) {
      return;
    }
    const item = buildDrawableItem(context, drawable, target.length + leadingItems.length + trailingItems.length);
    if (!item) {
      return;
    }
    target.push(item);
    blocks.push({
      id: `pages-template-${resolvedSection.documentPageNumber}-${blocks.length + 1}`,
      kind: item.kind === 'table' ? 'table' : 'drawable',
      item,
      sourceRecordId: drawableRecord?.id
    });
    const pencilItems = buildPencilAnnotationItems(
      context,
      drawable,
      target.length + leadingItems.length + trailingItems.length
    );
    target.push(...pencilItems);
    pencilItems.forEach((pencilItem) => {
      blocks.push({
        id: `pages-template-${resolvedSection.documentPageNumber}-${blocks.length + 1}`,
        kind: 'drawable',
        item: pencilItem,
        sourceRecordId: drawableRecord?.id
      });
    });
    if (drawableRecord?.id != null) {
      seen.add(drawableRecord.id);
    }
  };

  const sectionTemplateDrawables = asArray<unknown>(readField(resolvedSection.sectionTemplate, ['sectionTemplateDrawables', 'section_template_drawables']));
  for (const drawableRef of sectionTemplateDrawables) {
    appendDrawable(drawableRef, leadingItems);
  }

  const pageTemplateDrawables = asArray<unknown>(readField(resolvedSection.pageTemplateRecord?.value, ['sectionTemplateDrawables', 'section_template_drawables']));
  for (const drawableRef of pageTemplateDrawables) {
    appendDrawable(drawableRef, leadingItems);
  }

  const placeholderDrawables = asArray<Record<string, unknown>>(readField(resolvedSection.pageTemplateRecord?.value, ['placeholderDrawables', 'placeholder_drawables']))
    .slice()
    .sort((left, right) => Number(readField<number>(left, ['zIndex', 'z_index']) ?? 0) - Number(readField<number>(right, ['zIndex', 'z_index']) ?? 0));
  for (const placeholder of placeholderDrawables) {
    appendDrawable(readField(placeholder, ['drawable']), trailingItems);
  }

  const firstPageHidesHeaderFooter = resolvedSection.sectionPageIndex === 1 &&
    Boolean(readField<boolean>(resolvedSection.section, ['sectionTemplateFirstPageHidesHeaderFooter', 'section_template_first_page_hides_header_footer']));
  if (!firstPageHidesHeaderFooter && !shouldHidePagesHeadersFooters(resolvedSection.pageTemplateRecord?.value)) {
    const headerFooterItems = buildPagesHeaderFooterItems(context, resolvedSection, layout);
    for (const item of headerFooterItems) {
      trailingItems.push(item);
      blocks.push({
        id: `pages-template-header-footer-${resolvedSection.documentPageNumber}-${blocks.length + 1}`,
        kind: 'drawable',
        item,
        sourceRecordId: undefined
      });
    }
  }

  return {
    background,
    leadingItems,
    trailingItems,
    blocks
  };
}

function shouldHidePagesHeadersFooters(pageTemplate: Record<string, unknown> | undefined): boolean {
  return Boolean(readField<boolean>(pageTemplate, ['hideHeadersFooters', 'hide_headers_footers']));
}

function buildPagesHeaderFooterItems(
  context: SemanticBuildContext,
  resolvedSection: PagesResolvedSection,
  layout: PagesLayoutModel
): SlideItem[] {
  const slotWidth = Math.max(layout.bodyWidth / 3, 48);
  const slotHeight = 24;
  const topY = Math.max(0, layout.headerMargin ?? layout.topMargin - slotHeight);
  const bottomY = Math.max(0, layout.footerMargin === undefined ? layout.height - layout.bottomMargin + 6
    : layout.height - layout.footerMargin - slotHeight);
  const items: SlideItem[] = [];

  const appendStorageSlots = (refs: readonly unknown[], section: 'header' | 'footer', y: number) => {
    refs.forEach((ref, slotIndex) => {
      const storage = getRecord(context.archive, ref);
      if (storage?.typeName !== 'TSWP.StorageArchive') return;
      const textFrame = buildTextFrameFromStorage(context.archive, storage.value, {
        padding: {
          top: 0,
          right: 0,
          bottom: 0,
          left: 0
        },
        verticalAlign: section === 'header' ? 'top' : 'bottom',
        attachmentContext: {
          documentName: context.archive.sourceName,
          pageNumber: resolvedSection.pageNumber,
          pageCount: resolvedSection.pageCount,
          updatePageNumbers: true
        }
      });
      if (!textFrame || !hasVisibleTextFrame(textFrame)) {
        return;
      }

      const align: TextParagraph['align'] =
        slotIndex === 0 ? 'left' : slotIndex === 1 ? 'center' : 'right';
      items.push({
        id: `pages-${section}-${resolvedSection.documentPageNumber}-${slotIndex}`,
        kind: 'text',
        name: `${section}-${slotIndex}`,
        order: items.length,
        groupPath: [],
        transform: {
          x: layout.leftMargin + slotIndex * slotWidth,
          y,
          width: slotWidth,
          height: slotHeight,
          rotation: 0,
          flipH: false,
          flipV: false
        },
        fill: {
          type: 'none'
        },
        textFrame: {
          ...textFrame,
          paragraphs: textFrame.paragraphs.map((paragraph) => ({
            ...paragraph,
            align
          }))
        }
      });
    });
  };

  if (resolvedSection.headersEnabled) {
    appendStorageSlots(resolvedSection.headerFooterRefs.headers, 'header', topY);
  }
  if (resolvedSection.footersEnabled) {
    appendStorageSlots(resolvedSection.headerFooterRefs.footers, 'footer', bottomY);
  }

  return items;
}

function resolvePagesTemplateStorageRefs(
  archive: IworkArchiveIndex,
  pageTemplateRecord: PagesResolvedSection['pageTemplateRecord']
): unknown[] {
  if (!pageTemplateRecord || (pageTemplateRecord.typeName !== 'TP.DocumentArchive' && pageTemplateRecord.typeName !== 'TP.PageTemplateArchive')) {
    return [];
  }
  return (archive.references.outgoing[String(pageTemplateRecord.id)] ?? [])
    .map((id) => archive.records[String(id)])
    .filter((record) => record?.typeName === 'TSWP.StorageArchive')
    .map((record) => ({ identifier: record!.id }));
}

function resolveDrawableGeometry(drawable: Record<string, unknown>): unknown {
  return readFieldInDrawableChain(drawable, ['geometry']);
}

function resolveDrawableStyleRef(drawable: Record<string, unknown>): unknown {
  return readFieldInDrawableChain(drawable, ['style']);
}

function resolveDrawablePathSource(drawable: Record<string, unknown>): unknown {
  return readFieldInDrawableChain(drawable, ['pathsource']);
}

function resolveDrawableStorageRef(drawable: Record<string, unknown>): unknown {
  return readFieldInDrawableChain(drawable, ['ownedStorage', 'owned_storage']) ??
    readFieldInDrawableChain(drawable, ['deprecatedStorage', 'deprecated_storage']) ??
    readFieldInDrawableChain(drawable, ['storage']);
}

function normalizeDrawableOpacity(value: number | undefined): number | undefined {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return undefined;
  }
  return Number(Math.max(0, Math.min(1, value)).toFixed(4));
}

function resolveDrawableMediaType(
  drawable: Record<string, unknown>,
  media: Pick<IworkImageAsset, 'role'> | undefined
): 'video' | 'audio' | 'image' | undefined {
  if (readField<boolean>(drawable, ['audioOnly', 'audio_only']) === true) {
    return 'audio';
  }
  return media?.role;
}

function resolveDrawableHyperlink(drawable: Record<string, unknown>): string | undefined {
  const value = readFieldInDrawableChain(drawable, ['hyperlinkUrl']) ??
    readFieldInDrawableChain(drawable, ['hyperlink_url']);
  return typeof value === 'string' && value.length ? value : undefined;
}

function resolveDrawableDataId(drawable: Record<string, unknown>, drawableRecord?: IworkArchiveRecord): string {
  const dataRef = readFirstFieldInDrawableChain(drawable, [
    ['data'],
    ['image_data'],
    ['imageData'],
    ['adjusted_image_data'],
    ['adjustedImageData'],
    ['enhanced_image_data'],
    ['enhancedImageData'],
    ['database_data'],
    ['databaseData'],
    ['original_data'],
    ['originalData'],
    ['database_original_data'],
    ['databaseOriginalData'],
    ['media_data'],
    ['mediaData'],
    ['movie_data'],
    ['movieData'],
    ['database_movie_data'],
    ['databaseMovieData'],
    ['asset_data'],
    ['assetData'],
    ['image', 'data'],
    ['image', 'image_data'],
    ['image', 'imageData'],
    ['image', 'adjusted_image_data'],
    ['image', 'adjustedImageData'],
    ['image', 'enhanced_image_data'],
    ['image', 'enhancedImageData'],
    ['image', 'database_data'],
    ['image', 'databaseData'],
    ['image', 'original_data'],
    ['image', 'originalData'],
    ['image', 'database_original_data'],
    ['image', 'databaseOriginalData'],
    ['media', 'data'],
    ['media', 'media_data'],
    ['media', 'movie_data'],
    ['media', 'database_movie_data'],
    ['movie', 'data'],
    ['movie', 'movie_data'],
    ['movie', 'movieData'],
    ['movie', 'database_movie_data'],
    ['movie', 'databaseMovieData']
  ]);
  const explicitId = dataRef ? String(readField<number>(dataRef as Record<string, unknown>, ['identifier']) ?? '') : '';
  if (explicitId) {
    return explicitId;
  }

  const fallbackId = drawableRecord?.dataReferences.find((candidate: number) => Number.isFinite(candidate) && candidate > 0);
  return fallbackId != null ? String(fallbackId) : '';
}

function resolveDrawableThumbnailDataId(
  drawable: Record<string, unknown>,
  drawableRecord?: IworkArchiveRecord,
  primaryDataId?: string
): string | undefined {
  const thumbnailRef = readFirstFieldInDrawableChain(drawable, [
    ['thumbnail_data'],
    ['thumbnailData'],
    ['database_thumbnail_data'],
    ['databaseThumbnailData'],
    ['thumbnail_adjusted_image_data'],
    ['thumbnailAdjustedImageData'],
    ['poster_data'],
    ['posterData'],
    ['poster_image_data'],
    ['posterImageData'],
    ['database_poster_image_data'],
    ['databasePosterImageData'],
    ['audio_only_image_data'],
    ['audioOnlyImageData'],
    ['database_audio_only_image_data'],
    ['databaseAudioOnlyImageData'],
    ['poster_frame_data'],
    ['posterFrameData'],
    ['preview_data'],
    ['previewData'],
    ['image', 'thumbnail_data'],
    ['image', 'thumbnailData'],
    ['image', 'database_thumbnail_data'],
    ['image', 'databaseThumbnailData'],
    ['image', 'thumbnail_adjusted_image_data'],
    ['image', 'thumbnailAdjustedImageData'],
    ['image', 'poster_image_data'],
    ['image', 'posterImageData'],
    ['media', 'thumbnail_data'],
    ['media', 'thumbnailData'],
    ['media', 'poster_image_data'],
    ['media', 'posterImageData'],
    ['movie', 'thumbnail_data'],
    ['movie', 'thumbnailData'],
    ['movie', 'poster_image_data'],
    ['movie', 'posterImageData'],
    ['movie', 'database_poster_image_data'],
    ['movie', 'databasePosterImageData'],
    ['movie', 'audio_only_image_data'],
    ['movie', 'audioOnlyImageData'],
    ['movie', 'database_audio_only_image_data'],
    ['movie', 'databaseAudioOnlyImageData'],
    ['movie', 'poster_frame_data'],
    ['movie', 'posterFrameData']
  ]);
  const identifier = thumbnailRef ? readField<number>(thumbnailRef as Record<string, unknown>, ['identifier']) : undefined;
  if (identifier != null) {
    return String(identifier);
  }

  if (!drawableRecord) {
    return undefined;
  }

  const fallbackPosterId = drawableRecord.dataReferences
    .filter((candidate: number) => Number.isFinite(candidate) && candidate > 0)
    .map((candidate) => String(candidate))
    .find((candidate) => candidate !== primaryDataId);
  return fallbackPosterId || undefined;
}

function readFirstFieldInDrawableChain(drawable: Record<string, unknown>, keyPaths: string[][]): unknown {
  for (const keys of keyPaths) {
    const value = readFieldInDrawableChain(drawable, keys);
    if (value !== undefined) {
      return value;
    }
  }
  return undefined;
}

function readFieldInDrawableChain(drawable: Record<string, unknown>, keys: string[]): unknown {
  let current: Record<string, unknown> | undefined = drawable;
  const seen = new Set<Record<string, unknown>>();
  while (current && !seen.has(current)) {
    const value = readField(current, keys);
    if (value !== undefined) {
      return value;
    }
    seen.add(current);
    current = asObject(readField(current, ['super']));
  }
  return undefined;
}

function readFieldInStyleChain<T = unknown>(
  style: Record<string, unknown> | undefined,
  containerKeys: string[],
  valueKeys: string[]
): T | undefined {
  let current = style;
  const seen = new Set<Record<string, unknown>>();
  while (current && !seen.has(current)) {
    const container = containerKeys.length ? asObject(readField(current, containerKeys)) : current;
    const value = readField<T>(container, valueKeys);
    if (value !== undefined) {
      return value;
    }
    seen.add(current);
    current = asObject(readField(current, ['super']));
  }
  return undefined;
}

function asFiniteNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function isLineShape(pathSource: unknown): boolean {
  const path = asObject(pathSource);
  if (!path) {
    return false;
  }
  if (readField(path, ['connectionLinePathSource', 'connection_line_path_source'])) {
    return true;
  }

  const bezier = asObject(readField(path, ['bezierPathSource', 'bezier_path_source'])) ?? path;
  const pathValue = asObject(readField(bezier, ['path'])) ?? (asArray(readField(bezier, ['elements'])).length ? bezier : undefined);
  const elements = asArray<AnyObject>(readField(pathValue, ['elements']));
  if (elements.length) {
    const hasClose = elements.some((element) => Number(readField<number>(element, ['type']) ?? 0) === 5);
    const drawableTypes = elements.filter((element) => Number(readField<number>(element, ['type']) ?? 0) !== 5);
    return !hasClose && drawableTypes.length === 2 &&
      Number(readField<number>(drawableTypes[0], ['type']) ?? 0) === 1 &&
      Number(readField<number>(drawableTypes[1], ['type']) ?? 0) === 2;
  }

  const editable = asObject(readField(path, ['editableBezierPathSource', 'editable_bezier_path_source']));
  const subpaths = asArray<AnyObject>(readField(editable, ['subpaths']));
  if (subpaths.length !== 1) {
    return false;
  }
  const subpath = subpaths[0];
  const nodes = asArray(readField(subpath, ['nodes']));
  return readField<boolean>(subpath, ['closed']) !== true && nodes.length === 2;
}

function resolveShapeType(pathSource: unknown): ShapeType {
  if (isLineShape(pathSource)) {
    return 'line';
  }

  const path = asObject(pathSource);
  const pointSource = asObject(readField(path, ['pointPathSource', 'point_path_source']));
  if (pointSource) {
    switch (Number(readField<number>(pointSource, ['type']) ?? 0)) {
      case 0:
        return 'leftArrow';
      case 1:
        return 'rightArrow';
      case 10:
        return 'leftRightArrow';
      case 100:
        return 'star5';
      case 200:
        return 'plus';
      default:
        break;
    }
  }

  const scalarSource = asObject(readField(path, ['scalarPathSource', 'scalar_path_source']));
  if (scalarSource) {
    switch (Number(readField<number>(scalarSource, ['type']) ?? 0)) {
      case 0:
        return 'roundRect';
      case 2:
        return 'chevron';
      case 1:
        return 'hexagon';
      default:
        break;
    }
  }

  return 'unknown';
}

function findCanvasTitle(items: SlideItem[]): string | undefined {
  for (const item of items) {
    if ('textFrame' in item && item.textFrame) {
      const text = item.textFrame.paragraphs.flatMap((paragraph) => paragraph.runs).map((run) => run.text).join('').trim();
      if (text) {
        return text;
      }
    }
  }
  return undefined;
}

function normalizeStorageText(value: unknown): string {
  return asArray<string>(value).join('').replace(/\r\n/g, '\n').replace(/\r/g, '\n');
}

function hasVisibleTextFrame(frame: TextFrame): boolean {
  return frame.paragraphs.some((paragraph) =>
    paragraph.runs.some((run) => stripObjectMarker(run.text).trim().length > 0)
  );
}

function shouldIncludeKeynotePlaceholderItem(item: SlideItem): boolean {
  if (!('textFrame' in item) || !item.textFrame) {
    return false;
  }
  return hasVisibleTextFrame(item.textFrame);
}

function collectKeynotePlaceholderKinds(
  archive: IworkArchiveIndex,
  slide: Record<string, unknown>,
  includeSlideNumber: boolean | undefined
): Set<number> {
  const refs = collectKeynotePlaceholderRefs(slide, includeSlideNumber);
  const kinds = new Set<number>();
  for (const ref of refs) {
    const placeholder = getRecordValue<Record<string, unknown>>(archive, ref);
    const kind = Number(readField<number>(placeholder, ['kind']) ?? -1);
    if (kind >= 0) {
      kinds.add(kind);
    }
  }
  return kinds;
}

function collectHiddenKeynotePlaceholderKinds(
  archive: IworkArchiveIndex,
  slide: Record<string, unknown>,
  includeSlideNumber: boolean | undefined
): Set<number> {
  const style = resolveMergedStyle(archive, readField(slide, ['style']));
  const slideProperties = asObject(readField(style, ['slideProperties', 'slide_properties']));
  const kinds = new Set<number>();

  if (readField<boolean>(slideProperties, ['titlePlaceholderVisibility', 'title_placeholder_visibility']) === false) {
    kinds.add(2);
  }
  if (readField<boolean>(slideProperties, ['bodyPlaceholderVisibility', 'body_placeholder_visibility']) === false) {
    kinds.add(3);
  }
  if (readField<boolean>(slideProperties, ['objectPlaceholderVisibility', 'object_placeholder_visibility']) === false) {
    kinds.add(4);
  }
  if (
    includeSlideNumber &&
    readField<boolean>(slideProperties, ['slideNumberPlaceholderVisibility', 'slide_number_placeholder_visibility']) === false
  ) {
    kinds.add(1);
  }

  return kinds;
}

function collectKeynotePlaceholderRefs(slide: Record<string, unknown>, includeSlideNumber: boolean | undefined): unknown[] {
  const refs: unknown[] = [
    readField(slide, ['titlePlaceholder', 'title_placeholder']),
    readField(slide, ['bodyPlaceholder', 'body_placeholder']),
    readField(slide, ['objectPlaceholder', 'object_placeholder']),
    ...asArray<unknown>(readField(slide, ['placeholderDrawables', 'placeholder_drawables'])),
    ...asArray<unknown>(readField(slide, ['placeholderDrawableInfos', 'placeholder_drawable_infos'])),
    ...asArray<unknown>(readField(slide, ['placeholders']))
  ];
  if (includeSlideNumber) {
    refs.push(readField(slide, ['slideNumberPlaceholder', 'slide_number_placeholder']));
  }
  return refs.filter((ref) => ref != null);
}

function collectKeynoteObjectPlaceholderInfoRefs(slide: Record<string, unknown>): unknown[] {
  const directRefs = [
    readField(slide, ['infoUsingObjectPlaceholderGeometry', 'info_using_object_placeholder_geometry']),
    ...asArray<unknown>(readField(slide, ['infosUsingObjectPlaceholderGeometry', 'infos_using_object_placeholder_geometry']))
  ].filter((ref) => ref != null);
  if (directRefs.length) {
    return directRefs;
  }

  if (!readField(slide, ['objectPlaceholder', 'object_placeholder'])) {
    return [];
  }

  return asArray<Record<string, unknown>>(readField(slide, ['sageTagToInfoMap', 'sage_tag_to_info_map']))
    .map((entry) => readField(entry, ['info']))
    .filter((ref) => ref != null);
}

function buildSyntheticKeynotePlaceholderItems(
  archive: IworkArchiveIndex,
  slide: Record<string, unknown>,
  orderOffset: number,
  options: KeynoteBuildOptions
): SlideItem[] {
  const syntheticItems: SlideItem[] = [];
  const pushSyntheticPlaceholder = (item: SlideItem | undefined) => {
    if (item) {
      syntheticItems.push({
        ...item,
        order: orderOffset + syntheticItems.length
      });
    }
  };

  if (!readField(slide, ['titlePlaceholder', 'title_placeholder']) && readField(slide, ['titlePlaceholderGeometry', 'title_placeholder_geometry'])) {
    pushSyntheticPlaceholder(
      buildSyntheticKeynotePlaceholderItem(slide, 2, ['titlePlaceholderGeometry', 'title_placeholder_geometry'], ['titleLayoutProperties', 'title_layout_properties'], orderOffset + syntheticItems.length)
    );
  }
  if (!readField(slide, ['bodyPlaceholder', 'body_placeholder']) && readField(slide, ['bodyPlaceholderGeometry', 'body_placeholder_geometry'])) {
    pushSyntheticPlaceholder(
      buildSyntheticKeynotePlaceholderItem(slide, 3, ['bodyPlaceholderGeometry', 'body_placeholder_geometry'], ['bodyLayoutProperties', 'body_layout_properties'], orderOffset + syntheticItems.length)
    );
  }
  if (
    options.slideNumberVisible &&
    !readField(slide, ['slideNumberPlaceholder', 'slide_number_placeholder']) &&
    readField(slide, ['slideNumberPlaceholderGeometry', 'slide_number_placeholder_geometry'])
  ) {
    pushSyntheticPlaceholder(
      buildSyntheticKeynotePlaceholderItem(
        slide,
        1,
        ['slideNumberPlaceholderGeometry', 'slide_number_placeholder_geometry'],
        ['slideNumberLayoutProperties', 'slide_number_layout_properties'],
        orderOffset + syntheticItems.length,
        options.pageNumber != null ? String(options.pageNumber) : undefined
      )
    );
  }

  const hiddenKinds = collectHiddenKeynotePlaceholderKinds(archive, slide, options.slideNumberVisible);
  return syntheticItems.filter((item) => {
    const placeholderKind = item.placeholder?.type === 'body'
      ? 3
      : item.placeholder?.type === 'title'
        ? 2
        : item.placeholder?.type === 'slideNumber'
          ? 1
          : undefined;
    return placeholderKind == null || !hiddenKinds.has(placeholderKind);
  });
}

function buildSyntheticKeynotePlaceholderItem(
  slide: Record<string, unknown>,
  kind: 1 | 2 | 3,
  geometryKeys: string[],
  layoutKeys: string[],
  order: number,
  overrideText?: string
): SlideItem | undefined {
  const geometry = readField(slide, geometryKeys);
  if (!geometry) {
    return undefined;
  }
  const transform = transformFromGeometry(geometry);
  const layoutProperties = asObject(readField(slide, layoutKeys));
  const padding = paddingFromValue(readField(layoutProperties, ['padding']), 4);
  const verticalAlign = verticalAlignFromValue(readField(layoutProperties, ['verticalAlignment', 'vertical_alignment']));
  const text = overrideText ??
    (kind === 2
      ? readField<string>(slide, ['thumbnailTextForTitlePlaceholder', 'thumbnail_text_for_title_placeholder'])
      : kind === 3
        ? readField<string>(slide, ['thumbnailTextForBodyPlaceholder', 'thumbnail_text_for_body_placeholder'])
        : undefined);
  if (!text || !text.trim()) {
    return undefined;
  }

  const textFrame: TextFrame = {
    paragraphs: [
      {
        runs: [{ text }]
      }
    ],
    verticalAlign,
    padding,
    wrap: 'square'
  };
  const normalizedTransform = ensureDrawableTextTransform(transform, textFrame);
  const placeholderType = kind === 2 ? 'title' : kind === 3 ? 'body' : 'slideNumber';

  return {
    id: `synthetic-placeholder-${placeholderType}-${order}`,
    kind: 'text',
    name: 'Text',
    order,
    groupPath: [],
    transform: normalizedTransform,
    fill: {
      type: 'none'
    },
    line: undefined,
    shadow: undefined,
    textFrame,
    placeholder: {
      type: placeholderType,
      idx: '0'
    }
  };
}

function buildKeynotePlaceholderFallbackTextFrame(
  drawable: Record<string, unknown>,
  slide: Record<string, unknown> | undefined,
  padding: TextFrame['padding'],
  verticalAlign: TextFrame['verticalAlign']
): TextFrame | undefined {
  const placeholderKind = Number(readField<number>(drawable, ['kind']) ?? -1);
  const fallbackText =
    placeholderKind === 2
      ? readField<string>(slide, ['thumbnailTextForTitlePlaceholder', 'thumbnail_text_for_title_placeholder'])
      : placeholderKind === 3
        ? readField<string>(slide, ['thumbnailTextForBodyPlaceholder', 'thumbnail_text_for_body_placeholder'])
        : undefined;
  if (!fallbackText || !fallbackText.trim()) {
    return undefined;
  }

  return {
    paragraphs: [
      {
        runs: [{ text: fallbackText }]
      }
    ],
    verticalAlign,
    padding,
    wrap: 'square'
  };
}

function buildKeynoteInstructionalTextFrame(
  archive: IworkArchiveIndex,
  drawable: Record<string, unknown>,
  slide: Record<string, unknown> | undefined,
  padding: TextFrame['padding'],
  verticalAlign: TextFrame['verticalAlign']
): TextFrame | undefined {
  const instructionalText = resolveKeynoteInstructionalText(archive, drawable, slide);
  if (!instructionalText || !instructionalText.trim()) {
    return undefined;
  }

  return {
    paragraphs: [
      {
        runs: [{ text: instructionalText }]
      }
    ],
    verticalAlign,
    padding,
    wrap: 'square'
  };
}

function resolveKeynoteInstructionalText(
  archive: IworkArchiveIndex,
  drawable: Record<string, unknown>,
  slide: Record<string, unknown> | undefined
): string | undefined {
  if (!slide) {
    return undefined;
  }

  const drawableId = findRecordIdByValue(archive, drawable);
  if (drawableId == null) {
    return undefined;
  }

  const instructionalTextMap = asObject(readField(slide, ['instructionalTextMap', 'instructional_text_map']));
  const entries = asArray<Record<string, unknown>>(readField(instructionalTextMap, ['instructionalTextForInfos', 'instructional_text_for_infos']));
  for (const entry of entries) {
    const infoId = getRefId(readField(entry, ['info']));
    if (infoId === drawableId) {
      return readField<string>(entry, ['instructionalText', 'instructional_text']);
    }
  }

  return undefined;
}

function ensureDrawableTextTransform(transform: SlideItem['transform'], textFrame: TextFrame | undefined): SlideItem['transform'] {
  if (!textFrame || (transform.width > 0 && transform.height > 0)) {
    return transform;
  }

  const fontSizes = textFrame.paragraphs.flatMap((paragraph) =>
    paragraph.runs.map((run) => run.fontSize).filter((size): size is number => typeof size === 'number' && size > 0)
  );
  const fontSize = fontSizes.length ? Math.max(...fontSizes) : 18;
  const lines = Math.max(textFrame.paragraphs.length, 1);
  const longestLineLength = Math.max(
    ...textFrame.paragraphs.map((paragraph) => paragraph.runs.map((run) => run.text).join('').length),
    1
  );
  const estimatedWidth = Math.max(
    24,
    longestLineLength * fontSize * 0.6 + textFrame.padding.left + textFrame.padding.right
  );
  const estimatedHeight = Math.max(
    fontSize * 1.2 * lines + textFrame.padding.top + textFrame.padding.bottom,
    fontSize * 1.5
  );

  return {
    ...transform,
    width: transform.width > 0 ? transform.width : Number(estimatedWidth.toFixed(2)),
    height: transform.height > 0 ? transform.height : Number(estimatedHeight.toFixed(2))
  };
}

function textFrameHasVisibleText(textFrame: TextFrame | undefined): boolean {
  return Boolean(textFrame?.paragraphs.some((paragraph) =>
    paragraph.runs.some((run) => run.text.trim().length > 0)
  ));
}

function buildKeynoteLineLayout(
  transform: SlideItem['transform'],
  strokeWidth: number | undefined
): {
  transform: SlideItem['transform'];
  geometry: Extract<SlideItem, { kind: 'shape' }>['geometry'];
} | undefined {
  const lineLength = Math.abs(transform.width) > 0
    ? Math.abs(transform.width)
    : Math.abs(transform.height);
  if (!Number.isFinite(lineLength) || lineLength <= 0) {
    return undefined;
  }

  const angle = Math.abs(transform.rotation) > 10
    ? (transform.rotation * Math.PI) / 180
    : transform.rotation;
  const halfLength = lineLength / 2;
  const centerX = transform.x + halfLength;
  const centerY = transform.y;
  const dx = Math.cos(angle) * halfLength;
  const dy = Math.sin(angle) * halfLength;
  const x1 = centerX - dx;
  const y1 = centerY + dy;
  const x2 = centerX + dx;
  const y2 = centerY - dy;
  let minX = Math.min(x1, x2);
  let maxX = Math.max(x1, x2);
  let minY = Math.min(y1, y2);
  let maxY = Math.max(y1, y2);
  const minExtent = Math.max(strokeWidth ?? 0, 1);

  if (maxX - minX < minExtent) {
    const padding = (minExtent - (maxX - minX)) / 2;
    minX -= padding;
    maxX += padding;
  }
  if (maxY - minY < minExtent) {
    const padding = (minExtent - (maxY - minY)) / 2;
    minY -= padding;
    maxY += padding;
  }

  return {
    transform: {
      x: minX,
      y: minY,
      width: maxX - minX,
      height: maxY - minY,
      rotation: 0,
      flipH: false,
      flipV: false
    },
    geometry: {
      type: 'line',
      x1: x1 - minX,
      y1: y1 - minY,
      x2: x2 - minX,
      y2: y2 - minY
    }
  };
}

function buildParagraphRanges(text: string): PagesParagraphRange[] {
  if (!text.length) {
    return [{ start: 0, end: 0, text: '' }];
  }

  const starts = [0];
  for (let index = 0; index < text.length; index += 1) {
    if (text[index] === '\n' && index + 1 < text.length) {
      starts.push(index + 1);
    }
  }

  return starts.map((start, index) => {
    const end = starts[index + 1] ?? text.length;
    const rawText = text.slice(start, end);
    const paragraphText = rawText.endsWith('\n') ? rawText.slice(0, -1) : rawText;
    const markers = Array.from(paragraphText.matchAll(/[\u0004\u0005\u000c\uFFFC]/g), ({ index }, count) =>
      ({ offset: index, delta: -count - 1 }));
    return {
      start,
      end,
      text: paragraphText,
      ...(markers.length ? { markers } : {})
    };
  });
}

function setPagesRenderedOffsets(ranges: PagesParagraphRange[], attachmentText: ReadonlyMap<number, string[]>): void {
  for (const range of ranges) {
    // Store the cumulative change so page breaks can be looked up in source coordinates.
    let delta = 0;
    for (const marker of range.markers ?? []) {
      const replacement = range.text[marker.offset] === '\uFFFC' ? attachmentText.get(range.start + marker.offset) : undefined;
      delta += (replacement ? stripObjectMarker(replacement.join('')).length : 0) - 1;
      marker.delta = delta;
    }
  }
}

function resolvePagesRenderedOffset(range: PagesParagraphRange, characterIndex = range.end): number {
  const localIndex = Math.max(0, Math.min(characterIndex - range.start, range.text.length));
  const markers = range.markers;
  if (!markers) return localIndex;
  let low = 0, high = markers.length;
  while (low < high) {
    const middle = Math.floor((low + high) / 2);
    if (markers[middle].offset < localIndex) low = middle + 1;
    else high = middle;
  }
  return localIndex + (markers[low - 1]?.delta ?? 0);
}

function findParagraphIndexForCharacter(paragraphRanges: PagesParagraphRange[], characterIndex: number): number {
  let low = 0;
  let high = paragraphRanges.length;
  while (low < high) {
    const middle = Math.floor((low + high) / 2);
    if (characterIndex < paragraphRanges[middle].end) high = middle;
    else low = middle + 1;
  }
  return Math.max(0, Math.min(low, paragraphRanges.length - 1));
}

function findParagraphEndIndexForCharacter(
  paragraphRanges: PagesParagraphRange[],
  characterIndex: number
): number {
  if (characterIndex <= 0) {
    return 0;
  }
  let low = 0;
  let high = paragraphRanges.length;
  while (low < high) {
    const middle = Math.floor((low + high) / 2);
    const paragraph = paragraphRanges[middle];
    if (characterIndex <= paragraph.start || characterIndex < paragraph.end) high = middle;
    else low = middle + 1;
  }
  if (low === paragraphRanges.length) return low;
  return characterIndex <= paragraphRanges[low].start ? low : low + 1;
}

function stripObjectMarker(text: string): string {
  return text.replace(/[\u0004\u0005\u000c\uFFFC]/g, '');
}

function buildParagraphBlock(
  id: string,
  paragraphs: TextParagraph[],
  start: number,
  end: number,
  sourceRecordId?: number
): Omit<PagesBodyFlowBlock, 'fragmentIndex'> | undefined {
  const slice = paragraphs.slice(start, end);
  if (!slice.length) {
    return undefined;
  }
  return {
    id,
    kind: 'paragraphs',
    firstParagraph: start,
    paragraphs: slice,
    sourceRecordId
  };
}

function buildParagraphSliceBlock(
  id: string,
  paragraph: TextParagraph | undefined,
  paragraphIndex: number,
  startVisibleOffset: number,
  endVisibleOffset: number,
  sourceRecordId?: number
): Omit<PagesBodyFlowBlock, 'fragmentIndex'> | undefined {
  const slicedParagraph = sliceTextParagraph(paragraph, startVisibleOffset, endVisibleOffset);
  if (!slicedParagraph) {
    return undefined;
  }
  const hasVisibleText = slicedParagraph.runs.some((run) => stripObjectMarker(run.text).trim().length > 0);
  if (!hasVisibleText) {
    return undefined;
  }
  return {
    id,
    kind: 'paragraphs',
    firstParagraph: paragraphIndex,
    startVisibleOffset,
    paragraphs: [slicedParagraph],
    sourceRecordId
  };
}

function sliceTextParagraph(
  paragraph: TextParagraph | undefined,
  startVisibleOffset: number,
  endVisibleOffset: number,
  totalVisibleLength?: number
): TextParagraph | undefined {
  if (!paragraph) {
    return undefined;
  }

  const clampedStart = Math.max(0, startVisibleOffset);
  const clampedEnd = Math.max(clampedStart, endVisibleOffset);
  let cursor = 0;
  const runs: TextParagraph['runs'] = [];

  for (const run of paragraph.runs) {
    if (totalVisibleLength != null && cursor >= clampedEnd) break;
    const runLength = run.text.length;
    const runStart = cursor;
    const runEnd = cursor + runLength;
    const sliceStart = Math.max(clampedStart, runStart);
    const sliceEnd = Math.min(clampedEnd, runEnd);
    if (sliceStart < sliceEnd) {
      runs.push({
        ...run,
        text: run.text.slice(sliceStart - runStart, sliceEnd - runStart)
      });
    }
    cursor = runEnd;
  }

  if (!runs.length) {
    return undefined;
  }

  const isLeadingSlice = clampedStart <= 0;
  const isTrailingSlice = clampedEnd >= (totalVisibleLength ?? cursor);

  return {
    ...paragraph,
    bullet: isLeadingSlice ? paragraph.bullet : undefined,
    bulletDisabled: isLeadingSlice ? paragraph.bulletDisabled : true,
    spaceBefore: isLeadingSlice ? paragraph.spaceBefore : 0,
    spaceAfter: isTrailingSlice ? paragraph.spaceAfter : 0,
    runs
  };
}

function findFirstParagraphText(paragraphs: TextParagraph[]): string | undefined {
  for (const paragraph of paragraphs) {
    const text = paragraph.runs.map((run) => stripObjectMarker(run.text)).join('').trim();
    if (text) {
      return text;
    }
  }
  return undefined;
}

function positionPagesAttachmentItem(params: {
  archive: IworkArchiveIndex;
  item: SlideItem;
  attachmentObject: Record<string, unknown> | undefined;
  attachmentHint?: PagesAttachmentPositionHint;
  anchorFragment?: PaginatedPagesBodyFragment;
  startsPage: boolean;
  paragraphRanges: PagesParagraphRange[];
  characterIndex: number;
  anchorParagraphIndex: number;
  paragraphCount: number;
  pageParagraphStart: number;
  pageParagraphEnd: number;
  paragraphMetrics?: PagesParagraphMetrics;
  layout: PagesLayoutModel;
}): void {
  const {
    archive,
    item,
    attachmentObject,
    attachmentHint,
    anchorFragment,
    startsPage,
    paragraphRanges,
    characterIndex,
    anchorParagraphIndex,
    paragraphCount,
    pageParagraphStart,
    pageParagraphEnd,
    paragraphMetrics,
    layout
  } = params;
  if (hasAbsolutePagesAttachmentPosition(attachmentHint)) {
    item.transform.x = attachmentHint.x;
    item.transform.y = attachmentHint.y;
    return;
  }

  const hOffsetType = Number(readField<number>(attachmentObject, ['hOffsetType', 'h_offset_type']) ?? 0);
  const vOffsetType = Number(readField<number>(attachmentObject, ['vOffsetType', 'v_offset_type']) ?? 0);
  const hOffset = Number(readField<number>(attachmentObject, ['hOffset', 'h_offset']) ?? 0);
  const vOffset = startsPage ? 0 : Number(readField<number>(attachmentObject, ['vOffset', 'v_offset']) ?? 0);
  if (!isSupportedPagesAttachmentHorizontalOffsetType(hOffsetType)) {
    pushUniqueArchiveWarning(
      archive,
      `Pages attachment horizontal offset type ${hOffsetType} is not fully supported; using margin-relative fallback.`
    );
  }
  if (!isSupportedPagesAttachmentVerticalOffsetType(vOffsetType)) {
    pushUniqueArchiveWarning(
      archive,
      `Pages attachment vertical offset type ${vOffsetType} is not fully supported; using margin-relative fallback.`
    );
  }
  const fragmentRect = anchorFragment?.rect;
  const fragmentStart = anchorFragment?.startParagraph ?? pageParagraphStart;
  const fragmentEnd = anchorFragment?.endParagraph ?? pageParagraphEnd;
  const fragmentRelativeRatio = startsPage ? 0 : resolvePagesAttachmentRelativeRatio({
    anchorParagraphIndex,
    paragraphCount,
    pageParagraphStart: fragmentStart,
    pageParagraphEnd: fragmentEnd,
    paragraphMetrics,
    paragraphRanges,
    characterIndex
  });
  item.transform.x = layout.leftMargin + (fragmentRect?.x ?? 0) + hOffset;
  if (item.kind === 'table') {
    item.transform.width = fitPagesInlineTableWidth(item.transform.width, fragmentRect?.width ?? layout.bodyWidth, hOffset);
  }
  item.transform.y =
    layout.topMargin +
    (fragmentRect?.y ?? 0) +
    vOffset +
    fragmentRelativeRatio * Math.max(
      (fragmentRect?.height ?? layout.bodyHeight) - item.transform.height,
      1
    );
}

function fitPagesInlineTableWidth(width: number, availableWidth: number, offset: number): number {
  return Math.min(width, Math.max(1, availableWidth - Math.max(0, offset)));
}

function isSupportedPagesAttachmentHorizontalOffsetType(offsetType: number): boolean {
  return offsetType === 0 || offsetType === 3;
}

function isSupportedPagesAttachmentVerticalOffsetType(offsetType: number): boolean {
  return offsetType === 0 || offsetType === 4;
}

function resolvePagesAttachmentFragmentIndex(
  page: PaginatedPagesBodyPage | undefined,
  characterIndex: number,
  anchorParagraphIndex: number
): number {
  if (!page?.fragments.length) {
    return 0;
  }

  for (let index = 0; index < page.fragments.length; index += 1) {
    if (fragmentContainsCharacter(page.fragments[index], characterIndex, anchorParagraphIndex)) {
      return index;
    }
  }

  return Math.max(page.fragments.length - 1, 0);
}

function fragmentContainsCharacter(
  fragment: PaginatedPagesBodyFragment,
  characterIndex: number,
  anchorParagraphIndex: number
): boolean {
  if (anchorParagraphIndex < fragment.startParagraph || anchorParagraphIndex >= fragment.endParagraph) {
    return false;
  }
  return (fragment.rangeStart == null || characterIndex >= fragment.rangeStart) &&
    (fragment.rangeEnd == null || characterIndex < fragment.rangeEnd);
}

function resolvePagesAttachmentPlacement(
  paragraphRanges: PagesParagraphRange[],
  characterIndex: number,
  anchorParagraphIndex: number
): PagesInlineAttachment['placement'] {
  const anchorRange = paragraphRanges[anchorParagraphIndex];
  if (!anchorRange) {
    return 'standalone';
  }

  const localIndex = characterIndex - anchorRange.start;
  if (localIndex < 0 || localIndex >= anchorRange.text.length) {
    return stripObjectMarker(anchorRange.text).trim().length ? 'suffix' : 'standalone';
  }

  const beforeText = stripObjectMarker(anchorRange.text.slice(0, localIndex));
  const afterText = stripObjectMarker(anchorRange.text.slice(localIndex + 1));
  const hasBefore = beforeText.trim().length > 0;
  const hasAfter = afterText.trim().length > 0;

  if (!hasBefore && !hasAfter) {
    return 'standalone';
  }
  if (!hasBefore) {
    return 'prefix';
  }
  if (!hasAfter) {
    return 'suffix';
  }
  return 'middle';
}

function resolvePagesCharacterVisibleSplit(
  paragraphRanges: PagesParagraphRange[],
  characterIndex: number,
  anchorParagraphIndex: number
): number {
  const anchorRange = paragraphRanges[anchorParagraphIndex];
  if (!anchorRange) {
    return 0;
  }

  const localIndex = Math.max(0, Math.min(characterIndex - anchorRange.start, anchorRange.text.length));
  return stripObjectMarker(anchorRange.text.slice(0, localIndex)).length;
}

function collectParagraphVisibleText(paragraph: TextParagraph | undefined): string {
  return stripObjectMarker(paragraph?.runs.map((run) => run.text).join('') ?? '');
}

function resolvePagesAttachmentRelativeRatio(params: {
  anchorParagraphIndex: number;
  paragraphCount: number;
  pageParagraphStart: number;
  pageParagraphEnd: number;
  paragraphMetrics?: PagesParagraphMetrics;
  paragraphRanges: PagesParagraphRange[];
  characterIndex: number;
}): number {
  const {
    anchorParagraphIndex,
    paragraphCount,
    pageParagraphStart,
    pageParagraphEnd,
    paragraphMetrics,
    paragraphRanges,
    characterIndex
  } = params;

  if (paragraphMetrics) {
    const startOffset = paragraphMetrics.offsets[pageParagraphStart] ?? 0;
    const endParagraphIndex = Math.max(pageParagraphStart, pageParagraphEnd - 1);
    const endOffset =
      (paragraphMetrics.offsets[endParagraphIndex] ?? 0) +
      (paragraphMetrics.heights[endParagraphIndex] ?? 0);
    const anchorOffset = paragraphMetrics.offsets[anchorParagraphIndex] ?? startOffset;
    const anchorHeight = paragraphMetrics.heights[anchorParagraphIndex] ?? 0;
    const anchorVisibleOffset = resolvePagesCharacterVisibleSplit(paragraphRanges, characterIndex, anchorParagraphIndex);
    const anchorParagraphText = paragraphRanges[anchorParagraphIndex]?.text ?? '';
    const anchorVisibleLength = stripObjectMarker(anchorParagraphText).length;
    const anchorRelativeOffset =
      anchorVisibleLength > 0
        ? Math.min(1, Math.max(0, anchorVisibleOffset / anchorVisibleLength))
        : 0.5;
    const pageHeight = Math.max(endOffset - startOffset, 1);
    return Math.min(
      1,
      Math.max(0, (anchorOffset - startOffset + anchorHeight * anchorRelativeOffset) / pageHeight)
    );
  }

  const pageParagraphCount = Math.max(pageParagraphEnd - pageParagraphStart, 1);
  if (pageParagraphCount) {
    const anchorVisibleOffset = resolvePagesCharacterVisibleSplit(paragraphRanges, characterIndex, anchorParagraphIndex);
    const anchorParagraphText = paragraphRanges[anchorParagraphIndex]?.text ?? '';
    const anchorVisibleLength = stripObjectMarker(anchorParagraphText).length;
    const anchorRelativeOffset =
      anchorVisibleLength > 0
        ? Math.min(1, Math.max(0, anchorVisibleOffset / anchorVisibleLength))
        : 0.5;
    return Math.min(
      1,
      Math.max(0, (anchorParagraphIndex - pageParagraphStart + anchorRelativeOffset) / pageParagraphCount)
    );
  }
  if (paragraphCount) {
    const anchorVisibleOffset = resolvePagesCharacterVisibleSplit(paragraphRanges, characterIndex, anchorParagraphIndex);
    const anchorParagraphText = paragraphRanges[anchorParagraphIndex]?.text ?? '';
    const anchorVisibleLength = stripObjectMarker(anchorParagraphText).length;
    const anchorRelativeOffset =
      anchorVisibleLength > 0
        ? Math.min(1, Math.max(0, anchorVisibleOffset / anchorVisibleLength))
        : 0.5;
    return Math.min(1, Math.max(0, (anchorParagraphIndex + anchorRelativeOffset) / paragraphCount));
  }
  return Math.min(1, Math.max(0, characterIndex / 1000));
}

function findRecordIdByValue(archive: IworkArchiveIndex, value: Record<string, unknown>): number | undefined {
  return findRecordByValue(archive, value)?.id;
}

function pushUniqueArchiveWarning(archive: IworkArchiveIndex, message: string): void {
  if (!archive.warnings.includes(message)) {
    archive.warnings.push(message);
  }
}
