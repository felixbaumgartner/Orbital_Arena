// Missiles, flares and bombs on the client. The server simulates every
// weapon; this side locks on, asks to fire, draws missiles and bombs with
// trails and sound, pops flares, warns about missiles coming for you and
// shows a bomb sight for bombers.
// Methods are mixed into the Game class (see game.js); `this` is the Game.
import * as THREE from 'three';
import { CAPTURE_WINDMILLS } from '../config.js';

const LOCK = {
  CONE: 15,        // degrees off the nose the seeker can see
  RANGE: 460,      // world units (scaled by the plane's vision)
  TIME: 1.1,       // seconds of tracking to lock
  FAST_TIME: 0.85, // interceptors lock faster
  GRACE: 0.3,      // brief slips out of the ring don't reset the lock
};

let shared = null;
/** Shared geometry and materials for missiles and bombs */
function weaponParts() {
  if (shared) return shared;
  const body = new THREE.CylinderGeometry(0.16, 0.16, 2.4, 10);
  body.rotateX(Math.PI / 2);
  const nose = new THREE.ConeGeometry(0.16, 0.55, 10);
  nose.rotateX(Math.PI / 2);
  nose.translate(0, 0, 1.47);
  const fin = new THREE.BoxGeometry(0.62, 0.04, 0.38);
  const bombBody = new THREE.SphereGeometry(0.45, 12, 10);
  bombBody.scale(1, 1, 2.1);
  const bombFin = new THREE.BoxGeometry(0.9, 0.05, 0.4);
  shared = {
    body, nose, fin, bombBody, bombFin,
    white: new THREE.MeshStandardMaterial({ color: 0xeeeeea, roughness: 0.45, metalness: 0.3 }),
    red: new THREE.MeshStandardMaterial({ color: 0xc62828, roughness: 0.5 }),
    dark: new THREE.MeshStandardMaterial({ color: 0x37474f, roughness: 0.6, metalness: 0.4 }),
    olive: new THREE.MeshStandardMaterial({ color: 0x4b5320, roughness: 0.7, metalness: 0.2 }),
  };
  return shared;
}

export function makeMissile() {
  const p = weaponParts();
  const g = new THREE.Group();
  g.add(new THREE.Mesh(p.body, p.white));
  g.add(new THREE.Mesh(p.nose, p.red));
  for (let i = 0; i < 4; i++) {
    const f = new THREE.Mesh(p.fin, p.dark);
    f.position.z = -1.0;
    f.rotation.z = (i * Math.PI) / 2;
    f.position.x = Math.cos((i * Math.PI) / 2) * 0.3;
    f.position.y = Math.sin((i * Math.PI) / 2) * 0.3;
    g.add(f);
  }
  g.traverse((c) => { if (c.isMesh) c.castShadow = true; });
  return g;
}

function makeBomb() {
  const p = weaponParts();
  const g = new THREE.Group();
  g.add(new THREE.Mesh(p.bombBody, p.olive));
  for (let i = 0; i < 2; i++) {
    const f = new THREE.Mesh(p.bombFin, p.dark);
    f.position.z = -0.85;
    f.rotation.z = (i * Math.PI) / 2;
    g.add(f);
  }
  g.traverse((c) => { if (c.isMesh) c.castShadow = true; });
  return g;
}

const _v = new THREE.Vector3();
const _w = new THREE.Vector3();

export class WeaponMethods {
  // =========================================================================
  // WEAPONS: missiles, flares, bombs
  // =========================================================================

  initWeaponState() {
    this.ammo = { missiles: 0, flares: 0, bombs: 0 };
    this.missileVisuals = new Map();
    this.bombVisuals = new Map();
    this.flareEmitters = [];
    this.incomingMissiles = new Set();
    this.mslLock = { id: null, t: 0, lostT: 0, locked: false };
    this.missileBeep = 0;
    this.weaponHintAt = -99;
  }

  /** My plane's loadout, from the server's rules */
  weaponLoadout() {
    return (this.rules.loadouts && this.rules.loadouts[this.planeClass]) || { missiles: 0, flares: 0, bombs: 0 };
  }

