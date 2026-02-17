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

  FLIGHT_HEIGHT: 15,
  PLANE_COLLISION_RADIUS: 4,
  CRASH_DURATION: 3000,
  CRASH_HEALTH_PENALTY: 30,

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
  0xFF3E3E, // Bright Red
  0x3EA8FF, // Sky Blue
  0xFF9F1C, // Tangerine
  0x2ECC71, // Emerald
  0x9B59B6, // Amethyst
  0xF1C40F, // Sunflower
  0x1ABC9C, // Turquoise
  0xE91E9C, // Hot Pink
  0x00D4FF, // Cyan
  0xFF6B6B, // Coral
  0x45B7D1, // Steel Blue
  0xFFA07A, // Light Salmon
];

/**
 * Main game class that handles rendering, input, networking, and game logic
 */
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
      forward: false,
      backward: false,
      left: false,
      right: false,
      boost: false,
      shooting: false,
      rotateLeft: false,
      rotateRight: false,
    };
    this.shipRotation = 0;

    // Infinite terrain
    this.chunks = new Map();
    this.obstacles = new Map(); // chunk key -> [{x, z, radius, topY}]
    this.groundPlane = null;
    this.cloudGroup = null;
    this.animationTime = 0;

    // Crash state
    this.crashed = false;
    this.crashTimer = 0;

    this.init();
  }

  init() {
    // Setup renderer
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    this.renderer.setPixelRatio(window.devicePixelRatio);
    document.getElementById('game-container').appendChild(this.renderer.domElement);

    // Setup camera
    this.camera.position.set(0, 50, 40);
    this.camera.lookAt(0, 0, 0);

    // Sky background
    this.scene.background = new THREE.Color(0x87CEEB);

    // Fog for infinite terrain illusion
    this.scene.fog = new THREE.Fog(0x87CEEB, GAME_CONFIG.FOG_NEAR, GAME_CONFIG.FOG_FAR);

    // Bright ambient light for sunny day
    const ambientLight = new THREE.AmbientLight(0xffffff, 0.7);
    this.scene.add(ambientLight);

    // Sun directional light
    const sunLight = new THREE.DirectionalLight(0xffeb99, 1.2);
    sunLight.position.set(50, 100, 50);
    this.scene.add(sunLight);

    // Hemisphere light for sky/ground color blending
    const hemiLight = new THREE.HemisphereLight(0x87CEEB, 0x4CAF50, 0.3);
    this.scene.add(hemiLight);

    // Create infinite terrain
    this.createInfiniteTerrain();

    // Setup event listeners
    window.addEventListener('resize', this.onWindowResize.bind(this));
    document.addEventListener('keydown', this.onKeyDown.bind(this));
    document.addEventListener('keyup', this.onKeyUp.bind(this));

    // Setup UI
    this.setupUI();

    // Start animation loop
    this.animate();
  }

  /**
   * Sets up UI event listeners with proper validation
   */
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
      if (e.key === 'Enter') {
        startButton.click();
      }
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

  /**
   * Validates username format and length
   */
  isValidUsername(username) {
    if (!username || typeof username !== 'string') return false;
    if (username.length < GAME_CONFIG.USERNAME_MIN_LENGTH ||
        username.length > GAME_CONFIG.USERNAME_MAX_LENGTH) return false;
    return /^[a-zA-Z0-9 ]+$/.test(username);
  }

  /**
   * Sanitizes user input to prevent XSS
   */
  sanitizeInput(input) {
    if (typeof input !== 'string') return '';
    const div = document.createElement('div');
    div.textContent = input;
    return div.innerHTML;
  }

  /**
   * Sends a chat message to other players
   */
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
  // INFINITE TERRAIN SYSTEM
  // =========================================================================

  /**
   * Creates the infinite terrain: ground plane, clouds, and initial chunks
   */
  createInfiniteTerrain() {
    // Large ground plane that follows the player
    const grassGeometry = new THREE.PlaneGeometry(
      GAME_CONFIG.GROUND_SIZE, GAME_CONFIG.GROUND_SIZE, 32, 32
    );
    const grassMaterial = new THREE.MeshStandardMaterial({
      color: 0x4CAF50,
      roughness: 0.9,
    });
    this.groundPlane = new THREE.Mesh(grassGeometry, grassMaterial);
    this.groundPlane.rotation.x = -Math.PI / 2;
    this.groundPlane.receiveShadow = true;
    this.scene.add(this.groundPlane);

    // Cloud group that follows the player
    this.cloudGroup = new THREE.Group();
    this.createClouds();
    this.scene.add(this.cloudGroup);

    // Generate initial chunks around the origin
    this.updateChunks(0, 0);
  }

  /**
   * Deterministic pseudo-random from a seed
   */
  seededRandom(seed) {
    const x = Math.sin(seed * 127.1 + 311.7) * 43758.5453;
    return x - Math.floor(x);
  }

  /**
   * Loads/unloads terrain chunks around the player
   */
  updateChunks(playerX, playerZ) {
    const cx = Math.floor(playerX / GAME_CONFIG.CHUNK_SIZE);
    const cz = Math.floor(playerZ / GAME_CONFIG.CHUNK_SIZE);

    const needed = new Set();
    for (let dx = -GAME_CONFIG.VIEW_DISTANCE; dx <= GAME_CONFIG.VIEW_DISTANCE; dx++) {
      for (let dz = -GAME_CONFIG.VIEW_DISTANCE; dz <= GAME_CONFIG.VIEW_DISTANCE; dz++) {
        needed.add(`${cx + dx},${cz + dz}`);
      }
    }

    // Unload distant chunks
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

    // Load new chunks
    for (const key of needed) {
      if (!this.chunks.has(key)) {
        const [x, z] = key.split(',').map(Number);
        this.generateChunk(x, z);
      }
    }
  }

  /**
   * Generates scenery for a single terrain chunk
   */
  generateChunk(chunkX, chunkZ) {
    const objects = [];
    const colliders = [];
    const baseX = chunkX * GAME_CONFIG.CHUNK_SIZE;
    const baseZ = chunkZ * GAME_CONFIG.CHUNK_SIZE;
    const seed = chunkX * 73856093 + chunkZ * 19349663;

    // Buildings (2-4 per chunk)
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

      // Collision: use larger dimension as radius for circular approximation
      colliders.push({ x, z, radius: Math.max(w, d) / 2, topY: h + h * 0.4 });
    }

    // Trees (5-10 per chunk)
    const numTrees = 5 + Math.floor(this.seededRandom(seed + 500) * 6);
    for (let i = 0; i < numTrees; i++) {
      const s = seed + 2000 + i * 100;
      const x = baseX + this.seededRandom(s + 1) * GAME_CONFIG.CHUNK_SIZE;
      const z = baseZ + this.seededRandom(s + 2) * GAME_CONFIG.CHUNK_SIZE;
      const scale = 0.7 + this.seededRandom(s + 3) * 0.6;

      const trunkGeo = new THREE.CylinderGeometry(1 * scale, 1.5 * scale, 8 * scale);
      const trunkMat = new THREE.MeshStandardMaterial({ color: 0x8B4513 });
      const trunk = new THREE.Mesh(trunkGeo, trunkMat);
      trunk.position.set(x, 4 * scale, z);
      this.scene.add(trunk);
      objects.push(trunk);

      const foliageGeo = new THREE.SphereGeometry(6 * scale, 8, 8);
      const green = this.seededRandom(s + 4) > 0.5 ? 0x228B22 : 0x2E8B57;
      const foliageMat = new THREE.MeshStandardMaterial({ color: green, roughness: 0.9 });
      const foliage = new THREE.Mesh(foliageGeo, foliageMat);
      foliage.position.set(x, 12 * scale, z);
      this.scene.add(foliage);
      objects.push(foliage);

      // Collision: tree canopy
      colliders.push({ x, z, radius: 6 * scale, topY: (12 + 6) * scale });
    }

    // Occasional windmill (Dutch theme)
    if (this.seededRandom(seed + 999) > 0.6) {
      const wx = baseX + GAME_CONFIG.CHUNK_SIZE / 2;
      const wz = baseZ + GAME_CONFIG.CHUNK_SIZE / 2;

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

      // Windmill blades
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

      // Collision: windmill tower + blades
      colliders.push({ x: wx, z: wz, radius: 8, topY: 32 });
    }

    this.chunks.set(`${chunkX},${chunkZ}`, objects);
    this.obstacles.set(`${chunkX},${chunkZ}`, colliders);
  }

  /**
   * Creates floating clouds that follow the player
   */
  createClouds() {
    for (let i = 0; i < 10; i++) {
      const cloudSubGroup = new THREE.Group();
      for (let j = 0; j < 5; j++) {
        const cloudGeo = new THREE.SphereGeometry(8 + Math.random() * 6, 8, 8);
        const cloudMat = new THREE.MeshStandardMaterial({
          color: 0xFFFFFF,
          transparent: true,
          opacity: 0.8,
          roughness: 1,
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
  // PLAYER SHIP
  // =========================================================================

  /**
   * Gets a unique color for a player based on their socket ID
   */
  getPlayerColor(playerId) {
    let hash = 0;
    for (let i = 0; i < playerId.length; i++) {
      hash = ((hash << 5) - hash) + playerId.charCodeAt(i);
      hash |= 0;
    }
    return PLAYER_COLORS[Math.abs(hash) % PLAYER_COLORS.length];
  }

  /**
   * Creates a flashy modern jet fighter model
   * @param {number} color - Hex color for the plane
   */
  createPlayerShip(color) {
    const planeGroup = new THREE.Group();

    const mainMat = new THREE.MeshStandardMaterial({
      color: color,
      metalness: 0.8,
      roughness: 0.15,
      side: THREE.DoubleSide,
    });

    const chromeMat = new THREE.MeshStandardMaterial({
      color: 0xEEEEEE,
      metalness: 0.95,
      roughness: 0.05,
    });

    const glowMat = new THREE.MeshStandardMaterial({
      color: color,
      emissive: color,
      emissiveIntensity: 0.8,
      metalness: 0.5,
      roughness: 0.3,
    });

    // --- Fuselage (sleek tapered body) ---
    const fuselageGeo = new THREE.CylinderGeometry(0.5, 0.85, 10, 12);
    const fuselage = new THREE.Mesh(fuselageGeo, mainMat);
    fuselage.rotation.x = Math.PI / 2;
    planeGroup.add(fuselage);

    // --- Nose cone (sharp chrome tip) ---
    const noseGeo = new THREE.ConeGeometry(0.5, 3.5, 12);
    const nose = new THREE.Mesh(noseGeo, chromeMat);
    nose.rotation.x = Math.PI / 2;
    nose.position.set(0, 0, -6.7);
    planeGroup.add(nose);

    // --- Cockpit canopy (glass bubble) ---
    const canopyGeo = new THREE.SphereGeometry(0.6, 12, 8, 0, Math.PI * 2, 0, Math.PI / 2);
    const canopyMat = new THREE.MeshStandardMaterial({
      color: 0x66AAFF,
      metalness: 0.1,
      roughness: 0.05,
      transparent: true,
      opacity: 0.45,
    });
    const canopy = new THREE.Mesh(canopyGeo, canopyMat);
    canopy.position.set(0, 0.5, -2.5);
    planeGroup.add(canopy);

    // --- Swept delta wings ---
    const wingShape = new THREE.Shape();
    wingShape.moveTo(0, -1.5);     // center leading edge
    wingShape.lineTo(10, 2.5);     // right tip swept back
    wingShape.lineTo(9, 4.5);      // right trailing edge
    wingShape.lineTo(0, 2);        // center trailing edge
    wingShape.lineTo(-9, 4.5);     // left trailing edge
    wingShape.lineTo(-10, 2.5);    // left tip swept back
    wingShape.closePath();

    const wingGeo = new THREE.ShapeGeometry(wingShape);
    const wing = new THREE.Mesh(wingGeo, mainMat);
    wing.rotation.x = -Math.PI / 2;
    wing.position.set(0, -0.05, 0);
    planeGroup.add(wing);

    // --- Glowing accent stripe along fuselage ---
    const stripeGeo = new THREE.BoxGeometry(0.15, 0.15, 8);
    const leftStripe = new THREE.Mesh(stripeGeo, glowMat);
    leftStripe.position.set(0.6, 0, 0);
    planeGroup.add(leftStripe);
    const rightStripe = new THREE.Mesh(stripeGeo, glowMat);
    rightStripe.position.set(-0.6, 0, 0);
    planeGroup.add(rightStripe);

    // --- Twin angled tail fins (like F-22) ---
    const finGeo = new THREE.BoxGeometry(0.15, 3.5, 2.5);
    const leftFin = new THREE.Mesh(finGeo, mainMat);
    leftFin.position.set(-1.2, 1.5, 4);
    leftFin.rotation.z = -0.3;
    planeGroup.add(leftFin);

    const rightFin = new THREE.Mesh(finGeo, mainMat);
    rightFin.position.set(1.2, 1.5, 4);
    rightFin.rotation.z = 0.3;
    planeGroup.add(rightFin);

    // --- Small horizontal tail wings ---
    const tailGeo = new THREE.BoxGeometry(5, 0.12, 2);
    const tail = new THREE.Mesh(tailGeo, mainMat);
    tail.position.set(0, 0, 4.2);
    planeGroup.add(tail);

    // --- Twin engine exhausts ---
    const exhaustGeo = new THREE.CylinderGeometry(0.35, 0.45, 1.5, 8);
    const exhaustMat = new THREE.MeshStandardMaterial({
      color: 0x222222,
      metalness: 0.95,
      roughness: 0.15,
    });

    const leftExhaust = new THREE.Mesh(exhaustGeo, exhaustMat);
    leftExhaust.rotation.x = Math.PI / 2;
    leftExhaust.position.set(-0.6, 0, 5.5);
    planeGroup.add(leftExhaust);

    const rightExhaust = new THREE.Mesh(exhaustGeo, exhaustMat);
    rightExhaust.rotation.x = Math.PI / 2;
    rightExhaust.position.set(0.6, 0, 5.5);
    planeGroup.add(rightExhaust);

    // --- Afterburner glow ---
    const abGeo = new THREE.SphereGeometry(0.3, 8, 8);
    const abMat = new THREE.MeshStandardMaterial({
      color: 0xFF6600,
      emissive: 0xFF4400,
      emissiveIntensity: 2.0,
      transparent: true,
      opacity: 0.85,
    });

    const leftAB = new THREE.Mesh(abGeo, abMat);
    leftAB.position.set(-0.6, 0, 6.3);
    planeGroup.add(leftAB);

    const rightAB = new THREE.Mesh(abGeo, abMat);
    rightAB.position.set(0.6, 0, 6.3);
    planeGroup.add(rightAB);

    // --- Wing-tip nav lights (player color glow) ---
    const navGeo = new THREE.SphereGeometry(0.2, 6, 6);
    const navMat = new THREE.MeshStandardMaterial({
      color: color,
      emissive: color,
      emissiveIntensity: 1.5,
    });

    const leftNav = new THREE.Mesh(navGeo, navMat);
    leftNav.position.set(-9.5, 0.1, 2.8);
    planeGroup.add(leftNav);

    const rightNav = new THREE.Mesh(navGeo, navMat);
    rightNav.position.set(9.5, 0.1, 2.8);
    planeGroup.add(rightNav);

    // Store refs for animation
    planeGroup.userData.leftAB = leftAB;
    planeGroup.userData.rightAB = rightAB;
    planeGroup.userData.navLights = [leftNav, rightNav];
    planeGroup.userData.glowMat = glowMat;
    planeGroup.userData.abMat = abMat;

    return planeGroup;
  }

  /**
   * Creates a projectile mesh
   */
  createProjectile() {
    const geometry = new THREE.SphereGeometry(0.5);
    const material = new THREE.MeshStandardMaterial({
      color: GAME_CONFIG.PROJECTILE_COLOR,
      emissive: GAME_CONFIG.PROJECTILE_COLOR,
      emissiveIntensity: 0.5,
    });
    return new THREE.Mesh(geometry, material);
  }

  // =========================================================================
  // NETWORKING
  // =========================================================================

  /**
   * Connects to the game server
   * @param {string} username - Player's chosen username
   */
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

        if (reason === 'io server disconnect') {
          this.socket.connect();
        }
      });

      this.socket.on('gameJoined', (data) => {
        this.gameState = data.gameState;
        this.localPlayer = data.player;

        // Create local player ship with unique color
        const myColor = this.getPlayerColor(data.player.id);
        const ship = this.createPlayerShip(myColor);
        ship.position.copy(this.localPlayer.position);
        ship.position.y = GAME_CONFIG.FLIGHT_HEIGHT;
        this.scene.add(ship);
        this.players.set(this.localPlayer.id, ship);

        // Create other players' ships
        if (data.gameState.players) {
          data.gameState.players.forEach(player => {
            if (player.id !== this.localPlayer.id) {
              const otherColor = this.getPlayerColor(player.id);
              const otherShip = this.createPlayerShip(otherColor);
              otherShip.position.copy(player.position);
              this.scene.add(otherShip);
              this.players.set(player.id, otherShip);
            }
          });
        }

        this.updateHUD();
        this.updateEnergyBar(this.localPlayer.energy || 100);
      });

      this.socket.on('playerJoined', (player) => {
        if (player && player.id) {
          const playerColor = this.getPlayerColor(player.id);
          const ship = this.createPlayerShip(playerColor);
          ship.position.copy(player.position);
          this.scene.add(ship);
          this.players.set(player.id, ship);
        }
      });

      this.socket.on('playerLeft', (playerId) => {
        const ship = this.players.get(playerId);
        if (ship) {
          this.scene.remove(ship);
          this.players.delete(playerId);
        }
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

      this.socket.on('playerHit', (data) => {
        if (data.targetId === this.localPlayer?.id) {
          this.updateHealth(data.damage);
        }
        if (data.gameState) {
          this.gameState = data.gameState;
          this.updateHUD();
        }
      });

      this.socket.on('chatMessage', (data) => {
        this.displayChatMessage(data.username, data.message);
      });

      this.socket.on('gameStart', (gameState) => {
        this.gameState = gameState;
        this.updateHUD();
      });

      this.socket.on('gameEnd', (gameState) => {
        this.gameState = gameState;
        this.showGameEnd();
      });

      this.socket.on('error', (error) => {
        console.error('Socket error:', error);
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

    const messageElement = document.createElement('div');
    messageElement.className = 'chat-message';
    messageElement.innerHTML = `<strong>${this.sanitizeInput(username)}:</strong> ${this.sanitizeInput(message)}`;

    chatMessages.appendChild(messageElement);
    chatMessages.scrollTop = chatMessages.scrollHeight;

    while (chatMessages.children.length > 50) {
      chatMessages.removeChild(chatMessages.firstChild);
    }
  }

  updateHealth(damage) {
    const healthFill = document.querySelector('.health-fill');
    if (!healthFill) return;

    const currentWidth = parseFloat(healthFill.style.width) || 100;
    const newWidth = Math.max(0, currentWidth - damage);
    healthFill.style.width = `${newWidth}%`;
  }

  updateEnergyBar(energyPercent) {
    const energyFill = document.querySelector('.energy-fill');
    if (!energyFill) return;

    const clampedEnergy = Math.max(0, Math.min(100, energyPercent));
    energyFill.style.width = `${clampedEnergy}%`;

    if (clampedEnergy < 20) {
      energyFill.style.backgroundColor = '#ff4444';
    } else if (clampedEnergy < 50) {
      energyFill.style.backgroundColor = '#ffaa00';
    } else {
      energyFill.style.backgroundColor = '#00aaff';
    }
  }

  updateHUD() {
    if (!this.gameState || !this.localPlayer) return;

    const killsEl = document.getElementById('kills');
    const deathsEl = document.getElementById('deaths');
    const assistsEl = document.getElementById('assists');
    const redScoreEl = document.getElementById('red-score');
    const blueScoreEl = document.getElementById('blue-score');
    const timeRemainingEl = document.getElementById('time-remaining');

    if (killsEl) killsEl.textContent = this.localPlayer.kills || 0;
    if (deathsEl) deathsEl.textContent = this.localPlayer.deaths || 0;
    if (assistsEl) assistsEl.textContent = this.localPlayer.assists || 0;

    if (this.gameState.scores) {
      if (redScoreEl) redScoreEl.textContent = this.gameState.scores.red || 0;
      if (blueScoreEl) blueScoreEl.textContent = this.gameState.scores.blue || 0;
    }

    if (timeRemainingEl && typeof this.gameState.timeRemaining === 'number') {
      const minutes = Math.floor(this.gameState.timeRemaining / 60000);
      const seconds = Math.floor((this.gameState.timeRemaining % 60000) / 1000);
      timeRemainingEl.textContent = `${minutes}:${seconds.toString().padStart(2, '0')}`;
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
      case ' ':
        this.controls.shooting = true;
        event.preventDefault();
        break;
      case 'q':
      case 'arrowleft':
        this.controls.rotateLeft = true;
        event.preventDefault();
        break;
      case 'e':
      case 'arrowright':
        this.controls.rotateRight = true;
        event.preventDefault();
        break;
    }
  }

  onKeyUp(event) {
    switch (event.key.toLowerCase()) {
      case 'w': this.controls.forward = false; break;
      case 's': this.controls.backward = false; break;
      case 'a': this.controls.left = false; break;
      case 'd': this.controls.right = false; break;
      case 'shift': this.controls.boost = false; break;
      case ' ':
        this.controls.shooting = false;
        event.preventDefault();
        break;
      case 'q':
      case 'arrowleft':
        this.controls.rotateLeft = false;
        event.preventDefault();
        break;
      case 'e':
      case 'arrowright':
        this.controls.rotateRight = false;
        event.preventDefault();
        break;
    }
  }

  // =========================================================================
  // GAME LOOP
  // =========================================================================

  /**
   * Updates local player position, rotation, energy, camera, and terrain
   */
  updatePlayer(delta) {
    if (!this.localPlayer || !this.players.has(this.localPlayer.id)) return;
    if (this.crashed) return;

    const ship = this.players.get(this.localPlayer.id);

    // Initialize energy if not set
    if (typeof this.localPlayer.energy !== 'number') {
      this.localPlayer.energy = 100;
    }

    // Energy management for boost
    let speed = GAME_CONFIG.MOVEMENT_SPEED;
    if (this.controls.boost && this.localPlayer.energy > 0) {
      speed = GAME_CONFIG.BOOST_SPEED;
      this.localPlayer.energy = Math.max(0, this.localPlayer.energy - (GAME_CONFIG.ENERGY_DRAIN_RATE * delta));
    } else {
      this.localPlayer.energy = Math.min(100, this.localPlayer.energy + (GAME_CONFIG.ENERGY_REGEN_RATE * delta));
    }

    this.updateEnergyBar(this.localPlayer.energy);

    // Rotation
    const rotationSpeed = 3;
    if (this.controls.rotateLeft) {
      this.shipRotation += rotationSpeed * delta;
    }
    if (this.controls.rotateRight) {
      this.shipRotation -= rotationSpeed * delta;
    }

    ship.rotation.y = this.shipRotation;

    // Movement in the direction the ship is facing
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

    // Keep plane at flight height
    ship.position.y = GAME_CONFIG.FLIGHT_HEIGHT;

    // NO BOUNDS - infinite world!

    // Move ground plane with player so it's always underfoot
    if (this.groundPlane) {
      this.groundPlane.position.x = ship.position.x;
      this.groundPlane.position.z = ship.position.z;
    }

    // Move cloud group with player
    if (this.cloudGroup) {
      this.cloudGroup.position.x = ship.position.x;
      this.cloudGroup.position.z = ship.position.z;
    }

    // Update terrain chunks around player
    this.updateChunks(ship.position.x, ship.position.z);

    // Send position to server
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

    // Animate afterburners (pulse effect)
    const abScale = 0.8 + Math.sin(this.animationTime * 15) * 0.3;
    const isBoosting = this.controls.boost && this.localPlayer.energy > 0;
    const abTargetScale = isBoosting ? abScale * 1.6 : abScale;

    if (ship.userData.leftAB) {
      ship.userData.leftAB.scale.setScalar(abTargetScale);
      ship.userData.rightAB.scale.setScalar(abTargetScale);
    }
    if (ship.userData.abMat) {
      ship.userData.abMat.emissiveIntensity = isBoosting ? 3.0 : 1.5;
    }

    // Blink nav lights
    if (ship.userData.navLights) {
      const blinkIntensity = 0.8 + Math.sin(this.animationTime * 5) * 0.7;
      ship.userData.navLights.forEach(light => {
        light.material.emissiveIntensity = blinkIntensity;
      });
    }

    // Collision detection
    this.checkCollisions(ship);

    // Third-person camera: above and slightly behind the plane
    const camBehind = 14;
    const camUp = 8;
    this.camera.position.x = ship.position.x + Math.sin(this.shipRotation) * camBehind;
    this.camera.position.y = ship.position.y + camUp;
    this.camera.position.z = ship.position.z + Math.cos(this.shipRotation) * camBehind;
    this.camera.lookAt(ship.position);
  }

  /**
   * Checks plane collision against nearby obstacles
   */
  checkCollisions(ship) {
    if (this.crashed) return;

    const px = ship.position.x;
    const py = ship.position.y;
    const pz = ship.position.z;
    const pr = GAME_CONFIG.PLANE_COLLISION_RADIUS;

    for (const [, colliders] of this.obstacles) {
      for (const obs of colliders) {
        // Skip if plane is above the obstacle
        if (py > obs.topY) continue;

        // XZ distance check
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

  /**
   * Triggers a crash: freezes the plane, shows crash UI, then respawns
   */
  triggerCrash(ship) {
    this.crashed = true;

    // Show crash overlay
    const overlay = document.getElementById('crash-overlay');
    if (overlay) overlay.style.display = 'flex';

    // Deduct health
    this.updateHealth(GAME_CONFIG.CRASH_HEALTH_PENALTY);

    // Respawn after delay
    setTimeout(() => {
      this.crashed = false;
      if (overlay) overlay.style.display = 'none';

      // Move plane to a safe position (up and away from obstacles)
      ship.position.x += (Math.random() - 0.5) * 60;
      ship.position.z += (Math.random() - 0.5) * 60;
      ship.position.y = GAME_CONFIG.FLIGHT_HEIGHT;
    }, GAME_CONFIG.CRASH_DURATION);
  }

  /**
   * Main game loop
   */
  animate() {
    requestAnimationFrame(this.animate.bind(this));

    const delta = this.clock.getDelta();
    this.animationTime += delta;

    if (this.localPlayer) {
      this.updatePlayer(delta);

      // Update projectiles - despawn based on distance from player
      const playerShip = this.players.get(this.localPlayer.id);
      this.projectiles.forEach((projectile, id) => {
        if (projectile.velocity) {
          projectile.position.add(projectile.velocity.clone().multiplyScalar(delta));

          // Remove projectiles too far from the player
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

    // Animate other players' afterburners and nav lights too
    this.players.forEach((ship, id) => {
      if (id !== this.localPlayer?.id) {
        if (ship.userData.leftAB) {
          const s = 0.8 + Math.sin(this.animationTime * 15 + id.length) * 0.3;
          ship.userData.leftAB.scale.setScalar(s);
          ship.userData.rightAB.scale.setScalar(s);
        }
        if (ship.userData.navLights) {
          const b = 0.8 + Math.sin(this.animationTime * 5 + id.length * 0.5) * 0.7;
          ship.userData.navLights.forEach(light => {
            light.material.emissiveIntensity = b;
          });
        }
      }
    });

    this.renderer.render(this.scene, this.camera);
  }
}

// Start the game
new Game();
