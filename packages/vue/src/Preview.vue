<script setup lang="ts">
import { usePreviewI18n, type PreviewMessages } from './i18n';
import {
  createPreviewer,
  type CadPreviewState,
  type ConverterClient,
  type DiagramPreviewState,
  type PreviewDisplayMode,
  type EbookPreviewState,
  type FormatDefinition,
  type ImagePreviewState,
  type MindmapPreviewState,
  type Model3dPreviewNode,
  type Model3dPreviewState,
  type PreviewMeasurementInfo,
  type PreviewSectionInfo,
  type PagedPreviewState,
  type PreviewMaterialInfo,
  type PreviewSnapshotBackground,
  type PreviewDriver,
  type PreviewFitMode,
  type PreviewFontResolver,
  type PreviewFontLoadingOptions,
  type PreviewItemState,
  type PreviewOptions,
  type PreviewPasswordRequest,
  type PreviewResourceResolver,
  type PreviewSource,
  type PreviewerInstance,
  type SourceDescriptor,
  type WorkbookPreviewState
} from '@filens/core';
import { createArchivePreviewDriver } from '@filens/archive';
import { createDesignPreviewDrivers } from '@filens/design';
import { createMediaPreviewDrivers, type MediaPreviewDriverOptions } from '@filens/media';
import { createOfficePreviewDrivers } from '@filens/office';
import { createTextPreviewDrivers } from '@filens/text';
import { computed, nextTick, onMounted, onUnmounted, ref, shallowRef, useId, watch } from 'vue';
import { createVueDefaultPreviewRoutes } from './defaults';

type Model3dControlsPreviewer = PreviewerInstance & {
  setNodeVisibility?: (nodeId: string, visible: boolean) => void;
  setExplode?: (amount: number) => void;
  setActiveMaterial?: (materialKey?: string) => void;
  setMeasurementActive?: (active: boolean) => void;
  clearMeasurement?: () => void;
  setMeasurementSnapMode?: (mode: 'surface' | 'vertex') => void;
  setMeasurementAxisLock?: (axis: 'free' | 'x' | 'y' | 'z') => void;
  setSectionActive?: (active: boolean) => void;
  setSectionMode?: (mode: 'single' | 'box') => void;
  setSectionAxis?: (axis: 'x' | 'y' | 'z') => void;
  setSectionOffset?: (offset: number) => void;
  setSectionRange?: (axis: 'x' | 'y' | 'z', min: number, max: number) => void;
  clearSection?: () => void;
  setCameraProjection?: (projection: 'perspective' | 'orthographic') => void;
  setCameraViewPreset?: (preset: 'free' | 'front' | 'back' | 'left' | 'right' | 'top' | 'bottom' | 'isometric') => void;
  setDisplayMode?: (mode: PreviewDisplayMode) => void;
  setSnapshotBackground?: (background: PreviewSnapshotBackground) => void;
  downloadSnapshot?: (filename?: string, background?: PreviewSnapshotBackground) => void;
};

type Model3dSectionInfo = PreviewSectionInfo & {
  mode?: 'single' | 'box';
  bounds?: {
    x: [number, number];
    y: [number, number];
    z: [number, number];
  };
  range?: {
    x: [number, number];
    y: [number, number];
    z: [number, number];
  };
};

type Model3dPreviewStateWithExplode = Model3dPreviewState & {
  explode?: number;
  snapshotBackground?: PreviewSnapshotBackground;
  section?: Model3dSectionInfo;
  camera?: NonNullable<Model3dPreviewState['camera']> & {
    projection?: 'perspective' | 'orthographic';
    viewPreset?: 'free' | 'front' | 'back' | 'left' | 'right' | 'top' | 'bottom' | 'isometric';
  };
};

const props = withDefaults(
  defineProps<{
    src: PreviewSource | SourceDescriptor;
    name?: string;
    extension?: string;
    contentType?: string;
    password?: string;
    requestPassword?: PreviewOptions['requestPassword'];
    fit?: PreviewFitMode;
    initialScale?: number;
    minScale?: number;
    maxScale?: number;
    toolbar?: boolean | 'minimal';
    locale?: string;
    messages?: PreviewMessages;
    drivers?: PreviewDriver[];
    routes?: FormatDefinition[];
    converter?: ConverterClient;
    mediaConverter?: ConverterClient;
    browserMedia?: MediaPreviewDriverOptions['browserMedia'];
    fontResolver?: PreviewFontResolver;
    fontLoading?: boolean | PreviewFontLoadingOptions;
    resourceResolver?: PreviewResourceResolver;
    audio?: PreviewOptions['audio'];
    panoramaProcessor?: MediaPreviewDriverOptions['panoramaProcessor'];
  }>(),
  {
    initialScale: 1,
    minScale: 0.4,
    maxScale: 4,
    toolbar: true,
    drivers: undefined,
    routes: undefined,
    converter: undefined,
    mediaConverter: undefined,
    browserMedia: false,
    fontResolver: undefined,
    fontLoading: undefined,
    resourceResolver: undefined,
    panoramaProcessor: undefined
  }
);

const { locale, t } = usePreviewI18n(props);

const emit = defineEmits<{
  (event: 'rendered', state: PreviewItemState): void;
  (event: 'error', error: Error): void;
  (event: 'state-change', state: PreviewItemState): void;
  (event: 'warnings', warnings: string[]): void;
  (event: 'page-change', pageIndex: number): void;
  (event: 'sheet-change', sheetIndex: number): void;
  (event: 'scale-change', scale: number): void;
}>();

const viewerHost = ref<HTMLDivElement | null>(null);
const shellRef = ref<HTMLDivElement | null>(null);
const previewer = shallowRef<PreviewerInstance | null>(null);
const previewState = ref<PreviewItemState>({
  loading: false,
  error: null,
  family: 'unsupported',
  warnings: [],
  capabilities: {}
});
const unsubs: Array<() => void> = [];
const collapsedModelNodes = ref<Set<string>>(new Set());
const model3dTreeQuery = ref('');
const modelToolsExpanded = ref(false);
const modelToolTab = ref<'view' | 'structure' | 'tools'>('view');
const modelToolTabs = [
  { id: 'view', label: 'View' }, { id: 'structure', label: 'Structure' }, { id: 'tools', label: 'Tools' }
] as const;
const modelViewPresets = [
  { id: 'isometric', label: 'Iso' }, { id: 'front', label: 'Front' }, { id: 'back', label: 'Back' },
  { id: 'left', label: 'Left' }, { id: 'right', label: 'Right' }, { id: 'top', label: 'Top' }, { id: 'bottom', label: 'Bottom' }
] as const;
const modelDisplayModes: PreviewDisplayMode[] = ['shaded', 'solid-edge', 'wireframe', 'xray'];
const modelToolsId = `pptxv-model-tools-${useId()}`;
const passwordId = `pptxv-password-${useId()}`;
const passwordInput = ref('');
const passwordField = ref<HTMLInputElement | null>(null);
const passwordRequest = shallowRef<PreviewPasswordRequest | null>(null);
const passwordCancelled = ref(false);
let settlePassword: ((password: string | null) => void) | undefined;

function requestDocumentPassword(request: PreviewPasswordRequest): Promise<string | null> {
  settlePassword?.(null);
  return new Promise(resolve => {
    const settle = (password: string | null) => {
      request.signal?.removeEventListener('abort', abort);
      if (settlePassword === settle) {
        settlePassword = undefined;
        passwordRequest.value = null;
        passwordInput.value = '';
      }
      resolve(password);
    };
    const abort = () => settle(null);
    settlePassword = settle;
    passwordInput.value = '';
    passwordRequest.value = request;
    if (request.signal?.aborted) abort();
    else {
      request.signal?.addEventListener('abort', abort, { once: true });
      void nextTick(() => passwordField.value?.focus());
    }
  });
}

function submitPassword(): void {
  if (passwordInput.value.length) settlePassword?.(passwordInput.value);
}

function cancelPassword(): void {
  passwordCancelled.value = true;
  settlePassword?.(null);
}

