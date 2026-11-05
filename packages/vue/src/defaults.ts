import { createArchivePreviewRoutes } from '@filens/archive/routes';
import { createDefaultPreviewRoutes, type FormatDefinition } from '@filens/core/preview-runtime';
import { createDesignPreviewRoutes } from '@filens/design/routes';
import { createMediaPreviewRoutes } from '@filens/media/routes';
import { createOfficePreviewRoutes } from '@filens/office/routes';
import { createTextPreviewRoutes } from '@filens/text/routes';

export function createVueDefaultPreviewRoutes(options: { rawPreview?: boolean } = {}): FormatDefinition[] {
  return createOfficePreviewRoutes(
    createArchivePreviewRoutes(
      createDesignPreviewRoutes(
        createTextPreviewRoutes(createMediaPreviewRoutes(createDefaultPreviewRoutes(), options))
      )
    )
  );
}
