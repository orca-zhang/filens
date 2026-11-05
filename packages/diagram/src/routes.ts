import { createDefaultPreviewRoutes, type FormatDefinition } from '@filens/core/preview-runtime';

export const DIAGRAM_FORMAT_ROUTES: FormatDefinition[] = [
  {
    extensions: ['drawio', 'dio', 'vdx', 'vsdx'],
    family: 'diagram',
    driverId: 'diagram',
    targetFormat: 'diagram',
    contentTypes: ['application/vnd.jgraph.mxfile', 'application/vnd.visio']
  }
];

const extensions = new Set(DIAGRAM_FORMAT_ROUTES.flatMap(route => route.extensions));

export function createDiagramPreviewRoutes(baseRoutes = createDefaultPreviewRoutes()): FormatDefinition[] {
  return [
    ...DIAGRAM_FORMAT_ROUTES,
    ...baseRoutes.filter((route) => !route.extensions.some((extension) => extensions.has(extension)))
  ];
}
