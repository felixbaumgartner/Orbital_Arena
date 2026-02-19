import * as THREE from 'three';
import { io } from 'socket.io-client';

// Game constants
const GAME_CONFIG = {
  CAMERA_FOV: 75,
  CAMERA_NEAR: 0.1,
  CAMERA_FAR: 2000,
  CAMERA_DISTANCE: 20,
  CAMERA_HEIGHT: 10,

  CHUNK_SIZE: 200,
  VIEW_DISTANCE: 2,
  FOG_NEAR: 200,
  FOG_FAR: 700,
  GROUND_SIZE: 2000,

  PROJECTILE_DESPAWN_DIST: 250,

  FLIGHT_HEIGHT: 30,
  PLANE_COLLISION_RADIUS: 4,
  CRASH_DURATION: 3000,
  CRASH_HEALTH_PENALTY: 30,
  PROJECTILE_SPEED: 120,
  FIRE_COOLDOWN: 0.25,

  // Contrails & Smoke
  TRAIL_MAX_POINTS: 80,
  SMOKE_HEALTH_THRESHOLD: 50,
  FIRE_HEALTH_THRESHOLD: 25,
  SMOKE_SPAWN_RATE: 0.08,

  // Weather
  WEATHER_HOLD_MIN: 40,
  WEATHER_HOLD_MAX: 70,
  WEATHER_TRANSITION_DURATION: 10,
  RAIN_COUNT: 4000,

  // Windmill Capture
  CAPTURE_RADIUS: 50,
  CAPTURE_RING_RADIUS: 8,

  // Takeoff
  TAKEOFF_ACCEL_DURATION: 2.0,
  TAKEOFF_LIFTOFF_DURATION: 1.5,
  TAKEOFF_CLIMB_DURATION: 2.0,
  RUNWAY_LENGTH: 200,
  RUNWAY_WIDTH: 15,

  MOVEMENT_SPEED: 50,
  BOOST_SPEED: 100,
  ENERGY_DRAIN_RATE: 20,
  ENERGY_REGEN_RATE: 10,

  PROJECTILE_COLOR: 0x00ff00,

  USERNAME_MAX_LENGTH: 15,
  USERNAME_MIN_LENGTH: 1,
  CHAT_MESSAGE_MAX_LENGTH: 200,

  RECONNECT_ATTEMPTS: 5,
  RECONNECT_DELAY: 1000,
};

// Unique vibrant colors for each player
const PLAYER_COLORS = [
  0xFF3E3E, 0x3EA8FF, 0xFF9F1C, 0x2ECC71,
  0x9B59B6, 0xF1C40F, 0x1ABC9C, 0xE91E9C,
  0x00D4FF, 0xFF6B6B, 0x45B7D1, 0xFFA07A,
];

const CAPTURE_WINDMILLS = [
  { id: 'mill_n', x: 0, z: -300, name: 'North' },
  { id: 'mill_s', x: 0, z: 300, name: 'South' },
  { id: 'mill_e', x: 300, z: 0, name: 'East' },
  { id: 'mill_w', x: -300, z: 0, name: 'West' },
  { id: 'mill_c', x: 200, z: -200, name: 'Hill' },
];

class Game {
  constructor() {
    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(
      GAME_CONFIG.CAMERA_FOV,
      window.innerWidth / window.innerHeight,
      GAME_CONFIG.CAMERA_NEAR,
      GAME_CONFIG.CAMERA_FAR
    );
    this.renderer = new THREE.WebGLRenderer({ antialias: true });
    this.clock = new THREE.Clock();
    this.players = new Map();
    this.projectiles = new Map();
    this.gameState = null;
    this.localPlayer = null;
    this.socket = null;
    this.isConnected = false;
    this.reconnectAttempts = 0;
    this.controls = {
      forward: false, backward: false, left: false, right: false,
      boost: false, shooting: false, rotateLeft: false, rotateRight: false,
    };
    this.shipRotation = 0;

    // Infinite terrain
    this.chunks = new Map();
    this.obstacles = new Map();
    this.groundPlane = null;
    this.cloudGroup = null;
    this.animationTime = 0;

    // Crash state
    this.crashed = false;
    this.crashTimer = 0;

    // Shooting
    this.lastFireTime = 0;

    // Takeoff
    this.takeoffPhase = null; // 'accelerate' | 'liftoff' | 'climb' | null
    this.takeoffTimer = 0;
    this.takeoffSpeed = 0;
    this.controlsEnabled = false;

    // Contrails & smoke
    this.trails = new Map();
    this.smokeParticles = [];
    this.smokeTimer = 0;
    this.playerHealth = 100;

    // Weather
    this.weatherState = null;
    this.rainMesh = null;
    this.rainVelocities = null;

    // Windmill capture
    this.captureWindmills = new Map();
    this.windmillStates = {};

    this.init();
  }

  init() {
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    this.renderer.setPixelRatio(window.devicePixelRatio);
    document.getElementById('game-container').appendChild(this.renderer.domElement);

    this.camera.position.set(0, 50, 40);
    this.camera.lookAt(0, 0, 0);

    this.scene.background = new THREE.Color(0x87CEEB);
    this.scene.fog = new THREE.Fog(0x87CEEB, GAME_CONFIG.FOG_NEAR, GAME_CONFIG.FOG_FAR);

    const ambientLight = new THREE.AmbientLight(0xffffff, 0.7);
    this.scene.add(ambientLight);

    const sunLight = new THREE.DirectionalLight(0xffeb99, 1.2);
    sunLight.position.set(50, 100, 50);
    this.scene.add(sunLight);

    const hemiLight = new THREE.HemisphereLight(0x87CEEB, 0x4CAF50, 0.3);
    this.scene.add(hemiLight);

    this.createInfiniteTerrain();
    this.createRunway();
    this.initWeather();
    this.createCaptureWindmills();

    window.addEventListener('resize', this.onWindowResize.bind(this));
    document.addEventListener('keydown', this.onKeyDown.bind(this));
    document.addEventListener('keyup', this.onKeyUp.bind(this));

    this.setupUI();
    this.animate();
  }

  setupUI() {
    const startButton = document.getElementById('start-button');
    const usernameInput = document.getElementById('username-input');
    const loginScreen = document.getElementById('login-screen');
    const hud = document.getElementById('hud');
    const tutorial = document.getElementById('tutorial');
    const tutorialClose = document.getElementById('tutorial-close');
    const chatInput = document.getElementById('chat-input');

    startButton.addEventListener('click', () => {
      const username = this.sanitizeInput(usernameInput.value.trim());
      if (!this.isValidUsername(username)) {
        alert(`Username must be between ${GAME_CONFIG.USERNAME_MIN_LENGTH} and ${GAME_CONFIG.USERNAME_MAX_LENGTH} characters and contain only letters, numbers, and spaces.`);
        return;
      }
      this.connectToServer(username);
      loginScreen.style.display = 'none';
      hud.style.display = 'block';
      if (!localStorage.getItem('tutorialSeen')) {
        tutorial.style.display = 'block';
        localStorage.setItem('tutorialSeen', 'true');
      }
    });

    usernameInput.addEventListener('keypress', (e) => {
      if (e.key === 'Enter') startButton.click();
    });

    tutorialClose.addEventListener('click', () => {
      tutorial.style.display = 'none';
    });

    document.addEventListener('keydown', (e) => {
      if (tutorial.style.display === 'block' && (e.key === 'Escape' || e.key === 'Enter')) {
        tutorial.style.display = 'none';
        e.preventDefault();
      }
    });

    chatInput.addEventListener('keypress', (e) => {
      if (e.key === 'Enter') {
        const message = this.sanitizeInput(chatInput.value.trim());
        if (message && message.length <= GAME_CONFIG.CHAT_MESSAGE_MAX_LENGTH) {
          this.sendChatMessage(message);
          chatInput.value = '';
        }
      }
    });
  }

  isValidUsername(username) {
    if (!username || typeof username !== 'string') return false;
    if (username.length < GAME_CONFIG.USERNAME_MIN_LENGTH ||
        username.length > GAME_CONFIG.USERNAME_MAX_LENGTH) return false;
    return /^[a-zA-Z0-9 ]+$/.test(username);
  }

  sanitizeInput(input) {
    if (typeof input !== 'string') return '';
    const div = document.createElement('div');
    div.textContent = input;
    return div.innerHTML;
  }

  sendChatMessage(message) {
    if (!this.socket || !this.isConnected || !message) return;
    try {
      this.socket.emit('chatMessage', {
        gameId: this.gameState?.id,
        message: message,
        username: this.localPlayer?.username,
      });
    } catch (error) {
      console.error('Error sending chat message:', error);
    }
  }

  // =========================================================================
  // INFINITE TERRAIN WITH BIOMES
  // =========================================================================

