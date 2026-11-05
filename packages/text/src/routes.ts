import { DEFAULT_FORMAT_ROUTES, type FormatDefinition } from '@filens/core/preview-runtime';
import { createEbookPreviewRoutes } from '@filens/books/routes';

const TEXT_DRIVER_IDS = new Set(['text', 'html']);
const TEXT_CORE_ROUTES = DEFAULT_FORMAT_ROUTES.filter((route) => TEXT_DRIVER_IDS.has(route.driverId));

export function createTextPreviewRoutes(baseRoutes = TEXT_CORE_ROUTES): FormatDefinition[] {
  return createEbookPreviewRoutes(baseRoutes);
}
