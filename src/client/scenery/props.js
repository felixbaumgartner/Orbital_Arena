// Scenery building blocks. Everything static in a chunk is collected into
// a ChunkBatch and merged per material so a whole village is a handful of
// draw calls instead of hundreds.
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

function rand(seed) {
  const x = Math.sin(seed * 127.1 + 311.7) * 43758.5453;
  return x - Math.floor(x);
}

/**
 * Rewrites a geometry's UVs from world position so a tiling texture stays
 * the same physical size on every object (poor man's triplanar mapping).
 */
export function applyWorldUV(geo, scale) {
  const pos = geo.attributes.position;
  const nrm = geo.attributes.normal;
  const uv = new Float32Array(pos.count * 2);
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i);
    const nx = Math.abs(nrm.getX(i)), ny = Math.abs(nrm.getY(i)), nz = Math.abs(nrm.getZ(i));
    let u, v;
    if (ny >= nx && ny >= nz) { u = x; v = z; }
    else if (nx >= nz) { u = z; v = y; }
    else { u = x; v = y; }
    uv[i * 2] = u / scale;
    uv[i * 2 + 1] = v / scale;
  }
  geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  return geo;
}

/** Triangular-prism gable roof: ridge runs along Z, base sits on y = 0 */
export function gableGeometry(w, h, d, overhang = 0.6) {
  const hw = w / 2 + overhang, hd = d / 2 + overhang;
  const v = [];
  const push = (...pts) => { for (const p of pts) v.push(...p); };
  // Front and back triangles
  push([-hw, 0, hd], [hw, 0, hd], [0, h, hd]);
  push([hw, 0, -hd], [-hw, 0, -hd], [0, h, -hd]);
  // Left slope
  push([-hw, 0, -hd], [-hw, 0, hd], [0, h, hd]);
  push([-hw, 0, -hd], [0, h, hd], [0, h, -hd]);
  // Right slope
  push([hw, 0, hd], [hw, 0, -hd], [0, h, -hd]);
  push([hw, 0, hd], [0, h, -hd], [0, h, hd]);
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(v, 3));
  geo.computeVertexNormals();
  geo.setAttribute('uv', new THREE.BufferAttribute(new Float32Array((v.length / 3) * 2), 2));
  return geo;
}

/** Shared materials for the whole world (never disposed with chunks) */
export function createSharedMaterials(textures) {
  const brick = textures.brick();
  const roof = textures.roofTile();
  const soil = textures.soil();
  const grass = textures.grass();
  const asphalt = textures.asphalt();
  const waterNormal = textures.waterNormal();

  const mats = {
    brick: new THREE.MeshStandardMaterial({ map: brick, vertexColors: true, roughness: 0.92 }),
    roof: new THREE.MeshStandardMaterial({ map: roof, vertexColors: true, roughness: 0.85 }),
    foliage: new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.95 }),
    wood: new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.9 }),
    metal: new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.45, metalness: 0.3 }),
    glow: new THREE.MeshStandardMaterial({
      color: 0x1B1B24, emissive: 0xFFD08A, emissiveIntensity: 0.0, roughness: 0.5,
    }),
    water: new THREE.MeshStandardMaterial({
      color: 0x1F5C8C, roughness: 0.16, metalness: 0.05,
      normalMap: waterNormal, normalScale: new THREE.Vector2(0.45, 0.45),
      transparent: true, opacity: 0.93,
    }),
    soil: new THREE.MeshStandardMaterial({ map: soil, vertexColors: true, roughness: 0.98 }),
    grassPatch: new THREE.MeshStandardMaterial({ map: grass, vertexColors: true, roughness: 0.95 }),
    asphalt: new THREE.MeshStandardMaterial({ map: asphalt, roughness: 0.95 }),
    car: new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.4, metalness: 0.35 }),
  };
  for (const m of Object.values(mats)) m.userData.shared = true;
  return mats;
}

// Bucket -> { uvScale (world units per texture tile) | null, cast, receive }
const BUCKETS = {
  brick: { uvScale: 5, cast: true, receive: true },
  roof: { uvScale: 6, cast: true, receive: true },
  foliage: { uvScale: null, cast: true, receive: true },
  wood: { uvScale: null, cast: true, receive: true },
  metal: { uvScale: null, cast: true, receive: true },
  glow: { uvScale: null, cast: false, receive: false },
  water: { uvScale: 18, cast: false, receive: true },
  soil: { uvScale: 24, cast: false, receive: true },
  grassPatch: { uvScale: 22, cast: false, receive: true },
};

