import * as THREE from 'three';
import { io } from 'socket.io-client';

// Game constants
const GAME_CONFIG = {
  CAMERA_FOV: 75,
  CAMERA_NEAR: 0.1,
  CAMERA_FAR: 1000,
  CAMERA_DISTANCE: 20,
  CAMERA_HEIGHT: 10,

  ARENA_SIZE: 200,
  ARENA_BOUNDS_MIN: -95,
  ARENA_BOUNDS_MAX: 95,
  PROJECTILE_BOUNDS: 100,

  MOVEMENT_SPEED: 50,
  BOOST_SPEED: 100,
  ENERGY_DRAIN_RATE: 20, // Energy per second when boosting
  ENERGY_REGEN_RATE: 10, // Energy per second when not boosting

  FLOOR_COLOR: 0x333333,
  OBSTACLE_COLOR: 0x666666,
  WALL_COLOR: 0x444444,
  TEAM_RED_COLOR: 0xff0000,
  TEAM_BLUE_COLOR: 0x0000ff,
  PROJECTILE_COLOR: 0x00ff00,

  USERNAME_MAX_LENGTH: 15,
  USERNAME_MIN_LENGTH: 1,
  CHAT_MESSAGE_MAX_LENGTH: 200,

  RECONNECT_ATTEMPTS: 5,
  RECONNECT_DELAY: 1000,
};

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
    this.shipRotation = 0; // Track ship rotation angle

    this.init();
  }

  init() {
    // Setup renderer
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    this.renderer.setPixelRatio(window.devicePixelRatio);
    document.getElementById('game-container').appendChild(this.renderer.domElement);

    // Setup camera - higher for aerial view
    this.camera.position.set(0, 50, 40);
    this.camera.lookAt(0, 0, 0);

    // Add sky background - clear June sky
    this.scene.background = new THREE.Color(0x87CEEB); // Sky blue

    // Add bright ambient light for sunny day
    const ambientLight = new THREE.AmbientLight(0xffffff, 0.7);
    this.scene.add(ambientLight);

    // Add sun (directional light)
    const sunLight = new THREE.DirectionalLight(0xffeb99, 1.2);
    sunLight.position.set(50, 100, 50);
    this.scene.add(sunLight);

    // Add Dutch village
    this.createDutchVillage();

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

      // Validate username
      if (!this.isValidUsername(username)) {
        alert(`Username must be between ${GAME_CONFIG.USERNAME_MIN_LENGTH} and ${GAME_CONFIG.USERNAME_MAX_LENGTH} characters and contain only letters, numbers, and spaces.`);
        return;
      }

      this.connectToServer(username);
      loginScreen.style.display = 'none';
      hud.style.display = 'block';

      // Show tutorial for first-time players
      if (!localStorage.getItem('tutorialSeen')) {
        tutorial.style.display = 'block';
        localStorage.setItem('tutorialSeen', 'true');
      }
    });

    // Allow Enter key to start game
    usernameInput.addEventListener('keypress', (e) => {
      if (e.key === 'Enter') {
        startButton.click();
      }
    });

    tutorialClose.addEventListener('click', () => {
      tutorial.style.display = 'none';
    });

    // Allow closing tutorial with keyboard (ESC or Enter)
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
    // Allow only alphanumeric characters and spaces
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

  /**
   * Creates a Dutch village scene with green fields and buildings
   */
  createDutchVillage() {
    // Create green grass field
    const grassGeometry = new THREE.PlaneGeometry(GAME_CONFIG.ARENA_SIZE, GAME_CONFIG.ARENA_SIZE);
    const grassMaterial = new THREE.MeshStandardMaterial({
      color: 0x4CAF50, // Lush green grass
      roughness: 0.9,
    });
    const grass = new THREE.Mesh(grassGeometry, grassMaterial);
    grass.rotation.x = -Math.PI / 2;
    grass.receiveShadow = true;
    this.scene.add(grass);

    // Add Dutch buildings
    this.createDutchBuildings();

    // Add trees
    this.createTrees();

    // Add clouds
    this.createClouds();
  }

  /**
   * Creates Dutch-style buildings in the village
   */
  createDutchBuildings() {
    const buildings = [
      { x: -40, z: -30, width: 15, height: 12, depth: 12, color: 0xD2691E }, // Brown house
      { x: 40, z: 30, width: 18, height: 15, depth: 15, color: 0xCD853F }, // Tan house
      { x: -30, z: 40, width: 12, height: 10, depth: 10, color: 0xBC8F8F }, // Rosy brown
      { x: 35, z: -35, width: 20, height: 18, depth: 14, color: 0xA0522D }, // Sienna
      { x: 0, z: -50, width: 25, height: 20, depth: 18, color: 0x8B4513 }, // Saddle brown (church)
    ];

    buildings.forEach(building => {
      // Create building body
      const wallGeometry = new THREE.BoxGeometry(building.width, building.height, building.depth);
      const wallMaterial = new THREE.MeshStandardMaterial({
        color: building.color,
        roughness: 0.8,
      });
      const walls = new THREE.Mesh(wallGeometry, wallMaterial);
      walls.position.set(building.x, building.height / 2, building.z);
      this.scene.add(walls);

      // Create red-tiled roof
      const roofGeometry = new THREE.ConeGeometry(building.width * 0.8, building.height * 0.4, 4);
      const roofMaterial = new THREE.MeshStandardMaterial({
        color: 0xB22222, // Firebrick red (Dutch tile roofs)
        roughness: 0.7,
      });
      const roof = new THREE.Mesh(roofGeometry, roofMaterial);
      roof.position.set(building.x, building.height + building.height * 0.2, building.z);
      roof.rotation.y = Math.PI / 4;
      this.scene.add(roof);
    });
  }

  /**
   * Creates trees around the village
   */
  createTrees() {
    const treePositions = [
      { x: -60, z: 10 }, { x: -55, z: -15 }, { x: 60, z: -10 },
      { x: 55, z: 20 }, { x: -10, z: 60 }, { x: 15, z: -60 },
      { x: -70, z: 45 }, { x: 70, z: -45 }, { x: 25, z: 55 },
    ];

    treePositions.forEach(pos => {
      // Tree trunk
      const trunkGeometry = new THREE.CylinderGeometry(1, 1.5, 8);
      const trunkMaterial = new THREE.MeshStandardMaterial({ color: 0x8B4513 });
      const trunk = new THREE.Mesh(trunkGeometry, trunkMaterial);
      trunk.position.set(pos.x, 4, pos.z);
      this.scene.add(trunk);

      // Tree foliage (green, it's June!)
      const foliageGeometry = new THREE.SphereGeometry(6, 8, 8);
      const foliageMaterial = new THREE.MeshStandardMaterial({
        color: 0x228B22, // Forest green
        roughness: 0.9,
      });
      const foliage = new THREE.Mesh(foliageGeometry, foliageMaterial);
      foliage.position.set(pos.x, 12, pos.z);
      this.scene.add(foliage);
    });
  }

  /**
   * Creates white fluffy clouds in the sky
   */
  createClouds() {
    const cloudPositions = [
      { x: -80, y: 60, z: -80 }, { x: 60, y: 70, z: -60 },
      { x: -50, y: 65, z: 70 }, { x: 80, y: 75, z: 50 },
    ];

    cloudPositions.forEach(pos => {
      // Create cloud from multiple spheres
      const cloudGroup = new THREE.Group();

      for (let i = 0; i < 5; i++) {
        const cloudGeometry = new THREE.SphereGeometry(8 + Math.random() * 4, 8, 8);
        const cloudMaterial = new THREE.MeshStandardMaterial({
          color: 0xFFFFFF,
          transparent: true,
          opacity: 0.8,
          roughness: 1,
        });
        const cloudPart = new THREE.Mesh(cloudGeometry, cloudMaterial);
        cloudPart.position.set(
          (Math.random() - 0.5) * 15,
          (Math.random() - 0.5) * 5,
          (Math.random() - 0.5) * 15
        );
        cloudGroup.add(cloudPart);
      }

      cloudGroup.position.set(pos.x, pos.y, pos.z);
      this.scene.add(cloudGroup);
    });
  }

  /**
   * Creates a 3D plane model for a player
   * @param {number} color - Hex color code for the plane
   */
  createPlayerShip(color) {
    const planeGroup = new THREE.Group();

    // Fuselage (main body)
    const fuselageGeometry = new THREE.CylinderGeometry(0.8, 1, 8, 8);
    const fuselageMaterial = new THREE.MeshStandardMaterial({ color });
    const fuselage = new THREE.Mesh(fuselageGeometry, fuselageMaterial);
    fuselage.rotation.x = Math.PI / 2;
    planeGroup.add(fuselage);

    // Nose cone
    const noseGeometry = new THREE.ConeGeometry(0.8, 2, 8);
    const nose = new THREE.Mesh(noseGeometry, fuselageMaterial);
    nose.rotation.x = Math.PI / 2;
    nose.position.set(0, 0, -5);
    planeGroup.add(nose);

    // Main wings
    const wingGeometry = new THREE.BoxGeometry(16, 0.3, 4);
    const wingMaterial = new THREE.MeshStandardMaterial({ color });
    const wings = new THREE.Mesh(wingGeometry, wingMaterial);
    wings.position.set(0, 0, 1);
    planeGroup.add(wings);

    // Tail wings
    const tailWingGeometry = new THREE.BoxGeometry(6, 0.3, 2);
    const tailWings = new THREE.Mesh(tailWingGeometry, wingMaterial);
    tailWings.position.set(0, 0, 4);
    planeGroup.add(tailWings);

    // Vertical stabilizer (tail fin)
    const stabilizerGeometry = new THREE.BoxGeometry(0.3, 3, 2);
    const stabilizer = new THREE.Mesh(stabilizerGeometry, wingMaterial);
    stabilizer.position.set(0, 1.5, 4);
    planeGroup.add(stabilizer);

    // Propeller
    const propellerGeometry = new THREE.BoxGeometry(6, 0.2, 0.5);
    const propellerMaterial = new THREE.MeshStandardMaterial({ color: 0x333333 });
    const propeller = new THREE.Mesh(propellerGeometry, propellerMaterial);
    propeller.position.set(0, 0, -6);
    planeGroup.add(propeller);

    // Add rotation animation data for propeller
    planeGroup.userData.propeller = propeller;

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

  /**
   * Connects to the game server with error handling and reconnection logic
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
          // Server disconnected us, attempt manual reconnection
          this.socket.connect();
        }
      });

      this.socket.on('gameJoined', (data) => {
        this.gameState = data.gameState;
        this.localPlayer = data.player;

        // Create local player ship
        const teamColor = data.player.team === 'red' ? GAME_CONFIG.TEAM_RED_COLOR : GAME_CONFIG.TEAM_BLUE_COLOR;
        const ship = this.createPlayerShip(teamColor);
        ship.position.copy(this.localPlayer.position);
        this.scene.add(ship);
        this.players.set(this.localPlayer.id, ship);

        // Create other players' ships
        if (data.gameState.players) {
          data.gameState.players.forEach(player => {
            if (player.id !== this.localPlayer.id) {
              const otherTeamColor = player.team === 'red' ? GAME_CONFIG.TEAM_RED_COLOR : GAME_CONFIG.TEAM_BLUE_COLOR;
              const otherShip = this.createPlayerShip(otherTeamColor);
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
          const teamColor = player.team === 'red' ? GAME_CONFIG.TEAM_RED_COLOR : GAME_CONFIG.TEAM_BLUE_COLOR;
          const ship = this.createPlayerShip(teamColor);
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

  /**
   * Displays a chat message in the chat box
   * @param {string} username - Username of the sender
   * @param {string} message - Chat message content
   */
  displayChatMessage(username, message) {
    const chatMessages = document.getElementById('chat-messages');
    if (!chatMessages) return;

    const messageElement = document.createElement('div');
    messageElement.className = 'chat-message';
    messageElement.innerHTML = `<strong>${this.sanitizeInput(username)}:</strong> ${this.sanitizeInput(message)}`;

    chatMessages.appendChild(messageElement);
    chatMessages.scrollTop = chatMessages.scrollHeight;

    // Remove old messages to prevent memory leaks
    while (chatMessages.children.length > 50) {
      chatMessages.removeChild(chatMessages.firstChild);
    }
  }

  /**
   * Updates the health bar UI
   * @param {number} damage - Amount of damage taken
   */
  updateHealth(damage) {
    const healthFill = document.querySelector('.health-fill');
    if (!healthFill) return;

    const currentWidth = parseFloat(healthFill.style.width) || 100;
    const newWidth = Math.max(0, currentWidth - damage);
    healthFill.style.width = `${newWidth}%`;
  }

  /**
   * Updates the energy bar UI
   * @param {number} energyPercent - Energy level as percentage (0-100)
   */
  updateEnergyBar(energyPercent) {
    const energyFill = document.querySelector('.energy-fill');
    if (!energyFill) return;

    const clampedEnergy = Math.max(0, Math.min(100, energyPercent));
    energyFill.style.width = `${clampedEnergy}%`;

    // Change color based on energy level
    if (clampedEnergy < 20) {
      energyFill.style.backgroundColor = '#ff4444';
    } else if (clampedEnergy < 50) {
      energyFill.style.backgroundColor = '#ffaa00';
    } else {
      energyFill.style.backgroundColor = '#00aaff';
    }
  }

  /**
   * Updates the HUD with current game state
   */
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

  /**
   * Shows game end screen with winner announcement
   */
  showGameEnd() {
    if (!this.gameState || !this.gameState.scores) return;

    const winner = this.gameState.scores.red > this.gameState.scores.blue ? 'Red' : 'Blue';
    alert(`Game Over! ${winner} team wins!\nFinal Score: Red ${this.gameState.scores.red} - Blue ${this.gameState.scores.blue}`);
    window.location.reload();
  }

  onWindowResize() {
    this.camera.aspect = window.innerWidth / window.innerHeight;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(window.innerWidth, window.innerHeight);
  }

  /**
   * Handles keyboard key press events
   */
  onKeyDown(event) {
    switch (event.key.toLowerCase()) {
      case 'w': this.controls.forward = true; break;
      case 's': this.controls.backward = true; break;
      case 'a': this.controls.left = true; break;
      case 'd': this.controls.right = true; break;
      case 'shift': this.controls.boost = true; break;
      case ' ':
        this.controls.shooting = true;
        event.preventDefault(); // Prevent page scroll
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

  /**
   * Handles keyboard key release events
   */
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


  /**
   * Updates local player position, rotation, energy, and camera
   * @param {number} delta - Time elapsed since last frame
   */
  updatePlayer(delta) {
    if (!this.localPlayer || !this.players.has(this.localPlayer.id)) return;

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
      // Regenerate energy when not boosting
      this.localPlayer.energy = Math.min(100, this.localPlayer.energy + (GAME_CONFIG.ENERGY_REGEN_RATE * delta));
    }

    // Update energy bar
    this.updateEnergyBar(this.localPlayer.energy);

    // Handle rotation (Q/E or Arrow keys)
    const rotationSpeed = 3; // radians per second
    if (this.controls.rotateLeft) {
      this.shipRotation += rotationSpeed * delta;
    }
    if (this.controls.rotateRight) {
      this.shipRotation -= rotationSpeed * delta;
    }

    // Apply rotation to ship
    ship.rotation.y = this.shipRotation;

    // Calculate movement in the direction the ship is facing
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

    // Keep player within bounds
    ship.position.x = Math.max(GAME_CONFIG.ARENA_BOUNDS_MIN, Math.min(GAME_CONFIG.ARENA_BOUNDS_MAX, ship.position.x));
    ship.position.z = Math.max(GAME_CONFIG.ARENA_BOUNDS_MIN, Math.min(GAME_CONFIG.ARENA_BOUNDS_MAX, ship.position.z));

    // Update server if connected
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

    // Animate propeller
    if (ship.userData.propeller) {
      ship.userData.propeller.rotation.z += 0.5; // Spinning propeller
    }

    // Update camera to follow player from above and behind
    this.camera.position.x = ship.position.x;
    this.camera.position.y = ship.position.y + 40; // Higher for aerial view
    this.camera.position.z = ship.position.z + 35;
    this.camera.lookAt(ship.position);
  }

  /**
   * Main game loop - updates game state and renders scene
   */
  animate() {
    requestAnimationFrame(this.animate.bind(this));

    const delta = this.clock.getDelta();

    if (this.localPlayer) {
      this.updatePlayer(delta);

      // Update projectiles
      this.projectiles.forEach((projectile, id) => {
        if (projectile.velocity) {
          projectile.position.add(projectile.velocity.clone().multiplyScalar(delta));

          // Remove projectiles that are out of bounds
          if (
            Math.abs(projectile.position.x) > GAME_CONFIG.PROJECTILE_BOUNDS ||
            Math.abs(projectile.position.z) > GAME_CONFIG.PROJECTILE_BOUNDS
          ) {
            this.scene.remove(projectile);
            this.projectiles.delete(id);
          }
        }
      });
    }

    this.renderer.render(this.scene, this.camera);
  }
}

// Start the game
new Game(); 