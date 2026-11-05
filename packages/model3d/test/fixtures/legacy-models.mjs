// Deterministic, self-contained tetrahedra for real Three.js loader/render checks.
const vertices = [-1, 0, 1, 1, 0, 1, 0, 0, -1, 0, 2, 0];
const faces = [[0, 2, 1], [0, 1, 3], [1, 2, 3], [2, 0, 3]];

export function createFbxFixture() {
  return new TextEncoder().encode(`; FBX 7.4.0 project file
FBXHeaderExtension:  {
\tFBXHeaderVersion: 1003
\tFBXVersion: 7400
}
Objects:  {
\tGeometry: 1, "Geometry::Tetrahedron", "Mesh" {
\t\tVertices: *12 {
\t\t\ta: ${vertices.join(',')}
\t\t}
\t\tPolygonVertexIndex: *12 {
\t\t\ta: ${faces.flatMap(([a, b, c]) => [a, b, -c - 1]).join(',')}
\t\t}
\t\tLayerElementMaterial: 0 {
\t\t\tVersion: 101
\t\t\tMappingInformationType: "AllSame"
\t\t\tReferenceInformationType: "IndexToDirect"
\t\t\tMaterials: *1 {
\t\t\t\ta: 0
\t\t\t}
\t\t}
\t}
\tModel: 2, "Model::Tetrahedron", "Mesh" {
\t\tVersion: 232
\t\tProperties70:  {
\t\t\tP: "Lcl Translation", "Lcl Translation", "", "A",0.25,0,0
\t\t}
\t}
\tMaterial: 3, "Material::Blue", "" {
\t\tVersion: 102
\t\tShadingModel: "phong"
\t\tProperties70:  {
\t\t\tP: "DiffuseColor", "Color", "", "A",0.2,0.6,0.9
\t\t}
\t}
}
Connections:  {
\tC: "OO",1,2
\tC: "OO",3,2
\tC: "OO",2,0
}
`);
}

export function create3dsFixture() {
  const word = value => { const bytes = Buffer.alloc(2); bytes.writeUInt16LE(value); return bytes; };
  const dword = value => { const bytes = Buffer.alloc(4); bytes.writeUInt32LE(value); return bytes; };
  const float = value => { const bytes = Buffer.alloc(4); bytes.writeFloatLE(value); return bytes; };
  const chunk = (id, ...parts) => {
    const data = Buffer.concat(parts);
    return Buffer.concat([word(id), dword(data.length + 6), data]);
  };
  const material = chunk(0xafff,
    chunk(0xa000, Buffer.from('Blue\0')),
    chunk(0xa020, chunk(0x0011, Buffer.from([51, 153, 230]))));
  const mesh = chunk(0x4100,
    chunk(0x4110, word(vertices.length / 3), ...vertices.map(float)),
    chunk(0x4120, word(faces.length), ...faces.flatMap(face => [...face.map(word), word(7)]),
      chunk(0x4130, Buffer.from('Blue\0'), word(faces.length), ...faces.map((_, index) => word(index)))));
  return new Uint8Array(chunk(0x4d4d, chunk(0x0002, dword(3)),
    chunk(0x3d3d, material, chunk(0x4000, Buffer.from('Tetrahedron\0'), mesh))));
}
