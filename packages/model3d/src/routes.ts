import { createDefaultPreviewRoutes, type FormatDefinition } from '@filens/core/preview-runtime';

export const MODEL3D_FORMAT_ROUTES: FormatDefinition[] = [
  {
    extensions: ['step', 'stp', 'stl', 'obj', 'ply', 'gltf', 'glb', '3mf', 'amf', 'dae', 'fbx', '3ds', 'usdz', 'gcode', 'gco', 'nc', 'wrl', 'vrml', 'pcd', 'xyz', 'vtk', 'vox', 'ldr', 'mpd', 'kmz', 'md2', 'lwo', 'bvh', 'pdb', 'nrrd', 'nhdr'],
    family: 'model3d',
    driverId: 'model3d',
    targetFormat: 'model3d',
    contentTypes: [
      'model/stl',
      'model/step',
      'application/step',
      'application/x-step',
      'model/x.stl-ascii',
      'model/x.stl-binary',
      'application/vnd.ms-pki.stl',
      'model/obj',
      'model/ply',
      'application/ply',
      'model/gltf+json',
      'model/gltf-binary',
      'model/3mf',
      'model/amf',
      'application/x-amf',
      'model/vnd.collada+xml',
      'application/vnd.collada+xml',
      'model/fbx',
      'model/3ds',
      'model/vnd.usdz+zip',
      'model/usd',
      'text/x-gcode',
      'model/vrml',
      'x-world/x-vrml',
      'application/vnd.pointcloud',
      'model/vtk',
      'application/vnd.vtk',
      'model/vox',
      'application/x-magica-voxel',
      'model/vnd.ldraw',
      'text/vnd.ldraw',
      'application/x-ldraw',
      'application/vnd.google-earth.kmz',
      'application/vnd.google-earth.kmz+xml',
      'model/md2',
      'application/x-md2',
      'model/lwo',
      'application/x-lwo',
      'application/x-lightwave-object',
      'application/bvh',
      'application/x-bvh',
      'chemical/x-pdb',
      'chemical/pdb',
      'application/nrrd',
      'application/x-nrrd',
      'application/vnd.ms-package.3dmanufacturing-3dmodel+xml'
    ]
  }
];

const extensions = new Set(MODEL3D_FORMAT_ROUTES.flatMap(route => route.extensions));

export function createModel3dPreviewRoutes(baseRoutes = createDefaultPreviewRoutes()): FormatDefinition[] {
  return [
    ...MODEL3D_FORMAT_ROUTES,
    ...baseRoutes.filter((route) => !route.extensions.some((extension) => extensions.has(extension)))
  ];
}
