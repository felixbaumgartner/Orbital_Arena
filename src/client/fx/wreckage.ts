// Shot-down planes break apart: a wing tears off, the propeller flies away
// and the burning fuselage tumbles to the ground trailing smoke, where it
// explodes and keeps smouldering for a while. Works on any plane group by
// splitting each mesh's triangles by their side of the fuselage.
import * as THREE from 'three';
import type { FX } from './effects';

type Vec = { x: number; y: number; z: number };

interface Piece {
  group: THREE.Group;
  vel: THREE.Vector3;
  spin: THREE.Vector3;       // angular velocity, rad/s (local axes)
  kind: 'hull' | 'wing' | 'prop';
  age: number;
  emit: number;              // trail emission timer
  grounded: boolean;
  groundAge: number;
  mats: THREE.MeshStandardMaterial[];
}

/** Half-way-out-the-wing cut per plane class (model units) */
const WING_CUT: Record<string, number> = { scout: 2.4, interceptor: 2.1, bomber: 4.4, primitive: 3.0 };

const MAX_PIECES = 24;
const GROUND_Y = 0.8;

export class Wreckage {
  private scene: THREE.Scene;
  private fx: FX;
  private pieces: Piece[] = [];
  private splitCache = new Map<string, { center: THREE.BufferGeometry | null; left: THREE.BufferGeometry | null; right: THREE.BufferGeometry | null }>();
  private tmpQ = new THREE.Quaternion();
  private tmpE = new THREE.Euler();
  /** Called when a piece hits the ground (for sound and camera shake) */
  onImpact: ((at: Vec, kind: Piece['kind']) => void) | null = null;

  constructor(scene: THREE.Scene, fx: FX) {
    this.scene = scene;
    this.fx = fx;
  }

  /**
   * Builds the wreck of `ship` (which the caller then hides). `vel` is the
   * plane's velocity at the moment it was hit.
   */
  spawn(ship: THREE.Object3D, vel: Vec): void {
    ship.updateMatrixWorld(true);
    const rootInv = new THREE.Matrix4().copy(ship.matrixWorld).invert();
    const planeKey = (ship.userData.plane as string) in WING_CUT && ship.userData.props ? ship.userData.plane : 'primitive';
    const cut = WING_CUT[planeKey] ?? 3;
    const skip = new Set<THREE.Object3D>([
      ...((ship.userData.navLights as THREE.Object3D[]) || []),
      ...(ship.userData.leftAB ? [ship.userData.leftAB, ship.userData.rightAB] : []),
    ]);
    const charred = new Map<THREE.Material, THREE.MeshStandardMaterial>();
    const char = (m: THREE.Material): THREE.MeshStandardMaterial => {
      let c = charred.get(m);
      if (!c) {
        const src = m as THREE.MeshStandardMaterial;
        c = new THREE.MeshStandardMaterial({
          color: (src.color ? src.color.clone() : new THREE.Color(0x777777)).lerp(new THREE.Color(0x1c1814), 0.72),
          roughness: 0.85, metalness: 0.15, map: src.map || null,
          emissive: new THREE.Color(0xff5a14), emissiveIntensity: 0.0,
          side: src.side,
        });
        charred.set(m, c);
      }
      return c;
    };

    const hull: THREE.Mesh[] = [], left: THREE.Mesh[] = [], right: THREE.Mesh[] = [], props: THREE.Object3D[] = [];
    const rel = new THREE.Matrix4();
    ship.traverse((obj) => {
      if (skip.has(obj)) return;
      if ((obj.name.startsWith('Prop') && !(obj.parent && obj.parent.name.startsWith('Prop')))) { props.push(obj); return; }
      if (obj.parent && obj.parent.name.startsWith('Prop')) return; // part of a prop handled above
      const mesh = obj as THREE.Mesh;
      if (!mesh.isMesh || !mesh.geometry) return;
      const mat = (Array.isArray(mesh.material) ? mesh.material[0] : mesh.material) as THREE.Material;
      if (!mat || (mat as THREE.Material).transparent) return; // canopy glass shatters away
      rel.multiplyMatrices(rootInv, mesh.matrixWorld);
      const parts = this.split(mesh.geometry, rel, cut);
      const mk = (geo: THREE.BufferGeometry | null, list: THREE.Mesh[]) => {
        if (!geo) return;
        const m = new THREE.Mesh(geo, char(mat));
        m.matrixAutoUpdate = false;
        m.matrix.copy(rel);
        m.castShadow = true;
        list.push(m);
      };
      mk(parts.center, hull);
      mk(parts.left, left);
      mk(parts.right, right);
    });

    // Which wings tear off: usually one, sometimes both
    const r = Math.random();
    const loseLeft = r < 0.45 || r > 0.85;
    const loseRight = r >= 0.45;
    if (!loseLeft) hull.push(...left);
    if (!loseRight) hull.push(...right);

    const pos = new THREE.Vector3(), quat = new THREE.Quaternion(), scl = new THREE.Vector3();
    ship.matrixWorld.decompose(pos, quat, scl);
    const v = new THREE.Vector3(vel.x, vel.y, vel.z);
    const mats = [...charred.values()];
    const side = new THREE.Vector3(1, 0, 0).applyQuaternion(quat);

    this.addPiece('hull', hull, pos, quat, v.clone().multiplyScalar(0.85).add(new THREE.Vector3(0, -2, 0)),
      new THREE.Vector3(rand(-0.8, -0.3), rand(-0.5, 0.5), rand(1.6, 3.2) * (Math.random() < 0.5 ? -1 : 1)), mats, scl);
    if (loseLeft && left.length) {
      this.addPiece('wing', left, pos, quat, v.clone().multiplyScalar(0.6).addScaledVector(side, -rand(8, 14)).add(new THREE.Vector3(0, rand(3, 7), 0)),
        new THREE.Vector3(rand(-6, 6), rand(-4, 4), rand(5, 9)), mats, scl);
    }
    if (loseRight && right.length) {
      this.addPiece('wing', right, pos, quat, v.clone().multiplyScalar(0.6).addScaledVector(side, rand(8, 14)).add(new THREE.Vector3(0, rand(3, 7), 0)),
        new THREE.Vector3(rand(-6, 6), rand(-4, 4), -rand(5, 9)), mats, scl);
    }
    for (const prop of props) {
      const clone = prop.clone(true);
      clone.traverse((c) => { const m = c as THREE.Mesh; if (m.isMesh) m.material = char(m.material as THREE.Material); });
      rel.multiplyMatrices(rootInv, prop.matrixWorld);
      clone.matrixAutoUpdate = false;
      clone.matrix.copy(rel);
      const fwd = new THREE.Vector3(0, 0, -1).applyQuaternion(quat);
      this.addPiece('prop', [clone], pos, quat, v.clone().multiplyScalar(0.7).addScaledVector(fwd, rand(10, 18)).add(new THREE.Vector3(rand(-4, 4), rand(4, 8), rand(-4, 4))),
        new THREE.Vector3(rand(-3, 3), rand(-3, 3), rand(12, 20)), mats, scl);
    }
    while (this.pieces.length > MAX_PIECES) this.remove(this.pieces[0]);
  }

