// Replays: the kill cam when you're shot down, a slow-motion final kill
// at the end of a round, and the play of the match before the end screen.
// The flight recorder samples every plane at 20 Hz; playback poses the real
// plane objects, re-fires recorded tracers and missiles, and flies a
// cinematic camera behind the shooter.
// Methods are mixed into the Game class (see game.js); `this` is the Game.
import * as THREE from 'three';
import { GAME_CONFIG } from '../config.js';
import { FlightRecorder, poseAt, missilesAt } from '../replay/recorder';
import { makeMissile } from './weapons.js';

const _a = new THREE.Vector3();
const _b = new THREE.Vector3();
const _look = new THREE.Vector3();

export class ReplayMethods {
  // =========================================================================
  // REPLAYS
  // =========================================================================

  initReplay() {
    this.recorder = new FlightRecorder();
    this.replay = null;
    this.highlight = null;          // best clip of the match so far
    this.pendingHighlight = null;   // a kill whose aftermath is still being recorded
    this.killLog = [];
    this.replayShotSeq = 0;
  }

  /** Samples the world each frame (called from animate) */
  recordFrame(delta) {
    if (!this.localPlayer || this.replay || !this.recorder) return;
    this.recorder.record(this.animationTime, delta, () => {
      const planes = new Map();
      for (const [id, s] of this.players) {
        planes.set(id, { x: s.position.x, y: s.position.y, z: s.position.z, rx: s.rotation.x, ry: s.rotation.y, rz: s.rotation.z, vis: s.visible });
      }
      const missiles = [];
      for (const [id, v] of this.missileVisuals || []) {
        missiles.push({ id, x: v.pos.x, y: v.pos.y, z: v.pos.z, vx: v.netVel.x, vy: v.netVel.y, vz: v.netVel.z });
      }
      return { planes, missiles };
    });
    // A highlight is cut once a second of its aftermath is on tape
    const p = this.pendingHighlight;
    if (p && this.animationTime > p.t + 1.1) {
      this.pendingHighlight = null;
      this.considerHighlight(p);
    }
  }

  recordShot(owner, pos, dir) {
    if (!this.recorder || this.replay) return;
    this.recorder.event({ t: this.animationTime, kind: 'shot', owner, x: pos.x, y: pos.y, z: pos.z, dx: dir.x, dy: dir.y, dz: dir.z });
  }

  /**
   * Every kill: logged for replays, scored as a highlight candidate, and
   * if it was you who went down, the kill cam rolls.
   */
  onKillEvent(data) {
    if (!this.recorder || this.replay) return;
    const victim = this.players.get(data.targetId);
    if (!victim) return;
    const t = this.animationTime;
    const vel = this.shipVelocity(data.targetId);
    this.recorder.event({ t, kind: 'kill', attacker: data.attackerId, victim: data.targetId, weapon: data.weapon || 'gun',
      x: victim.position.x, y: victim.position.y, z: victim.position.z, vx: vel.x, vy: vel.y, vz: vel.z });
    this.killLog.push({ t, attacker: data.attackerId, victim: data.targetId, weapon: data.weapon || 'gun' });
    if (this.killLog.length > 60) this.killLog.shift();
    this.scoreHighlight(data, t);

    const me = this.localPlayer?.id;
    if (data.targetId === me && data.attackerId && data.attackerId !== me && this.instruments?.settings.killcam !== false) {
      clearTimeout(this.killcamTimer);
      // Watch your own plane go down for a beat, then roll the tape
      this.killcamTimer = setTimeout(() => this.startKillcam(data, t), 900);
    }
  }

  /** Multi-kills, missiles, bombs and long shots make the best highlights */
  scoreHighlight(data, t) {
    const att = data.attackerId;
    if (!att || att === data.targetId) return;
    const burst = this.killLog.filter((k) => k.attacker === att && t - k.t < 4.5);
    let score = 1 + (burst.length - 1) * 2.2;
    if (data.weapon === 'missile') score += 0.6;
    if (data.weapon === 'bomb') score += 1;
    const a = this.players.get(att), v = this.players.get(data.targetId);
    const dist = a && v ? a.position.distanceTo(v.position) : 0;
    if (dist > 170) score += 0.6;
    const me = this.localPlayer?.id;
    if (att === me) score *= 1.6;
    if (data.targetId === me) score *= 0.7;
    const names = ['', 'Shoot-down', 'Double kill', 'Triple kill', 'Quad kill'];
    const what = burst.length > 1 ? (names[burst.length] || `${burst.length}-plane streak`)
      : data.weapon === 'missile' ? 'Missile kill' : data.weapon === 'bomb' ? 'Bombed from above' : dist > 170 ? `Long shot · ${Math.round(dist * 3)} m` : 'Shoot-down';
    const start = Math.max(burst[0].t - 3.0, t - 8.5);
    // Extending a burst replaces the shorter candidate
    if (this.pendingHighlight && this.pendingHighlight.attacker !== att) this.considerHighlight(this.pendingHighlight);
    this.pendingHighlight = { t, start, score, attacker: att, victim: data.targetId, subtitle: `${this.nameOf(att)} · ${what}` };
  }

