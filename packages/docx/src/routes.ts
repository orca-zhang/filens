import { createDefaultPreviewRoutes, type FormatDefinition } from '@filens/core/preview-runtime';

export const DOCX_FORMAT_ROUTES: FormatDefinition[] = [
  {
    extensions: ['docx'],
    family: 'flow',
    driverId: 'docx',
    targetFormat: 'docx'
  }
];

export function createDocxPreviewRoutes(baseRoutes = createDefaultPreviewRoutes()): FormatDefinition[] {
  return [
    ...DOCX_FORMAT_ROUTES,
    ...baseRoutes.filter((route) => !route.extensions.includes('docx'))
  ];
}
