// Effect recipes built on the particle pool: explosions, impacts, smoke,
// muzzle flashes, missile and flare trails, ground blasts. A couple of
// pooled point lights make big blasts light up the world around them.
import * as THREE from 'three';
import { ParticleSystem, type ParticleSpec } from './particles';

type Vec = { x: number; y: number; z: number };

const C = (r: number, g: number, b: number) => new THREE.Color(r, g, b);
// Linear-space palette (values above 1 feed the bloom pass)
const FLASH0 = C(6, 4.6, 2.6), FLASH1 = C(2.4, 0.9, 0.2);
const FIRE0 = C(3.2, 1.55, 0.45), FIRE1 = C(0.9, 0.18, 0.03);
const SPARK0 = C(5, 3, 1.1), SPARK1 = C(2.2, 0.55, 0.08);
const SMOKE_DARK0 = C(0.035, 0.032, 0.03), SMOKE_DARK1 = C(0.22, 0.215, 0.21);
const SMOKE_GREY0 = C(0.12, 0.12, 0.12), SMOKE_GREY1 = C(0.36, 0.36, 0.36);
const TRAIL0 = C(0.75, 0.75, 0.74), TRAIL1 = C(0.55, 0.56, 0.58);
const DUST0 = C(0.2, 0.15, 0.09), DUST1 = C(0.42, 0.37, 0.29);
const MUZZLE0 = C(6, 4.2, 1.8), MUZZLE1 = C(3, 1.2, 0.2);
const FLARE0 = C(9, 8, 6.5), FLARE1 = C(5, 2.6, 1);
const EXHAUST0 = C(5, 2.8, 1.1), EXHAUST1 = C(2, 0.6, 0.1);

const rand = (a: number, b: number) => a + Math.random() * (b - a);

/** A random unit vector (optionally biased upward) */
function dir(upBias = 0): Vec {
  const u = Math.random() * 2 - 1, a = Math.random() * Math.PI * 2;
  const r = Math.sqrt(1 - u * u);
  const v = { x: r * Math.cos(a), y: u + upBias, z: r * Math.sin(a) };
  const l = Math.hypot(v.x, v.y, v.z) || 1;
  v.x /= l; v.y /= l; v.z /= l;
  return v;
}

interface FlashLight { light: THREE.PointLight; t: number; dur: number; peak: number }

export class FX {
  readonly particles: ParticleSystem;
  /** 0.35 (low) .. 1 (high/ultra): scales particle counts */
  density = 1;
  private lights: FlashLight[] = [];
  private lightCursor = 0;
  private spec: ParticleSpec = {
    x: 0, y: 0, z: 0, life: 1, size0: 1, size1: 1, c0: FIRE0, c1: FIRE1, a0: 1, a1: 0,
  };

  constructor(scene: THREE.Scene, opts: { lights?: number } = {}) {
    this.particles = new ParticleSystem(scene, 4096);
    for (let i = 0; i < (opts.lights ?? 2); i++) {
      const light = new THREE.PointLight(0xffa04a, 0, 140, 1.6);
      light.castShadow = false;
      scene.add(light);
      this.lights.push({ light, t: 0, dur: 1, peak: 0 });
    }
  }

  setQuality(q: string): void {
    this.density = q === 'low' ? 0.35 : q === 'medium' ? 0.65 : 1;
    const lit = q !== 'low';
    for (const l of this.lights) { l.light.visible = lit; if (!lit) l.light.intensity = 0; }
  }

  private n(count: number): number {
    return Math.max(1, Math.round(count * this.density));
  }

  /** Emits one particle reusing a scratch spec (callers set every field) */
  private p(layer: 'add' | 'alpha', at: Vec, o: Partial<ParticleSpec> & Pick<ParticleSpec, 'life' | 'size0' | 'size1' | 'c0' | 'c1' | 'a0' | 'a1'>): void {
    const s = this.spec;
    s.x = at.x; s.y = at.y; s.z = at.z;
    s.vx = o.vx ?? 0; s.vy = o.vy ?? 0; s.vz = o.vz ?? 0;
    s.life = o.life; s.size0 = o.size0; s.size1 = o.size1;
    s.c0 = o.c0; s.c1 = o.c1; s.a0 = o.a0; s.a1 = o.a1;
    s.drag = o.drag ?? 0; s.gravity = o.gravity ?? 0; s.spin = o.spin ?? 0;
    s.rot = o.rot; s.fadeIn = o.fadeIn ?? 0;
    this.particles.emit(layer, s);
  }

