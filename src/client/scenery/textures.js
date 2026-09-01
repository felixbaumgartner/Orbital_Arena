// Procedural canvas textures — the whole world is textured without a
// single image file. Every generator is deterministic and tileable.
import * as THREE from 'three';

function makeCanvas(w, h) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return c;
}

// --- Tileable value noise -------------------------------------------------

function hash2(x, y, seed) {
  const s = Math.sin(x * 127.1 + y * 311.7 + seed * 74.7) * 43758.5453;
  return s - Math.floor(s);
}

function smooth(t) {
  return t * t * (3 - 2 * t);
}

/** Value noise on a lattice with integer period so the result tiles */
function noise(x, y, period, seed) {
  const ix = Math.floor(x), iy = Math.floor(y);
  const fx = smooth(x - ix), fy = smooth(y - iy);
  const wrap = (v) => ((v % period) + period) % period;
  const a = hash2(wrap(ix), wrap(iy), seed);
  const b = hash2(wrap(ix + 1), wrap(iy), seed);
  const c = hash2(wrap(ix), wrap(iy + 1), seed);
  const d = hash2(wrap(ix + 1), wrap(iy + 1), seed);
  return a + (b - a) * fx + (c - a) * fy + (a - b - c + d) * fx * fy;
}

/** Fractal (multi-octave) tileable noise in [0, 1] */
function fbm(u, v, basePeriod, octaves, seed) {
  let amp = 0.5, sum = 0, norm = 0, period = basePeriod;
  for (let o = 0; o < octaves; o++) {
    sum += noise(u * period, v * period, period, seed + o * 17) * amp;
    norm += amp;
    amp *= 0.5;
    period *= 2;
  }
  return sum / norm;
}

function clamp01(v) {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}

function finish(canvas, { srgb = true, repeat = true, anisotropy = 1 } = {}) {
  const tex = new THREE.CanvasTexture(canvas);
  if (repeat) tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
  tex.anisotropy = anisotropy;
  tex.needsUpdate = true;
  return tex;
}

export class TextureFactory {
  constructor(anisotropy = 4) {
    this.anisotropy = anisotropy;
    this.cache = new Map();
  }

  get(name, builder) {
    if (!this.cache.has(name)) this.cache.set(name, builder());
    return this.cache.get(name);
  }

  /** Meadow grass: soft green variation with blade speckles and dark patches */
  grass() {
    return this.get('grass', () => {
      const size = 512;
      const c = makeCanvas(size, size);
      const ctx = c.getContext('2d');
      const img = ctx.createImageData(size, size);
      for (let y = 0; y < size; y++) {
        for (let x = 0; x < size; x++) {
          const u = x / size, v = y / size;
          const n1 = fbm(u, v, 4, 5, 3);       // broad tonal variation
          const n2 = fbm(u, v, 48, 2, 11);     // fine blade detail
          const patch = fbm(u, v, 8, 3, 29);   // dark worn patches
          let g = 0.42 + n1 * 0.3 + (n2 - 0.5) * 0.22;
          let r = g * 0.62 + (n1 - 0.5) * 0.08;
          let b = g * 0.42;
          if (patch < 0.35) { r *= 0.85; g *= 0.85; b *= 0.8; }
          if (patch > 0.72) { r += 0.06; g += 0.04; }
          const i = (y * size + x) * 4;
          img.data[i] = clamp01(r) * 255;
          img.data[i + 1] = clamp01(g) * 255;
          img.data[i + 2] = clamp01(b) * 255;
          img.data[i + 3] = 255;
        }
      }
      ctx.putImageData(img, 0, 0);
      return finish(c, { anisotropy: this.anisotropy });
    });
  }

  /** Ploughed soil furrows — light/dark bands with clumpy noise */
  soil() {
    return this.get('soil', () => {
      const size = 512;
      const c = makeCanvas(size, size);
      const ctx = c.getContext('2d');
      const img = ctx.createImageData(size, size);
      for (let y = 0; y < size; y++) {
        for (let x = 0; x < size; x++) {
          const u = x / size, v = y / size;
          const furrow = 0.5 + 0.5 * Math.sin(v * Math.PI * 2 * 24);
          const n = fbm(u, v, 16, 3, 41);
          const base = 0.55 + furrow * 0.35 + (n - 0.5) * 0.3;
          const i = (y * size + x) * 4;
          img.data[i] = clamp01(base) * 255;
          img.data[i + 1] = clamp01(base * 0.92) * 255;
          img.data[i + 2] = clamp01(base * 0.8) * 255;
          img.data[i + 3] = 255;
        }
      }
      ctx.putImageData(img, 0, 0);
      return finish(c, { anisotropy: this.anisotropy });
    });
  }