  /** Server weapon events for one connection (called from bindSocketEvents) */
  bindWeaponEvents(socket) {
    socket.on('ammo', (a) => { if (a) { this.ammo = a; this.updateWeaponsHud(); } });
    socket.on('missileLaunched', (d) => this.onMissileLaunched(d));
    socket.on('missiles', (list) => this.onMissileStates(list));
    socket.on('missileDecoyed', (d) => {
      const v = d && this.missileVisuals.get(d.id);
      if (v) v.targetId = null;
      if (d && d.targetId === this.localPlayer?.id) {
        this.incomingMissiles.delete(d.id);
        this.instruments.toast('🎆', 'Missile decoyed', 'The flares took it');
        this.addPopup(25, 'EVADED');
        this.careerEvent('evades');
      }
    });
    socket.on('missileExplode', (d) => this.onMissileExplode(d));
    socket.on('missileRejected', () => this.weaponHint('🎯', 'Lock lost', 'Keep the enemy in the ring'));
    socket.on('flares', (d) => this.onFlares(d));
    socket.on('bombDropped', (d) => this.onBombDropped(d));
    socket.on('bombExplode', (d) => this.onBombExplode(d));
  }

  /** A short, rate-limited coaching toast for weapon misuse */
  weaponHint(icon, title, sub) {
    if (this.animationTime - this.weaponHintAt < 2) return;
    this.weaponHintAt = this.animationTime;
    this.instruments.toast(icon, title, sub);
  }

  // ------------------------------------------------------------------ input

  fireMissile() {
    if (!this.socket || !this.isConnected || this.dead || !this.controlsEnabled) return;
    const lo = this.weaponLoadout();
    if (!lo.missiles) { this.weaponHint('🚀', 'No missiles on this plane', this.planeClass === 'bomber' ? 'Bombers carry bombs: B' : ''); return; }
    if (!this.ammo.missiles) { this.weaponHint('🚀', 'Missiles reloading', 'One returns every few seconds'); return; }
    if (!this.mslLock.locked || !this.mslLock.id) {
      this.weaponHint('🎯', 'No lock yet', 'Hold an enemy inside the yellow ring until it turns red');
      this.playSound('warning');
      return;
    }
    if (this.animationTime - (this.lastMissileReq || -9) < 0.6) return;
    this.lastMissileReq = this.animationTime;
    this.lastCombatAt = this.animationTime;
    this.socket.emit('fireMissile', { targetId: this.mslLock.id });
  }

  deployFlares() {
    if (!this.socket || !this.isConnected || this.dead || !this.controlsEnabled) return;
    if (!this.ammo.flares) { this.weaponHint('🎆', 'Out of flares', 'They come back over time'); return; }
    if (this.animationTime - (this.lastFlareReq || -9) < 0.8) return;
    this.lastFlareReq = this.animationTime;
    this.socket.emit('deployFlares');
  }

  dropBomb() {
    if (!this.socket || !this.isConnected || this.dead || !this.controlsEnabled) return;
    if (!this.weaponLoadout().bombs) { this.weaponHint('💣', 'Only bombers carry bombs', 'Pick the Bomber in the hangar'); return; }
    if (!this.ammo.bombs) { this.weaponHint('💣', 'Bomb bay empty', 'Bombs reload over time'); return; }
    if (this.animationTime - (this.lastBombReq || -9) < 0.6) return;
    this.lastBombReq = this.animationTime;
    this.socket.emit('dropBomb');
  }

  // ------------------------------------------------------------------ events

