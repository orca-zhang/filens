// Original model geometry, authored for Filens. No external meshes or textures.
import {
  BoxGeometry, BufferGeometry, CatmullRomCurve3, CylinderGeometry,
  ExtrudeGeometry, Float32BufferAttribute, Group, LatheGeometry, Mesh,
  MeshStandardMaterial, Path, Shape, SphereGeometry, TorusGeometry,
  TubeGeometry, Vector2, Vector3
} from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';

const materials = new Map();
const geometries = new Map();
const palette = {
  steel: '#99acbb', dark: '#293b49', silver: '#c7d4dc', brass: '#d3a34d',
  orange: '#e99035', cream: '#eee6d5', rubber: '#25303b', teal: '#398c91',
  blue: '#527e9e', red: '#ca5946'
};
function cached(key, create) {
  if (!geometries.has(key)) geometries.set(key, create());
  return geometries.get(key);
}
function material(color, metalness = .25) {
  const key = `${color}:${metalness}`;
  if (!materials.has(key)) materials.set(key, new MeshStandardMaterial({
    color, metalness, roughness: metalness > .5 ? .36 : .56
  }));
  return materials.get(key);
}
function mesh(parent, name, geometry, color, position = [0, 0, 0], rotation = [0, 0, 0], scale = [1, 1, 1], metalness) {
  const object = new Mesh(geometry, material(palette[color] ?? color, metalness));
  object.name = name;
  object.position.set(...position); object.rotation.set(...rotation); object.scale.set(...scale);
  parent.add(object);
  return object;
}
function box(parent, name, size, position, color, rotation = [0, 0, 0], round = true) {
  const radius = Math.min(...size) * .13;
  const geometry = cached(`box:${size}:${round}`, () => round
    ? new RoundedBoxGeometry(...size, 2, radius) : new BoxGeometry(...size));
  return mesh(parent, name, geometry, color, position, rotation);
}
function sphere(parent, name, size, position, color) {
  return mesh(parent, name, cached('sphere', () => new SphereGeometry(1, 28, 18)), color,
    position, [0, 0, 0], size, .08);
}
function cylinder(parent, name, radius, length, position, color, rotation = [0, 0, 0], segments = 40) {
  return mesh(parent, name, cached(`cylinder:${radius}:${length}:${segments}`, () =>
    new CylinderGeometry(radius, radius, length, segments)), color, position, rotation);
}
function ring(parent, name, radius, tube, position, color, rotation = [0, 0, 0]) {
  return mesh(parent, name, cached(`ring:${radius}:${tube}`, () => new TorusGeometry(radius, tube, 10, 56)), color, position, rotation);
}
function beam(parent, name, from, to, radius, color) {
  const a = new Vector3(...from), b = new Vector3(...to), direction = b.clone().sub(a);
  const object = cylinder(parent, name, radius, direction.length(), a.clone().add(b).multiplyScalar(.5).toArray(), color);
  object.quaternion.setFromUnitVectors(new Vector3(0, 1, 0), direction.normalize());
  return object;
}
function link(parent, name, from, to, width, depth, color) {
  const a = new Vector3(...from), b = new Vector3(...to), direction = b.clone().sub(a);
  const object = box(parent, name, [width, direction.length(), depth], a.clone().add(b).multiplyScalar(.5).toArray(), color);
  object.quaternion.setFromUnitVectors(new Vector3(0, 1, 0), direction.normalize());
  return object;
}
function hose(parent, name, points, radius, color, segments = 48) {
  return mesh(parent, name, new TubeGeometry(new CatmullRomCurve3(points.map(p => new Vector3(...p))), segments, radius, 8, false), color);
}
function bolts(parent, name, count, radius, y, boltRadius = 1.7) {
  for (let i = 0; i < count; i++) {
    const a = i * Math.PI * 2 / count;
    cylinder(parent, `${name}_${i + 1}`, boltRadius, 2.5, [Math.cos(a) * radius, y, Math.sin(a) * radius], 'silver', [0, 0, 0], 6);
  }
}
function extrusion(shape, thickness, bevel = .3) {
  const geometry = new ExtrudeGeometry(shape, { depth: thickness, bevelEnabled: bevel > 0,
    bevelSize: bevel, bevelThickness: bevel, bevelSegments: 1, curveSegments: 48, steps: 1 });
  geometry.translate(0, 0, -thickness / 2);
  return geometry;
}
function annulus(outer, inner, thickness, holes = []) {
  const shape = new Shape(); shape.absarc(0, 0, outer, 0, Math.PI * 2, false);
  const hole = new Path(); hole.absarc(0, 0, inner, 0, Math.PI * 2, true); shape.holes.push(hole);
  for (const [x, y, r] of holes) {
    const cut = new Path(); cut.absarc(x, y, r, 0, Math.PI * 2, true); shape.holes.push(cut);
  }
  return extrusion(shape, thickness);
}
function gear(teeth, radius, thickness, bore) {
  const shape = new Shape();
  for (let i = 0; i < teeth * 4; i++) {
    const angle = (i + .5) * Math.PI * 2 / (teeth * 4);
    const r = radius + ([1, 2].includes(i % 4) ? 1.5 : -1.1);
    const x = Math.cos(angle) * r, y = Math.sin(angle) * r;
    if (i === 0) shape.moveTo(x, y); else shape.lineTo(x, y);
  }
  shape.closePath();
  const hole = new Path(); hole.absarc(0, 0, bore, 0, Math.PI * 2, true); shape.holes.push(hole);
  return extrusion(shape, thickness, .2);
}
function model(name) { const root = new Group(); root.name = name; return root; }

