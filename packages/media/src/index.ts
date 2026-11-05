import './style.css';

import {
  createImagePreviewDriver,
  type PreviewDriver,
  type ConverterClient
} from '@filens/core';
import { createPanoramaPreviewDriver, createRawImagePreviewDriver, type PanoramaProcessor } from '@filens/panorama';
import type { BrowserMediaOptions } from './engine';
export type { BrowserMediaOptions } from './engine';
import { createCodecPreviewDrivers } from './codec-preview-driver';

export interface MediaPreviewDriverOptions {
  panoramaProcessor?: PanoramaProcessor;
  converter?: ConverterClient;
  mediaConverter?: ConverterClient;
  /** Native first, then local MP4/MOV recovery. Never calls mediaConverter for video. */
  browserMedia?: boolean | BrowserMediaOptions;
}

export function createMediaPreviewDrivers(options: MediaPreviewDriverOptions = {}): PreviewDriver[] {
  return [
    createImagePreviewDriver(), ...createCodecPreviewDrivers(options.mediaConverter, options.browserMedia), createPanoramaPreviewDriver({ processor: options.panoramaProcessor }),
    ...(options.converter ? [createRawImagePreviewDriver({ processor: options.panoramaProcessor, converter: options.converter })] : [])
  ];
}

export { createMediaPreviewRoutes } from './routes';
