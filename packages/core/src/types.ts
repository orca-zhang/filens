export type PptxSource = string | ArrayBuffer | Uint8Array | Blob | File;

export type FitMode = 'contain' | 'width' | 'none';

export type ViewerEventName = 'rendered' | 'error' | 'slidechange' | 'scalechange' | 'warnings';

export interface ViewerOptions {
  width?: number;
  height?: number;
  fit?: FitMode;
  initialScale?: number;
  minScale?: number;
  maxScale?: number;
  virtual?: boolean;
  translate?: (message: string) => string;
}

export interface ViewerEventMap {
  rendered: ViewerState;
  error: Error;
  slidechange: ViewerState;
  scalechange: ViewerState;
  warnings: string[];
}

export interface ViewerState {
  loading: boolean;
  error: string | null;
  currentSlide: number;
  slideCount: number;
  scale: number;
  fit: FitMode;
  warnings: string[];
  presentation: ParsedPresentation | null;
  mediaRegistry: {
    getUrl(mediaId: string): string;
  } | null;
}

export interface ViewerInstance {
  refreshFonts?(): void;
  refreshTranslations?(): void;
  preview(source: PptxSource): Promise<void>;
  destroy(): void;
  setScale(scale: number): void;
  fit(mode?: FitMode): void;
  goToSlide(index: number): void;
  next(): void;
  prev(): void;
  getState(): ViewerState;
  on<T extends ViewerEventName>(event: T, handler: (payload: ViewerEventMap[T]) => void): () => void;
}

export interface ThemeColorMap {
  [key: string]: string;
}

export interface ThemeModel {
  name?: string;
  colors: ThemeColorMap;
  fonts: {
    major?: string;
    minor?: string;
    majorScripts?: Record<string, string>;
    minorScripts?: Record<string, string>;
  };
}

export interface MediaAsset {
  id: string;
  path: string;
  contentType: string;
  data: Uint8Array;
  /** Browser-decodable artwork derived from a source image. */
  preview?: { contentType: string; data: Uint8Array };
}

export interface PresentationSize {
  width: number;
  height: number;
}

export interface PlaceholderRef {
  type?: string;
  idx?: string;
}

export interface FillStyle {
  type: 'solid' | 'none' | 'gradient' | 'picture' | 'pattern';
  color?: string;
  alpha?: number;
  angle?: number;
  stops?: GradientStop[];
  gradientType?: 'linear' | 'path';
  gradientPath?: string;
  gradientFillToRect?: GradientRect;
  gradientTileRect?: GradientRect;
  mediaId?: string;
  crop?: CropBox;
  tile?: boolean;
  pictureFit?: 'natural' | 'stretch' | 'tile' | 'cover' | 'contain';
  pictureSize?: { width: number; height: number };
  pictureTint?: { color: string; alpha: number };
  pattern?: string;
  foregroundColor?: string;
  foregroundAlpha?: number;
  backgroundColor?: string;
  backgroundAlpha?: number;
}

export interface GradientStop {
  position: number;
  color: string;
  alpha?: number;
}

