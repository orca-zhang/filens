import { createDefaultPreviewRoutes, type FormatDefinition } from '@filens/core/preview-runtime';

export const PDF_FORMAT_ROUTES: FormatDefinition[] = [
  {
    extensions: ['pdf'],
    family: 'paged',
    driverId: 'pdf',
    targetFormat: 'pdf',
    contentTypes: ['application/pdf']
  }
];

export function createPdfPreviewRoutes(baseRoutes = createDefaultPreviewRoutes()): FormatDefinition[] {
  return [
    ...PDF_FORMAT_ROUTES,
    ...baseRoutes.filter((route) => !route.extensions.includes('pdf'))
  ];
}
