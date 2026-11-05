import { createDefaultPreviewRoutes, type FormatDefinition } from '@filens/core/preview-runtime';

export const IWORK_FORMAT_ROUTES: FormatDefinition[] = [
  {
    extensions: ['key'],
    family: 'paged',
    driverId: 'iwork',
    targetFormat: 'key'
  },
  {
    extensions: ['pages'],
    family: 'paged',
    driverId: 'iwork',
    targetFormat: 'pages'
  },
  {
    extensions: ['numbers'],
    family: 'workbook',
    driverId: 'iwork',
    targetFormat: 'numbers'
  }
];

export function createIworkPreviewRoutes(baseRoutes = createDefaultPreviewRoutes()): FormatDefinition[] {
  const iworkExtensions = new Set(IWORK_FORMAT_ROUTES.flatMap((route) => route.extensions));
  return [
    ...IWORK_FORMAT_ROUTES,
    ...baseRoutes.filter((route) => !route.extensions.some((extension) => iworkExtensions.has(extension)))
  ];
}
