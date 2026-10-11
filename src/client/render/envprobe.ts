// Sky reflections: every few seconds the live sky (sun, sunset colours,
// overcast) is rendered into a prefiltered environment map that registered
// materials (planes, water) reflect. Only those materials get it, so the
// terrain's carefully balanced lighting is untouched.
import * as THREE from 'three';

export class EnvProbe {
  private renderer: THREE.WebGLRenderer;
  private pmrem: THREE.PMREMGenerator;
  private scene = new THREE.Scene();
  private target: THREE.WebGLRenderTarget | null = null;
  private ground: THREE.Mesh;
  private mats = new Map<THREE.MeshStandardMaterial, number>();
  private timer = 0;
  enabled = true;
  /** Seconds between refreshes (the sky changes slowly) */
  interval = 4;

  constructor(renderer: THREE.WebGLRenderer, skyMaterial: THREE.Material, skyGeometry: THREE.BufferGeometry) {
    this.renderer = renderer;
    this.pmrem = new THREE.PMREMGenerator(renderer);
    const dome = new THREE.Mesh(skyGeometry, skyMaterial);
    dome.frustumCulled = false;
    this.scene.add(dome);
    // The lower hemisphere reflects the land, not more sky
    this.ground = new THREE.Mesh(
      new THREE.CircleGeometry(1400, 32).rotateX(-Math.PI / 2),
      new THREE.MeshBasicMaterial({ color: 0x3f5a2c, side: THREE.DoubleSide, fog: false }),
    );
    this.ground.position.y = -40;
    this.scene.add(this.ground);
  }

  get texture(): THREE.Texture | null { return this.target ? this.target.texture : null; }

  /** Makes a material reflect the sky (intensity ~0.4 matte .. 1.2 chrome) */
  register(mat: THREE.Material, intensity = 1): void {
    const m = mat as THREE.MeshStandardMaterial;
    if (!m || !('envMapIntensity' in m)) return;
    this.mats.set(m, intensity);
    if (this.target && this.enabled) { m.envMap = this.target.texture; m.envMapIntensity = intensity; m.needsUpdate = true; }
  }

  unregister(mat: THREE.Material): void { this.mats.delete(mat as THREE.MeshStandardMaterial); }

  setEnabled(on: boolean): void {
    if (on === this.enabled) return;
    this.enabled = on;
    for (const [m, k] of this.mats) {
      m.envMap = on && this.target ? this.target.texture : null;
      m.envMapIntensity = k;
      m.needsUpdate = true;
    }
    if (on) this.timer = this.interval; // refresh on the next update
  }

  /** groundColor: the hemisphere light's ground colour, for the lower half */
  update(delta: number, groundColor?: THREE.Color, force = false): void {
    if (!this.enabled) return;
    this.timer += delta;
    if (!force && this.target && this.timer < this.interval) return;
    this.timer = 0;
    if (groundColor) (this.ground.material as THREE.MeshBasicMaterial).color.copy(groundColor);
    const prev = this.target;
    // Render from the origin: the sky shader works from view direction
    const rt = this.renderer.getRenderTarget();
    this.target = this.pmrem.fromScene(this.scene, 0.02, 1, 4000);
    this.renderer.setRenderTarget(rt);
    const tex = this.target.texture;
    for (const [m, k] of this.mats) {
      const first = !m.envMap;
      m.envMap = tex;
      m.envMapIntensity = k;
      if (first) m.needsUpdate = true;
    }
    if (prev) prev.dispose();
  }
}