  private addPiece(kind: Piece['kind'], meshes: THREE.Object3D[], pos: THREE.Vector3, quat: THREE.Quaternion,
    vel: THREE.Vector3, spin: THREE.Vector3, mats: THREE.MeshStandardMaterial[], scale: THREE.Vector3): void {
    if (!meshes.length) return;
    // Pivot each piece about its own centre so it tumbles believably
    const box = new THREE.Box3();
    for (const m of meshes) {
      const mesh = m as THREE.Mesh;
      if (mesh.isMesh && mesh.geometry) {
        if (!mesh.geometry.boundingBox) mesh.geometry.computeBoundingBox();
        box.union(mesh.geometry.boundingBox!.clone().applyMatrix4(m.matrix));
      } else {
        box.expandByPoint(new THREE.Vector3().setFromMatrixPosition(m.matrix));
      }
    }
    const center = box.isEmpty() ? new THREE.Vector3() : box.getCenter(new THREE.Vector3());
    const shift = new THREE.Matrix4().makeTranslation(-center.x, -center.y, -center.z);
    const group = new THREE.Group();
    for (const m of meshes) {
      m.matrix.premultiply(shift);
      group.add(m);
    }
    group.position.copy(center).multiply(scale).applyQuaternion(quat).add(pos);
    group.quaternion.copy(quat);
    group.scale.copy(scale);
    this.scene.add(group);
    this.pieces.push({ group, vel, spin, kind, age: 0, emit: 0, grounded: false, groundAge: 0, mats });
  }

