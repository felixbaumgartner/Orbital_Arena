// Infinite terrain, biomes, villages, landmarks and ambient scenery.
// Methods are mixed into the Game class (see game.js); `this` is the Game.
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { ChunkBatch, addTree, addHouse, addTerrace, addLamp, addFence, makeRoad, makeCar, addTurbine, makeFlowerField, gableGeometry } from '../scenery/props.js';
import { GAME_CONFIG } from '../config.js';

export class TerrainMethods {
  // =========================================================================
  // INFINITE TERRAIN WITH BIOMES
  // =========================================================================

  createInfiniteTerrain() {
    // Textured meadow that follows the player; the texture offset is
    // scrolled in world units so the ground never appears to slide
    this.groundTex = this.textures.grass().clone();
    this.groundTex.needsUpdate = true;
    const repeat = GAME_CONFIG.GROUND_SIZE / GAME_CONFIG.GROUND_TILE;
    this.groundTex.repeat.set(repeat, repeat);
    const grassGeo = new THREE.PlaneGeometry(GAME_CONFIG.GROUND_SIZE, GAME_CONFIG.GROUND_SIZE, 1, 1);
    const grassMat = new THREE.MeshStandardMaterial({
      map: this.groundTex, roughness: 0.95,
      // Nudge the base ground back in depth so the overlays never z-fight it
      polygonOffset: true, polygonOffsetFactor: 2, polygonOffsetUnits: 4,
    });
    this.groundMat = grassMat;
    this.groundPlane = new THREE.Mesh(grassGeo, grassMat);
    this.groundPlane.rotation.x = -Math.PI / 2;
    this.groundPlane.receiveShadow = true;
    this.scene.add(this.groundPlane);

    // Cloud shadows: a translucent dark mask drifting over the ground
    const shadowTex = this.textures.cloudShadow();
    shadowTex.repeat.set(2.5, 2.5);
    const shadowMat = new THREE.MeshBasicMaterial({
      map: shadowTex, color: 0x000000, transparent: true, depthWrite: false, opacity: 0.35,
    });
    this.cloudShadow = new THREE.Mesh(
      new THREE.PlaneGeometry(GAME_CONFIG.GROUND_SIZE, GAME_CONFIG.GROUND_SIZE), shadowMat);
    this.cloudShadow.rotation.x = -Math.PI / 2;
    this.cloudShadow.position.y = 0.75;
    this.cloudShadow.renderOrder = 2;
    this.scene.add(this.cloudShadow);

    this.createCoast();
    this.createSetPieces();
    this.updateChunks(0, 0);
  }

  /** The dike ring and the sea beyond it: the arena has an edge you can see */
  createCoast() {
    const R = GAME_CONFIG.ARENA_RADIUS;
    const sea = new THREE.Mesh(new THREE.RingGeometry(R - 6, 3200, 96, 1), this.mats.water);
    sea.rotation.x = -Math.PI / 2;
    sea.position.y = 0.26;
    sea.receiveShadow = true;
    sea.renderOrder = 1;
    this.scene.add(sea);
    this.sea = sea;

    // Dike: a raised grassy bank with a stone face to the sea
    const batch = new ChunkBatch();
    const segs = 72;
    for (let i = 0; i < segs; i++) {
      const a0 = (i / segs) * Math.PI * 2, a1 = ((i + 1) / segs) * Math.PI * 2;
      const am = (a0 + a1) / 2;
      const len = (a1 - a0) * (R - 20) + 2;
      batch.add('grassPatch', { geo: new THREE.BoxGeometry(len, 4.5, 30), color: 0xA9CC8E, x: Math.cos(am) * (R - 20), y: 2.25, z: Math.sin(am) * (R - 20), ry: -am });
      batch.add('brick', { geo: new THREE.BoxGeometry(len, 3.2, 6), color: 0x8E8E86, x: Math.cos(am) * (R - 4), y: 1.6, z: Math.sin(am) * (R - 4), ry: -am });
    }
    for (const mesh of batch.build(this.mats)) this.scene.add(mesh);

    // Lighthouses on the north and south dikes for orientation
    const objs = [], cols = [];
    this.addLighthouse(0, -(R - 30), 'static', objs, cols);
    this.addLighthouse(0, R - 30, 'static', objs, cols);
    this.registerLandmark('static', 0, -(R - 30), '🗼', 'The North Light', 'The keeper judges the Cup from up there. She has never been wrong, she says.');
    this.registerLandmark('static', 0, R - 30, '🗼', 'The South Light', 'Where the first race was flown in 1935, in a plane made of bicycle parts.');
    this.staticColliders = cols;
    this.obstacles.set('static', this.staticColliders);
  }

  /**
   * Fixed landmarks every match shares: a great canal you can run low
   * along under poplars, a cathedral spire to steer by, and a wind farm
   * between East and Hill mills that is the fast, dangerous line.
   */
  createSetPieces() {
    const batch = new ChunkBatch();
    const cols = this.staticColliders;
    const R = GAME_CONFIG.ARENA_RADIUS;
    const CX = -120;
    const len = 1700;

    // Great Canal, north to south, with banks and poplar rows both sides
    batch.add('water', { geo: new THREE.PlaneGeometry(26, len), rx: -Math.PI / 2, x: CX, y: 0.24, z: 0 });
    batch.add('soil', { geo: new THREE.PlaneGeometry(4, len), color: 0x8A7A55, rx: -Math.PI / 2, x: CX - 15, y: 0.26, z: 0 });
    batch.add('soil', { geo: new THREE.PlaneGeometry(4, len), color: 0x8A7A55, rx: -Math.PI / 2, x: CX + 15, y: 0.26, z: 0 });
    for (let z = -830; z <= 830; z += 22) {
      cols.push(addTree(batch, 'poplar', CX - 24, z, 1.05, z * 3 + 1));
      cols.push(addTree(batch, 'poplar', CX + 24, z, 1.05, z * 3 + 2));
    }
    // Three stone bridges
    for (const z of [-420, 0, 420]) {
      batch.add('metal', { geo: new THREE.BoxGeometry(34, 1.2, 9), color: 0x7A7A7A, x: CX, y: 2.0, z });
      batch.add('metal', { geo: new THREE.BoxGeometry(34, 1.4, 0.3), color: 0x4A4A4A, x: CX, y: 3.2, z: z - 4.4 });
      batch.add('metal', { geo: new THREE.BoxGeometry(34, 1.4, 0.3), color: 0x4A4A4A, x: CX, y: 3.2, z: z + 4.4 });
    }

    // Cathedral: nave, twin towers and a 62-unit spire
    const cx = 150, cz = 150;
    batch.add('brick', { geo: new THREE.BoxGeometry(22, 18, 44), color: 0x8F5B45, x: cx, y: 9, z: cz });
    batch.add('roof', { geo: gableGeometry(22, 9, 44), color: 0x3E3E48, x: cx, y: 18, z: cz });
    for (const tx of [cx - 8, cx + 8]) {
      batch.add('brick', { geo: new THREE.BoxGeometry(7, 34, 7), color: 0x8F5B45, x: tx, y: 17, z: cz - 26 });
      batch.add('roof', { geo: new THREE.ConeGeometry(4.6, 9, 4), color: 0x3E3E48, x: tx, y: 38.5, z: cz - 26, ry: Math.PI / 4 });
    }
    batch.add('brick', { geo: new THREE.BoxGeometry(9, 30, 9), color: 0x8F5B45, x: cx, y: 15, z: cz - 26 });
    batch.add('roof', { geo: new THREE.ConeGeometry(5.2, 32, 8), color: 0x3E3E48, x: cx, y: 46, z: cz - 26 });
    batch.add('glow', { geo: new THREE.SphereGeometry(1.2, 8, 6), x: cx, y: 63, z: cz - 26 });
    cols.push({ x: cx, z: cz, radius: 24, topY: 28 });
    cols.push({ x: cx, z: cz - 26, radius: 6, topY: 64 });
    this.registerLandmark('static', cx, cz, '⛪', 'The Cathedral', 'Its bell was cast from a windmill\'s old gears. It rings when the Cup is decided.');

    // Wind farm shortcut: six turbines on the line from East mill to Hill mill
    for (let i = 0; i < 6; i++) {
      const t = 0.15 + i * 0.14;
      const x = 300 + (200 - 300) * t, z = 0 + (-200 - 0) * t;
      const tb = addTurbine(batch, this.mats, x + (i % 2 ? 18 : -18), z, 0.6, 46);
      tb.rotor.traverse(c => { if (c.isMesh) c.castShadow = true; });
      this.scene.add(tb.rotor);
      cols.push(tb.collider);
      this.registerAmbient('static', { mesh: tb.rotor, type: 'turbine' });
    }
    this.registerLandmark('static', 250, -100, '🌬️', 'The Gauntlet', 'Built on the old racecourse. The fast line to Hill mill, if your nerve holds.');

    for (const mesh of batch.build(this.mats)) this.scene.add(mesh);
  }