  onMissileLaunched(d) {
    if (!d || !d.id || this.missileVisuals.has(d.id)) return;
    const mesh = makeMissile();
    mesh.position.set(d.pos.x, d.pos.y, d.pos.z);
    this.scene.add(mesh);
    const vel = new THREE.Vector3(d.dir.x, d.dir.y, d.dir.z).multiplyScalar(d.speed || 70);
    const v = {
      mesh, pos: mesh.position, netPos: mesh.position.clone(), netVel: vel.clone(), netTime: performance.now(),
      targetId: d.targetId, ownerId: d.ownerId,
      sound: this.audio ? this.audio.loop('rocket', mesh.position, 0.85) : null,
    };
    this.missileVisuals.set(d.id, v);
    const me = this.localPlayer?.id;
    if (d.ownerId === me) {
      this.playSound('missile-launch');
      this.shake(0.15, 0.25);
      this.radioLine('targetEngaged', 25);
    } else {
      this.playSound('missile-launch', d.pos);
    }
    if (d.targetId === me) {
      this.incomingMissiles.add(d.id);
      this.radioLine('lookOut', 12);
    }
  }

  onMissileStates(list) {
    if (!Array.isArray(list)) return;
    const now = performance.now();
    for (const s of list) {
      let v = this.missileVisuals.get(s.id);
      if (!v) {
        // Joined mid-flight: build it from the state
        this.onMissileLaunched({ id: s.id, ownerId: null, targetId: s.t, pos: { x: s.x, y: s.y, z: s.z }, dir: { x: s.vx, y: s.vy, z: s.vz }, speed: 1 });
        v = this.missileVisuals.get(s.id);
        if (!v) continue;
      }
      v.netPos.set(s.x, s.y, s.z);
      v.netVel.set(s.vx, s.vy, s.vz);
      v.netTime = now;
      v.targetId = s.t;
      if (s.t === this.localPlayer?.id) this.incomingMissiles.add(s.id);
    }
  }

  onMissileExplode(d) {
    if (!d) return;
    const v = this.missileVisuals.get(d.id);
    const pos = d.pos || (v && v.pos);
    if (v) this.removeMissileVisual(d.id);
    this.incomingMissiles.delete(d.id);
    if (!pos) return;
    if (pos.y < 3) this.fx.groundExplosion(pos, 0.55);
    else this.fx.explosion(pos, d.hit ? 0.75 : 0.5);
    this.playSound('missile-boom', pos);
  }

  removeMissileVisual(id) {
    const v = this.missileVisuals.get(id);
    if (!v) return;
    this.scene.remove(v.mesh);
    if (v.sound) v.sound.stop();
    this.missileVisuals.delete(id);
  }

  onFlares(d) {
    if (!d || !d.pos) return;
    const base = new THREE.Vector3(d.pos.x, d.pos.y, d.pos.z);
    const pv = new THREE.Vector3(d.vel?.x || 0, d.vel?.y || 0, d.vel?.z || 0);
    // Right-hand side of the plane's flight path, for a fan of flares
    const right = new THREE.Vector3().crossVectors(pv.lengthSq() > 1 ? pv.clone().normalize() : new THREE.Vector3(0, 0, -1), new THREE.Vector3(0, 1, 0)).normalize();
    for (let i = 0; i < 6; i++) {
      const side = i % 2 ? 1 : -1;
      const vel = pv.clone().multiplyScalar(0.45)
        .addScaledVector(right, side * (6 + Math.floor(i / 2) * 4))
        .add(new THREE.Vector3(0, -3 - Math.random() * 5, 0));
      this.flareEmitters.push({ pos: base.clone(), vel, life: 2.4 + Math.random() * 0.9 });
    }
    this.fx.flareBurst(base);
    this.playSound('flare', base);
  }

  onBombDropped(d) {
    if (!d || !d.id) return;
    const mesh = makeBomb();
    mesh.position.set(d.pos.x, d.pos.y, d.pos.z);
    this.scene.add(mesh);
    this.bombVisuals.set(d.id, { mesh, vel: new THREE.Vector3(d.vel.x, d.vel.y, d.vel.z), age: 0 });
    this.playSound('bomb-whistle', d.pos);
    if (d.ownerId === this.localPlayer?.id) {
      this.playSound('bomb-release');
      this.radioLine('fireInTheHole', 25);
    }
  }

