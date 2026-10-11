// Runway and the takeoff sequence.
// Methods are mixed into the Game class (see game.js); `this` is the Game.
import * as THREE from 'three';
import { GAME_CONFIG } from '../config.js';

export class AirfieldMethods {
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
}