  private flashLight(at: Vec, peak: number, dur: number, color = 0xffa04a): void {
    if (!this.lights.length || !this.lights[0].light.visible) return;
    const l = this.lights[this.lightCursor++ % this.lights.length];
    l.light.position.set(at.x, at.y, at.z);
    l.light.color.setHex(color);
    l.t = 0; l.dur = dur; l.peak = peak;
  }

  update(dt: number): void {
    this.particles.update(dt);
    for (const l of this.lights) {
      if (l.peak <= 0) continue;
      l.t += dt;
      const k = Math.max(0, 1 - l.t / l.dur);
      l.light.intensity = l.peak * k * k * (0.85 + Math.random() * 0.3);
      if (k <= 0) { l.peak = 0; l.light.intensity = 0; }
    }
  }

  /** A plane blowing up in the air. scale 1 = a fighter. */
  explosion(at: Vec, scale = 1, vel: Vec | null = null): void {
    const s = scale;
    const ix = vel ? vel.x * 0.35 : 0, iy = vel ? vel.y * 0.35 : 0, iz = vel ? vel.z * 0.35 : 0;
    this.p('add', at, { life: 0.28, size0: 20 * s, size1: 7 * s, c0: FLASH0, c1: FLASH1, a0: 1, a1: 0 });
    for (let i = 0, n = this.n(16); i < n; i++) {
      const d = dir(0.15), sp = rand(5, 15) * s;
      this.p('add', { x: at.x + d.x * 2 * s, y: at.y + d.y * 2 * s, z: at.z + d.z * 2 * s }, {
        vx: d.x * sp + ix, vy: d.y * sp + iy, vz: d.z * sp + iz,
        life: rand(0.6, 1.15), size0: rand(4, 6.5) * s, size1: rand(9, 13) * s,
        c0: FIRE0, c1: FIRE1, a0: 1, a1: 0, drag: 2.6, gravity: 5, spin: rand(-1.5, 1.5),
      });
    }
    for (let i = 0, n = this.n(16); i < n; i++) {
      const d = dir(0.3), sp = rand(2.5, 8) * s;
      this.p('alpha', at, {
        vx: d.x * sp + ix * 0.5, vy: d.y * sp + 2 + iy * 0.5, vz: d.z * sp + iz * 0.5,
        life: rand(2.8, 4.8), size0: rand(4, 6) * s, size1: rand(16, 24) * s,
        c0: SMOKE_DARK0, c1: SMOKE_DARK1, a0: 0.9, a1: 0, drag: 1.1, gravity: 1.6,
        spin: rand(-0.4, 0.4), fadeIn: 0.08,
      });
    }
    for (let i = 0, n = this.n(30); i < n; i++) {
      const d = dir(0.25), sp = rand(22, 62) * s;
      this.p('add', at, {
        vx: d.x * sp + ix, vy: d.y * sp + iy, vz: d.z * sp + iz,
        life: rand(0.45, 1.1), size0: rand(0.6, 1.1), size1: 0.15,
        c0: SPARK0, c1: SPARK1, a0: 1, a1: 0.2, drag: 0.7, gravity: -32,
      });
    }
    this.flashLight(at, 260 * s, 0.7);
  }