const isLoading = computed(() => previewState.value.loading);
const errorMessage = computed(() => previewState.value.error);
const isPaged = computed(() => previewState.value.family === 'paged');
const isWorkbook = computed(() => previewState.value.family === 'workbook');
const isEbook = computed(() => previewState.value.family === 'ebook');
const pagedState = computed(() => (isPaged.value ? (previewState.value as PagedPreviewState) : null));
const workbookState = computed(() => (isWorkbook.value ? (previewState.value as WorkbookPreviewState) : null));
const ebookState = computed(() => (isEbook.value ? (previewState.value as EbookPreviewState) : null));
const imageState = computed(() =>
  previewState.value.family === 'image' || previewState.value.family === 'panorama' || previewState.value.family === 'panorama-video'
    ? (previewState.value as ImagePreviewState)
    : null
);
const cadState = computed(() => (previewState.value.family === 'cad' ? (previewState.value as CadPreviewState) : null));
const model3dState = computed(() => (
  previewState.value.family === 'model3d' ? (previewState.value as Model3dPreviewStateWithExplode) : null
));
const mindmapState = computed(() => (previewState.value.family === 'mindmap' ? (previewState.value as MindmapPreviewState) : null));
const diagramState = computed(() => (previewState.value.family === 'diagram' ? (previewState.value as DiagramPreviewState) : null));
const activeIndex = computed(() => pagedState.value?.pageIndex ?? workbookState.value?.activeSheetIndex ?? ebookState.value?.chapterIndex ?? diagramState.value?.pageIndex ?? 0);
const activeCount = computed(() => pagedState.value?.pageCount ?? workbookState.value?.sheets.length ?? ebookState.value?.chapterCount ?? diagramState.value?.pageCount ?? 0);
const scale = computed(() => pagedState.value?.scale ?? workbookState.value?.scale ?? imageState.value?.scale ?? cadState.value?.scale ?? model3dState.value?.scale ?? mindmapState.value?.scale ?? diagramState.value?.scale ?? props.initialScale);
const scaleLabel = computed(() => `${Math.round(scale.value * 100)}%`);
const canNavigate = computed(() => Boolean(previewState.value.capabilities.paged || previewState.value.capabilities.sheets || previewState.value.capabilities.chapters));
const canGoPrev = computed(() => !isLoading.value && canNavigate.value && activeIndex.value > 0);
const canGoNext = computed(
  () => !isLoading.value && canNavigate.value && activeIndex.value < activeCount.value - 1
);
const canZoomOut = computed(() => !isLoading.value && Boolean(previewState.value.capabilities.zoom) && scale.value > props.minScale + 0.001);
const canZoomIn = computed(() => !isLoading.value && Boolean(previewState.value.capabilities.zoom) && scale.value < props.maxScale - 0.001);
const canRotate = computed(() => !isLoading.value && Boolean(previewState.value.capabilities.rotate));
const canFullscreen = computed(() => !isLoading.value && Boolean(previewState.value.capabilities.fullscreen));
const previewLayers = computed(() => cadState.value?.layers ?? []);
const activeLayerIds = computed(() => new Set(cadState.value?.activeLayerIds ?? []));
const canControlLayers = computed(() => !isLoading.value && Boolean(previewState.value.capabilities.layers) && previewLayers.value.length > 0);
const model3dTree = computed(() => model3dState.value?.modelTree ?? []);
const normalizedModel3dTreeQuery = computed(() => normalizeSearchText(model3dTreeQuery.value));
const hasModel3dTreeQuery = computed(() => normalizedModel3dTreeQuery.value.length > 0);
const filteredModel3dTree = computed(() => (
  hasModel3dTreeQuery.value
    ? filterModelTree(model3dTree.value, normalizedModel3dTreeQuery.value)
    : model3dTree.value
));
const model3dTreeTotalCount = computed(() => countModelNodes(model3dTree.value));
const model3dTreeMatchCount = computed(() => (
  hasModel3dTreeQuery.value
    ? countMatchingModelNodes(model3dTree.value, normalizedModel3dTreeQuery.value)
    : model3dTreeTotalCount.value
));
const selectedModelNodeId = computed(() => model3dState.value?.selectedNodeId);
const model3dMetadataRows = computed(() => {
  const metadata = model3dState.value?.metadata;
  if (!metadata) {
    return [];
  }
  const rows: Array<{ label: string; value: string }> = [];
  if (metadata.format) rows.push({ label: 'Format', value: metadata.format.toUpperCase() });
  if (typeof metadata.objectCount === 'number') rows.push({ label: 'Objects', value: String(metadata.objectCount) });
  if (typeof metadata.meshCount === 'number') rows.push({ label: 'Meshes', value: String(metadata.meshCount) });
  if (typeof metadata.lineCount === 'number') rows.push({ label: 'Lines', value: String(metadata.lineCount) });
  if (typeof metadata.pointCount === 'number') rows.push({ label: 'Points', value: String(metadata.pointCount) });
  if (typeof metadata.materialCount === 'number') rows.push({ label: 'Materials', value: String(metadata.materialCount) });
  if (typeof metadata.animationCount === 'number' && metadata.animationCount > 0) rows.push({ label: 'Animations', value: String(metadata.animationCount) });
  if (typeof metadata.triangleCount === 'number') rows.push({ label: 'Triangles', value: String(metadata.triangleCount) });
  if (typeof metadata.vertexCount === 'number') rows.push({ label: 'Vertices', value: String(metadata.vertexCount) });
  if (metadata.bounds?.size) rows.push({ label: 'Size', value: metadata.bounds.size.map(formatCompactNumber).join(' x ') });
  if (typeof metadata.hasVertexColors === 'boolean') rows.push({ label: 'Vertex colors', value: metadata.hasVertexColors ? 'Yes' : 'No' });
  if (metadata.materialNames?.length) rows.push({ label: 'Material names', value: metadata.materialNames.join(', ') });
  return rows;
});
const model3dTreeRows = computed(() => (
  flattenModelTree(
    filteredModel3dTree.value,
    hasModel3dTreeQuery.value ? new Set<string>() : collapsedModelNodes.value
  )
));
const selectedModelNodeRow = computed(() => model3dTreeRows.value.find((node) => node.id === selectedModelNodeId.value));
const selectedModelNodeSummary = computed(() => {
  if (!selectedModelNodeId.value) {
    return [];
  }
  const node = findModelNode(model3dTree.value, selectedModelNodeId.value);
  if (!node) {
    return [];
  }
  const summary = summarizeModelNode(node);
  return [
    { label: 'Kind', value: node.kind },
    { label: 'Children', value: String(node.children.length) },
    { label: 'Subtree nodes', value: String(summary.nodes) },
    { label: 'Meshes', value: String(node.metadata?.meshCount ?? summary.meshes) },
    { label: 'Lines', value: String(node.metadata?.lineCount ?? summary.lines) },
    { label: 'Points', value: String(node.metadata?.pointCount ?? summary.points) },
    { label: 'Groups', value: String(summary.groups) },
    { label: 'Materials', value: String(node.metadata?.materialCount ?? 0) },
    { label: 'Triangles', value: String(node.metadata?.triangleCount ?? 0) },
    { label: 'Vertices', value: String(node.metadata?.vertexCount ?? 0) },
    { label: 'Vertex colors', value: typeof node.metadata?.hasVertexColors === 'boolean' ? (node.metadata.hasVertexColors ? 'Yes' : 'No') : 'No' },
    { label: 'Visible', value: node.visible ? 'Yes' : 'No' },
    ...(node.metadata?.bounds?.size
      ? [{ label: 'Bounds', value: node.metadata.bounds.size.map(formatCompactNumber).join(' x ') }]
      : []),
    ...(node.metadata?.materialNames?.length
      ? [{ label: 'Material names', value: node.metadata.materialNames.join(', ') }]
      : [])
  ];
});
const selectedModelMaterialDetails = computed(() => {
  if (!selectedModelNodeId.value) {
    return [];
  }
  return findModelNode(model3dTree.value, selectedModelNodeId.value)?.metadata?.materialDetails ?? [];
});
const model3dMaterialDetails = computed(() =>
  selectedModelMaterialDetails.value.length
    ? selectedModelMaterialDetails.value
    : model3dState.value?.metadata?.materialDetails ?? []
);
const model3dMaterialHeading = computed(() =>
  selectedModelMaterialDetails.value.length ? 'Selected materials' : 'Model materials'
);
const model3dMaterialCountLabel = computed(() => String(model3dMaterialDetails.value.length));
const activeModelMaterialKey = computed(() => model3dState.value?.isolatedMaterialKey);
const model3dMeasurement = computed(() => model3dState.value?.measurement);
const isModelMeasurementActive = computed(() => Boolean(model3dMeasurement.value?.active));
const canMeasureModel = computed(() => !isLoading.value && previewState.value.family === 'model3d' && Boolean(previewState.value.capabilities.measure));
const hasModelMeasurement = computed(() => Boolean(model3dMeasurement.value?.start));
const model3dMeasurementSnapMode = computed(() => model3dMeasurement.value?.snapMode ?? 'surface');
const model3dMeasurementAxisLock = computed(() => model3dMeasurement.value?.axisLock ?? 'free');
const model3dMeasurementRows = computed(() => {
  const measurement = model3dMeasurement.value;
  if (!measurement) {
    return [];
  }
  return [
    { label: 'Status', value: measurementStatusLabel(measurement) },
    { label: 'Snap', value: measurementSnapLabel(measurement.snapMode ?? 'surface') },
    { label: 'Axis', value: measurementAxisLabel(measurement.axisLock ?? 'free') },
    ...(measurement.start ? [{ label: 'Start', value: formatVector(measurement.start) }] : []),
    ...(measurement.end ? [{ label: 'End', value: formatVector(measurement.end) }] : []),
    ...(!measurement.end && measurement.previewPoint ? [{ label: 'Preview', value: formatVector(measurement.previewPoint) }] : []),
    ...(measurement.delta ? [{ label: 'Delta', value: formatVector(measurement.delta) }] : []),
    ...(!measurement.delta && measurement.previewDelta ? [{ label: 'Preview delta', value: formatVector(measurement.previewDelta) }] : []),
    ...(typeof measurement.distance === 'number' ? [{ label: 'Distance', value: formatCompactNumber(measurement.distance) }] : []),
    ...(typeof measurement.distance !== 'number' && typeof measurement.previewDistance === 'number'
      ? [{ label: 'Preview distance', value: formatCompactNumber(measurement.previewDistance) }]
      : [])
  ];
});
const model3dSection = computed(() => model3dState.value?.section);
const canSectionModel = computed(() => !isLoading.value && previewState.value.family === 'model3d' && Boolean(previewState.value.capabilities.section));
const isModelSectionActive = computed(() => Boolean(model3dSection.value?.active));
const model3dSectionMode = computed(() => model3dSection.value?.mode ?? 'single');
const model3dSectionAxis = computed(() => model3dSection.value?.axis ?? 'x');
const model3dSectionMin = computed(() => model3dSection.value?.min ?? -1);
const model3dSectionMax = computed(() => model3dSection.value?.max ?? 1);
const model3dSectionOffset = computed(() => model3dSection.value?.offset ?? 0);
const model3dSectionStep = computed(() => {
  const range = Math.abs(model3dSectionMax.value - model3dSectionMin.value);
  return range > 0 ? Math.max(range / 200, 0.001) : 0.001;
});
const model3dSectionBounds = computed(() => model3dSection.value?.bounds ?? {
  x: [-1, 1] as [number, number],
  y: [-1, 1] as [number, number],
  z: [-1, 1] as [number, number]
});
const model3dSectionRange = computed(() => model3dSection.value?.range ?? model3dSectionBounds.value);
const model3dCamera = computed(() => model3dState.value?.camera);
const model3dProjection = computed(() => model3dCamera.value?.projection ?? 'perspective');
const model3dViewPreset = computed(() => model3dCamera.value?.viewPreset ?? 'free');
const model3dDisplayMode = computed(() => model3dState.value?.displayMode ?? 'solid-edge');
const model3dSnapshotBackground = computed(() => model3dState.value?.snapshotBackground ?? 'scene');
const canControlModelCamera = computed(() => !isLoading.value && previewState.value.family === 'model3d');
const canControlModelDisplay = computed(() => !isLoading.value && previewState.value.family === 'model3d' && Boolean(previewState.value.capabilities.displayMode));
const canDownloadSnapshot = computed(() => !isLoading.value && previewState.value.family === 'model3d' && Boolean(previewState.value.capabilities.download));
const showModel3dTree = computed(() => !isLoading.value && previewState.value.family === 'model3d' && model3dTree.value.length > 0);
const showModel3dTreeEmpty = computed(() => showModel3dTree.value && hasModel3dTreeQuery.value && model3dTreeRows.value.length === 0);
const showModel3dMetadata = computed(() => !isLoading.value && previewState.value.family === 'model3d' && model3dMetadataRows.value.length > 0);
const canExplodeModel = computed(() => !isLoading.value && previewState.value.family === 'model3d' && Boolean(previewState.value.capabilities.explode));
const model3dExplodePercent = computed(() => Math.round((model3dState.value?.explode ?? 0) * 100));
const layerLabel = computed(() => {
  const total = previewLayers.value.length;
  const active = activeLayerIds.value.size;
  return total ? `${active} / ${total}` : t('Layers');
});
const warningLabel = computed(() =>
  previewState.value.warnings.length ? t('Warnings: {count}', { count: previewState.value.warnings.length }) : ''
);
const familyLabel = computed(() => previewState.value.family === 'unsupported' ? 'Preview' : previewState.value.family);
const positionLabel = computed(() => {
  if (isPaged.value) {
    return `${activeIndex.value + 1} / ${activeCount.value || 1}`;
  }
  if (isWorkbook.value) {
    return `${workbookState.value?.sheets[activeIndex.value]?.name ?? t('Sheet')} ${activeIndex.value + 1} / ${activeCount.value || 1}`;
  }
  if (isEbook.value) {
    return `${ebookState.value?.chapterTitle ?? t('Chapter')} ${activeIndex.value + 1} / ${activeCount.value || 1}`;
  }
  if (diagramState.value) {
    return `${t('Page')} ${activeIndex.value + 1} / ${activeCount.value || 1}`;
  }
  return familyLabel.value;
});

