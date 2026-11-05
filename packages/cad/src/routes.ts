import { createDefaultPreviewRoutes, type FormatDefinition } from '@filens/core/preview-runtime';

export const CAD_FORMAT_ROUTES: FormatDefinition[] = [
  {
    extensions: ['cad-json'], family: 'cad', driverId: 'cad', targetFormat: 'cad-json',
    contentTypes: ['application/vnd.filens.cad+json']
  },
  {
    extensions: ['dxf'],
    family: 'cad',
    driverId: 'cad',
    targetFormat: 'dxf',
    contentTypes: ['image/vnd.dxf', 'application/dxf', 'application/x-dxf']
  }
];

export function createCadPreviewRoutes(baseRoutes = createDefaultPreviewRoutes()): FormatDefinition[] {
  return [
    ...CAD_FORMAT_ROUTES,
    ...baseRoutes.filter((route) => !route.extensions.some((extension) => ['dxf', 'cad-json'].includes(extension)))
  ];
}
