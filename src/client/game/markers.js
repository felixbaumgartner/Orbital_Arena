// Screen markers, name tags and local hit registration.
// Methods are mixed into the Game class (see game.js); `this` is the Game.
import * as THREE from 'three';
import { GAME_CONFIG, CAPTURE_WINDMILLS } from '../config.js';

export class MarkerMethods {

  /**
   * Projects a world point to the screen; if it is out of view (or behind
   * the camera) the point is pushed to the HUD-safe edge with an arrow angle.
   */
  /** Screen rectangle that markers must stay inside (HUD lives outside it) */
  hudInset(forEdgeMarkers = false) {
    if (this.isTouch || window.innerHeight < 600) {
      return forEdgeMarkers ? { left: 170, right: 225, top: 120, bottom: 125 } : { left: 170, right: 225, top: 110, bottom: 135 };
    }
    // Clean HUD: only the score bar (top), the bars (bottom) and the radar (right) to avoid
    if (this.instruments?.minimal) return { left: 60, right: 200, top: 110, bottom: 90 };
    return forEdgeMarkers ? { left: 235, right: 330, top: 175, bottom: 235 } : { left: 240, right: 330, top: 150, bottom: 230 };
  }

  screenMarkerFor(pos, inset = this.hudInset()) {
    const v = this._smVec || (this._smVec = new THREE.Vector3());
    v.copy(pos).project(this.camera);
    const w = window.innerWidth, h = window.innerHeight;
    const behind = v.z > 1;
    let x = (v.x * 0.5 + 0.5) * w, y = (-v.y * 0.5 + 0.5) * h;
    if (behind) { x = w - x; y = h - y; }
    const inView = !behind && x > inset.left && x < w - inset.right && y > inset.top && y < h - inset.bottom;
    let angle = 0;
    if (!inView) {
      const cx = w / 2, cy = h / 2;
      const ang = Math.atan2((behind ? -1 : 1) * (y - cy), (behind ? -1 : 1) * (x - cx));
      const halfW = Math.min(cx - inset.left, w - inset.right - cx);
      const halfH = Math.min(cy - inset.top, h - inset.bottom - cy);
      const tx = Math.abs(Math.cos(ang)) > 1e-4 ? halfW / Math.abs(Math.cos(ang)) : Infinity;
      const ty = Math.abs(Math.sin(ang)) > 1e-4 ? halfH / Math.abs(Math.sin(ang)) : Infinity;
      const t = Math.min(tx, ty);
      x = cx + Math.cos(ang) * t; y = cy + Math.sin(ang) * t; angle = ang + Math.PI / 2;
    }
    return { x, y, inView, angle };
  }

  /**
   * Always-on navigation: an edge arrow for every enemy plane and every
   * windmill you can't see, and a floating label over windmills you can.
   */
  updateEdgeMarkers() {
    if (!this.instruments || !this.localPlayer) return;
    const me = this.players.get(this.localPlayer.id);
    if (!me || this.photoMode) { this.instruments.updateEdgeMarkers([]); return; }
    const list = [];
    const myTeam = this.localPlayer.team;
    const info = {};
    if (this.gameState?.players) for (const p of this.gameState.players) info[p.id] = p;
    const enemyRange = this.radarSweepActive() ? 5000 : 1200;
    const tmp = this._edgeVec || (this._edgeVec = new THREE.Vector3());
    // Keep clear of the score bar / compass (top), controls (left), radar (right), hint + attitude (bottom)
    const EDGE_INSET = this.hudInset(true);

    // Side list rows: bearing relative to the nose, clockwise
    const headingDeg = ((-this.shipRotation * 180 / Math.PI) % 360 + 360) % 360;
    const relBearing = (x, z) => {
      const dx = x - me.position.x, dz = z - me.position.z;
      const rel = Math.atan2(dx, -dz) * 180 / Math.PI - headingDeg;
      return ((rel + 540) % 360) - 180;
    };
    const rows = [];

    // Enemy planes: nearest few, listed on the side (in-view ones also carry a box + tag)
    const enemies = [];
    for (const [id, other] of this.players) {
      if (id === this.localPlayer.id || !other.visible) continue;
      const p = info[id];
      if (!p || p.team === myTeam) continue;
      const dist = other.position.distanceTo(me.position);
      if (dist > enemyRange * this.visionScale()) continue;
      if (this.isHiddenFromMe(other, dist)) continue;
      const dy = other.position.y - me.position.y;
      enemies.push({ id: `e:${id}`, cls: 'enemy', dist: dist * 3, rel: relBearing(other.position.x, other.position.z),
        name: `${p.username || 'Enemy'}${dy > 12 ? ' ▲' : dy < -12 ? ' ▼' : ''}`, owner: p.isBot ? 'BOT' : '' });
    }
    enemies.sort((a, b) => a.dist - b.dist);
    rows.push(...enemies.slice(0, this.isTouch ? 2 : 3));

    // Windmills: a label over the tower when it's in view, and a row on the
    // side for every mill the team doesn't hold (Domination only)
    if (this.mode !== 'tdm') {
      const millRows = [];
      for (const mill of CAPTURE_WINDMILLS) {
        const st = this.windmillStates[mill.id];
        const dist = Math.hypot(mill.x - me.position.x, mill.z - me.position.z);
        const owner = st?.team === myTeam ? 'YOURS' : st?.team ? 'RAIDERS' : 'FREE';
        const cls = st?.team === 'red' ? 'mill-red' : st?.team === 'blue' ? 'mill-blue' : 'mill-none';
        const burning = owner === 'RAIDERS';
        if (st?.team !== myTeam) {
          millRows.push({ id: `m:${mill.id}`, cls, dist: dist * 3, rel: relBearing(mill.x, mill.z),
            name: `${mill.name.toUpperCase()} MILL`, owner, target: this.waypointTargetId === mill.id });
        }
        if (this.waypointTargetId === mill.id) continue; // the big marker already covers it
        // Clean HUD: only mills close by get a label, and not the one you are circling (its bar says it)
        if (this.instruments.minimal && (dist > 600 || dist < GAME_CONFIG.CAPTURE_RADIUS)) continue;
        tmp.set(mill.x, 36, mill.z);
        const m = this.screenMarkerFor(tmp, EDGE_INSET);
        if (!m.inView) continue;
        list.push({ id: `m:${mill.id}`, x: m.x, y: m.y, angle: 0, inView: true, cls, dist,
          label: `${mill.name.toUpperCase()} MILL${burning ? ' 🔥' : ''} · ${Math.round(dist * 3)} m`, owner });
      }
      millRows.sort((a, b) => (b.target ? 1 : 0) - (a.target ? 1 : 0) || a.dist - b.dist);
      rows.push(...millRows.slice(0, this.isTouch ? 3 : 4));
    }
    this.instruments.updateEdgeMarkers(list);
    if (!this.instruments.minimal) this.instruments.updateNavPanel(rows);
  }

