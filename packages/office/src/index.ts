import './style.css';

import {
  createPptxPreviewDriver,
  type PreviewDriver
} from '@filens/core';
import { createDocxPreviewDriver } from '@filens/docx';
import { createIworkPreviewDriver } from '@filens/iwork';
import { createPdfPreviewDriver } from '@filens/pdf';
import { createXlsxPreviewDriver } from '@filens/xlsx';

export function createOfficePreviewDrivers(): PreviewDriver[] {
  return [
    createPptxPreviewDriver(),
    createPdfPreviewDriver(),
    createDocxPreviewDriver(),
    createXlsxPreviewDriver(),
    createIworkPreviewDriver()
  ];
}

export { createOfficePreviewRoutes } from './routes';
