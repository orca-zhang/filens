import './style.css';

import {
  DEFAULT_FORMAT_ROUTES,
  createImagePreviewDriver,
  type FormatDefinition,
  type PreviewDriver,
  type ConverterClient
} from '@filens/core';
import { createPanoramaPreviewDriver, createPanoramaPreviewRoutes, createRawImagePreviewDriver, RAW_IMAGE_FORMAT_ROUTES, type PanoramaProcessor } from '@filens/panorama';
import type { BrowserMediaOptions } from './engine';
export type { BrowserMediaOptions } from './engine';
import { createCodecPreviewDrivers, HEIF_PREVIEW_ROUTES } from './codec-preview-driver';

const MEDIA_DRIVER_IDS = new Set(['image', 'media']);
const MEDIA_CORE_ROUTES = DEFAULT_FORMAT_ROUTES.filter((route) =>
  MEDIA_DRIVER_IDS.has(route.driverId) && !route.extensions.some(extension => ['apk', 'ipa'].includes(extension))
);

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

export function createMediaPreviewRoutes(baseRoutes = MEDIA_CORE_ROUTES, options: { rawPreview?: boolean } = {}): FormatDefinition[] {
  const routes = [...HEIF_PREVIEW_ROUTES, ...createPanoramaPreviewRoutes(baseRoutes)];
  return options.rawPreview ? [...RAW_IMAGE_FORMAT_ROUTES, ...routes.map((route) => ({
    ...route, extensions: route.extensions.filter((extension) => extension !== 'dng')
  })).filter((route) => route.extensions.length > 0)] : routes;
}
