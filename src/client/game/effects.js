// Contrails, damage smoke, explosions and camera shake.
// Methods are mixed into the Game class (see game.js); `this` is the Game.
import * as THREE from 'three';
import { GAME_CONFIG, TRAILS } from '../config.js';

export class EffectsMethods {
  // =========================================================================
  // CONTRAILS & SMOKE TRAILS
  // =========================================================================

  createTrail(playerId, cosmetics = null) {
    const trailColor = (cosmetics && TRAILS[cosmetics.trail]) ? TRAILS[cosmetics.trail].color : 0xffffff;
    const maxPoints = GAME_CONFIG.TRAIL_MAX_POINTS;
    const posArray = new Float32Array(maxPoints * 3);
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(posArray, 3));
    geo.setDrawRange(0, 0);

    const mat = new THREE.LineBasicMaterial({
      color: trailColor, transparent: true, opacity: trailColor === 0xffffff ? 0.3 : 0.55,
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
}