export class ChunkBatch {
  constructor() {
    this.buckets = {};
  }

  /** part: { geo, color, x, y, z, rx, ry, rz, sx, sy, sz } */
  add(bucket, part) {
    if (!this.buckets[bucket]) this.buckets[bucket] = [];
    this.buckets[bucket].push(part);
  }

  build(materials) {
    const meshes = [];
    for (const [bucket, parts] of Object.entries(this.buckets)) {
      if (!parts.length) continue;
      const cfg = BUCKETS[bucket] || { uvScale: null, cast: true, receive: true };
      const needColor = materials[bucket].vertexColors;
      const geos = parts.map(p => {
        const g = p.geo;
        if (p.sx || p.sy || p.sz) g.scale(p.sx || 1, p.sy || 1, p.sz || 1);
        if (p.rx) g.rotateX(p.rx);
        if (p.ry) g.rotateY(p.ry);
        if (p.rz) g.rotateZ(p.rz);
        g.translate(p.x || 0, p.y || 0, p.z || 0);
        if (needColor) {
          const color = new THREE.Color(p.color === undefined ? 0xffffff : p.color);
          const count = g.attributes.position.count;
          const colors = new Float32Array(count * 3);
          for (let i = 0; i < count; i++) {
            colors[i * 3] = color.r;
            colors[i * 3 + 1] = color.g;
            colors[i * 3 + 2] = color.b;
          }
          g.setAttribute('color', new THREE.BufferAttribute(colors, 3));
        }
        if (g.index) return g.toNonIndexed();
        return g;
      });
      const merged = mergeGeometries(geos, false);
      geos.forEach(g => g.dispose());
      if (!merged) continue;
      if (cfg.uvScale) applyWorldUV(merged, cfg.uvScale);
      const mesh = new THREE.Mesh(merged, materials[bucket]);
      mesh.castShadow = cfg.cast;
      mesh.receiveShadow = cfg.receive;
      mesh.userData.bucket = bucket;
      meshes.push(mesh);
    }
    return meshes;
  }
}

// --- Trees -----------------------------------------------------------------

const CANOPY_GREENS = [0x2E7D32, 0x388E3C, 0x33691E, 0x558B2F, 0x2F6B3A, 0x4E8A3C];

/**
 * kinds: 'oak' (round, three-lobed canopy), 'poplar' (tall column, rows
 * along canals and roads), 'willow' (low, wide, drooping)
 */
export function addTree(batch, kind, x, z, scale, seed) {
  const green = CANOPY_GREENS[Math.floor(rand(seed) * CANOPY_GREENS.length)];
  const dark = new THREE.Color(green).multiplyScalar(0.8).getHex();
  const trunkColor = 0x5C4033;

  if (kind === 'poplar') {
    const h = 20 * scale;
    batch.add('wood', { geo: new THREE.CylinderGeometry(0.35 * scale, 0.6 * scale, h * 0.35, 5), color: trunkColor, x, y: h * 0.175, z });
    batch.add('foliage', { geo: new THREE.SphereGeometry(2.6 * scale, 7, 6), color: green, x, y: h * 0.55, z, sy: 3.2 });
    batch.add('foliage', { geo: new THREE.SphereGeometry(1.8 * scale, 6, 5), color: dark, x: x + 0.6, y: h * 0.42, z: z - 0.4, sy: 2.4 });
    return { x, z, radius: 2.8 * scale, topY: h * 1.05 };
  }

  if (kind === 'willow') {
    const h = 6 * scale;
    batch.add('wood', { geo: new THREE.CylinderGeometry(0.9 * scale, 1.4 * scale, h, 6), color: trunkColor, x, y: h / 2, z });
    batch.add('foliage', { geo: new THREE.SphereGeometry(7 * scale, 8, 6), color: 0x7CA84A, x, y: h + 2.5 * scale, z, sy: 0.6 });
    batch.add('foliage', { geo: new THREE.SphereGeometry(5 * scale, 7, 5), color: 0x8DB756, x: x + 2 * scale, y: h + 1.2 * scale, z: z + 1.5 * scale, sy: 0.55 });
    return { x, z, radius: 7 * scale, topY: h + 7 * scale };
  }

  // Oak
  const h = 8 * scale;
  batch.add('wood', { geo: new THREE.CylinderGeometry(0.9 * scale, 1.5 * scale, h, 6), color: trunkColor, x, y: h / 2, z });
  const r = 5.5 * scale;
  batch.add('foliage', { geo: new THREE.SphereGeometry(r, 8, 7), color: green, x, y: h + r * 0.75, z, sy: 0.9 });
  batch.add('foliage', { geo: new THREE.SphereGeometry(r * 0.72, 7, 6), color: dark, x: x + r * 0.6, y: h + r * 0.45, z: z + r * 0.3 });
  batch.add('foliage', { geo: new THREE.SphereGeometry(r * 0.68, 7, 6), color: green, x: x - r * 0.55, y: h + r * 0.55, z: z - r * 0.35 });
  batch.add('foliage', { geo: new THREE.SphereGeometry(r * 0.6, 6, 5), color: dark, x: x + r * 0.1, y: h + r * 1.3, z: z - r * 0.2 });
  return { x, z, radius: r * 1.15, topY: h + r * 1.9 };
}