  considerHighlight(p) {
    if (this.highlight && this.highlight.score >= p.score) return;
    const clip = this.recorder.clip(p.start, Math.min(this.recorder.latest, p.t + 1.1), {
      focusTime: p.t, focusId: p.attacker, victimId: p.victim, score: p.score,
      title: 'PLAY OF THE MATCH', subtitle: p.subtitle,
    });
    if (clip) this.highlight = clip;
  }

  startKillcam(data, t) {
    if (!this.dead || this.replay) return;
    const killer = this.gameState?.players?.find((p) => p.id === data.attackerId);
    const hp = this.knownHealth[data.attackerId];
    const max = killer?.maxHealth || 100;
    const weapon = data.weapon === 'missile' ? 'missile' : data.weapon === 'bomb' ? 'bomb' : 'guns';
    const planeName = killer?.plane ? killer.plane[0].toUpperCase() + killer.plane.slice(1) : 'Plane';
    const clip = this.recorder.clip(t - 3.4, Math.min(this.recorder.latest, t + 0.7), {
      focusTime: t, focusId: data.attackerId, victimId: data.targetId, score: 0,
      title: 'KILL CAM',
      subtitle: `${this.nameOf(data.attackerId)} · ${planeName} · ${weapon}${typeof hp === 'number' ? ` · ${Math.max(1, Math.round(hp / max * 100))}% health left` : ''}`,
    });
    if (!clip) return;
    this.startReplay(clip, 'killcam', () => {
      // Back to the wreck: ask to fly again (the server allows it a moment
      // after going down, so keep asking until it does)
      let tries = 0;
      const ask = () => {
        if (!this.dead || !this.socket || !this.isConnected || tries++ > 6) return;
        this.socket.emit('requestRespawn');
        setTimeout(ask, 500);
      };
      ask();
    });
  }

  /** The last kill of a round, if it was just now, in slow motion */
  finalKillClip() {
    const k = this.killLog[this.killLog.length - 1];
    if (!k || this.animationTime - k.t > 6 || !this.recorder) return null;
    return this.recorder.clip(k.t - 2.6, Math.min(this.recorder.latest, k.t + 1.0), {
      focusTime: k.t, focusId: k.attacker, victimId: k.victim, score: 0,
      title: 'FINAL KILL', subtitle: `${this.nameOf(k.attacker)} downs ${this.nameOf(k.victim)}`,
    });
  }

  /** Plays the play of the match (if any), then calls done() */
  playOfTheMatch(done) {
    if (this.pendingHighlight) { this.considerHighlight(this.pendingHighlight); this.pendingHighlight = null; }
    if (!this.highlight || this.instruments?.settings.killcam === false) { done(); return; }
    this.startReplay(this.highlight, 'potm', done);
  }

  startReplay(clip, kind, onEnd) {
    if (this.replay) this.endReplay(true);
    const wasVisible = new Map();
    for (const [id, s] of this.players) wasVisible.set(id, s.visible);
    this.replay = {
      clip, kind, onEnd, t: clip.start, speed: 1, fired: new Set(), wasVisible, missiles: new Map(),
      cam: this.camera.position.clone(), look: null,
    };
    document.body.classList.add('replaying');
    const el = document.getElementById('replay-overlay');
    if (el) {
      el.className = `show ${kind}`;
      el.querySelector('.rp-title').textContent = clip.title;
      el.querySelector('.rp-name').textContent = kind === 'killcam' ? `Shot down by ${this.nameOf(clip.focusId)}` : clip.subtitle.split(' · ')[0];
      el.querySelector('.rp-sub').textContent = kind === 'killcam' ? clip.subtitle.split(' · ').slice(1).join(' · ') : clip.subtitle.split(' · ').slice(1).join(' · ');
      const big = el.querySelector('.rp-big');
      big.textContent = kind === 'potm' ? 'PLAY OF THE MATCH' : kind === 'final' ? 'FINAL KILL' : '';
      big.style.display = kind === 'killcam' ? 'none' : 'block';
      // restart the title animation
      big.style.animation = 'none'; void big.offsetWidth; big.style.animation = '';
      el.querySelector('.rp-skip').textContent = this.isTouch ? 'TAP · SKIP' : 'SPACE · SKIP';
    }
    this.controls.shooting = false;
    if (this.audio) this.audio.setMuffle(kind === 'killcam' ? 0.45 : 0.15, 0.4);
    if (kind === 'potm') this.stinger('levelUp');
  }