function syncState(state?: PreviewItemState): void {
  const previousFamily = previewState.value.family;
  const previousActiveIndex = activeIndex.value;
  const previousScale = scale.value;
  previewState.value = clonePreviewState(state ?? previewer.value?.getState() ?? previewState.value);

  if (previewState.value.family === 'paged') {
    const current = previewState.value as PagedPreviewState;
    if (previousFamily === 'paged' && current.pageIndex !== previousActiveIndex) {
      emit('page-change', current.pageIndex);
    }
    if (current.scale !== previousScale) {
      emit('scale-change', current.scale);
    }
    return;
  }

  if (previewState.value.family === 'workbook') {
    const current = previewState.value as WorkbookPreviewState;
    if (previousFamily === 'workbook' && current.activeSheetIndex !== previousActiveIndex) {
      emit('sheet-change', current.activeSheetIndex);
    }
    if (typeof current.scale === 'number' && current.scale !== previousScale) {
      emit('scale-change', current.scale);
    }
    return;
  }

  if ((previewState.value.family === 'image' || previewState.value.family === 'panorama') && 'scale' in previewState.value) {
    const current = previewState.value as ImagePreviewState;
    if (current.scale !== previousScale) {
      emit('scale-change', current.scale);
    }
    return;
  }

  if (previewState.value.family === 'cad') {
    const current = previewState.value as CadPreviewState;
    if (current.scale !== previousScale) {
      emit('scale-change', current.scale);
    }
    return;
  }

  if (previewState.value.family === 'mindmap') {
    const current = previewState.value as MindmapPreviewState;
    if (current.scale !== previousScale) {
      emit('scale-change', current.scale);
    }
    return;
  }

  if (previewState.value.family === 'diagram') {
    const current = previewState.value as DiagramPreviewState;
    if (previousFamily === 'diagram' && current.pageIndex !== previousActiveIndex) {
      emit('page-change', current.pageIndex ?? 0);
    }
    if (current.scale !== previousScale) {
      emit('scale-change', current.scale);
    }
  }
}

function clonePreviewState<T extends PreviewItemState>(state: T): T {
  const cloned = {
    ...state,
    capabilities: { ...state.capabilities },
    warnings: [...state.warnings]
  } as T;
  if (state.fonts) cloned.fonts = state.fonts.map((font) => ({ ...font, classification: font.classification ? { ...font.classification } : undefined }));

  const measurement = (state as unknown as { measurement?: PreviewMeasurementInfo }).measurement;
  if (measurement) {
    (cloned as unknown as { measurement: PreviewMeasurementInfo }).measurement = {
      ...measurement,
      start: measurement.start ? [...measurement.start] as [number, number, number] : undefined,
      end: measurement.end ? [...measurement.end] as [number, number, number] : undefined,
      delta: measurement.delta ? [...measurement.delta] as [number, number, number] : undefined,
      previewPoint: measurement.previewPoint ? [...measurement.previewPoint] as [number, number, number] : undefined,
      previewDelta: measurement.previewDelta ? [...measurement.previewDelta] as [number, number, number] : undefined,
      previewDistance: measurement.previewDistance
    };
  }

  const section = (state as unknown as { section?: Model3dSectionInfo }).section;
  if (section) {
    (cloned as unknown as { section: Model3dSectionInfo }).section = {
      ...section,
      bounds: section.bounds
        ? {
            x: [...section.bounds.x] as [number, number],
            y: [...section.bounds.y] as [number, number],
            z: [...section.bounds.z] as [number, number]
          }
        : undefined,
      range: section.range
        ? {
            x: [...section.range.x] as [number, number],
            y: [...section.range.y] as [number, number],
            z: [...section.range.z] as [number, number]
          }
        : undefined
    };
  }

  const camera = (state as unknown as { camera?: Model3dPreviewStateWithExplode['camera'] }).camera;
  if (camera) {
    (cloned as unknown as { camera: Model3dPreviewStateWithExplode['camera'] }).camera = {
      ...camera,
      position: [...camera.position] as [number, number, number],
      target: [...camera.target] as [number, number, number]
    };
  }

  return cloned;
}

