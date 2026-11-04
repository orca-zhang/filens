# Original 3D model samples

Copyright (c) 2026 FiLens contributors. These original model assets, thumbnails,
and their generation scripts are distributed under the project's [MIT license](LICENSE.txt).
No downloaded meshes, textures, brand logos, licensed characters, or model packs
were used. The toys are original generic vehicle, robot and animal designs.
The industrial assemblies illustrate construction and file-format features.

| Native file | Model and details |
| --- | --- |
| `flanged-bearing.step` | 62 validated B-rep solids: drilled mounting base, bored housing, races, 28 rollers, retaining flanges, keyed shaft and hardware. |
| `centrifugal-impeller.stl` | Curved swept vanes, hollow tapered hub and drilled backplate; binary STL. |
| `trail-rover.obj` | Original off-road toy with tread blocks, wheels, suspension coils, roll cage, seats, lights, grille and spare tire; embedded vertex colors and normals. |
| `orbital-bot.glb` | Original space robot figurine with waving arm, facial details, antenna, tanks, hoses and display base; named components and PBR materials. |
| `industrial-arm.gltf` | Articulated arm with joint housings, bolts, flexible cable loom, air line and gripper; named components and PBR materials. |
| `sleepy-fox.ply` | Original fox figurine with pointed ears, muzzle, eyes, paws, collar and curled tail; vertex colors and normals. |
| `planetary-gearbox.3mf` | Open planetary gearbox with toothed ring, sun and planet gears, bearings and carrier; multiple native objects and base materials. |
| `heat-exchanger.vtk` | Cutaway shell-and-tube assembly with drilled tube sheets, tube bundle, flanges, bolts and saddles; ASCII POLYDATA. |

Every model is self-contained; the OBJ needs no MTL, the glTF buffer is embedded,
and none of the models require external textures. `manifest.json` records the
generated mesh/triangle counts, or solid count for STEP. Mesh models contain
11,544–42,272 nondegenerate triangles.

Regenerate from the repository root:

```sh
node scripts/generate-model-showcase.mjs
python3 -m venv /tmp/filens-cad-assets
/tmp/filens-cad-assets/bin/pip install cadquery-ocp-novtk==7.8.1.1.post1
/tmp/filens-cad-assets/bin/python scripts/generate-industrial-step.py
# With the Vite demo server running on port 4173:
node scripts/capture-model-samples.mjs
```

Three.js and JSZip use their existing project dependencies. The isolated OCP
environment is an offline authoring tool; it is not included in the application
or used for runtime conversion. Thumbnails and `home/model.webp` are captured
from the actual frontend model previewer using Playwright.
