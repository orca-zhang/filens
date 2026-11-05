import { createDefaultPreviewRoutes, type FormatDefinition } from '@filens/core/preview-runtime';

export const XLSX_FORMAT_ROUTES: FormatDefinition[] = [
  {
    extensions: ['xlsx'],
    family: 'workbook',
    driverId: 'xlsx',
    targetFormat: 'xlsx'
  },
  {
    extensions: ['csv'],
    family: 'workbook',
    driverId: 'xlsx',
    targetFormat: 'csv',
    contentTypes: ['text/csv', 'application/csv']
  }
];

export function createXlsxPreviewRoutes(baseRoutes = createDefaultPreviewRoutes()): FormatDefinition[] {
  return [
    ...XLSX_FORMAT_ROUTES,
    ...baseRoutes.filter((route) => !route.extensions.some((extension) => extension === 'xlsx' || (extension === 'csv' && !route.conversion?.required)))
  ];
}