  seededRandom(seed) {
    const x = Math.sin(seed * 127.1 + 311.7) * 43758.5453;
    return x - Math.floor(x);
  }

  /**
   * Determines biome type for a chunk region
   */
  getBiome(chunkX, chunkZ) {
    const bx = Math.floor(chunkX / 3);
    const bz = Math.floor(chunkZ / 3);
    const val = this.seededRandom(bx * 54321 + bz * 12345 + 777);
    if (val < 0.35) return 'village';
    if (val < 0.65) return 'farmland';
    return 'waterland';
  }

  updateChunks(playerX, playerZ) {
    const cx = Math.floor(playerX / GAME_CONFIG.CHUNK_SIZE);
    const cz = Math.floor(playerZ / GAME_CONFIG.CHUNK_SIZE);

    // LOD: full detail within 2 chunks, cheap far-ring silhouettes beyond
    const needed = new Map();
    for (let dx = -this.viewDistance; dx <= this.viewDistance; dx++) {
      for (let dz = -this.viewDistance; dz <= this.viewDistance; dz++) {
        const ring = Math.max(Math.abs(dx), Math.abs(dz));
        needed.set(`${cx + dx},${cz + dz}`, ring <= 2 ? 'high' : 'low');
      }
    }

    for (const key of this.chunks.keys()) {
      if (!needed.has(key)) this.disposeChunk(key);
    }

    // Build missing chunks nearest-first, a couple per frame, so crossing a
    // chunk boundary never stalls the frame. The very first fill (and any
    // teleport that empties the map) builds everything at once.
    const pending = [];
    for (const [key, lod] of needed) {
      const current = this.chunkLods.get(key);
      const [x, z] = key.split(',').map(Number);
      const ring = Math.max(Math.abs(x - cx), Math.abs(z - cz));
      if (!this.chunks.has(key)) pending.push({ x, z, lod, ring, upgrade: false });
      else if (current === 'low' && lod === 'high') pending.push({ x, z, lod, ring, upgrade: true });
      // Downgrades (high chunk drifting into the far ring) are left as-is;
      // they get evicted once out of range.
    }
    pending.sort((a, b) => a.ring - b.ring);
    const budget = this.chunks.size === 0 ? Infinity : 2;
    let built = 0;
    for (const p of pending) {
      if (built >= budget) break;
      if (p.upgrade) this.disposeChunk(`${p.x},${p.z}`);
      this.generateChunk(p.x, p.z, p.lod);
      built++;
    }
  }

  disposeChunk(key) {
    const objects = this.chunks.get(key);
    if (objects) {
      objects.forEach(obj => {
        this.scene.remove(obj);
        obj.traverse(child => {
          if (child.geometry) child.geometry.dispose();
          if (child.material) {
            const mats = Array.isArray(child.material) ? child.material : [child.material];
            mats.forEach(m => { if (!m.userData.shared) m.dispose(); });
          }
        });
      });
    }
    this.chunks.delete(key);
    this.chunkLods.delete(key);
    this.obstacles.delete(key);
    this.powerups.delete(key);
    this.ambient.delete(key);
    this.chunkLandmarks.delete(key);
  }