export function planetaryGearbox() {
  const root = model('Open planetary gearbox');
  mesh(root, 'Mounting_flange_with_bolt_holes', annulus(54, 9, 5,
    Array.from({ length: 8 }, (_, i) => [48 * Math.cos(i * Math.PI / 4), 48 * Math.sin(i * Math.PI / 4), 2.8])),
  'dark', [0, 0, 0], [-Math.PI / 2, 0, 0]);
  // A toothed internal ring, with all three planet gears visible from above.
  const shape = new Shape(); shape.absarc(0, 0, 46, 0, Math.PI * 2, false);
  const inside = new Path();
  for (let i = 0; i < 72 * 4; i++) {
    const angle = -i * Math.PI * 2 / (72 * 4), radius = [1, 2].includes(i % 4) ? 35 : 38;
    const x = Math.cos(angle) * radius, y = Math.sin(angle) * radius;
    if (!i) inside.moveTo(x, y); else inside.lineTo(x, y);
  }
  inside.closePath(); shape.holes.push(inside);
  mesh(root, 'Internal_ring_72_teeth', extrusion(shape, 17, .15), 'steel', [0, 11, 0], [-Math.PI / 2, 0, 0]);
  mesh(root, 'Sun_gear_24_teeth', gear(24, 12, 15, 4), 'brass', [0, 11, 0], [-Math.PI / 2, .06, 0]);
  cylinder(root, 'Drive_shaft', 3.9, 38, [0, 12, 0], 'silver');
  for (let i = 0; i < 3; i++) {
    const a = i * Math.PI * 2 / 3, p = [24 * Math.cos(a), 11, 24 * Math.sin(a)];
    mesh(root, `Planet_${i + 1}_24_teeth`, gear(24, 12, 13, 3), 'orange', p, [-Math.PI / 2, 0, a]);
    cylinder(root, `Planet_${i + 1}_axle`, 2.9, 24, [p[0], 14, p[2]], 'silver');
    ring(root, `Planet_${i + 1}_bearing`, 4.4, .8, [p[0], 18.5, p[2]], 'dark', [Math.PI / 2, 0, 0]);
    beam(root, `Carrier_arm_${i + 1}`, [0, 25, 0], [p[0], 25, p[2]], 2.2, 'blue');
  }
  ring(root, 'Outer_seal', 44.5, 1.15, [0, 21, 0], 'rubber', [Math.PI / 2, 0, 0]);
  bolts(root, 'Flange_bolt', 8, 48, 4, 2.2);
  cylinder(root, 'Top_output_hub', 7, 5, [0, 26, 0], 'blue');
  return root;
}

