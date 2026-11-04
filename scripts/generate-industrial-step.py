"""Author a precise B-rep bearing assembly for the demo; no external CAD model.

Requires cadquery-ocp-novtk==7.8.1.1.post1. This is an asset-generation tool,
not an application converter. Run with a Python environment containing OCP.
"""
import json
from math import cos, sin, pi
from pathlib import Path
from OCP.BRep import BRep_Builder
from OCP.BRepAlgoAPI import BRepAlgoAPI_Cut, BRepAlgoAPI_Fuse
from OCP.BRepBuilderAPI import BRepBuilderAPI_MakePolygon, BRepBuilderAPI_MakeFace
from OCP.BRepCheck import BRepCheck_Analyzer
from OCP.BRepPrimAPI import BRepPrimAPI_MakeBox, BRepPrimAPI_MakeCylinder, BRepPrimAPI_MakePrism
from OCP.gp import gp_Ax2, gp_Dir, gp_Pnt, gp_Vec
from OCP.IFSelect import IFSelect_RetDone
from OCP.STEPControl import STEPControl_Writer, STEPControl_AsIs
from OCP.TopoDS import TopoDS_Compound

OUTPUT = Path(__file__).resolve().parents[1] / 'apps/demo/public/samples/models/flanged-bearing.step'
OUTPUT.parent.mkdir(parents=True, exist_ok=True)
parts = []


def box(x, y, z, w, h, d):
    return BRepPrimAPI_MakeBox(gp_Pnt(x, y, z), w, h, d).Shape()


def cylinder(x, y, z, radius, length, direction=(0, 0, 1)):
    return BRepPrimAPI_MakeCylinder(gp_Ax2(gp_Pnt(x, y, z), gp_Dir(*direction)), radius, length).Shape()


def cut(a, b):
    return BRepAlgoAPI_Cut(a, b).Shape()


def add(shape):
    if not BRepCheck_Analyzer(shape).IsValid():
        raise RuntimeError('Invalid generated B-rep')
    parts.append(shape)


# A machined base with four genuine through-holes, raised bearing seat and ribs.
base = box(-70, 0, -42, 140, 14, 84)
for x in [-53, 53]:
    for z in [-28, 28]:
        base = cut(base, cylinder(x, -1, z, 5, 16, (0, 1, 0)))
add(base)
housing = BRepAlgoAPI_Fuse(box(-39, 14, -17, 78, 46, 34), cylinder(0, 60, -17, 39, 34)).Shape()
housing = cut(housing, cylinder(0, 60, -19, 26, 38))
for x in [-29, 29]:
    for y in [37, 83]:
        housing = cut(housing, cylinder(x, y, -19, 3.2, 38))
add(housing)
for x in [-48, 41]:
    for z in [-18, 12]:
        wire = BRepBuilderAPI_MakePolygon()
        for p in [(x, 14, z), (x, 14, z + 6), (x, 52, z + 6)]:
            wire.Add(gp_Pnt(*p))
        wire.Close()
        face = BRepBuilderAPI_MakeFace(wire.Wire()).Face()
        add(BRepPrimAPI_MakePrism(face, gp_Vec(7, 0, 0)).Shape())
# Separate bearing races, rolling elements, retaining flanges and shaft.
for z in [-20, 13]:
    add(cut(cylinder(0, 60, z, 25.8, 7), cylinder(0, 60, z - 1, 20.5, 9)))
    add(cut(cylinder(0, 60, z, 16.5, 7), cylinder(0, 60, z - 1, 12, 9)))
    for i in range(14):
        a = i * pi / 7
        # Rollers are actual cylinders with circular end faces.
        add(cylinder(18.5 * cos(a), 60 + 18.5 * sin(a), z + .8, 1.9, 5.4))
for z in [-26, 22]:
    cap = cut(cylinder(0, 60, z, 36, 4), cylinder(0, 60, z - 1, 12.5, 6))
    for i in range(6):
        a = i * pi / 3
        cap = cut(cap, cylinder(30 * cos(a), 60 + 30 * sin(a), z - 1, 2.4, 6))
    add(cap)
    for i in range(6):
        a = i * pi / 3
        add(cylinder(30 * cos(a), 60 + 30 * sin(a), z - 1, 3.4, 6))
shaft = cylinder(0, 60, -53, 11.8, 106)
shaft = cut(shaft, box(-2, 69, 30, 4, 5, 24))
add(shaft)
add(cylinder(0, 60, 40, 18, 5))
for x in [-53, 53]:
    for z in [-28, 28]:
        add(cylinder(x, 12, z, 7, 2, (0, 1, 0)))
        head = cylinder(x, 14, z, 6, 7, (0, 1, 0))
        add(cut(head, cylinder(x, 18, z, 2.7, 4, (0, 1, 0))))

builder = BRep_Builder()
compound = TopoDS_Compound()
builder.MakeCompound(compound)
for shape in parts:
    builder.Add(compound, shape)
writer = STEPControl_Writer()
writer.Transfer(compound, STEPControl_AsIs)
if writer.Write(str(OUTPUT)) != IFSelect_RetDone:
    raise RuntimeError('STEP export failed')
print(f'Generated {OUTPUT.name}: {len(parts)} valid original B-rep parts.')
manifest_path = OUTPUT.parent / 'manifest.json'
manifest = json.loads(manifest_path.read_text()) if manifest_path.exists() else []
manifest = [entry for entry in manifest if entry['id'] != 'flanged-bearing']
manifest.insert(0, dict(id='flanged-bearing', file=OUTPUT.name, solids=len(parts), license='MIT', original=True))
manifest_path.write_text(json.dumps(manifest, indent=2) + '\n')