async function recreatePreviewer(): Promise<void> {
  unsubs.splice(0).forEach((unsubscribe) => unsubscribe());
  previewer.value?.destroy();
  previewer.value = null;

  if (!viewerHost.value) {
    return;
  }

  const drivers = props.drivers ?? createVueDefaultPreviewDrivers(props.panoramaProcessor, props.converter, props.mediaConverter, props.browserMedia);
  const routes = props.routes ?? createVueDefaultPreviewRoutes({ rawPreview: Boolean(props.panoramaProcessor && props.converter) });
  const createNestedPreviewer = (host: HTMLElement, childOptions: PreviewOptions = {}) => createPreviewer(host, {
    containerContext: childOptions.containerContext,
    translate: childOptions.translate ?? (message => t(message)),
    fit: childOptions.fit ?? props.fit,
    initialScale: childOptions.initialScale ?? props.initialScale,
    minScale: childOptions.minScale ?? props.minScale,
    maxScale: childOptions.maxScale ?? props.maxScale,
    fontResolver: childOptions.fontResolver ?? props.fontResolver,
    fontLoading: childOptions.fontLoading ?? props.fontLoading,
    resourceResolver: childOptions.resourceResolver ?? props.resourceResolver,
    audio: childOptions.audio ?? props.audio,
    requestPassword: childOptions.requestPassword ?? props.requestPassword ?? requestDocumentPassword,
    drivers,
    routes,
    converter: props.converter,
    previewerFactory: createNestedPreviewer
  });
  previewer.value = createNestedPreviewer(viewerHost.value);

  unsubs.push(
    previewer.value.on('rendered', (state) => {
      syncState(state);
      emit('rendered', state);
    }),
    previewer.value.on('statechange', (state) => {
      syncState(state);
      emit('state-change', state);
    }),
    previewer.value.on('error', (error) => {
      syncState();
      emit('error', error);
    }),
    previewer.value.on('warnings', (warnings) => {
      syncState();
      emit('warnings', warnings);
    })
  );
}

async function loadSource(): Promise<void> {
  if (!previewer.value || props.src == null) {
    return;
  }

  passwordCancelled.value = false;
  const task = previewer.value.preview(props.src, {
    name: props.name,
    extension: props.extension,
    contentType: props.contentType,
    ...(props.password !== undefined ? { password: props.password } : {})
  });
  syncState();
  await task;
  syncState();
}

function zoomIn(): void {
  previewer.value?.setScale(scale.value + 0.1);
  syncState();
}

function zoomOut(): void {
  previewer.value?.setScale(scale.value - 0.1);
  syncState();
}

function fitContain(): void {
  previewer.value?.fit('contain');
  syncState();
}

function fitWidth(): void {
  previewer.value?.fit('width');
  syncState();
}

function fitHeight(): void {
  previewer.value?.fit('height');
  syncState();
}

function rotateClockwise(): void {
  previewer.value?.rotate(90);
  syncState();
}

async function toggleFullscreen(): Promise<void> {
  await previewer.value?.fullscreen();
}

function previousPage(): void {
  previewer.value?.prev();
}

function nextPage(): void {
  previewer.value?.next();
}

function goToIndex(index: number): void {
  previewer.value?.goToPage(index);
  syncState();
}

function toggleLayer(layerId: string, event: Event): void {
  const checked = (event.target as HTMLInputElement | null)?.checked;
  previewer.value?.toggleLayer(layerId, checked);
  syncState();
}

function showAllLayers(): void {
  previewer.value?.setActiveLayers(previewLayers.value.map((layer) => layer.id));
  syncState();
}

function hideAllLayers(): void {
  previewer.value?.setActiveLayers([]);
  syncState();
}

function showAllModelNodes(): void {
  const modelPreviewer = previewer.value as Model3dControlsPreviewer | null;
  for (const node of flattenModelTree(model3dTree.value, new Set<string>())) {
    if (!node.visible) {
      modelPreviewer?.setNodeVisibility?.(node.id, true);
    }
  }
  previewer.value?.selectNode();
  syncState();
}

function selectModelNode(nodeId?: string): void {
  previewer.value?.selectNode(nodeId);
  syncState();
}

function setModelNodeVisibility(nodeId: string, event: Event): void {
  const checked = (event.target as HTMLInputElement | null)?.checked;
  if (typeof checked !== 'boolean') {
    return;
  }
  (previewer.value as Model3dControlsPreviewer | null)?.setNodeVisibility?.(nodeId, checked);
  syncState();
}

function setModelExplode(event: Event): void {
  const value = Number((event.target as HTMLInputElement | null)?.value ?? 0);
  (previewer.value as Model3dControlsPreviewer | null)?.setExplode?.(value / 100);
  syncState();
}

function toggleModelExplode(): void {
  (previewer.value as Model3dControlsPreviewer | null)?.setExplode?.(model3dExplodePercent.value > 0 ? 0 : 1);
  syncState();
}

function refocusSelectedModelNode(): void {
  if (!selectedModelNodeId.value) {
    return;
  }
  previewer.value?.selectNode(selectedModelNodeId.value);
  syncState();
}

function resetModelView(): void {
  const modelPreviewer = previewer.value as Model3dControlsPreviewer | null;
  previewer.value?.selectNode();
  previewer.value?.fit('contain');
  modelPreviewer?.setCameraViewPreset?.('isometric');
  modelPreviewer?.setCameraProjection?.('perspective');
  modelPreviewer?.setDisplayMode?.('solid-edge');
  syncState();
}

function toggleModelNodeCollapsed(nodeId: string): void {
  const next = new Set(collapsedModelNodes.value);
  if (next.has(nodeId)) {
    next.delete(nodeId);
  } else {
    next.add(nodeId);
  }
  collapsedModelNodes.value = next;
}

function clearModelTreeSearch(): void {
  model3dTreeQuery.value = '';
}

function toggleActiveMaterial(materialKey?: string): void {
  const modelPreviewer = previewer.value as Model3dControlsPreviewer | null;
  modelPreviewer?.setActiveMaterial?.(activeModelMaterialKey.value === materialKey ? undefined : materialKey);
  syncState();
}

function toggleModelMeasurement(): void {
  const modelPreviewer = previewer.value as Model3dControlsPreviewer | null;
  modelPreviewer?.setMeasurementActive?.(!isModelMeasurementActive.value);
  syncState();
}

function clearModelMeasurement(): void {
  const modelPreviewer = previewer.value as Model3dControlsPreviewer | null;
  modelPreviewer?.clearMeasurement?.();
  syncState();
}

function setModelMeasurementSnapMode(mode: 'surface' | 'vertex'): void {
  const modelPreviewer = previewer.value as Model3dControlsPreviewer | null;
  modelPreviewer?.setMeasurementSnapMode?.(mode);
  syncState();
}

function setModelMeasurementAxisLock(axis: 'free' | 'x' | 'y' | 'z'): void {
  const modelPreviewer = previewer.value as Model3dControlsPreviewer | null;
  modelPreviewer?.setMeasurementAxisLock?.(axis);
  syncState();
}

function toggleModelSection(): void {
  const modelPreviewer = previewer.value as Model3dControlsPreviewer | null;
  modelPreviewer?.setSectionActive?.(!isModelSectionActive.value);
  syncState();
}

function clearModelSection(): void {
  const modelPreviewer = previewer.value as Model3dControlsPreviewer | null;
  modelPreviewer?.clearSection?.();
  syncState();
}

function setModelSectionMode(mode: 'single' | 'box'): void {
  const modelPreviewer = previewer.value as Model3dControlsPreviewer | null;
  modelPreviewer?.setSectionMode?.(mode);
  syncState();
}

function setModelSectionAxis(axis: 'x' | 'y' | 'z'): void {
  const modelPreviewer = previewer.value as Model3dControlsPreviewer | null;
  modelPreviewer?.setSectionAxis?.(axis);
  syncState();
}

function setModelSectionOffset(event: Event): void {
  const value = Number((event.target as HTMLInputElement | null)?.value ?? 0);
  const modelPreviewer = previewer.value as Model3dControlsPreviewer | null;
  modelPreviewer?.setSectionOffset?.(value);
  syncState();
}

function setModelSectionRange(axis: 'x' | 'y' | 'z', side: 'min' | 'max', event: Event): void {
  const value = Number((event.target as HTMLInputElement | null)?.value ?? 0);
  const current = model3dSectionRange.value[axis];
  const nextMin = side === 'min' ? value : current[0];
  const nextMax = side === 'max' ? value : current[1];
  const modelPreviewer = previewer.value as Model3dControlsPreviewer | null;
  modelPreviewer?.setSectionRange?.(axis, nextMin, nextMax);
  syncState();
}

function setModelProjection(projection: 'perspective' | 'orthographic'): void {
  const modelPreviewer = previewer.value as Model3dControlsPreviewer | null;
  modelPreviewer?.setCameraProjection?.(projection);
  syncState();
}

function setModelViewPreset(preset: 'free' | 'front' | 'back' | 'left' | 'right' | 'top' | 'bottom' | 'isometric'): void {
  const modelPreviewer = previewer.value as Model3dControlsPreviewer | null;
  modelPreviewer?.setCameraViewPreset?.(preset);
  syncState();
}

function setModelDisplayMode(mode: PreviewDisplayMode): void {
  const modelPreviewer = previewer.value as Model3dControlsPreviewer | null;
  modelPreviewer?.setDisplayMode?.(mode);
  syncState();
}