function vane(phase) {
  const positions = [], indices = [], rows = 22, columns = 5;
  const vertex = (side, u, v) => {
    const radius = 13 + u * 43;
    const angle = phase + u * .9 + v * .24 + side * .65 / radius;
    return [radius * Math.cos(angle), 4 + v * (25 - u * 12), radius * Math.sin(angle)];
  };
  for (let side = 0; side < 2; side++) for (let u = 0; u <= rows; u++) for (let v = 0; v <= columns; v++) {
    positions.push(...vertex(side ? 1 : -1, u / rows, v / columns));
  }
  const stride = columns + 1, layer = (rows + 1) * stride;
  const quad = (a, b, c, d) => indices.push(a, b, d, b, c, d);
  for (let i = 0; i < rows; i++) for (let j = 0; j < columns; j++) {
    const a = i * stride + j, b = a + stride;
    quad(a, a + 1, b + 1, b); quad(a + layer, b + layer, b + layer + 1, a + layer + 1);
  }
  for (let i = 0; i < rows; i++) {
    const a = i * stride, b = a + stride;
    quad(a, b, b + layer, a + layer);
    quad(a + columns, a + columns + layer, b + columns + layer, b + columns);
  }
  for (let j = 0; j < columns; j++) {
    quad(j, j + layer, j + layer + 1, j + 1);
    const a = rows * stride + j; quad(a, a + 1, a + layer + 1, a + layer);
  }
  const geometry = new BufferGeometry(); geometry.setAttribute('position', new Float32BufferAttribute(positions, 3));
  geometry.setIndex(indices); geometry.computeVertexNormals(); return geometry;
}
export function impeller() {
  const root = model('Centrifugal impeller with curved vanes');
  mesh(root, 'Perforated_back_plate', annulus(60, 9, 4, Array.from({ length: 8 }, (_, i) =>
    [50 * Math.cos(i * Math.PI / 4), 50 * Math.sin(i * Math.PI / 4), 2.5])), 'steel', [0, 1, 0], [-Math.PI / 2, 0, 0]);
  mesh(root, 'Hollow_tapered_hub', new LatheGeometry([
    new Vector2(9, 1), new Vector2(15, 1), new Vector2(15, 5), new Vector2(12, 28),
    new Vector2(10, 31), new Vector2(9, 31), new Vector2(9, 1)
  ], 64), 'silver');
  for (let i = 0; i < 9; i++) mesh(root, `Curved_vane_${i + 1}`, vane(i * Math.PI * 2 / 9), 'steel');
  ring(root, 'Machined_outer_lip', 58.5, 1.3, [0, 3, 0], 'silver', [Math.PI / 2, 0, 0]);
  ring(root, 'Hub_shoulder', 12.3, 1.1, [0, 24, 0], 'silver', [Math.PI / 2, 0, 0]);
  return root;
}