  /**
   * Swept test of one of my bullets against every enemy plane as drawn on
   * screen. On a hit: impact burst, bullet removed, claim sent to the server.
   */
  registerLocalHit(id, projectile, prev, teamOf) {
    if (!this.socket || !this.isConnected) return false;
    const r = GAME_CONFIG.CLIENT_HIT_RADIUS;
    for (const [pid, other] of this.players) {
      if (pid === this.localPlayer.id || !other.visible || teamOf[pid] === this.localPlayer.team) continue;
      if (this.pointSegmentDistance(other.position, prev, projectile.position) > r) continue;
      this.spawnHitSpark(projectile.position);
      this.scene.remove(projectile);
      this.projectiles.delete(id);
      try {
        this.socket.emit('hitClaim', {
          gameId: this.gameState?.id, projectileId: id, targetId: pid,
          position: { x: projectile.position.x, y: projectile.position.y, z: projectile.position.z },
        });
      } catch (e) { console.error('hitClaim failed', e); }
      return true;
    }
    return false;
  }

  pointSegmentDistance(p, a, b) {
    const abx = b.x - a.x, aby = b.y - a.y, abz = b.z - a.z;
    const apx = p.x - a.x, apy = p.y - a.y, apz = p.z - a.z;
    const ab2 = abx * abx + aby * aby + abz * abz;
    const t = ab2 > 0 ? Math.max(0, Math.min(1, (apx * abx + apy * aby + apz * abz) / ab2)) : 0;
    const cx = a.x + abx * t - p.x, cy = a.y + aby * t - p.y, cz = a.z + abz * t - p.z;
    return Math.sqrt(cx * cx + cy * cy + cz * cz);
  }

  /** Small impact burst where a bullet struck a plane */
  spawnHitSpark(position) {
    this.fx.hitSpark(position);
    this.playSound('bullet-hit', position);
  }

  /** Floating name / distance / BOT tags over nearby planes */
  updateNameTags() {
    if (!this.instruments || !this.localPlayer) return;
    const me = this.players.get(this.localPlayer.id);
    if (!me || this.photoMode) { this.instruments.updateTags([]); return; }
    const info = {};
    if (this.gameState?.players) for (const p of this.gameState.players) info[p.id] = p;
    const teamOf = {};
    for (const id in info) teamOf[id] = info[id].team;
    const v = this._tagVec || (this._tagVec = new THREE.Vector3());
    const w = window.innerWidth, h = window.innerHeight;
    const list = [];
    for (const [id, ship] of this.players) {
      if (id === this.localPlayer.id || !ship.visible) continue;
      const dist = ship.position.distanceTo(me.position);
      if (dist > (this.radarSweepActive() ? 4000 : 520 * this.visionScale())) continue;
      if (teamOf[id] !== this.localPlayer.team && this.isHiddenFromMe(ship, dist)) continue;
      v.set(ship.position.x, ship.position.y + 3.5, ship.position.z).project(this.camera);
      if (v.z > 1 || v.x < -1 || v.x > 1 || v.y < -1 || v.y > 1) continue;
      const p = info[id];
      const c = this._tagCenter || (this._tagCenter = new THREE.Vector3());
      c.copy(ship.position).project(this.camera);
      const box = { x: (c.x * 0.5 + 0.5) * w, y: (-c.y * 0.5 + 0.5) * h, size: Math.max(18, Math.min(72, 2600 / dist)) };
      list.push({
        id, x: (v.x * 0.5 + 0.5) * w, y: (-v.y * 0.5 + 0.5) * h, box, locked: this.lockedId === id,
        name: p?.username || 'Pilot', dist: dist * 3, dy: (ship.position.y - me.position.y) * 3,
        team: p?.team || 'red', isBot: !!p?.isBot, sameTeam: p?.team === this.localPlayer.team,
      });
    }
    this.instruments.updateTags(list);
  }
}