  generateChunk(chunkX, chunkZ, lod = 'high') {
    const objects = [];
    const colliders = [];
    const batch = new ChunkBatch();
    const CS = GAME_CONFIG.CHUNK_SIZE;
    const baseX = chunkX * CS;
    const baseZ = chunkZ * CS;
    const seed = chunkX * 73856093 + chunkZ * 19349663;
    const biome = this.getBiome(chunkX, chunkZ);
    const chunkKey = `${chunkX},${chunkZ}`;
    const rnd = (k) => this.seededRandom(seed + k);
    const flowerPatches = [];

    // Beyond the dike there is only sea: register an empty chunk
    const ccx = baseX + CS / 2, ccz = baseZ + CS / 2;
    const fromCentre = Math.hypot(ccx, ccz);
    if (fromCentre > GAME_CONFIG.ARENA_RADIUS + CS * 0.7) {
      this.chunks.set(chunkKey, []);
      this.chunkLods.set(chunkKey, lod);
      this.obstacles.set(chunkKey, []);
      return;
    }
    // Near the dike, and in the Great Canal's column, keep the land open
    const coastal = fromCentre > GAME_CONFIG.ARENA_RADIUS - GAME_CONFIG.COAST_BAND - CS * 0.7;
    const canalColumn = false; // the Great Canal only clears trees along its banks now
    const high = lod === 'high' && !coastal;
    const nearCanal = (x) => Math.abs(x + 120) < 48;
    const nearSea = (x, z) => Math.hypot(x, z) > GAME_CONFIG.ARENA_RADIUS - 36;
    const addTreeSafe = (b, kind, x, z, sc, sd) => (nearCanal(x) || nearSea(x, z)) ? null : addTree(b, kind, x, z, sc, sd);

    // --- Ground tone patches: textured grass and ploughed soil ---
    const grassTints = [0xC2DDAA, 0xA9CC8E, 0xD6E6BC, 0x9DBF84, 0xB8D49C];
    const soilTints = [0xB08A5A, 0xC49A6C, 0x9A7A50];
    const numPatches = 2 + Math.floor(rnd(8000) * 3);
    for (let i = 0; i < numPatches; i++) {
      const ps = 8000 + i * 50;
      const pw = 30 + rnd(ps + 1) * 80;
      const pd = 30 + rnd(ps + 2) * 80;
      const px = baseX + rnd(ps + 3) * CS;
      const pz = baseZ + rnd(ps + 4) * CS;
      const soil = biome === 'farmland' && rnd(ps + 6) < 0.45;
      const tints = soil ? soilTints : grassTints;
      batch.add(soil ? 'soil' : 'grassPatch', {
        geo: new THREE.PlaneGeometry(pw, pd),
        color: tints[Math.floor(rnd(ps + 5) * tints.length)],
        rx: -Math.PI / 2, x: px, y: 0.15 + i * 0.03, z: pz,
      });
    }

    // --- BIOME: VILLAGE ---
    if (biome === 'village') {
      const axis = rnd(300) > 0.5 ? 'x' : 'z';
      const along0 = axis === 'x' ? baseX : baseZ;
      const roadPos = (axis === 'x' ? baseZ : baseX) + 50 + rnd(301) * 100;
      const place = (along, across) => axis === 'x' ? { x: along, z: across } : { x: across, z: along };

      if (high) {
        const road = makeRoad(this.mats, axis, along0, roadPos, CS);
        this.scene.add(road);
        objects.push(road);

        // Terraces of canal houses facing the street from both sides
        for (const side of [-1, 1]) {
          const terraces = 1 + Math.floor(rnd(305 + side) * 2);
          for (let t = 0; t < terraces; t++) {
            const along = along0 + 35 + t * 95 + rnd(310 + t * 3 + side) * 35;
            const across = roadPos + side * 14;
            const p = place(along, across);
            let ry;
            if (axis === 'x') ry = side === -1 ? 0 : Math.PI;
            else ry = side === -1 ? Math.PI / 2 : -Math.PI / 2;
            const count = 3 + Math.floor(rnd(320 + t * 5 + side) * 3);
            colliders.push(...addTerrace(batch, p.x, p.z, count, ry, seed + t * 501 + side * 77));
          }
        }

        // Street lamps
        for (let k = 0; k < 4; k++) {
          const p = place(along0 + 25 + k * 50, roadPos + 5.6);
          addLamp(batch, p.x, p.z);
        }

        // Traffic
        const numCars = 2 + Math.floor(rnd(330) * 2);
        for (let c = 0; c < numCars; c++) {
          const car = makeCar(this.mats, seed + c * 77);
          this.scene.add(car);
          objects.push(car);
          const dir = c % 2 === 0 ? 1 : -1;
          this.registerAmbient(chunkKey, {
            mesh: car, type: 'car', axis, dir,
            min: along0, max: along0 + CS,
            pos: along0 + rnd(331 + c) * CS,
            lane: roadPos + (axis === 'x' ? dir : -dir) * 2.1,
            speed: 13 + rnd(332 + c) * 9,
          });
        }

        // Village green with wildflowers
        const gp = place(along0 + 100 + (rnd(340) - 0.5) * 60, roadPos - 40 - rnd(341) * 30);
        flowerPatches.push({ x: gp.x, z: gp.z, count: 60, spread: 22, seed: seed + 350,
          colors: [0xFFFFFF, 0xFFE066, 0xFF6B9D, 0xE8384F] });

        // Windmill tucked in the corner away from the street
        if (rnd(999) > 0.55) {
          this.addWindmill(baseX + 18 + rnd(998) * 25, baseZ + 18 + rnd(997) * 25, objects, colliders);
        }

        // Church with steeple (rare)
        if (rnd(1111) > 0.75) {
          const cp = place(along0 + 100 + (rnd(1112) - 0.5) * 40, roadPos + 42 + rnd(1113) * 20);
          this.addChurch(cp.x, cp.z, objects, colliders);
        }
      }

      // Oaks scattered away from the street, poplars lining it (both LODs)
      const numTrees = 6 + Math.floor(rnd(500) * 6);
      for (let i = 0; i < numTrees; i++) {
        const s = 2000 + i * 100;
        const along = along0 + rnd(s + 1) * CS;
        const across = (axis === 'x' ? baseZ : baseX) + rnd(s + 2) * CS;
        if (Math.abs(across - roadPos) < 30) continue;
        const p = place(along, across);
        colliders.push(addTreeSafe(batch, rnd(s + 4) < 0.15 ? 'willow' : 'oak', p.x, p.z, 0.75 + rnd(s + 3) * 0.6, seed + s));
      }
      for (let along = along0 + 8; along < along0 + CS; along += 18) {
        if (rnd(along + 3) < 0.25) continue;
        const p = place(along, roadPos - 7.5);
        colliders.push(addTreeSafe(batch, 'poplar', p.x, p.z, 0.9 + rnd(along) * 0.3, seed + along));
      }
    }

    // --- BIOME: FARMLAND ---
    if (biome === 'farmland') {
      const cropTints = [0xE0D060, 0xC8E070, 0x8FBF5A, 0xD8B85A, 0xB5D98A];
      const numFields = 3 + Math.floor(rnd(100) * 3);
      for (let i = 0; i < numFields; i++) {
        const s = 3000 + i * 200;
        const x = baseX + rnd(s + 1) * CS;
        const z = baseZ + rnd(s + 2) * CS;
        const fw = 25 + rnd(s + 3) * 40;
        const fd = 25 + rnd(s + 4) * 40;
        const ploughed = rnd(s + 6) < 0.4;
        batch.add(ploughed ? 'soil' : 'grassPatch', {
          geo: new THREE.PlaneGeometry(fw, fd),
          color: ploughed ? soilTints[Math.floor(rnd(s + 5) * soilTints.length)]
            : cropTints[Math.floor(rnd(s + 5) * cropTints.length)],
          rx: -Math.PI / 2, x, y: 0.3 + i * 0.03, z,
        });
        if (high) addFence(batch, x, z, fw, fd);
      }

      if (high) {
        // Hay bales
        const numBales = 3 + Math.floor(rnd(200) * 5);
        for (let i = 0; i < numBales; i++) {
          const s = 4000 + i * 80;
          batch.add('wood', {
            geo: new THREE.CylinderGeometry(2, 2, 2.5, 12), color: 0xD4A017,
            x: baseX + rnd(s + 1) * CS, y: 1.25, z: baseZ + rnd(s + 2) * CS,
            rx: Math.PI / 2, ry: rnd(s + 3) * Math.PI,
          });
        }

        // Wildflower meadows
        const numFlowerPatches = 2 + Math.floor(rnd(300) * 4);
        for (let i = 0; i < numFlowerPatches; i++) {
          const s = 5000 + i * 120;
          flowerPatches.push({
            x: baseX + rnd(s + 1) * CS, z: baseZ + rnd(s + 2) * CS,
            count: 40, spread: 16, seed: seed + s,
            colors: [0xFF4444, 0xFFAA00, 0xFF69B4, 0xFFFF66, 0xFFFFFF, 0xDA70D6],
          });
        }

        // Farmstead: house, barn, willow and a small orchard
        if (rnd(400) > 0.4) {
          const fx = baseX + 40 + rnd(401) * (CS - 80);
          const fz = baseZ + 40 + rnd(402) * (CS - 80);
          const ry = rnd(403) * Math.PI * 2;
          colliders.push(addHouse(batch, fx, fz, 13, 7, 10, ry, seed + 404));
          const bx = fx + Math.cos(ry) * 22, bz = fz - Math.sin(ry) * 22;
          batch.add('wood', { geo: new THREE.BoxGeometry(18, 7, 11), color: 0x2E3A2C, x: bx, y: 3.5, z: bz, ry });
          batch.add('roof', { geo: gableGeometry(18, 5, 11), color: 0x5A3A2A, x: bx, y: 7, z: bz, ry });
          colliders.push({ x: bx, z: bz, radius: 10, topY: 12 });
          colliders.push(addTree(batch, 'willow', fx - Math.cos(ry) * 16, fz + Math.sin(ry) * 16, 0.9, seed + 405));
          for (let o = 0; o < 6; o++) {
            const ox = fx + Math.sin(ry) * 20 + (o % 3) * 9 - 9;
            const oz = fz + Math.cos(ry) * 20 + Math.floor(o / 3) * 9;
            colliders.push(addTree(batch, 'oak', ox, oz, 0.45, seed + 410 + o));
          }
        }

        // Country road with a little traffic (roads were half the charm)
      if (rnd(360) > 0.45) {
        const axis = rnd(361) > 0.5 ? 'x' : 'z';
        const along0 = axis === 'x' ? baseX : baseZ;
        const roadPos = (axis === 'x' ? baseZ : baseX) + 40 + rnd(362) * 120;
        const road = makeRoad(this.mats, axis, along0, roadPos, CS);
        this.scene.add(road);
        objects.push(road);
        const numCars = 1 + Math.floor(rnd(363) * 2);
        for (let c = 0; c < numCars; c++) {
          const car = makeCar(this.mats, seed + 900 + c * 77);
          this.scene.add(car);
          objects.push(car);
          const dir = c % 2 === 0 ? 1 : -1;
          this.registerAmbient(chunkKey, {
            mesh: car, type: 'car', axis, dir, min: along0, max: along0 + CS,
            pos: along0 + rnd(364 + c) * CS, lane: roadPos + (axis === 'x' ? dir : -dir) * 2.1, speed: 12 + rnd(365 + c) * 8,
          });
        }
      }

      // Grazing sheep
        const herd = 3 + Math.floor(rnd(5000) * 4);
        this.addHerd(baseX + 30 + rnd(5001) * (CS - 60), baseZ + 30 + rnd(5002) * (CS - 60), herd, 'sheep', seed + 5010, objects);
      }

      // Field trees
      const numTrees = 2 + Math.floor(rnd(550) * 3);
      for (let i = 0; i < numTrees; i++) {
        const s = 6000 + i * 100;
        colliders.push(addTreeSafe(batch, 'oak', baseX + rnd(s + 1) * CS, baseZ + rnd(s + 2) * CS, 0.6 + rnd(s + 3) * 0.5, seed + s));
      }

      // Wind farm on the open land
      if (!coastal && !canalColumn && rnd(880) > 0.86) this.addTurbineRow(batch, baseX, baseZ, seed + 890, chunkKey, objects, colliders);
    }

    // --- BIOME: WATERLAND ---
    if (biome === 'waterland') {
      const canalAlongX = rnd(700) > 0.5;
      const canalZ = baseZ + 30 + rnd(701) * (CS - 60);
      const canalX = baseX + 30 + rnd(702) * (CS - 60);
      const canalW = 12 + rnd(703) * 6;

      if (canalAlongX) {
        batch.add('water', { geo: new THREE.PlaneGeometry(CS, canalW), rx: -Math.PI / 2, x: baseX + CS / 2, y: 0.22, z: canalZ });
        // Banks
        batch.add('soil', { geo: new THREE.PlaneGeometry(CS, 2.5), color: 0x8A7A55, rx: -Math.PI / 2, x: baseX + CS / 2, y: 0.24, z: canalZ - canalW / 2 - 1 });
        batch.add('soil', { geo: new THREE.PlaneGeometry(CS, 2.5), color: 0x8A7A55, rx: -Math.PI / 2, x: baseX + CS / 2, y: 0.24, z: canalZ + canalW / 2 + 1 });
        // Poplars along the far bank
        for (let x = baseX + 6; x < baseX + CS; x += 13) {
          colliders.push(addTreeSafe(batch, 'poplar', x, canalZ + canalW / 2 + 6, 0.9 + rnd(x) * 0.35, seed + x));
        }
        if (high && rnd(710) > 0.35) {
          const bx = baseX + 30 + rnd(711) * (CS - 60);
          batch.add('metal', { geo: new THREE.BoxGeometry(7, 0.8, canalW + 4), color: 0x7A7A7A, x: bx, y: 1.2, z: canalZ });
          batch.add('metal', { geo: new THREE.BoxGeometry(0.25, 1.2, canalW + 4), color: 0x4A4A4A, x: bx - 3.3, y: 2.2, z: canalZ });
          batch.add('metal', { geo: new THREE.BoxGeometry(0.25, 1.2, canalW + 4), color: 0x4A4A4A, x: bx + 3.3, y: 2.2, z: canalZ });
        }
      } else {
        batch.add('water', { geo: new THREE.PlaneGeometry(canalW, CS), rx: -Math.PI / 2, x: canalX, y: 0.22, z: baseZ + CS / 2 });
        batch.add('soil', { geo: new THREE.PlaneGeometry(2.5, CS), color: 0x8A7A55, rx: -Math.PI / 2, x: canalX - canalW / 2 - 1, y: 0.24, z: baseZ + CS / 2 });
        batch.add('soil', { geo: new THREE.PlaneGeometry(2.5, CS), color: 0x8A7A55, rx: -Math.PI / 2, x: canalX + canalW / 2 + 1, y: 0.24, z: baseZ + CS / 2 });
        for (let z = baseZ + 6; z < baseZ + CS; z += 13) {
          colliders.push(addTreeSafe(batch, 'poplar', canalX + canalW / 2 + 6, z, 0.9 + rnd(z) * 0.35, seed + z));
        }
      }

      // Ponds with reeds, boats and willows
      const numPonds = 1 + Math.floor(rnd(720) * 2);
      for (let i = 0; i < numPonds; i++) {
        const s = 7000 + i * 100;
        const x = baseX + 25 + rnd(s + 1) * (CS - 50);
        const z = baseZ + 25 + rnd(s + 2) * (CS - 50);
        const r = 8 + rnd(s + 3) * 12;
        batch.add('water', { geo: new THREE.CircleGeometry(r, 20), rx: -Math.PI / 2, x, y: 0.22, z });
        if (high) {
          if (r > 12) this.addRowboat(x, z, r, chunkKey, objects, seed + i);
          for (let j = 0; j < 14; j++) {
            const angle = (j / 14) * Math.PI * 2 + rnd(s + 40 + j) * 0.3;
            batch.add('wood', {
              geo: new THREE.CylinderGeometry(0.12, 0.18, 2.5 + rnd(s + 60 + j) * 2, 4), color: 0x6B8E23,
              x: x + Math.cos(angle) * (r + 0.8), y: 1.4, z: z + Math.sin(angle) * (r + 0.8),
              rz: (rnd(s + 80 + j) - 0.5) * 0.3,
            });
          }
        }
        colliders.push(addTreeSafe(batch, 'willow', x + r + 6, z - 3, 0.8 + rnd(s + 9) * 0.4, seed + s));
      }

      const numTrees = 2 + Math.floor(rnd(750) * 3);
      for (let i = 0; i < numTrees; i++) {
        const s = 7500 + i * 100;
        colliders.push(addTreeSafe(batch, 'oak', baseX + rnd(s + 1) * CS, baseZ + rnd(s + 2) * CS, 0.8 + rnd(s + 3) * 0.4, seed + s));
      }

      if (high && rnd(799) > 0.6) {
        this.addWindmill(baseX + 20 + rnd(800) * (CS - 40), baseZ + 20 + rnd(801) * (CS - 40), objects, colliders);
      }
      if (!coastal && !canalColumn && rnd(881) > 0.8) this.addTurbineRow(batch, baseX, baseZ, seed + 891, chunkKey, objects, colliders);
    }

    // --- Striped tulip fields (farmland's signature look) ---
    if (biome === 'farmland') {
      const numFields = 1 + Math.floor(rnd(3000) * 2);
      for (let i = 0; i < numFields; i++) {
        const s = seed + 3000 + i * 77;
        this.addTulipField(baseX + this.seededRandom(s + 1) * CS, baseZ + this.seededRandom(s + 2) * CS, s, objects);
      }
    }

    // --- Cows graze near villages ---
    if (high && biome === 'village') {
      const herd = 3 + Math.floor(rnd(5000) * 4);
      this.addHerd(baseX + 30 + rnd(5001) * (CS - 60), baseZ + 30 + rnd(5002) * (CS - 60), herd, 'cow', seed + 5010, objects);
    }

    // --- Hot air balloons drifting overhead ---
    if (rnd(6100) < 0.2) {
      this.addHotAirBalloon(baseX + rnd(6101) * CS, baseZ + rnd(6102) * CS, seed + 6103, chunkKey, objects);
    }

    // --- Rare landmarks: reasons to fly toward the horizon ---
    const landmarkRoll = (coastal || canalColumn) ? 1 : rnd(4242);
    if (landmarkRoll < 0.025) {
      this.addCastle(baseX + CS / 2, baseZ + CS / 2, objects, colliders);
      this.registerLandmark(chunkKey, baseX + CS / 2, baseZ + CS / 2, '🏰', 'Slot Zonneveld', 'The count who built it lost the first Cup and never flew again.');
    } else if (landmarkRoll < 0.05) {
      this.addLighthouse(baseX + CS / 2, baseZ + CS / 2, chunkKey, objects, colliders);
      this.registerLandmark(chunkKey, baseX + CS / 2, baseZ + CS / 2, '🗼', 'Lake Light', 'Lit every night since the Cup began, in case a pilot goes down in the lake.');
    } else if (landmarkRoll < 0.07) {
      for (let i = 0; i < 4; i++) {
        const s = seed + 4300 + i * 31;
        this.addHotAirBalloon(baseX + 40 + this.seededRandom(s) * (CS - 80), baseZ + 40 + this.seededRandom(s + 1) * (CS - 80), s + 2, chunkKey, objects);
      }
      this.registerLandmark(chunkKey, baseX + CS / 2, baseZ + CS / 2, '🎈', 'Balloon Festival', 'The balloonists claim they invented the Cup. Nobody has ever let them compete.');
    }

    // --- Magic tulip power-up (any biome) ---
    if (high && rnd(9999) < GAME_CONFIG.PICKUP_SPAWN_CHANCE) {
      const px = baseX + 20 + rnd(9998) * (CS - 40);
      const pz = baseZ + 20 + rnd(9997) * (CS - 40);
      const type = rnd(9996) < 0.5 ? 'energy' : 'speed';
      this.addTulipPickup(px, pz, type, chunkKey, objects);
    }

    // Batched static scenery: one mesh per material
    for (const mesh of batch.build(this.mats)) {
      this.scene.add(mesh);
      objects.push(mesh);
    }
    if (flowerPatches.length) {
      const flowers = makeFlowerField(flowerPatches);
      if (flowers) {
        this.scene.add(flowers);
        objects.push(flowers);
      }
    }

    // Non-batched props cast and receive shadows too
    for (const obj of objects) {
      if (obj.userData.bucket !== undefined || obj.isInstancedMesh) continue;
      obj.traverse(child => {
        if (child.isMesh) {
          child.castShadow = true;
          child.receiveShadow = true;
        }
      });
    }

    this.chunks.set(chunkKey, objects);
    this.chunkLods.set(chunkKey, lod);
    this.obstacles.set(chunkKey, colliders.filter(Boolean));
  }