export function rover() {
  const root = model('Trail rover original off-road toy');
  box(root, 'Ladder_chassis', [48, 7, 86], [0, 18, 0], 'dark');
  for (const x of [-18, 18]) box(root, `Frame_rail_${x}`, [4, 8, 92], [x, 15, 0], 'steel');
  box(root, 'Body_shell', [48, 15, 71], [0, 29, 0], 'teal');
  box(root, 'Hood', [46, 5, 26], [0, 39, 29], 'teal');
  box(root, 'Front_grille', [36, 12, 3], [0, 31, 44], 'dark');
  for (let i = -4; i <= 4; i++) box(root, `Grille_slot_${i}`, [1.5, 9, 1.2], [i * 3.4, 31, 46], 'silver', [0, 0, 0], false);
  for (const x of [-20, 20]) {
    sphere(root, `Headlamp_${x}`, [5.2, 5.2, 2.3], [x, 35, 45], 'cream');
    box(root, `Rear_lamp_${x}`, [5, 6, 2], [x, 31, -38], 'red');
    box(root, `Front_fender_${x}`, [14, 4, 29], [x * 1.22, 32, 30], 'dark');
    box(root, `Rear_fender_${x}`, [14, 4, 29], [x * 1.22, 32, -30], 'dark');
  }
  box(root, 'Front_bumper', [64, 5, 7], [0, 22, 48], 'dark');
  cylinder(root, 'Winch_drum', 4, 19, [0, 26, 49], 'steel', [0, 0, Math.PI / 2]);
  for (const side of [-1, 1]) {
    const x = side * 32;
    for (const z of [-29, 29]) {
      const wheel = new Group(); wheel.name = `Wheel_${side}_${z}`; wheel.position.set(x, 15, z); root.add(wheel);
      cylinder(wheel, 'Rubber_tire', 15, 12, [0, 0, 0], 'rubber', [0, 0, Math.PI / 2], 48);
      ring(wheel, 'Outer_tire_shoulder', 12, 3.2, [side * 5, 0, 0], 'rubber', [0, Math.PI / 2, 0]);
      cylinder(wheel, 'Alloy_hub', 8.2, 13, [0, 0, 0], 'cream', [0, 0, Math.PI / 2], 24);
      cylinder(wheel, 'Hub_cap', 3.1, 14, [0, 0, 0], 'orange', [0, 0, Math.PI / 2], 12);
      for (let i = 0; i < 24; i++) {
        const a = i * Math.PI / 12;
        box(wheel, `Tread_${i}`, [13, 3.3, 3.8], [0, Math.sin(a) * 14.4, Math.cos(a) * 14.4], 'rubber', [-a, 0, side * .12], false);
      }
      for (let i = 0; i < 6; i++) {
        const a = i * Math.PI / 3;
        cylinder(wheel, `Lug_${i}`, .9, 14, [0, Math.sin(a) * 5.5, Math.cos(a) * 5.5], 'steel', [0, 0, Math.PI / 2], 6);
      }
      const coil = Array.from({ length: 121 }, (_, i) => {
        const t = i / 120, a = t * Math.PI * 12;
        return [side * 22 + Math.cos(a) * 3, 14 + t * 17, z + Math.sin(a) * 3];
      });
      hose(root, `Suspension_spring_${side}_${z}`, coil, .7, 'red', 120);
    }
    const axleX = side * 23;
    beam(root, `Cab_A_pillar_${side}`, [axleX, 35, 15], [side * 20, 58, -1], 1.8, 'dark');
    beam(root, `Cab_B_pillar_${side}`, [axleX, 35, -31], [side * 20, 58, -27], 1.8, 'dark');
    beam(root, `Roof_rail_${side}`, [side * 20, 58, -1], [side * 20, 58, -27], 1.8, 'dark');
    box(root, `Seat_${side}`, [15, 14, 5], [side * 11, 40, -16], 'rubber', [-.15, 0, 0]);
    box(root, `Seat_cushion_${side}`, [15, 4, 16], [side * 11, 34, -9], 'rubber');
    box(root, `Side_mirror_${side}`, [5, 6, 4], [side * 27, 46, 13], 'dark');
  }
  box(root, 'Roof_panel', [46, 3, 32], [0, 59, -13], 'orange');
  box(root, 'Windscreen', [38, 18, 1.3], [0, 47, 8], 'blue', [-.6, 0, 0]);
  box(root, 'Rear_cargo_crate', [25, 12, 15], [0, 43, -34], 'cream');
  for (const x of [-8, 8]) box(root, `Cargo_strap_${x}`, [2, 13, 16], [x, 43, -34], 'dark');
  cylinder(root, 'Rear_spare_tire', 13, 9, [0, 37, -46], 'rubber', [Math.PI / 2, 0, 0]);
  cylinder(root, 'Spare_wheel_hub', 7, 10, [0, 37, -46], 'cream', [Math.PI / 2, 0, 0]);
  return root;
}