  /** Bullet striking a plane */
  hitSpark(at: Vec): void {
    this.p('add', at, { life: 0.12, size0: 4, size1: 1.2, c0: FLASH0, c1: FLASH1, a0: 1, a1: 0 });
    for (let i = 0, n = this.n(10); i < n; i++) {
      const d = dir(0.2), sp = rand(14, 34);
      this.p('add', at, {
        vx: d.x * sp, vy: d.y * sp + 3, vz: d.z * sp, life: rand(0.22, 0.5),
        size0: rand(0.35, 0.6), size1: 0.1, c0: SPARK0, c1: SPARK1, a0: 1, a1: 0.3, drag: 0.8, gravity: -26,
      });
    }
    for (let i = 0, n = this.n(2); i < n; i++) {
      const d = dir(0.5);
      this.p('alpha', at, {
        vx: d.x * 2, vy: d.y * 2, vz: d.z * 2, life: rand(0.6, 0.9), size0: 1.2, size1: 4.5,
        c0: SMOKE_GREY0, c1: SMOKE_GREY1, a0: 0.55, a1: 0, drag: 1.5,
      });
    }
  }

  /** One puff from a damaged (or burning) plane; call at a steady rate */
  damageSmoke(at: Vec, fire: boolean, heavy = 1): void {
    const j = () => (Math.random() - 0.5) * 1.6;
    this.p('alpha', { x: at.x + j(), y: at.y + j(), z: at.z + j() }, {
      vx: j(), vy: rand(0.8, 2.2), vz: j(), life: rand(1.4, 2.6) * heavy,
      size0: 1.2 * heavy, size1: rand(4.5, 6.5) * heavy,
      c0: fire ? SMOKE_DARK0 : SMOKE_GREY0, c1: fire ? SMOKE_DARK1 : SMOKE_GREY1,
      a0: fire ? 0.8 : 0.6, a1: 0, drag: 0.8, gravity: 1.2, spin: rand(-0.6, 0.6), fadeIn: 0.1,
    });
    if (fire) {
      this.p('add', at, {
        vx: j() * 0.5, vy: rand(0.5, 2), vz: j() * 0.5, life: rand(0.25, 0.42),
        size0: rand(1.6, 2.4) * heavy, size1: 0.5, c0: FIRE0, c1: FIRE1, a0: 1, a1: 0,
      });
    }
  }

  /** Gun flash at the muzzle */
  muzzleFlash(at: Vec): void {
    this.p('add', at, { life: 0.06, size0: 2.2, size1: 0.8, c0: MUZZLE0, c1: MUZZLE1, a0: 1, a1: 0 });
  }

  /** Missile motor: hot exhaust plus a lingering white smoke trail */
  missileTrail(at: Vec): void {
    this.p('add', at, { life: 0.07, size0: 1.8, size1: 0.6, c0: EXHAUST0, c1: EXHAUST1, a0: 1, a1: 0 });
    const j = () => (Math.random() - 0.5) * 0.6;
    this.p('alpha', { x: at.x + j(), y: at.y + j(), z: at.z + j() }, {
      vx: j(), vy: rand(0.2, 0.8), vz: j(), life: rand(1.6, 2.6), size0: 0.9, size1: rand(4, 5.5),
      c0: TRAIL0, c1: TRAIL1, a0: 0.55, a1: 0, drag: 0.6, gravity: 0.3, spin: rand(-0.3, 0.3), fadeIn: 0.05,
    });
  }

  /** Burning decoy flare: blinding core plus a smoke streak */
  flare(at: Vec): void {
    this.p('add', at, { life: 0.09, size0: 3.4, size1: 1.6, c0: FLARE0, c1: FLARE1, a0: 1, a1: 0 });
    this.p('alpha', at, {
      vy: rand(0.2, 0.6), life: rand(0.9, 1.4), size0: 0.8, size1: 3.2,
      c0: TRAIL0, c1: TRAIL1, a0: 0.45, a1: 0, drag: 0.8, fadeIn: 0.05,
    });
  }

  /** Flare ignition pop */
  flareBurst(at: Vec): void {
    this.p('add', at, { life: 0.18, size0: 7, size1: 2, c0: FLARE0, c1: FLARE1, a0: 1, a1: 0 });
    this.flashLight(at, 90, 0.35, 0xfff0d0);
  }