  /** A line of three modern wind turbines with spinning rotors */
  addTurbineRow(batch, baseX, baseZ, seed, chunkKey, objects, colliders) {
    const CS = GAME_CONFIG.CHUNK_SIZE;
    const sx = baseX + 30 + this.seededRandom(seed) * 40;
    const sz = baseZ + 30 + this.seededRandom(seed + 1) * 40;
    const dir = this.seededRandom(seed + 2) * Math.PI * 0.5;
    const ry = this.seededRandom(seed + 3) * Math.PI * 2;
    for (let i = 0; i < 3; i++) {
      const x = sx + Math.cos(dir) * i * 55;
      const z = sz + Math.sin(dir) * i * 55;
      const t = addTurbine(batch, this.mats, x, z, ry, 40 + this.seededRandom(seed + 4 + i) * 8);
      t.rotor.traverse(c => { if (c.isMesh) { c.castShadow = true; } });
      this.scene.add(t.rotor);
      objects.push(t.rotor);
      colliders.push(t.collider);
      this.registerAmbient(chunkKey, { mesh: t.rotor, type: 'turbine' });
    }
    this.registerLandmark(chunkKey, sx + Math.cos(dir) * 55, sz + Math.sin(dir) * 55, '🌬️', 'Wind Farm', 'Westerhaven money. Oostwijk says it spoils the view; Oostwijk flies through it anyway.');
  }