export interface GradientRect {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

export interface LineStyle {
  color?: string;
  alpha?: number;
  width?: number;
  dash?: string;
  dashPattern?: number[];
  dashOffset?: number;
  compound?: LineCompoundType;
  lineCap?: LineCapType;
  lineJoin?: LineJoinType;
  miterLimit?: number;
  headEnd?: LineEndType;
  tailEnd?: LineEndType;
}

export type LineCapType = 'butt' | 'round' | 'square';
export type LineCompoundType = 'single' | 'double' | 'thickThin' | 'thinThick' | 'triple';
export type LineJoinType = 'round' | 'bevel' | 'miter';
export type LineEndType = 'none' | 'triangle' | 'stealth' | 'diamond' | 'oval' | 'arrow';

export interface ShadowStyle {
  color: string;
  alpha?: number;
  blur: number;
  distance: number;
  angle: number;
  offsetX: number;
  offsetY: number;
}

export interface PaddingBox {
  top: number;
  right: number;
  bottom: number;
  left: number;
}

export interface InsetBox {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

export interface CropBox {
  top: number;
  right: number;
  bottom: number;
  left: number;
}

export interface ItemTransform {
  x: number;
  y: number;
  width: number;
  height: number;
  rotation: number;
  flipH: boolean;
  flipV: boolean;
}

export interface TextRun {
  text: string;
  bold?: boolean;
  italic?: boolean;
  underline?: boolean;
  strike?: boolean;
  color?: string;
  colorAlpha?: number;
  highlightColor?: string;
  highlightAlpha?: number;
  fontSize?: number;
  fontFamily?: string;
  baselineShift?: number;
  href?: string;
  slideIndex?: number;
  navigationAction?: 'next' | 'previous' | 'first' | 'last' | 'lastViewed';
}

export interface BorderBox {
  top?: LineStyle;
  right?: LineStyle;
  bottom?: LineStyle;
  left?: LineStyle;
}

export interface TextParagraph {
  align?: 'left' | 'center' | 'right' | 'justify';
  level?: number;
  bullet?: {
    char?: string;
    autoType?: string;
    startAt?: number;
    fontFamily?: string;
    color?: string;
    colorAlpha?: number;
  };
  bulletDisabled?: boolean;
  marginLeft?: number;
  indent?: number;
  spaceBefore?: number;
  spaceAfter?: number;
  lineHeight?: number;
  lineHeightUnit?: 'multiple' | 'px';
  tabStops?: number[];
  runs: TextRun[];
}

export interface TextFrame {
  paragraphs: TextParagraph[];
  verticalAlign: 'top' | 'middle' | 'bottom';
  direction?: 'horizontal' | 'vertical' | 'vertical270';
  wrap?: 'square' | 'none';
  anchorCenter?: boolean;
  horizontalOverflow?: 'overflow' | 'clip';
  verticalOverflow?: 'overflow' | 'clip';
  columns?: number;
  columnSpacing?: number;
  rtlColumns?: boolean;
  fromWordArt?: boolean;
  padding: PaddingBox;
  autofit?: {
    type: 'none' | 'normal' | 'shape';
    fontScale?: number;
    lineSpaceReduction?: number;
  };
}

export interface BaseSlideItem {
  id: string;
  name?: string;
  kind: 'text' | 'shape' | 'image' | 'media' | 'ole' | 'table' | 'chart' | 'unsupported';
  transform: ItemTransform;
  fill: FillStyle;
  line?: LineStyle;
  shadow?: ShadowStyle;
  placeholder?: PlaceholderRef;
  order: number;
  groupPath: string[];
  sourceDrawing?: SlideObjectReference;
  sourceGroups?: SlideObjectReference[];
  href?: string;
  slideIndex?: number;
  navigationAction?: 'next' | 'previous' | 'first' | 'last' | 'lastViewed';
}

export interface TextItem extends BaseSlideItem {
  kind: 'text';
  textFrame: TextFrame;
}

export interface PresetShapeGeometry {
  type: 'preset';
  preset: string;
  adjustments: Record<string, number>;
}

export interface CustomShapeMoveCommand {
  type: 'M';
  x: number;
  y: number;
}

export interface CustomShapeLineCommand {
  type: 'L';
  x: number;
  y: number;
}

export interface CustomShapeQuadraticCommand {
  type: 'Q';
  x1: number;
  y1: number;
  x: number;
  y: number;
}

export interface CustomShapeCubicCommand {
  type: 'C';
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  x: number;
  y: number;
}

export interface CustomShapeCloseCommand {
  type: 'Z';
}

export type CustomShapeCommand =
  | CustomShapeMoveCommand
  | CustomShapeLineCommand
  | CustomShapeQuadraticCommand
  | CustomShapeCubicCommand
  | CustomShapeCloseCommand;

export interface CustomShapePath {
  width: number;
  height: number;
  fill?: 'none' | 'norm';
  stroke?: 'none' | 'norm';
  commands: CustomShapeCommand[];
}

export interface CustomShapeGeometry {
  type: 'custom';
  paths: CustomShapePath[];
}

export interface LineShapeGeometry {
  type: 'line';
  x1: number;
  y1: number;
  x2: number;
  y2: number;
}

export type ShapeGeometry = PresetShapeGeometry | CustomShapeGeometry | LineShapeGeometry;

export interface ShapeItem extends BaseSlideItem {
  kind: 'shape';
  shapeType:
    | 'rect'
    | 'roundRect'
    | 'snip1Rect'
    | 'snip2SameRect'
    | 'snip2DiagRect'
    | 'snipRoundRect'
    | 'round1Rect'
    | 'round2SameRect'
    | 'round2DiagRect'
    | 'ellipse'
    | 'diamond'
    | 'triangle'
    | 'rtTriangle'
    | 'parallelogram'
    | 'trapezoid'
    | 'octagon'
    | 'hexagon'
    | 'heptagon'
    | 'decagon'
    | 'dodecagon'
    | 'pentagon'
    | 'star5'
    | 'plaque'
    | 'can'
    | 'pie'
    | 'chord'
    | 'donut'
    | 'arc'
    | 'teardrop'
    | 'leftCircularArrow'
    | 'curvedRightArrow'
    | 'curvedLeftArrow'
    | 'curvedUpArrow'
    | 'curvedDownArrow'
    | 'smileyFace'
    | 'frame'
    | 'halfFrame'
    | 'corner'
    | 'diagStripe'
    | 'plus'
    | 'noSmoking'
    | 'bevel'
    | 'chevron'
    | 'cloud'
    | 'cube'
    | 'homePlate'
    | 'rightArrow'
    | 'stripedRightArrow'
    | 'notchedRightArrow'
    | 'leftArrow'
    | 'leftRightArrow'
    | 'upArrow'
    | 'downArrow'
    | 'upDownArrow'
    | 'quadArrow'
    | 'leftRightUpArrow'
    | 'bentArrow'
    | 'uturnArrow'
    | 'leftUpArrow'
    | 'bentUpArrow'
    | 'rightArrowCallout'
    | 'leftRightArrowCallout'
    | 'quadArrowCallout'
    | 'leftArrowCallout'
    | 'upArrowCallout'
    | 'line'
    | 'unknown';
  geometry?: ShapeGeometry;
  textBounds?: InsetBox;
  textFrame?: TextFrame;
}

export interface ImageItem extends BaseSlideItem {
  kind: 'image';
  mediaId: string;
  crop?: CropBox;
  opacity?: number;
}

export interface OleItem extends BaseSlideItem {
  kind: 'ole';
  programId?: string;
  linked: boolean;
  attachmentId?: string;
  posterMediaId?: string;
  crop?: CropBox;
  opacity?: number;
}

export interface MediaItem extends BaseSlideItem {
  kind: 'media';
  mediaType: 'video' | 'audio';
  mediaId: string;
  posterMediaId?: string;
  crop?: CropBox;
  opacity?: number;
}

export interface TableCell {
  row: number;
  column: number;
  rowSpan: number;
  colSpan: number;
  isMergedContinuation: boolean;
  fill: FillStyle;
  borders?: BorderBox;
  textFrame: TextFrame;
}

export interface TableItem extends BaseSlideItem {
  kind: 'table';
  columns: number[];
  rows: number[];
  /** Use the stored row heights as minimums and size each row to its content. */
  autoFitRows?: true;
  hiddenColumns?: number[];
  hiddenRows?: number[];
  cells: TableCell[];
}

export type ChartTextStyle = Pick<TextRun, 'fontFamily' | 'fontSize' | 'color' | 'colorAlpha' | 'bold' | 'italic'>;
export type ChartTextRun = ChartTextStyle & { text: string };
export type ChartFontFace = Pick<ChartTextStyle, 'bold' | 'italic'> & { fontFamily: string };

export interface ChartLabelStyle extends ChartTextStyle {
  scriptFonts?: Partial<Record<'latin' | 'eastAsia' | 'complex', ChartFontFace>>;
}

export interface ChartSeries {
  name: string;
  /** Authored ChartML series index, independent of drawing and legend order. */
  sourceIndex?: number;
  values: Array<number | null>;
  xValues?: Array<number | null>;
  bubbleSizes?: Array<number | null>;
  color: string;
  alpha?: number;
  fill?: FillStyle;
  line?: LineStyle | null;
  smooth?: boolean;
  marker?: {
    symbol: 'circle' | 'square' | 'diamond' | 'triangle';
    size: number;
    fill?: string;
    alpha?: number;
    line?: LineStyle | null;
  };
  pointStyles?: Array<{ color: string; alpha?: number; line?: LineStyle | null }>;
  dataLabels?: {
    showValue: boolean;
    position?: string;
    formatCode?: string;
    textStyle?: ChartLabelStyle;
  };
}

export interface ChartTitleLayout {
  rotation?: number;
  verticalText?: 'eaVert' | 'mongolianVert' | 'wordArtVert' | 'wordArtVertRtl';
  overlay?: boolean;
  position?: Partial<Record<'x' | 'y', { mode: 'edge' | 'factor'; value: number }>>;
}

export interface ChartAxisTitle extends ChartTitleLayout {
  text: string;
  lines?: ChartTextRun[][];
  textStyle?: ChartTextStyle;
}

export interface ChartValueAxis {
  min?: number;
  max?: number;
  majorUnit?: number;
  logBase?: number;
  hidden?: boolean;
  reversed?: boolean;
  crossBetween?: 'between' | 'midCat';
  crossesAt?: 'min' | 'max' | number;
  tickLabelPosition?: 'none' | 'low' | 'high' | 'nextTo';
  majorTickMark?: 'none' | 'in' | 'out' | 'cross';
  minorTickMark?: 'none' | 'in' | 'out' | 'cross';
  formatCode?: string;
  title?: ChartAxisTitle;
  textStyle?: ChartLabelStyle;
  line?: LineStyle | null;
  majorGridline?: LineStyle | null;
  showMajorGridlines?: boolean;
  minorGridline?: LineStyle | null;
  showMinorGridlines?: boolean;
}

export type ChartTimeUnit = 'days' | 'months' | 'years';

export interface ChartDateAxis extends ChartValueAxis {
  serials: Array<number | null>;
  date1904: boolean;
  baseTimeUnit?: ChartTimeUnit;
  majorTimeUnit?: ChartTimeUnit;
  minorUnit?: number;
  minorTimeUnit?: ChartTimeUnit;
}

export interface ChartPlotGroup {
  chartType: 'column' | 'line' | 'area';
  grouping: ChartItem['grouping'];
  seriesIndices: number[];
  gapWidth?: number;
  secondaryAxis?: boolean;
  reversedCategories?: boolean;
  dateAxis?: ChartDateAxis | null;
}

export interface ChartItem extends BaseSlideItem {
  kind: 'chart';
  chartType: 'column' | 'bar' | 'pie' | 'doughnut' | 'line' | 'area' | 'combo' | 'scatter' | 'bubble';
  grouping: 'clustered' | 'stacked' | 'percentStacked';
  firstSliceAngle?: number;
  holeSize?: number;
  bubble?: { scale: number; sizeRepresents: 'area' | 'width'; showNegative: boolean };
  displayBlanksAs?: 'gap' | 'zero' | 'span';
  title?: string;
  titleStyle?: ChartTextStyle;
  titleLines?: ChartTextRun[][];
  titleLayout?: ChartTitleLayout;
  categories: string[];
  series: ChartSeries[];
  textStyle?: ChartLabelStyle;
  gapWidth?: number;
  legendPosition?: 'top' | 'right' | 'bottom' | 'left' | 'none';
  legendStyle?: ChartLabelStyle;
  categoryAxis?: {
    reversed?: boolean;
    hidden?: boolean;
    title?: ChartAxisTitle;
    textStyle?: ChartLabelStyle;
    line?: LineStyle | null;
    date?: ChartDateAxis;
  };
  valueAxis?: ChartValueAxis;
  xValueAxis?: ChartValueAxis;
  secondaryValueAxis?: ChartValueAxis;
  plotGroups?: ChartPlotGroup[];
}

export interface UnsupportedItem extends BaseSlideItem {
  kind: 'unsupported';
  unsupportedType: string;
  label: string;
}

export type SlideItem = TextItem | ShapeItem | ImageItem | MediaItem | OleItem | TableItem | ChartItem | UnsupportedItem;

export type SlideBackground = FillStyle;

export interface SlideCommentAuthor {
  id: string;
  name?: string;
  initials?: string;
}

export interface SlideCommentReaction {
  type: string;
  instances: { author: SlideCommentAuthor; created?: string }[];
}

export type SlideCommentTaskEvent = {
  id: string;
  created?: string;
  author?: SlideCommentAuthor;
  commentId?: string;
} & (
  | { kind: 'created' | 'unassigned' | 'unknown' }
  | { kind: 'assigned'; assignee?: SlideCommentAuthor }
  | { kind: 'title'; title?: string }
  | { kind: 'schedule'; startDate?: string; dueDate?: string }
  | { kind: 'progress'; complete?: number }
  | { kind: 'undo'; eventId?: string }
);

export interface SlideCommentTask {
  title?: string;
  startDate?: string;
  dueDate?: string;
  assignedTo?: SlideCommentAuthor[];
  /** Percentage from 0 through 100. */
  complete?: number;
  history?: SlideCommentTaskEvent[];
}

export interface SlideCommentMessage {
  id: string;
  text: string;
  author?: SlideCommentAuthor;
  created?: string;
  status?: 'active' | 'resolved' | 'closed';
  replyTo?: string;
  reactions?: SlideCommentReaction[];
  task?: SlideCommentTask;
}

export interface SlideObjectReference {
  id?: string;
  creationId?: string;
}

export interface SlideCommentAnchor {
  kind: 'slide' | 'shape' | 'text' | 'unknown';
  /** Source position in slide pixels relative to the first anchor. */
  position?: { x: number; y: number };
  slide?: SlideObjectReference;
  master?: SlideObjectReference;
  layout?: SlideObjectReference;
  drawing?: SlideObjectReference;
  /** OfficeArt plain-text range in UTF-16 code units. */
  textRange?: {
    offset: number;
    length: number;
    contextLength?: number;
    contextHash?: number;
  };
}

export interface SlideComment extends SlideCommentMessage {
  replies?: SlideCommentMessage[];
  anchor?: SlideCommentAnchor;
  /** Subsequent modern drawing or text anchors in source order. */
  additionalAnchors?: SlideCommentAnchor[];
}

export interface SlideTransition {
  /** The authored PresentationML effect name, when present. */
  effect?: string;
  direction?: string;
  speed?: 'fast' | 'med' | 'slow';
  durationMs?: number;
  throughBlack?: boolean;
  advanceOnClick: boolean;
  advanceAfterMs?: number;
  /** Compatibility transition supplied alongside an extended effect. */
  fallback?: Omit<SlideTransition, 'fallback'>;
}

export interface SlideObjectAnimation {
  effect: 'appear' | 'fade' | 'wipe';
  targetId: string;
  itemIndexes: number[];
  /** Inclusive zero-based paragraph indexes for a text-only target. */
  paragraphs?: { start: number; end: number };
  chart?: SlideChartAnimationTarget;
  enter: boolean;
  direction?: 'up' | 'down' | 'left' | 'right';
  delayMs: number;
  durationMs: number;
}

export interface SlideChartAnimationTarget {
  step: 'series' | 'category' | 'ptInSeries' | 'ptInCategory' | 'allPts' | 'gridLegend';
  /** Zero-based index into the rendered chart's series. */
  seriesIndex?: number;
  categoryIndex?: number;
}

export interface SlideAnimationStep {
  /** Whether the source sequence starts this step on click. */
  onClick: boolean;
  effects: SlideObjectAnimation[];
}

export interface SlideModel {
  id: string;
  index: number;
  title: string;
  sourceSlide?: SlideObjectReference;
  /** Plain text from this slide's speaker notes placeholder. */
  speakerNotes?: string;
  comments?: SlideComment[];
  transition?: SlideTransition;
  animations?: SlideAnimationStep[];
  background: SlideBackground;
  width: number;
  height: number;
  items: SlideItem[];
  warnings: string[];
}

export interface ParsedPresentation {
  size: PresentationSize;
  theme: ThemeModel;
  slides: SlideModel[];
  /** Master and layout views referenced by modern comment anchors. */
  commentSources?: Array<{ master: SlideObjectReference; layout?: SlideObjectReference; slide: SlideModel }>;
  media: Record<string, MediaAsset>;
  warnings: string[];
}
