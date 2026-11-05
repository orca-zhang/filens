import { LoadingManager, type Object3D } from 'three';
import { TDSLoader } from 'three/examples/jsm/loaders/TDSLoader.js';
import type { PreviewResourceResolver } from '@filens/core';
import type { ModelObjectLoadResult } from './preview-driver';
import { resolveModelTextureUrl } from './resource-utils';

export interface Load3dsObjectOptions {
  resourceBasePath?: string;
  resourcePath?: string;
  resourceResolver?: PreviewResourceResolver;
  sourceFormat?: string;
  signal?: AbortSignal;
}

export function load3dsObject(source: ArrayBuffer, resourcePath = ''): Object3D {
  return load3dsObjectWithWarnings(source, { resourcePath }).object;
}

export function load3dsObjectWithWarnings(
  source: ArrayBuffer,
  options: Load3dsObjectOptions = {}
): ModelObjectLoadResult {
  const objectUrls: string[] = [];
  const warnings: string[] = [];
  const manager = new LoadingManager();
  if (options.resourceResolver) {
    manager.setURLModifier((url) => resolveModelTextureUrl(url, options, warnings, objectUrls, '3ds', '3DS'));
  }
  const object = new TDSLoader(manager).parse(source, options.resourcePath ?? '');
  if (objectUrls.length) {
    object.userData.previewObjectUrls = objectUrls;
  }
  return {
    object,
    warnings
  };
}