  registerLandmark(chunkKey, x, z, icon, name, subtitle) {
    if (!this.chunkLandmarks.has(chunkKey)) this.chunkLandmarks.set(chunkKey, []);
    this.chunkLandmarks.get(chunkKey).push({ id: `${name}@${chunkKey}`, x, z, icon, name, subtitle });
  }

  /**
   * A giant glowing tulip on a tall stem, with a floating halo ring at
   * flight height. Fly through the ring to collect it.
   * 'energy' (blue) refills boost energy; 'speed' (gold) grants a surge.
   */
  addTulipPickup(x, z, type, chunkKey, objects) {
    const color = type === 'energy' ? 0x00BFFF : 0xFFD700;
    const group = new THREE.Group();

    // Tall stem reaching up toward flight height
    const stemGeo = new THREE.CylinderGeometry(0.4, 0.7, GAME_CONFIG.FLIGHT_HEIGHT - 6, 6);
    const stemMat = new THREE.MeshStandardMaterial({ color: 0x2E8B57 });
    const stem = new THREE.Mesh(stemGeo, stemMat);
    stem.position.y = (GAME_CONFIG.FLIGHT_HEIGHT - 6) / 2;
    group.add(stem);

    // Tulip head: cup of petals
    const petalMat = new THREE.MeshStandardMaterial({
      color, emissive: color, emissiveIntensity: 0.6,
    });
    for (let i = 0; i < 5; i++) {
      const angle = (i / 5) * Math.PI * 2;
      const petalGeo = new THREE.ConeGeometry(1.6, 4.5, 6);
      const petal = new THREE.Mesh(petalGeo, petalMat);
      petal.position.set(Math.cos(angle) * 1.3, GAME_CONFIG.FLIGHT_HEIGHT - 4, Math.sin(angle) * 1.3);
      petal.rotation.x = Math.sin(angle) * 0.35;
      petal.rotation.z = -Math.cos(angle) * 0.35;
      group.add(petal);
    }

    // Floating halo ring at flight height — the visual "fly through here"
    const ringGeo = new THREE.TorusGeometry(7, 0.5, 8, 32);
    const ringMat = new THREE.MeshStandardMaterial({
      color, emissive: color, emissiveIntensity: 1.2,
      transparent: true, opacity: 0.85,
    });
    const ring = new THREE.Mesh(ringGeo, ringMat);
    ring.position.y = GAME_CONFIG.FLIGHT_HEIGHT;
    ring.rotation.x = Math.PI / 2;
    group.add(ring);
    group.userData.ring = ring;

    group.position.set(x, 0, z);
    this.scene.add(group);
    objects.push(group);

    if (!this.powerups.has(chunkKey)) this.powerups.set(chunkKey, []);
    this.powerups.get(chunkKey).push({ mesh: group, type, active: true, x, z });
  }

