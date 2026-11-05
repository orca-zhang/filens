import { createDefaultPreviewRoutes, type FormatDefinition } from '@filens/core/preview-runtime';

export const PANORAMA_FORMAT_ROUTES: FormatDefinition[] = [
  {
    extensions: ['pano', 'panorama', '360', 'insp'],
    family: 'panorama',
    driverId: 'panorama',
    targetFormat: 'pano',
    contentTypes: ['image/panorama', 'image/x-panorama', 'image/x-insta360', 'application/vnd.filens.panorama+image']
  },
  {
    extensions: ['360v', 'vr360', 'insv', 'osv'],
    family: 'panorama-video',
    driverId: 'panorama',
    targetFormat: '360v',
    contentTypes: ['video/panorama', 'video/x-panorama', 'video/x-insta360', 'video/x-osmo360', 'application/vnd.filens.panorama+video']
  }
];

export function createPanoramaPreviewRoutes(baseRoutes = createDefaultPreviewRoutes()): FormatDefinition[] {
  const extensions = new Set(PANORAMA_FORMAT_ROUTES.flatMap((route) => route.extensions));
  return [...PANORAMA_FORMAT_ROUTES, ...baseRoutes.filter((route) => !route.extensions.some((extension) => extensions.has(extension)))];
}

export const RAW_IMAGE_FORMAT_ROUTES: FormatDefinition[] = [{
  extensions: ['dng'], family: 'image', driverId: 'raw-image', targetFormat: 'jpg',
  contentTypes: ['image/dng', 'image/x-adobe-dng']
}];
