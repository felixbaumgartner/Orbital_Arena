import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { io } from 'socket.io-client';
import { TextureFactory } from './scenery/textures.js';
import { SkySystem } from './scenery/sky.js';
import { CloudSystem } from './scenery/clouds.js';
import {
  ChunkBatch, createSharedMaterials, addTree, addHouse, addTerrace, addLamp, addFence,
  makeRoad, makeCar, addTurbine, createHorizonRing, makeFlowerField, gableGeometry,
} from './scenery/props.js';
import { PostFX } from './postfx.js';
import { Instruments } from './ui/instruments.js';
import { TouchControls } from './ui/touch.js';

// Game constants
const GAME_CONFIG = {
  CAMERA_FOV: 75,
  CAMERA_NEAR: 0.5,
  CAMERA_FAR: 2000,
  CAMERA_DISTANCE: 20,
  CAMERA_HEIGHT: 10,

  CHUNK_SIZE: 200,
  VIEW_DISTANCE: 3,
  FOG_NEAR: 300,
  FOG_FAR: 950,
  GROUND_SIZE: 2000,

  PROJECTILE_DESPAWN_DIST: 340,

  FLIGHT_HEIGHT: 42,          // cruise altitude: above spires, lighthouses and poplars
  PLANE_COLLISION_RADIUS: 4,
  CRASH_DURATION: 1400,
  CRASH_HEALTH_PENALTY: 20,   // must match server CRASH_DAMAGE
  CRASH_GRACE: 2.0,           // seconds of collision immunity after a crash respawn
  PROJECTILE_SPEED: 220,      // must match server PROJECTILE_SPEED
  FIRE_COOLDOWN: 0.15,

  // Targeting
  LOCK_RANGE: 360,            // enemies farther than this get no bracket
  LOCK_CONE: 22,              // degrees off the nose to show the bracket + lead circle
  AIM_ASSIST_CONE: 12,        // degrees inside which shots bend onto the lead point
  AIM_ASSIST_SNAP: 6,         // inside this, shots snap fully
  CLIENT_HIT_RADIUS: 8,       // your bullets hit what they visibly pass through (units)

  // Altitude (the third dimension!)
  MIN_ALTITUDE: 8,            // ground-skimming floor
  MAX_ALTITUDE: 110,          // ceiling
  MAX_PITCH: 0.5,             // rad of nose-up/down at full climb/dive input
  PITCH_SMOOTHING: 5,         // how quickly pitch eases toward input
  RESPAWN_ALTITUDE: 60,       // post-crash climb-out height (above every obstacle)
  MOUSE_SENSITIVITY: 0.0022,  // stick deflection per pixel of mouse travel
  MOUSE_STICK_DECAY: 2.2,     // how quickly the virtual stick re-centres (per second)
  CONTROLS_PANEL_SECONDS: 25, // the key legend hides itself after this long in the air

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

  // Turning & banking
  TURN_RATE: 3,          // max turn rate (rad/s)
  TURN_SMOOTHING: 6,     // how quickly turn rate ramps toward input (per second)
  MAX_BANK_ANGLE: 0.55,  // visual roll at full turn (rad, ~31°)
  BANK_SMOOTHING: 5,     // how quickly the roll eases toward its target

  // Throttle
  THROTTLE_MIN: 0.35,
  THROTTLE_MAX: 1.5,
  THROTTLE_RATE: 0.6,    // throttle change per second while held

  // Tulip power-ups
  PICKUP_RADIUS: 9,
  PICKUP_SPAWN_CHANCE: 0.5,       // per chunk
  SPEED_SURGE_DURATION: 5,        // seconds of golden tulip speed surge
  SPEED_SURGE_MULTIPLIER: 1.5,

  // Barrel roll
  ROLL_DURATION: 0.7,
  ROLL_COOLDOWN: 2.0,
  ROLL_DODGE_SPEED: 45,           // sideways dodge speed during a roll

  // Radar
  RADAR_RANGE: 500,               // world units shown on the minimap
  ENERGY_DRAIN_RATE: 20,
  ENERGY_REGEN_RATE: 10,

  PROJECTILE_COLOR: 0xFFE9A8,

  USERNAME_MAX_LENGTH: 15,
  USERNAME_MIN_LENGTH: 1,
  CHAT_MESSAGE_MAX_LENGTH: 200,

  RECONNECT_ATTEMPTS: 5,
  RECONNECT_DELAY: 1000,

  // Environment
  DAY_CYCLE_MINUTES: 16,      // real minutes per in-game day
  START_HOUR: 8.5,
  GROUND_TILE: 24,            // world units per grass texture tile
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
      left: false, right: false,          // A/D (or Q/E/arrows): banked turn
      pitchUp: false, pitchDown: false,   // ↑/↓: climb & dive
      throttleUp: false, throttleDown: false, // W/S: speed
      boost: false, shooting: false,
    };
    this.shipRotation = 0;
    this.rotationVelocity = 0; // smoothed turn rate (rad/s)
    this.throttle = 1.0;       // speed multiplier, THROTTLE_MIN..THROTTLE_MAX
    this.pitchAngle = 0;       // smoothed climb/dive angle (rad, positive = climbing)

    // Infinite terrain
    this.chunks = new Map();
    this.chunkLods = new Map(); // chunk key -> 'high' | 'low'
    this.obstacles = new Map();
    this.groundPlane = null;
    this.cloudGroup = null;
    this.animationTime = 0;

    // Crash state
    this.crashed = false;
    this.crashTimer = 0;
    this.crashGrace = 0;

    // Camera shake
    this.shakeTime = 0;
    this.shakeDur = 0;
    this.shakeMag = 0;

    // Live match timer (client-side countdown between server updates)
    this.timerSync = null;
    this.lastTimerText = '';

    // Tutorial gating: takeoff waits until the tutorial is dismissed
    this.pendingTakeoffShip = null;

    // Death state (shot down — server controls respawn)
    this.dead = false;

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

    // Tulip power-ups
    this.powerups = new Map(); // chunk key -> [{mesh, type, active, x, z}]
    this.speedSurge = 0;

    // Barrel roll
    this.rollTimer = 0;
    this.rollCooldown = 0;
    this.rollDir = 1;

    // Audio (initialized on first user gesture)
    this.audio = null;

    // Ambient animated scenery (balloons, boats, lighthouse beams)
    this.ambient = new Map(); // chunk key -> [{mesh, type, ...params}]
    this.birdFlock = null;
    this.birdAnchor = new THREE.Vector3();
    this.birdAngle = 0;

    // Environment & scenery systems (created in init)
    this.textures = null;
    this.mats = null;
    this.sky = null;
    this.clouds = null;
    this.postfx = null;
    this.instruments = null;
    this.horizonRing = null;
    this.cloudShadow = null;
    this.groundTex = null;
    this.groundMat = null;
    this.viewDistance = GAME_CONFIG.VIEW_DISTANCE;
    this.wind = { angle: Math.random() * Math.PI * 2, speed: 7, targetSpeed: 7, x: 0, z: 0 };
    this.weatherNow = { fogNear: 320, fogFar: 1000, overcast: 0, rain: 0, cover: 0.3, wind: 7 };
    this.lightningTimer = 8;
    this.chunkLandmarks = new Map();
    this.discovered = new Set();
    this.visitedBlocks = new Set();
    this.lastBiomeKey = null;
    this.photoMode = false;
    this.photoAngle = 0;
    this.captureRequested = false;
    this.pullUpBeep = 0;
    this.prevAltitude = null;
    this.verticalSpeed = 0;
    this.boostVignette = 0;

    // Mouse steering (pointer lock) as a self-centring virtual stick
    this.mouseStick = { turn: 0, pitch: 0 };
    this.pointerLocked = false;

    // Touch (phones / tablets)
    this.isTouch = TouchControls.isTouchDevice();
    this.touch = null;

    // Onboarding, HUD state, match rules
    this.onboarding = null;
    this.controlsPanelTimer = 0;
    this.controlsPanelHidden = false;
    this.scoreboardOpen = false;
    this.rules = { killScore: 5, millTickSeconds: 5 };
    this.firstFlight = false;

    // Targeting: last known enemy health, current bracketed target
    this.knownHealth = {};
    this.currentTarget = null;
    this.lockedId = null;

    // Match mode, countdown, score popups, medals, streaks, XP
    this.mode = 'domination';
    this.pendingMode = 'domination';
    this.countdownEndsAt = 0;
    this.countdownLast = null;
    this.sessionXp = 0;
    this.medalsEarned = [];
    this.killTimes = [];
    this.lastKilledBy = null;
    this.deathsSinceKill = 0;
    this.matchKills = 0;
    this.streak = 0;
    this.radarSweepUntil = 0;
    this.calloutsDone = new Set();
    this.xpBanked = false;

    this.init();

    // Debug handle (also used by automated QA)
    window.__game = this;
  }

  init() {
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));

    // Procedural textures and the shared materials every chunk reuses
    this.textures = new TextureFactory(this.renderer.capabilities.getMaxAnisotropy());
    this.mats = createSharedMaterials(this.textures);

    // Filmic tone mapping: the single biggest "AAA look" switch — rich
    // saturated mids, soft highlight rolloff instead of clipping
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.15;

    // Real-time shadows ground every object in the world
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;

    document.getElementById('game-container').appendChild(this.renderer.domElement);

    this.camera.position.set(0, 50, 40);
    this.camera.lookAt(0, 0, 0);

    this.scene.background = new THREE.Color(0x87CEEB);
    this.scene.fog = new THREE.Fog(0x87CEEB, GAME_CONFIG.FOG_NEAR, GAME_CONFIG.FOG_FAR);

    // Three-point outdoor rig: weak neutral fill, strong warm key (sun),
    // cool sky / green ground bounce. Contrast comes from the ratio.
    const ambientLight = new THREE.AmbientLight(0xffffff, 0.35);
    this.scene.add(ambientLight);
    this.ambientLight = ambientLight;

    const sunLight = new THREE.DirectionalLight(0xFFE3B3, 1.9);
    sunLight.position.set(120, 180, 80);
    sunLight.castShadow = true;
    sunLight.shadow.mapSize.set(2048, 2048);
    sunLight.shadow.camera.near = 20;
    sunLight.shadow.camera.far = 600;
    const S = 280; // shadow frustum half-size, follows the player
    sunLight.shadow.camera.left = -S;
    sunLight.shadow.camera.right = S;
    sunLight.shadow.camera.top = S;
    sunLight.shadow.camera.bottom = -S;
    sunLight.shadow.bias = -0.0004;
    sunLight.shadow.normalBias = 1.5;
    this.scene.add(sunLight);
    this.scene.add(sunLight.target);
    this.sunLight = sunLight;

    const hemiLight = new THREE.HemisphereLight(0x87CEEB, 0x5B8C3E, 0.55);
    this.scene.add(hemiLight);
    this.hemiLight = hemiLight;

    // Sky, clouds and the far horizon
    this.sky = new SkySystem(this.scene, this.textures, {
      startHour: GAME_CONFIG.START_HOUR, cycleMinutes: GAME_CONFIG.DAY_CYCLE_MINUTES,
    });
    this.clouds = new CloudSystem(this.scene, this.textures);
    this.horizonRing = createHorizonRing(this.textures);
    this.scene.add(this.horizonRing);

    this.createInfiniteTerrain();
    this.createBirdFlock();
    this.createRunway();
    this.initWeather();
    this.createCaptureWindmills();

    window.addEventListener('resize', this.onWindowResize.bind(this));
    document.addEventListener('keydown', this.onKeyDown.bind(this));
    document.addEventListener('keyup', this.onKeyUp.bind(this));

    // HUD instruments, settings and post-processing
    this.instruments = new Instruments({
      onSettingsChange: (key, value, settings) => this.onSettingsChange(key, value, settings),
    });
    this.postfx = new PostFX(this.renderer, this.scene, this.camera);
    this.applySettings(this.instruments.settings);

    this.setupUI();
    this.animate();
  }

  onSettingsChange(key, value, settings) {
    this.applySettings(settings);
    if (key === 'quality') this.instruments.toast('⚙️', `Graphics: ${value}`, 'Applied');
  }

  /** Quality presets trade scenery density and effects for frame rate */
  applySettings(settings) {
    const dpr = window.devicePixelRatio || 1;
    const presets = {
      low:    { pr: 1, shadows: false, shadowSize: 1024, view: 2, clouds: 0.5, bloom: false, cloudShadow: false },
      medium: { pr: Math.min(dpr, 1.5), shadows: true, shadowSize: 1024, view: 3, clouds: 0.8, bloom: false, cloudShadow: true },
      high:   { pr: Math.min(dpr, 2), shadows: true, shadowSize: 2048, view: 3, clouds: 1, bloom: true, cloudShadow: true },
      ultra:  { pr: dpr, shadows: true, shadowSize: 4096, view: 4, clouds: 1.2, bloom: true, cloudShadow: true },
    };
    const p = presets[settings.quality] || presets.high;

    this.renderer.setPixelRatio(p.pr);
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    this.postfx.resize(window.innerWidth, window.innerHeight, p.pr);
    this.postfx.setBloom(p.bloom && settings.bloom !== false);

    if (this.renderer.shadowMap.enabled !== p.shadows) {
      this.renderer.shadowMap.enabled = p.shadows;
      this.scene.traverse(obj => {
        if (!obj.material) return;
        const mats = Array.isArray(obj.material) ? obj.material : [obj.material];
        mats.forEach(m => { m.needsUpdate = true; });
      });
    }
    if (this.sunLight && this.sunLight.shadow.mapSize.x !== p.shadowSize) {
      this.sunLight.shadow.mapSize.set(p.shadowSize, p.shadowSize);
      if (this.sunLight.shadow.map) {
        this.sunLight.shadow.map.dispose();
        this.sunLight.shadow.map = null;
      }
    }
    this.viewDistance = p.view;
    if (this.clouds) this.clouds.setDensity(p.clouds);
    if (this.cloudShadow) this.cloudShadow.visible = p.cloudShadow;
    if (this.sky) this.sky.setTimeMode(settings.time || 'auto');
  }

  setupUI() {
    const startButton = document.getElementById('start-button');
    const usernameInput = document.getElementById('username-input');
    const loginScreen = document.getElementById('login-screen');
    const hud = document.getElementById('hud');
    const chatInput = document.getElementById('chat-input');

    const start = () => {
      this.initAudio(); // requires a user gesture (resumed later if not)
      if (this.isTouch) {
        try { document.documentElement.requestFullscreen?.(); } catch (e) { /* iOS: not available */ }
        try { screen.orientation?.lock?.('landscape').catch(() => {}); } catch (e) { /* ignore */ }
      }
      const username = this.sanitizeInput(usernameInput.value.trim());
      if (!this.isValidUsername(username)) {
        alert(`Username must be between ${GAME_CONFIG.USERNAME_MIN_LENGTH} and ${GAME_CONFIG.USERNAME_MAX_LENGTH} characters and contain only letters, numbers, and spaces.`);
        return;
      }
      const modeInput = document.querySelector('input[name="mode"]:checked');
      this.pendingMode = modeInput && modeInput.value === 'tdm' ? 'tdm' : 'domination';
      try {
        localStorage.setItem('dvf.name', username);
        localStorage.setItem('dvf.mode', this.pendingMode);
      } catch (e) { /* ignore */ }
      this.connectToServer(username);
      loginScreen.style.display = 'none';
      hud.style.display = 'block';
    };
    startButton.addEventListener('click', start);

    // Remember the pilot; "Fly Again" skips the login screen entirely
    try {
      const saved = localStorage.getItem('dvf.name');
      if (saved) usernameInput.value = saved;
      const savedMode = localStorage.getItem('dvf.mode');
      const modeRadio = document.querySelector(`input[name="mode"][value="${savedMode === 'tdm' ? 'tdm' : 'domination'}"]`);
      if (modeRadio) modeRadio.checked = true;
      const rankEl = document.getElementById('login-rank');
      if (rankEl) {
        const xp = this.totalXp();
        rankEl.textContent = `Lv ${this.levelFor(xp)} · ${this.rankFor(xp)} · ${xp.toLocaleString()} XP`;
      }
      if (localStorage.getItem('dvf.autoStart') === '1' && saved) {
        localStorage.removeItem('dvf.autoStart');
        setTimeout(start, 50);
      }
    } catch (e) { /* ignore */ }

    // Touch controls: thumbstick + hold buttons, shown once airborne
    if (this.isTouch) {
      document.body.classList.add('touch');
      this.touch = new TouchControls({
        onFire: (down) => { this.controls.shooting = down; },
        onBoost: (down) => { this.controls.boost = down; },
        onRoll: () => this.startBarrelRoll(),
        onSettings: () => this.instruments.toggleSettings(),
        onScores: () => this.setScoreboardOpen(!this.scoreboardOpen),
      });
      this.touch.show(false);
      const rotate = document.getElementById('rotate-overlay');
      const checkOrientation = () => {
        if (!rotate || this.rotateDismissed) return;
        rotate.classList.toggle('show', window.innerHeight > window.innerWidth);
      };
      window.addEventListener('resize', checkOrientation);
      checkOrientation();
      const dismiss = document.getElementById('rotate-dismiss');
      if (dismiss) dismiss.addEventListener('click', () => { this.rotateDismissed = true; rotate.classList.remove('show'); });
    }

    // Mouse steering: click the world to grab the pointer, Esc releases it
    const canvas = this.renderer.domElement;
    canvas.addEventListener('click', () => {
      if (this.isTouch) return;
      if (!this.localPlayer || !this.controlsEnabled) return;
      if (this.instruments?.settings.mouse === false) return;
      if (document.pointerLockElement !== canvas) {
        try { canvas.requestPointerLock(); } catch (e) { /* unsupported */ }
      }
    });
    document.addEventListener('pointerlockchange', () => {
      this.pointerLocked = document.pointerLockElement === canvas;
      this.mouseStick.turn = 0;
      this.mouseStick.pitch = 0;
      if (!this.pointerLocked) this.controls.shooting = false;
    });
    document.addEventListener('mousemove', (e) => {
      if (!this.pointerLocked) return;
      const k = GAME_CONFIG.MOUSE_SENSITIVITY;
      this.mouseStick.turn = Math.max(-1, Math.min(1, this.mouseStick.turn - e.movementX * k));
      this.mouseStick.pitch = Math.max(-1, Math.min(1, this.mouseStick.pitch - e.movementY * k));
    });
    document.addEventListener('mousedown', (e) => {
      if (this.pointerLocked && e.button === 0) this.controls.shooting = true;
    });
    document.addEventListener('mouseup', (e) => {
      if (e.button === 0 && this.pointerLocked) this.controls.shooting = false;
    });

    // Chat stays collapsed to its last lines until you press Enter
    chatInput.addEventListener('focus', () => this.instruments?.setChatCollapsed(false));
    chatInput.addEventListener('blur', () => this.instruments?.setChatCollapsed(true));
    if (this.instruments) this.instruments.setChatCollapsed(true);

    usernameInput.addEventListener('keypress', (e) => {
      if (e.key === 'Enter') startButton.click();
    });

    document.getElementById('tutorial-close').addEventListener('click', () => this.closeTutorial());

    const endButton = document.getElementById('end-restart');
    if (endButton) endButton.addEventListener('click', () => {
      try { localStorage.setItem('dvf.autoStart', '1'); } catch (e) { /* ignore */ }
      window.location.reload();
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
   * Dismisses the tutorial and, on a first run, starts the takeoff that
   * was held back so new players read the controls while safely parked.
   */
  closeTutorial() {
    const tutorial = document.getElementById('tutorial');
    if (tutorial) tutorial.style.display = 'none';
    if (this.pendingTakeoffShip) {
      const ship = this.pendingTakeoffShip;
      this.pendingTakeoffShip = null;
      this.startTakeoff(ship);
    }
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
    const high = lod === 'high';
    const flowerPatches = [];

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
        colliders.push(addTree(batch, rnd(s + 4) < 0.15 ? 'willow' : 'oak', p.x, p.z, 0.75 + rnd(s + 3) * 0.6, seed + s));
      }
      for (let along = along0 + 8; along < along0 + CS; along += 18) {
        if (rnd(along + 3) < 0.25) continue;
        const p = place(along, roadPos - 7.5);
        colliders.push(addTree(batch, 'poplar', p.x, p.z, 0.9 + rnd(along) * 0.3, seed + along));
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

        // Grazing sheep
        const herd = 3 + Math.floor(rnd(5000) * 4);
        this.addHerd(baseX + 30 + rnd(5001) * (CS - 60), baseZ + 30 + rnd(5002) * (CS - 60), herd, 'sheep', seed + 5010, objects);
      }

      // Field trees
      const numTrees = 2 + Math.floor(rnd(550) * 3);
      for (let i = 0; i < numTrees; i++) {
        const s = 6000 + i * 100;
        colliders.push(addTree(batch, 'oak', baseX + rnd(s + 1) * CS, baseZ + rnd(s + 2) * CS, 0.6 + rnd(s + 3) * 0.5, seed + s));
      }

      // Wind farm on the open land
      if (rnd(880) > 0.86) this.addTurbineRow(batch, baseX, baseZ, seed + 890, chunkKey, objects, colliders);
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
          colliders.push(addTree(batch, 'poplar', x, canalZ + canalW / 2 + 6, 0.9 + rnd(x) * 0.35, seed + x));
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
          colliders.push(addTree(batch, 'poplar', canalX + canalW / 2 + 6, z, 0.9 + rnd(z) * 0.35, seed + z));
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
        colliders.push(addTree(batch, 'willow', x + r + 6, z - 3, 0.8 + rnd(s + 9) * 0.4, seed + s));
      }

      const numTrees = 2 + Math.floor(rnd(750) * 3);
      for (let i = 0; i < numTrees; i++) {
        const s = 7500 + i * 100;
        colliders.push(addTree(batch, 'oak', baseX + rnd(s + 1) * CS, baseZ + rnd(s + 2) * CS, 0.8 + rnd(s + 3) * 0.4, seed + s));
      }

      if (high && rnd(799) > 0.6) {
        this.addWindmill(baseX + 20 + rnd(800) * (CS - 40), baseZ + 20 + rnd(801) * (CS - 40), objects, colliders);
      }
      if (rnd(881) > 0.8) this.addTurbineRow(batch, baseX, baseZ, seed + 891, chunkKey, objects, colliders);
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
    const landmarkRoll = rnd(4242);
    if (landmarkRoll < 0.025) {
      this.addCastle(baseX + CS / 2, baseZ + CS / 2, objects, colliders);
      this.registerLandmark(chunkKey, baseX + CS / 2, baseZ + CS / 2, '🏰', 'Castle', 'A medieval stronghold');
    } else if (landmarkRoll < 0.05) {
      this.addLighthouse(baseX + CS / 2, baseZ + CS / 2, chunkKey, objects, colliders);
      this.registerLandmark(chunkKey, baseX + CS / 2, baseZ + CS / 2, '🗼', 'Lighthouse', 'Guiding ships on the lake');
    } else if (landmarkRoll < 0.07) {
      for (let i = 0; i < 4; i++) {
        const s = seed + 4300 + i * 31;
        this.addHotAirBalloon(baseX + 40 + this.seededRandom(s) * (CS - 80), baseZ + 40 + this.seededRandom(s + 1) * (CS - 80), s + 2, chunkKey, objects);
      }
      this.registerLandmark(chunkKey, baseX + CS / 2, baseZ + CS / 2, '🎈', 'Balloon Festival', 'Balloons fill the sky');
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
    this.obstacles.set(chunkKey, colliders);
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
    this.registerLandmark(chunkKey, sx + Math.cos(dir) * 55, sz + Math.sin(dir) * 55, '🌬️', 'Wind Farm', 'Turbines harvesting the polder wind');
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

    // A respawn or teleport would draw a laser-straight line across the sky;
    // start a fresh trail instead
    const last = trail.points[trail.points.length - 1];
    if (last && last.distanceToSquared(position) > 40 * 40) trail.points.length = 0;
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
      if (p.userData.isFlash) {
        p.material.opacity = t * 0.9;
        p.scale.setScalar(1 + (1 - t) * 9);
      } else {
        p.material.opacity = t * 0.6;
        p.scale.setScalar(1 + (1 - t) * 2.5);
      }
      if (p.userData.grav) p.userData.vel.y -= 55 * delta;
      p.position.addScaledVector(p.userData.vel, delta);
    }
  }

  /**
   * Fireball + debris burst at a kill site — the payoff moment
   */
  spawnExplosion(position) {
    // Expanding flash core
    const flash = new THREE.Mesh(
      new THREE.SphereGeometry(1.5, 8, 8),
      new THREE.MeshBasicMaterial({ color: 0xFFDD66, transparent: true, opacity: 0.9 })
    );
    flash.position.copy(position);
    flash.userData = {
      vel: new THREE.Vector3(), life: 0.28, maxLife: 0.28, isFlash: true,
    };
    this.scene.add(flash);
    this.smokeParticles.push(flash);

    // Debris and fire chunks with gravity
    const colors = [0xFF5500, 0xFF8800, 0xFFAA00, 0x333333, 0x666666];
    for (let i = 0; i < 26; i++) {
      const size = 0.4 + Math.random() * 0.9;
      const p = new THREE.Mesh(
        new THREE.SphereGeometry(size, 5, 4),
        new THREE.MeshBasicMaterial({ color: colors[i % colors.length], transparent: true, opacity: 0.95 })
      );
      p.position.copy(position);
      const a = Math.random() * Math.PI * 2;
      const b = (Math.random() - 0.3) * Math.PI;
      const spd = 12 + Math.random() * 26;
      const life = 0.5 + Math.random() * 0.6;
      p.userData = {
        vel: new THREE.Vector3(
          Math.cos(a) * Math.cos(b) * spd,
          Math.sin(b) * spd + 8,
          Math.sin(a) * Math.cos(b) * spd
        ),
        life, maxLife: life, grav: true,
      };
      this.scene.add(p);
      this.smokeParticles.push(p);
    }

    // Audible if it happened anywhere near the player
    const my = this.localPlayer && this.players.get(this.localPlayer.id);
    if (!my || my.position.distanceTo(position) < 450) this.playSound('explosion');
  }

  /**
   * Kicks off a decaying camera shake (magnitude in world units)
   */
  shake(magnitude, duration) {
    this.shakeMag = magnitude;
    this.shakeDur = duration;
    this.shakeTime = duration;
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
      clear:  { fogNear: 320, fogFar: 1000, overcast: 0.0,  rain: 0, cover: 0.3,  wind: 7 },
      cloudy: { fogNear: 220, fogFar: 720,  overcast: 0.55, rain: 0, cover: 0.75, wind: 11 },
      rainy:  { fogNear: 90,  fogFar: 380,  overcast: 0.92, rain: 1, cover: 1.0,  wind: 16 },
      foggy:  { fogNear: 30,  fogFar: 200,  overcast: 0.8,  rain: 0, cover: 0.5,  wind: 4 },
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

    // Screen-space streaks: constant pixel size so drops near the camera
    // never balloon into blobs
    const mat = new THREE.PointsMaterial({
      color: 0xC8D6E4, size: 14, sizeAttenuation: false, transparent: true, opacity: 0,
      map: this.textures.rainStreak(), depthWrite: false,
    });

    this.rainMesh = new THREE.Points(geo, mat);
    this.scene.add(this.rainMesh);
  }

  updateWeather(delta) {
    const ws = this.weatherState;
    if (!ws) return;
    ws.timer += delta;

    if (!ws.transitioning) {
      Object.assign(this.weatherNow, this.weatherPresets[ws.current]);
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

      const now = this.weatherNow;
      for (const k of ['fogNear', 'fogFar', 'overcast', 'rain', 'cover', 'wind']) {
        now[k] = from[k] + (to[k] - from[k]) * t;
      }
      this.rainMesh.material.opacity = now.rain * 0.6;

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
        pos[i * 3] += this.wind.x * 0.6 * delta;
        pos[i * 3 + 2] += this.wind.z * 0.6 * delta;
        if (pos[i * 3 + 1] < 0 || Math.abs(pos[i * 3]) > 160 || Math.abs(pos[i * 3 + 2]) > 160) {
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

    // Lightning during storms
    if (this.weatherNow.rain > 0.5) {
      this.lightningTimer -= delta;
      if (this.lightningTimer <= 0) {
        this.lightningTimer = 5 + Math.random() * 12;
        if (this.sky) this.sky.triggerLightning();
        this.shake(0.25, 0.3);
        setTimeout(() => this.playSound('thunder'), 300 + Math.random() * 900);
      }
    }

    // Wet surfaces turn glossy in the rain
    const wet = this.weatherNow.rain;
    if (this.groundMat) this.groundMat.roughness = 0.95 - wet * 0.45;
    if (this.mats) {
      this.mats.asphalt.roughness = 0.95 - wet * 0.6;
      this.mats.grassPatch.roughness = 0.95 - wet * 0.4;
      this.mats.soil.roughness = 0.98 - wet * 0.5;
      this.mats.roof.roughness = 0.85 - wet * 0.45;
    }

    // Environment readout
    if (this.instruments && this.sky) {
      const names = { clear: 'Clear', cloudy: 'Cloudy', foggy: 'Fog', rainy: 'Rain' };
      const night = this.sky.state.nightFactor > 0.5;
      const icons = { clear: night ? '🌙' : '☀️', cloudy: night ? '☁️' : '⛅', foggy: '🌫️', rainy: '🌧️' };
      const label = ws.transitioning ? `${names[ws.current]} → ${names[ws.next]}` : names[ws.current];
      this.instruments.setEnv(`${icons[ws.current]} ${this.sky.clockText}`, label, this.wind.speed * 3.6);
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

      // Capture zone drawn at its true radius: a ground ring plus a faint
      // wall, so "fly inside the circle" is something you can actually see
      const R = GAME_CONFIG.CAPTURE_RADIUS;
      const ringGeo = new THREE.RingGeometry(R - 1.6, R, 72);
      const ringMat = new THREE.MeshBasicMaterial({
        color: 0xffffff, transparent: true, opacity: 0.4, side: THREE.DoubleSide, depthWrite: false,
      });
      const ring = new THREE.Mesh(ringGeo, ringMat);
      ring.rotation.x = -Math.PI / 2;
      ring.position.y = 0.6;
      group.add(ring);

      const wallMat = new THREE.MeshBasicMaterial({
        color: 0xffffff, transparent: true, opacity: 0.06, side: THREE.DoubleSide, depthWrite: false,
      });
      const wall = new THREE.Mesh(new THREE.CylinderGeometry(R, R, 58, 56, 1, true), wallMat);
      wall.position.y = 29;
      group.add(wall);

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
        config, group, ring, ringMat, wall, wallMat, beacon, beaconMat,
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

      // Wall follows the ring colour; brightens while you're inside it
      mill.wallMat.color.copy(mill.ringMat.color);
      const inside = ship && Math.hypot(ship.position.x - mill.config.x, ship.position.z - mill.config.z) <= GAME_CONFIG.CAPTURE_RADIUS;
      mill.wallMat.opacity = inside ? 0.14 : 0.06;
      const ringPulse = 1 + Math.sin(this.animationTime * 2) * 0.012;
      mill.ring.scale.setScalar(ringPulse);
    }

    // Update capture progress UI
    const captureUI = document.getElementById('capture-progress');
    const captureLabel = document.getElementById('capture-label');
    const captureFill = document.getElementById('capture-fill');

    if (nearestMill && captureUI) {
      captureUI.style.display = 'block';
      if (captureLabel) {
        const st = this.windmillStates[nearestMill.config.id];
        const mine = st?.team === this.localPlayer?.team;
        captureLabel.textContent = mine
          ? `Holding ${nearestMill.config.name} mill · stay inside to defend`
          : `Capturing ${nearestMill.config.name} mill · stay inside the circle`;
      }
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
      if (state && state.team === 'red') { color = '#ff5555'; symbol = '\u25CF'; }
      else if (state && state.team === 'blue') { color = '#77aaff'; symbol = '\u25CF'; }
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
    runway.position.set(0, 0.4, 0);
    this.scene.add(runway);

    // White center line dashes
    const dashMat = new THREE.MeshStandardMaterial({ color: 0xFFFFFF });
    for (let i = -rl / 2 + 5; i < rl / 2; i += 10) {
      const dashGeo = new THREE.PlaneGeometry(0.6, 5);
      const dash = new THREE.Mesh(dashGeo, dashMat);
      dash.rotation.x = -Math.PI / 2;
      dash.position.set(0, 0.46, i);
      this.scene.add(dash);
    }

    // Runway edge lights
    const lightMat = new THREE.MeshStandardMaterial({
      color: 0xFFFF00, emissive: 0xFFFF00, emissiveIntensity: 1.0,
    });
    for (let i = -rl / 2; i <= rl / 2; i += 15) {
      const lightGeo = new THREE.SphereGeometry(0.3, 6, 6);
      const leftLight = new THREE.Mesh(lightGeo, lightMat);
      leftLight.position.set(-rw / 2 - 0.5, 0.75, i);
      this.scene.add(leftLight);

      const rightLight = new THREE.Mesh(lightGeo, lightMat);
      rightLight.position.set(rw / 2 + 0.5, 0.75, i);
      this.scene.add(rightLight);
    }

    // Green threshold lights at start
    const greenMat = new THREE.MeshStandardMaterial({
      color: 0x00FF00, emissive: 0x00FF00, emissiveIntensity: 1.0,
    });
    for (let x = -rw / 2; x <= rw / 2; x += 3) {
      const gLight = new THREE.Mesh(new THREE.SphereGeometry(0.3, 6, 6), greenMat);
      gLight.position.set(x, 0.75, rl / 2);
      this.scene.add(gLight);
    }

    // Red end lights
    const redMat = new THREE.MeshStandardMaterial({
      color: 0xFF0000, emissive: 0xFF0000, emissiveIntensity: 1.0,
    });
    for (let x = -rw / 2; x <= rw / 2; x += 3) {
      const rLight = new THREE.Mesh(new THREE.SphereGeometry(0.3, 6, 6), redMat);
      rLight.position.set(x, 0.75, -rl / 2);
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
      ship.rotation.x = 0.15; // Nose up

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
      ship.rotation.x = 0.15 * (1 - climbProgress); // Level out

      if (takeoffText) takeoffText.textContent = 'CLIMBING...';

      if (this.takeoffTimer > GAME_CONFIG.TAKEOFF_CLIMB_DURATION) {
        this.takeoffPhase = null;
        this.controlsEnabled = true;
        this.onAirborne();
        ship.rotation.x = 0;
        this.pitchAngle = 0;
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
    this.updateChunks(ship.position.x, ship.position.z);
  }

  /**
   * Space during the takeoff roll jumps straight to cruise
   */
  skipTakeoff() {
    if (!this.takeoffPhase || !this.localPlayer) return;
    const ship = this.players.get(this.localPlayer.id);
    if (!ship) return;

    this.takeoffPhase = null;
    this.controlsEnabled = true;
    this.onAirborne();
    ship.rotation.x = 0;
    this.pitchAngle = 0;
    ship.position.y = GAME_CONFIG.FLIGHT_HEIGHT;

    const overlay = document.getElementById('takeoff-overlay');
    if (overlay) overlay.style.display = 'none';
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
    // Heading first, then pitch about the nose axis, then bank — the default
    // XYZ order pitched about the WORLD x axis, which rolled the plane
    // sideways whenever it wasn't flying due north
    planeGroup.rotation.order = 'YXZ';

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

    planeGroup.traverse(child => {
      if (child.isMesh) child.castShadow = true;
    });

    return planeGroup;
  }

  createProjectile() {
    if (!this.tracerGeo) {
      this.tracerGeo = new THREE.CylinderGeometry(0.16, 0.26, 5.5, 6);
      this.tracerGeo.rotateX(Math.PI / 2); // axis along +Z so lookAt() aims it
      this.tracerMat = new THREE.MeshBasicMaterial({ color: GAME_CONFIG.PROJECTILE_COLOR, toneMapped: false });
      this.tracerMat.userData.shared = true;
      this.tracerGlowMat = new THREE.SpriteMaterial({
        map: this.textures.glow(), color: 0xFFC46B, transparent: true, depthWrite: false,
        blending: THREE.AdditiveBlending, opacity: 0.9,
      });
      this.tracerGlowMat.userData.shared = true;
    }
    const group = new THREE.Group();
    const rod = new THREE.Mesh(this.tracerGeo, this.tracerMat);
    group.add(rod);
    const glow = new THREE.Sprite(this.tracerGlowMat);
    glow.scale.set(2.6, 2.6, 1);
    group.add(glow);
    return group;
  }

  /** Points a tracer along its velocity (call once after velocity is set) */
  orientProjectile(projectile) {
    if (!projectile.velocity) return;
    const target = this._orientVec || (this._orientVec = new THREE.Vector3());
    target.copy(projectile.position).add(projectile.velocity);
    projectile.lookAt(target);
  }

  fireProjectile(ship) {
    // Fire along the nose, including climb/dive pitch
    const cp = Math.cos(this.pitchAngle);
    const sp = Math.sin(this.pitchAngle);
    const dir = {
      x: -Math.sin(this.shipRotation) * cp,
      y: sp,
      z: -Math.cos(this.shipRotation) * cp,
    };
    this.applyAimAssist(ship, dir);

    const projectile = this.createProjectile();
    const spawnDist = 8;
    projectile.position.set(
      ship.position.x + dir.x * spawnDist,
      ship.position.y + dir.y * spawnDist,
      ship.position.z + dir.z * spawnDist
    );
    projectile.velocity = new THREE.Vector3(dir.x, dir.y, dir.z)
      .multiplyScalar(GAME_CONFIG.PROJECTILE_SPEED);
    this.orientProjectile(projectile);
    const projectileId = `${this.localPlayer.id}_${Date.now()}`;
    this.scene.add(projectile);
    this.projectiles.set(projectileId, projectile);
    this.playSound('shot');
    this.shake(0.05, 0.07); // recoil kick

    if (this.socket && this.isConnected) {
      this.socket.emit('fireProjectile', {
        gameId: this.gameState?.id,
        position: projectile.position,
        direction: dir,
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
        // Matches the Socket.IO mount path used by both the local server
        // and the Vercel Function (api/socket-io.js)
        path: '/api/socket-io',
        transports: ['websocket'],
        reconnection: true,
        reconnectionAttempts: GAME_CONFIG.RECONNECT_ATTEMPTS,
        reconnectionDelay: GAME_CONFIG.RECONNECT_DELAY,
      });

      this.socket.on('connect', () => {
        console.log('Connected to server');
        this.isConnected = true;
        this.reconnectAttempts = 0;
        this.socket.emit('joinGame', { username, mode: this.pendingMode });
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
        this.syncTimer(data.gameState.timeRemaining);

        const myColor = this.getPlayerColor(data.player.id);
        const ship = this.createPlayerShip(myColor);
        this.scene.add(ship);
        this.players.set(this.localPlayer.id, ship);
        this.createTrail(data.player.id);
        this.playerHealth = 100;

        if (data.gameState.rules) this.rules = { ...this.rules, ...data.gameState.rules };
        this.mode = data.gameState.mode === 'tdm' ? 'tdm' : 'domination';
        this.applyModeHud();

        // Pre-match countdown: the server's clock is still ahead of "now"
        const total = data.gameState.rules?.matchDuration || 300000;
        if (typeof data.gameState.timeRemaining === 'number' && data.gameState.timeRemaining > total) {
          this.countdownEndsAt = performance.now() + (data.gameState.timeRemaining - total);
        }

        // Late join: say so, and explain how points are scored
        if (typeof data.gameState.timeRemaining === 'number' && data.gameState.timeRemaining < total - 20000) {
          const rem = Math.max(0, data.gameState.timeRemaining);
          const m = Math.floor(rem / 60000), sec = Math.floor((rem % 60000) / 1000);
          this.instruments.toast('⏱️', 'Match in progress', `${m}:${sec.toString().padStart(2, '0')} left — jump in!`);
        }
        setTimeout(() => this.instruments.toast('🏆', 'How to score', this.mode === 'tdm'
          ? `Team Deathmatch · every shoot-down counts · first to ${this.rules.tdmTarget || 30} wins`
          : `Hold windmills: +1 every ${this.rules.millTickSeconds}s each · Shoot down a plane: +${this.rules.killScore}`), 4000);

        // First run: park on the runway and show the tutorial; takeoff
        // starts when it's dismissed. Repeat visits take off immediately.
        if (!localStorage.getItem('tutorialSeen')) {
          localStorage.setItem('tutorialSeen', 'true');
          this.firstFlight = true;
          ship.position.set(0, 1, GAME_CONFIG.RUNWAY_LENGTH / 2 - 10);
          ship.rotation.set(0, 0, 0);
          this.shipRotation = 0;
          this.pendingTakeoffShip = ship;
          this.camera.position.set(ship.position.x, 9, ship.position.z + 14);
          this.camera.lookAt(ship.position);
          const tutorial = document.getElementById('tutorial');
          if (tutorial) tutorial.style.display = 'block';
        } else {
          // Repeat visits skip the runway: straight into the fight
          this.spawnAirborne(ship, data.player.position);
        }

        this.showTeamBanner(this.localPlayer.team);

        if (data.gameState.players) {
          data.gameState.players.forEach(player => {
            if (player.id !== this.localPlayer.id && !this.players.has(player.id)) {
              const otherColor = this.getPlayerColor(player.id);
              const otherShip = this.createPlayerShip(otherColor);
              otherShip.position.copy(player.position);
              if (!player.position.y) otherShip.position.y = GAME_CONFIG.FLIGHT_HEIGHT;
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
        if (player && player.id && !this.players.has(player.id)) {
          const playerColor = this.getPlayerColor(player.id);
          const ship = this.createPlayerShip(playerColor);
          ship.position.copy(player.position);
          if (!player.position.y) ship.position.y = GAME_CONFIG.FLIGHT_HEIGHT;
          this.scene.add(ship);
          this.players.set(player.id, ship);
          this.createTrail(player.id);
          if (this.gameState && this.gameState.players &&
              !this.gameState.players.some(p => p.id === player.id)) {
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
          if (ship && data.position) {
            // Store as a smoothing target; animate() lerps toward it so
            // remote planes glide instead of teleporting between updates.
            // Rotation arrives either as a serialized Euler (_x/_y/_z from
            // human clients) or a plain object (bots).
            const r = data.rotation || {};
            const nowMs = performance.now();
            const prevPos = ship.userData.netPos, prevT = ship.userData.netTime;
            if (prevPos && prevT) {
              const dt = (nowMs - prevT) / 1000;
              if (dt > 0.02 && dt < 1) {
                ship.userData.vel = {
                  x: (data.position.x - prevPos.x) / dt,
                  y: ((data.position.y || 0) - (prevPos.y || 0)) / dt,
                  z: (data.position.z - prevPos.z) / dt,
                };
              }
            }
            ship.userData.netTime = nowMs;
            ship.userData.netPos = data.position;
            ship.userData.netRot = {
              x: r._x !== undefined ? r._x : (r.x || 0),
              y: r._y !== undefined ? r._y : (r.y || 0),
              z: r._z !== undefined ? r._z : (r.z || 0),
            };
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
          this.orientProjectile(projectile);
          this.scene.add(projectile);
          this.projectiles.set(data.projectileId, projectile);
        }
      });

      this.socket.on('playerHit', (data) => {
        // Remove the projectile visual that scored the hit
        if (data.projectileId) {
          const projectile = this.projectiles.get(data.projectileId);
          if (projectile) {
            this.scene.remove(projectile);
            this.projectiles.delete(data.projectileId);
          }
        }

        // Kill: explosion at the victim, ship hidden until respawn
        const victimShip = this.players.get(data.targetId);
        if (data.airstrike && victimShip) this.spawnExplosion(victimShip.position);
        if (data.killed && victimShip) {
          this.spawnExplosion(victimShip.position);
          victimShip.visible = false;
        }

        // Shooter feedback: hitmarker + confirm sound, banner on kill
        if (data.attackerId === this.localPlayer?.id) {
          this.showHitmarker(data.killed);
          this.playSound(data.killed ? 'kill' : 'hitconfirm');
          if (data.killed) {
            this.showKillBanner(this.nameOf(data.targetId));
            this.onMyKill(data);
          }
        }
        if (data.killed) this.matchKills++;
        if (data.killed && data.targetId === this.localPlayer?.id) {
          this.lastKilledBy = data.attackerId;
          this.deathsSinceKill++;
          this.streak = 0;
        }

        if (data.killed) {
          this.addKillFeed(this.nameOf(data.attackerId), this.nameOf(data.targetId));
        }

        if (data.targetId === this.localPlayer?.id) {
          const attackerShip = this.players.get(data.attackerId);
          const me = this.players.get(this.localPlayer.id);
          if (attackerShip && me) {
            const dx = attackerShip.position.x - me.position.x;
            const dz = attackerShip.position.z - me.position.z;
            const bearing = Math.atan2(dx, -dz) * 180 / Math.PI;
            const heading = -this.shipRotation * 180 / Math.PI;
            this.instruments.showDamageDirection(bearing - heading);
          }
          this.playerHealth = typeof data.targetHealth === 'number'
            ? data.targetHealth
            : Math.max(0, this.playerHealth - data.damage);
          this.setHealthBar(this.playerHealth);
          this.playSound(data.killed ? 'explosion' : 'hit');
          this.shake(data.killed ? 1.2 : 0.35, data.killed ? 0.8 : 0.3);
          if (data.killed) this.handleLocalDeath(this.nameOf(data.attackerId));
        }

        if (typeof data.targetHealth === 'number') this.knownHealth[data.targetId] = data.targetHealth;

        // Keep scoreboard stats in sync
        if (this.gameState?.players) {
          for (const p of this.gameState.players) {
            if (p.id === data.attackerId && typeof data.attackerKills === 'number') p.kills = data.attackerKills;
            if (p.id === data.targetId && typeof data.targetDeaths === 'number') p.deaths = data.targetDeaths;
          }
        }
        if (this.localPlayer) {
          if (data.attackerId === this.localPlayer.id && typeof data.attackerKills === 'number') {
            this.localPlayer.kills = data.attackerKills;
          }
          if (data.targetId === this.localPlayer.id && typeof data.targetDeaths === 'number') {
            this.localPlayer.deaths = data.targetDeaths;
          }
        }

        // Merge (don't replace) game state — the payload only carries scores/time
        if (data.gameState && this.gameState) {
          this.gameState.scores = data.gameState.scores;
          this.gameState.timeRemaining = data.gameState.timeRemaining;
          this.syncTimer(data.gameState.timeRemaining);
        }
        this.updateHUD();
      });

      this.socket.on('playerRespawn', (data) => {
        this.knownHealth[data.playerId] = typeof data.health === 'number' ? data.health : 100;
        const ship = this.players.get(data.playerId);
        if (ship) {
          ship.position.set(data.position.x, GAME_CONFIG.FLIGHT_HEIGHT, data.position.z);
          ship.visible = true;
          delete ship.userData.netPos;
          delete ship.userData.netRot;
        }
        if (data.playerId === this.localPlayer?.id) {
          this.dead = false;
          this.streak = 0;
          if (ship) this.faceNearestEnemy(ship);
          clearInterval(this.respawnTicker);
          const sub = document.getElementById('crash-sub');
          if (sub) sub.textContent = '';
          this.playerHealth = data.health;
          this.setHealthBar(data.health);
          this.updateEnergyBar(data.energy);
          if (this.localPlayer) this.localPlayer.energy = data.energy;
          const overlay = document.getElementById('crash-overlay');
          if (overlay) {
            overlay.style.display = 'none';
            const text = overlay.querySelector('.crash-text');
            if (text) text.textContent = 'CRASHED!';
          }
        }
      });

      this.socket.on('chatMessage', (data) => this.displayChatMessage(data.username, data.message));
      this.socket.on('gameStart', (gameState) => { this.gameState = gameState; this.updateHUD(); });
      this.socket.on('gameEnd', (gameState) => { this.gameState = gameState; this.showGameEnd(); });
      this.socket.on('error', (error) => console.error('Socket error:', error));

      // Authoritative health after crashes (server applies the damage)
      this.socket.on('healthUpdate', (data) => {
        if (typeof data?.health !== 'number') return;
        this.playerHealth = data.health;
        this.setHealthBar(data.health);
        if (data.died) {
          this.dead = true;
          const overlay = document.getElementById('crash-overlay');
          if (overlay) {
            const text = overlay.querySelector('.crash-text');
            if (text) text.textContent = 'DESTROYED!';
            overlay.style.display = 'flex';
          }
        }
      });

      // Windmill capture updates from server
      this.socket.on('windmillUpdate', (data) => {
        if (data && data.windmills) {
          for (const mill of data.windmills) {
            const prev = this.windmillStates[mill.id];
            const myTeam = this.localPlayer?.team;
            if (prev && prev.team !== mill.team && mill.team === myTeam) {
              const ship = this.players.get(this.localPlayer.id);
              const inside = ship && Math.hypot(ship.position.x - mill.x, ship.position.z - mill.z) <= GAME_CONFIG.CAPTURE_RADIUS;
              if (inside) this.addPopup(150, 'CAPTURE');
              else this.addPopup(50, 'TEAM CAPTURE');
            }
            this.windmillStates[mill.id] = mill;
          }
        }
      });

      // Killstreak rewards
      this.socket.on('streak', (d) => {
        if (!d) return;
        const mine = d.playerId === this.localPlayer?.id;
        if (mine) {
          this.streak = d.streak;
          if (d.reward === 'radar') {
            this.radarSweepUntil = this.animationTime + 20;
            this.awardMedal('📡', 'RADAR SWEEP', 'Every enemy revealed for 20s', 0);
          } else if (d.reward === 'wingman') {
            this.awardMedal('🛩️', 'WINGMAN INBOUND', 'An escort guards you for 45s', 0);
          } else if (d.reward === 'airstrike') {
            this.awardMedal('💥', 'AIRSTRIKE', 'Every enemy nearby takes heavy damage', 0);
            const ship = this.players.get(this.localPlayer.id);
            if (ship) this.shake(1.0, 0.6);
          } else {
            this.awardMedal('🔥', `${d.streak} KILL STREAK`, 'Keep it going', 0);
          }
          this.playSound('streak');
        } else if (d.reward) {
          this.instruments.toast('🔥', `${d.username} is on a ${d.streak} kill streak`,
            d.reward === 'radar' ? 'Radar sweep' : d.reward === 'wingman' ? 'Wingman called in' : 'Airstrike!');
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
  // SOUND (synthesized with Web Audio — no audio files)
  // =========================================================================

  initAudio() {
    if (this.audio) return;
    try {
      const ctx = new (window.AudioContext || window.webkitAudioContext)();
      const master = ctx.createGain();
      master.gain.value = 0.5;
      master.connect(ctx.destination);

      // Continuous engine hum: sawtooth through a lowpass, pitch follows speed
      const engineOsc = ctx.createOscillator();
      engineOsc.type = 'sawtooth';
      engineOsc.frequency.value = 70;
      const engineFilter = ctx.createBiquadFilter();
      engineFilter.type = 'lowpass';
      engineFilter.frequency.value = 220;
      const engineGain = ctx.createGain();
      engineGain.gain.value = 0.05;
      engineOsc.connect(engineFilter).connect(engineGain).connect(master);
      engineOsc.start();

      this.audio = { ctx, master, engineOsc, engineGain, muted: false };
    } catch (e) {
      console.error('Audio init failed:', e);
    }
  }

  toggleMute() {
    if (!this.audio) return;
    this.audio.muted = !this.audio.muted;
    this.audio.master.gain.value = this.audio.muted ? 0 : 0.5;
    this.displayChatMessage('🔊', this.audio.muted ? 'Sound muted (M to unmute)' : 'Sound on');
  }

  playSound(name) {
    if (!this.audio || this.audio.muted) return;
    const { ctx, master } = this.audio;
    const t = ctx.currentTime;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.connect(gain).connect(master);

    switch (name) {
      case 'shot':
        osc.type = 'square';
        osc.frequency.setValueAtTime(700, t);
        osc.frequency.exponentialRampToValueAtTime(180, t + 0.09);
        gain.gain.setValueAtTime(0.12, t);
        gain.gain.exponentialRampToValueAtTime(0.001, t + 0.1);
        osc.start(t); osc.stop(t + 0.1);
        break;
      case 'hit':
        osc.type = 'sawtooth';
        osc.frequency.setValueAtTime(140, t);
        osc.frequency.exponentialRampToValueAtTime(50, t + 0.2);
        gain.gain.setValueAtTime(0.25, t);
        gain.gain.exponentialRampToValueAtTime(0.001, t + 0.22);
        osc.start(t); osc.stop(t + 0.22);
        break;
      case 'explosion':
        osc.type = 'sawtooth';
        osc.frequency.setValueAtTime(90, t);
        osc.frequency.exponentialRampToValueAtTime(30, t + 0.6);
        gain.gain.setValueAtTime(0.35, t);
        gain.gain.exponentialRampToValueAtTime(0.001, t + 0.65);
        osc.start(t); osc.stop(t + 0.65);
        break;
      case 'pickup':
        osc.type = 'sine';
        osc.frequency.setValueAtTime(660, t);
        osc.frequency.setValueAtTime(990, t + 0.09);
        gain.gain.setValueAtTime(0.2, t);
        gain.gain.exponentialRampToValueAtTime(0.001, t + 0.25);
        osc.start(t); osc.stop(t + 0.25);
        break;
      case 'roll':
        osc.type = 'triangle';
        osc.frequency.setValueAtTime(220, t);
        osc.frequency.exponentialRampToValueAtTime(880, t + 0.3);
        osc.frequency.exponentialRampToValueAtTime(220, t + 0.6);
        gain.gain.setValueAtTime(0.1, t);
        gain.gain.exponentialRampToValueAtTime(0.001, t + 0.65);
        osc.start(t); osc.stop(t + 0.65);
        break;
      case 'hitconfirm': {
        // Crisp tick plus a low thud — "your shot landed"
        osc.type = 'sine';
        osc.frequency.setValueAtTime(1300, t);
        osc.frequency.exponentialRampToValueAtTime(1800, t + 0.05);
        gain.gain.setValueAtTime(0.16, t);
        gain.gain.exponentialRampToValueAtTime(0.001, t + 0.07);
        osc.start(t); osc.stop(t + 0.07);
        const thud = ctx.createOscillator();
        const thudGain = ctx.createGain();
        thud.type = 'triangle';
        thud.frequency.setValueAtTime(160, t);
        thud.frequency.exponentialRampToValueAtTime(55, t + 0.14);
        thudGain.gain.setValueAtTime(0.28, t);
        thudGain.gain.exponentialRampToValueAtTime(0.001, t + 0.16);
        thud.connect(thudGain).connect(master);
        thud.start(t); thud.stop(t + 0.16);
        break;
      }
      case 'medal':
        // Quick bright arpeggio
        osc.type = 'triangle';
        osc.frequency.setValueAtTime(659, t);
        osc.frequency.setValueAtTime(880, t + 0.07);
        osc.frequency.setValueAtTime(1319, t + 0.14);
        gain.gain.setValueAtTime(0.14, t);
        gain.gain.exponentialRampToValueAtTime(0.001, t + 0.4);
        osc.start(t); osc.stop(t + 0.4);
        break;
      case 'streak':
        // Rising power chord
        osc.type = 'sawtooth';
        osc.frequency.setValueAtTime(220, t);
        osc.frequency.exponentialRampToValueAtTime(660, t + 0.35);
        gain.gain.setValueAtTime(0.12, t);
        gain.gain.exponentialRampToValueAtTime(0.001, t + 0.6);
        osc.start(t); osc.stop(t + 0.6);
        break;
      case 'tick':
        osc.type = 'square';
        osc.frequency.setValueAtTime(1000, t);
        gain.gain.setValueAtTime(0.08, t);
        gain.gain.exponentialRampToValueAtTime(0.001, t + 0.08);
        osc.start(t); osc.stop(t + 0.08);
        break;
      case 'go':
        osc.type = 'square';
        osc.frequency.setValueAtTime(1500, t);
        gain.gain.setValueAtTime(0.14, t);
        gain.gain.exponentialRampToValueAtTime(0.001, t + 0.4);
        osc.start(t); osc.stop(t + 0.4);
        break;
      case 'lock':
        // Short two-note chirp when the bracket turns red
        osc.type = 'sine';
        osc.frequency.setValueAtTime(880, t);
        osc.frequency.setValueAtTime(1320, t + 0.06);
        gain.gain.setValueAtTime(0.1, t);
        gain.gain.exponentialRampToValueAtTime(0.001, t + 0.14);
        osc.start(t); osc.stop(t + 0.14);
        break;
      case 'warning':
        // Two-tone terrain alert
        osc.type = 'square';
        osc.frequency.setValueAtTime(880, t);
        osc.frequency.setValueAtTime(660, t + 0.12);
        gain.gain.setValueAtTime(0.08, t);
        gain.gain.exponentialRampToValueAtTime(0.001, t + 0.24);
        osc.start(t); osc.stop(t + 0.24);
        break;
      case 'thunder': {
        // Filtered noise burst with a long rumbling tail
        const len = Math.floor(ctx.sampleRate * 2.2);
        const buffer = ctx.createBuffer(1, len, ctx.sampleRate);
        const data = buffer.getChannelData(0);
        for (let i = 0; i < len; i++) data[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 2.2);
        const src = ctx.createBufferSource();
        src.buffer = buffer;
        const filter = ctx.createBiquadFilter();
        filter.type = 'lowpass';
        filter.frequency.setValueAtTime(420, t);
        filter.frequency.exponentialRampToValueAtTime(90, t + 2.0);
        const rumble = ctx.createGain();
        rumble.gain.setValueAtTime(0.55, t);
        rumble.gain.exponentialRampToValueAtTime(0.001, t + 2.2);
        src.connect(filter).connect(rumble).connect(master);
        src.start(t);
        break;
      }
      case 'kill':
        // Rising three-note fanfare
        osc.type = 'square';
        osc.frequency.setValueAtTime(523, t);
        osc.frequency.setValueAtTime(659, t + 0.08);
        osc.frequency.setValueAtTime(1047, t + 0.16);
        gain.gain.setValueAtTime(0.15, t);
        gain.gain.exponentialRampToValueAtTime(0.001, t + 0.35);
        osc.start(t); osc.stop(t + 0.35);
        break;
    }
  }

  updateEngineSound(speed) {
    if (!this.audio || this.audio.muted) return;
    // Pitch scales with airspeed
    this.audio.engineOsc.frequency.value = 40 + speed * 0.7;
  }

  // =========================================================================
  // BARREL ROLL
  // =========================================================================

  startBarrelRoll() {
    if (this.rollTimer > 0 || this.rollCooldown > 0) return;
    if (this.crashed || this.dead || !this.controlsEnabled) return;
    this.rollTimer = GAME_CONFIG.ROLL_DURATION;
    this.rollCooldown = GAME_CONFIG.ROLL_COOLDOWN;
    // Roll toward held direction; default left
    this.rollDir = this.controls.right ? -1 : 1;
    this.playSound('roll');
  }

  // =========================================================================
  // RADAR
  // =========================================================================

  updateRadar(ship) {
    const canvas = document.getElementById('radar');
    if (!canvas || !ship) return;
    const ctx = canvas.getContext('2d');
    const size = canvas.width;
    const half = size / 2;
    const scale = half / GAME_CONFIG.RADAR_RANGE;

    ctx.clearRect(0, 0, size, size);

    // Background + range rings
    ctx.fillStyle = 'rgba(0, 20, 0, 0.65)';
    ctx.beginPath();
    ctx.arc(half, half, half - 1, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = 'rgba(0, 255, 100, 0.25)';
    ctx.lineWidth = 1;
    for (const r of [0.5, 1]) {
      ctx.beginPath();
      ctx.arc(half, half, (half - 2) * r, 0, Math.PI * 2);
      ctx.stroke();
    }

    // Heading-up radar: rotate world points by ship heading
    const cos = Math.cos(this.shipRotation);
    const sin = Math.sin(this.shipRotation);
    const project = (wx, wz) => {
      const dx = wx - ship.position.x;
      const dz = wz - ship.position.z;
      // world -> ship-relative (facing -Z at rotation 0)
      const rx = dx * cos - dz * sin;
      const rz = dx * sin + dz * cos;
      return { x: half + rx * scale, y: half + rz * scale, inRange: dx * dx + dz * dz < GAME_CONFIG.RADAR_RANGE ** 2 };
    };

    // Capture windmills (color = owning team)
    for (const mill of CAPTURE_WINDMILLS) {
      const state = this.windmillStates[mill.id];
      const p = project(mill.x, mill.z);
      if (!p.inRange) continue;
      ctx.fillStyle = state?.team === 'red' ? '#ff5555'
        : state?.team === 'blue' ? '#5599ff' : '#cccccc';
      ctx.fillRect(p.x - 4, p.y - 4, 8, 8);
      ctx.fillStyle = '#000';
      ctx.font = 'bold 8px "Rajdhani", "Segoe UI", sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(mill.name[0], p.x, p.y + 0.5);
    }

    // Other players (enemy red, teammate green)
    const myTeam = this.localPlayer?.team;
    const teamOf = {};
    if (this.gameState?.players) {
      for (const pl of this.gameState.players) teamOf[pl.id] = pl.team;
    }
    const sweep = this.radarSweepActive();
    if (sweep) {
      ctx.strokeStyle = 'rgba(80, 255, 140, 0.9)';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(half, half, half - 2, 0, Math.PI * 2);
      ctx.stroke();
    }
    for (const [id, otherShip] of this.players) {
      if (id === this.localPlayer?.id) continue;
      const p = project(otherShip.position.x, otherShip.position.z);
      if (!p.inRange) {
        if (!sweep || teamOf[id] === myTeam) continue;
        // Sweep: pin out-of-range enemies to the radar's edge
        const ang = Math.atan2(p.y - half, p.x - half);
        p.x = half + Math.cos(ang) * (half - 6);
        p.y = half + Math.sin(ang) * (half - 6);
      }
      ctx.fillStyle = teamOf[id] === myTeam ? '#44ff88' : '#ff4444';
      ctx.beginPath();
      ctx.arc(p.x, p.y, 3.5, 0, Math.PI * 2);
      ctx.fill();
    }

    // Own ship: triangle pointing up (heading-up display)
    ctx.fillStyle = '#ffffff';
    ctx.beginPath();
    ctx.moveTo(half, half - 6);
    ctx.lineTo(half - 4, half + 5);
    ctx.lineTo(half + 4, half + 5);
    ctx.closePath();
    ctx.fill();
  }

  // =========================================================================
  // HUD & UI
  // =========================================================================

  /**
   * Looks up a display name from the current roster
   */
  nameOf(playerId) {
    const p = this.gameState?.players?.find(pl => pl.id === playerId);
    return p ? p.username : 'Pilot';
  }

  /**
   * Records when the server last told us the remaining time so the HUD
   * can count down smoothly between updates
   */
  syncTimer(remainingMs) {
    if (typeof remainingMs !== 'number') return;
    this.timerSync = { remaining: remainingMs, at: performance.now() };
  }

  /**
   * Counts the match clock down every frame (called from animate)
   */
  updateTimer() {
    if (!this.timerSync) return;
    const el = document.getElementById('time-remaining');
    if (!el) return;
    const remaining = Math.max(0, this.timerSync.remaining - (performance.now() - this.timerSync.at));
    const minutes = Math.floor(remaining / 60000);
    const seconds = Math.floor((remaining % 60000) / 1000);
    const text = `${minutes}:${seconds.toString().padStart(2, '0')}`;
    if (text !== this.lastTimerText) {
      this.lastTimerText = text;
      el.textContent = text;
      el.classList.toggle('low', remaining < 31000);
    }

    // Match callouts
    if (this.gameState && this.localPlayer) {
      const s = this.gameState.scores || { red: 0, blue: 0 };
      const my = s[this.localPlayer.team] || 0, their = s[this.localPlayer.team === 'red' ? 'blue' : 'red'] || 0;
      const standing = my > their ? `You lead ${my}–${their}` : my < their ? `You trail ${my}–${their}` : `Tied ${my}–${their}`;
      if (remaining < 150000 && remaining > 140000 && !this.calloutsDone.has('half')) {
        this.calloutsDone.add('half');
        this.instruments.toast('⏱️', 'Halfway', standing);
      }
      if (remaining < 30000 && remaining > 20000 && !this.calloutsDone.has('final')) {
        this.calloutsDone.add('final');
        this.instruments.toast('⏱️', 'Final 30 seconds!', standing);
        this.playSound('warning');
      }
    }
  }

  /** Pre-match countdown overlay, driven from the server's start time */
  updateCountdown() {
    if (!this.countdownEndsAt) return;
    const left = this.countdownEndsAt - performance.now();
    if (left <= -1200) {
      this.countdownEndsAt = 0;
      this.countdownLast = null;
      this.instruments.setCountdown(null);
      return;
    }
    const n = left > 0 ? Math.ceil(left / 1000) : 'GO!';
    if (n !== this.countdownLast) {
      this.countdownLast = n;
      this.instruments.setCountdown(n === 'GO!' ? 'FIGHT' : 'MATCH STARTS IN', n);
      this.playSound(n === 'GO!' ? 'go' : 'tick');
    }
  }

  showHitmarker(killed) {
    const el = document.getElementById('hitmarker');
    if (!el) return;
    el.classList.remove('show', 'kill');
    void el.offsetWidth; // restart the CSS animation
    el.classList.add('show');
    if (killed) el.classList.add('kill');
  }

  addKillFeed(attackerName, victimName) {
    const feed = document.getElementById('kill-feed');
    if (!feed) return;
    const entry = document.createElement('div');
    entry.className = 'kill-entry';
    entry.innerHTML = `<span>${this.sanitizeInput(attackerName)}</span> &#9992; <span>${this.sanitizeInput(victimName)}</span>`;
    feed.prepend(entry);
    while (feed.children.length > 4) feed.removeChild(feed.lastChild);
    setTimeout(() => { if (entry.parentNode) entry.parentNode.removeChild(entry); }, 4500);
  }

  showKillBanner(victimName) {
    const el = document.getElementById('kill-banner');
    if (!el) return;
    el.textContent = `SPLASH! You shot down ${victimName}`;
    el.classList.remove('show');
    void el.offsetWidth;
    el.classList.add('show');
  }

  showTeamBanner(team) {
    const el = document.getElementById('team-banner');
    if (!el || !team) return;
    const enemy = team === 'red' ? 'blue' : 'red';
    el.textContent = '';
    el.appendChild(document.createTextNode(`YOU'RE ON THE ${team.toUpperCase()} TEAM`));
    const sub = document.createElement('small');
    sub.textContent = this.mode === 'tdm'
      ? `Shoot down ${enemy} planes · first to ${this.rules.tdmTarget || 30} wins`
      : `Capture windmills · Shoot down ${enemy} planes`;
    el.appendChild(sub);
    el.className = `show ${team}`;
    setTimeout(() => { el.className = ''; }, 4500);
  }

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

  setHealthBar(health) {
    const healthFill = document.querySelector('.health-fill');
    if (!healthFill) return;
    healthFill.style.width = `${Math.max(0, Math.min(100, health))}%`;
  }

  handleLocalDeath(attackerName) {
    this.dead = true;
    const overlay = document.getElementById('crash-overlay');
    const sub = document.getElementById('crash-sub');
    if (overlay) {
      const text = overlay.querySelector('.crash-text');
      if (text) text.textContent = attackerName ? `SHOT DOWN BY ${attackerName.toUpperCase()}` : 'SHOT DOWN!';
      overlay.style.display = 'flex';
    }
    // Respawn countdown (server respawns after RESPAWN_DELAY = 3s)
    clearInterval(this.respawnTicker);
    let left = 3;
    const tick = () => { if (sub) sub.textContent = `Respawning in ${left}…`; };
    tick();
    this.respawnTicker = setInterval(() => { left = Math.max(1, left - 1); tick(); }, 1000);
  }

  updateSpeedBar(speed) {
    const speedFill = document.querySelector('.speed-fill');
    const speedValue = document.getElementById('speed-value');
    if (!speedFill) return;
    const pct = Math.max(0, Math.min(100, (speed / GAME_CONFIG.BOOST_SPEED) * 100));
    speedFill.style.width = `${pct}%`;
    speedFill.style.backgroundColor = speed > GAME_CONFIG.MOVEMENT_SPEED ? '#ffaa00' : '#2ecc71';
    if (speedValue) speedValue.textContent = `${Math.round(speed * 4)} km/h`;
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
    if (killsEl) killsEl.textContent = this.localPlayer.kills || 0;
    if (deathsEl) deathsEl.textContent = this.localPlayer.deaths || 0;

    // Team score bar
    const scores = this.gameState.scores || { red: 0, blue: 0 };
    const redEl = document.getElementById('score-red');
    const blueEl = document.getElementById('score-blue');
    if (redEl) {
      redEl.textContent = `RED ${scores.red}`;
      redEl.classList.toggle('mine', this.localPlayer.team === 'red');
    }
    if (blueEl) {
      blueEl.textContent = `${scores.blue} BLUE`;
      blueEl.classList.toggle('mine', this.localPlayer.team === 'blue');
    }
    const myTeamEl = document.getElementById('my-team');
    if (myTeamEl) myTeamEl.textContent = (this.localPlayer.team || '').toUpperCase();

    if (this.scoreboardOpen) this.renderScoreboard();
  }

  renderScoreboard() {
    if (!this.instruments || !this.gameState?.players) return;
    const rows = this.gameState.players.map(p => ({
      name: p.username || 'Pilot',
      team: p.team || 'red',
      kills: p.kills || 0,
      deaths: p.deaths || 0,
      isBot: !!p.isBot,
      me: p.id === this.localPlayer?.id,
    }));
    this.instruments.setScoreboard(true, rows);
  }

  setScoreboardOpen(open) {
    if (this.scoreboardOpen === open) return;
    this.scoreboardOpen = open;
    if (open) this.renderScoreboard();
    else this.instruments?.setScoreboard(false);
  }

  showGameEnd() {
    const overlay = document.getElementById('end-screen');
    if (!overlay || !this.gameState) return;

    const scores = this.gameState.scores || { red: 0, blue: 0 };
    const winner = scores.red > scores.blue ? 'red' : scores.blue > scores.red ? 'blue' : null;
    const myTeam = this.localPlayer?.team;

    const title = document.getElementById('end-title');
    if (title) {
      if (!winner) {
        title.textContent = "IT'S A DRAW!";
        title.className = '';
      } else {
        title.textContent = winner === myTeam ? 'VICTORY!' : 'DEFEAT';
        title.className = winner;
      }
    }

    const scoreEl = document.getElementById('end-score');
    if (scoreEl) scoreEl.innerHTML =
      `<span class="red">RED ${scores.red}</span> &mdash; <span class="blue">${scores.blue} BLUE</span>`;

    const statsEl = document.getElementById('end-stats');
    if (statsEl && this.localPlayer) {
      statsEl.textContent =
        `You: ${this.localPlayer.kills || 0} kills / ${this.localPlayer.deaths || 0} deaths`;
    }

    const reasonEl = document.getElementById('end-reason');
    if (reasonEl) {
      const target = this.rules.tdmTarget || 30;
      const winName = winner ? winner.toUpperCase() : '';
      reasonEl.textContent = this.gameState.endReason === 'target'
        ? `${winName} reached ${target} kills`
        : this.mode === 'tdm' ? `Time's up · ${winner ? winName + ' had more kills' : 'kills level'}`
        : `Time's up · ${winner ? winName + ' held the windmills longer' : 'nobody pulled ahead'}`;
    }
    const mvpEl = document.getElementById('end-mvp');
    const mvp = this.gameState.mvp;
    if (mvpEl) mvpEl.textContent = mvp
      ? `Top pilot: ${mvp.username}${mvp.isBot ? ' (BOT)' : ''} · ${mvp.kills} kills / ${mvp.deaths} deaths` : '';

    // XP and rank progress
    const winBonus = winner === myTeam ? 200 : 50;
    this.addPopup(winBonus, winner === myTeam ? 'VICTORY' : 'MATCH COMPLETE');
    const before = this.totalXp();
    this.bankXp();
    const after = before + this.sessionXp;
    const xpEl = document.getElementById('end-xp');
    if (xpEl) {
      const lvBefore = this.levelFor(before), lvAfter = this.levelFor(after);
      xpEl.textContent = `+${this.sessionXp.toLocaleString()} XP · Lv ${lvAfter} ${this.rankFor(after)} (${after.toLocaleString()} XP)` +
        (lvAfter > lvBefore ? ' · LEVEL UP!' : '');
    }
    const medalsEl = document.getElementById('end-medals');
    if (medalsEl) {
      const counts = {};
      for (const m of this.medalsEarned) counts[m] = (counts[m] || 0) + 1;
      const list = Object.entries(counts).map(([m, n]) => n > 1 ? `${m} ×${n}` : m);
      medalsEl.textContent = list.length ? `Medals: ${list.join(' · ')}` : 'No medals this time — go get a Double Kill';
    }

    this.controlsEnabled = false;
    overlay.style.display = 'flex';
  }

  // =========================================================================
  // INPUT
  // =========================================================================

  onWindowResize() {
    this.camera.aspect = window.innerWidth / window.innerHeight;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    if (this.postfx) this.postfx.resize(window.innerWidth, window.innerHeight, this.renderer.getPixelRatio());
  }

  /** True while a text field (name box, chat, settings) has focus */
  isTyping() {
    const el = document.activeElement;
    if (!el) return false;
    const tag = el.tagName;
    return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || el.isContentEditable;
  }

  onKeyDown(event) {
    const chatInput = document.getElementById('chat-input');
    if (this.audio && this.audio.ctx.state === 'suspended') this.audio.ctx.resume();

    // Typing somewhere other than chat (e.g. the pilot name box): let every
    // key through untouched — flight keys must never eat letters
    if (this.isTyping() && document.activeElement !== chatInput) return;

    // If chat input is focused, only handle Escape to blur
    if (document.activeElement === chatInput) {
      if (event.key === 'Escape') {
        chatInput.blur();
      }
      return;
    }

    // Settings panel open: Escape closes it, everything else goes to the form
    if (this.instruments?.settingsOpen) {
      if (event.key === 'Escape') {
        this.instruments.toggleSettings(false);
        event.preventDefault();
      }
      return;
    }

    // Tutorial open: Enter/Escape/Space dismisses it (and starts takeoff)
    const tutorial = document.getElementById('tutorial');
    if (tutorial && tutorial.style.display === 'block') {
      if (event.key === 'Escape' || event.key === 'Enter' || event.key === ' ') {
        this.closeTutorial();
        event.preventDefault();
      }
      return;
    }

    // Space skips the takeoff cinematic
    if (this.takeoffPhase && event.key === ' ') {
      this.skipTakeoff();
      event.preventDefault();
      return;
    }

    // Focus chat input on Enter (expand it first — a collapsed input can't take focus)
    if (event.key === 'Enter' && chatInput) {
      this.instruments?.setChatCollapsed(false);
      chatInput.focus();
      event.preventDefault();
      return;
    }

    switch (event.key.toLowerCase()) {
      case 'w': this.controls.throttleUp = true; break;
      case 's': this.controls.throttleDown = true; break;
      case 'a': case 'q': case 'arrowleft': this.controls.left = true; event.preventDefault(); break;
      case 'd': case 'e': case 'arrowright': this.controls.right = true; event.preventDefault(); break;
      case 'arrowup': this.controls.pitchUp = true; event.preventDefault(); break;
      case 'arrowdown': this.controls.pitchDown = true; event.preventDefault(); break;
      case 'shift': this.controls.boost = true; break;
      case ' ': this.controls.shooting = true; event.preventDefault(); break;
      case 'r': this.startBarrelRoll(); break;
      case 'm': this.toggleMute(); break;
      case 'p': if (this.localPlayer) this.togglePhotoMode(); break;
      case 'c': this.captureRequested = true; break;
      case 'h': this.toggleControlsPanel(); break;
      case 'x': this.skipOnboarding(); break;
      case 'tab': this.setScoreboardOpen(true); event.preventDefault(); break;
      case 'escape': this.instruments.toggleSettings(true); event.preventDefault(); break;
    }
  }

  onKeyUp(event) {
    // Ignore key ups while typing anywhere
    if (this.isTyping()) return;

    switch (event.key.toLowerCase()) {
      case 'w': this.controls.throttleUp = false; break;
      case 's': this.controls.throttleDown = false; break;
      case 'a': case 'q': case 'arrowleft': this.controls.left = false; event.preventDefault(); break;
      case 'd': case 'e': case 'arrowright': this.controls.right = false; event.preventDefault(); break;
      case 'arrowup': this.controls.pitchUp = false; event.preventDefault(); break;
      case 'arrowdown': this.controls.pitchDown = false; event.preventDefault(); break;
      case 'shift': this.controls.boost = false; break;
      case ' ': this.controls.shooting = false; event.preventDefault(); break;
      case 'tab': this.setScoreboardOpen(false); event.preventDefault(); break;
    }
  }

  // =========================================================================
  // GAME LOOP
  // =========================================================================

  updatePlayer(delta) {
    if (!this.localPlayer || !this.players.has(this.localPlayer.id)) return;
    if (this.crashed && !this.dead) {
      this.updateCrashRecovery(delta);
      return;
    }
    if (this.crashed || this.dead || !this.controlsEnabled) return;

    const ship = this.players.get(this.localPlayer.id);

    // Virtual mouse stick re-centres on its own
    const decay = Math.exp(-GAME_CONFIG.MOUSE_STICK_DECAY * delta);
    this.mouseStick.turn *= decay;
    this.mouseStick.pitch *= decay;
    let mouseTurn = this.pointerLocked ? this.mouseStick.turn : 0;
    let mousePitch = this.pointerLocked ? this.mouseStick.pitch : 0;
    if (this.touch && this.touch.active) {
      mouseTurn -= this.touch.stick.x;   // push left = turn left
      mousePitch -= this.touch.stick.y;  // push up = climb
    }

    if (typeof this.localPlayer.energy !== 'number') this.localPlayer.energy = 100;

    // Throttle (↑/↓ keys)
    if (this.controls.throttleUp) {
      this.throttle = Math.min(GAME_CONFIG.THROTTLE_MAX, this.throttle + GAME_CONFIG.THROTTLE_RATE * delta);
    }
    if (this.controls.throttleDown) {
      this.throttle = Math.max(GAME_CONFIG.THROTTLE_MIN, this.throttle - GAME_CONFIG.THROTTLE_RATE * delta);
    }

    let speed = GAME_CONFIG.MOVEMENT_SPEED * this.throttle;
    if (this.controls.boost && this.localPlayer.energy > 0) {
      speed = GAME_CONFIG.BOOST_SPEED;
      this.localPlayer.energy = Math.max(0, this.localPlayer.energy - (GAME_CONFIG.ENERGY_DRAIN_RATE * delta));
    } else {
      this.localPlayer.energy = Math.min(100, this.localPlayer.energy + (GAME_CONFIG.ENERGY_REGEN_RATE * delta));
    }

    // Golden tulip speed surge
    if (this.speedSurge > 0) {
      this.speedSurge -= delta;
      speed *= GAME_CONFIG.SPEED_SURGE_MULTIPLIER;
    }

    this.updateEnergyBar(this.localPlayer.energy);
    this.updateSpeedBar(speed);
    this.updateEngineSound(speed);
    const altEl = document.getElementById('alt-value');
    if (altEl) altEl.textContent = `${Math.round(ship.position.y * 3)}m`;

    // Banked turning (A/D): turn rate eases toward the input
    const turnInput = Math.max(-1, Math.min(1, (this.controls.left ? 1 : 0) - (this.controls.right ? 1 : 0) + mouseTurn));
    const targetTurnRate = turnInput * GAME_CONFIG.TURN_RATE;
    const turnSmooth = Math.min(1, GAME_CONFIG.TURN_SMOOTHING * delta);
    this.rotationVelocity += (targetTurnRate - this.rotationVelocity) * turnSmooth;
    this.shipRotation += this.rotationVelocity * delta;
    ship.rotation.y = this.shipRotation;

    // Climb & dive (↑/↓): pitch eases toward input; vertical speed scales
    // with airspeed so boosting dives feel fast
    let pitchInput = Math.max(-1, Math.min(1, (this.controls.pitchUp ? 1 : 0) - (this.controls.pitchDown ? 1 : 0) + mousePitch));
    if (this.terrainWarn && this.instruments?.settings.assist !== false) pitchInput = 1; // auto pull-up
    let targetPitch = pitchInput * GAME_CONFIG.MAX_PITCH;
    // Soft floor and ceiling: the climb eases off instead of slamming into the limit
    const headroom = GAME_CONFIG.MAX_ALTITUDE - ship.position.y;
    const floorRoom = ship.position.y - GAME_CONFIG.MIN_ALTITUDE;
    if (targetPitch > 0 && headroom < 12) targetPitch *= Math.max(0, headroom / 12);
    if (targetPitch < 0 && floorRoom < 8) targetPitch *= Math.max(0, floorRoom / 8);
    this.pitchAngle += (targetPitch - this.pitchAngle) * Math.min(1, GAME_CONFIG.PITCH_SMOOTHING * delta);
    ship.rotation.x = this.pitchAngle; // nose is at -Z, so +x pitches it up

    // Bank into the turn — roll proportional to the smoothed turn rate
    const targetBank = (this.rotationVelocity / GAME_CONFIG.TURN_RATE) * GAME_CONFIG.MAX_BANK_ANGLE;
    const bankSmooth = Math.min(1, GAME_CONFIG.BANK_SMOOTHING * delta);

    // Barrel roll overrides banking: full 360° roll + sideways dodge
    if (this.rollCooldown > 0) this.rollCooldown -= delta;
    if (this.rollTimer > 0) {
      this.rollTimer = Math.max(0, this.rollTimer - delta);
      const progress = 1 - this.rollTimer / GAME_CONFIG.ROLL_DURATION;
      ship.rotation.z = this.rollDir * Math.PI * 2 * progress;
      // Dodge sideways (perpendicular to facing) while rolling
      const dodge = GAME_CONFIG.ROLL_DODGE_SPEED * delta * this.rollDir;
      ship.position.x -= Math.cos(this.shipRotation) * dodge;
      ship.position.z += Math.sin(this.shipRotation) * dodge;
    } else {
      ship.rotation.z += (targetBank - ship.rotation.z) * bankSmooth;
    }

    // Always flying forward — planes don't hover. W/S trim the throttle.
    ship.position.x -= Math.sin(this.shipRotation) * speed * delta;
    ship.position.z -= Math.cos(this.shipRotation) * speed * delta;
    ship.position.y += Math.sin(this.pitchAngle) * speed * delta;
    ship.position.y = Math.max(GAME_CONFIG.MIN_ALTITUDE,
      Math.min(GAME_CONFIG.MAX_ALTITUDE, ship.position.y));

    if (this.crashGrace > 0) this.crashGrace -= delta;

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
    this.updateFlightInstruments(ship, speed, delta);
    this.updateOnboarding(ship, delta, speed);
    this.updateWaypoint(ship);
    this.updateTargeting(ship);

    // The key legend retires itself once you've had time to read it
    if (this.controlsPanelTimer > 0) {
      this.controlsPanelTimer -= delta;
      if (this.controlsPanelTimer <= 0 && !this.controlsPanelHidden) {
        this.controlsPanelHidden = true;
        this.instruments.setControlsPanel(false);
      }
    }

    const camBehind = 14;
    const camUp = 8;
    this.camera.position.x = ship.position.x + Math.sin(this.shipRotation) * camBehind;
    const camTargetY = ship.position.y + camUp;
    if (this.camY === undefined || Math.abs(this.camY - camTargetY) > 40) this.camY = camTargetY;
    this.camY += (camTargetY - this.camY) * Math.min(1, delta * 9);
    this.camera.position.y = this.camY;
    this.camera.position.z = ship.position.z + Math.cos(this.shipRotation) * camBehind;
    this.camera.lookAt(ship.position);

    // Speed sensation: FOV widens as you go faster
    const targetFov = 75 + (speed / GAME_CONFIG.BOOST_SPEED) * 10;
    if (Math.abs(this.camera.fov - targetFov) > 0.05) {
      this.camera.fov += (targetFov - this.camera.fov) * Math.min(1, delta * 4);
      this.camera.updateProjectionMatrix();
    }

    // Camera leans into the bank (clamped so barrel rolls don't flip the view)
    const camRoll = Math.max(-0.7, Math.min(0.7, ship.rotation.z)) * 0.35;
    this.camera.rotateZ(camRoll);

    // Impact shake: decaying random camera offset
    if (this.shakeTime > 0) {
      this.shakeTime = Math.max(0, this.shakeTime - delta);
      const s = this.shakeMag * (this.shakeTime / this.shakeDur);
      this.camera.position.x += (Math.random() - 0.5) * s * 2;
      this.camera.position.y += (Math.random() - 0.5) * s * 2;
      this.camera.position.z += (Math.random() - 0.5) * s * 2;
    }

    // Photo mode: cinematic orbit around the plane
    if (this.photoMode) this.updatePhotoCamera(ship, delta);
  }

  /** Compass, artificial horizon, terrain warning, vignettes, discoveries */
  updateFlightInstruments(ship, speed, delta) {
    const ins = this.instruments;
    if (!ins) return;

    // Heading (0 = north = -Z, clockwise)
    const headingDeg = ((-this.shipRotation * 180 / Math.PI) % 360 + 360) % 360;
    const markers = [];
    const bearingTo = (x, z) => {
      const dx = x - ship.position.x, dz = z - ship.position.z;
      let rel = Math.atan2(dx, -dz) * 180 / Math.PI - headingDeg;
      rel = ((rel + 540) % 360) - 180;
      return rel;
    };
    for (const mill of CAPTURE_WINDMILLS) {
      const state = this.windmillStates[mill.id];
      markers.push({
        rel: bearingTo(mill.x, mill.z), size: 5,
        color: state?.team === 'red' ? '#ff5555' : state?.team === 'blue' ? '#5599ff' : '#dddddd',
      });
    }
    const myTeam = this.localPlayer?.team;
    const teamOf = {};
    if (this.gameState?.players) for (const pl of this.gameState.players) teamOf[pl.id] = pl.team;
    for (const [id, other] of this.players) {
      if (id === this.localPlayer.id || !other.visible) continue;
      if (other.position.distanceTo(ship.position) > (this.radarSweepActive() ? 4000 : 700)) continue;
      markers.push({
        rel: bearingTo(other.position.x, other.position.z), size: 4,
        color: teamOf[id] === myTeam ? '#44ff88' : '#ff4444',
      });
    }
    ins.updateCompass(headingDeg, markers);

    // Vertical speed (metres per second in the HUD's 3x altitude scale)
    if (this.prevAltitude === null) this.prevAltitude = ship.position.y;
    const vs = delta > 0 ? (ship.position.y - this.prevAltitude) / delta * 3 : 0;
    this.verticalSpeed += (vs - this.verticalSpeed) * Math.min(1, delta * 6);
    this.prevAltitude = ship.position.y;
    ins.updateAttitude(this.pitchAngle, ship.rotation.z, ship.position.y * 3, this.verticalSpeed);

    // Terrain / obstacle warning: project the flight path ~1.5s ahead
    let warn = false;
    if (!this.crashed && this.crashGrace <= 0) {
      const fx = -Math.sin(this.shipRotation), fz = -Math.cos(this.shipRotation);
      const vy = Math.sin(this.pitchAngle) * speed;
      outer:
      for (let t = 0.3; t <= 1.5; t += 0.3) {
        const px = ship.position.x + fx * speed * t;
        const pz = ship.position.z + fz * speed * t;
        const py = ship.position.y + vy * t;
        for (const [, colliders] of this.obstacles) {
          for (const obs of colliders) {
            if (py > obs.topY + 2) continue;
            const dx = px - obs.x, dz = pz - obs.z;
            const r = obs.radius + GAME_CONFIG.PLANE_COLLISION_RADIUS + 3;
            if (dx * dx + dz * dz < r * r) { warn = true; break outer; }
          }
        }
      }
    }
    ins.setPullUp(warn);
    this.terrainWarn = warn;
    if (warn) {
      this.pullUpBeep -= delta;
      if (this.pullUpBeep <= 0) { this.pullUpBeep = 0.45; this.playSound('warning'); }
    } else {
      this.pullUpBeep = 0;
    }

    // Screen-edge vignettes: boost rush and low health
    const boosting = this.controls.boost && this.localPlayer.energy > 0;
    this.boostVignette += ((boosting ? 1 : 0) - this.boostVignette) * Math.min(1, delta * 5);
    const damage = this.playerHealth < 45 ? (1 - this.playerHealth / 45) * 0.75 : 0;
    ins.setVignettes({ boost: this.boostVignette * 0.6, damage });

    this.checkDiscoveries(ship);
  }

  /** Landmark and village discovery toasts */
  checkDiscoveries(ship) {
    for (const [, list] of this.chunkLandmarks) {
      for (const lm of list) {
        if (this.discovered.has(lm.id)) continue;
        const dx = ship.position.x - lm.x, dz = ship.position.z - lm.z;
        if (dx * dx + dz * dz < 150 * 150) {
          this.discovered.add(lm.id);
          this.instruments.toast(lm.icon, `Discovered: ${lm.name}`, lm.subtitle);
          this.playSound('pickup');
        }
      }
    }

    const cx = Math.floor(ship.position.x / GAME_CONFIG.CHUNK_SIZE);
    const cz = Math.floor(ship.position.z / GAME_CONFIG.CHUNK_SIZE);
    const bx = Math.floor(cx / 3), bz = Math.floor(cz / 3);
    const key = `${bx},${bz}`;
    if (key !== this.lastBiomeKey) {
      this.lastBiomeKey = key;
      if (!this.visitedBlocks.has(key)) {
        this.visitedBlocks.add(key);
        const biome = this.getBiome(cx, cz);
        if (biome === 'village') {
          this.instruments.toast('🏘️', `Welcome to ${this.villageName(bx, bz)}`, 'Village');
        } else if (biome === 'waterland') {
          this.instruments.toast('🌊', `${this.villageName(bx, bz)} Polder`, 'Waterland');
        }
      }
    }
  }

  villageName(bx, bz) {
    const names = ['Zonneveld', 'Molendijk', 'Bloemwijk', 'Waterhoek', 'Oosterbeek', 'Lindenhof',
      'Groenendaal', 'Rozenburg', 'Kerkwijk', 'Zwanenmeer', 'Eikendorp', 'Tulpenveen',
      'Heidebroek', 'Noorderwaard', 'Vliethoven', 'Brugdorp', 'Zilverdam', 'Wilgenoord'];
    return names[Math.floor(this.seededRandom(bx * 917 + bz * 331 + 5) * names.length)];
  }

  updatePhotoCamera(ship, delta) {
    this.photoAngle += delta * 0.3;
    const r = 26;
    this.camera.position.set(
      ship.position.x + Math.cos(this.photoAngle) * r,
      ship.position.y + 6 + Math.sin(this.animationTime * 0.5) * 2.5,
      ship.position.z + Math.sin(this.photoAngle) * r
    );
    this.camera.lookAt(ship.position);
  }

  togglePhotoMode() {
    this.photoMode = !this.photoMode;
    this.instruments.setPhotoMode(this.photoMode);
    if (this.touch) this.touch.show(!this.photoMode);
    if (this.photoMode) {
      this.photoAngle = this.shipRotation + Math.PI / 2;
      this.instruments.toast('📷', 'Photo mode', 'C to save a screenshot · P to exit');
    }
  }

  /**
   * Moves the shadow frustum in whole shadow-map texels. Without this the
   * frustum slides continuously with the plane and every shadow edge
   * shimmers ("shadow swimming").
   */
  snapShadowFrustum() {
    const light = this.sunLight;
    if (!light || !light.castShadow) return;
    const cam = light.shadow.camera;
    const texel = (cam.right - cam.left) / light.shadow.mapSize.x;
    const dir = this._shadowDir || (this._shadowDir = new THREE.Vector3());
    const right = this._shadowRight || (this._shadowRight = new THREE.Vector3());
    const up = this._shadowUp || (this._shadowUp = new THREE.Vector3());
    dir.subVectors(light.target.position, light.position).normalize();
    right.crossVectors(new THREE.Vector3(0, 1, 0), dir).normalize();
    up.crossVectors(dir, right).normalize();
    const anchor = light.target.position;
    const a = anchor.dot(right), b = anchor.dot(up);
    const da = Math.round(a / texel) * texel - a;
    const db = Math.round(b / texel) * texel - b;
    anchor.addScaledVector(right, da).addScaledVector(up, db);
    light.position.addScaledVector(right, da).addScaledVector(up, db);
  }

  /** Slow aerial pan over the airfield behind the login screen */
  updateIntroCamera() {
    const a = this.animationTime * 0.06;
    this.camera.position.set(Math.cos(a) * 150, 42 + Math.sin(a * 1.7) * 6, 30 + Math.sin(a) * 150);
    this.camera.lookAt(0, 4, 20);
  }

  /**
   * Sky, lighting, wind, clouds and every material that reacts to time of
   * day or weather. Runs every frame, before and after login.
   */
  updateEnvironment(delta) {
    const ship = this.localPlayer ? this.players.get(this.localPlayer.id) : null;
    const center = ship ? ship.position : this.camera.position;

    // Wind: slowly wandering direction, strength follows the weather
    this.wind.targetSpeed = this.weatherNow.wind || 7;
    this.wind.speed += (this.wind.targetSpeed - this.wind.speed) * Math.min(1, delta * 0.2);
    this.wind.angle += Math.sin(this.animationTime * 0.05) * delta * 0.05;
    this.wind.x = Math.cos(this.wind.angle) * this.wind.speed;
    this.wind.z = Math.sin(this.wind.angle) * this.wind.speed;

    if (this.sunLight) this.sunLight.target.position.set(center.x, 0, center.z);
    this.sky.update(delta, this.camera, this.weatherNow,
      { sun: this.sunLight, hemi: this.hemiLight, ambient: this.ambientLight },
      this.renderer, this.animationTime);
    const sky = this.sky.state;
    this.snapShadowFrustum();

    this.clouds.update(delta, center, this.wind, sky, this.weatherNow.cover);

    // Ground follows the player; scroll the texture so it stays put in world space
    if (this.groundPlane) {
      this.groundPlane.position.x = center.x;
      this.groundPlane.position.z = center.z;
      const tile = GAME_CONFIG.GROUND_TILE;
      this.groundTex.offset.set((center.x / tile) % 1, (-center.z / tile) % 1);
    }
    if (this.cloudShadow) {
      this.cloudShadow.position.x = center.x;
      this.cloudShadow.position.z = center.z;
      const tile = GAME_CONFIG.GROUND_SIZE / 2.5;
      const drift = this.animationTime * 0.012;
      this.cloudShadow.material.map.offset.set(
        (center.x / tile + drift * this.wind.x * 0.1) % 1,
        (-center.z / tile - drift * this.wind.z * 0.1) % 1);
      this.cloudShadow.material.opacity =
        0.42 * this.weatherNow.cover * sky.daylight * (1 - this.weatherNow.overcast * 0.6);
    }
    if (this.horizonRing) {
      this.horizonRing.position.x = this.camera.position.x;
      this.horizonRing.position.z = this.camera.position.z;
      this.horizonRing.material.color.copy(sky.fogColor).multiplyScalar(0.55);
    }

    // Materials that react to light and weather
    const lamp = this.sky.lampFactor;
    this.mats.glow.emissiveIntensity = 0.05 + lamp * 2.4;
    this.mats.water.color.setHex(0x17466B).lerp(sky.horizonColor, 0.45 * sky.daylight + 0.1);
    this.mats.water.normalMap.offset.x += delta * 0.018;
    this.mats.water.normalMap.offset.y += delta * 0.011;
    this.mats.water.roughness = 0.14 + this.weatherNow.rain * 0.25;
  }

  checkCollisions(ship) {
    if (this.crashed || this.crashGrace > 0) return;
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
    this.shake(0.9, 0.5);
    this.spawnExplosion(ship.position);

    const overlay = document.getElementById('crash-overlay');
    if (overlay) {
      const text = overlay.querySelector('.crash-text');
      if (text) text.textContent = 'CRASHED!';
      const sub = document.getElementById('crash-sub');
      if (sub) sub.textContent = '-20 health · climbing out, fly over obstacles';
      overlay.style.display = 'flex';
    }

    // Real damage, kept in sync with the server (which can rule it fatal)
    this.playerHealth = Math.max(0, this.playerHealth - GAME_CONFIG.CRASH_HEALTH_PENALTY);
    this.setHealthBar(this.playerHealth);
    if (this.socket && this.isConnected) {
      try {
        this.socket.emit('crashDamage', { gameId: this.gameState?.id });
      } catch (error) {
        console.error('Error reporting crash:', error);
      }
    }

    setTimeout(() => {
      this.crashed = false;
      if (this.dead) return; // fatal crash — the server respawn takes over
      if (overlay) overlay.style.display = 'none';
      this.pitchAngle = 0;
      this.crashGrace = GAME_CONFIG.CRASH_GRACE;
    }, GAME_CONFIG.CRASH_DURATION);
  }

  /**
   * After a crash the plane keeps flying, slowly, while it climbs out to a
   * safe altitude — no teleport, so you keep your bearings
   */
  updateCrashRecovery(delta) {
    const ship = this.players.get(this.localPlayer.id);
    if (!ship) return;
    const speed = GAME_CONFIG.MOVEMENT_SPEED * 0.45;
    ship.position.x -= Math.sin(this.shipRotation) * speed * delta;
    ship.position.z -= Math.cos(this.shipRotation) * speed * delta;
    const targetY = Math.max(ship.position.y, GAME_CONFIG.RESPAWN_ALTITUDE);
    ship.position.y += (targetY - ship.position.y) * Math.min(1, delta * 2.5);
    ship.rotation.x += (0.25 - ship.rotation.x) * Math.min(1, delta * 4);
    ship.rotation.z *= Math.exp(-3 * delta);
    this.updateTrail(this.localPlayer.id, ship.position);
    this.updateChunks(ship.position.x, ship.position.z);

    const camBehind = 14, camUp = 8;
    this.camera.position.x = ship.position.x + Math.sin(this.shipRotation) * camBehind;
    this.camera.position.y = ship.position.y + camUp;
    this.camera.position.z = ship.position.z + Math.cos(this.shipRotation) * camBehind;
    this.camera.lookAt(ship.position);
    if (this.shakeTime > 0) {
      this.shakeTime = Math.max(0, this.shakeTime - delta);
      const sh = this.shakeMag * (this.shakeTime / this.shakeDur);
      this.camera.position.x += (Math.random() - 0.5) * sh * 2;
      this.camera.position.y += (Math.random() - 0.5) * sh * 2;
    }
  }

  // =========================================================================
  // ONBOARDING, WAYPOINT, NAME TAGS
  // =========================================================================

  /** Called the moment the player gets control after takeoff */
  onAirborne() {
    this.controlsPanelTimer = GAME_CONFIG.CONTROLS_PANEL_SECONDS;
    if (this.touch) this.touch.show(true);
    if (this.firstFlight && !this.onboarding) this.startOnboarding();
    else if (!this.isTouch && this.instruments?.settings.mouse !== false && !this.pointerLocked) {
      // Wait for the countdown and team banner to clear before more text
      const delay = Math.max(0, this.countdownEndsAt - performance.now()) + 2500;
      setTimeout(() => {
        if (!this.pointerLocked) this.instruments.toast('🖱️', 'Click the world to steer with the mouse', 'A / D and ↑ / ↓ work too');
      }, delay);
    }
  }

  startOnboarding() {
    const key = (k) => `<span class="key">${k}</span>`;
    if (this.isTouch) {
      this.onboarding = {
        index: 0, progress: 0, doneTimer: 0,
        steps: [
          { label: 'Step 1 of 5 · Steer', html: 'Drag anywhere on the left half to steer', check: (g) => Math.abs(g.rotationVelocity) > 0.8, need: 0.8 },
          { label: 'Step 2 of 5 · Altitude', html: 'Push the stick up to climb, down to dive — fly OVER buildings', check: (g) => Math.abs(g.pitchAngle) > 0.18, need: 0.6 },
          { label: 'Step 3 of 5 · Boost', html: 'Hold BOOST for speed (it drains energy)', check: (g) => g.controls.boost && g.localPlayer.energy > 0, need: 0.5 },
          { label: 'Step 4 of 5 · Guns', html: 'Hold FIRE with an enemy in the red box', check: (g) => g.animationTime - g.lastFireTime < 0.3, need: 0.2 },
          { label: 'Step 5 of 5 · Objective', html: 'Follow the yellow marker and fly inside the windmill circle', check: (g) => g.nearAnyWindmill(), need: 1.2 },
        ],
      };
      this.showOnboardingStep();
      return;
    }
    this.onboarding = {
      index: 0,
      progress: 0,
      doneTimer: 0,
      steps: [
        { label: 'Step 1 of 5 · Steer',
          html: `Steer with ${key('A')} / ${key('D')} — or click the world and use the mouse`,
          check: (g) => Math.abs(g.rotationVelocity) > 0.8, need: 0.8 },
        { label: 'Step 2 of 5 · Altitude',
          html: `Climb with ${key('↑')} and dive with ${key('↓')} — fly OVER buildings`,
          check: (g) => Math.abs(g.pitchAngle) > 0.18, need: 0.6 },
        { label: 'Step 3 of 5 · Boost',
          html: `Hold ${key('Shift')} to boost (it drains energy)`,
          check: (g) => g.controls.boost && g.localPlayer.energy > 0, need: 0.5 },
        { label: 'Step 4 of 5 · Guns',
          html: `Put the crosshair on the yellow lead circle, then ${key('Space')} or ${key('LMB')} — the box turns red when you're locked`,
          check: (g) => g.animationTime - g.lastFireTime < 0.3, need: 0.2 },
        { label: 'Step 5 of 5 · Objective',
          html: 'Follow the yellow marker and circle the windmill to capture it',
          check: (g) => g.nearAnyWindmill(), need: 1.2 },
      ],
    };
    this.showOnboardingStep();
  }

  showOnboardingStep() {
    const ob = this.onboarding;
    if (!ob || !this.instruments) return;
    const step = ob.steps[ob.index];
    if (step) this.instruments.setHint(step.html, step.label, true);
  }

  updateOnboarding(ship, delta) {
    const ob = this.onboarding;
    if (!ob) return;
    if (ob.index >= ob.steps.length) {
      ob.doneTimer -= delta;
      if (ob.doneTimer <= 0) {
        this.instruments.setHint(null);
        this.onboarding = null;
      }
      return;
    }
    const step = ob.steps[ob.index];
    if (step.check(this)) ob.progress += delta;
    if (ob.progress >= step.need) {
      ob.progress = 0;
      ob.index++;
      this.playSound('pickup');
      if (ob.index >= ob.steps.length) {
        ob.doneTimer = 7;
        this.instruments.setHint(
          `You're ready! Hold windmills for points, +${this.rules.killScore} per shoot-down. Good hunting.`, 'Flight school complete');
      } else {
        this.showOnboardingStep();
      }
    }
  }

  skipOnboarding() {
    if (!this.onboarding) return;
    this.onboarding = null;
    this.instruments.setHint(null);
    this.instruments.toast('🎓', 'Tutorial skipped', 'Follow the yellow marker to a windmill');
  }

  nearAnyWindmill() {
    const ship = this.localPlayer ? this.players.get(this.localPlayer.id) : null;
    if (!ship) return false;
    for (const mill of CAPTURE_WINDMILLS) {
      const dx = ship.position.x - mill.x, dz = ship.position.z - mill.z;
      if (dx * dx + dz * dz < GAME_CONFIG.CAPTURE_RADIUS * GAME_CONFIG.CAPTURE_RADIUS) return true;
    }
    return false;
  }

  toggleControlsPanel() {
    this.controlsPanelHidden = !this.controlsPanelHidden;
    this.controlsPanelTimer = 0;
    this.instruments.setControlsPanel(!this.controlsPanelHidden);
  }

  /** Picks the windmill worth flying to and projects a marker onto the screen */
  updateWaypoint(ship) {
    if (!this.instruments) return;
    const myTeam = this.localPlayer?.team;
    if (this.mode === 'tdm') { this.updateHuntWaypoint(ship, myTeam); return; }
    let best = null, bestScore = Infinity;
    for (const mill of CAPTURE_WINDMILLS) {
      const state = this.windmillStates[mill.id];
      if (state?.team === myTeam) continue;
      const dx = mill.x - ship.position.x, dz = mill.z - ship.position.z;
      let score = Math.sqrt(dx * dx + dz * dz);
      if (state?.contestingTeam === myTeam && state.progress > 0) score *= 0.4; // finish what we started
      if (score < bestScore) { bestScore = score; best = { mill, state, dist: Math.sqrt(dx * dx + dz * dz) }; }
    }
    if (!best) {
      // Everything is ours: point at the nearest mill to defend it
      for (const mill of CAPTURE_WINDMILLS) {
        const dx = mill.x - ship.position.x, dz = mill.z - ship.position.z;
        const d = Math.sqrt(dx * dx + dz * dz);
        if (d < bestScore) { bestScore = d; best = { mill, state: this.windmillStates[mill.id], dist: d, defend: true }; }
      }
      if (!best) { this.instruments.updateWaypoint({ visible: false }); return; }
    }
    const v = this._wpVec || (this._wpVec = new THREE.Vector3());
    v.set(best.mill.x, 26, best.mill.z).project(this.camera);
    const w = window.innerWidth, h = window.innerHeight;
    const behind = v.z > 1;
    let x = (v.x * 0.5 + 0.5) * w;
    let y = (-v.y * 0.5 + 0.5) * h;
    if (behind) { x = w - x; y = h - y; }
    // Keep the marker clear of the HUD: controls panel (left), radar
    // (right), compass stack (top), hint + attitude cluster (bottom)
    const inset = this.hudInset();
    const onScreen = !behind && x > inset.left && x < w - inset.right && y > inset.top && y < h - inset.bottom;
    let angle = 0;
    if (!onScreen) {
      const cx = w / 2, cy = h / 2;
      const dx = (behind ? -1 : 1) * (x - cx), dy = (behind ? -1 : 1) * (y - cy);
      const ang = Math.atan2(dy, dx);
      // Intersect the ray from the centre with the inset rectangle
      const halfW = Math.min(cx - inset.left, w - inset.right - cx);
      const halfH = Math.min(cy - inset.top, h - inset.bottom - cy);
      const tx = Math.abs(Math.cos(ang)) > 1e-4 ? halfW / Math.abs(Math.cos(ang)) : Infinity;
      const ty = Math.abs(Math.sin(ang)) > 1e-4 ? halfH / Math.abs(Math.sin(ang)) : Infinity;
      const t = Math.min(tx, ty);
      x = cx + Math.cos(ang) * t;
      y = cy + Math.sin(ang) * t;
      angle = ang + Math.PI / 2;
    }
    const color = best.state?.team === 'red' ? '#ff6b6b' : best.state?.team === 'blue' ? '#7fb2ff' : '#FFD23F';
    this.waypointTargetId = best.mill.id;
    this.instruments.updateWaypoint({
      visible: true, x, y, onScreen, angle,
      label: `${best.defend ? 'DEFEND' : best.state?.team ? 'RETAKE' : 'CAPTURE'} · ${best.mill.name.toUpperCase()} MILL · ${Math.round(best.dist * 3)} m`,
      color,
    });
  }

  /**
   * Where to shoot so the bullet and the target meet: solves the intercept
   * of a straight-line shot against the target's estimated velocity.
   * Returns { point, dir, dist, angle } or null.
   */
  interceptFor(ship, other, noseDir) {
    const D = this._icD || (this._icD = new THREE.Vector3());
    const V = this._icV || (this._icV = new THREE.Vector3());
    const P = this._icP || (this._icP = new THREE.Vector3());
    D.subVectors(other.position, ship.position);
    const dist = D.length();
    if (dist < 4) return null;
    const vel = other.userData.vel || { x: 0, y: 0, z: 0 };
    V.set(vel.x, vel.y, vel.z);
    const s = GAME_CONFIG.PROJECTILE_SPEED;
    const a = V.dot(V) - s * s;
    const b = 2 * D.dot(V);
    const c = D.dot(D);
    let t = dist / s;
    const disc = b * b - 4 * a * c;
    if (Math.abs(a) > 1e-4 && disc >= 0) {
      const t1 = (-b - Math.sqrt(disc)) / (2 * a);
      const t2 = (-b + Math.sqrt(disc)) / (2 * a);
      const best = [t1, t2].filter(v => v > 0).sort((x, y) => x - y)[0];
      if (best) t = best;
    }
    P.copy(other.position).addScaledVector(V, t);
    const dir = P.clone().sub(ship.position).normalize();
    const angle = Math.acos(Math.max(-1, Math.min(1, dir.dot(noseDir)))) * 180 / Math.PI;
    return { point: P.clone(), dir, dist, angle };
  }

  /**
   * Picks the enemy closest to the nose inside the lock cone, draws the
   * bracket, health bar and lead circle, and plays a tone on lock.
   */
  updateTargeting(ship) {
    if (!this.instruments) return;
    const myTeam = this.localPlayer?.team;
    const info = {};
    if (this.gameState?.players) for (const p of this.gameState.players) info[p.id] = p;
    const cp = Math.cos(this.pitchAngle), sp = Math.sin(this.pitchAngle);
    const nose = this._noseVec || (this._noseVec = new THREE.Vector3());
    nose.set(-Math.sin(this.shipRotation) * cp, sp, -Math.cos(this.shipRotation) * cp);

    let best = null;
    for (const [id, other] of this.players) {
      if (id === this.localPlayer.id || !other.visible) continue;
      const p = info[id];
      if (!p || p.team === myTeam) continue;
      const ic = this.interceptFor(ship, other, nose);
      if (!ic || ic.dist > GAME_CONFIG.LOCK_RANGE || ic.angle > GAME_CONFIG.LOCK_CONE) continue;
      if (!best || ic.angle < best.ic.angle) best = { id, other, p, ic };
    }

    if (!best) {
      this.currentTarget = null;
      this.lockedId = null;
      this.instruments.updateLock({ visible: false });
      return;
    }

    const locked = best.ic.angle <= GAME_CONFIG.AIM_ASSIST_CONE;
    this.currentTarget = { id: best.id, dir: best.ic.dir, angle: best.ic.angle };
    if (locked && this.lockedId !== best.id) this.playSound('lock');
    this.lockedId = locked ? best.id : null;

    const v = this._lockVec || (this._lockVec = new THREE.Vector3());
    const w = window.innerWidth, h = window.innerHeight;
    v.copy(best.other.position).project(this.camera);
    const onScreen = v.z < 1 && v.x > -1 && v.x < 1 && v.y > -1 && v.y < 1;
    const size = Math.max(26, Math.min(96, 3200 / best.ic.dist));
    v.set(best.ic.point.x, best.ic.point.y, best.ic.point.z).project(this.camera);
    const lead = { visible: v.z < 1 && Math.abs(v.x) < 1 && Math.abs(v.y) < 1, x: (v.x * 0.5 + 0.5) * w, y: (-v.y * 0.5 + 0.5) * h };
    const bx = this._lockBox || (this._lockBox = new THREE.Vector3());
    bx.copy(best.other.position).project(this.camera);
    this.instruments.updateLock({
      visible: onScreen, x: (bx.x * 0.5 + 0.5) * w, y: (-bx.y * 0.5 + 0.5) * h, size, locked,
      name: `${best.p.username || 'Enemy'} · ${Math.round(best.ic.dist * 3)} m`,
      health: this.knownHealth[best.id] ?? best.p.health ?? 100,
      lead,
    });
  }

  /**
   * Magnetic aim assist: inside AIM_ASSIST_SNAP degrees the shot snaps to
   * the lead point; out to AIM_ASSIST_CONE it bends progressively less.
   */
  applyAimAssist(ship, dir) {
    if (this.instruments?.settings.assist === false) return;
    const t = this.currentTarget;
    if (!t || t.angle > GAME_CONFIG.AIM_ASSIST_CONE) return;
    const snap = GAME_CONFIG.AIM_ASSIST_SNAP, cone = GAME_CONFIG.AIM_ASSIST_CONE;
    const strength = t.angle <= snap ? 1 : 1 - ((t.angle - snap) / (cone - snap)) * 0.65;
    const out = this._assistVec || (this._assistVec = new THREE.Vector3());
    out.set(dir.x, dir.y, dir.z).lerp(t.dir, strength).normalize();
    dir.x = out.x; dir.y = out.y; dir.z = out.z;
  }

  /** Floating name / distance / BOT tags over nearby planes */  /** Team Deathmatch: the marker leads to the nearest enemy plane */
  updateHuntWaypoint(ship, myTeam) {
    const info = {};
    if (this.gameState?.players) for (const p of this.gameState.players) info[p.id] = p;
    let best = null, bestDist = Infinity;
    for (const [id, other] of this.players) {
      if (id === this.localPlayer.id || !other.visible || info[id]?.team === myTeam) continue;
      const d = other.position.distanceTo(ship.position);
      if (d < bestDist) { bestDist = d; best = { other, name: info[id]?.username || 'Enemy' }; }
    }
    if (!best) { this.instruments.updateWaypoint({ visible: false }); return; }
    const v = this._wpVec || (this._wpVec = new THREE.Vector3());
    v.copy(best.other.position).project(this.camera);
    const w = window.innerWidth, h = window.innerHeight;
    const behind = v.z > 1;
    let x = (v.x * 0.5 + 0.5) * w, y = (-v.y * 0.5 + 0.5) * h;
    if (behind) { x = w - x; y = h - y; }
    const inset = this.hudInset();
    const onScreen = !behind && x > inset.left && x < w - inset.right && y > inset.top && y < h - inset.bottom;
    let angle = 0;
    if (!onScreen) {
      const cx = w / 2, cy = h / 2;
      const ang = Math.atan2((behind ? -1 : 1) * (y - cy), (behind ? -1 : 1) * (x - cx));
      const halfW = Math.min(cx - inset.left, w - inset.right - cx);
      const halfH = Math.min(cy - inset.top, h - inset.bottom - cy);
      const tx = Math.abs(Math.cos(ang)) > 1e-4 ? halfW / Math.abs(Math.cos(ang)) : Infinity;
      const ty = Math.abs(Math.sin(ang)) > 1e-4 ? halfH / Math.abs(Math.sin(ang)) : Infinity;
      const t = Math.min(tx, ty);
      x = cx + Math.cos(ang) * t; y = cy + Math.sin(ang) * t; angle = ang + Math.PI / 2;
    }
    // Don't double up with the lock bracket when the enemy is already in view
    this.instruments.updateWaypoint({
      visible: !onScreen || bestDist > GAME_CONFIG.LOCK_RANGE, x, y, onScreen, angle,
      label: `HUNT · ${best.name.toUpperCase()} · ${Math.round(bestDist * 3)} m`, color: '#ff6b6b',
    });
  }

  /** Mode-specific HUD: TDM hides the windmill machinery */
  applyModeHud() {
    const tdm = this.mode === 'tdm';
    const dots = document.getElementById('mill-dots');
    if (dots) dots.style.display = tdm ? 'none' : '';
    for (const [, mill] of this.captureWindmills) mill.group.visible = !tdm;
    const target = this.rules.tdmTarget || 30;
    this.instruments.setModeCaption(tdm ? `Team Deathmatch · first to ${target}` : 'Windmill Domination · team score', this.localPlayer?.team);
  }

  /** Spawn already flying, pointed at something worth doing */
  spawnAirborne(ship, pos) {
    ship.position.set(pos?.x || 0, GAME_CONFIG.FLIGHT_HEIGHT, pos?.z || 0);
    ship.rotation.set(0, 0, 0);
    this.pitchAngle = 0;
    this.takeoffPhase = null;
    const overlay = document.getElementById('takeoff-overlay');
    if (overlay) overlay.style.display = 'none';
    // Face the nearest objective (Domination) or the arena centre
    let target = { x: 0, z: 0 };
    if (this.mode !== 'tdm') {
      let bestD = Infinity;
      for (const mill of CAPTURE_WINDMILLS) {
        const st = this.windmillStates[mill.id];
        if (st?.team === this.localPlayer?.team) continue;
        const d = Math.hypot(mill.x - ship.position.x, mill.z - ship.position.z);
        if (d < bestD) { bestD = d; target = mill; }
      }
    }
    this.shipRotation = Math.atan2(-(target.x - ship.position.x), -(target.z - ship.position.z));
    ship.rotation.y = this.shipRotation;
    this.controlsEnabled = true;
    this.crashGrace = GAME_CONFIG.CRASH_GRACE;
    this.camera.position.set(ship.position.x + Math.sin(this.shipRotation) * 14, ship.position.y + 8, ship.position.z + Math.cos(this.shipRotation) * 14);
    this.camera.lookAt(ship.position);
    this.onAirborne();
  }

  faceNearestEnemy(ship) {
    const info = {};
    if (this.gameState?.players) for (const p of this.gameState.players) info[p.id] = p;
    let best = null, bestD = Infinity;
    for (const [id, other] of this.players) {
      if (id === this.localPlayer.id || !other.visible || info[id]?.team === this.localPlayer.team) continue;
      const d = other.position.distanceTo(ship.position);
      if (d < bestD) { bestD = d; best = other; }
    }
    if (!best) return;
    this.shipRotation = Math.atan2(-(best.position.x - ship.position.x), -(best.position.z - ship.position.z));
    ship.rotation.y = this.shipRotation;
    this.pitchAngle = 0;
  }

  // =========================================================================
  // SCORE POPUPS, MEDALS, XP
  // =========================================================================

  addPopup(points, label) {
    this.sessionXp += points;
    this.instruments.popup(points, label);
  }

  awardMedal(icon, title, sub, points) {
    this.medalsEarned.push(title);
    this.instruments.medal(icon, title, sub);
    if (points) this.addPopup(points, title);
    this.playSound('medal');
  }

  /** Called when one of my shots (or an airstrike) downs an enemy */
  onMyKill(data) {
    const now = this.animationTime;
    this.streak++;
    this.addPopup(100, 'KILL');
    this.killTimes = this.killTimes.filter(t => now - t < 4).concat(now);
    const burst = this.killTimes.length;
    if (burst === 2) this.awardMedal('✌️', 'DOUBLE KILL', 'Two down in four seconds', 100);
    else if (burst >= 3) this.awardMedal('🔱', 'TRIPLE KILL', 'Three down in four seconds', 200);
    if (this.matchKills === 0) this.awardMedal('🩸', 'FIRST BLOOD', 'First kill of the match', 50);
    if (data.targetId && data.targetId === this.lastKilledBy) {
      this.awardMedal('😤', 'REVENGE', `Payback on ${this.nameOf(data.targetId)}`, 50);
      this.lastKilledBy = null;
    }
    const me = this.players.get(this.localPlayer.id);
    const victim = this.players.get(data.targetId);
    if (me && victim && !data.airstrike && me.position.distanceTo(victim.position) > 170) {
      this.awardMedal('🎯', 'LONG SHOT', `${Math.round(me.position.distanceTo(victim.position) * 3)} m`, 75);
    }
    if (this.deathsSinceKill >= 3) this.awardMedal('💪', 'COMEBACK', 'Back in the fight', 50);
    this.deathsSinceKill = 0;
    if (this.mode !== 'tdm' && me) {
      for (const mill of CAPTURE_WINDMILLS) {
        const st = this.windmillStates[mill.id];
        if (st?.team === this.localPlayer.team && Math.hypot(me.position.x - mill.x, me.position.z - mill.z) <= GAME_CONFIG.CAPTURE_RADIUS) {
          this.addPopup(50, 'DEFEND');
          break;
        }
      }
    }
  }

  totalXp() {
    try { return parseInt(localStorage.getItem('dvf.xp') || '0', 10) || 0; } catch (e) { return 0; }
  }

  bankXp() {
    if (this.xpBanked) return;
    this.xpBanked = true;
    try { localStorage.setItem('dvf.xp', String(this.totalXp() + this.sessionXp)); } catch (e) { /* ignore */ }
  }

  levelFor(xp) {
    return Math.min(30, Math.floor(Math.sqrt(xp / 400)) + 1);
  }

  rankFor(xp) {
    const lv = this.levelFor(xp);
    if (lv >= 17) return 'Ace';
    if (lv >= 14) return 'Commander';
    if (lv >= 11) return 'Major';
    if (lv >= 8) return 'Captain';
    if (lv >= 5) return 'Lieutenant';
    if (lv >= 3) return 'Pilot';
    return 'Cadet';
  }

  radarSweepActive() {
    return this.radarSweepUntil > this.animationTime;
  }

  /**
   * Projects a world point to the screen; if it is out of view (or behind
   * the camera) the point is pushed to the HUD-safe edge with an arrow angle.
   */
  /** Screen rectangle that markers must stay inside (HUD lives outside it) */
  hudInset(forEdgeMarkers = false) {
    if (this.isTouch || window.innerHeight < 600) {
      return forEdgeMarkers ? { left: 170, right: 225, top: 120, bottom: 125 } : { left: 170, right: 225, top: 110, bottom: 135 };
    }
    return forEdgeMarkers ? { left: 235, right: 330, top: 175, bottom: 235 } : { left: 240, right: 330, top: 150, bottom: 230 };
  }

  screenMarkerFor(pos, inset = this.hudInset()) {
    const v = this._smVec || (this._smVec = new THREE.Vector3());
    v.copy(pos).project(this.camera);
    const w = window.innerWidth, h = window.innerHeight;
    const behind = v.z > 1;
    let x = (v.x * 0.5 + 0.5) * w, y = (-v.y * 0.5 + 0.5) * h;
    if (behind) { x = w - x; y = h - y; }
    const inView = !behind && x > inset.left && x < w - inset.right && y > inset.top && y < h - inset.bottom;
    let angle = 0;
    if (!inView) {
      const cx = w / 2, cy = h / 2;
      const ang = Math.atan2((behind ? -1 : 1) * (y - cy), (behind ? -1 : 1) * (x - cx));
      const halfW = Math.min(cx - inset.left, w - inset.right - cx);
      const halfH = Math.min(cy - inset.top, h - inset.bottom - cy);
      const tx = Math.abs(Math.cos(ang)) > 1e-4 ? halfW / Math.abs(Math.cos(ang)) : Infinity;
      const ty = Math.abs(Math.sin(ang)) > 1e-4 ? halfH / Math.abs(Math.sin(ang)) : Infinity;
      const t = Math.min(tx, ty);
      x = cx + Math.cos(ang) * t; y = cy + Math.sin(ang) * t; angle = ang + Math.PI / 2;
    }
    return { x, y, inView, angle };
  }

  /**
   * Always-on navigation: an edge arrow for every enemy plane and every
   * windmill you can't see, and a floating label over windmills you can.
   */
  updateEdgeMarkers() {
    if (!this.instruments || !this.localPlayer) return;
    const me = this.players.get(this.localPlayer.id);
    if (!me || this.photoMode) { this.instruments.updateEdgeMarkers([]); return; }
    const list = [];
    const myTeam = this.localPlayer.team;
    const info = {};
    if (this.gameState?.players) for (const p of this.gameState.players) info[p.id] = p;
    const enemyRange = this.radarSweepActive() ? 5000 : 1200;
    const tmp = this._edgeVec || (this._edgeVec = new THREE.Vector3());
    // Keep clear of the score bar / compass (top), controls (left), radar (right), hint + attitude (bottom)
    const EDGE_INSET = this.hudInset(true);

    // Side list rows: bearing relative to the nose, clockwise
    const headingDeg = ((-this.shipRotation * 180 / Math.PI) % 360 + 360) % 360;
    const relBearing = (x, z) => {
      const dx = x - me.position.x, dz = z - me.position.z;
      const rel = Math.atan2(dx, -dz) * 180 / Math.PI - headingDeg;
      return ((rel + 540) % 360) - 180;
    };
    const rows = [];

    // Enemy planes: nearest few, listed on the side (in-view ones also carry a box + tag)
    const enemies = [];
    for (const [id, other] of this.players) {
      if (id === this.localPlayer.id || !other.visible) continue;
      const p = info[id];
      if (!p || p.team === myTeam) continue;
      const dist = other.position.distanceTo(me.position);
      if (dist > enemyRange) continue;
      const dy = other.position.y - me.position.y;
      enemies.push({ id: `e:${id}`, cls: 'enemy', dist: dist * 3, rel: relBearing(other.position.x, other.position.z),
        name: `${p.username || 'Enemy'}${dy > 12 ? ' ▲' : dy < -12 ? ' ▼' : ''}`, owner: p.isBot ? 'BOT' : '' });
    }
    enemies.sort((a, b) => a.dist - b.dist);
    rows.push(...enemies.slice(0, this.isTouch ? 2 : 3));

    // Windmills: a label over the tower when it's in view, and a row on the
    // side for every mill the team doesn't hold (Domination only)
    if (this.mode !== 'tdm') {
      const millRows = [];
      for (const mill of CAPTURE_WINDMILLS) {
        const st = this.windmillStates[mill.id];
        const dist = Math.hypot(mill.x - me.position.x, mill.z - me.position.z);
        const owner = st?.team === myTeam ? 'YOURS' : st?.team ? 'ENEMY' : 'FREE';
        const cls = st?.team === 'red' ? 'mill-red' : st?.team === 'blue' ? 'mill-blue' : 'mill-none';
        if (st?.team !== myTeam) {
          millRows.push({ id: `m:${mill.id}`, cls, dist: dist * 3, rel: relBearing(mill.x, mill.z),
            name: `${mill.name.toUpperCase()} MILL`, owner, target: this.waypointTargetId === mill.id });
        }
        if (this.waypointTargetId === mill.id) continue; // the big marker already covers it
        tmp.set(mill.x, 36, mill.z);
        const m = this.screenMarkerFor(tmp, EDGE_INSET);
        if (!m.inView) continue;
        list.push({ id: `m:${mill.id}`, x: m.x, y: m.y, angle: 0, inView: true, cls, dist,
          label: `${mill.name.toUpperCase()} MILL · ${Math.round(dist * 3)} m`, owner });
      }
      millRows.sort((a, b) => (b.target ? 1 : 0) - (a.target ? 1 : 0) || a.dist - b.dist);
      rows.push(...millRows.slice(0, this.isTouch ? 3 : 4));
    }
    this.instruments.updateEdgeMarkers(list);
    this.instruments.updateNavPanel(rows);
  }

  /**
   * Swept test of one of my bullets against every enemy plane as drawn on
   * screen. On a hit: impact burst, bullet removed, claim sent to the server.
   */
  registerLocalHit(id, projectile, prev, teamOf) {
    if (!this.socket || !this.isConnected) return false;
    const r = GAME_CONFIG.CLIENT_HIT_RADIUS;
    for (const [pid, other] of this.players) {
      if (pid === this.localPlayer.id || !other.visible || teamOf[pid] === this.localPlayer.team) continue;
      if (this.pointSegmentDistance(other.position, prev, projectile.position) > r) continue;
      this.spawnHitSpark(projectile.position);
      this.scene.remove(projectile);
      this.projectiles.delete(id);
      try {
        this.socket.emit('hitClaim', {
          gameId: this.gameState?.id, projectileId: id, targetId: pid,
          position: { x: projectile.position.x, y: projectile.position.y, z: projectile.position.z },
        });
      } catch (e) { console.error('hitClaim failed', e); }
      return true;
    }
    return false;
  }

  pointSegmentDistance(p, a, b) {
    const abx = b.x - a.x, aby = b.y - a.y, abz = b.z - a.z;
    const apx = p.x - a.x, apy = p.y - a.y, apz = p.z - a.z;
    const ab2 = abx * abx + aby * aby + abz * abz;
    const t = ab2 > 0 ? Math.max(0, Math.min(1, (apx * abx + apy * aby + apz * abz) / ab2)) : 0;
    const cx = a.x + abx * t - p.x, cy = a.y + aby * t - p.y, cz = a.z + abz * t - p.z;
    return Math.sqrt(cx * cx + cy * cy + cz * cz);
  }

  /** Small impact burst where a bullet struck a plane */
  spawnHitSpark(position) {
    const flash = new THREE.Mesh(
      new THREE.SphereGeometry(0.9, 6, 6),
      new THREE.MeshBasicMaterial({ color: 0xFFF2A0, transparent: true, opacity: 0.95 })
    );
    flash.position.copy(position);
    flash.userData = { vel: new THREE.Vector3(), life: 0.14, maxLife: 0.14, isFlash: true };
    this.scene.add(flash);
    this.smokeParticles.push(flash);
    for (let i = 0; i < 7; i++) {
      const p = new THREE.Mesh(
        new THREE.SphereGeometry(0.22, 4, 4),
        new THREE.MeshBasicMaterial({ color: i % 2 ? 0xFF8A2A : 0xFFD070, transparent: true, opacity: 0.95 })
      );
      p.position.copy(position);
      const a = Math.random() * Math.PI * 2, b = (Math.random() - 0.5) * Math.PI;
      const spd = 10 + Math.random() * 14;
      p.userData = {
        vel: new THREE.Vector3(Math.cos(a) * Math.cos(b) * spd, Math.sin(b) * spd + 3, Math.sin(a) * Math.cos(b) * spd),
        life: 0.25 + Math.random() * 0.2, maxLife: 0.45, grav: true,
      };
      this.scene.add(p);
      this.smokeParticles.push(p);
    }
  }

  /**
   * Keeps the edges readable: only the nearest few arrows of each kind,
   * and any two that would overprint get nudged apart.
   */
  declutterMarkers(list) {
    const maxEach = this.isTouch ? 2 : 3;
    const byDist = (a, b) => (a.dist || 0) - (b.dist || 0);
    const enemies = list.filter(m => m.cls === 'enemy' && !m.inView).sort(byDist).slice(0, maxEach);
    const mills = list.filter(m => m.cls !== 'enemy' && !m.inView).sort(byDist).slice(0, maxEach);
    const inView = list.filter(m => m.inView);
    const edge = enemies.concat(mills).sort((a, b) => a.y - b.y || a.x - b.x);
    const minGapX = 120, minGapY = 34;
    for (let i = 1; i < edge.length; i++) {
      for (let j = 0; j < i; j++) {
        const a = edge[j], b = edge[i];
        if (Math.abs(a.y - b.y) < minGapY && Math.abs(a.x - b.x) < minGapX) {
          b.x = a.x + (b.x >= a.x ? minGapX : -minGapX);
          b.x = Math.max(60, Math.min(window.innerWidth - 60, b.x));
        }
      }
    }
    return inView.concat(edge);
  }

  /** Floating name / distance / BOT tags over nearby planes */
  updateNameTags() {
    if (!this.instruments || !this.localPlayer) return;
    const me = this.players.get(this.localPlayer.id);
    if (!me || this.photoMode) { this.instruments.updateTags([]); return; }
    const info = {};
    if (this.gameState?.players) for (const p of this.gameState.players) info[p.id] = p;
    const v = this._tagVec || (this._tagVec = new THREE.Vector3());
    const w = window.innerWidth, h = window.innerHeight;
    const list = [];
    for (const [id, ship] of this.players) {
      if (id === this.localPlayer.id || !ship.visible) continue;
      const dist = ship.position.distanceTo(me.position);
      if (dist > (this.radarSweepActive() ? 4000 : 520)) continue;
      v.set(ship.position.x, ship.position.y + 3.5, ship.position.z).project(this.camera);
      if (v.z > 1 || v.x < -1 || v.x > 1 || v.y < -1 || v.y > 1) continue;
      const p = info[id];
      const c = this._tagCenter || (this._tagCenter = new THREE.Vector3());
      c.copy(ship.position).project(this.camera);
      const box = { x: (c.x * 0.5 + 0.5) * w, y: (-c.y * 0.5 + 0.5) * h, size: Math.max(18, Math.min(72, 2600 / dist)) };
      list.push({
        id, x: (v.x * 0.5 + 0.5) * w, y: (-v.y * 0.5 + 0.5) * h, box, locked: this.lockedId === id,
        name: p?.username || 'Pilot', dist: dist * 3, dy: (ship.position.y - me.position.y) * 3,
        team: p?.team || 'red', isBot: !!p?.isBot, sameTeam: p?.team === this.localPlayer.team,
      });
    }
    this.instruments.updateTags(list);
  }

  animate() {
    requestAnimationFrame(this.animate.bind(this));
    // Clamp delta so a backgrounded tab doesn't teleport the plane on return
    const delta = Math.min(this.clock.getDelta(), 0.1);
    this.animationTime += delta;

    // Global systems (always update)
    this.updateWeather(delta);
    this.updateSmokeParticles(delta);
    this.updateCaptureWindmills(delta);
    this.updateAmbient(delta);
    this.updateTimer();
    this.updateCountdown();

    // Takeoff sequence
    if (this.takeoffPhase) {
      this.updateTakeoff(delta);
    }

    if (!this.localPlayer) this.updateIntroCamera();

    if (this.localPlayer) {
      this.updatePlayer(delta);

      const playerShip = this.players.get(this.localPlayer.id);
      this.updatePowerups(delta, playerShip);
      this.updateRadar(playerShip);
      const teamOf = {};
      if (this.gameState?.players) for (const p of this.gameState.players) teamOf[p.id] = p.team;
      const myPrefix = this.localPlayer.id + '_';
      this.projectiles.forEach((projectile, id) => {
        if (projectile.velocity) {
          const prev = this._prevProj || (this._prevProj = new THREE.Vector3());
          prev.copy(projectile.position);
          projectile.position.add(projectile.velocity.clone().multiplyScalar(delta));
          // My bullets hit whatever they visibly pass through
          if (id.startsWith(myPrefix) && this.registerLocalHit(id, projectile, prev, teamOf)) return;
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
        // Glide toward the latest network position/rotation so remote
        // planes (bots update at 10Hz) move smoothly between packets
        if (ship.userData.netPos) {
          const t = 1 - Math.exp(-10 * delta);
          const np = ship.userData.netPos;
          ship.position.x += (np.x - ship.position.x) * t;
          ship.position.y += ((np.y || GAME_CONFIG.FLIGHT_HEIGHT) - ship.position.y) * t;
          ship.position.z += (np.z - ship.position.z) * t;
          const nr = ship.userData.netRot;
          if (nr) {
            ship.rotation.x += (nr.x - ship.rotation.x) * t;
            let dy = nr.y - ship.rotation.y;
            dy = Math.atan2(Math.sin(dy), Math.cos(dy));
            ship.rotation.y += dy * t;
            ship.rotation.z += (nr.z - ship.rotation.z) * t;
          }
        }
        if (ship.userData.leftAB) {
          const s = 0.8 + Math.sin(this.animationTime * 15 + id.length) * 0.3;
          ship.userData.leftAB.scale.setScalar(s);
          ship.userData.rightAB.scale.setScalar(s);
        }
        if (ship.userData.navLights) {
          const b = 0.8 + Math.sin(this.animationTime * 5 + id.length * 0.5) * 0.7;
          ship.userData.navLights.forEach(light => { light.material.emissiveIntensity = b; });
        }
        // Update contrail for other players (skip while shot down/hidden)
        if (ship.visible) this.updateTrail(id, ship.position);
      }
    });

    this.updateNameTags();
    this.updateEdgeMarkers();
    this.updateEnvironment(delta);

    if (this.postfx) this.postfx.render();
    else this.renderer.render(this.scene, this.camera);

    if (this.captureRequested) {
      this.captureRequested = false;
      if (Instruments.saveScreenshot(this.renderer.domElement)) {
        this.instruments.toast('📷', 'Screenshot saved', 'Check your downloads folder');
      }
    }
    if (this.instruments) this.instruments.tickFps(delta);
  }
}

new Game();
