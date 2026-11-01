import { createArchivePreviewRoutes } from '@filens/archive';
import { createDefaultPreviewRoutes, type FormatDefinition } from '@filens/core';
import { createDesignPreviewRoutes } from '@filens/design';
import { createMediaPreviewRoutes } from '@filens/media';
import { createOfficePreviewRoutes } from '@filens/office';
import { createTextPreviewRoutes } from '@filens/text';

export function createVueDefaultPreviewRoutes(options: { rawPreview?: boolean } = {}): FormatDefinition[] {
  const routes = createOfficePreviewRoutes(
    createArchivePreviewRoutes(
      createDesignPreviewRoutes(
        createTextPreviewRoutes(createMediaPreviewRoutes(createDefaultPreviewRoutes(), options))
      )
    )
  );
  // The archive package still exposes APK browsing explicitly; the shared host previews its icon.
  const iconRoutes = createDefaultPreviewRoutes().filter(route =>
    route.conversion?.required && route.extensions.includes('apk')
  );
  return [
    ...iconRoutes,
    ...routes.map(route => ({
      ...route, extensions: route.extensions.filter(extension => extension !== 'apk')
    })).filter(route => route.extensions.length)
  ];
}
