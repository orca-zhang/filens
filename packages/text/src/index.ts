import './style.css';

import {
  createHtmlPreviewDriver,
  createTextPreviewDriver,
  type PreviewDriver
} from '@filens/core';
import { createEbookPreviewDriver } from '@filens/books';

export function createTextPreviewDrivers(): PreviewDriver[] {
  return [createTextPreviewDriver(), createHtmlPreviewDriver(), createEbookPreviewDriver()];
}

export { createTextPreviewRoutes } from './routes';