export function orbitalBot() {
  const root = model('Orbital bot original collectible');
  cylinder(root, 'Display_plinth', 39, 5, [0, 2.5, 0], 'teal', [0, 0, 0], 72);
  ring(root, 'Plinth_rim', 35, .7, [0, 5, 0], 'brass', [Math.PI / 2, 0, 0]);
  for (const side of [-1, 1]) {
    const x = side * 11;
    box(root, `Boot_${side}`, [18, 13, 29], [x, 12, 5], 'orange');
    cylinder(root, `Ankle_${side}`, 6.8, 14, [x, 25, 0], 'dark');
    for (let i = 0; i < 3; i++) ring(root, `Ankle_bellows_${side}_${i}`, 6.7, .8, [x, 21 + i * 3, 0], 'steel', [Math.PI / 2, 0, 0]);
  }
  box(root, 'Suit_body', [38, 42, 29], [0, 53, 0], 'cream');
  box(root, 'Utility_belt', [39, 5, 31], [0, 36, 0], 'dark');
  box(root, 'Belt_buckle', [9, 6, 2], [0, 36, 17], 'orange');
  cylinder(root, 'Neck_seal', 12, 7, [0, 77, 0], 'dark');
  sphere(root, 'Helmet_shell', [27, 24, 23], [0, 100, 0], 'cream');
  sphere(root, 'Visor_glass', [23, 16, 9], [0, 101, 18], 'dark');
  const rim = ring(root, 'Helmet_visor_rim', 21, 1.5, [0, 101, 20], 'orange'); rim.scale.y = .73;
  for (const x of [-8, 8]) sphere(root, `Friendly_eye_${x}`, [2.8, 4.4, 1.5], [x, 103, 26.4], '#7de3df');
  hose(root, 'Smile', [[-5, 95, 26], [0, 93, 27], [5, 95, 26]], .8, 'cream', 20);
  box(root, 'Chest_instrument_panel', [25, 16, 3], [0, 58, 15.5], 'dark');
  box(root, 'Status_display', [14, 6, 1], [-2, 61, 17.6], 'teal');
  for (let i = 0; i < 3; i++) sphere(root, `Panel_button_${i}`, [1.6, 1.6, .8], [-7 + i * 6, 54, 18], ['orange', 'cream', 'red'][i]);
  box(root, 'Life_support_pack', [29, 30, 16], [0, 58, -22], 'dark');
  for (const side of [-1, 1]) {
    cylinder(root, `Oxygen_tank_${side}`, 6, 32, [side * 13, 59, -25], 'orange');
    ring(root, `Tank_band_${side}`, 6.2, .7, [side * 13, 61, -25], 'steel', [Math.PI / 2, 0, 0]);
    cylinder(root, `Helmet_earpiece_${side}`, 8.5, 6, [side * 26, 100, 0], 'orange', [0, 0, Math.PI / 2]);
    cylinder(root, `Earpiece_center_${side}`, 4.4, 7, [side * 27, 100, 0], 'dark', [0, 0, Math.PI / 2]);
    sphere(root, `Shoulder_${side}`, [8.4, 9, 9], [side * 24, 65, 0], 'orange');
  }
  beam(root, 'Antenna', [-18, 118, -3], [-24, 137, -3], 1.3, 'steel');
  sphere(root, 'Antenna_tip', [3, 3, 3], [-24, 137, -3], 'orange');
  beam(root, 'Resting_upper_arm', [-24, 62, 0], [-33, 47, 3], 5.7, 'cream');
  sphere(root, 'Resting_elbow', [5.5, 5.5, 5.5], [-33, 47, 3], 'dark');
  beam(root, 'Resting_forearm', [-33, 47, 3], [-31, 35, 8], 5.5, 'cream');
  sphere(root, 'Resting_glove', [6.6, 8, 6.8], [-31, 33, 8], 'orange');
  beam(root, 'Waving_upper_arm', [24, 65, 0], [37, 63, 0], 5.7, 'cream');
  sphere(root, 'Waving_elbow', [6, 6, 6], [37, 63, 0], 'dark');
  beam(root, 'Waving_forearm', [37, 63, 0], [43, 83, 2], 5.5, 'cream');
  sphere(root, 'Waving_mitten', [7.2, 10, 6], [44, 91, 2], 'orange');
  sphere(root, 'Waving_thumb', [4, 5, 4], [36, 89, 4], 'orange');
  hose(root, 'Life_support_hose', [[-16, 44, -23], [-28, 53, -20], [-34, 81, -12], [-26, 93, -1]], 2, 'steel');
  return root;
}

