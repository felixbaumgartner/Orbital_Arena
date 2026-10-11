// Pooled GPU particles: camera-facing quads drawn as one instanced mesh per
// blend layer. Particles live in flat typed arrays and are simulated on the
// CPU; dead ones are swapped out so the instance count stays compact.
// Nothing is allocated per particle, so a big explosion costs no garbage.
import * as THREE from 'three';

export type Layer = 'add' | 'alpha';

/** One particle. Colours are linear RGB; values above 1 bloom. */
export interface ParticleSpec {
  x: number; y: number; z: number;
  vx?: number; vy?: number; vz?: number;
  life: number;
  size0: number; size1: number;
  c0: THREE.Color; c1: THREE.Color;
  a0: number; a1: number;
  /** Velocity damping per second (0 = none) */
  drag?: number;
  /** Vertical acceleration (negative falls, positive rises like hot smoke) */
  gravity?: number;
  rot?: number;
  spin?: number;
  /** Fraction of the life spent fading in (smoke billows rather than pops) */
  fadeIn?: number;
}

const VERT = /* glsl */ `
  attribute vec3 iOffset;
  attribute float iSize;
  attribute vec4 iColor;
  attribute float iRot;
  varying vec2 vUv;
  varying vec4 vColor;
  varying float vFogDepth;
  void main() {
    vUv = uv;
    vColor = iColor;
    vec4 mv = viewMatrix * vec4(iOffset, 1.0);
    float c = cos(iRot), s = sin(iRot);
    vec2 corner = vec2(c * position.x - s * position.y, s * position.x + c * position.y);
    mv.xy += corner * iSize;
    vFogDepth = -mv.z;
    gl_Position = projectionMatrix * mv;
  }
`;

const FRAG = /* glsl */ `
  uniform sampler2D map;
  uniform vec3 fogColor;
  uniform float fogNear;
  uniform float fogFar;
  varying vec2 vUv;
  varying vec4 vColor;
  varying float vFogDepth;
  void main() {
    vec4 tex = texture2D(map, vUv);
    float a = vColor.a * tex.a;
    if (a < 0.003) discard;
    float f = smoothstep(fogNear, fogFar, vFogDepth);
    #ifdef ADDITIVE
      gl_FragColor = vec4(vColor.rgb * tex.rgb, a * (1.0 - f));
    #else
      gl_FragColor = vec4(mix(vColor.rgb * tex.rgb, fogColor, f), a);
    #endif
  }
`;

class ParticleLayer {
  readonly mesh: THREE.Mesh;
  readonly capacity: number;
  count = 0;
  private geo: THREE.InstancedBufferGeometry;
  private material: THREE.ShaderMaterial;
  // simulation state
  private px: Float32Array; private py: Float32Array; private pz: Float32Array;
  private vx: Float32Array; private vy: Float32Array; private vz: Float32Array;
  private age: Float32Array; private life: Float32Array;
  private s0: Float32Array; private s1: Float32Array;
  private col0: Float32Array; private col1: Float32Array; // rgba
  private drag: Float32Array; private grav: Float32Array;
  private rot: Float32Array; private spin: Float32Array; private fadeIn: Float32Array;
  // GPU attributes
  private aOffset: THREE.InstancedBufferAttribute;
  private aSize: THREE.InstancedBufferAttribute;
  private aColor: THREE.InstancedBufferAttribute;
  private aRot: THREE.InstancedBufferAttribute;

  constructor(scene: THREE.Scene, map: THREE.Texture, capacity: number, additive: boolean) {
    this.capacity = capacity;
    const n = capacity;
    this.px = new Float32Array(n); this.py = new Float32Array(n); this.pz = new Float32Array(n);
    this.vx = new Float32Array(n); this.vy = new Float32Array(n); this.vz = new Float32Array(n);
    this.age = new Float32Array(n); this.life = new Float32Array(n);
    this.s0 = new Float32Array(n); this.s1 = new Float32Array(n);
    this.col0 = new Float32Array(n * 4); this.col1 = new Float32Array(n * 4);
    this.drag = new Float32Array(n); this.grav = new Float32Array(n);
    this.rot = new Float32Array(n); this.spin = new Float32Array(n); this.fadeIn = new Float32Array(n);

    const quad = new THREE.PlaneGeometry(1, 1);
    this.geo = new THREE.InstancedBufferGeometry();
    this.geo.index = quad.index;
    this.geo.setAttribute('position', quad.getAttribute('position'));
    this.geo.setAttribute('uv', quad.getAttribute('uv'));
    const dyn = (arr: Float32Array, size: number) => {
      const a = new THREE.InstancedBufferAttribute(arr, size);
      a.setUsage(THREE.DynamicDrawUsage);
      return a;
    };
    this.aOffset = dyn(new Float32Array(n * 3), 3);
    this.aSize = dyn(new Float32Array(n), 1);
    this.aColor = dyn(new Float32Array(n * 4), 4);
    this.aRot = dyn(new Float32Array(n), 1);
    this.geo.setAttribute('iOffset', this.aOffset);
    this.geo.setAttribute('iSize', this.aSize);
    this.geo.setAttribute('iColor', this.aColor);
    this.geo.setAttribute('iRot', this.aRot);
    this.geo.instanceCount = 0;

    this.material = new THREE.ShaderMaterial({
      uniforms: {
        map: { value: map },
        fogColor: { value: new THREE.Color(0x87ceeb) },
        fogNear: { value: 300 },
        fogFar: { value: 950 },
      },
      vertexShader: VERT,
      fragmentShader: FRAG,
      transparent: true,
      depthWrite: false,
      blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending,
      defines: additive ? { ADDITIVE: 1 } : {},
    });
    this.mesh = new THREE.Mesh(this.geo, this.material);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = additive ? 6 : 5;
    scene.add(this.mesh);
  }