  onBombExplode(d) {
    if (!d || !d.pos) return;
    const b = this.bombVisuals.get(d.id);
    if (b) { this.scene.remove(b.mesh); this.bombVisuals.delete(d.id); }
    this.fx.groundExplosion(d.pos, 1.15);
    this.playSound('explosion', d.pos);
    const me = this.localPlayer && this.players.get(this.localPlayer.id);
    if (me) {
      const dist = me.position.distanceTo(_v.set(d.pos.x, d.pos.y, d.pos.z));
      if (dist < 220) this.shake(0.7 * (1 - dist / 220), 0.5);
    }
    if (d.millId) {
      const mill = CAPTURE_WINDMILLS.find((m) => m.id === d.millId);
      const bomber = this.gameState?.players?.find((p) => p.id === d.ownerId);
      const ours = bomber && bomber.team === this.localPlayer?.team;
      const name = mill ? mill.name : 'A';
      if (ours) {
        this.instruments.toast('💣', d.neutralized ? `${name} mill knocked out!` : `Direct hit on ${name} mill`,
          d.neutralized ? 'Their hold is broken: fly in and take it' : 'Their hold is shaken');
        if (d.ownerId === this.localPlayer?.id) {
          this.addPopup(d.neutralized ? 150 : 75, d.neutralized ? 'MILL KNOCKED OUT' : 'MILL HIT');
          this.careerEvent('millBombs');
        }
      } else {
        this.instruments.toast('⚠️', `${name} mill bombed`, d.neutralized ? 'We lost it: retake it' : 'Our hold is slipping');
      }
    }
  }

  /** Missiles and bombs from an old connection are gone after a handover */
  clearWeaponVisuals() {
    for (const id of [...this.missileVisuals.keys()]) this.removeMissileVisual(id);
    for (const [, b] of this.bombVisuals) this.scene.remove(b.mesh);
    this.bombVisuals.clear();
    this.incomingMissiles.clear();
  }

  // ------------------------------------------------------------------ per frame

  updateWeapons(delta, realDelta) {
    if (!this.missileVisuals) return;
    const now = performance.now();
    const me = this.localPlayer ? this.players.get(this.localPlayer.id) : null;

    // Missiles glide on the server's track (extrapolated between packets)
    for (const [id, v] of this.missileVisuals) {
      const age = Math.min(0.3, (now - v.netTime) / 1000);
      if (now - v.netTime > 1500) { this.removeMissileVisual(id); this.incomingMissiles.delete(id); continue; }
      _v.copy(v.netPos).addScaledVector(v.netVel, age);
      v.pos.lerp(_v, 1 - Math.exp(-25 * realDelta));
      _w.copy(v.pos).add(v.netVel);
      v.mesh.lookAt(_w);
      this.fx.missileTrail(_v.copy(v.pos).addScaledVector(v.netVel, -0.008));
      if (v.sound) v.sound.setPosition(v.pos);
    }

    // Bombs fall with the same physics the server uses
    const g = this.rules.bombGravity || 38, drag = this.rules.bombDrag || 0.15;
    for (const [id, b] of this.bombVisuals) {
      b.age += delta;
      b.vel.y -= g * delta;
      const k = Math.exp(-drag * delta);
      b.vel.x *= k; b.vel.z *= k;
      b.mesh.position.addScaledVector(b.vel, delta);
      _w.copy(b.mesh.position).add(b.vel);
      b.mesh.lookAt(_w);
      if (b.mesh.position.y <= 0.4) { b.mesh.position.y = 0.4; if (b.age > 6) { this.scene.remove(b.mesh); this.bombVisuals.delete(id); } }
    }

    // Flares: burning decoys falling away
    for (let i = this.flareEmitters.length - 1; i >= 0; i--) {
      const f = this.flareEmitters[i];
      f.life -= delta;
      f.vel.y -= 9 * delta;
      f.vel.multiplyScalar(Math.exp(-0.6 * delta));
      f.pos.addScaledVector(f.vel, delta);
      this.fx.flare(f.pos);
      if (f.life <= 0) this.flareEmitters.splice(i, 1);
    }

    if (!me) return;
    this.updateMissileLock(me, delta);
    this.updateIncomingWarning(me, realDelta);
    this.updateBombSight(me);
  }

