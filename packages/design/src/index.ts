import './style.css';

import type { PreviewDriver } from '@filens/core';
import { createCadPreviewDriver } from '@filens/cad';
import { createDiagramPreviewDriver } from '@filens/diagram';
import { createMindmapPreviewDriver } from '@filens/mindmap';
import { createModel3dPreviewDriver } from '@filens/model3d';

export function createDesignPreviewDrivers(): PreviewDriver[] {
  return [
    createCadPreviewDriver(),
    createDiagramPreviewDriver(),
    createMindmapPreviewDriver(),
    createModel3dPreviewDriver()
  ];
}

export { createDesignPreviewRoutes } from './routes';
