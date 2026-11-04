// Generate original, self-contained 3D demo assets. No runtime converter changes.
// Run this script, then generate-industrial-step.py and capture-model-samples.mjs.
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import JSZip from 'jszip';
import { Matrix3, SRGBColorSpace, Vector3 } from 'three';
import { GLTFExporter } from 'three/examples/jsm/exporters/GLTFExporter.js';
import { STLExporter } from 'three/examples/jsm/exporters/STLExporter.js';
import { modelRecipes } from './model-showcase-geometry.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const output = path.join(root, 'apps/demo/public/samples/models');
await mkdir(output, { recursive: true });

// GLTFExporter uses the browser FileReader interface to package Blob buffers.
globalThis.FileReader ??= class {
  async readAsArrayBuffer(blob) { this.result = await blob.arrayBuffer(); this.onloadend?.(); }
  async readAsDataURL(blob) {
    this.result = `data:${blob.type || 'application/octet-stream'};base64,${Buffer.from(await blob.arrayBuffer()).toString('base64')}`;
    this.onloadend?.();
  }
};
const number = value => Math.abs(value) < .000005 ? '0' : String(Number(value.toFixed(5)));
const vector = values => values.map(number).join(' ');
const escape = text => text.replaceAll('&', '&amp;').replaceAll('"', '&quot;').replaceAll('<', '&lt;');

