import * as THREE from 'three';
import { io } from 'socket.io-client';

class Game {
  constructor() {
    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 1000);
    this.renderer = new THREE.WebGLRenderer({ antialias: true });
    this.clock = new THREE.Clock();
    this.players = new Map();
    this.projectiles = new Map();
    this.gameState = null;
    this.localPlayer = null;
    this.socket = null;
    this.controls = {
      forward: false,
      backward: false,
      left: false,
      right: false,
      boost: false,
      shooting: false,
    };

    this.init();
  }

  init() {
    // Setup renderer
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    this.renderer.setPixelRatio(window.devicePixelRatio);
    document.getElementById('game-container').appendChild(this.renderer.domElement);

    // Setup camera
    this.camera.position.set(0, 10, 20);
    this.camera.lookAt(0, 0, 0);

    // Add ambient light
    const ambientLight = new THREE.AmbientLight(0x404040);
    this.scene.add(ambientLight);

    // Add directional light
    const directionalLight = new THREE.DirectionalLight(0xffffff, 1);
    directionalLight.position.set(1, 1, 1);
    this.scene.add(directionalLight);

    // Add arena
    this.createArena();

    // Setup event listeners
    window.addEventListener('resize', this.onWindowResize.bind(this));
    document.addEventListener('keydown', this.onKeyDown.bind(this));
    document.addEventListener('keyup', this.onKeyUp.bind(this));
    document.addEventListener('mousemove', this.onMouseMove.bind(this));
    document.addEventListener('mousedown', this.onMouseDown.bind(this));
    document.addEventListener('mouseup', this.onMouseUp.bind(this));

    // Setup UI
    this.setupUI();

    // Start animation loop
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
      const username = usernameInput.value.trim();
      if (username) {
        this.connectToServer(username);
        loginScreen.style.display = 'none';
        hud.style.display = 'block';
        
        // Show tutorial for first-time players
        if (!localStorage.getItem('tutorialSeen')) {
          tutorial.style.display = 'block';
          localStorage.setItem('tutorialSeen', 'true');
        }
      }
    });

    tutorialClose.addEventListener('click', () => {
      tutorial.style.display = 'none';
    });

    chatInput.addEventListener('keypress', (e) => {
      if (e.key === 'Enter' && chatInput.value.trim()) {
        this.sendChatMessage(chatInput.value.trim());
        chatInput.value = '';
      }
    });
  }

  createArena() {
    // Create arena floor
    const floorGeometry = new THREE.PlaneGeometry(200, 200);
    const floorMaterial = new THREE.MeshStandardMaterial({
      color: 0x333333,
      metalness: 0.5,
      roughness: 0.5,
    });
    const floor = new THREE.Mesh(floorGeometry, floorMaterial);
    floor.rotation.x = -Math.PI / 2;
    this.scene.add(floor);

    // Add obstacles
    this.createObstacles();

    // Add boundary walls
    this.createBoundaryWalls();
  }

  createObstacles() {
    const obstacleGeometry = new THREE.BoxGeometry(10, 20, 10);
    const obstacleMaterial = new THREE.MeshStandardMaterial({
      color: 0x666666,
      metalness: 0.7,
      roughness: 0.3,
    });

    const obstacles = [
      { x: -30, z: -20 },
      { x: 30, z: 20 },
      { x: -20, z: 30 },
      { x: 20, z: -30 },
    ];

    obstacles.forEach(pos => {
      const obstacle = new THREE.Mesh(obstacleGeometry, obstacleMaterial);
      obstacle.position.set(pos.x, 10, pos.z);
      this.scene.add(obstacle);
    });
  }

  createBoundaryWalls() {
    const wallGeometry = new THREE.BoxGeometry(200, 40, 2);
    const wallMaterial = new THREE.MeshStandardMaterial({
      color: 0x444444,
      metalness: 0.6,
      roughness: 0.4,
      transparent: true,
      opacity: 0.5,
    });

    // North wall
    const northWall = new THREE.Mesh(wallGeometry, wallMaterial);
    northWall.position.set(0, 20, -100);
    this.scene.add(northWall);

    // South wall
    const southWall = new THREE.Mesh(wallGeometry, wallMaterial);
    southWall.position.set(0, 20, 100);
    this.scene.add(southWall);

    // East wall
    const eastWall = new THREE.Mesh(wallGeometry, wallMaterial);
    eastWall.rotation.y = Math.PI / 2;
    eastWall.position.set(100, 20, 0);
    this.scene.add(eastWall);

    // West wall
    const westWall = new THREE.Mesh(wallGeometry, wallMaterial);
    westWall.rotation.y = Math.PI / 2;
    westWall.position.set(-100, 20, 0);
    this.scene.add(westWall);
  }

  createPlayerShip(color) {
    const shipGeometry = new THREE.Group();

    // Ship body
    const bodyGeometry = new THREE.ConeGeometry(2, 8, 8);
    const bodyMaterial = new THREE.MeshStandardMaterial({ color });
    const body = new THREE.Mesh(bodyGeometry, bodyMaterial);
    body.rotation.x = Math.PI / 2;
    shipGeometry.add(body);

    // Ship wings
    const wingGeometry = new THREE.BoxGeometry(8, 0.5, 3);
    const wingMaterial = new THREE.MeshStandardMaterial({ color });
    const leftWing = new THREE.Mesh(wingGeometry, wingMaterial);
    leftWing.position.set(-2, 0, -1);
    shipGeometry.add(leftWing);

    const rightWing = new THREE.Mesh(wingGeometry, wingMaterial);
    rightWing.position.set(2, 0, -1);
    shipGeometry.add(rightWing);

    return shipGeometry;
  }

  createProjectile() {
    const geometry = new THREE.SphereGeometry(0.5);
    const material = new THREE.MeshStandardMaterial({
      color: 0x00ff00,
      emissive: 0x00ff00,
      emissiveIntensity: 0.5,
    });
    return new THREE.Mesh(geometry, material);
  }

  connectToServer(username) {
    this.socket = io();

    this.socket.on('connect', () => {
      console.log('Connected to server');
      this.socket.emit('join', username);
    });

    this.socket.on('gameJoined', (data) => {
      this.gameState = data.gameState;
      this.localPlayer = data.player;
      
      // Create local player ship
      const ship = this.createPlayerShip(data.team === 'red' ? 0xff0000 : 0x0000ff);
      ship.position.copy(this.localPlayer.position);
      this.scene.add(ship);
      this.players.set(this.localPlayer.id, ship);

      // Create other players' ships
      data.gameState.players.forEach(player => {
        if (player.id !== this.localPlayer.id) {
          const otherShip = this.createPlayerShip(player.team === 'red' ? 0xff0000 : 0x0000ff);
          otherShip.position.copy(player.position);
          this.scene.add(otherShip);
          this.players.set(player.id, otherShip);
        }
      });

      this.updateHUD();
    });

    this.socket.on('playerJoined', (player) => {
      const ship = this.createPlayerShip(player.team === 'red' ? 0xff0000 : 0x0000ff);
      ship.position.copy(player.position);
      this.scene.add(ship);
      this.players.set(player.id, ship);
    });

    this.socket.on('playerLeft', (playerId) => {
      const ship = this.players.get(playerId);
      if (ship) {
        this.scene.remove(ship);
        this.players.delete(playerId);
      }
    });

    this.socket.on('playerMoved', (data) => {
      const ship = this.players.get(data.id);
      if (ship) {
        ship.position.copy(data.position);
        ship.rotation.copy(data.rotation);
      }
    });

    this.socket.on('playerHit', (data) => {
      if (data.targetId === this.localPlayer.id) {
        this.updateHealth(data.damage);
      }
      this.gameState = data.gameState;
      this.updateHUD();
    });

    this.socket.on('gameStart', (gameState) => {
      this.gameState = gameState;
      this.updateHUD();
    });

    this.socket.on('gameEnd', (gameState) => {
      this.gameState = gameState;
      this.showGameEnd();
    });
  }

  updateHealth(damage) {
    const healthFill = document.querySelector('.health-fill');
    const currentWidth = parseFloat(healthFill.style.width);
    const newWidth = Math.max(0, currentWidth - damage);
    healthFill.style.width = `${newWidth}%`;
  }

  updateHUD() {
    if (!this.gameState || !this.localPlayer) return;

    document.getElementById('kills').textContent = this.localPlayer.kills;
    document.getElementById('deaths').textContent = this.localPlayer.deaths;
    document.getElementById('assists').textContent = this.localPlayer.assists;
    document.getElementById('red-score').textContent = this.gameState.scores.red;
    document.getElementById('blue-score').textContent = this.gameState.scores.blue;

    const minutes = Math.floor(this.gameState.timeRemaining / 60000);
    const seconds = Math.floor((this.gameState.timeRemaining % 60000) / 1000);
    document.getElementById('time-remaining').textContent = 
      `${minutes}:${seconds.toString().padStart(2, '0')}`;
  }

  showGameEnd() {
    const winner = this.gameState.scores.red > this.gameState.scores.blue ? 'Red' : 'Blue';
    alert(`Game Over! ${winner} team wins!`);
    window.location.reload();
  }

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
    }
  }

  onKeyUp(event) {
    switch (event.key.toLowerCase()) {
      case 'w': this.controls.forward = false; break;
      case 's': this.controls.backward = false; break;
      case 'a': this.controls.left = false; break;
      case 'd': this.controls.right = false; break;
      case 'shift': this.controls.boost = false; break;
    }
  }

  onMouseMove(event) {
    if (this.localPlayer && this.players.has(this.localPlayer.id)) {
      const ship = this.players.get(this.localPlayer.id);
      const vector = new THREE.Vector3(
        (event.clientX / window.innerWidth) * 2 - 1,
        -(event.clientY / window.innerHeight) * 2 + 1,
        0.5
      );
      vector.unproject(this.camera);
      const dir = vector.sub(this.camera.position).normalize();
      const distance = -this.camera.position.y / dir.y;
      const pos = this.camera.position.clone().add(dir.multiplyScalar(distance));
      ship.lookAt(pos);
    }
  }

  onMouseDown() {
    this.controls.shooting = true;
  }

  onMouseUp() {
    this.controls.shooting = false;
  }

  updatePlayer(delta) {
    if (!this.localPlayer || !this.players.has(this.localPlayer.id)) return;

    const ship = this.players.get(this.localPlayer.id);
    const speed = this.controls.boost ? 100 : 50;
    const movement = new THREE.Vector3();

    if (this.controls.forward) movement.z -= speed * delta;
    if (this.controls.backward) movement.z += speed * delta;
    if (this.controls.left) movement.x -= speed * delta;
    if (this.controls.right) movement.x += speed * delta;

    ship.position.add(movement);

    // Keep player within bounds
    ship.position.x = Math.max(-95, Math.min(95, ship.position.x));
    ship.position.z = Math.max(-95, Math.min(95, ship.position.z));

    // Update server
    this.socket.emit('position', {
      gameId: this.gameState.id,
      position: ship.position,
      rotation: ship.rotation,
    });

    // Update camera
    this.camera.position.x = ship.position.x;
    this.camera.position.z = ship.position.z + 20;
    this.camera.lookAt(ship.position);
  }

  animate() {
    requestAnimationFrame(this.animate.bind(this));

    const delta = this.clock.getDelta();

    if (this.localPlayer) {
      this.updatePlayer(delta);
      
      // Update projectiles
      this.projectiles.forEach((projectile, id) => {
        projectile.position.add(projectile.velocity.multiplyScalar(delta));
        
        // Remove projectiles that are out of bounds
        if (
          Math.abs(projectile.position.x) > 100 ||
          Math.abs(projectile.position.z) > 100
        ) {
          this.scene.remove(projectile);
          this.projectiles.delete(id);
        }
      });
    }

    this.renderer.render(this.scene, this.camera);
  }
}

// Start the game
new Game(); 