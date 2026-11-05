import { LoadingManager, type Object3D } from 'three';
import { FBXLoader } from 'three/examples/jsm/loaders/FBXLoader.js';
import type { PreviewResourceResolver } from '@filens/core';
import type { ModelObjectLoadResult } from './preview-driver';
import { resolveModelTextureUrl } from './resource-utils';

export interface LoadFbxObjectOptions {
  resourceBasePath?: string;
  resourcePath?: string;
  resourceResolver?: PreviewResourceResolver;
  sourceFormat?: string;
  signal?: AbortSignal;
}

export function loadFbxObject(source: ArrayBuffer, resourcePath = ''): Object3D {
  return loadFbxObjectWithWarnings(source, { resourcePath }).object;
}

export function loadFbxObjectWithWarnings(
  source: ArrayBuffer,
  options: LoadFbxObjectOptions = {}
): ModelObjectLoadResult {
  const objectUrls: string[] = [];
  const warnings: string[] = [];
  const manager = new LoadingManager();
  if (options.resourceResolver) {
    manager.setURLModifier((url) => resolveModelTextureUrl(url, options, warnings, objectUrls, 'fbx', 'FBX'));
  }
  const object = new FBXLoader(manager).parse(source, options.resourcePath ?? '');
  if (objectUrls.length) {
    object.userData.previewObjectUrls = objectUrls;
  }
  return {
    object,
    warnings
  };
}