  /**
   * Spin halo rings and check whether the local player flew through one
   */
  updatePowerups(delta, ship) {
    for (const [, list] of this.powerups) {
      for (const p of list) {
        if (!p.active) continue;
        if (p.mesh.userData.ring) p.mesh.userData.ring.rotation.z += delta * 1.5;

        if (ship) {
          const dx = ship.position.x - p.x;
          const dz = ship.position.z - p.z;
          const dy = ship.position.y - GAME_CONFIG.FLIGHT_HEIGHT; // rings float at flight height
          if (dx * dx + dz * dz < GAME_CONFIG.PICKUP_RADIUS * GAME_CONFIG.PICKUP_RADIUS &&
              Math.abs(dy) < 14) {
            p.active = false;
            p.mesh.visible = false;
            this.collectPowerup(p.type);
          }
        }
      }
    }
  }

  collectPowerup(type) {
    if (type === 'energy') {
      if (this.localPlayer) this.localPlayer.energy = 100;
      this.updateEnergyBar(100);
    } else if (type === 'speed') {
      this.speedSurge = GAME_CONFIG.SPEED_SURGE_DURATION;
    }
    this.playSound('pickup');
    this.displayChatMessage('🌷', type === 'energy'
      ? 'Blue tulip! Energy restored!'
      : 'Golden tulip! Speed surge!');
  }

  // --- Reusable scenery helpers ---

  registerAmbient(chunkKey, entry) {
    if (!this.ambient.has(chunkKey)) this.ambient.set(chunkKey, []);
    this.ambient.get(chunkKey).push(entry);
  }

