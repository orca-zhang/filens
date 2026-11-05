/** Preserve dynamic engine imports when the application groups shared vendors. */
export function optionalEngineChunk(id: string): string | undefined {
  const path = id.replaceAll('\\', '/');
  // Shared browser placeholders must not pull an optional engine back into startup.
  if (path.includes('commonjsHelpers') || path.includes('browser-external')) return 'vendor';
  if (path.includes('/node_modules/docx-preview/')) return 'docx-engine';
  if (path.includes('/node_modules/jszip/')) return 'zip-compat';
  if (path.includes('/node_modules/@zip.js/zip.js/')) return 'zip-encrypted';
  if (path.includes('/node_modules/cfb/')) return 'office-attachments';
  if (path === '\0filens:xml-parser' || path.includes('/node_modules/fast-xml-parser/') || path.includes('/node_modules/strnum/')) return 'xml-compat';
  if (path.endsWith('/packages/model3d/src/vrml-loader.ts') ||
      /\/three\/examples\/jsm\/(?:loaders\/VRMLLoader\.js|libs\/chevrotain\.module\.min\.js)(?:$|\?)/.test(path)) return 'model-vrml';
  if (path.endsWith('/packages/model3d/src/fbx-loader.ts') ||
      /\/three\/examples\/jsm\/(?:loaders\/FBXLoader\.js|curves\/NURBS(?:Curve|Utils)\.js)(?:$|\?)/.test(path)) return 'model-fbx';
  if (path.endsWith('/packages/model3d/src/3ds-loader.ts') ||
      /\/three\/examples\/jsm\/loaders\/TDSLoader\.js(?:$|\?)/.test(path)) return 'model-3ds';
  const loader = /\/three\/examples\/jsm\/loaders\/(GLTF|OBJ|MTL|USDZ)Loader\.js(?:$|\?)/.exec(path);
  if (loader) return `model-${loader[1].toLowerCase()}`;
  if (path.endsWith('/packages/model3d/vendor/three/LDrawLoader.js') ||
      path.includes('/three/examples/jsm/materials/LDrawConditionalLineMaterial.js')) return 'model-ldraw';
}