// --- Houses ----------------------------------------------------------------

const BRICK_TINTS = [0x9C3F32, 0xA95A3C, 0x7A4A38, 0xB86E4E, 0xD8C8B0, 0x8F5B45, 0x6E6E6E];
const ROOF_TINTS = [0x4A4A58, 0x8E3A2A, 0x3E3E48, 0x7A3226, 0x565664];

/**
 * A Dutch brick house: brick body, gabled tile roof, chimney, door and a
 * grid of windows that glow at night. ry rotates the whole thing.
 */
export function addHouse(batch, x, z, w, h, d, ry, seed) {
  const brick = BRICK_TINTS[Math.floor(rand(seed + 1) * BRICK_TINTS.length)];
  const roof = ROOF_TINTS[Math.floor(rand(seed + 2) * ROOF_TINTS.length)];
  const cos = Math.cos(ry), sin = Math.sin(ry);
  // local (lx, lz) -> world, rotated about the house centre
  const world = (lx, lz) => ({ x: x + lx * cos + lz * sin, z: z - lx * sin + lz * cos });

  batch.add('brick', { geo: new THREE.BoxGeometry(w, h, d), color: brick, x, y: h / 2, z, ry });
  const roofH = 3 + rand(seed + 3) * 2.5 + w * 0.18;
  batch.add('roof', { geo: gableGeometry(w, roofH, d), color: roof, x, y: h, z, ry });

  // Chimney
  const cp = world(w * 0.28, 0);
  batch.add('brick', { geo: new THREE.BoxGeometry(1.2, 2.6, 1.2), color: brick, x: cp.x, y: h + roofH * 0.6 + 1, z: cp.z, ry });

  // Windows on front and back faces
  const rows = Math.max(1, Math.floor((h - 1.5) / 3.6));
  const cols = Math.max(1, Math.floor((w - 1) / 3.0));
  const winW = 1.3, winH = 1.9;
  for (const face of [1, -1]) {
    for (let r = 0; r < rows; r++) {
      const wy = 2.2 + r * 3.6;
      for (let c = 0; c < cols; c++) {
        const lx = (c - (cols - 1) / 2) * 3.0;
        if (face === 1 && r === 0 && c === Math.floor(cols / 2)) {
          // Front door instead of a ground-floor middle window
          const dp = world(lx, face * (d / 2 + 0.06));
          batch.add('wood', { geo: new THREE.BoxGeometry(1.4, 2.6, 0.12), color: 0x2B2B2B, x: dp.x, y: 1.3, z: dp.z, ry });
          continue;
        }
        if (rand(seed + 40 + r * 9 + c * 3 + face) < 0.18) continue; // some windows dark/absent
        const p = world(lx, face * (d / 2 + 0.06));
        batch.add('glow', { geo: new THREE.BoxGeometry(winW, winH, 0.12), x: p.x, y: wy, z: p.z, ry });
        // Window frame
        batch.add('wood', { geo: new THREE.BoxGeometry(winW + 0.3, winH + 0.3, 0.08), color: 0xF2EEE6, x: p.x, y: wy, z: p.z, ry });
      }
    }
  }
  return { x, z, radius: Math.max(w, d) / 2 + 1, topY: h + roofH };
}

