import { createDefaultNativePreviewDrivers } from './native-drivers';
import { createPptxPreviewDriver } from './pptx-driver';
import type { PreviewDriver } from './types';

/** Eager factory retained for applications creating sessions directly. */
export function createDefaultPreviewDrivers(): PreviewDriver[] {
  return [createPptxPreviewDriver(), ...createDefaultNativePreviewDrivers()];
}