  createInfiniteTerrain() {
    const grassGeo = new THREE.PlaneGeometry(GAME_CONFIG.GROUND_SIZE, GAME_CONFIG.GROUND_SIZE, 32, 32);
    const grassMat = new THREE.MeshStandardMaterial({ color: 0x4CAF50, roughness: 0.9 });
    this.groundPlane = new THREE.Mesh(grassGeo, grassMat);
    this.groundPlane.rotation.x = -Math.PI / 2;
    this.groundPlane.receiveShadow = true;
    this.scene.add(this.groundPlane);

    this.cloudGroup = new THREE.Group();
    this.createClouds();
    this.scene.add(this.cloudGroup);

    this.updateChunks(0, 0);
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

    const needed = new Set();
    for (let dx = -GAME_CONFIG.VIEW_DISTANCE; dx <= GAME_CONFIG.VIEW_DISTANCE; dx++) {
      for (let dz = -GAME_CONFIG.VIEW_DISTANCE; dz <= GAME_CONFIG.VIEW_DISTANCE; dz++) {
        needed.add(`${cx + dx},${cz + dz}`);
      }
    }

    for (const [key, objects] of this.chunks) {
      if (!needed.has(key)) {
        objects.forEach(obj => {
          this.scene.remove(obj);
          obj.traverse(child => {
            if (child.geometry) child.geometry.dispose();
            if (child.material) {
              if (Array.isArray(child.material)) child.material.forEach(m => m.dispose());
              else child.material.dispose();
            }
          });
        });
        this.chunks.delete(key);
        this.obstacles.delete(key);
      }
    }

    for (const key of needed) {
      if (!this.chunks.has(key)) {
        const [x, z] = key.split(',').map(Number);
        this.generateChunk(x, z);
      }
    }
  }

  generateChunk(chunkX, chunkZ) {
    const objects = [];
    const colliders = [];
    const baseX = chunkX * GAME_CONFIG.CHUNK_SIZE;
    const baseZ = chunkZ * GAME_CONFIG.CHUNK_SIZE;
    const seed = chunkX * 73856093 + chunkZ * 19349663;
    const biome = this.getBiome(chunkX, chunkZ);

    // --- Ground color patches (biome-dependent) ---
    const groundColors = {
      village: [0x3D8B37, 0x4CAF50, 0x45A049],
      farmland: [0x8B9A46, 0xBDB76B, 0xA0C850, 0xDAA520, 0xCD853F, 0x9370DB, 0xE8575A],
      waterland: [0x5B8C5A, 0x6B8E6B, 0x4A7C59],
    };
    const gColors = groundColors[biome];

    // Create 2-4 ground patches per chunk
    const numPatches = 2 + Math.floor(this.seededRandom(seed + 8000) * 3);
    for (let i = 0; i < numPatches; i++) {
      const ps = seed + 8000 + i * 50;
      const pw = 30 + this.seededRandom(ps + 1) * 80;
      const pd = 30 + this.seededRandom(ps + 2) * 80;
      const px = baseX + this.seededRandom(ps + 3) * GAME_CONFIG.CHUNK_SIZE;
      const pz = baseZ + this.seededRandom(ps + 4) * GAME_CONFIG.CHUNK_SIZE;
      const pc = gColors[Math.floor(this.seededRandom(ps + 5) * gColors.length)];

      const patchGeo = new THREE.PlaneGeometry(pw, pd);
      const patchMat = new THREE.MeshStandardMaterial({ color: pc, roughness: 0.95 });
      const patch = new THREE.Mesh(patchGeo, patchMat);
      patch.rotation.x = -Math.PI / 2;
      patch.position.set(px, 0.02, pz);
      this.scene.add(patch);
      objects.push(patch);
    }

    // --- BIOME: VILLAGE ---
    if (biome === 'village') {
      // Buildings
      const numBuildings = 2 + Math.floor(this.seededRandom(seed) * 3);
      for (let i = 0; i < numBuildings; i++) {
        const s = seed + i * 1000;
        const x = baseX + this.seededRandom(s + 1) * GAME_CONFIG.CHUNK_SIZE;
        const z = baseZ + this.seededRandom(s + 2) * GAME_CONFIG.CHUNK_SIZE;
        const w = 10 + this.seededRandom(s + 3) * 15;
        const h = 8 + this.seededRandom(s + 4) * 15;
        const d = 8 + this.seededRandom(s + 5) * 12;
        const colors = [0xD2691E, 0xCD853F, 0xBC8F8F, 0xA0522D, 0x8B4513, 0xDEB887];
        const c = colors[Math.floor(this.seededRandom(s + 6) * colors.length)];

        const wallGeo = new THREE.BoxGeometry(w, h, d);
        const wallMat = new THREE.MeshStandardMaterial({ color: c, roughness: 0.8 });
        const walls = new THREE.Mesh(wallGeo, wallMat);
        walls.position.set(x, h / 2, z);
        this.scene.add(walls);
        objects.push(walls);

        const roofGeo = new THREE.ConeGeometry(w * 0.8, h * 0.4, 4);
        const roofMat = new THREE.MeshStandardMaterial({ color: 0xB22222, roughness: 0.7 });
        const roof = new THREE.Mesh(roofGeo, roofMat);
        roof.position.set(x, h + h * 0.2, z);
        roof.rotation.y = Math.PI / 4;
        this.scene.add(roof);
        objects.push(roof);

        colliders.push({ x, z, radius: Math.max(w, d) / 2, topY: h + h * 0.4 });
      }

      // Trees
      const numTrees = 5 + Math.floor(this.seededRandom(seed + 500) * 6);
      for (let i = 0; i < numTrees; i++) {
        const s = seed + 2000 + i * 100;
        const x = baseX + this.seededRandom(s + 1) * GAME_CONFIG.CHUNK_SIZE;
        const z = baseZ + this.seededRandom(s + 2) * GAME_CONFIG.CHUNK_SIZE;
        const scale = 0.7 + this.seededRandom(s + 3) * 0.6;
        this.addTree(x, z, scale, objects, colliders);
      }

      // Windmill
      if (this.seededRandom(seed + 999) > 0.6) {
        this.addWindmill(baseX + GAME_CONFIG.CHUNK_SIZE / 2, baseZ + GAME_CONFIG.CHUNK_SIZE / 2, objects, colliders);
      }

      // Church with steeple (rare)
      if (this.seededRandom(seed + 1111) > 0.8) {
        const cx = baseX + this.seededRandom(seed + 1112) * GAME_CONFIG.CHUNK_SIZE;
        const cz = baseZ + this.seededRandom(seed + 1113) * GAME_CONFIG.CHUNK_SIZE;
        this.addChurch(cx, cz, objects, colliders);
      }
    }

    // --- BIOME: FARMLAND ---
    if (biome === 'farmland') {
      // Farm fields (colorful rectangles on ground)
      const numFields = 3 + Math.floor(this.seededRandom(seed + 100) * 3);
      for (let i = 0; i < numFields; i++) {
        const s = seed + 3000 + i * 200;
        const x = baseX + this.seededRandom(s + 1) * GAME_CONFIG.CHUNK_SIZE;
        const z = baseZ + this.seededRandom(s + 2) * GAME_CONFIG.CHUNK_SIZE;
        const fw = 25 + this.seededRandom(s + 3) * 40;
        const fd = 25 + this.seededRandom(s + 4) * 40;
        const fieldColors = [0xDAA520, 0x9370DB, 0xE8575A, 0xA0C850, 0xF0E68C, 0xFF6347];
        const fc = fieldColors[Math.floor(this.seededRandom(s + 5) * fieldColors.length)];

        const fieldGeo = new THREE.PlaneGeometry(fw, fd);
        const fieldMat = new THREE.MeshStandardMaterial({ color: fc, roughness: 0.95 });
        const field = new THREE.Mesh(fieldGeo, fieldMat);
        field.rotation.x = -Math.PI / 2;
        field.position.set(x, 0.05, z);
        this.scene.add(field);
        objects.push(field);

        // Fence around field
        const fenceMat = new THREE.MeshStandardMaterial({ color: 0x8B7355 });
        const sides = [
          { px: x, pz: z - fd / 2, w: fw, d: 0.3 },
          { px: x, pz: z + fd / 2, w: fw, d: 0.3 },
          { px: x - fw / 2, pz: z, w: 0.3, d: fd },
          { px: x + fw / 2, pz: z, w: 0.3, d: fd },
        ];
        sides.forEach(side => {
          const fGeo = new THREE.BoxGeometry(side.w, 1.5, side.d);
          const fence = new THREE.Mesh(fGeo, fenceMat);
          fence.position.set(side.px, 0.75, side.pz);
          this.scene.add(fence);
          objects.push(fence);
        });
      }

      // Hay bales
      const numBales = 3 + Math.floor(this.seededRandom(seed + 200) * 5);
      for (let i = 0; i < numBales; i++) {
        const s = seed + 4000 + i * 80;
        const x = baseX + this.seededRandom(s + 1) * GAME_CONFIG.CHUNK_SIZE;
        const z = baseZ + this.seededRandom(s + 2) * GAME_CONFIG.CHUNK_SIZE;

        const baleGeo = new THREE.CylinderGeometry(2, 2, 2.5, 12);
        const baleMat = new THREE.MeshStandardMaterial({ color: 0xD4A017, roughness: 0.95 });
        const bale = new THREE.Mesh(baleGeo, baleMat);
        bale.rotation.x = Math.PI / 2;
        bale.position.set(x, 1.25, z);
        this.scene.add(bale);
        objects.push(bale);
      }

      // Tulip/flower patches
      const numFlowerPatches = 2 + Math.floor(this.seededRandom(seed + 300) * 4);
      for (let i = 0; i < numFlowerPatches; i++) {
        const s = seed + 5000 + i * 120;
        const x = baseX + this.seededRandom(s + 1) * GAME_CONFIG.CHUNK_SIZE;
        const z = baseZ + this.seededRandom(s + 2) * GAME_CONFIG.CHUNK_SIZE;
        const flowerColors = [0xFF4444, 0xFFAA00, 0xFF69B4, 0xFFFF00, 0xFF6347, 0xDA70D6];
        const fc = flowerColors[Math.floor(this.seededRandom(s + 3) * flowerColors.length)];

        for (let f = 0; f < 15; f++) {
          const fx = x + (this.seededRandom(s + 10 + f) - 0.5) * 12;
          const fz = z + (this.seededRandom(s + 30 + f) - 0.5) * 12;
          const fGeo = new THREE.SphereGeometry(0.4, 6, 6);
          const fMat = new THREE.MeshStandardMaterial({ color: fc, emissive: fc, emissiveIntensity: 0.2 });
          const flower = new THREE.Mesh(fGeo, fMat);
          flower.position.set(fx, 0.5, fz);
          this.scene.add(flower);
          objects.push(flower);
        }
      }

      // Occasional farmhouse
      if (this.seededRandom(seed + 400) > 0.5) {
        const fhx = baseX + this.seededRandom(seed + 401) * GAME_CONFIG.CHUNK_SIZE;
        const fhz = baseZ + this.seededRandom(seed + 402) * GAME_CONFIG.CHUNK_SIZE;
        const wallGeo = new THREE.BoxGeometry(14, 8, 10);
        const wallMat = new THREE.MeshStandardMaterial({ color: 0xFFF8DC, roughness: 0.8 });
        const walls = new THREE.Mesh(wallGeo, wallMat);
        walls.position.set(fhx, 4, fhz);
        this.scene.add(walls);
        objects.push(walls);

        const roofGeo = new THREE.ConeGeometry(12, 4, 4);
        const roofMat = new THREE.MeshStandardMaterial({ color: 0x8B0000, roughness: 0.7 });
        const roof = new THREE.Mesh(roofGeo, roofMat);
        roof.position.set(fhx, 9.5, fhz);
        roof.rotation.y = Math.PI / 4;
        this.scene.add(roof);
        objects.push(roof);

        colliders.push({ x: fhx, z: fhz, radius: 8, topY: 12 });
      }

      // Some trees
      const numTrees = 2 + Math.floor(this.seededRandom(seed + 550) * 3);
      for (let i = 0; i < numTrees; i++) {
        const s = seed + 6000 + i * 100;
        const x = baseX + this.seededRandom(s + 1) * GAME_CONFIG.CHUNK_SIZE;
        const z = baseZ + this.seededRandom(s + 2) * GAME_CONFIG.CHUNK_SIZE;
        this.addTree(x, z, 0.6 + this.seededRandom(s + 3) * 0.5, objects, colliders);
      }
    }

    // --- BIOME: WATERLAND ---
    if (biome === 'waterland') {
      // Canal running through the chunk
      const canalDir = this.seededRandom(seed + 700) > 0.5; // true = X direction, false = Z direction
      const canalOffset = baseZ + this.seededRandom(seed + 701) * GAME_CONFIG.CHUNK_SIZE;
      const canalOffset2 = baseX + this.seededRandom(seed + 702) * GAME_CONFIG.CHUNK_SIZE;

      const waterMat = new THREE.MeshStandardMaterial({
        color: 0x2E86C1, roughness: 0.3, metalness: 0.4, transparent: true, opacity: 0.8,
      });

      if (canalDir) {
        const canalGeo = new THREE.PlaneGeometry(GAME_CONFIG.CHUNK_SIZE, 12);
        const canal = new THREE.Mesh(canalGeo, waterMat);
        canal.rotation.x = -Math.PI / 2;
        canal.position.set(baseX + GAME_CONFIG.CHUNK_SIZE / 2, 0.03, canalOffset);
        this.scene.add(canal);
        objects.push(canal);

        // Bridge over canal
        if (this.seededRandom(seed + 710) > 0.4) {
          const bx = baseX + this.seededRandom(seed + 711) * GAME_CONFIG.CHUNK_SIZE;
          const bridgeGeo = new THREE.BoxGeometry(8, 2, 14);
          const bridgeMat = new THREE.MeshStandardMaterial({ color: 0x808080, roughness: 0.7 });
          const bridge = new THREE.Mesh(bridgeGeo, bridgeMat);
          bridge.position.set(bx, 1, canalOffset);
          this.scene.add(bridge);
          objects.push(bridge);

          // Bridge railings
          const railGeo = new THREE.BoxGeometry(0.3, 1.5, 14);
          const railMat = new THREE.MeshStandardMaterial({ color: 0x696969 });
          const leftRail = new THREE.Mesh(railGeo, railMat);
          leftRail.position.set(bx - 3.8, 2.75, canalOffset);
          this.scene.add(leftRail);
          objects.push(leftRail);
          const rightRail = new THREE.Mesh(railGeo, railMat);
          rightRail.position.set(bx + 3.8, 2.75, canalOffset);
          this.scene.add(rightRail);
          objects.push(rightRail);
        }
      } else {
        const canalGeo = new THREE.PlaneGeometry(12, GAME_CONFIG.CHUNK_SIZE);
        const canal = new THREE.Mesh(canalGeo, waterMat);
        canal.rotation.x = -Math.PI / 2;
        canal.position.set(canalOffset2, 0.03, baseZ + GAME_CONFIG.CHUNK_SIZE / 2);
        this.scene.add(canal);
        objects.push(canal);
      }

      // Ponds
      const numPonds = 1 + Math.floor(this.seededRandom(seed + 720) * 2);
      for (let i = 0; i < numPonds; i++) {
        const s = seed + 7000 + i * 100;
        const x = baseX + this.seededRandom(s + 1) * GAME_CONFIG.CHUNK_SIZE;
        const z = baseZ + this.seededRandom(s + 2) * GAME_CONFIG.CHUNK_SIZE;
        const r = 8 + this.seededRandom(s + 3) * 12;

        const pondGeo = new THREE.CircleGeometry(r, 16);
        const pond = new THREE.Mesh(pondGeo, waterMat);
        pond.rotation.x = -Math.PI / 2;
        pond.position.set(x, 0.04, z);
        this.scene.add(pond);
        objects.push(pond);

        // Reeds around pond
        for (let j = 0; j < 8; j++) {
          const angle = (j / 8) * Math.PI * 2;
          const rx = x + Math.cos(angle) * (r + 1);
          const rz = z + Math.sin(angle) * (r + 1);

          const reedGeo = new THREE.CylinderGeometry(0.15, 0.2, 3 + this.seededRandom(s + 40 + j) * 2, 4);
          const reedMat = new THREE.MeshStandardMaterial({ color: 0x6B8E23 });
          const reed = new THREE.Mesh(reedGeo, reedMat);
          reed.position.set(rx, 1.5, rz);
          this.scene.add(reed);
          objects.push(reed);
        }
      }

      // Scattered trees (fewer)
      const numTrees = 2 + Math.floor(this.seededRandom(seed + 750) * 3);
      for (let i = 0; i < numTrees; i++) {
        const s = seed + 7500 + i * 100;
        const x = baseX + this.seededRandom(s + 1) * GAME_CONFIG.CHUNK_SIZE;
        const z = baseZ + this.seededRandom(s + 2) * GAME_CONFIG.CHUNK_SIZE;
        this.addTree(x, z, 0.8 + this.seededRandom(s + 3) * 0.4, objects, colliders);
      }

      // Windmill near water
      if (this.seededRandom(seed + 799) > 0.65) {
        this.addWindmill(baseX + this.seededRandom(seed + 800) * GAME_CONFIG.CHUNK_SIZE,
                         baseZ + this.seededRandom(seed + 801) * GAME_CONFIG.CHUNK_SIZE,
                         objects, colliders);
      }
    }

    this.chunks.set(`${chunkX},${chunkZ}`, objects);
    this.obstacles.set(`${chunkX},${chunkZ}`, colliders);
  }