export function industrialArm() {
  const root = model('Six-axis industrial arm and gripper');
  cylinder(root, 'Foot_flange', 34, 7, [0, 3.5, 0], 'dark', [0, 0, 0], 64);
  bolts(root, 'Foundation_bolt', 8, 27, 8, 2.2);
  cylinder(root, 'Rotary_base', 22, 18, [0, 16, 0], 'orange');
  ring(root, 'Base_bearing', 22, 1.5, [0, 23, 0], 'steel', [Math.PI / 2, 0, 0]);
  const joints = [[0, 32, 0], [-15, 80, 0], [33, 109, 0], [60, 99, 0]];
  link(root, 'Upper_arm_casting', joints[0], joints[1], 20, 22, 'orange');
  link(root, 'Forearm_casting', joints[1], joints[2], 16, 19, 'orange');
  link(root, 'Wrist_link', joints[2], joints[3], 11, 13, 'dark');
  for (let j = 0; j < joints.length; j++) {
    const [x, y, z] = joints[j], r = [15, 14, 11, 8][j];
    cylinder(root, `Joint_${j + 1}_housing`, r, 28 - j * 4, [x, y, z], 'orange', [Math.PI / 2, 0, 0]);
    for (const side of [-1, 1]) {
      const depth = side * (15 - j * 2);
      cylinder(root, `Joint_${j + 1}_cover_${side}`, r * .76, 2, [x, y, depth], 'dark', [Math.PI / 2, 0, 0]);
      cylinder(root, `Joint_${j + 1}_center_${side}`, r * .25, 2.8, [x, y, depth], 'steel', [Math.PI / 2, 0, 0]);
      for (let i = 0; i < 6; i++) {
        const a = i * Math.PI / 3;
        cylinder(root, `Joint_${j + 1}_bolt_${side}_${i}`, .95, 3, [x + Math.cos(a) * r * .6, y + Math.sin(a) * r * .6, depth], 'silver', [Math.PI / 2, 0, 0], 6);
      }
    }
  }
  hose(root, 'Flexible_cable_loom', [[-11, 20, -16], [-27, 48, -17], [-27, 83, -16], [7, 118, -15], [36, 119, -13], [62, 102, -10]], 2.6, 'rubber', 72);
  hose(root, 'Control_air_line', [[-9, 20, -21], [-23, 48, -21], [-23, 83, -21], [7, 122, -19], [40, 120, -16], [64, 100, -13]], 1, 'blue', 72);
  cylinder(root, 'Tool_flange', 8, 9, [68, 99, 0], 'steel', [0, 0, Math.PI / 2]);
  box(root, 'Pneumatic_gripper_body', [14, 16, 15], [79, 99, 0], 'dark');
  for (const side of [-1, 1]) {
    box(root, `Gripper_slide_${side}`, [6, 6, 17], [86, 99 + side * 6, 0], 'steel');
    box(root, `Gripper_finger_${side}`, [16, 4, 5], [94, 99 + side * 8, 0], 'silver');
    box(root, `Gripper_pad_${side}`, [4, 5, 6], [100, 99 + side * 5, 0], 'rubber');
  }
  return root;
}

export function fox() {
  const root = model('Sleepy fox original vinyl-style figurine');
  const base = cylinder(root, 'Oval_display_base', 32, 4, [0, 2, 0], 'teal', [0, 0, 0], 64); base.scale.z = .8;
  sphere(root, 'Body', [17, 25, 15], [0, 29, 0], 'orange');
  sphere(root, 'Cream_chest', [12, 20, 7], [0, 29, 11], 'cream');
  sphere(root, 'Large_fox_head', [28, 24, 21], [0, 67, 0], 'orange');
  for (const side of [-1, 1]) {
    sphere(root, `Muzzle_${side}`, [12, 9, 8], [side * 8, 61, 17], 'cream');
    sphere(root, `Eye_${side}`, [2.4, 3.3, 1.7], [side * 13, 74, 18.1], 'dark');
    sphere(root, `Eye_highlight_${side}`, [.7, .9, .4], [side * 13 - .5, 75.3, 19.5], '#ffffff');
    sphere(root, `Forepaw_${side}`, [6.8, 10, 7], [side * 10, 12, 13], 'dark');
    const ear = new Shape(); ear.moveTo(side * 9, 83); ear.lineTo(side * 30, 108); ear.quadraticCurveTo(side * 36, 80, side * 23, 75); ear.closePath();
    mesh(root, `Pointed_ear_${side}`, extrusion(ear, 9, 1.7), 'orange', [0, 0, -1]);
    const inset = new Shape(); inset.moveTo(side * 15, 84); inset.lineTo(side * 28, 100); inset.lineTo(side * 25, 81); inset.closePath();
    mesh(root, `Inner_ear_${side}`, extrusion(inset, 1, .4), 'cream', [0, 0, 5.5]);
  }
  sphere(root, 'Nose', [4.3, 3, 3.2], [0, 65, 25], 'dark');
  hose(root, 'Mouth', [[-4, 57, 23], [0, 55.5, 25], [4, 57, 23]], .55, 'dark', 16);
  ring(root, 'Collar', 12.5, 1.6, [0, 46, 3], 'teal', [Math.PI / 2, 0, 0]);
  sphere(root, 'Collar_tag', [3, 4, 1], [0, 43, 16], 'brass');
  hose(root, 'Curled_tail', [[-10, 13, -9], [-29, 17, -14], [-34, 32, -17], [-25, 41, -18]], 10, 'orange');
  sphere(root, 'Cream_tail_tip', [11, 10, 10], [-24, 41, -18], 'cream');
  return root;
}