/** A terrace of houses standing shoulder to shoulder along a street */
export function addTerrace(batch, cx, cz, count, ry, seed) {
  const colliders = [];
  const widths = [];
  let total = 0;
  for (let i = 0; i < count; i++) {
    const w = 7 + rand(seed + i * 11) * 4;
    widths.push(w);
    total += w;
  }
  let offset = -total / 2;
  const cos = Math.cos(ry), sin = Math.sin(ry);
  for (let i = 0; i < count; i++) {
    const w = widths[i];
    const h = 9 + rand(seed + i * 13 + 1) * 6;
    const d = 8 + rand(seed + i * 13 + 2) * 3;
    const lx = offset + w / 2;
    const hx = cx + lx * cos, hz = cz - lx * sin;
    colliders.push(addHouse(batch, hx, hz, w, h, d, ry, seed + i * 101));
    offset += w;
  }
  return colliders;
}

// --- Street furniture --------------------------------------------------------

export function addLamp(batch, x, z) {
  batch.add('metal', { geo: new THREE.CylinderGeometry(0.12, 0.18, 7, 5), color: 0x3A3A40, x, y: 3.5, z });
  batch.add('metal', { geo: new THREE.BoxGeometry(1.4, 0.12, 0.12), color: 0x3A3A40, x: x + 0.6, y: 7, z });
  batch.add('glow', { geo: new THREE.SphereGeometry(0.32, 6, 5), x: x + 1.2, y: 6.85, z });
}

export function addFence(batch, x, z, w, d) {
  const color = 0x8B7355;
  const sides = [
    { px: x, pz: z - d / 2, w, d: 0.25 },
    { px: x, pz: z + d / 2, w, d: 0.25 },
    { px: x - w / 2, pz: z, w: 0.25, d },
    { px: x + w / 2, pz: z, w: 0.25, d },
  ];
  for (const s of sides) {
    batch.add('wood', { geo: new THREE.BoxGeometry(s.w, 0.18, s.d), color, x: s.px, y: 1.1, z: s.pz });
    batch.add('wood', { geo: new THREE.BoxGeometry(s.w, 0.18, s.d), color, x: s.px, y: 0.55, z: s.pz });
  }
  const posts = Math.max(2, Math.floor(Math.max(w, d) / 6));
  for (let i = 0; i <= posts; i++) {
    const t = i / posts - 0.5;
    batch.add('wood', { geo: new THREE.BoxGeometry(0.3, 1.4, 0.3), color: 0x6E5638, x: x + t * w, y: 0.7, z: z - d / 2 });
    batch.add('wood', { geo: new THREE.BoxGeometry(0.3, 1.4, 0.3), color: 0x6E5638, x: x + t * w, y: 0.7, z: z + d / 2 });
  }
}

/** Asphalt road strip. axis 'x' runs along X at z = pos, 'z' runs along Z at x = pos */
export function makeRoad(mats, axis, start, pos, length, width = 8) {
  const geo = new THREE.PlaneGeometry(width, length);
  const uv = geo.attributes.uv;
  for (let i = 0; i < uv.count; i++) uv.setY(i, uv.getY(i) * (length / 24));
  const mesh = new THREE.Mesh(geo, mats.asphalt);
  mesh.rotation.x = -Math.PI / 2;
  if (axis === 'x') {
    mesh.rotation.z = Math.PI / 2;
    mesh.position.set(start + length / 2, 0.09, pos);
  } else {
    mesh.position.set(pos, 0.09, start + length / 2);
  }
  mesh.receiveShadow = true;
  return mesh;
}

const CAR_COLORS = [0xD62828, 0xF1F1F1, 0x1C1C1C, 0x2A5DB0, 0x8A8F98, 0xE9C46A, 0x264653];

/** Small hatchback merged into a single mesh (body, cabin, wheels, lights) */
export function makeCar(mats, seed) {
  const color = CAR_COLORS[Math.floor(rand(seed) * CAR_COLORS.length)];
  const batch = new ChunkBatch();
  batch.add('car', { geo: new THREE.BoxGeometry(4.2, 1.1, 1.9), color, y: 0.85 });
  batch.add('car', { geo: new THREE.BoxGeometry(2.3, 0.9, 1.7), color: 0x1A2430, x: -0.2, y: 1.8 });
  for (const [wx, wz] of [[1.4, 0.95], [1.4, -0.95], [-1.4, 0.95], [-1.4, -0.95]]) {
    batch.add('car', { geo: new THREE.CylinderGeometry(0.42, 0.42, 0.3, 8), color: 0x111111, x: wx, y: 0.42, z: wz, rx: Math.PI / 2 });
  }
  batch.add('car', { geo: new THREE.BoxGeometry(0.1, 0.3, 0.5), color: 0xFFF6C0, x: 2.12, y: 0.9, z: 0.6 });
  batch.add('car', { geo: new THREE.BoxGeometry(0.1, 0.3, 0.5), color: 0xFFF6C0, x: 2.12, y: 0.9, z: -0.6 });
  batch.add('car', { geo: new THREE.BoxGeometry(0.1, 0.25, 0.45), color: 0xFF2020, x: -2.12, y: 0.9, z: 0.6 });
  batch.add('car', { geo: new THREE.BoxGeometry(0.1, 0.25, 0.45), color: 0xFF2020, x: -2.12, y: 0.9, z: -0.6 });
  const [mesh] = batch.build(mats);
  return mesh;
}