  /** Seeker: hold an enemy in the ring until it locks */
  updateMissileLock(ship, delta) {
    const el = document.getElementById('msl-lock');
    const lo = this.weaponLoadout();
    const can = !this.dead && this.controlsEnabled && !this.photoMode && !this.replay && lo.missiles > 0 && this.ammo.missiles > 0;
    const reset = () => {
      this.mslLock = { id: null, t: 0, lostT: 0, locked: false };
      if (el) el.style.display = 'none';
      if (this.audio) this.audio.seeker.set('off');
      document.getElementById('btn-msl')?.classList.remove('ready');
    };
    if (!can) { reset(); return; }
    const cp = Math.cos(this.pitchAngle), sp = Math.sin(this.pitchAngle);
    _w.set(-Math.sin(this.shipRotation) * cp, sp, -Math.cos(this.shipRotation) * cp);
    const info = {};
    if (this.gameState?.players) for (const p of this.gameState.players) info[p.id] = p;
    const range = LOCK.RANGE * this.visionScale();
    const coneCos = Math.cos(LOCK.CONE * Math.PI / 180);
    let best = null, bestCos = coneCos, currentValid = false;
    const L = this.mslLock;
    for (const [id, other] of this.players) {
      if (id === this.localPlayer.id || !other.visible) continue;
      const p = info[id];
      if (!p || p.team === this.localPlayer.team) continue;
      _v.subVectors(other.position, ship.position);
      const d = _v.length();
      if (d > range || d < 12 || this.isHiddenFromMe(other, d)) continue;
      const c = _v.dot(_w) / d;
      if (id === L.id && c > coneCos) currentValid = true;
      if (c > bestCos) { bestCos = c; best = id; }
    }
    // Sticky: keep tracking the current target while it stays in the ring
    if (currentValid) best = L.id;
    if (best && best === L.id) { L.t += delta; L.lostT = 0; }
    else if (!best && L.id && L.lostT < LOCK.GRACE) { L.lostT += delta; }
    else if (best !== L.id) { L.id = best; L.t = 0; L.lostT = 0; }
    if (!L.id) { reset(); return; }
    const need = this.planeClass === 'interceptor' ? LOCK.FAST_TIME : LOCK.TIME;
    const progress = Math.min(1, L.t / need);
    const wasLocked = L.locked;
    L.locked = progress >= 1;
    if (L.locked && !wasLocked) this.lastCombatAt = this.animationTime;
    if (this.audio) this.audio.seeker.set(L.locked ? 'lock' : 'track', progress);
    document.getElementById('btn-msl')?.classList.toggle('ready', L.locked);

    const target = this.players.get(L.id);
    if (!el || !target) return;
    _v.copy(target.position).project(this.camera);
    if (_v.z > 1 || Math.abs(_v.x) > 1.1 || Math.abs(_v.y) > 1.1) { el.style.display = 'none'; return; }
    const x = (_v.x * 0.5 + 0.5) * window.innerWidth, y = (-_v.y * 0.5 + 0.5) * window.innerHeight;
    el.style.display = 'block';
    el.style.left = `${x}px`;
    el.style.top = `${y}px`;
    el.style.setProperty('--size', `${Math.round(96 - progress * 52)}px`);
    el.classList.toggle('locked', L.locked);
    const label = el.querySelector('.label');
    const text = L.locked ? (this.isTouch ? 'LOCK · MSL' : 'LOCK · F') : 'LOCKING';
    if (label && label.textContent !== text) label.textContent = text;
  }