  // --- Reusable scenery helpers ---

  addTree(x, z, scale, objects, colliders) {
    const trunkGeo = new THREE.CylinderGeometry(1 * scale, 1.5 * scale, 8 * scale);
    const trunkMat = new THREE.MeshStandardMaterial({ color: 0x8B4513 });
    const trunk = new THREE.Mesh(trunkGeo, trunkMat);
    trunk.position.set(x, 4 * scale, z);
    this.scene.add(trunk);
    objects.push(trunk);

    const foliageGeo = new THREE.SphereGeometry(6 * scale, 8, 8);
    const green = Math.random() > 0.5 ? 0x228B22 : 0x2E8B57;
    const foliageMat = new THREE.MeshStandardMaterial({ color: green, roughness: 0.9 });
    const foliage = new THREE.Mesh(foliageGeo, foliageMat);
    foliage.position.set(x, 12 * scale, z);
    this.scene.add(foliage);
    objects.push(foliage);

    colliders.push({ x, z, radius: 6 * scale, topY: (12 + 6) * scale });
  }

  addWindmill(wx, wz, objects, colliders) {
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

  createClouds() {
    for (let i = 0; i < 10; i++) {
      const cloudSubGroup = new THREE.Group();
      for (let j = 0; j < 5; j++) {
        const cloudGeo = new THREE.SphereGeometry(8 + Math.random() * 6, 8, 8);
        const cloudMat = new THREE.MeshStandardMaterial({
          color: 0xFFFFFF, transparent: true, opacity: 0.8, roughness: 1,
        });
        const cloudPart = new THREE.Mesh(cloudGeo, cloudMat);
        cloudPart.position.set(
          (Math.random() - 0.5) * 15,
          (Math.random() - 0.5) * 5,
          (Math.random() - 0.5) * 15
        );
        cloudSubGroup.add(cloudPart);
      }
      cloudSubGroup.position.set(
        (Math.random() - 0.5) * 800,
        55 + Math.random() * 30,
        (Math.random() - 0.5) * 800
      );
      this.cloudGroup.add(cloudSubGroup);
    }
  }

  // =========================================================================
  // CONTRAILS & SMOKE TRAILS
  // =========================================================================

  createTrail(playerId) {
    const maxPoints = GAME_CONFIG.TRAIL_MAX_POINTS;
    const posArray = new Float32Array(maxPoints * 3);
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(posArray, 3));
    geo.setDrawRange(0, 0);

    const mat = new THREE.LineBasicMaterial({
      color: 0xffffff, transparent: true, opacity: 0.3,
    });

    const line = new THREE.Line(geo, mat);
    this.scene.add(line);
    this.trails.set(playerId, { line, points: [], maxPoints });
  }