  updateReplay(realDelta) {
    const r = this.replay;
    if (!r) return;
    const c = r.clip;
    // Slow motion around the decisive moment
    const dt = r.t - c.focusTime;
    const slow = r.kind === 'final' ? 0.2 : r.kind === 'potm' ? 0.3 : 0.32;
    const target = dt > -0.85 && dt < 0.55 ? slow : 1;
    r.speed += (target - r.speed) * Math.min(1, realDelta * 7);
    this.timeScale = r.speed;
    if (this.audio) {
      this.audio.rateScale = 0.55 + 0.45 * r.speed;
      if (r.kind !== 'killcam') this.audio.setMuffle(r.speed < 0.6 ? 0.5 : 0.15, 0.2);
    }
    r.t += realDelta * r.speed;
    if (r.t >= c.end) { this.endReplay(); return; }

    // Planes in their recorded poses
    for (const [id, ship] of this.players) {
      const p = poseAt(c, id, r.t);
      if (!p) { ship.visible = false; continue; }
      ship.position.set(p.x, p.y, p.z);
      ship.rotation.set(p.rx, p.ry, p.rz);
      ship.visible = p.vis;
    }

    // Missiles in flight
    const live = new Set();
    for (const m of missilesAt(c, r.t)) {
      live.add(m.id);
      let mesh = r.missiles.get(m.id);
      if (!mesh) { mesh = makeMissile(); this.scene.add(mesh); r.missiles.set(m.id, mesh); }
      mesh.position.set(m.x, m.y, m.z);
      _look.set(m.x + m.vx, m.y + m.vy, m.z + m.vz);
      mesh.lookAt(_look);
      this.fx.missileTrail(mesh.position);
    }
    for (const [id, mesh] of r.missiles) if (!live.has(id)) { this.scene.remove(mesh); r.missiles.delete(id); }

    // Recorded events: tracers and kills
    for (const e of c.events) {
      if (e.t > r.t || r.fired.has(e)) continue;
      r.fired.add(e);
      if (e.kind === 'shot') {
        const pr = this.createProjectile();
        pr.position.set(e.x, e.y, e.z);
        pr.velocity = new THREE.Vector3(e.dx, e.dy, e.dz).multiplyScalar(GAME_CONFIG.PROJECTILE_SPEED);
        this.orientProjectile(pr);
        this.scene.add(pr);
        this.projectiles.set(`replay_${this.replayShotSeq++}`, pr);
        this.fx.muzzleFlash(pr.position);
        this.playSound('shot-remote', pr.position);
      } else if (e.kind === 'kill') {
        const at = { x: e.x, y: e.y, z: e.z };
        const vel = { x: e.vx, y: e.vy, z: e.vz };
        this.fx.explosion(at, 1, vel);
        this.playSound('explosion', at);
        const ship = this.players.get(e.victim);
        if (ship) this.spawnWreck(ship, vel);
      }
    }

    // Camera: over the shooter's shoulder, framing the victim
    const f = poseAt(c, c.focusId, r.t);
    const v = poseAt(c, c.victimId, r.t);
    if (f) {
      const cp = Math.cos(f.rx);
      const fx = -Math.sin(f.ry) * cp, fy = Math.sin(f.rx), fz = -Math.cos(f.ry) * cp;
      // A slow sideways drift makes highlights feel shot, not recorded
      const drift = r.kind === 'killcam' ? 0 : Math.sin((r.t - c.start) * 0.6) * 6;
      _a.set(f.x - fx * 21 + Math.cos(f.ry) * drift, f.y + 6.5 - fy * 6, f.z - fz * 21 - Math.sin(f.ry) * drift);
      if (v && v.vis) _b.set(f.x + (v.x - f.x) * 0.45, f.y + (v.y - f.y) * 0.45, f.z + (v.z - f.z) * 0.45);
      else _b.set(f.x + fx * 30, f.y + fy * 30, f.z + fz * 30);
      const k = 1 - Math.exp(-5 * realDelta);
      r.cam.lerp(_a, r.look ? k : 1);
      if (!r.look) r.look = _b.clone(); else r.look.lerp(_b, k);
      this.camera.position.copy(r.cam);
      this.camera.lookAt(r.look);
    }
  }

  endReplay(silent = false) {
    const r = this.replay;
    if (!r) return;
    this.replay = null;
    for (const [, mesh] of r.missiles) this.scene.remove(mesh);
    for (const [id, ship] of this.players) {
      if (this.localPlayer && id === this.localPlayer.id) ship.visible = !this.dead;
      else ship.visible = r.wasVisible.has(id) ? r.wasVisible.get(id) : true;
    }
    // Replay tracers vanish with the replay
    for (const [id, p] of this.projectiles) if (id.startsWith('replay_')) { this.scene.remove(p); this.projectiles.delete(id); }
    this.timeScale = 1;
    if (this.audio) { this.audio.rateScale = 1; this.audio.setMuffle(this.dead ? 0.8 : 0, 0.4); }
    document.body.classList.remove('replaying');
    const el = document.getElementById('replay-overlay');
    if (el) el.className = '';
    if (!silent && r.onEnd) r.onEnd();
  }

  /** Space / tap during a replay */
  skipReplay() {
    if (!this.replay) return false;
    this.endReplay();
    return true;
  }
}