  /** Missile coming for you: flashing warning, direction arrow, beeps */
  updateIncomingWarning(ship, realDelta) {
    const warn = document.getElementById('missile-warn');
    const arrow = document.getElementById('missile-dir');
    let nearest = Infinity, bearing = 0;
    for (const id of [...this.incomingMissiles]) {
      const v = this.missileVisuals.get(id);
      if (!v || v.targetId !== this.localPlayer.id) { this.incomingMissiles.delete(id); continue; }
      const d = v.pos.distanceTo(ship.position);
      if (d < nearest) {
        nearest = d;
        const dx = v.pos.x - ship.position.x, dz = v.pos.z - ship.position.z;
        bearing = Math.atan2(dx, -dz) * 180 / Math.PI + this.shipRotation * 180 / Math.PI;
      }
    }
    const active = nearest < Infinity && !this.dead;
    if (warn) warn.classList.toggle('show', active);
    if (arrow) {
      arrow.classList.toggle('show', active);
      if (active) arrow.style.transform = `rotate(${bearing}deg)`;
    }
    if (!active) { this.missileBeep = 0; return; }
    this.lastCombatAt = this.animationTime;
    this.missileBeep -= realDelta;
    if (this.missileBeep <= 0) {
      this.missileBeep = Math.max(0.08, Math.min(0.7, nearest / 420));
      this.playSound('missile-warn');
    }
  }

  /** Bombers see where a bomb released now would land */
  updateBombSight(ship) {
    const el = document.getElementById('bomb-sight');
    if (!el) return;
    const ok = !this.dead && this.controlsEnabled && !this.photoMode && this.weaponLoadout().bombs > 0 && this.ammo.bombs > 0 && ship.position.y > 8;
    if (!ok) { el.style.display = 'none'; return; }
    const v = this.shipVelocity(this.localPlayer.id);
    const g = this.rules.bombGravity || 38, drag = this.rules.bombDrag || 0.15;
    let x = ship.position.x, y = ship.position.y - 1.5, z = ship.position.z;
    let vx = v.x, vy = Math.min(0, v.y), vz = v.z;
    const dt = 0.05;
    for (let i = 0; i < 300 && y > 0; i++) {
      vy -= g * dt;
      const k = Math.exp(-drag * dt);
      vx *= k; vz *= k;
      x += vx * dt; y += vy * dt; z += vz * dt;
    }
    _v.set(x, 0.5, z).project(this.camera);
    if (_v.z > 1 || Math.abs(_v.x) > 1 || Math.abs(_v.y) > 1) { el.style.display = 'none'; return; }
    el.style.display = 'block';
    el.style.left = `${(_v.x * 0.5 + 0.5) * window.innerWidth}px`;
    el.style.top = `${(-_v.y * 0.5 + 0.5) * window.innerHeight}px`;
    const overMill = this.mode !== 'tdm' && CAPTURE_WINDMILLS.some((m) => {
      const st = this.windmillStates[m.id];
      return st && st.team && st.team !== this.localPlayer.team && Math.hypot(m.x - x, m.z - z) < 55;
    });
    el.classList.toggle('over-mill', overMill);
  }

  /** Ammo pips by the health bars, and which touch buttons to show */
  updateWeaponsHud() {
    const el = document.getElementById('weapons-hud');
    if (!el) return;
    const lo = this.weaponLoadout();
    const a = this.ammo || {};
    const row = (cls, label, have, max, key) => {
      if (!max) return '';
      let pips = '';
      for (let i = 0; i < max; i++) pips += `<span class="pip${i < have ? '' : ' empty'}"></span>`;
      return `<span class="wpn ${cls}"><b>${label}</b>${pips}${this.isTouch ? '' : `<span class="key">${key}</span>`}</span>`;
    };
    el.innerHTML = row('msl', 'MSL', a.missiles || 0, lo.missiles, 'F') + row('flr', 'FLR', a.flares || 0, lo.flares, 'G') + row('bmb', 'BMB', a.bombs || 0, lo.bombs, 'B');
    el.classList.toggle('show', !!this.localPlayer);
    document.getElementById('btn-msl')?.classList.toggle('hidden', !lo.missiles);
    document.getElementById('btn-bmb')?.classList.toggle('hidden', !lo.bombs);
  }
}