  /** Neutral brick pattern — tinted by vertex colors */
  brick() {
    return this.get('brick', () => {
      const size = 256;
      const c = makeCanvas(size, size);
      const ctx = c.getContext('2d');
      ctx.fillStyle = '#d9d2c7';
      ctx.fillRect(0, 0, size, size);
      const bh = 16, bw = 40;
      for (let row = 0; row < size / bh; row++) {
        const offset = row % 2 === 0 ? 0 : bw / 2;
        for (let col = -1; col < size / bw + 1; col++) {
          const x = col * bw + offset;
          const y = row * bh;
          const shade = 0.78 + hash2(col, row, 5) * 0.28;
          ctx.fillStyle = `rgb(${Math.round(200 * shade)}, ${Math.round(190 * shade)}, ${Math.round(178 * shade)})`;
          ctx.fillRect(x + 1.5, y + 1.5, bw - 3, bh - 3);
        }
      }
      return finish(c, { anisotropy: this.anisotropy });
    });
  }

  /** Overlapping roof tiles, neutral so vertex colors give slate/terracotta */
  roofTile() {
    return this.get('roofTile', () => {
      const size = 256;
      const c = makeCanvas(size, size);
      const ctx = c.getContext('2d');
      ctx.fillStyle = '#9a9a9a';
      ctx.fillRect(0, 0, size, size);
      const th = 20, tw = 24;
      for (let row = 0; row < size / th + 1; row++) {
        const offset = row % 2 === 0 ? 0 : tw / 2;
        for (let col = -1; col < size / tw + 1; col++) {
          const x = col * tw + offset;
          const y = row * th;
          const shade = 0.72 + hash2(col, row, 9) * 0.4;
          ctx.fillStyle = `rgb(${Math.round(170 * shade)}, ${Math.round(170 * shade)}, ${Math.round(172 * shade)})`;
          ctx.beginPath();
          ctx.moveTo(x, y);
          ctx.lineTo(x + tw, y);
          ctx.lineTo(x + tw, y + th - 4);
          ctx.quadraticCurveTo(x + tw / 2, y + th + 4, x, y + th - 4);
          ctx.closePath();
          ctx.fill();
        }
      }
      return finish(c, { anisotropy: this.anisotropy });
    });
  }