function collect(object) {
  object.updateMatrixWorld(true);
  const parts = [];
  object.traverse(mesh => {
    if (!mesh.isMesh) return;
    const geometry = mesh.geometry, position = geometry.getAttribute('position'), normal = geometry.getAttribute('normal');
    const normals = new Matrix3().getNormalMatrix(mesh.matrixWorld);
    const color = mesh.material.color.getRGB({}, SRGBColorSpace);
    const vertices = [], directions = [];
    for (let i = 0; i < position.count; i++) {
      vertices.push(new Vector3().fromBufferAttribute(position, i).applyMatrix4(mesh.matrixWorld).toArray());
      directions.push(new Vector3().fromBufferAttribute(normal, i).applyMatrix3(normals).normalize().toArray());
    }
    const indices = geometry.getIndex();
    const faces = [];
    for (let i = 0; i < (indices?.count ?? position.count); i += 3) {
      const face = [0, 1, 2].map(offset => indices ? indices.getX(i + offset) : i + offset);
      const [a, b, c] = face.map(index => new Vector3(...vertices[index]));
      if (b.sub(a).cross(c.sub(a)).lengthSq() > 1e-12) faces.push(face);
    }
    parts.push({ name: mesh.name, vertices, normals: directions, faces, rgb: [color.r, color.g, color.b] });
  });
  return parts;
}
function obj(parts) {
  const lines = ['# Original Filens trail rover toy. MIT license.', '# Embedded vertex colors and normals; no external MTL or textures.'];
  let offset = 1;
  for (const part of parts) {
    lines.push(`o ${part.name.replaceAll(' ', '_')}`, 's 1');
    for (const p of part.vertices) lines.push(`v ${vector([...p, ...part.rgb])}`);
    for (const n of part.normals) lines.push(`vn ${vector(n)}`);
    for (const face of part.faces) lines.push(`f ${face.map(index => `${index + offset}//${index + offset}`).join(' ')}`);
    offset += part.vertices.length;
  }
  return lines.join('\n') + '\n';
}
function ply(parts) {
  const vertices = parts.reduce((sum, p) => sum + p.vertices.length, 0), triangles = parts.reduce((sum, p) => sum + p.faces.length, 0);
  const lines = ['ply', 'format ascii 1.0', 'comment Original Filens fox collectible, MIT license.',
    `element vertex ${vertices}`, 'property float x', 'property float y', 'property float z',
    'property float nx', 'property float ny', 'property float nz',
    'property uchar red', 'property uchar green', 'property uchar blue',
    `element face ${triangles}`, 'property list uchar int vertex_indices', 'end_header'];
  for (const p of parts) for (let i = 0; i < p.vertices.length; i++) {
    lines.push(vector([...p.vertices[i], ...p.normals[i], ...p.rgb.map(value => Math.round(value * 255))]));
  }
  let offset = 0;
  for (const p of parts) { for (const face of p.faces) lines.push(`3 ${face.map(i => i + offset).join(' ')}`); offset += p.vertices.length; }
  return lines.join('\n') + '\n';
}
function vtk(parts) {
  const vertices = parts.flatMap(p => p.vertices), faces = [];
  let offset = 0;
  for (const p of parts) { for (const face of p.faces) faces.push(face.map(i => i + offset)); offset += p.vertices.length; }
  return ['# vtk DataFile Version 3.0', 'Original Filens cutaway heat exchanger - MIT', 'ASCII', 'DATASET POLYDATA',
    `POINTS ${vertices.length} float`, ...vertices.map(vector), `POLYGONS ${faces.length} ${faces.length * 4}`,
    ...faces.map(face => `3 ${face.join(' ')}`), ''].join('\n');
}
async function threeMf(parts) {
  const materials = [], colors = new Map();
  for (const p of parts) {
    const hex = '#' + p.rgb.map(c => Math.round(c * 255).toString(16).padStart(2, '0')).join('').toUpperCase();
    if (!colors.has(hex)) { colors.set(hex, materials.length); materials.push(hex); }
    p.material = colors.get(hex);
  }
  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<model unit="millimeter" xml:lang="en-US" xmlns="http://schemas.microsoft.com/3dmanufacturing/core/2015/02">
<metadata name="Title">Filens open planetary gearbox</metadata><metadata name="Copyright">Filens contributors, MIT license</metadata>
<resources><basematerials id="1">${materials.map((hex, i) => `<base name="Material_${i}" displaycolor="${hex}"/>`).join('')}</basematerials>
${parts.map((p, i) => `<object id="${i + 2}" name="${escape(p.name)}" type="model" pid="1" pindex="${p.material}"><mesh><vertices>${p.vertices.map(v => `<vertex x="${number(v[0])}" y="${number(v[1])}" z="${number(v[2])}"/>`).join('')}</vertices><triangles>${p.faces.map(f => `<triangle v1="${f[0]}" v2="${f[1]}" v3="${f[2]}"/>`).join('')}</triangles></mesh></object>`).join('')}
</resources><build>${parts.map((_, i) => `<item objectid="${i + 2}"/>`).join('')}</build></model>`;
  const zip = new JSZip();
  zip.file('[Content_Types].xml', '<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="model" ContentType="application/vnd.ms-package.3dmanufacturing-3dmodel+xml"/></Types>');
  zip.file('_rels/.rels', '<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Target="/3D/3dmodel.model" Id="rel0" Type="http://schemas.microsoft.com/3dmanufacturing/2013/01/3dmodel"/></Relationships>');
  zip.file('3D/3dmodel.model', xml);
  return zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE', compressionOptions: { level: 9 } });
}

// Preserve the independently generated CAD entry when refreshing the mesh assets.
const previous = JSON.parse(await readFile(path.join(output, 'manifest.json'), 'utf8').catch(() => '[]'));
const manifest = previous.filter(entry => entry.id === 'flanged-bearing');
for (const recipe of modelRecipes) {
  const object = recipe.make(), parts = collect(object);
  const triangles = parts.reduce((sum, p) => sum + p.faces.length, 0);
  if (triangles < 4000) throw new Error(`${recipe.id} should contain detailed geometry, got ${triangles} triangles.`);
  let bytes;
  switch (recipe.format) {
    case 'stl': bytes = Buffer.from(new STLExporter().parse(object, { binary: true }).buffer); break;
    case 'obj': bytes = obj(parts); break;
    case 'ply': bytes = ply(parts); break;
    case 'vtk': bytes = vtk(parts); break;
    case '3mf': bytes = await threeMf(parts); break;
    case 'glb':
    case 'gltf': {
      object.userData = { copyright: 'Filens contributors, MIT license', originalModel: true };
      const result = await new GLTFExporter().parseAsync(object, { binary: recipe.format === 'glb', onlyVisible: true });
      if (recipe.format === 'glb') bytes = Buffer.from(result);
      else { result.asset.copyright = 'Filens contributors, MIT license'; bytes = JSON.stringify(result); }
      break;
    }
    default: throw new Error(`Unknown export format ${recipe.format}`);
  }
  await writeFile(path.join(output, recipe.file), bytes);
  manifest.push({ id: recipe.id, file: recipe.file, meshes: parts.length, triangles,
    vertices: parts.reduce((sum, p) => sum + p.vertices.length, 0), license: 'MIT', original: true });
  console.log(`${recipe.file}: ${parts.length} meshes, ${triangles} triangles`);
}
await writeFile(path.join(output, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