  emit(p: ParticleSpec): void {
    let i = this.count;
    if (i >= this.capacity) {
      // Full: recycle the oldest-looking slot rather than dropping the effect
      i = Math.floor(Math.random() * this.capacity);
    } else {
      this.count++;
    }
    this.px[i] = p.x; this.py[i] = p.y; this.pz[i] = p.z;
    this.vx[i] = p.vx || 0; this.vy[i] = p.vy || 0; this.vz[i] = p.vz || 0;
    this.age[i] = 0; this.life[i] = Math.max(0.01, p.life);
    this.s0[i] = p.size0; this.s1[i] = p.size1;
    const k = i * 4;
    this.col0[k] = p.c0.r; this.col0[k + 1] = p.c0.g; this.col0[k + 2] = p.c0.b; this.col0[k + 3] = p.a0;
    this.col1[k] = p.c1.r; this.col1[k + 1] = p.c1.g; this.col1[k + 2] = p.c1.b; this.col1[k + 3] = p.a1;
    this.drag[i] = p.drag || 0; this.grav[i] = p.gravity || 0;
    this.rot[i] = p.rot ?? Math.random() * Math.PI * 2; this.spin[i] = p.spin || 0;
    this.fadeIn[i] = p.fadeIn || 0;
  }

  private kill(i: number): void {
    const last = --this.count;
    if (i === last) return;
    this.px[i] = this.px[last]; this.py[i] = this.py[last]; this.pz[i] = this.pz[last];
    this.vx[i] = this.vx[last]; this.vy[i] = this.vy[last]; this.vz[i] = this.vz[last];
    this.age[i] = this.age[last]; this.life[i] = this.life[last];
    this.s0[i] = this.s0[last]; this.s1[i] = this.s1[last];
    const k = i * 4, l = last * 4;
    for (let j = 0; j < 4; j++) { this.col0[k + j] = this.col0[l + j]; this.col1[k + j] = this.col1[l + j]; }
    this.drag[i] = this.drag[last]; this.grav[i] = this.grav[last];
    this.rot[i] = this.rot[last]; this.spin[i] = this.spin[last]; this.fadeIn[i] = this.fadeIn[last];
  }

