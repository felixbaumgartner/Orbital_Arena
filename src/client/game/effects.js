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

  /** One puff of smoke (and flame when burning) from a damaged plane */
  spawnSmokeParticle(position, isFire) {
    this.fx.damageSmoke(position, isFire);
  }

  /** Steps particles, flash lights and falling wreckage */
  updateSmokeParticles(delta) {
    this.fx.update(delta);
    this.wreckage.update(delta);
  }

  /**
   * Fireball, smoke plume and sparks at a kill site — the payoff moment.
   * Pass the plane's velocity so the fireball carries its momentum.
   */
  spawnExplosion(position, vel = null, scale = 1) {
    this.fx.explosion(position, scale, vel);
    // Audible if it happened anywhere near the player
    const my = this.localPlayer && this.players.get(this.localPlayer.id);
    if (!my || my.position.distanceTo(position) < 450) this.playSound('explosion', position);
  }

  /** A shot-down plane breaks apart and falls burning (call before hiding it) */
  spawnWreck(ship, vel) {
    if (!ship) return;
    const wasVisible = ship.visible;
    ship.visible = true;
    try { this.wreckage.spawn(ship, vel || { x: 0, y: 0, z: 0 }); } catch (e) { console.warn('wreck failed', e); }
    ship.visible = wasVisible;
  }

  /** Wreck pieces hitting the ground: a thump you can feel when close */
  onWreckImpact(at, kind) {
    const my = this.localPlayer && this.players.get(this.localPlayer.id);
    const dist = my ? Math.hypot(my.position.x - at.x, my.position.y - at.y, my.position.z - at.z) : 999;
    if (kind === 'hull') {
      this.playSound('impact', at);
      if (dist < 160) this.shake(0.5 * (1 - dist / 160), 0.4);
    }
  }

  /** Best estimate of a plane's current velocity (local flight model or network) */
  shipVelocity(id) {
    if (this.localPlayer && id === this.localPlayer.id) {
      const cp = Math.cos(this.pitchAngle), sp = Math.sin(this.pitchAngle);
      const s = this.airspeed || GAME_CONFIG.MOVEMENT_SPEED;
      return { x: -Math.sin(this.shipRotation) * cp * s, y: sp * s, z: -Math.cos(this.shipRotation) * cp * s };
    }
    const ship = this.players.get(id);
    const v = ship && ship.userData.vel;
    return v ? { x: v.x, y: v.y, z: v.z } : { x: 0, y: 0, z: 0 };
  }

  /** Damaged enemy and friendly planes smoke too (and burn when nearly down) */
  updateRemoteDamageSmoke(delta) {
    this.remoteSmokeTimer = (this.remoteSmokeTimer || 0) - delta;
    if (this.remoteSmokeTimer > 0) return;
    this.remoteSmokeTimer = GAME_CONFIG.SMOKE_SPAWN_RATE * 1.5;
    const info = {};
    if (this.gameState?.players) for (const p of this.gameState.players) info[p.id] = p;
    for (const [id, ship] of this.players) {
      if (id === this.localPlayer?.id || !ship.visible) continue;
      const health = this.knownHealth[id];
      if (typeof health !== 'number') continue;
      const max = info[id]?.maxHealth || 100;
      const pct = (health / max) * 100;
      if (pct >= GAME_CONFIG.SMOKE_HEALTH_THRESHOLD) continue;
      this.fx.damageSmoke(ship.position, pct < GAME_CONFIG.FIRE_HEALTH_THRESHOLD);
    }
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