// --- Wind turbines ------------------------------------------------------------

/**
 * Modern three-blade wind turbine. Static tower goes into the batch; the
 * rotor is returned as its own Group so it can spin.
 */
export function addTurbine(batch, mats, x, z, ry, height = 42) {
  const white = 0xF4F4F0;
  batch.add('metal', { geo: new THREE.CylinderGeometry(1.1, 2.0, height, 10), color: white, x, y: height / 2, z });
  const nx = x - Math.sin(ry) * 1.5, nz = z - Math.cos(ry) * 1.5;
  batch.add('metal', { geo: new THREE.BoxGeometry(3.2, 2.4, 6), color: white, x: nx, y: height + 0.6, z: nz, ry });

  const rotor = new THREE.Group();
  const rb = new ChunkBatch();
  rb.add('metal', { geo: new THREE.SphereGeometry(1.1, 8, 6), color: white });
  for (let b = 0; b < 3; b++) {
    const geo = new THREE.BoxGeometry(0.9, 18, 0.25);
    rb.add('metal', { geo, color: white, y: 9, rz: (b * Math.PI * 2) / 3 });
  }
  const [bladesMesh] = rb.build(mats);
  rotor.add(bladesMesh);
  rotor.position.set(x - Math.sin(ry) * 4.6, height + 0.6, z - Math.cos(ry) * 4.6);
  rotor.rotation.y = ry;
  rotor.userData.spinPhase = rand(x * 3 + z) * Math.PI * 2;

  return {
    rotor,
    collider: { x, z, radius: 3, topY: height + 20 },
  };
}

// --- Horizon ring ----------------------------------------------------------------

/** Faint distant treeline that rides the fog edge, hinting at a world beyond */
export function createHorizonRing(textures, radius = 820) {
  const geo = new THREE.CylinderGeometry(radius, radius, 46, 64, 1, true);
  const mat = new THREE.MeshBasicMaterial({
    map: textures.treeline(), transparent: true, depthWrite: false,
    side: THREE.BackSide, fog: true, color: 0x9AAE9C,
  });
  mat.map.repeat.set(6, 1);
  const mesh = new THREE.Mesh(geo, mat);
  mesh.position.y = 23;
  mesh.renderOrder = -5;
  return mesh;
}

// --- Instanced flowers --------------------------------------------------------------

/** All the wildflowers of a chunk as one InstancedMesh with per-instance color */
export function makeFlowerField(patches) {
  const total = patches.reduce((n, p) => n + p.count, 0);
  if (!total) return null;
  const geo = new THREE.SphereGeometry(0.45, 5, 4);
  const mat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.8 });
  const mesh = new THREE.InstancedMesh(geo, mat, total);
  const dummy = new THREE.Object3D();
  const color = new THREE.Color();
  let i = 0;
  for (const p of patches) {
    for (let f = 0; f < p.count; f++) {
      const s = p.seed + f * 7;
      dummy.position.set(p.x + (rand(s) - 0.5) * p.spread, 0.45, p.z + (rand(s + 1) - 0.5) * p.spread);
      const sc = 0.7 + rand(s + 2) * 0.7;
      dummy.scale.set(sc, sc * 1.4, sc);
      dummy.updateMatrix();
      mesh.setMatrixAt(i, dummy.matrix);
      color.setHex(p.colors[Math.floor(rand(s + 3) * p.colors.length)]);
      mesh.setColorAt(i, color);
      i++;
    }
  }
  mesh.instanceMatrix.needsUpdate = true;
  if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
  mesh.receiveShadow = true;
  return mesh;
}
