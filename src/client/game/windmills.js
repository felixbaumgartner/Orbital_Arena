// Capture-the-windmill objectives.
// Methods are mixed into the Game class (see game.js); `this` is the Game.
import * as THREE from 'three';
import { GAME_CONFIG, CAPTURE_WINDMILLS } from '../config.js';

export class WindmillMethods {
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

  /** Replaces primitive capture-mill towers with the Blender smock mill */
  refreshWindmillModels() {
    if (!this.models.windmill) return;
    for (const [, mill] of this.captureWindmills) {
      if (mill.modelled) continue;
      const model = this.cloneModel('windmill');
      if (!model) return;
      model.scale.setScalar(1.15);
      let sails = null;
      model.traverse((c) => { if (c.name === 'Sails') sails = c; });
      // hide the primitive tower, cap and blades; keep ring, wall, beacon
      for (const child of [...mill.group.children]) {
        if (child === mill.ring || child === mill.wall || child === mill.beacon) continue;
        mill.group.remove(child);
      }
      mill.group.add(model);
      mill.bladesGroup = sails || mill.bladesGroup;
      mill.beacon.position.y = 36;
      mill.modelled = true;
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

    if (nearestMill && !this.millLoreSeen.has(nearestMill.config.id) && this.controlsEnabled) {
      this.millLoreSeen.add(nearestMill.config.id);
      const lore = {
        mill_n: ['North Mill', 'The oldest of the five. Its sails have not stopped since 1741.'],
        mill_s: ['South Mill', 'Rebuilt after the great storm. The miller still blames Westerhaven.'],
        mill_e: ['East Mill', 'Closest to the harbour. Westerhaven calls it theirs. Oostwijk disagrees, loudly.'],
        mill_w: ['West Mill', 'Grinds the flour for the midsummer feast. Whoever holds it at the last light wins the year.'],
        mill_c: ['Hill Mill', 'On the only hill in the polder. You can see all four others from the cap.'],
      }[nearestMill.config.id];
      if (lore) this.instruments.toast('🌾', lore[0], lore[1]);
    }
    if (nearestMill && captureUI) {
      captureUI.style.display = 'block';
      if (captureLabel) {
        const st = this.windmillStates[nearestMill.config.id];
        const mine = st?.team === this.localPlayer?.team;
        const low = ship && ship.position.y < (this.rules.lowPassAltitude || 24);
        captureLabel.textContent = mine
          ? `Holding ${nearestMill.config.name} mill · stay inside to defend`
          : `Capturing ${nearestMill.config.name} mill${low ? ' · LOW PASS ×2' : ' · fly low to capture faster'}`;
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
}