  /** Bomb or wreck hitting the ground: fireball, dust ring and a smoke column */
  groundExplosion(at: Vec, scale = 1): void {
    const s = scale;
    const g = { x: at.x, y: Math.max(0.5, at.y), z: at.z };
    this.p('add', { x: g.x, y: g.y + 3 * s, z: g.z }, { life: 0.3, size0: 26 * s, size1: 9 * s, c0: FLASH0, c1: FLASH1, a0: 1, a1: 0 });
    for (let i = 0, n = this.n(18); i < n; i++) {
      const d = dir(0.9), sp = rand(6, 16) * s;
      this.p('add', { x: g.x + d.x * 2 * s, y: g.y + 2 * s, z: g.z + d.z * 2 * s }, {
        vx: d.x * sp * 0.6, vy: Math.abs(d.y) * sp + 6 * s, vz: d.z * sp * 0.6,
        life: rand(0.7, 1.3), size0: rand(5, 7) * s, size1: rand(10, 15) * s,
        c0: FIRE0, c1: FIRE1, a0: 1, a1: 0, drag: 2.2, gravity: 6, spin: rand(-1, 1),
      });
    }
    for (let i = 0, n = this.n(22); i < n; i++) {
      const a = (i / 22) * Math.PI * 2 + Math.random() * 0.3, sp = rand(16, 32) * s;
      this.p('alpha', { x: g.x, y: g.y + 1, z: g.z }, {
        vx: Math.cos(a) * sp, vy: rand(1, 4), vz: Math.sin(a) * sp,
        life: rand(1.3, 2.4), size0: 3 * s, size1: rand(9, 13) * s,
        c0: DUST0, c1: DUST1, a0: 0.75, a1: 0, drag: 2.6, gravity: 0.6, spin: rand(-0.5, 0.5),
      });
    }
    for (let i = 0, n = this.n(14); i < n; i++) {
      const d = dir(2.5), sp = rand(2, 6) * s;
      this.p('alpha', { x: g.x, y: g.y + 4 * s, z: g.z }, {
        vx: d.x * sp, vy: Math.abs(d.y) * sp + 5, vz: d.z * sp,
        life: rand(4, 6.5), size0: 5 * s, size1: rand(18, 28) * s,
        c0: SMOKE_DARK0, c1: SMOKE_DARK1, a0: 0.85, a1: 0, drag: 0.9, gravity: 2.2, spin: rand(-0.3, 0.3), fadeIn: 0.1,
      });
    }
    for (let i = 0, n = this.n(20); i < n; i++) {
      const d = dir(1.4), sp = rand(18, 40) * s;
      this.p('alpha', { x: g.x, y: g.y + 1, z: g.z }, {
        vx: d.x * sp, vy: Math.abs(d.y) * sp, vz: d.z * sp, life: rand(0.8, 1.4),
        size0: rand(0.6, 1.1), size1: 0.4, c0: DUST0, c1: DUST0, a0: 1, a1: 0.8, drag: 0.3, gravity: -40,
      });
    }
    this.flashLight({ x: g.x, y: g.y + 8, z: g.z }, 320 * s, 0.8);
  }

  /** Smoke rising from a downed wreck on the ground */
  wreckSmoke(at: Vec, fire: boolean): void {
    const j = () => (Math.random() - 0.5) * 2.5;
    this.p('alpha', { x: at.x + j(), y: at.y + 1, z: at.z + j() }, {
      vx: j() * 0.4, vy: rand(3, 5.5), vz: j() * 0.4, life: rand(3.5, 5.5), size0: 2.5, size1: rand(12, 18),
      c0: SMOKE_DARK0, c1: SMOKE_DARK1, a0: 0.7, a1: 0, drag: 0.4, gravity: 0.8, spin: rand(-0.3, 0.3), fadeIn: 0.12,
    });
    if (fire) {
      this.p('add', { x: at.x + j() * 0.5, y: at.y + 0.6, z: at.z + j() * 0.5 }, {
        vy: rand(2, 4), life: rand(0.35, 0.6), size0: rand(2.2, 3.4), size1: 0.8,
        c0: FIRE0, c1: FIRE1, a0: 1, a1: 0,
      });
    }
  }

  clear(): void { this.particles.clear(); }
}
