import { createDefaultPreviewRoutes, type FormatDefinition } from '@filens/core/preview-runtime';

export const EBOOK_FORMAT_ROUTES: FormatDefinition[] = [
  {
    extensions: ['epub'],
    family: 'ebook',
    driverId: 'ebook',
    targetFormat: 'epub',
    contentTypes: ['application/epub+zip']
  },
  {
    extensions: ['cbz'],
    family: 'ebook',
    driverId: 'ebook',
    targetFormat: 'cbz',
    contentTypes: ['application/vnd.comicbook+zip', 'application/x-cbz']
  }
];

export function createEbookPreviewRoutes(baseRoutes = createDefaultPreviewRoutes()): FormatDefinition[] {
  return [
    ...EBOOK_FORMAT_ROUTES,
    ...baseRoutes.filter((route) => !route.extensions.some((extension) => extension === 'epub' || extension === 'cbz'))
  ];
}
