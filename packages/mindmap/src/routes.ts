import { createDefaultPreviewRoutes, type FormatDefinition } from '@filens/core/preview-runtime';

export const MINDMAP_FORMAT_ROUTES: FormatDefinition[] = [
  {
    extensions: ['mm', 'opml', 'xmind', 'mmap'],
    family: 'mindmap',
    driverId: 'mindmap',
    targetFormat: 'mindmap',
    contentTypes: [
      'text/x-opml',
      'application/x-freemind',
      'application/x-xmind',
      'application/vnd.xmind.workbook',
      'application/x-mindmanager',
      'application/vnd.mindjet.mindmanager'
    ]
  }
];

const extensions = new Set(MINDMAP_FORMAT_ROUTES.flatMap(route => route.extensions));

export function createMindmapPreviewRoutes(baseRoutes = createDefaultPreviewRoutes()): FormatDefinition[] {
  return [
    ...MINDMAP_FORMAT_ROUTES,
    ...baseRoutes.filter((route) => !route.extensions.some((extension) => extensions.has(extension)))
  ];
}
