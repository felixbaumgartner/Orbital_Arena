// Dutch Village Flight: the Game class. Its systems live in ./game/*.js as
// method groups that are mixed into the prototype below.
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { TextureFactory } from './scenery/textures.js';
import { SkySystem } from './scenery/sky.js';
import { CloudSystem } from './scenery/clouds.js';
import { PostFX } from './postfx.js';
import { Instruments } from './ui/instruments.js';
import { TouchControls } from './ui/touch.js';
import { createSharedMaterials, createHorizonRing } from './scenery/props.js';
import { Chatter } from './ui/chatter.js';
import { GAME_CONFIG } from './config.js';
import { FX } from './fx/effects';
import { Wreckage } from './fx/wreckage';
import { TerrainMethods } from './game/terrain.js';
import { EffectsMethods } from './game/effects.js';
import { WeatherMethods } from './game/weather.js';
import { WindmillMethods } from './game/windmills.js';
import { AirfieldMethods } from './game/airfield.js';
import { ShipMethods } from './game/ships.js';
import { NetworkMethods } from './game/network.js';
import { AudioMethods } from './game/audio.js';
import { HudMethods } from './game/hud.js';
import { InputMethods } from './game/input.js';
import { FlightMethods } from './game/flight.js';
import { GuidanceMethods } from './game/guidance.js';
import { ProgressionMethods } from './game/progression.js';
import { MarkerMethods } from './game/markers.js';

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
    this.pendingPlane = 'scout';
    this.planeClass = 'scout';
    this.cosmetics = { paint: 'classic', trail: 'white', stork: false };
    this.stork = null;

    // Blender-built models (glTF), loaded at start; primitives are the fallback
    this.models = {};
    this.modelsReady = false;

    // Story: radio chatter, lore already told
    this.chatter = null;
    this.millLoreSeen = new Set();
    this.nightTold = false;
    this.planeStats = { maxHealth: 100, damage: 22, captureWeight: 1, speed: 1.05, turn: 1, vision: 1.6 };
    this.round = 1;
    this.roundWins = { red: 0, blue: 0 };
    this.suddenDeath = false;

    // Energy flight model
    this.airspeed = GAME_CONFIG.MOVEMENT_SPEED;
    this.stalled = false;
    this.stallBeep = 0;
    this.stealthy = false;
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
    this.timeScale = 1;          // world speed (slow motion < 1)

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
    this.loadModels();

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

    // Pooled particles (explosions, smoke, sparks) and breaking-apart wrecks
    this.fx = new FX(this.scene);
    this.wreckage = new Wreckage(this.scene, this.fx);
    this.wreckage.onImpact = (at, kind) => this.onWreckImpact(at, kind);

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
    this.chatter = new Chatter((n) => this.playSound(n));

    this.setupUI();
    this.animate();

    // Build stamp (settings footer + console) so we can tell what's running
    try {
      const stamp = typeof __BUILD__ !== 'undefined' ? __BUILD__ : 'dev';
      console.info('Dutch Village Flight build', stamp);
      const el = document.getElementById('build-stamp');
      if (el) el.textContent = `Build ${stamp}`;
    } catch (e) { /* ignore */ }
  }

  /**
   * Loads the aircraft and windmill built in Blender. Each file is small;
   * anything created before it arrives falls back to the primitive builders.
   */
  loadModels() {
    const loader = new GLTFLoader();
    const files = {
      interceptor: 'assets/models/plane_interceptor.glb',
      bomber: 'assets/models/plane_bomber.glb',
      scout: 'assets/models/plane_scout.glb',
      windmill: 'assets/models/windmill.glb',
    };
    let pending = Object.keys(files).length;
    for (const [key, url] of Object.entries(files)) {
      loader.load(url, (gltf) => {
        const root = gltf.scene;
        root.traverse((c) => {
          if (!c.isMesh) return;
          c.castShadow = true;
          c.receiveShadow = true;
          if (c.material && c.material.name === 'Glass') {
            c.material.transparent = true;
            c.material.opacity = 0.55;
            c.material.depthWrite = false;
          }
        });
        this.models[key] = root;
        if (--pending === 0) {
          this.modelsReady = true;
          this.refreshWindmillModels();
        }
      }, undefined, (err) => {
        console.warn('Model failed to load, using primitives:', url, err);
        if (--pending === 0) this.modelsReady = true;
      });
    }
  }

  /** Deep clone with per-instance materials so colours can differ per plane */
  cloneModel(key) {
    const src = this.models[key];
    if (!src) return null;
    const clone = src.clone(true);
    clone.traverse((c) => {
      if (c.isMesh && c.material) c.material = c.material.clone();
    });
    return clone;
  }

  onSettingsChange(key, value, settings) {
    this.applySettings(settings);
    if (key.startsWith('vol') || key === 'music') this.applyAudioSettings(settings);
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
    if (this.fx) this.fx.setQuality(settings.quality);
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
      const planeInput = document.querySelector('input[name="plane"]:checked');
      this.pendingPlane = planeInput ? planeInput.value : 'scout';
      this.cosmetics = this.readHangar();
      try {
        localStorage.setItem('dvf.name', username);
        localStorage.setItem('dvf.mode', this.pendingMode);
        localStorage.setItem('dvf.plane', this.pendingPlane);
      } catch (e) { /* ignore */ }
      this.connectToServer(username);
      loginScreen.style.display = 'none';
      hud.style.display = 'block';
    };
    startButton.addEventListener('click', start);
    // Browsers only allow sound after a gesture: the first click or key on
    // the login screen starts the engine and the menu music
    const firstGesture = () => this.initAudio();
    document.addEventListener('pointerdown', firstGesture, { once: true });
    document.addEventListener('keydown', firstGesture, { once: true });

    // Remember the pilot; "Fly Again" skips the login screen entirely
    try {
      const saved = localStorage.getItem('dvf.name');
      if (saved) usernameInput.value = saved;
      const savedMode = localStorage.getItem('dvf.mode');
      const modeRadio = document.querySelector(`input[name="mode"][value="${savedMode === 'tdm' ? 'tdm' : 'domination'}"]`);
      if (modeRadio) modeRadio.checked = true;
      const savedPlane = localStorage.getItem('dvf.plane');
      const planeRadio = savedPlane && document.querySelector(`input[name="plane"][value="${savedPlane}"]`);
      if (planeRadio) planeRadio.checked = true;
      const rankEl = document.getElementById('login-rank');
      if (rankEl) {
        const xp = this.totalXp();
        rankEl.textContent = `Lv ${this.levelFor(xp)} · ${this.rankFor(xp)} · ${xp.toLocaleString()} XP`;
      }
      this.setupHangar();
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


  animate() {
    requestAnimationFrame(this.animate.bind(this));
    // Clamp delta so a backgrounded tab doesn't teleport the plane on return
    // timeScale < 1 is slow motion (kill cam, final kill); realDelta keeps UI timing honest
    const realDelta = Math.min(this.clock.getDelta(), 0.1);
    const delta = realDelta * this.timeScale;
    this.realDelta = realDelta;
    this.animationTime += delta;

    // Global systems (always update)
    this.updateWeather(delta);
    this.updateSmokeParticles(delta);
    this.updateRemoteDamageSmoke(delta);
    this.updateCaptureWindmills(delta);
    this.updateAmbient(delta);
    this.updateTimer();
    this.updateConnection();
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
        if (ship.userData.netPos && !this.replay) {
          const t = 1 - Math.exp(-10 * delta);
          const np = ship.userData.netPos;
          // Dead reckoning: aim where the plane is now, not where the last
          // packet said it was (capped so a stalled link doesn't fly it away)
          const v = ship.userData.vel;
          const ahead = v ? Math.min(0.25, (performance.now() - (ship.userData.netTime || 0)) / 1000) : 0;
          const tx = np.x + (v ? v.x * ahead : 0);
          const ty = (np.y || GAME_CONFIG.FLIGHT_HEIGHT) + (v ? v.y * ahead : 0);
          const tz = np.z + (v ? v.z * ahead : 0);
          ship.position.x += (tx - ship.position.x) * t;
          ship.position.y += (ty - ship.position.y) * t;
          ship.position.z += (tz - ship.position.z) * t;
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
        if (ship.userData.props) {
          for (const p of ship.userData.props) p.rotation.z += 30 * delta;
        }
        // Update contrail for other players (skip while shot down/hidden)
        if (ship.visible) this.updateTrail(id, ship.position);
      }
    });

    this.updateNameTags();
    this.updateEdgeMarkers();
    this.updateStork(delta);
    this.updateEnvironment(delta);

    this.updateAudio(this.realDelta);

    if (this.postfx) this.postfx.render();
    else this.renderer.render(this.scene, this.camera);

    if (this.captureRequested) {
      this.captureRequested = false;
      if (Instruments.saveScreenshot(this.renderer.domElement)) {
        this.instruments.toast('📷', 'Screenshot saved', 'Check your downloads folder');
      }
    }
    if (this.instruments) this.instruments.tickFps(delta);
    this.watchFrameRate(delta);
  }

  /** If the game runs slowly for a while, suggest a lower quality once */
  watchFrameRate(delta) {
    if (!this.localPlayer || this.fpsAdvised) return;
    this.fpsWindow = (this.fpsWindow || 0) + delta;
    this.fpsFrames = (this.fpsFrames || 0) + 1;
    if (this.fpsWindow < 8) return;
    const fps = this.fpsFrames / this.fpsWindow;
    this.fpsWindow = 0; this.fpsFrames = 0;
    const q = this.instruments.settings.quality;
    if (fps < 30 && (q === 'high' || q === 'ultra' || q === 'medium')) {
      this.fpsAdvised = true;
      this.instruments.toast('🐢', `Running at ${Math.round(fps)} FPS`, 'Press Esc and lower Graphics quality for smoother flying');
    }
  }
}

// Mix every method group into Game (own methods win on name clashes)
for (const mixin of [TerrainMethods, EffectsMethods, WeatherMethods, WindmillMethods, AirfieldMethods, ShipMethods, NetworkMethods, AudioMethods, HudMethods, InputMethods, FlightMethods, GuidanceMethods, ProgressionMethods, MarkerMethods]) {
  for (const name of Object.getOwnPropertyNames(mixin.prototype)) {
    if (name === 'constructor' || Object.prototype.hasOwnProperty.call(Game.prototype, name)) continue;
    Object.defineProperty(Game.prototype, name, Object.getOwnPropertyDescriptor(mixin.prototype, name));
  }
}

export { Game };