function setModelSnapshotBackground(background: PreviewSnapshotBackground): void {
  const modelPreviewer = previewer.value as Model3dControlsPreviewer | null;
  modelPreviewer?.setSnapshotBackground?.(background);
  syncState();
}

function downloadModelSnapshot(): void {
  const modelPreviewer = previewer.value as Model3dControlsPreviewer | null;
  modelPreviewer?.downloadSnapshot?.(undefined, model3dSnapshotBackground.value);
}

function onShellKeydown(event: KeyboardEvent): void {
  if (event.defaultPrevented || !previewer.value || shouldIgnoreShortcut(event)) {
    return;
  }

  if (event.key === 'ArrowLeft' || event.key === 'PageUp') {
    event.preventDefault();
    previousPage();
    return;
  }

  if (event.key === 'ArrowRight' || event.key === 'PageDown') {
    event.preventDefault();
    nextPage();
    return;
  }

  if ((event.key === '+' || event.key === '=') && !event.ctrlKey && !event.metaKey) {
    event.preventDefault();
    zoomIn();
    return;
  }

  if ((event.key === '-' || event.key === '_') && !event.ctrlKey && !event.metaKey) {
    event.preventDefault();
    zoomOut();
    return;
  }

  if (event.key === '0') {
    event.preventDefault();
    fitContain();
    return;
  }

  if (event.key.toLowerCase() === 'w') {
    event.preventDefault();
    fitWidth();
    return;
  }

  if (event.key.toLowerCase() === 'h') {
    event.preventDefault();
    fitHeight();
    return;
  }

  if (event.key.toLowerCase() === 'r') {
    event.preventDefault();
    rotateClockwise();
    return;
  }

  if (event.key.toLowerCase() === 'f') {
    event.preventDefault();
    void toggleFullscreen();
    return;
  }

  if (event.key.toLowerCase() === 'g' && canDownloadSnapshot.value) {
    event.preventDefault();
    downloadModelSnapshot();
    return;
  }

  if (event.key.toLowerCase() === 'x' && canExplodeModel.value) {
    event.preventDefault();
    toggleModelExplode();
    return;
  }

  if (event.key.toLowerCase() === 'm' && canMeasureModel.value) {
    event.preventDefault();
    toggleModelMeasurement();
    return;
  }

  if (event.key.toLowerCase() === 's' && canSectionModel.value) {
    event.preventDefault();
    toggleModelSection();
    return;
  }

  if (event.key === '1' && canControlModelDisplay.value) {
    event.preventDefault();
    setModelDisplayMode('shaded');
    return;
  }

  if (event.key === '2' && canControlModelDisplay.value) {
    event.preventDefault();
    setModelDisplayMode('solid-edge');
    return;
  }

  if (event.key === '3' && canControlModelDisplay.value) {
    event.preventDefault();
    setModelDisplayMode('wireframe');
    return;
  }

  if (event.key === '4' && canControlModelDisplay.value) {
    event.preventDefault();
    setModelDisplayMode('xray');
    return;
  }

  if (event.key === 'Escape' && hasModelMeasurement.value) {
    event.preventDefault();
    clearModelMeasurement();
    return;
  }

  if (event.key === 'Escape' && isModelSectionActive.value) {
    event.preventDefault();
    clearModelSection();
  }
}

async function closeModelTools(): Promise<void> {
  modelToolsExpanded.value = false;
  await nextTick();
  shellRef.value?.querySelector<HTMLButtonElement>('.pptxv-model-tools-toggle')?.focus();
}

async function toggleModelTools(): Promise<void> {
  if (modelToolsExpanded.value) { closeModelTools(); return; }
  modelToolsExpanded.value = true;
  await nextTick();
  shellRef.value?.querySelector<HTMLButtonElement>('.pptxv-model-tabs [aria-selected="true"]')?.focus();
}

function onModelTabKeydown(event: KeyboardEvent): void {
  const index = modelToolTabs.findIndex(tab => tab.id === modelToolTab.value);
  let next: number;
  if (event.key === 'ArrowRight') next = (index + 1) % modelToolTabs.length;
  else if (event.key === 'ArrowLeft') next = (index + modelToolTabs.length - 1) % modelToolTabs.length;
  else if (event.key === 'Home') next = 0;
  else if (event.key === 'End') next = modelToolTabs.length - 1;
  else return;
  event.preventDefault();
  event.stopPropagation();
  modelToolTab.value = modelToolTabs[next].id;
  shellRef.value?.querySelectorAll<HTMLButtonElement>('.pptxv-model-tabs [role="tab"]')[next]?.focus();
}

function shouldIgnoreShortcut(event: KeyboardEvent): boolean {
  const target = event.target as HTMLElement | null;
  return Boolean(target?.closest('input, textarea, select, [contenteditable="true"], button'));
}

function formatCompactNumber(value: number): string {
  return Number.isInteger(value) ? String(value) : value.toFixed(2).replace(/\.?0+$/, '');
}

function formatVector(value: [number, number, number]): string {
  return value.map(formatCompactNumber).join(', ');
}

function formatRange(value: [number, number]): string {
  return `${formatCompactNumber(value[0])} .. ${formatCompactNumber(value[1])}`;
}

function measurementStatusLabel(
  measurement: NonNullable<Model3dPreviewStateWithExplode['measurement']>
): string {
  switch (measurement.status) {
    case 'pick-start': return 'Pick start';
    case 'pick-end': return measurement.active ? 'Pick end' : 'Start set';
    case 'complete': return measurement.active ? 'Ready' : 'Measured';
    default: return measurement.active ? 'Pick start' : 'Idle';
  }
}

function measurementSnapLabel(mode: 'surface' | 'vertex'): string {
  return mode === 'vertex' ? t('Vertex') : t('Surface');
}

function measurementAxisLabel(axis: 'free' | 'x' | 'y' | 'z'): string {
  switch (axis) {
    case 'x': return 'X';
    case 'y': return 'Y';
    case 'z': return 'Z';
    default: return t('Free');
  }
}

function displayModeLabel(mode: PreviewDisplayMode): string {
  switch (mode) {
    case 'shaded': return t('Shaded');
    case 'wireframe': return t('Wireframe');
    case 'xray': return t('X-Ray');
    default: return t('Solid + edge');
  }
}

function snapshotBackgroundLabel(background: PreviewSnapshotBackground): string {
  switch (background) {
    case 'white': return t('White');
    case 'transparent': return t('Transparent');
    default: return t('Scene');
  }
}

function materialDetailRows(material: PreviewMaterialInfo): Array<{ label: string; value: string }> {
  return [
    ...(material.name ? [{ label: 'Name', value: material.name }] : []),
    { label: 'Type', value: material.type },
    ...(material.color ? [{ label: 'Color', value: material.color }] : []),
    ...(material.emissiveColor ? [{ label: 'Emissive', value: material.emissiveColor }] : []),
    ...(typeof material.opacity === 'number' ? [{ label: 'Opacity', value: formatCompactNumber(material.opacity) }] : []),
    ...(typeof material.alphaTest === 'number' ? [{ label: 'Alpha test', value: formatCompactNumber(material.alphaTest) }] : []),
    ...(typeof material.transparent === 'boolean' ? [{ label: t('Transparent'), value: material.transparent ? 'Yes' : 'No' }] : []),
    ...(typeof material.wireframe === 'boolean' ? [{ label: t('Wireframe'), value: material.wireframe ? 'Yes' : 'No' }] : []),
    ...(typeof material.vertexColors === 'boolean' ? [{ label: 'Vertex colors', value: material.vertexColors ? 'Yes' : 'No' }] : []),
    ...(typeof material.flatShading === 'boolean' ? [{ label: 'Flat shading', value: material.flatShading ? 'Yes' : 'No' }] : []),
    ...(typeof material.depthWrite === 'boolean' ? [{ label: 'Depth write', value: material.depthWrite ? 'Yes' : 'No' }] : []),
    ...(typeof material.depthTest === 'boolean' ? [{ label: 'Depth test', value: material.depthTest ? 'Yes' : 'No' }] : []),
    ...(material.side ? [{ label: 'Side', value: material.side }] : []),
    ...(typeof material.roughness === 'number' ? [{ label: 'Roughness', value: formatCompactNumber(material.roughness) }] : []),
    ...(typeof material.metalness === 'number' ? [{ label: 'Metalness', value: formatCompactNumber(material.metalness) }] : []),
    ...(typeof material.shininess === 'number' ? [{ label: 'Shininess', value: formatCompactNumber(material.shininess) }] : []),
    ...(typeof material.size === 'number' ? [{ label: 'Size', value: formatCompactNumber(material.size) }] : []),
    ...(material.mapKinds?.length ? [{ label: 'Maps', value: material.mapKinds.join(', ') }] : [])
  ];
}