  /** Asphalt with worn centre dashes and edge lines (tiles along V) */
  asphalt() {
    return this.get('asphalt', () => {
      const w = 256, h = 512;
      const c = makeCanvas(w, h);
      const ctx = c.getContext('2d');
      const img = ctx.createImageData(w, h);
      for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
          const n = fbm(x / w, y / h, 32, 3, 77);
          const g = 0.28 + n * 0.16;
          const i = (y * w + x) * 4;
          img.data[i] = g * 255;
          img.data[i + 1] = g * 255;
          img.data[i + 2] = (g + 0.01) * 255;
          img.data[i + 3] = 255;
        }
      }
      ctx.putImageData(img, 0, 0);
      ctx.fillStyle = 'rgba(235, 235, 225, 0.85)';
      for (let y = 0; y < h; y += 128) ctx.fillRect(w / 2 - 4, y + 20, 8, 64);
      ctx.fillStyle = 'rgba(235, 235, 225, 0.7)';
      ctx.fillRect(10, 0, 5, h);
      ctx.fillRect(w - 15, 0, 5, h);
      return finish(c, { anisotropy: this.anisotropy });
    });
  }

  /** Soft cloud puff with ragged edges (alpha) */
  cloudPuff() {
    return this.get('cloudPuff', () => {
      const size = 256;
      const c = makeCanvas(size, size);
      const ctx = c.getContext('2d');
      const img = ctx.createImageData(size, size);
      for (let y = 0; y < size; y++) {
        for (let x = 0; x < size; x++) {
          const dx = (x / size - 0.5) * 2, dy = (y / size - 0.5) * 2;
          const d = Math.sqrt(dx * dx + dy * dy);
          const n = fbm(x / size, y / size, 6, 4, 101);
          const edge = 0.95 - (n - 0.5) * 0.6;
          let a = clamp01(1 - d / edge);
          a = Math.pow(a, 1.6);
          const i = (y * size + x) * 4;
          img.data[i] = 255;
          img.data[i + 1] = 255;
          img.data[i + 2] = 255;
          img.data[i + 3] = a * 255;
        }
      }
      ctx.putImageData(img, 0, 0);
      return finish(c, { repeat: false });
    });
  }

  /** Large-scale cloud shadow mask (alpha = darkness) */
  cloudShadow() {
    return this.get('cloudShadow', () => {
      const size = 512;
      const c = makeCanvas(size, size);
      const ctx = c.getContext('2d');
      const img = ctx.createImageData(size, size);
      for (let y = 0; y < size; y++) {
        for (let x = 0; x < size; x++) {
          const n = fbm(x / size, y / size, 3, 5, 202);
          const a = clamp01((n - 0.48) * 4.0);
          const i = (y * size + x) * 4;
          img.data[i] = 0;
          img.data[i + 1] = 0;
          img.data[i + 2] = 8;
          img.data[i + 3] = a * 255;
        }
      }
      ctx.putImageData(img, 0, 0);
      return finish(c, { srgb: false });
    });
  }

  /** Tileable water normal map derived from layered noise heights */
  waterNormal() {
    return this.get('waterNormal', () => {
      const size = 256;
      const c = makeCanvas(size, size);
      const ctx = c.getContext('2d');
      const img = ctx.createImageData(size, size);
      const height = (x, y) => {
        const u = ((x % size) + size) % size / size;
        const v = ((y % size) + size) % size / size;
        return fbm(u, v, 6, 4, 303) * 0.7 + fbm(u, v, 24, 2, 404) * 0.3;
      };
      const strength = 6.0;
      for (let y = 0; y < size; y++) {
        for (let x = 0; x < size; x++) {
          const dx = (height(x + 1, y) - height(x - 1, y)) * strength;
          const dy = (height(x, y + 1) - height(x, y - 1)) * strength;
          const nx = -dx, ny = -dy, nz = 1;
          const len = Math.sqrt(nx * nx + ny * ny + nz * nz);
          const i = (y * size + x) * 4;
          img.data[i] = (nx / len * 0.5 + 0.5) * 255;
          img.data[i + 1] = (ny / len * 0.5 + 0.5) * 255;
          img.data[i + 2] = (nz / len * 0.5 + 0.5) * 255;
          img.data[i + 3] = 255;
        }
      }
      ctx.putImageData(img, 0, 0);
      return finish(c, { srgb: false, anisotropy: this.anisotropy });
    });
  }

  /** Vertical rain streak (alpha) for the rain particle system */
  rainStreak() {
    return this.get('rainStreak', () => {
      const w = 16, h = 64;
      const c = makeCanvas(w, h);
      const ctx = c.getContext('2d');
      const g = ctx.createLinearGradient(0, 0, 0, h);
      g.addColorStop(0, 'rgba(255,255,255,0)');
      g.addColorStop(0.5, 'rgba(255,255,255,0.9)');
      g.addColorStop(1, 'rgba(255,255,255,0)');
      ctx.fillStyle = g;
      ctx.fillRect(w / 2 - 1.5, 0, 3, h);
      return finish(c, { repeat: false });
    });
  }

  /** Radial glow for lamps and lights */
  glow() {
    return this.get('glow', () => {
      const size = 128;
      const c = makeCanvas(size, size);
      const ctx = c.getContext('2d');
      const g = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
      g.addColorStop(0, 'rgba(255,255,255,1)');
      g.addColorStop(0.25, 'rgba(255,255,255,0.55)');
      g.addColorStop(0.6, 'rgba(255,255,255,0.12)');
      g.addColorStop(1, 'rgba(255,255,255,0)');
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, size, size);
      return finish(c, { repeat: false });
    });
  }

  /** Moon disc with maria and craters */
  moon() {
    return this.get('moon', () => {
      const size = 128;
      const c = makeCanvas(size, size);
      const ctx = c.getContext('2d');
      const img = ctx.createImageData(size, size);
      for (let y = 0; y < size; y++) {
        for (let x = 0; x < size; x++) {
          const dx = (x / size - 0.5) * 2, dy = (y / size - 0.5) * 2;
          const d = Math.sqrt(dx * dx + dy * dy);
          const n = fbm(x / size, y / size, 5, 4, 505);
          const shade = 0.75 + (n - 0.5) * 0.5;
          const a = clamp01((0.92 - d) * 14);
          const i = (y * size + x) * 4;
          img.data[i] = 235 * shade;
          img.data[i + 1] = 232 * shade;
          img.data[i + 2] = 220 * shade;
          img.data[i + 3] = a * 255;
        }
      }
      ctx.putImageData(img, 0, 0);
      return finish(c, { repeat: false });
    });
  }

  /** Distant horizon silhouette: treeline with occasional spires and windmills */
  treeline() {
    return this.get('treeline', () => {
      const w = 2048, h = 128;
      const c = makeCanvas(w, h);
      const ctx = c.getContext('2d');
      ctx.clearRect(0, 0, w, h);
      ctx.fillStyle = '#1e3320';
      // Rolling tree canopy
      ctx.beginPath();
      ctx.moveTo(0, h);
      for (let x = 0; x <= w; x += 6) {
        const n = fbm(x / w, 0.3, 24, 3, 606);
        const y = h - 18 - n * 30;
        ctx.lineTo(x, y);
      }
      ctx.lineTo(w, h);
      ctx.closePath();
      ctx.fill();
      // Spires and windmills poking above the treeline
      for (let i = 0; i < 14; i++) {
        const x = hash2(i, 3, 7) * w;
        const kind = hash2(i, 9, 7);
        if (kind < 0.5) {
          ctx.beginPath();
          ctx.moveTo(x - 5, h - 30);
          ctx.lineTo(x, h - 78);
          ctx.lineTo(x + 5, h - 30);
          ctx.closePath();
          ctx.fill();
        } else {
          ctx.fillRect(x - 3, h - 62, 6, 40);
          ctx.strokeStyle = '#1e3320';
          ctx.lineWidth = 2;
          ctx.beginPath();
          ctx.moveTo(x - 14, h - 76); ctx.lineTo(x + 14, h - 48);
          ctx.moveTo(x + 14, h - 76); ctx.lineTo(x - 14, h - 48);
          ctx.stroke();
        }
      }
      const tex = finish(c, { repeat: true });
      tex.wrapT = THREE.ClampToEdgeWrapping;
      return tex;
    });
  }
}