  update(dt: number, fog: THREE.Fog | null): void {
    for (let i = this.count - 1; i >= 0; i--) {
      this.age[i] += dt;
      if (this.age[i] >= this.life[i]) { this.kill(i); continue; }
      const d = this.drag[i] > 0 ? Math.exp(-this.drag[i] * dt) : 1;
      this.vx[i] *= d; this.vz[i] *= d;
      this.vy[i] = this.vy[i] * d + this.grav[i] * dt;
      this.px[i] += this.vx[i] * dt; this.py[i] += this.vy[i] * dt; this.pz[i] += this.vz[i] * dt;
      this.rot[i] += this.spin[i] * dt;
    }
    const off = this.aOffset.array as Float32Array;
    const size = this.aSize.array as Float32Array;
    const col = this.aColor.array as Float32Array;
    const rot = this.aRot.array as Float32Array;
    for (let i = 0; i < this.count; i++) {
      const t = this.age[i] / this.life[i];
      off[i * 3] = this.px[i]; off[i * 3 + 1] = this.py[i]; off[i * 3 + 2] = this.pz[i];
      // ease-out growth: billows quickly, then slows
      const g = 1 - (1 - t) * (1 - t);
      size[i] = this.s0[i] + (this.s1[i] - this.s0[i]) * g;
      const k = i * 4;
      const fi = this.fadeIn[i];
      const fade = fi > 0 && t < fi ? t / fi : 1;
      col[k] = this.col0[k] + (this.col1[k] - this.col0[k]) * t;
      col[k + 1] = this.col0[k + 1] + (this.col1[k + 1] - this.col0[k + 1]) * t;
      col[k + 2] = this.col0[k + 2] + (this.col1[k + 2] - this.col0[k + 2]) * t;
      col[k + 3] = (this.col0[k + 3] + (this.col1[k + 3] - this.col0[k + 3]) * t) * fade;
      rot[i] = this.rot[i];
    }
    this.geo.instanceCount = this.count;
    if (this.count > 0) {
      this.aOffset.needsUpdate = true; this.aSize.needsUpdate = true;
      this.aColor.needsUpdate = true; this.aRot.needsUpdate = true;
      // Only upload the live range
      for (const a of [this.aOffset, this.aSize, this.aColor, this.aRot]) {
        a.clearUpdateRanges();
        a.addUpdateRange(0, this.count * a.itemSize);
      }
    }
    if (fog) {
      const u = this.material.uniforms;
      (u.fogColor.value as THREE.Color).copy(fog.color);
      u.fogNear.value = fog.near;
      u.fogFar.value = fog.far;
    }
  }

  clear(): void { this.count = 0; this.geo.instanceCount = 0; }
}

/** Both blend layers plus their sprite textures */
export class ParticleSystem {
  readonly add: ParticleLayer;
  readonly alpha: ParticleLayer;
  private scene: THREE.Scene;

  constructor(scene: THREE.Scene, capacity = 4096) {
    this.scene = scene;
    this.add = new ParticleLayer(scene, makeGlowTexture(), capacity, true);
    this.alpha = new ParticleLayer(scene, makeSmokeTexture(), capacity, false);
  }

  emit(layer: Layer, p: ParticleSpec): void {
    (layer === 'add' ? this.add : this.alpha).emit(p);
  }

  update(dt: number): void {
    const fog = this.scene.fog instanceof THREE.Fog ? this.scene.fog : null;
    this.add.update(dt, fog);
    this.alpha.update(dt, fog);
  }

  get alive(): number { return this.add.count + this.alpha.count; }

  clear(): void { this.add.clear(); this.alpha.clear(); }
}

/** Hot core fading to a soft halo (fire, sparks, flashes) */
function makeGlowTexture(): THREE.Texture {
  const s = 64;
  const c = document.createElement('canvas');
  c.width = c.height = s;
  const g = c.getContext('2d')!;
  const grd = g.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2);
  grd.addColorStop(0, 'rgba(255,255,255,1)');
  grd.addColorStop(0.18, 'rgba(255,255,255,0.85)');
  grd.addColorStop(0.45, 'rgba(255,255,255,0.28)');
  grd.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grd;
  g.fillRect(0, 0, s, s);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.NoColorSpace;
  return tex;
}

/** Lumpy, soft-edged puff built from overlapping blobs (smoke, dust) */
function makeSmokeTexture(): THREE.Texture {
  const s = 128;
  const c = document.createElement('canvas');
  c.width = c.height = s;
  const g = c.getContext('2d')!;
  let seed = 7;
  const rnd = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
  for (let i = 0; i < 22; i++) {
    const a = rnd() * Math.PI * 2;
    const d = Math.pow(rnd(), 0.7) * s * 0.22;
    const x = s / 2 + Math.cos(a) * d, y = s / 2 + Math.sin(a) * d;
    const r = s * (0.12 + rnd() * 0.16);
    const shade = 200 + Math.floor(rnd() * 55);
    const grd = g.createRadialGradient(x, y, 0, x, y, r);
    grd.addColorStop(0, `rgba(${shade},${shade},${shade},0.32)`);
    grd.addColorStop(1, `rgba(${shade},${shade},${shade},0)`);
    g.fillStyle = grd;
    g.fillRect(0, 0, s, s);
  }
  // Fade the square's edges to nothing so no quad corner ever shows
  const img = g.getImageData(0, 0, s, s);
  for (let y = 0; y < s; y++) {
    for (let x = 0; x < s; x++) {
      const dx = (x - s / 2) / (s / 2), dy = (y - s / 2) / (s / 2);
      const r = Math.sqrt(dx * dx + dy * dy);
      const k = Math.max(0, Math.min(1, (1 - r) / 0.35));
      img.data[(y * s + x) * 4 + 3] *= k;
    }
  }
  g.putImageData(img, 0, 0);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.NoColorSpace;
  return tex;
}