function materialColorSwatches(material: PreviewMaterialInfo): Array<{ label: string; color: string }> {
  return [
    ...(material.color ? [{ label: 'Base', color: material.color }] : []),
    ...(material.emissiveColor ? [{ label: 'Emissive', color: material.emissiveColor }] : [])
  ];
}

function materialActionLabel(material: PreviewMaterialInfo): string {
  return activeModelMaterialKey.value === material.key ? t('Clear isolate') : t('Isolate');
}

function findModelNode(nodes: Model3dPreviewNode[], nodeId: string): Model3dPreviewNode | undefined {
  for (const node of nodes) {
    if (node.id === nodeId) {
      return node;
    }
    const found = findModelNode(node.children, nodeId);
    if (found) {
      return found;
    }
  }
  return undefined;
}

function summarizeModelNode(node: Model3dPreviewNode): {
  nodes: number;
  groups: number;
  meshes: number;
  lines: number;
  points: number;
} {
  const own = {
    nodes: 1,
    groups: node.kind === 'group' ? 1 : 0,
    meshes: node.kind === 'mesh' ? 1 : 0,
    lines: node.kind === 'lines' ? 1 : 0,
    points: node.kind === 'points' ? 1 : 0
  };
  for (const child of node.children) {
    const nested = summarizeModelNode(child);
    own.nodes += nested.nodes;
    own.groups += nested.groups;
    own.meshes += nested.meshes;
    own.lines += nested.lines;
    own.points += nested.points;
  }
  return own;
}

function flattenModelTree(
  nodes: Model3dPreviewNode[],
  collapsedNodeIds: Set<string>,
  depth = 0
): Array<Model3dPreviewNode & { depth: number; collapsed: boolean }> {
  return nodes.flatMap((node) => [
    {
      ...node,
      depth,
      collapsed: collapsedNodeIds.has(node.id)
    },
    ...(collapsedNodeIds.has(node.id) ? [] : flattenModelTree(node.children, collapsedNodeIds, depth + 1))
  ]);
}

function filterModelTree(nodes: Model3dPreviewNode[], query: string): Model3dPreviewNode[] {
  return nodes.flatMap((node) => {
    if (modelTreeNodeSearchText(node).includes(query)) {
      return [node];
    }
    const children = filterModelTree(node.children, query);
    return children.length ? [{ ...node, children }] : [];
  });
}

function countModelNodes(nodes: Model3dPreviewNode[]): number {
  return nodes.reduce((total, node) => total + 1 + countModelNodes(node.children), 0);
}

function countMatchingModelNodes(nodes: Model3dPreviewNode[], query: string): number {
  return nodes.reduce((total, node) => (
    total
    + (modelTreeNodeSearchText(node).includes(query) ? 1 : 0)
    + countMatchingModelNodes(node.children, query)
  ), 0);
}

function modelTreeNodeSearchText(node: Model3dPreviewNode): string {
  return normalizeSearchText([
    node.label,
    node.kind,
    node.id,
    ...(node.metadata?.materialNames ?? [])
  ].join(' '));
}

function normalizeSearchText(value: string): string {
  return value.trim().toLowerCase();
}

defineExpose({
  goToIndex,
  next: nextPage,
  prev: previousPage,
  fit: (mode?: PreviewFitMode) => {
    previewer.value?.fit(mode);
    syncState();
  },
  setScale: (nextScale: number) => {
    previewer.value?.setScale(nextScale);
    syncState();
  },
  rotate: (degrees?: number) => {
    previewer.value?.rotate(degrees);
    syncState();
  },
  getState: () => previewState.value
});

onMounted(async () => {
  await recreatePreviewer();
  await loadSource();
});

watch(
  () => props.src,
  async () => {
    modelToolsExpanded.value = false;
    modelToolTab.value = 'view';
    collapsedModelNodes.value = new Set();
    model3dTreeQuery.value = '';
    await loadSource();
  }
);

watch(
  () => [
    props.fit,
    props.initialScale,
    props.minScale,
    props.maxScale,
    props.drivers,
    props.routes,
    props.converter,
    props.mediaConverter,
    props.browserMedia,
    props.fontResolver,
    props.fontLoading,
    props.resourceResolver,
    props.audio,
    props.requestPassword,
    props.panoramaProcessor
  ],
  async () => {
    modelToolsExpanded.value = false;
    modelToolTab.value = 'view';
    collapsedModelNodes.value = new Set();
    model3dTreeQuery.value = '';
    await recreatePreviewer();
    await loadSource();
  }
);

watch(
  () => [props.name, props.extension, props.contentType, props.password],
  async () => {
    modelToolsExpanded.value = false;
    modelToolTab.value = 'view';
    collapsedModelNodes.value = new Set();
    model3dTreeQuery.value = '';
    await loadSource();
  }
);

onUnmounted(() => {
  settlePassword?.(null);
  unsubs.forEach((unsubscribe) => unsubscribe());
  previewer.value?.destroy();
});

function createVueDefaultPreviewDrivers(panoramaProcessor?: MediaPreviewDriverOptions['panoramaProcessor'], converter?: MediaPreviewDriverOptions['converter'], mediaConverter?: MediaPreviewDriverOptions['mediaConverter'], browserMedia?: MediaPreviewDriverOptions['browserMedia']): PreviewDriver[] {
  return [
    ...createOfficePreviewDrivers(),
    ...createDesignPreviewDrivers(),
    ...createMediaPreviewDrivers({ panoramaProcessor, converter, mediaConverter, browserMedia }),
    createArchivePreviewDriver(),
    ...createTextPreviewDrivers()
  ];
}

</script>