export function heatExchanger() {
  const root = model('Cutaway shell-and-tube heat exchanger');
  for (const x of [-61, 61]) {
    const holes = [];
    for (let i = -2; i <= 2; i++) for (let j = -2; j <= 2; j++) if (i * i + j * j <= 6) holes.push([i * 11, j * 11, 3.7]);
    const sheet = new Shape(); sheet.absarc(0, 0, 39, 0, Math.PI * 2, false);
    for (const [y, z, r] of holes) { const cut = new Path(); cut.absarc(y, z, r, 0, Math.PI * 2, true); sheet.holes.push(cut); }
    mesh(root, `Drilled_tube_sheet_${x}`, extrusion(sheet, 5, .2), 'steel', [x, 47, 0], [0, Math.PI / 2, 0]);
    mesh(root, `End_flange_${x}`, annulus(46, 37, 5), 'dark', [x * 1.07, 47, 0], [0, Math.PI / 2, 0]);
    for (let i = 0; i < 12; i++) {
      const a = i * Math.PI / 6;
      cylinder(root, `Flange_bolt_${x}_${i}`, 2, 9, [x * 1.07, 47 + Math.sin(a) * 42, Math.cos(a) * 42], 'silver', [0, 0, Math.PI / 2], 6);
    }
  }
  for (let i = -2; i <= 2; i++) for (let j = -2; j <= 2; j++) if (i * i + j * j <= 6) {
    beam(root, `Copper_tube_${i}_${j}`, [-67, 47 + j * 11, i * 11], [67, 47 + j * 11, i * 11], 3.4, 'brass');
  }
  // Partial cylindrical shell leaves the tube bundle visible from above.
  const shell = new CylinderGeometry(39.5, 39.5, 119, 56, 1, true, Math.PI * .15, Math.PI * 1.05);
  mesh(root, 'Cutaway_outer_shell', shell, 'blue', [0, 47, 0], [0, 0, Math.PI / 2]);
  for (const x of [-39, 39]) {
    box(root, `Support_saddle_${x}`, [11, 18, 47], [x, 16, 0], 'dark');
    box(root, `Mounting_foot_${x}`, [23, 5, 64], [x, 4, 0], 'steel');
  }
  return root;
}

export const modelRecipes = [
  { id: 'centrifugal-impeller', file: 'centrifugal-impeller.stl', format: 'stl', make: impeller },
  { id: 'trail-rover', file: 'trail-rover.obj', format: 'obj', make: rover },
  { id: 'orbital-bot', file: 'orbital-bot.glb', format: 'glb', make: orbitalBot },
  { id: 'industrial-arm', file: 'industrial-arm.gltf', format: 'gltf', make: industrialArm },
  { id: 'sleepy-fox', file: 'sleepy-fox.ply', format: 'ply', make: fox },
  { id: 'planetary-gearbox', file: 'planetary-gearbox.3mf', format: '3mf', make: planetaryGearbox },
  { id: 'heat-exchanger', file: 'heat-exchanger.vtk', format: 'vtk', make: heatExchanger }
];
