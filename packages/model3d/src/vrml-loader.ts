import { LoadingManager, type Object3D } from 'three';
import { VRMLLoader } from 'three/examples/jsm/loaders/VRMLLoader.js';
import type { PreviewResourceResolver } from '@filens/core';
import type { ModelObjectLoadResult } from './preview-driver';
import { resolveModelTextureUrl } from './resource-utils';

export interface LoadVrmlObjectOptions {
  resourceBasePath?: string;
  resourcePath?: string;
  resourceResolver?: PreviewResourceResolver;
  sourceFormat?: string;
  signal?: AbortSignal;
}

export function loadVrmlObject(source: string, resourcePath = ''): Object3D {
  return loadVrmlObjectWithWarnings(source, { resourcePath }).object;
}

export function loadVrmlObjectWithWarnings(
  source: string,
  options: LoadVrmlObjectOptions = {}
): ModelObjectLoadResult {
  const objectUrls: string[] = [];
  const warnings: string[] = [];
  const manager = new LoadingManager();
  if (options.resourceResolver) {
    manager.setURLModifier((url) => resolveModelTextureUrl(url, options, warnings, objectUrls, 'vrml', 'VRML'));
  }
  const object = new VRMLLoader(manager).parse(source, options.resourcePath ?? '');
  if (objectUrls.length) {
    object.userData.previewObjectUrls = objectUrls;
  }
  return {
    object,
    warnings
  };
}
