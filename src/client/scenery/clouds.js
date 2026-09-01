// Billboard cloud layers: puffy cumulus clusters above flight altitude and
// thin cirrus streaks high up. Clouds drift with the wind and wrap around
// the player so the sky never empties out.
import * as THREE from 'three';

function rand(seed) {
  const x = Math.sin(seed * 127.1 + 311.7) * 43758.5453;
  return x - Math.floor(x);
}

export class CloudSystem {
  constructor(scene, textures, { cumulusCount = 30, cirrusCount = 12, radius = 950 } = {}) {
    this.scene = scene;
    this.radius = radius;
    this.group = new THREE.Group();
    scene.add(this.group);

    const puff = textures.cloudPuff();
    this.litMat = new THREE.SpriteMaterial({
      map: puff, transparent: true, depthWrite: false, fog: true, opacity: 0.95,
    });
    this.shadeMat = new THREE.SpriteMaterial({
      map: puff, transparent: true, depthWrite: false, fog: true, opacity: 0.95,
    });
    this.cirrusMat = new THREE.SpriteMaterial({
      map: puff, transparent: true, depthWrite: false, fog: true, opacity: 0.4,
    });

    this.clouds = [];
    for (let i = 0; i < cumulusCount; i++) this.clouds.push(this.makeCumulus(i));
    for (let i = 0; i < cirrusCount; i++) this.clouds.push(this.makeCirrus(i + 500));
    this.baseCumulus = cumulusCount;
  }

  makeCumulus(seed) {
    const cluster = new THREE.Group();
    const puffs = 6 + Math.floor(rand(seed) * 7);
    const rx = 45 + rand(seed + 1) * 50;
    const rz = 30 + rand(seed + 2) * 40;
    for (let j = 0; j < puffs; j++) {
      const s = seed * 31 + j * 7;
      const px = (rand(s) - 0.5) * 2 * rx;
      const pz = (rand(s + 1) - 0.5) * 2 * rz;
      const py = (rand(s + 2) - 0.2) * 22;
      const size = 38 + rand(s + 3) * 42;
      const sprite = new THREE.Sprite(py < 4 ? this.shadeMat : this.litMat);
      sprite.position.set(px, py, pz);
      sprite.scale.set(size * (0.9 + rand(s + 4) * 0.5), size * 0.72, 1);
      cluster.add(sprite);
    }
    const angle = rand(seed + 9) * Math.PI * 2;
    const dist = rand(seed + 10) * this.radius;
    cluster.position.set(Math.cos(angle) * dist, 135 + rand(seed + 11) * 60, Math.sin(angle) * dist);
    this.group.add(cluster);
    return { mesh: cluster, kind: 'cumulus', speed: 0.7 + rand(seed + 12) * 0.5, index: seed };
  }

  makeCirrus(seed) {
    const cluster = new THREE.Group();
    const streaks = 3 + Math.floor(rand(seed) * 3);
    for (let j = 0; j < streaks; j++) {
      const s = seed * 17 + j * 5;
      const sprite = new THREE.Sprite(this.cirrusMat);
      sprite.position.set((rand(s) - 0.5) * 120, (rand(s + 1) - 0.5) * 6, (rand(s + 2) - 0.5) * 40);
      sprite.scale.set(160 + rand(s + 3) * 160, 22 + rand(s + 4) * 16, 1);
      cluster.add(sprite);
    }
    const angle = rand(seed + 9) * Math.PI * 2;
    const dist = rand(seed + 10) * this.radius;
    cluster.position.set(Math.cos(angle) * dist, 260 + rand(seed + 11) * 60, Math.sin(angle) * dist);
    this.group.add(cluster);
    return { mesh: cluster, kind: 'cirrus', speed: 1.4 + rand(seed + 12) * 0.6, index: seed };
  }

  /**
   * center: player position; wind: {x, z} units/s; sky: SkySystem state;
   * coverage 0..1 (how many cumulus clusters are visible)
   */
  update(delta, center, wind, skyState, coverage) {
    this.litMat.color.copy(skyState.cloudColor);
    this.shadeMat.color.copy(skyState.cloudColor).multiplyScalar(0.72);
    this.cirrusMat.color.copy(skyState.cloudColor);
    const alpha = 0.55 + coverage * 0.45;
    this.litMat.opacity = alpha;
    this.shadeMat.opacity = alpha;
    this.cirrusMat.opacity = 0.25 + coverage * 0.3;

    const visibleCumulus = Math.round(this.baseCumulus * (0.3 + coverage * 0.7));
    let cumulusSeen = 0;
    const R = this.radius;
    for (const cloud of this.clouds) {
      const m = cloud.mesh;
      m.position.x += wind.x * cloud.speed * delta;
      m.position.z += wind.z * cloud.speed * delta;
      // Wrap around the player so the field is endless
      if (m.position.x - center.x > R) m.position.x -= 2 * R;
      if (m.position.x - center.x < -R) m.position.x += 2 * R;
      if (m.position.z - center.z > R) m.position.z -= 2 * R;
      if (m.position.z - center.z < -R) m.position.z += 2 * R;

      if (cloud.kind === 'cumulus') {
        m.visible = cumulusSeen < visibleCumulus;
        cumulusSeen++;
      } else {
        m.visible = coverage < 0.95; // cirrus hides under a full storm deck
      }
    }
  }

  setDensity(scale) {
    // Quality knob: hide a fraction of clusters entirely
    this.baseCumulus = Math.round(30 * scale);
  }
}
