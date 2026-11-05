import { createLazyCorePreviewDrivers, createLazyPreviewDriver, type PreviewDriver } from '@filens/core/preview-runtime';
import type { MediaPreviewDriverOptions } from '@filens/media';
import { createVueDefaultPreviewRoutes } from './defaults';

/** Register all formats without evaluating their renderers until first use. */
export function createVueDefaultPreviewDrivers(options: MediaPreviewDriverOptions = {}): PreviewDriver[] {
  const routes = createVueDefaultPreviewRoutes({ rawPreview: Boolean(options.converter && options.panoramaProcessor) });
  const lazy = (id: string, family: PreviewDriver['family'], load: () => Promise<PreviewDriver>) => {
    const extensions = new Set(routes.filter(route => route.driverId === id).flatMap(route => route.extensions));
    return createLazyPreviewDriver(id, family, load, format => extensions.has(format.replace(/^\./, '').toLowerCase()));
  };
  const codec = (id: string) => import('@filens/media/codecs').then(({ createCodecPreviewDrivers }) =>
    createCodecPreviewDrivers(options.mediaConverter, options.browserMedia).find(driver => driver.id === id)!);
  return [
    ...createLazyCorePreviewDrivers().filter(driver => driver.id !== 'media'),
    lazy('pdf', 'paged', () => import('@filens/pdf').then(({ createPdfPreviewDriver }) => createPdfPreviewDriver())),
    lazy('docx', 'flow', () => import('@filens/docx').then(({ createDocxPreviewDriver }) => createDocxPreviewDriver())),
    lazy('xlsx', 'workbook', () => import('@filens/xlsx').then(({ createXlsxPreviewDriver }) => createXlsxPreviewDriver())),
    lazy('iwork', 'paged', () => import('@filens/iwork').then(({ createIworkPreviewDriver }) => createIworkPreviewDriver())),
    lazy('cad', 'cad', () => import('@filens/cad').then(({ createCadPreviewDriver }) => createCadPreviewDriver())),
    lazy('diagram', 'diagram', () => import('@filens/diagram').then(({ createDiagramPreviewDriver }) => createDiagramPreviewDriver())),
    lazy('mindmap', 'mindmap', () => import('@filens/mindmap').then(({ createMindmapPreviewDriver }) => createMindmapPreviewDriver())),
    lazy('model3d', 'model3d', () => import('@filens/model3d').then(({ createModel3dPreviewDriver }) => createModel3dPreviewDriver())),
    lazy('archive', 'archive', () => import('@filens/archive').then(({ createArchivePreviewDriver }) => createArchivePreviewDriver())),
    lazy('ebook', 'ebook', () => import('@filens/books').then(({ createEbookPreviewDriver }) => createEbookPreviewDriver())),
    lazy('heif-image', 'image', () => codec('heif-image')),
    lazy('media', 'video', () => codec('media')),
    lazy('panorama', 'panorama', () => import('@filens/panorama').then(({ createPanoramaPreviewDriver }) =>
      createPanoramaPreviewDriver({ processor: options.panoramaProcessor }))),
    ...(options.converter ? [lazy('raw-image', 'image', () => import('@filens/panorama').then(({ createRawImagePreviewDriver }) =>
      createRawImagePreviewDriver({ processor: options.panoramaProcessor, converter: options.converter! })))] : [])
  ];
}
