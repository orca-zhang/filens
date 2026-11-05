import type { FormatDefinition } from '@filens/core/preview-runtime';
import { createCadPreviewRoutes } from '@filens/cad/routes';
import { createDiagramPreviewRoutes } from '@filens/diagram/routes';
import { createMindmapPreviewRoutes } from '@filens/mindmap/routes';
import { createModel3dPreviewRoutes } from '@filens/model3d/routes';

export function createDesignPreviewRoutes(baseRoutes: FormatDefinition[] = []): FormatDefinition[] {
  return createCadPreviewRoutes(
    createDiagramPreviewRoutes(createModel3dPreviewRoutes(createMindmapPreviewRoutes(baseRoutes)))
  );
}
