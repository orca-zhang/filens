import { DEFAULT_FORMAT_ROUTES, type FormatDefinition } from '@filens/core/preview-runtime';
import { RAW_IMAGE_FORMAT_ROUTES } from '@filens/panorama/routes';
import { createPanoramaPreviewRoutes } from '@filens/panorama/routes';

export const HEIF_PREVIEW_ROUTES: FormatDefinition[] = [{
  extensions: ['heic', 'heif'], family: 'image', driverId: 'heif-image',
  contentTypes: ['image/heic', 'image/heif', 'image/heic-sequence', 'image/heif-sequence'], group: 'image'
}];

const MEDIA_DRIVER_IDS = new Set(['image', 'media']);
const MEDIA_CORE_ROUTES = DEFAULT_FORMAT_ROUTES.filter((route) =>
  MEDIA_DRIVER_IDS.has(route.driverId) && !route.extensions.some(extension => ['apk', 'ipa'].includes(extension))
);

export function createMediaPreviewRoutes(baseRoutes = MEDIA_CORE_ROUTES, options: { rawPreview?: boolean } = {}): FormatDefinition[] {
  const routes = [...HEIF_PREVIEW_ROUTES, ...createPanoramaPreviewRoutes(baseRoutes)];
  return options.rawPreview ? [...RAW_IMAGE_FORMAT_ROUTES, ...routes.map((route) => ({
    ...route, extensions: route.extensions.filter((extension) => extension !== 'dng')
  })).filter((route) => route.extensions.length > 0)] : routes;
}
