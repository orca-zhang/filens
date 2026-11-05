import { DEFAULT_FORMAT_ROUTES, type FormatDefinition } from '@filens/core/preview-runtime';
import { createDocxPreviewRoutes } from '@filens/docx/routes';
import { createIworkPreviewRoutes } from '@filens/iwork/routes';
import { createPdfPreviewRoutes } from '@filens/pdf/routes';
import { createXlsxPreviewRoutes } from '@filens/xlsx/routes';

const OFFICE_DRIVER_IDS = new Set(['pptx', 'pdf', 'docx', 'xlsx']);
const OFFICE_CORE_ROUTES = DEFAULT_FORMAT_ROUTES.filter((route) => OFFICE_DRIVER_IDS.has(route.driverId));

export function createOfficePreviewRoutes(baseRoutes = OFFICE_CORE_ROUTES): FormatDefinition[] {
  return createIworkPreviewRoutes(
    createPdfPreviewRoutes(createDocxPreviewRoutes(createXlsxPreviewRoutes(baseRoutes)))
  );
}