  /**
   * Merge many colored primitive parts into ONE mesh (single draw call)
   * using vertex colors. parts: [{geo, color, x, y, z, ry?, sx?, sy?, sz?}]
   */
  buildMergedMesh(parts) {
    const geos = parts.map(p => {
      const g = p.geo;
      if (p.sx || p.sy || p.sz) g.scale(p.sx || 1, p.sy || 1, p.sz || 1);
      if (p.rx) g.rotateX(p.rx);
      if (p.ry) g.rotateY(p.ry);
      if (p.rz) g.rotateZ(p.rz);
      g.translate(p.x || 0, p.y || 0, p.z || 0);
      const color = new THREE.Color(p.color);
      const count = g.attributes.position.count;
      const colors = new Float32Array(count * 3);
      for (let i = 0; i < count; i++) {
        colors[i * 3] = color.r;
        colors[i * 3 + 1] = color.g;
        colors[i * 3 + 2] = color.b;
      }
      g.setAttribute('color', new THREE.BufferAttribute(colors, 3));
      return g;
    });
    const merged = mergeGeometries(geos);
    geos.forEach(g => g.dispose());
    return new THREE.Mesh(merged, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.9 }));
  }

  /**
   * Iconic Dutch striped tulip field: parallel bands of vivid color,
   * merged into a single mesh (one draw call)
   */
  addTulipField(x, z, seed, objects) {
    const palette = [0xE8384F, 0xFFD23F, 0xFF69B4, 0x9B59B6, 0xFF8C42, 0xF8F8FF, 0xE8384F, 0xFFD23F];
    const numStripes = 6 + Math.floor(this.seededRandom(seed + 5) * 3);
    const stripeW = 5 + this.seededRandom(seed + 6) * 3;
    const length = 45 + this.seededRandom(seed + 7) * 35;
    const startColor = Math.floor(this.seededRandom(seed + 8) * palette.length);

    const parts = [];
    for (let i = 0; i < numStripes; i++) {
      parts.push({
        geo: new THREE.PlaneGeometry(stripeW - 0.6, length),
        color: palette[(startColor + i) % palette.length],
        rx: -Math.PI / 2,
        x: (i - numStripes / 2) * stripeW,
        y: 0.45,
      });
    }

    const field = this.buildMergedMesh(parts);
    field.position.set(x, 0, z);
    field.rotation.y = this.seededRandom(seed + 9) * Math.PI;
    this.scene.add(field);
    objects.push(field);
  }

  /**
   * A whole herd (cows or sheep) merged into a single mesh — one draw call
   * regardless of herd size
   */
  addHerd(hx, hz, count, kind, seed, objects) {
    const parts = [];
    for (let i = 0; i < count; i++) {
      const s = seed + i * 13;
      const ax = (this.seededRandom(s + 1) - 0.5) * 35;
      const az = (this.seededRandom(s + 2) - 0.5) * 35;
      const ry = this.seededRandom(s + 4) * Math.PI * 2;

      if (kind === 'cow') {
        parts.push(
          { geo: new THREE.BoxGeometry(3.2, 1.8, 1.6), color: 0xF5F5F5, x: ax, y: 1.6, z: az, ry },
          { geo: new THREE.BoxGeometry(1.4, 1.9, 1.7), color: 0x1a1a1a,
            x: ax + Math.cos(ry) * 0.8, y: 1.6, z: az - Math.sin(ry) * 0.8, ry },
          { geo: new THREE.BoxGeometry(1.0, 1.0, 0.9), color: 0xF5F5F5,
            x: ax + Math.cos(ry) * 2.0, y: 2.1, z: az - Math.sin(ry) * 2.0, ry }
        );
      } else {
        parts.push(
          { geo: new THREE.SphereGeometry(1.2, 6, 5), color: 0xFFFAF0, sx: 1.3, x: ax, y: 1.2, z: az, ry },
          { geo: new THREE.SphereGeometry(0.5, 5, 4), color: 0x2F2F2F,
            x: ax + Math.cos(ry) * 1.5, y: 1.4, z: az - Math.sin(ry) * 1.5 }
        );
      }
    }

    const herd = this.buildMergedMesh(parts);
    herd.position.set(hx, 0, hz);
    this.scene.add(herd);
    objects.push(herd);
  }

  addHotAirBalloon(x, z, seed, chunkKey, objects) {
    const colors = [0xE8384F, 0xFFD23F, 0x3EA8FF, 0x2ECC71, 0xFF8C42, 0x9B59B6];
    const color = colors[Math.floor(this.seededRandom(seed) * colors.length)];
    const group = new THREE.Group();

    const envelope = new THREE.Mesh(
      new THREE.SphereGeometry(7, 12, 10),
      new THREE.MeshStandardMaterial({ color, roughness: 0.6 })
    );
    envelope.scale.y = 1.15;
    group.add(envelope);

    // Contrasting vertical gore stripe
    const stripe = new THREE.Mesh(
      new THREE.SphereGeometry(7.05, 12, 10, 0, Math.PI / 4),
      new THREE.MeshStandardMaterial({ color: 0xFFFAF0, roughness: 0.6 })
    );
    stripe.scale.y = 1.15;
    group.add(stripe);

    const basket = new THREE.Mesh(
      new THREE.BoxGeometry(2.4, 1.8, 2.4),
      new THREE.MeshStandardMaterial({ color: 0x8B5A2B })
    );
    basket.position.y = -10.5;
    group.add(basket);

    const height = 55 + this.seededRandom(seed + 2) * 35;
    group.position.set(x, height, z);
    this.scene.add(group);
    objects.push(group);

    this.registerAmbient(chunkKey, {
      mesh: group, type: 'balloon',
      baseY: height,
      phase: this.seededRandom(seed + 3) * Math.PI * 2,
      driftAngle: this.seededRandom(seed + 4) * Math.PI * 2,
      anchorX: x, anchorZ: z,
    });
  }

  addRowboat(x, z, pondRadius, chunkKey, objects, seed) {
    const group = new THREE.Group();
    const hull = new THREE.Mesh(
      new THREE.BoxGeometry(4.5, 1, 1.8),
      new THREE.MeshStandardMaterial({ color: 0x7B4A2D })
    );
    hull.position.y = 0.4;
    group.add(hull);
    const bow = new THREE.Mesh(
      new THREE.ConeGeometry(0.9, 1.6, 4),
      new THREE.MeshStandardMaterial({ color: 0x7B4A2D })
    );
    bow.rotation.z = -Math.PI / 2;
    bow.position.set(3.0, 0.4, 0);
    group.add(bow);

    const ox = x + (this.seededRandom(seed + 20) - 0.5) * pondRadius * 0.6;
    const oz = z + (this.seededRandom(seed + 21) - 0.5) * pondRadius * 0.6;
    group.position.set(ox, 0.1, oz);
    group.rotation.y = this.seededRandom(seed + 22) * Math.PI * 2;
    this.scene.add(group);
    objects.push(group);

    this.registerAmbient(chunkKey, {
      mesh: group, type: 'boat',
      phase: this.seededRandom(seed + 23) * Math.PI * 2,
    });
  }

  addCastle(x, z, objects, colliders) {
    const group = new THREE.Group();
    const stone = new THREE.MeshStandardMaterial({ color: 0x9E9E8E, roughness: 0.9 });
    const roofMat = new THREE.MeshStandardMaterial({ color: 0x8B2500 });

    // Four corner towers + conical roofs
    const towerOffsets = [[-14, -14], [14, -14], [-14, 14], [14, 14]];
    for (const [tx, tz] of towerOffsets) {
      const tower = new THREE.Mesh(new THREE.CylinderGeometry(3.5, 4, 22, 8), stone);
      tower.position.set(tx, 11, tz);
      group.add(tower);
      const roof = new THREE.Mesh(new THREE.ConeGeometry(4.5, 7, 8), roofMat);
      roof.position.set(tx, 25.5, tz);
      group.add(roof);
    }

    // Curtain walls
    for (const [wx, wz, ww, wd] of [[0, -14, 28, 3], [0, 14, 28, 3], [-14, 0, 3, 28], [14, 0, 3, 28]]) {
      const wall = new THREE.Mesh(new THREE.BoxGeometry(ww, 12, wd), stone);
      wall.position.set(wx, 6, wz);
      group.add(wall);
    }

    // Central keep with banner
    const keep = new THREE.Mesh(new THREE.BoxGeometry(10, 18, 10), stone);
    keep.position.y = 9;
    group.add(keep);
    const keepRoof = new THREE.Mesh(new THREE.ConeGeometry(8, 8, 4), roofMat);
    keepRoof.position.y = 22;
    keepRoof.rotation.y = Math.PI / 4;
    group.add(keepRoof);
    const banner = new THREE.Mesh(
      new THREE.PlaneGeometry(3, 2),
      new THREE.MeshStandardMaterial({ color: 0xE8384F, side: THREE.DoubleSide })
    );
    banner.position.set(1.5, 28, 0);
    group.add(banner);

    group.position.set(x, 0, z);
    this.scene.add(group);
    objects.push(group);
    colliders.push({ x, z, radius: 22, topY: 26 });
  }

  addLighthouse(x, z, chunkKey, objects, colliders) {
    const group = new THREE.Group();

    // Striped tower: alternating red/white segments
    for (let i = 0; i < 5; i++) {
      const seg = new THREE.Mesh(
        new THREE.CylinderGeometry(2.6 - i * 0.25, 2.8 - i * 0.25, 7, 10),
        new THREE.MeshStandardMaterial({ color: i % 2 === 0 ? 0xE8384F : 0xFFFAF0 })
      );
      seg.position.y = 3.5 + i * 7;
      group.add(seg);
    }

    // Lamp room
    const lamp = new THREE.Mesh(
      new THREE.CylinderGeometry(1.8, 1.8, 3, 8),
      new THREE.MeshStandardMaterial({ color: 0xFFFF99, emissive: 0xFFFF66, emissiveIntensity: 1.5 })
    );
    lamp.position.y = 37;
    group.add(lamp);
    const cap = new THREE.Mesh(
      new THREE.ConeGeometry(2.4, 3, 8),
      new THREE.MeshStandardMaterial({ color: 0x333333 })
    );
    cap.position.y = 40;
    group.add(cap);

    // Rotating light beam
    const beam = new THREE.Mesh(
      new THREE.BoxGeometry(60, 0.6, 2),
      new THREE.MeshStandardMaterial({
        color: 0xFFFFAA, emissive: 0xFFFF88, emissiveIntensity: 1.2,
        transparent: true, opacity: 0.45,
      })
    );
    beam.position.y = 37;
    group.add(beam);

    // Surrounding lake
    const lake = new THREE.Mesh(
      new THREE.CircleGeometry(35, 24),
      new THREE.MeshStandardMaterial({ color: 0x2E6B8A, roughness: 0.3, metalness: 0.4 })
    );
    lake.rotation.x = -Math.PI / 2;
    lake.position.y = 0.22;
    group.add(lake);

    group.position.set(x, 0, z);
    this.scene.add(group);
    objects.push(group);
    colliders.push({ x, z, radius: 4, topY: 41 });

    this.registerAmbient(chunkKey, { mesh: beam, type: 'lightbeam' });
  }

  /**
   * A flock of birds in V formation that lazily orbits near the player
   */
  createBirdFlock() {
    const flock = new THREE.Group();
    const birdMat = new THREE.MeshStandardMaterial({ color: 0x2F2F2F, side: THREE.DoubleSide });
    const offsets = [[0, 0], [-3, 3], [3, 3], [-6, 6], [6, 6], [-9, 9], [9, 9]];

    for (const [ox, oz] of offsets) {
      const bird = new THREE.Group();
      for (const side of [-1, 1]) {
        const wing = new THREE.Mesh(new THREE.PlaneGeometry(2.2, 0.7), birdMat);
        wing.position.x = side * 1.05;
        wing.rotation.x = -Math.PI / 2;
        bird.add(wing);
        bird.userData[side === -1 ? 'leftWing' : 'rightWing'] = wing;
      }
      bird.position.set(ox, Math.random() * 1.5, oz);
      flock.add(bird);
    }

    this.scene.add(flock);
    this.birdFlock = flock;
  }

  /**
   * Per-frame updates for ambient scenery: balloons bob and drift,
   * boats rock, lighthouse beams sweep, birds orbit and flap
   */
  updateAmbient(delta) {
    const t = this.animationTime;

    for (const [, list] of this.ambient) {
      for (const a of list) {
        if (a.type === 'balloon') {
          a.mesh.position.y = a.baseY + Math.sin(t * 0.4 + a.phase) * 3;
          a.mesh.position.x = a.anchorX + Math.cos(t * 0.05 + a.phase) * 15;
          a.mesh.position.z = a.anchorZ + Math.sin(t * 0.05 + a.phase) * 15;
        } else if (a.type === 'boat') {
          a.mesh.rotation.z = Math.sin(t * 1.2 + a.phase) * 0.06;
          a.mesh.rotation.x = Math.cos(t * 0.9 + a.phase) * 0.04;
        } else if (a.type === 'lightbeam') {
          a.mesh.rotation.y = t * 0.8;
        } else if (a.type === 'turbine') {
          a.mesh.rotation.z += delta * (0.5 + this.wind.speed * 0.09);
        } else if (a.type === 'sails') {
          a.mesh.rotation.z += delta * (0.25 + this.wind.speed * 0.03);
        } else if (a.type === 'car') {
          a.pos += a.dir * a.speed * delta;
          if (a.pos > a.max) a.pos = a.min;
          if (a.pos < a.min) a.pos = a.max;
          if (a.axis === 'x') {
            a.mesh.position.set(a.pos, 0.5, a.lane);
            a.mesh.rotation.y = a.dir > 0 ? 0 : Math.PI;
          } else {
            a.mesh.position.set(a.lane, 0.5, a.pos);
            a.mesh.rotation.y = a.dir > 0 ? -Math.PI / 2 : Math.PI / 2;
          }
        }
      }
    }

    // Bird flock: orbits a point that follows the player
    if (this.birdFlock && this.localPlayer) {
      const ship = this.players.get(this.localPlayer.id);
      if (ship) {
        this.birdAnchor.lerp(ship.position, Math.min(1, delta * 0.3));
        this.birdAngle += delta * 0.12;
        this.birdFlock.position.set(
          this.birdAnchor.x + Math.cos(this.birdAngle) * 130,
          46 + Math.sin(t * 0.3) * 4,
          this.birdAnchor.z + Math.sin(this.birdAngle) * 130
        );
        this.birdFlock.rotation.y = -this.birdAngle - Math.PI / 2;

        const flap = Math.sin(t * 9) * 0.55;
        for (const bird of this.birdFlock.children) {
          if (bird.userData.leftWing) bird.userData.leftWing.rotation.y = flap;
          if (bird.userData.rightWing) bird.userData.rightWing.rotation.y = -flap;
        }
      }
    }
  }

  addWindmill(wx, wz, objects, colliders) {
    if (this.models.windmill) {
      const model = this.cloneModel('windmill');
      model.position.set(wx, 0, wz);
      model.rotation.y = this.seededRandom(wx * 13 + wz * 7) * Math.PI * 2;
      let sails = null;
      model.traverse((c) => { if (c.name === 'Sails') sails = c; });
      this.scene.add(model);
      objects.push(model);
      if (sails) this.registerAmbient('static', { mesh: sails, type: 'sails' });
      colliders.push({ x: wx, z: wz, radius: 7, topY: 36 });
      return;
    }
    const towerGeo = new THREE.CylinderGeometry(3, 4, 25, 8);
    const towerMat = new THREE.MeshStandardMaterial({ color: 0xF5F5DC, roughness: 0.6 });
    const tower = new THREE.Mesh(towerGeo, towerMat);
    tower.position.set(wx, 12.5, wz);
    this.scene.add(tower);
    objects.push(tower);

    const capGeo = new THREE.ConeGeometry(4, 5, 8);
    const capMat = new THREE.MeshStandardMaterial({ color: 0x8B0000, roughness: 0.7 });
    const cap = new THREE.Mesh(capGeo, capMat);
    cap.position.set(wx, 27, wz);
    this.scene.add(cap);
    objects.push(cap);

    const bladesGroup = new THREE.Group();
    for (let b = 0; b < 4; b++) {
      const bladeGeo = new THREE.BoxGeometry(1, 12, 0.3);
      const bladeMat = new THREE.MeshStandardMaterial({ color: 0xDEB887 });
      const blade = new THREE.Mesh(bladeGeo, bladeMat);
      blade.position.y = 6;
      blade.rotation.z = (b * Math.PI) / 2;
      bladesGroup.add(blade);
    }
    bladesGroup.position.set(wx, 25, wz - 4.5);
    this.scene.add(bladesGroup);
    objects.push(bladesGroup);

    colliders.push({ x: wx, z: wz, radius: 8, topY: 32 });
  }

  addChurch(cx, cz, objects, colliders) {
    // Main building
    const bodyGeo = new THREE.BoxGeometry(12, 12, 20);
    const bodyMat = new THREE.MeshStandardMaterial({ color: 0xD2B48C, roughness: 0.75 });
    const body = new THREE.Mesh(bodyGeo, bodyMat);
    body.position.set(cx, 6, cz);
    this.scene.add(body);
    objects.push(body);

    // Steep roof
    const roofGeo = new THREE.ConeGeometry(10, 6, 4);
    const roofMat = new THREE.MeshStandardMaterial({ color: 0x2F4F4F, roughness: 0.6 });
    const roof = new THREE.Mesh(roofGeo, roofMat);
    roof.position.set(cx, 15, cz);
    roof.rotation.y = Math.PI / 4;
    this.scene.add(roof);
    objects.push(roof);

    // Tall steeple/spire
    const steepleGeo = new THREE.CylinderGeometry(1.5, 2, 20, 8);
    const steepleMat = new THREE.MeshStandardMaterial({ color: 0xD2B48C, roughness: 0.7 });
    const steeple = new THREE.Mesh(steepleGeo, steepleMat);
    steeple.position.set(cx, 22, cz - 8);
    this.scene.add(steeple);
    objects.push(steeple);

    const spireGeo = new THREE.ConeGeometry(2, 10, 8);
    const spireMat = new THREE.MeshStandardMaterial({ color: 0x2F4F4F, roughness: 0.5 });
    const spire = new THREE.Mesh(spireGeo, spireMat);
    spire.position.set(cx, 37, cz - 8);
    this.scene.add(spire);
    objects.push(spire);

    colliders.push({ x: cx, z: cz, radius: 12, topY: 18 });
    colliders.push({ x: cx, z: cz - 8, radius: 3, topY: 42 });
  }
}