<template>
  <div
    ref="shellRef"
    class="pptxv-shell pptxv-generic-shell"
    :lang="locale.replace('_', '-')"
    tabindex="0"
    role="region"
    :aria-label="t('{family} preview', { family: familyLabel })"
    @keydown="onShellKeydown"
  >
    <div v-if="toolbar && previewState.family !== 'model3d'" class="pptxv-toolbar">
      <div v-if="toolbar !== 'minimal'" class="pptxv-toolbar-group">
        <button type="button" class="pptxv-button" :disabled="!canGoPrev" @click="previousPage">{{ t('Prev') }}</button>
        <button type="button" class="pptxv-button" :disabled="!canGoNext" @click="nextPage">{{ t('Next') }}</button>
        <span class="pptxv-status">{{ positionLabel }}</span>
        <span class="pptxv-pill" :class="{ 'pptxv-pill--hidden': !warningLabel }">{{ warningLabel || t('Warnings: {count}', { count: 0 }) }}</span>
        <details class="pptxv-layer-menu" :class="{ 'pptxv-layer-menu--hidden': !canControlLayers }">
          <summary class="pptxv-button pptxv-layer-summary">{{ t('Layers') }} {{ layerLabel }}</summary>
          <div class="pptxv-layer-popover">
            <div class="pptxv-layer-actions">
              <button type="button" class="pptxv-layer-action" @click="showAllLayers">{{ t('All') }}</button>
              <button type="button" class="pptxv-layer-action" @click="hideAllLayers">{{ t('None') }}</button>
            </div>
            <label v-for="layer in previewLayers" :key="layer.id" class="pptxv-layer-row">
              <input
                type="checkbox"
                :checked="activeLayerIds.has(layer.id)"
                @change="toggleLayer(layer.id, $event)"
              />
              <span class="pptxv-layer-color" :style="{ backgroundColor: layer.color ?? '#9aa8b8' }" />
              <span class="pptxv-layer-name">{{ layer.name }}</span>
            </label>
          </div>
        </details>
      </div>
      <div class="pptxv-toolbar-group">
        <button type="button" class="pptxv-button" data-action="zoom-out" :disabled="!canZoomOut" :aria-label="t('Zoom out')" @click="zoomOut">-</button>
        <span class="pptxv-status pptxv-zoom-status">{{ scaleLabel }}</span>
        <button type="button" class="pptxv-button" data-action="zoom-in" :disabled="!canZoomIn" :aria-label="t('Zoom in')" @click="zoomIn">+</button>
        <template v-if="toolbar !== 'minimal'">
        <button type="button" class="pptxv-button" :disabled="isLoading || !previewState.capabilities.fit" @click="fitContain">
          {{ t('Fit') }}
        </button>
        <button type="button" class="pptxv-button" :disabled="isLoading || !previewState.capabilities.fit" @click="fitWidth">
          {{ t('Width') }}
        </button>
        <button type="button" class="pptxv-button" :disabled="isLoading || !previewState.capabilities.fit" @click="fitHeight">
          {{ t('Height') }}
        </button>
        <button type="button" class="pptxv-button" :disabled="!canRotate" @click="rotateClockwise">{{ t('Rotate') }}</button>
        </template>
        <button type="button" class="pptxv-button" data-action="fullscreen" :disabled="!canFullscreen" @click="toggleFullscreen">{{ t('Full') }}</button>
      </div>
    </div>

    <div class="pptxv-layout">
      <section
        v-if="previewState.family === 'model3d'"
        v-show="modelToolsExpanded"
        :id="modelToolsId"
        class="pptxv-model-tools"
        :aria-label="t('Model tools')"
        @keydown.esc.stop.prevent="closeModelTools"
      >
        <header class="pptxv-model-tools-header">
          <strong>{{ t('Model tools') }}</strong>
          <button type="button" class="pptxv-model-icon-button" :aria-label="t('Hide model tools')" @click="closeModelTools">
            <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true"><path d="m5 5 10 10M15 5 5 15" /></svg>
          </button>
        </header>
        <div class="pptxv-model-tabs" role="tablist" :aria-label="t('Model tools')" @keydown="onModelTabKeydown">
          <button v-for="tab in modelToolTabs" :id="`${modelToolsId}-${tab.id}-tab`" :key="tab.id" type="button" role="tab"
            :aria-selected="modelToolTab === tab.id" :aria-controls="`${modelToolsId}-${tab.id}`" :tabindex="modelToolTab === tab.id ? 0 : -1"
            @click="modelToolTab = tab.id">{{ t(tab.label) }}</button>
        </div>
        <div class="pptxv-model-tools-body">
          <div v-show="modelToolTab === 'view'" :id="`${modelToolsId}-view`" role="tabpanel" :aria-labelledby="`${modelToolsId}-view-tab`" class="pptxv-model-tab-panel">
            <label v-if="canControlModelCamera" class="pptxv-model-field">
              <span>{{ t('View') }}</span>
              <select :aria-label="t('View')" :value="model3dViewPreset" @change="setModelViewPreset(($event.target as HTMLSelectElement).value as typeof model3dViewPreset)">
                <option value="free">{{ t('Free') }}</option>
                <option v-for="preset in modelViewPresets" :key="preset.id" :value="preset.id">{{ t(preset.label) }}</option>
              </select>
            </label>
            <div v-if="canControlModelCamera" class="pptxv-model-segmented" :aria-label="t('View')">
              <button type="button" :aria-pressed="model3dProjection === 'perspective'" @click="setModelProjection('perspective')">{{ t('Persp') }}</button>
              <button type="button" :aria-pressed="model3dProjection === 'orthographic'" @click="setModelProjection('orthographic')">{{ t('Ortho') }}</button>
            </div>
            <label v-if="canControlModelDisplay" class="pptxv-model-field">
              <span>{{ t('Display') }}</span>
              <select :aria-label="t('Display')" :value="model3dDisplayMode" @change="setModelDisplayMode(($event.target as HTMLSelectElement).value as PreviewDisplayMode)">
                <option v-for="mode in modelDisplayModes" :key="mode" :value="mode">{{ displayModeLabel(mode) }}</option>
              </select>
            </label>
            <div class="pptxv-model-view-actions">
              <div class="pptxv-model-zoom">
                <button type="button" class="pptxv-model-icon-button" :aria-label="t('Zoom out')" :disabled="!canZoomOut" @click="zoomOut">−</button>
                <output class="pptxv-status pptxv-zoom-status">{{ scaleLabel }}</output>
                <button type="button" class="pptxv-model-icon-button" :aria-label="t('Zoom in')" :disabled="!canZoomIn" @click="zoomIn">+</button>
              </div>
              <button type="button" class="pptxv-button" :disabled="!canFullscreen" @click="toggleFullscreen">{{ t('Full') }}</button>
            </div>
            <button type="button" class="pptxv-button pptxv-model-reset" :disabled="!canControlModelCamera" @click="resetModelView">{{ t('Reset view') }}</button>
          </div>
          <div v-show="modelToolTab === 'structure'" :id="`${modelToolsId}-structure`" role="tabpanel" :aria-labelledby="`${modelToolsId}-structure-tab`" class="pptxv-model-tab-panel">
            <template v-if="showModel3dTree">
              <div class="pptxv-tree-search">
                <input v-model.trim="model3dTreeQuery" type="search" class="pptxv-tree-search-input" :placeholder="t('Search nodes, kinds, materials')" :aria-label="t('Search nodes, kinds, materials')" />
                <button v-if="hasModel3dTreeQuery" type="button" class="pptxv-model-icon-button" :aria-label="t('Clear')" @click="clearModelTreeSearch">×</button>
              </div>
              <div class="pptxv-model-tree-caption">
                <span>{{ t('Model tree') }} · {{ hasModel3dTreeQuery ? `${model3dTreeMatchCount} / ` : '' }}{{ model3dTreeTotalCount }}</span>
                <button type="button" @click="showAllModelNodes">{{ t('Show all') }}</button>
              </div>
              <div class="pptxv-tree-list">
                <div
                  v-for="node in model3dTreeRows"
                  :key="node.id"
                  class="pptxv-tree-row"
                  :style="{ paddingLeft: `${8 + node.depth * 14}px` }"
                >
                  <button
                    v-if="node.children.length"
                    type="button"
                    class="pptxv-tree-toggle"
                    :aria-label="node.collapsed ? t('Expand node') : t('Collapse node')"
                    @click="toggleModelNodeCollapsed(node.id)"
                  >
                    {{ node.collapsed ? '+' : '-' }}
                  </button>
                  <span v-else class="pptxv-tree-spacer" />
                  <input
                    type="checkbox"
                    class="pptxv-tree-visibility"
                    :checked="node.visible"
                    :aria-label="node.visible ? t('Hide node') : t('Show node')"
                    @click.stop
                    @change="setModelNodeVisibility(node.id, $event)"
                  />
                  <button
                    type="button"
                    class="pptxv-tree-button"
                    :class="{ 'is-active': selectedModelNodeId === node.id, 'is-hidden': !node.visible }"
                    @click="selectModelNode(node.id)"
                  >
                    <div class="pptxv-tree-topline">
                      <span class="pptxv-tree-label">{{ node.label }}</span>
                      <span v-if="node.children.length" class="pptxv-tree-count">{{ node.children.length }}</span>
                    </div>
                  </button>
                </div>
              </div>
              <div v-if="showModel3dTreeEmpty" class="pptxv-tree-empty">{{ t('No nodes matched the current filter.') }}</div>
              <div v-if="selectedModelNodeRow" class="pptxv-model-selection">
                <strong>{{ selectedModelNodeRow.label }}</strong>
                <button type="button" class="pptxv-button" @click="refocusSelectedModelNode">{{ t('Refocus') }}</button>
              </div>
              <div v-if="canExplodeModel" class="pptxv-tree-explode">
                <label :for="`${modelToolsId}-explode`">{{ t('Explode') }}</label>
                <input :id="`${modelToolsId}-explode`" type="range" min="0" max="100" step="1" class="pptxv-tree-explode-slider" :value="model3dExplodePercent" @input="setModelExplode($event)" />
                <output>{{ model3dExplodePercent }}%</output>
              </div>
            </template>
            <p v-else class="pptxv-model-muted">{{ isLoading ? t('Loading model...') : t('No model tree available.') }}</p>
            <details class="pptxv-model-disclosure">
              <summary>{{ t('Model info') }}</summary>
              <dl v-if="showModel3dMetadata" class="pptxv-meta-list">
                <div v-for="row in model3dMetadataRows" :key="row.label" class="pptxv-meta-row"><dt>{{ t(row.label) }}</dt><dd>{{ row.value }}</dd></div>
              </dl>
              <p v-else class="pptxv-model-muted">{{ t('No model metadata available.') }}</p>
              <dl v-if="selectedModelNodeSummary.length" class="pptxv-tree-detail-list">
                <div v-for="row in selectedModelNodeSummary" :key="row.label" class="pptxv-tree-detail-row"><dt>{{ t(row.label) }}</dt><dd>{{ row.value }}</dd></div>
              </dl>
            </details>
            <details v-if="model3dMaterialDetails.length" class="pptxv-model-disclosure">
              <summary>{{ t(model3dMaterialHeading) }} <span>{{ model3dMaterialCountLabel }}</span></summary>
              <button v-if="activeModelMaterialKey" type="button" class="pptxv-button" @click="toggleActiveMaterial(undefined)">{{ t('Clear isolate') }}</button>
            <div v-if="model3dMaterialDetails.length" class="pptxv-material-list">
              <section
                v-for="material in model3dMaterialDetails"
                :key="material.key"
                class="pptxv-material-card"
                :class="{ 'is-active': activeModelMaterialKey === material.key }"
              >
                <div class="pptxv-material-title">
                  <div class="pptxv-material-title-copy">
                    <strong>{{ material.name || material.type }}</strong>
                    <span>{{ material.type }}</span>
                  </div>
                  <div v-if="materialColorSwatches(material).length" class="pptxv-material-swatches">
                    <span
                      v-for="swatch in materialColorSwatches(material)"
                      :key="swatch.label"
                      class="pptxv-material-swatch"
                      :title="`${swatch.label}: ${swatch.color}`"
                      :style="{ backgroundColor: swatch.color }"
                    />
                  </div>
                </div>
                <div class="pptxv-material-actions">
                  <button
                    type="button"
                    class="pptxv-button pptxv-material-action"
                    @click="toggleActiveMaterial(material.key)"
                  >
                    {{ materialActionLabel(material) }}
                  </button>
                </div>
                <details class="pptxv-model-material-properties"><summary>{{ t('Model info') }}</summary><dl class="pptxv-material-detail-list">
                  <div
                    v-for="row in materialDetailRows(material)"
                    :key="row.label"
                    class="pptxv-material-detail-row"
                  >
                    <dt>{{ t(row.label) }}</dt>
                    <dd>{{ row.value }}</dd>
                  </div>
                </dl></details>
              </section>
            </div>
            </details>
          </div>
          <div v-show="modelToolTab === 'tools'" :id="`${modelToolsId}-tools`" role="tabpanel" :aria-labelledby="`${modelToolsId}-tools-tab`" class="pptxv-model-tab-panel">
            <details v-if="canMeasureModel" class="pptxv-model-disclosure" :class="{ 'has-active-tool': isModelMeasurementActive }">
              <summary>{{ t('Measurement') }}</summary>
              <div class="pptxv-model-tool-actions">
                <button type="button" class="pptxv-button" :aria-pressed="isModelMeasurementActive" @click="toggleModelMeasurement">{{ t('Measure') }}</button>
                <button type="button" class="pptxv-button" :disabled="!hasModelMeasurement" @click="clearModelMeasurement">{{ t('Clear') }}</button>
              </div>
              <template v-if="isModelMeasurementActive || hasModelMeasurement">
                <label class="pptxv-model-field"><span>{{ t('Snap') }}</span>
                  <select :aria-label="t('Snap')" :value="model3dMeasurementSnapMode" @change="setModelMeasurementSnapMode(($event.target as HTMLSelectElement).value as 'surface' | 'vertex')">
                    <option value="surface">{{ t('Surface') }}</option><option value="vertex">{{ t('Vertex') }}</option>
                  </select>
                </label>
                <label class="pptxv-model-field"><span>{{ t('Axis') }}</span>
                  <select :aria-label="t('Axis')" :value="model3dMeasurementAxisLock" @change="setModelMeasurementAxisLock(($event.target as HTMLSelectElement).value as 'free' | 'x' | 'y' | 'z')">
                    <option value="free">{{ t('Free') }}</option><option v-for="axis in ['x', 'y', 'z']" :key="axis" :value="axis">{{ axis.toUpperCase() }}</option>
                  </select>
                </label>
                <dl class="pptxv-meta-list">
                  <div v-for="row in model3dMeasurementRows.filter(row => !['Snap','Axis'].includes(row.label))" :key="row.label" class="pptxv-meta-row"><dt>{{ t(row.label) }}</dt><dd>{{ row.value }}</dd></div>
                </dl>
              </template>
            </details>
            <details v-if="canSectionModel" class="pptxv-model-disclosure" :class="{ 'has-active-tool': isModelSectionActive }">
              <summary>{{ t('Section') }}</summary>
              <div class="pptxv-model-tool-actions">
                <button type="button" class="pptxv-button" :aria-pressed="isModelSectionActive" @click="toggleModelSection">{{ t('Section') }}</button>
                <button type="button" class="pptxv-button" :disabled="!isModelSectionActive" @click="clearModelSection">{{ t('Reset cut') }}</button>
              </div>
              <template v-if="isModelSectionActive">
                <label class="pptxv-model-field"><span>{{ t('Mode') }}</span>
                  <select :aria-label="t('Mode')" :value="model3dSectionMode" @change="setModelSectionMode(($event.target as HTMLSelectElement).value as 'single' | 'box')"><option value="single">{{ t('Plane') }}</option><option value="box">{{ t('Box') }}</option></select>
                </label>
                <label v-if="model3dSectionMode === 'single'" class="pptxv-model-field"><span>{{ t('Axis') }}</span>
                  <select :aria-label="t('Axis')" :value="model3dSectionAxis" @change="setModelSectionAxis(($event.target as HTMLSelectElement).value as 'x' | 'y' | 'z')"><option v-for="axis in ['x', 'y', 'z']" :key="axis" :value="axis">{{ axis.toUpperCase() }}</option></select>
                </label>
                <div v-if="model3dSectionMode === 'single'" class="pptxv-measurement-group">
                  <label class="pptxv-section-header" :for="`${modelToolsId}-offset`"><span>{{ t('Offset') }}</span><output>{{ formatCompactNumber(model3dSectionOffset) }}</output></label>
                  <input :id="`${modelToolsId}-offset`" type="range" class="pptxv-section-slider" :min="model3dSectionMin" :max="model3dSectionMax" :step="model3dSectionStep" :value="model3dSectionOffset" @input="setModelSectionOffset($event)" />
                </div>
                <div v-else class="pptxv-section-box">
                  <div v-for="axis in ['x', 'y', 'z'] as const" :key="axis" class="pptxv-measurement-group">
                    <div class="pptxv-section-header"><span>{{ t('Box') }} {{ axis.toUpperCase() }}</span><output>{{ formatRange(model3dSectionRange[axis]) }}</output></div>
                    <input v-for="(side, index) in ['min', 'max'] as const" :key="side" type="range" class="pptxv-section-slider" :aria-label="`${t('Box')} ${axis.toUpperCase()} ${side}`"
                      :min="model3dSectionBounds[axis][0]" :max="model3dSectionBounds[axis][1]" :step="Math.max((model3dSectionBounds[axis][1] - model3dSectionBounds[axis][0]) / 200, 0.001)"
                      :value="model3dSectionRange[axis][index]" @input="setModelSectionRange(axis, side, $event)" />
                  </div>
                </div>
              </template>
            </details>
            <details v-if="canDownloadSnapshot" class="pptxv-model-disclosure">
              <summary>{{ t('Snapshot') }}</summary>
              <label class="pptxv-model-field"><span>{{ t('Snapshot bg') }}</span>
                <select :aria-label="t('Snapshot bg')" :value="model3dSnapshotBackground" @change="setModelSnapshotBackground(($event.target as HTMLSelectElement).value as PreviewSnapshotBackground)">
                  <option v-for="background in ['scene', 'white', 'transparent'] as const" :key="background" :value="background">{{ snapshotBackgroundLabel(background) }}</option>
                </select>
              </label>
              <button type="button" class="pptxv-button pptxv-model-reset" @click="downloadModelSnapshot">{{ t('Snapshot') }} · PNG ↓</button>
            </details>
          </div>
        </div>
      </section>
      <div class="pptxv-main">
        <div class="pptxv-main-stage">
          <div ref="viewerHost" class="pptxv-main-view" />
          <button
            v-if="previewState.family === 'model3d'"
            v-show="!modelToolsExpanded"
            type="button"
            class="pptxv-button pptxv-model-tools-toggle"
            :aria-label="modelToolsExpanded ? t('Hide model tools') : t('Show model tools')"
            :title="modelToolsExpanded ? t('Hide model tools') : t('Show model tools')"
            :aria-expanded="modelToolsExpanded"
            :aria-controls="modelToolsId"
            @click="toggleModelTools"
          >
            <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true">
              <path d="M3 5h14M3 10h14M3 15h14" /><path d="M7 3v4m6 1v4m-5 1v4" />
            </svg>
          </button>
          <div v-if="passwordRequest" class="pptxv-overlay">
            <form class="pptxv-password-form" :aria-labelledby="passwordId + '-title'" @submit.prevent="submitPassword" @keydown.esc.stop="cancelPassword">
              <h2 :id="passwordId + '-title'">{{ t('Document is encrypted') }}</h2>
              <p v-if="passwordRequest.name" class="pptxv-password-filename">{{ passwordRequest.name }}</p>
              <p>{{ t('Enter the password to open this document.') }}</p>
              <p v-if="passwordRequest.reason === 'password_invalid'" :id="passwordId + '-error'" class="pptxv-password-error" role="alert">{{ t('Incorrect password. Please try again.') }}</p>
              <label :for="passwordId">{{ t('Document password') }}</label>
              <input :id="passwordId" ref="passwordField" v-model="passwordInput" type="password" autocomplete="off" :aria-invalid="passwordRequest.reason === 'password_invalid'" :aria-describedby="passwordRequest.reason === 'password_invalid' ? passwordId + '-error' : undefined" />
              <div class="pptxv-password-actions">
                <button type="button" class="pptxv-button" @click="cancelPassword">{{ t('Cancel') }}</button>
                <button type="submit" class="pptxv-button" :disabled="!passwordInput.length">{{ t('Open document') }}</button>
              </div>
            </form>
          </div>
          <div v-else-if="isLoading" class="pptxv-overlay">{{ t('Loading preview...') }}</div>
          <div v-else-if="errorMessage" class="pptxv-overlay is-error">
            <div v-if="passwordCancelled" class="pptxv-password-form"><p>{{ t('Opening cancelled.') }}</p><button type="button" class="pptxv-button" @click="loadSource">{{ t('Enter password again') }}</button></div>
            <template v-else>{{ errorMessage }}</template>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>