  updateTrail(playerId, position) {
    const trail = this.trails.get(playerId);
    if (!trail) return;

    trail.points.push(position.clone());
    if (trail.points.length > trail.maxPoints) trail.points.shift();

    const arr = trail.line.geometry.attributes.position.array;
    for (let i = 0; i < trail.points.length; i++) {
      arr[i * 3] = trail.points[i].x;
      arr[i * 3 + 1] = trail.points[i].y;
      arr[i * 3 + 2] = trail.points[i].z;
    }
    trail.line.geometry.attributes.position.needsUpdate = true;
    trail.line.geometry.setDrawRange(0, trail.points.length);
  }

  removeTrail(playerId) {
    const trail = this.trails.get(playerId);
    if (trail) {
      this.scene.remove(trail.line);
      trail.line.geometry.dispose();
      trail.line.material.dispose();
      this.trails.delete(playerId);
    }
  }

  spawnSmokeParticle(position, isFire) {
    const size = 0.3 + Math.random() * 0.5;
    const geo = new THREE.SphereGeometry(size, 4, 4);
    const color = isFire ? (Math.random() > 0.5 ? 0xFF4400 : 0xFF8800) : 0x555555;
    const mat = new THREE.MeshBasicMaterial({
      color, transparent: true, opacity: isFire ? 0.8 : 0.6,
    });
    const p = new THREE.Mesh(geo, mat);
    p.position.copy(position);
    p.position.x += (Math.random() - 0.5) * 2;
    p.position.z += (Math.random() - 0.5) * 2;
    p.userData.vel = new THREE.Vector3(
      (Math.random() - 0.5) * 3, 1 + Math.random() * 2, (Math.random() - 0.5) * 3
    );
    p.userData.life = 1.0 + Math.random() * 0.5;
    p.userData.maxLife = p.userData.life;
    this.scene.add(p);
    this.smokeParticles.push(p);
  }

  updateSmokeParticles(delta) {
    for (let i = this.smokeParticles.length - 1; i >= 0; i--) {
      const p = this.smokeParticles[i];
      p.userData.life -= delta;
      if (p.userData.life <= 0) {
        this.scene.remove(p);
        p.geometry.dispose();
        p.material.dispose();
        this.smokeParticles.splice(i, 1);
        continue;
      }
      const t = p.userData.life / p.userData.maxLife;
      p.material.opacity = t * 0.6;
      p.scale.setScalar(1 + (1 - t) * 2.5);
      p.position.addScaledVector(p.userData.vel, delta);
    }
  }

  // =========================================================================
  // DYNAMIC WEATHER
  // =========================================================================

  initWeather() {
    this.weatherState = {
      current: 'clear',
      next: null,
      progress: 0,
      timer: 0,
      holdDuration: GAME_CONFIG.WEATHER_HOLD_MIN +
        Math.random() * (GAME_CONFIG.WEATHER_HOLD_MAX - GAME_CONFIG.WEATHER_HOLD_MIN),
      transitioning: false,
      index: 0,
    };

    this.weatherPresets = {
      clear:  { fogNear: 200, fogFar: 700, sky: 0x87CEEB, rain: 0 },
      cloudy: { fogNear: 150, fogFar: 500, sky: 0x8899AA, rain: 0 },
      rainy:  { fogNear: 80,  fogFar: 350, sky: 0x556677, rain: 1 },
      foggy:  { fogNear: 30,  fogFar: 180, sky: 0x999999, rain: 0 },
    };

    this.weatherCycle = ['clear', 'cloudy', 'rainy', 'cloudy', 'foggy', 'cloudy'];

    this.createRainSystem();
  }