  update(dt: number): void {
    for (let i = this.pieces.length - 1; i >= 0; i--) {
      const p = this.pieces[i];
      p.age += dt;
      const g = p.group;
      if (!p.grounded) {
        // Gravity, a little air drag, and tumbling
        p.vel.y -= (p.kind === 'hull' ? 26 : 20) * dt;
        const drag = Math.exp(-(p.kind === 'wing' ? 0.9 : 0.25) * dt);
        p.vel.x *= drag; p.vel.z *= drag;
        g.position.addScaledVector(p.vel, dt);
        this.tmpE.set(p.spin.x * dt, p.spin.y * dt, p.spin.z * dt);
        this.tmpQ.setFromEuler(this.tmpE);
        g.quaternion.multiply(this.tmpQ);

        p.emit -= dt;
        if (p.emit <= 0) {
          if (p.kind === 'hull') { p.emit = 0.025; this.fx.damageSmoke(g.position, true, 1.5); }
          else if (p.kind === 'wing') { p.emit = 0.07; this.fx.damageSmoke(g.position, Math.random() < 0.4, 0.8); }
          else { p.emit = 0.12; this.fx.damageSmoke(g.position, false, 0.5); }
        }
        for (const m of p.mats) m.emissiveIntensity = 0.12 + Math.random() * 0.25;

        if (g.position.y <= GROUND_Y || p.age > 16) {
          p.grounded = true;
          g.position.y = GROUND_Y;
          if (p.kind === 'hull') {
            this.fx.groundExplosion(g.position, 0.8);
            // Settle flat-ish on the ground, nose dug in
            g.rotation.set(rand(-0.25, 0.1), g.rotation.y, rand(-0.5, 0.5));
          } else {
            this.fx.damageSmoke(g.position, true, 1.2);
          }
          if (this.onImpact) this.onImpact({ x: g.position.x, y: g.position.y, z: g.position.z }, p.kind);
          if (p.kind !== 'hull') { this.remove(p); continue; }
        }
      } else {
        // A smouldering wreck: fire dies down, smoke thins, then it sinks away
        p.groundAge += dt;
        p.emit -= dt;
        const burning = p.groundAge < 5;
        if (p.emit <= 0 && p.groundAge < 11) {
          p.emit = burning ? 0.09 : 0.22;
          this.fx.wreckSmoke(g.position, burning);
        }
        for (const m of p.mats) m.emissiveIntensity = burning ? 0.2 + Math.random() * 0.3 : Math.max(0, 0.2 - (p.groundAge - 5) * 0.05);
        if (p.groundAge > 12) g.position.y -= dt * 0.8;
        if (p.groundAge > 15) { this.remove(p); continue; }
      }
    }
  }

  private remove(p: Piece): void {
    this.scene.remove(p.group);
    const idx = this.pieces.indexOf(p);
    if (idx >= 0) this.pieces.splice(idx, 1);
    // Materials are shared between a wreck's pieces; free them with the last one
    if (!this.pieces.some((q) => q.mats === p.mats)) for (const m of p.mats) m.dispose();
  }

  get count(): number { return this.pieces.length; }

  clear(): void { for (const p of [...this.pieces]) this.remove(p); }

  /**
   * Splits a geometry into fuselage / left-wing / right-wing triangle sets
   * by each triangle's centre in plane space (cached per geometry + pose).
   */
  private split(geo: THREE.BufferGeometry, rel: THREE.Matrix4, cut: number) {
    const key = `${geo.uuid}|${cut}|${rel.elements.map((e) => e.toFixed(3)).join(',')}`;
    const cached = this.splitCache.get(key);
    if (cached) return cached;
    const pos = geo.getAttribute('position') as THREE.BufferAttribute;
    const nor = geo.getAttribute('normal') as THREE.BufferAttribute | undefined;
    const uv = geo.getAttribute('uv') as THREE.BufferAttribute | undefined;
    const index = geo.getIndex();
    const triCount = index ? index.count / 3 : pos.count / 3;
    const buckets: number[][] = [[], [], []]; // center, left, right (vertex indices)
    const a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3();
    for (let t = 0; t < triCount; t++) {
      const i0 = index ? index.getX(t * 3) : t * 3;
      const i1 = index ? index.getX(t * 3 + 1) : t * 3 + 1;
      const i2 = index ? index.getX(t * 3 + 2) : t * 3 + 2;
      a.fromBufferAttribute(pos, i0).applyMatrix4(rel);
      b.fromBufferAttribute(pos, i1).applyMatrix4(rel);
      c.fromBufferAttribute(pos, i2).applyMatrix4(rel);
      const x = (a.x + b.x + c.x) / 3;
      const bucket = x < -cut ? 1 : x > cut ? 2 : 0;
      buckets[bucket].push(i0, i1, i2);
    }
    const build = (ids: number[]): THREE.BufferGeometry | null => {
      if (!ids.length) return null;
      const g = new THREE.BufferGeometry();
      const copy = (attr: THREE.BufferAttribute, size: number) => {
        const out = new Float32Array(ids.length * size);
        for (let k = 0; k < ids.length; k++) for (let j = 0; j < size; j++) out[k * size + j] = attr.getComponent(ids[k], j);
        return new THREE.BufferAttribute(out, size);
      };
      g.setAttribute('position', copy(pos, 3));
      if (nor) g.setAttribute('normal', copy(nor, 3)); else g.computeVertexNormals();
      if (uv) g.setAttribute('uv', copy(uv, 2));
      g.computeBoundingBox();
      g.computeBoundingSphere();
      return g;
    };
    const result = { center: build(buckets[0]), left: build(buckets[1]), right: build(buckets[2]) };
    this.splitCache.set(key, result);
    return result;
  }
}

function rand(a: number, b: number): number { return a + Math.random() * (b - a); }
