// Flight model, instruments, environment, collisions and crashes.
// Methods are mixed into the Game class (see game.js); `this` is the Game.
import * as THREE from 'three';
import { GAME_CONFIG, CAPTURE_WINDMILLS } from '../config.js';

export class FlightMethods {
  // =========================================================================
  // GAME LOOP
  // =========================================================================

  updatePlayer(delta) {
    if (!this.localPlayer || !this.players.has(this.localPlayer.id)) return;
    if (this.replay) return; // a replay owns the planes and the camera
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
    if (this.padStick) {
      mouseTurn -= this.padStick.x;   // stick left = turn left
      mousePitch -= this.padStick.y;  // stick up = climb (Invert Y flips it)
    }
    if (this.touch && this.touch.active) {
      mouseTurn -= this.touch.stick.x;   // push left = turn left
      mousePitch -= this.touch.stick.y;  // push up = climb
    }
    // Deadzone: tiny mouse drift must not bank the plane
    if (Math.abs(mouseTurn) < 0.08) mouseTurn = 0;
    if (Math.abs(mousePitch) < 0.08) mousePitch = 0;
    // Keyboard has priority: while the keys steer, the mouse stick is ignored
    const keysSteering = this.controls.left || this.controls.right || this.controls.pitchUp || this.controls.pitchDown;
    if (keysSteering) { mouseTurn = 0; mousePitch = 0; this.mouseStick.turn = 0; this.mouseStick.pitch = 0; }

    if (typeof this.localPlayer.energy !== 'number') this.localPlayer.energy = 100;

    // Throttle (↑/↓ keys)
    if (this.controls.throttleUp) {
      this.throttle = Math.min(GAME_CONFIG.THROTTLE_MAX, this.throttle + GAME_CONFIG.THROTTLE_RATE * delta);
    }
    if (this.controls.throttleDown) {
      this.throttle = Math.max(GAME_CONFIG.THROTTLE_MIN, this.throttle - GAME_CONFIG.THROTTLE_RATE * delta);
    }

    // Energy model: the engine pulls toward cruise, gravity trades altitude
    // for speed, hard turns scrub it, and too little of it stalls the wing
    const planeSpeed = this.planeStats.speed || 1;
    let cruise = GAME_CONFIG.MOVEMENT_SPEED * this.throttle * planeSpeed;
    const boosting = this.controls.boost && this.localPlayer.energy > 0;
    if (boosting) {
      cruise = GAME_CONFIG.BOOST_SPEED * planeSpeed;
      this.localPlayer.energy = Math.max(0, this.localPlayer.energy - (GAME_CONFIG.ENERGY_DRAIN_RATE * delta));
    } else {
      this.localPlayer.energy = Math.min(100, this.localPlayer.energy + (GAME_CONFIG.ENERGY_REGEN_RATE * delta));
    }
    if (this.speedSurge > 0) {
      this.speedSurge -= delta;
      cruise *= GAME_CONFIG.SPEED_SURGE_MULTIPLIER;
    }
    this.airspeed += (cruise - this.airspeed) * Math.min(1, delta * GAME_CONFIG.THRUST_RESPONSE * (boosting ? 2.5 : 1));
    this.airspeed -= Math.sin(this.pitchAngle) * GAME_CONFIG.GRAVITY_GAIN * delta;
    this.airspeed -= Math.abs(this.rotationVelocity) / GAME_CONFIG.TURN_RATE * GAME_CONFIG.TURN_DRAG * delta;
    this.airspeed = Math.max(GAME_CONFIG.STALL_SPEED * 0.6, Math.min(GAME_CONFIG.DIVE_MAX_SPEED, this.airspeed));
    if (!this.stalled && this.airspeed < GAME_CONFIG.STALL_SPEED && this.controlsEnabled) {
      this.stalled = true;
      this.playSound('stall');
    } else if (this.stalled && this.airspeed > GAME_CONFIG.STALL_RECOVER) {
      this.stalled = false;
    }
    const stallEl = document.getElementById('stall');
    if (stallEl) stallEl.classList.toggle('show', this.stalled);
    if (this.stalled) {
      this.stallBeep -= delta;
      if (this.stallBeep <= 0) { this.stallBeep = 0.6; this.playSound('stall'); }
    }
    let speed = this.airspeed;

    this.updateEnergyBar(this.localPlayer.energy);
    this.updateSpeedBar(speed);
    this.updateEngineSound(speed);
    const altEl = document.getElementById('alt-value');
    if (altEl) altEl.textContent = `${Math.round(ship.position.y * 3)}m`;

    // Banked turning (A/D): turn rate eases toward the input
    const turnInput = Math.max(-1, Math.min(1, (this.controls.left ? 1 : 0) - (this.controls.right ? 1 : 0) + mouseTurn));
    const targetTurnRate = turnInput * GAME_CONFIG.TURN_RATE * (this.planeStats.turn || 1) * (this.stalled ? 0.4 : 1);
    const turnSmooth = Math.min(1, GAME_CONFIG.TURN_SMOOTHING * delta);
    this.rotationVelocity += (targetTurnRate - this.rotationVelocity) * turnSmooth;
    this.shipRotation += this.rotationVelocity * delta;
    ship.rotation.y = this.shipRotation;

    // Climb & dive (↑/↓): pitch eases toward input; vertical speed scales
    // with airspeed so boosting dives feel fast
    let pitchInput = Math.max(-1, Math.min(1, (this.controls.pitchUp ? 1 : 0) - (this.controls.pitchDown ? 1 : 0) + mousePitch));
    if (this.terrainWarn && this.instruments?.settings.assist !== false) pitchInput = 1; // auto pull-up
    let targetPitch = pitchInput * GAME_CONFIG.MAX_PITCH;
    if (this.stalled) targetPitch = Math.min(targetPitch, -0.32); // the nose drops until you have speed again
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

    // Arena edge: warn, then steer the plane back toward the land
    const out = Math.hypot(ship.position.x, ship.position.z) - GAME_CONFIG.ARENA_RADIUS;
    const boundaryEl = document.getElementById('boundary');
    if (out > 0) {
      const toCentre = Math.atan2(ship.position.x, ship.position.z); // heading that flies toward (0,0)
      let d = toCentre - this.shipRotation;
      d = Math.atan2(Math.sin(d), Math.cos(d));
      const strength = Math.min(1, out / 120);
      this.shipRotation += Math.sign(d) * GAME_CONFIG.BOUNDARY_ASSIST * strength * delta;
      ship.rotation.y = this.shipRotation;
      if (boundaryEl && !boundaryEl.classList.contains('show')) { boundaryEl.classList.add('show'); this.playSound('warning'); }
    } else if (boundaryEl && boundaryEl.classList.contains('show')) {
      boundaryEl.classList.remove('show');
    }

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

    // 20 updates a second (not every frame) with velocity, so other
    // clients can extrapolate smoothly between packets
    const nowMs = performance.now();
    if (this.socket && this.isConnected && this.gameState && nowMs - (this.lastPosSentAt || 0) >= GAME_CONFIG.NET_SEND_INTERVAL) {
      const prev = this.lastPosSent;
      const dt = prev ? (nowMs - this.lastPosSentAt) / 1000 : 0;
      const vel = prev && dt > 0.01 && dt < 0.5 ? {
        x: (ship.position.x - prev.x) / dt, y: (ship.position.y - prev.y) / dt, z: (ship.position.z - prev.z) / dt,
      } : undefined;
      this.lastPosSent = { x: ship.position.x, y: ship.position.y, z: ship.position.z };
      this.lastPosSentAt = nowMs;
      try {
        this.socket.emit('position', {
          gameId: this.gameState.id,
          position: this.lastPosSent,
          rotation: { _x: ship.rotation.x, _y: ship.rotation.y, _z: ship.rotation.z },
          vel,
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
    if (ship.userData.props) {
      const rpm = 12 + speed * 0.35;
      for (const p of ship.userData.props) p.rotation.z += rpm * delta;
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

    // Cockpit view, look-back and free look take over from the chase camera
    const otherView = this.updateCameraMode(ship, speed, delta);
    if (this.shakeTime > 0) this.shakeTime = Math.max(0, this.shakeTime - delta);

    if (!otherView) {
      // Camera leans into the bank (clamped so barrel rolls don't flip the view)
      const camRoll = Math.max(-0.7, Math.min(0.7, ship.rotation.z)) * 0.35;
      this.camera.rotateZ(camRoll);

      // Impact shake: decaying random camera offset
      if (this.shakeTime > 0) {
        const s = this.shakeMag * (this.shakeTime / this.shakeDur);
        this.camera.position.x += (Math.random() - 0.5) * s * 2;
        this.camera.position.y += (Math.random() - 0.5) * s * 2;
        this.camera.position.z += (Math.random() - 0.5) * s * 2;
      }
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

    // Treeline stealth chip
    const stealthy = ship.position.y < (this.rules.stealthAltitude || 18);
    if (stealthy !== this.stealthy) {
      this.stealthy = stealthy;
      const chip = document.getElementById('stealth-chip');
      if (chip) chip.classList.toggle('show', stealthy);
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
    // Refresh sky reflections now and then (sunset colours, overcast)
    if (this.envProbe) this.envProbe.update(delta, this.hemiLight ? this.hemiLight.groundColor : undefined);
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

    // Nightfall is a story beat: once per evening someone says so
    if (this.localPlayer && sky.nightFactor > 0.5 && !this.nightTold) {
      this.nightTold = true;
      this.instruments.toast('🌙', 'The last light goes', 'Lit planes show further; the treeline hides you');
      setTimeout(() => this.radio(null, 'night'), 2500);
    } else if (sky.nightFactor < 0.2) {
      this.nightTold = false;
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
}