  createRainSystem() {
    const count = GAME_CONFIG.RAIN_COUNT;
    const positions = new Float32Array(count * 3);
    this.rainVelocities = [];

    for (let i = 0; i < count; i++) {
      positions[i * 3] = (Math.random() - 0.5) * 300;
      positions[i * 3 + 1] = Math.random() * 80;
      positions[i * 3 + 2] = (Math.random() - 0.5) * 300;
      this.rainVelocities.push(40 + Math.random() * 30);
    }

    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));

    const mat = new THREE.PointsMaterial({
      color: 0xaabbcc, size: 0.4, transparent: true, opacity: 0,
    });

    this.rainMesh = new THREE.Points(geo, mat);
    this.scene.add(this.rainMesh);
  }

  updateWeather(delta) {
    const ws = this.weatherState;
    if (!ws) return;
    ws.timer += delta;

    if (!ws.transitioning) {
      if (ws.timer >= ws.holdDuration) {
        ws.transitioning = true;
        ws.timer = 0;
        ws.index = (ws.index + 1) % this.weatherCycle.length;
        ws.next = this.weatherCycle[ws.index];
      }
    } else {
      ws.progress = Math.min(1, ws.timer / GAME_CONFIG.WEATHER_TRANSITION_DURATION);
      const from = this.weatherPresets[ws.current];
      const to = this.weatherPresets[ws.next];
      const t = ws.progress;

      this.scene.fog.near = from.fogNear + (to.fogNear - from.fogNear) * t;
      this.scene.fog.far = from.fogFar + (to.fogFar - from.fogFar) * t;

      const fromC = new THREE.Color(from.sky);
      const toC = new THREE.Color(to.sky);
      this.scene.background = fromC.clone().lerp(toC, t);
      this.scene.fog.color.copy(this.scene.background);

      this.rainMesh.material.opacity = (from.rain + (to.rain - from.rain) * t) * 0.6;

      if (ws.progress >= 1) {
        ws.current = ws.next;
        ws.next = null;
        ws.transitioning = false;
        ws.progress = 0;
        ws.timer = 0;
        ws.holdDuration = GAME_CONFIG.WEATHER_HOLD_MIN +
          Math.random() * (GAME_CONFIG.WEATHER_HOLD_MAX - GAME_CONFIG.WEATHER_HOLD_MIN);
      }
    }

    // Animate rain
    if (this.rainMesh.material.opacity > 0.01) {
      const pos = this.rainMesh.geometry.attributes.position.array;
      for (let i = 0; i < this.rainVelocities.length; i++) {
        pos[i * 3 + 1] -= this.rainVelocities[i] * delta;
        if (pos[i * 3 + 1] < 0) {
          pos[i * 3 + 1] = 60 + Math.random() * 20;
          pos[i * 3] = (Math.random() - 0.5) * 300;
          pos[i * 3 + 2] = (Math.random() - 0.5) * 300;
        }
      }
      this.rainMesh.geometry.attributes.position.needsUpdate = true;
    }

    // Move rain with player
    const ship = this.localPlayer ? this.players.get(this.localPlayer.id) : null;
    if (ship) {
      this.rainMesh.position.x = ship.position.x;
      this.rainMesh.position.z = ship.position.z;
    }

    // Update HUD indicator
    const el = document.getElementById('weather-indicator');
    if (el) {
      const icons = { clear: 'Clear', cloudy: 'Cloudy', foggy: 'Foggy', rainy: 'Rain' };
      el.textContent = icons[ws.current] || '';
    }
  }

  // =========================================================================
  // CAPTURE THE WINDMILL
  // =========================================================================

  createCaptureWindmills() {
    for (const config of CAPTURE_WINDMILLS) {
      const group = new THREE.Group();
      group.position.set(config.x, 0, config.z);

      // Tower
      const towerGeo = new THREE.CylinderGeometry(3, 4, 25, 8);
      const towerMat = new THREE.MeshStandardMaterial({ color: 0xF5F5DC, roughness: 0.6 });
      const tower = new THREE.Mesh(towerGeo, towerMat);
      tower.position.y = 12.5;
      group.add(tower);

      // Cap
      const capGeo = new THREE.ConeGeometry(4, 5, 8);
      const capMat = new THREE.MeshStandardMaterial({ color: 0x8B0000, roughness: 0.7 });
      const cap = new THREE.Mesh(capGeo, capMat);
      cap.position.y = 27;
      group.add(cap);

      // Blades
      const bladesGroup = new THREE.Group();
      for (let b = 0; b < 4; b++) {
        const bladeGeo = new THREE.BoxGeometry(1, 12, 0.3);
        const bladeMat = new THREE.MeshStandardMaterial({ color: 0xDEB887 });
        const blade = new THREE.Mesh(bladeGeo, bladeMat);
        blade.position.y = 6;
        blade.rotation.z = (b * Math.PI) / 2;
        bladesGroup.add(blade);
      }
      bladesGroup.position.set(0, 25, -4.5);
      group.add(bladesGroup);

      // Capture ring on ground
      const ringGeo = new THREE.RingGeometry(
        GAME_CONFIG.CAPTURE_RING_RADIUS - 0.5,
        GAME_CONFIG.CAPTURE_RING_RADIUS, 32
      );
      const ringMat = new THREE.MeshBasicMaterial({
        color: 0xffffff, transparent: true, opacity: 0.4, side: THREE.DoubleSide,
      });
      const ring = new THREE.Mesh(ringGeo, ringMat);
      ring.rotation.x = -Math.PI / 2;
      ring.position.y = 0.15;
      group.add(ring);

      // Beacon light on top
      const beaconGeo = new THREE.SphereGeometry(1, 8, 8);
      const beaconMat = new THREE.MeshStandardMaterial({
        color: 0xffffff, emissive: 0xffffff, emissiveIntensity: 1.0,
        transparent: true, opacity: 0.8,
      });
      const beacon = new THREE.Mesh(beaconGeo, beaconMat);
      beacon.position.y = 30;
      group.add(beacon);

      this.scene.add(group);
      this.captureWindmills.set(config.id, {
        config, group, ring, ringMat, beacon, beaconMat,
        bladesGroup, team: null, progress: 0,
      });
    }
  }

  updateCaptureWindmills(delta) {
    const ship = this.localPlayer ? this.players.get(this.localPlayer.id) : null;
    let nearestMill = null;
    let nearestDist = Infinity;

    for (const [id, mill] of this.captureWindmills) {
      // Animate blades
      mill.bladesGroup.rotation.z += delta * 0.5;

      // Animate beacon
      const pulse = 0.5 + Math.sin(this.animationTime * 3 + id.length) * 0.5;
      mill.beacon.material.emissiveIntensity = 0.5 + pulse;

      // Update ownership visuals from server state
      const state = this.windmillStates[id];
      if (state) {
        mill.team = state.team;
        mill.progress = state.progress || 0;

        if (state.team === 'red') {
          mill.ringMat.color.setHex(0xFF3333);
          mill.ringMat.opacity = 0.6;
          mill.beaconMat.color.setHex(0xFF3333);
          mill.beaconMat.emissive.setHex(0xFF3333);
        } else if (state.team === 'blue') {
          mill.ringMat.color.setHex(0x3333FF);
          mill.ringMat.opacity = 0.6;
          mill.beaconMat.color.setHex(0x3333FF);
          mill.beaconMat.emissive.setHex(0x3333FF);
        } else {
          mill.ringMat.color.setHex(0xffffff);
          mill.ringMat.opacity = 0.3;
          mill.beaconMat.color.setHex(0xffffff);
          mill.beaconMat.emissive.setHex(0xffffff);
        }
      }

      // Check distance to player
      if (ship) {
        const dx = ship.position.x - mill.config.x;
        const dz = ship.position.z - mill.config.z;
        const dist = Math.sqrt(dx * dx + dz * dz);
        if (dist < nearestDist && dist <= GAME_CONFIG.CAPTURE_RADIUS) {
          nearestDist = dist;
          nearestMill = mill;
        }
      }

      // Animate ring scale pulse
      const ringPulse = 1 + Math.sin(this.animationTime * 2) * 0.05;
      mill.ring.scale.setScalar(ringPulse);
    }

    // Update capture progress UI
    const captureUI = document.getElementById('capture-progress');
    const captureLabel = document.getElementById('capture-label');
    const captureFill = document.getElementById('capture-fill');

    if (nearestMill && captureUI) {
      captureUI.style.display = 'block';
      if (captureLabel) captureLabel.textContent = nearestMill.config.name;
      const serverState = this.windmillStates[nearestMill.config.id];
      const prog = serverState ? (serverState.progress || 0) : 0;
      if (captureFill) {
        captureFill.style.width = `${prog * 100}%`;
        if (serverState && serverState.team) {
          captureFill.style.backgroundColor = serverState.team === 'red' ? '#ff4444' : '#4444ff';
        } else if (serverState && serverState.contestingTeam) {
          captureFill.style.backgroundColor = serverState.contestingTeam === 'red' ? '#ff4444' : '#4444ff';
        } else {
          captureFill.style.backgroundColor = '#ffffff';
        }
      }
    } else if (captureUI) {
      captureUI.style.display = 'none';
    }

    this.updateWindmillHUD();
  }

  updateWindmillHUD() {
    const el = document.getElementById('windmill-status');
    if (!el) return;

    let html = '';
    for (const config of CAPTURE_WINDMILLS) {
      const state = this.windmillStates[config.id];
      let color = '#888';
      let symbol = '\u25CB';
      if (state && state.team === 'red') { color = '#ff4444'; symbol = '\u25CF'; }
      else if (state && state.team === 'blue') { color = '#4444ff'; symbol = '\u25CF'; }
      html += `<span style="color:${color}; margin: 0 3px;" title="${config.name}">${symbol}</span>`;
    }
    el.innerHTML = html;
  }

  // =========================================================================
  // RUNWAY
  // =========================================================================

  createRunway() {
    const rl = GAME_CONFIG.RUNWAY_LENGTH;
    const rw = GAME_CONFIG.RUNWAY_WIDTH;

    // Runway surface
    const runwayGeo = new THREE.PlaneGeometry(rw, rl);
    const runwayMat = new THREE.MeshStandardMaterial({ color: 0x555555, roughness: 0.9 });
    const runway = new THREE.Mesh(runwayGeo, runwayMat);
    runway.rotation.x = -Math.PI / 2;
    runway.position.set(0, 0.06, 0);
    this.scene.add(runway);

    // White center line dashes
    const dashMat = new THREE.MeshStandardMaterial({ color: 0xFFFFFF });
    for (let i = -rl / 2 + 5; i < rl / 2; i += 10) {
      const dashGeo = new THREE.PlaneGeometry(0.6, 5);
      const dash = new THREE.Mesh(dashGeo, dashMat);
      dash.rotation.x = -Math.PI / 2;
      dash.position.set(0, 0.07, i);
      this.scene.add(dash);
    }

    // Runway edge lights
    const lightMat = new THREE.MeshStandardMaterial({
      color: 0xFFFF00, emissive: 0xFFFF00, emissiveIntensity: 1.0,
    });
    for (let i = -rl / 2; i <= rl / 2; i += 15) {
      const lightGeo = new THREE.SphereGeometry(0.3, 6, 6);
      const leftLight = new THREE.Mesh(lightGeo, lightMat);
      leftLight.position.set(-rw / 2 - 0.5, 0.4, i);
      this.scene.add(leftLight);

      const rightLight = new THREE.Mesh(lightGeo, lightMat);
      rightLight.position.set(rw / 2 + 0.5, 0.4, i);
      this.scene.add(rightLight);
    }

    // Green threshold lights at start
    const greenMat = new THREE.MeshStandardMaterial({
      color: 0x00FF00, emissive: 0x00FF00, emissiveIntensity: 1.0,
    });
    for (let x = -rw / 2; x <= rw / 2; x += 3) {
      const gLight = new THREE.Mesh(new THREE.SphereGeometry(0.3, 6, 6), greenMat);
      gLight.position.set(x, 0.4, rl / 2);
      this.scene.add(gLight);
    }

    // Red end lights
    const redMat = new THREE.MeshStandardMaterial({
      color: 0xFF0000, emissive: 0xFF0000, emissiveIntensity: 1.0,
    });
    for (let x = -rw / 2; x <= rw / 2; x += 3) {
      const rLight = new THREE.Mesh(new THREE.SphereGeometry(0.3, 6, 6), redMat);
      rLight.position.set(x, 0.4, -rl / 2);
      this.scene.add(rLight);
    }

    // Terminal building at the start end
    const termGeo = new THREE.BoxGeometry(25, 8, 12);
    const termMat = new THREE.MeshStandardMaterial({ color: 0xC0C0C0, roughness: 0.6 });
    const terminal = new THREE.Mesh(termGeo, termMat);
    terminal.position.set(20, 4, rl / 2 + 10);
    this.scene.add(terminal);

    const termRoofGeo = new THREE.BoxGeometry(27, 0.5, 14);
    const termRoof = new THREE.Mesh(termRoofGeo, new THREE.MeshStandardMaterial({ color: 0x404040 }));
    termRoof.position.set(20, 8.25, rl / 2 + 10);
    this.scene.add(termRoof);

    // Control tower
    const towerGeo = new THREE.CylinderGeometry(2, 2.5, 15, 8);
    const towerMat = new THREE.MeshStandardMaterial({ color: 0xB0B0B0, roughness: 0.5 });
    const tower = new THREE.Mesh(towerGeo, towerMat);
    tower.position.set(25, 7.5, rl / 2 + 20);
    this.scene.add(tower);

    const cabGeo = new THREE.CylinderGeometry(3.5, 3, 4, 8);
    const cabMat = new THREE.MeshStandardMaterial({
      color: 0x66AAFF, transparent: true, opacity: 0.6, metalness: 0.3,
    });
    const cab = new THREE.Mesh(cabGeo, cabMat);
    cab.position.set(25, 17, rl / 2 + 20);
    this.scene.add(cab);
  }

  // =========================================================================
  // TAKEOFF SEQUENCE
  // =========================================================================

  startTakeoff(ship) {
    this.takeoffPhase = 'accelerate';
    this.takeoffTimer = 0;
    this.takeoffSpeed = 0;
    this.controlsEnabled = false;

    // Place ship at start of runway, on the ground, facing down runway (negative Z)
    ship.position.set(0, 1, GAME_CONFIG.RUNWAY_LENGTH / 2 - 10);
    ship.rotation.set(0, 0, 0); // Face negative Z (down the runway)
    this.shipRotation = 0;

    // Show takeoff overlay
    const overlay = document.getElementById('takeoff-overlay');
    if (overlay) overlay.style.display = 'flex';
  }

  updateTakeoff(delta) {
    if (!this.takeoffPhase || !this.localPlayer) return;

    const ship = this.players.get(this.localPlayer.id);
    if (!ship) return;

    this.takeoffTimer += delta;
    const overlay = document.getElementById('takeoff-overlay');
    const takeoffText = document.getElementById('takeoff-text');

    if (this.takeoffPhase === 'accelerate') {
      // Accelerate down the runway
      this.takeoffSpeed = Math.min(80, this.takeoffSpeed + 40 * delta);
      ship.position.z -= this.takeoffSpeed * delta;
      ship.position.y = 1;

      if (takeoffText) takeoffText.textContent = 'ACCELERATING...';

      if (this.takeoffTimer > GAME_CONFIG.TAKEOFF_ACCEL_DURATION) {
        this.takeoffPhase = 'liftoff';
        this.takeoffTimer = 0;
      }
    }

    if (this.takeoffPhase === 'liftoff') {
      // Nose up, start climbing
      this.takeoffSpeed = Math.min(100, this.takeoffSpeed + 20 * delta);
      ship.position.z -= this.takeoffSpeed * delta;

      const liftProgress = this.takeoffTimer / GAME_CONFIG.TAKEOFF_LIFTOFF_DURATION;
      ship.position.y = 1 + liftProgress * 10;
      ship.rotation.x = -0.15; // Nose up

      if (takeoffText) takeoffText.textContent = 'LIFTOFF!';

      if (this.takeoffTimer > GAME_CONFIG.TAKEOFF_LIFTOFF_DURATION) {
        this.takeoffPhase = 'climb';
        this.takeoffTimer = 0;
      }
    }

    if (this.takeoffPhase === 'climb') {
      // Climb to cruise altitude
      ship.position.z -= this.takeoffSpeed * delta;

      const climbProgress = Math.min(1, this.takeoffTimer / GAME_CONFIG.TAKEOFF_CLIMB_DURATION);
      const currentY = 11 + climbProgress * (GAME_CONFIG.FLIGHT_HEIGHT - 11);
      ship.position.y = currentY;
      ship.rotation.x = -0.15 * (1 - climbProgress); // Level out

      if (takeoffText) takeoffText.textContent = 'CLIMBING...';

      if (this.takeoffTimer > GAME_CONFIG.TAKEOFF_CLIMB_DURATION) {
        this.takeoffPhase = null;
        this.controlsEnabled = true;
        ship.rotation.x = 0;
        ship.position.y = GAME_CONFIG.FLIGHT_HEIGHT;

        if (overlay) overlay.style.display = 'none';
      }
    }

    // Camera follows during takeoff
    const camBehind = 14;
    const camUp = 8;
    this.camera.position.x = ship.position.x + Math.sin(this.shipRotation) * camBehind;
    this.camera.position.y = ship.position.y + camUp;
    this.camera.position.z = ship.position.z + Math.cos(this.shipRotation) * camBehind;
    this.camera.lookAt(ship.position);

    // Move ground/clouds/chunks with ship during takeoff
    if (this.groundPlane) {
      this.groundPlane.position.x = ship.position.x;
      this.groundPlane.position.z = ship.position.z;
    }
    if (this.cloudGroup) {
      this.cloudGroup.position.x = ship.position.x;
      this.cloudGroup.position.z = ship.position.z;
    }
    this.updateChunks(ship.position.x, ship.position.z);
  }

  // =========================================================================
  // PLAYER SHIP
  // =========================================================================

  getPlayerColor(playerId) {
    let hash = 0;
    for (let i = 0; i < playerId.length; i++) {
      hash = ((hash << 5) - hash) + playerId.charCodeAt(i);
      hash |= 0;
    }
    return PLAYER_COLORS[Math.abs(hash) % PLAYER_COLORS.length];
  }

  createPlayerShip(color) {
    const planeGroup = new THREE.Group();

    const mainMat = new THREE.MeshStandardMaterial({
      color, metalness: 0.8, roughness: 0.15, side: THREE.DoubleSide,
    });
    const chromeMat = new THREE.MeshStandardMaterial({ color: 0xEEEEEE, metalness: 0.95, roughness: 0.05 });
    const glowMat = new THREE.MeshStandardMaterial({
      color, emissive: color, emissiveIntensity: 0.8, metalness: 0.5, roughness: 0.3,
    });

    const fuselageGeo = new THREE.CylinderGeometry(0.5, 0.85, 10, 12);
    const fuselage = new THREE.Mesh(fuselageGeo, mainMat);
    fuselage.rotation.x = Math.PI / 2;
    planeGroup.add(fuselage);

    const noseGeo = new THREE.ConeGeometry(0.5, 3.5, 12);
    const nose = new THREE.Mesh(noseGeo, chromeMat);
    nose.rotation.x = Math.PI / 2;
    nose.position.set(0, 0, -6.7);
    planeGroup.add(nose);

    const canopyGeo = new THREE.SphereGeometry(0.6, 12, 8, 0, Math.PI * 2, 0, Math.PI / 2);
    const canopyMat = new THREE.MeshStandardMaterial({
      color: 0x66AAFF, metalness: 0.1, roughness: 0.05, transparent: true, opacity: 0.45,
    });
    const canopy = new THREE.Mesh(canopyGeo, canopyMat);
    canopy.position.set(0, 0.5, -2.5);
    planeGroup.add(canopy);

    const wingShape = new THREE.Shape();
    wingShape.moveTo(0, -1.5);
    wingShape.lineTo(10, 2.5);
    wingShape.lineTo(9, 4.5);
    wingShape.lineTo(0, 2);
    wingShape.lineTo(-9, 4.5);
    wingShape.lineTo(-10, 2.5);
    wingShape.closePath();
    const wingGeo = new THREE.ShapeGeometry(wingShape);
    const wing = new THREE.Mesh(wingGeo, mainMat);
    wing.rotation.x = -Math.PI / 2;
    wing.position.set(0, -0.05, 0);
    planeGroup.add(wing);

    const stripeGeo = new THREE.BoxGeometry(0.15, 0.15, 8);
    const leftStripe = new THREE.Mesh(stripeGeo, glowMat);
    leftStripe.position.set(0.6, 0, 0);
    planeGroup.add(leftStripe);
    const rightStripe = new THREE.Mesh(stripeGeo, glowMat);
    rightStripe.position.set(-0.6, 0, 0);
    planeGroup.add(rightStripe);

    const finGeo = new THREE.BoxGeometry(0.15, 3.5, 2.5);
    const leftFin = new THREE.Mesh(finGeo, mainMat);
    leftFin.position.set(-1.2, 1.5, 4);
    leftFin.rotation.z = -0.3;
    planeGroup.add(leftFin);
    const rightFin = new THREE.Mesh(finGeo, mainMat);
    rightFin.position.set(1.2, 1.5, 4);
    rightFin.rotation.z = 0.3;
    planeGroup.add(rightFin);

    const tailGeo = new THREE.BoxGeometry(5, 0.12, 2);
    const tail = new THREE.Mesh(tailGeo, mainMat);
    tail.position.set(0, 0, 4.2);
    planeGroup.add(tail);

    const exhaustGeo = new THREE.CylinderGeometry(0.35, 0.45, 1.5, 8);
    const exhaustMat = new THREE.MeshStandardMaterial({ color: 0x222222, metalness: 0.95, roughness: 0.15 });
    const leftExhaust = new THREE.Mesh(exhaustGeo, exhaustMat);
    leftExhaust.rotation.x = Math.PI / 2;
    leftExhaust.position.set(-0.6, 0, 5.5);
    planeGroup.add(leftExhaust);
    const rightExhaust = new THREE.Mesh(exhaustGeo, exhaustMat);
    rightExhaust.rotation.x = Math.PI / 2;
    rightExhaust.position.set(0.6, 0, 5.5);
    planeGroup.add(rightExhaust);

    const abGeo = new THREE.SphereGeometry(0.3, 8, 8);
    const abMat = new THREE.MeshStandardMaterial({
      color: 0xFF6600, emissive: 0xFF4400, emissiveIntensity: 2.0, transparent: true, opacity: 0.85,
    });
    const leftAB = new THREE.Mesh(abGeo, abMat);
    leftAB.position.set(-0.6, 0, 6.3);
    planeGroup.add(leftAB);
    const rightAB = new THREE.Mesh(abGeo, abMat);
    rightAB.position.set(0.6, 0, 6.3);
    planeGroup.add(rightAB);

    const navGeo = new THREE.SphereGeometry(0.2, 6, 6);
    const navMat = new THREE.MeshStandardMaterial({ color, emissive: color, emissiveIntensity: 1.5 });
    const leftNav = new THREE.Mesh(navGeo, navMat);
    leftNav.position.set(-9.5, 0.1, 2.8);
    planeGroup.add(leftNav);
    const rightNav = new THREE.Mesh(navGeo, navMat);
    rightNav.position.set(9.5, 0.1, 2.8);
    planeGroup.add(rightNav);

    planeGroup.userData.leftAB = leftAB;
    planeGroup.userData.rightAB = rightAB;
    planeGroup.userData.navLights = [leftNav, rightNav];
    planeGroup.userData.glowMat = glowMat;
    planeGroup.userData.abMat = abMat;

    return planeGroup;
  }

  createProjectile() {
    const geometry = new THREE.SphereGeometry(0.5);
    const material = new THREE.MeshStandardMaterial({
      color: GAME_CONFIG.PROJECTILE_COLOR,
      emissive: GAME_CONFIG.PROJECTILE_COLOR,
      emissiveIntensity: 0.5,
    });
    return new THREE.Mesh(geometry, material);
  }

  fireProjectile(ship) {
    const projectile = this.createProjectile();
    const spawnDist = 8;
    projectile.position.set(
      ship.position.x - Math.sin(this.shipRotation) * spawnDist,
      ship.position.y,
      ship.position.z - Math.cos(this.shipRotation) * spawnDist
    );
    projectile.velocity = new THREE.Vector3(
      -Math.sin(this.shipRotation) * GAME_CONFIG.PROJECTILE_SPEED,
      0,
      -Math.cos(this.shipRotation) * GAME_CONFIG.PROJECTILE_SPEED
    );
    const projectileId = `${this.localPlayer.id}_${Date.now()}`;
    this.scene.add(projectile);
    this.projectiles.set(projectileId, projectile);

    if (this.socket && this.isConnected) {
      this.socket.emit('fireProjectile', {
        gameId: this.gameState?.id,
        position: projectile.position,
        direction: { x: -Math.sin(this.shipRotation), y: 0, z: -Math.cos(this.shipRotation) },
        projectileId,
      });
    }
  }

  // =========================================================================
  // NETWORKING
  // =========================================================================

  connectToServer(username) {
    try {
      this.socket = io({
        reconnection: true,
        reconnectionAttempts: GAME_CONFIG.RECONNECT_ATTEMPTS,
        reconnectionDelay: GAME_CONFIG.RECONNECT_DELAY,
      });

      this.socket.on('connect', () => {
        console.log('Connected to server');
        this.isConnected = true;
        this.reconnectAttempts = 0;
        this.socket.emit('joinGame', username);
      });

      this.socket.on('connect_error', (error) => {
        console.error('Connection error:', error);
        this.isConnected = false;
        this.reconnectAttempts++;
        if (this.reconnectAttempts >= GAME_CONFIG.RECONNECT_ATTEMPTS) {
          alert('Failed to connect to server. Please refresh the page and try again.');
        }
      });

      this.socket.on('disconnect', (reason) => {
        console.log('Disconnected from server:', reason);
        this.isConnected = false;
        if (reason === 'io server disconnect') this.socket.connect();
      });

      this.socket.on('gameJoined', (data) => {
        this.gameState = data.gameState;
        this.localPlayer = data.player;

        const myColor = this.getPlayerColor(data.player.id);
        const ship = this.createPlayerShip(myColor);
        this.scene.add(ship);
        this.players.set(this.localPlayer.id, ship);
        this.createTrail(data.player.id);
        this.playerHealth = 100;

        // Start takeoff sequence
        this.startTakeoff(ship);

        if (data.gameState.players) {
          data.gameState.players.forEach(player => {
            if (player.id !== this.localPlayer.id) {
              const otherColor = this.getPlayerColor(player.id);
              const otherShip = this.createPlayerShip(otherColor);
              otherShip.position.copy(player.position);
              otherShip.position.y = GAME_CONFIG.FLIGHT_HEIGHT;
              this.scene.add(otherShip);
              this.players.set(player.id, otherShip);
              this.createTrail(player.id);
            }
          });
        }

        // Load initial windmill state
        if (data.gameState.windmills) {
          for (const mill of data.gameState.windmills) {
            this.windmillStates[mill.id] = mill;
          }
        }

        this.updateHUD();
        this.updateEnergyBar(this.localPlayer.energy || 100);
      });

      this.socket.on('playerJoined', (player) => {
        if (player && player.id) {
          const playerColor = this.getPlayerColor(player.id);
          const ship = this.createPlayerShip(playerColor);
          ship.position.copy(player.position);
          ship.position.y = GAME_CONFIG.FLIGHT_HEIGHT;
          this.scene.add(ship);
          this.players.set(player.id, ship);
          this.createTrail(player.id);
          if (this.gameState && this.gameState.players) {
            this.gameState.players.push(player);
          }
          this.updateHUD();
        }
      });

      this.socket.on('playerLeft', (playerId) => {
        const ship = this.players.get(playerId);
        if (ship) {
          this.scene.remove(ship);
          this.players.delete(playerId);
          this.removeTrail(playerId);
        }
        if (this.gameState && this.gameState.players) {
          this.gameState.players = this.gameState.players.filter(p => p.id !== playerId);
        }
        this.updateHUD();
      });

      this.socket.on('playerMoved', (data) => {
        if (data && data.id) {
          const ship = this.players.get(data.id);
          if (ship && data.position && data.rotation) {
            ship.position.copy(data.position);
            ship.rotation.copy(data.rotation);
          }
        }
      });

      this.socket.on('projectileFired', (data) => {
        if (data && data.position && data.direction) {
          const projectile = this.createProjectile();
          projectile.position.copy(data.position);
          projectile.velocity = new THREE.Vector3(
            data.direction.x * GAME_CONFIG.PROJECTILE_SPEED,
            (data.direction.y || 0) * GAME_CONFIG.PROJECTILE_SPEED,
            data.direction.z * GAME_CONFIG.PROJECTILE_SPEED
          );
          this.scene.add(projectile);
          this.projectiles.set(data.projectileId, projectile);
        }
      });

      this.socket.on('playerHit', (data) => {
        if (data.targetId === this.localPlayer?.id) {
          this.playerHealth = Math.max(0, this.playerHealth - data.damage);
          this.updateHealth(data.damage);
        }
        if (data.gameState) {
          this.gameState = data.gameState;
          this.updateHUD();
        }
      });

      this.socket.on('chatMessage', (data) => this.displayChatMessage(data.username, data.message));
      this.socket.on('gameStart', (gameState) => { this.gameState = gameState; this.updateHUD(); });
      this.socket.on('gameEnd', (gameState) => { this.gameState = gameState; this.showGameEnd(); });
      this.socket.on('error', (error) => console.error('Socket error:', error));

      // Windmill capture updates from server
      this.socket.on('windmillUpdate', (data) => {
        if (data && data.windmills) {
          for (const mill of data.windmills) {
            this.windmillStates[mill.id] = mill;
          }
        }
      });

      this.socket.on('windmillScore', (data) => {
        if (data && data.scores && this.gameState) {
          this.gameState.scores = data.scores;
          this.updateHUD();
        }
      });

    } catch (error) {
      console.error('Failed to initialize connection:', error);
      alert('Failed to connect to server. Please refresh the page.');
    }
  }

  // =========================================================================
  // HUD & UI
  // =========================================================================

  displayChatMessage(username, message) {
    const chatMessages = document.getElementById('chat-messages');
    if (!chatMessages) return;
    const el = document.createElement('div');
    el.className = 'chat-message';
    el.innerHTML = `<strong>${this.sanitizeInput(username)}:</strong> ${this.sanitizeInput(message)}`;
    chatMessages.appendChild(el);
    chatMessages.scrollTop = chatMessages.scrollHeight;
    while (chatMessages.children.length > 50) chatMessages.removeChild(chatMessages.firstChild);
  }

  updateHealth(damage) {
    const healthFill = document.querySelector('.health-fill');
    if (!healthFill) return;
    const currentWidth = parseFloat(healthFill.style.width) || 100;
    healthFill.style.width = `${Math.max(0, currentWidth - damage)}%`;
  }

  updateEnergyBar(energyPercent) {
    const energyFill = document.querySelector('.energy-fill');
    if (!energyFill) return;
    const c = Math.max(0, Math.min(100, energyPercent));
    energyFill.style.width = `${c}%`;
    energyFill.style.backgroundColor = c < 20 ? '#ff4444' : c < 50 ? '#ffaa00' : '#00aaff';
  }

  updateHUD() {
    if (!this.gameState || !this.localPlayer) return;

    const killsEl = document.getElementById('kills');
    const deathsEl = document.getElementById('deaths');
    const assistsEl = document.getElementById('assists');
    const timeRemainingEl = document.getElementById('time-remaining');
    const playerListEl = document.getElementById('player-list');

    if (killsEl) killsEl.textContent = this.localPlayer.kills || 0;
    if (deathsEl) deathsEl.textContent = this.localPlayer.deaths || 0;
    if (assistsEl) assistsEl.textContent = this.localPlayer.assists || 0;

    if (timeRemainingEl && typeof this.gameState.timeRemaining === 'number') {
      const minutes = Math.floor(this.gameState.timeRemaining / 60000);
      const seconds = Math.floor((this.gameState.timeRemaining % 60000) / 1000);
      timeRemainingEl.textContent = `${minutes}:${seconds.toString().padStart(2, '0')}`;
    }

    if (playerListEl && this.gameState.players) {
      playerListEl.innerHTML = this.gameState.players.map(p => {
        const color = this.getPlayerColor(p.id);
        const hex = '#' + color.toString(16).padStart(6, '0');
        const isYou = p.id === this.localPlayer.id ? ' (You)' : '';
        const name = this.sanitizeInput(p.username || 'Pilot');
        return `<div style="color:${hex}; margin: 2px 0;">&#9992; ${name}${isYou} - K:${p.kills || 0} D:${p.deaths || 0}</div>`;
      }).join('');
    }
  }

  showGameEnd() {
    if (!this.gameState || !this.gameState.scores) return;
    const winner = this.gameState.scores.red > this.gameState.scores.blue ? 'Red' : 'Blue';
    alert(`Game Over! ${winner} team wins!\nFinal Score: Red ${this.gameState.scores.red} - Blue ${this.gameState.scores.blue}`);
    window.location.reload();
  }

  // =========================================================================
  // INPUT
  // =========================================================================

  onWindowResize() {
    this.camera.aspect = window.innerWidth / window.innerHeight;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(window.innerWidth, window.innerHeight);
  }

  onKeyDown(event) {
    switch (event.key.toLowerCase()) {
      case 'w': this.controls.forward = true; break;
      case 's': this.controls.backward = true; break;
      case 'a': this.controls.left = true; break;
      case 'd': this.controls.right = true; break;
      case 'shift': this.controls.boost = true; break;
      case ' ': this.controls.shooting = true; event.preventDefault(); break;
      case 'q': case 'arrowleft': this.controls.rotateLeft = true; event.preventDefault(); break;
      case 'e': case 'arrowright': this.controls.rotateRight = true; event.preventDefault(); break;
    }
  }

  onKeyUp(event) {
    switch (event.key.toLowerCase()) {
      case 'w': this.controls.forward = false; break;
      case 's': this.controls.backward = false; break;
      case 'a': this.controls.left = false; break;
      case 'd': this.controls.right = false; break;
      case 'shift': this.controls.boost = false; break;
      case ' ': this.controls.shooting = false; event.preventDefault(); break;
      case 'q': case 'arrowleft': this.controls.rotateLeft = false; event.preventDefault(); break;
      case 'e': case 'arrowright': this.controls.rotateRight = false; event.preventDefault(); break;
    }
  }

  // =========================================================================
  // GAME LOOP
  // =========================================================================

  updatePlayer(delta) {
    if (!this.localPlayer || !this.players.has(this.localPlayer.id)) return;
    if (this.crashed || !this.controlsEnabled) return;

    const ship = this.players.get(this.localPlayer.id);

    if (typeof this.localPlayer.energy !== 'number') this.localPlayer.energy = 100;

    let speed = GAME_CONFIG.MOVEMENT_SPEED;
    if (this.controls.boost && this.localPlayer.energy > 0) {
      speed = GAME_CONFIG.BOOST_SPEED;
      this.localPlayer.energy = Math.max(0, this.localPlayer.energy - (GAME_CONFIG.ENERGY_DRAIN_RATE * delta));
    } else {
      this.localPlayer.energy = Math.min(100, this.localPlayer.energy + (GAME_CONFIG.ENERGY_REGEN_RATE * delta));
    }
    this.updateEnergyBar(this.localPlayer.energy);

    const rotationSpeed = 3;
    if (this.controls.rotateLeft) this.shipRotation += rotationSpeed * delta;
    if (this.controls.rotateRight) this.shipRotation -= rotationSpeed * delta;
    ship.rotation.y = this.shipRotation;

    const movement = new THREE.Vector3();
    if (this.controls.forward) {
      movement.x -= Math.sin(this.shipRotation) * speed * delta;
      movement.z -= Math.cos(this.shipRotation) * speed * delta;
    }
    if (this.controls.backward) {
      movement.x += Math.sin(this.shipRotation) * speed * delta;
      movement.z += Math.cos(this.shipRotation) * speed * delta;
    }
    if (this.controls.left) {
      movement.x -= Math.cos(this.shipRotation) * speed * delta;
      movement.z += Math.sin(this.shipRotation) * speed * delta;
    }
    if (this.controls.right) {
      movement.x += Math.cos(this.shipRotation) * speed * delta;
      movement.z -= Math.sin(this.shipRotation) * speed * delta;
    }

    ship.position.add(movement);
    ship.position.y = GAME_CONFIG.FLIGHT_HEIGHT;

    // Update contrail
    this.updateTrail(this.localPlayer.id, ship.position);

    // Smoke/fire when damaged
    this.smokeTimer += delta;
    if (this.smokeTimer > GAME_CONFIG.SMOKE_SPAWN_RATE &&
        this.playerHealth < GAME_CONFIG.SMOKE_HEALTH_THRESHOLD) {
      this.smokeTimer = 0;
      const isFire = this.playerHealth < GAME_CONFIG.FIRE_HEALTH_THRESHOLD;
      this.spawnSmokeParticle(ship.position, isFire);
    }

    if (this.groundPlane) {
      this.groundPlane.position.x = ship.position.x;
      this.groundPlane.position.z = ship.position.z;
    }
    if (this.cloudGroup) {
      this.cloudGroup.position.x = ship.position.x;
      this.cloudGroup.position.z = ship.position.z;
    }
    this.updateChunks(ship.position.x, ship.position.z);

    // Shooting
    if (this.controls.shooting && this.animationTime - this.lastFireTime > GAME_CONFIG.FIRE_COOLDOWN) {
      this.lastFireTime = this.animationTime;
      this.fireProjectile(ship);
    }

    if (this.socket && this.isConnected && this.gameState) {
      try {
        this.socket.emit('position', {
          gameId: this.gameState.id,
          position: ship.position,
          rotation: ship.rotation,
          energy: this.localPlayer.energy,
        });
      } catch (error) {
        console.error('Error sending position update:', error);
      }
    }

    // Animate afterburners
    const abScale = 0.8 + Math.sin(this.animationTime * 15) * 0.3;
    const isBoosting = this.controls.boost && this.localPlayer.energy > 0;
    const abTargetScale = isBoosting ? abScale * 1.6 : abScale;
    if (ship.userData.leftAB) {
      ship.userData.leftAB.scale.setScalar(abTargetScale);
      ship.userData.rightAB.scale.setScalar(abTargetScale);
    }
    if (ship.userData.abMat) ship.userData.abMat.emissiveIntensity = isBoosting ? 3.0 : 1.5;

    if (ship.userData.navLights) {
      const blinkIntensity = 0.8 + Math.sin(this.animationTime * 5) * 0.7;
      ship.userData.navLights.forEach(light => { light.material.emissiveIntensity = blinkIntensity; });
    }

    this.checkCollisions(ship);

    const camBehind = 14;
    const camUp = 8;
    this.camera.position.x = ship.position.x + Math.sin(this.shipRotation) * camBehind;
    this.camera.position.y = ship.position.y + camUp;
    this.camera.position.z = ship.position.z + Math.cos(this.shipRotation) * camBehind;
    this.camera.lookAt(ship.position);
  }

  checkCollisions(ship) {
    if (this.crashed) return;
    const px = ship.position.x;
    const py = ship.position.y;
    const pz = ship.position.z;
    const pr = GAME_CONFIG.PLANE_COLLISION_RADIUS;

    for (const [, colliders] of this.obstacles) {
      for (const obs of colliders) {
        if (py > obs.topY) continue;
        const dx = px - obs.x;
        const dz = pz - obs.z;
        const dist = Math.sqrt(dx * dx + dz * dz);
        if (dist < obs.radius + pr) {
          this.triggerCrash(ship);
          return;
        }
      }
    }
  }

  triggerCrash(ship) {
    this.crashed = true;
    const overlay = document.getElementById('crash-overlay');
    if (overlay) overlay.style.display = 'flex';
    this.updateHealth(GAME_CONFIG.CRASH_HEALTH_PENALTY);

    setTimeout(() => {
      this.crashed = false;
      if (overlay) overlay.style.display = 'none';
      ship.position.x += (Math.random() - 0.5) * 60;
      ship.position.z += (Math.random() - 0.5) * 60;
      ship.position.y = GAME_CONFIG.FLIGHT_HEIGHT;
    }, GAME_CONFIG.CRASH_DURATION);
  }

  animate() {
    requestAnimationFrame(this.animate.bind(this));
    const delta = this.clock.getDelta();
    this.animationTime += delta;

    // Global systems (always update)
    this.updateWeather(delta);
    this.updateSmokeParticles(delta);
    this.updateCaptureWindmills(delta);

    // Takeoff sequence
    if (this.takeoffPhase) {
      this.updateTakeoff(delta);
    }

    if (this.localPlayer) {
      this.updatePlayer(delta);

      const playerShip = this.players.get(this.localPlayer.id);
      this.projectiles.forEach((projectile, id) => {
        if (projectile.velocity) {
          projectile.position.add(projectile.velocity.clone().multiplyScalar(delta));
          if (playerShip) {
            const dist = projectile.position.distanceTo(playerShip.position);
            if (dist > GAME_CONFIG.PROJECTILE_DESPAWN_DIST) {
              this.scene.remove(projectile);
              this.projectiles.delete(id);
            }
          }
        }
      });
    }

    // Animate other players
    this.players.forEach((ship, id) => {
      if (id !== this.localPlayer?.id) {
        if (ship.userData.leftAB) {
          const s = 0.8 + Math.sin(this.animationTime * 15 + id.length) * 0.3;
          ship.userData.leftAB.scale.setScalar(s);
          ship.userData.rightAB.scale.setScalar(s);
        }
        if (ship.userData.navLights) {
          const b = 0.8 + Math.sin(this.animationTime * 5 + id.length * 0.5) * 0.7;
          ship.userData.navLights.forEach(light => { light.material.emissiveIntensity = b; });
        }
        // Update contrail for other players
        this.updateTrail(id, ship.position);
      }
    });

    this.renderer.render(this.scene, this.camera);
  }
}

new Game();
