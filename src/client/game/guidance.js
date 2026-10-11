// Onboarding, waypoints, targeting, intermission and spawning.
// Methods are mixed into the Game class (see game.js); `this` is the Game.
import * as THREE from 'three';
import { TEAMS } from '../ui/chatter.js';
import { GAME_CONFIG, CAPTURE_WINDMILLS } from '../config.js';

export class GuidanceMethods {
  // =========================================================================
  // ONBOARDING, WAYPOINT, NAME TAGS
  // =========================================================================

  /** Called the moment the player gets control after takeoff */
  onAirborne() {
    this.controlsPanelTimer = GAME_CONFIG.CONTROLS_PANEL_SECONDS;
    if (this.touch) this.touch.show(true);
    if (this.firstFlight && !this.onboarding) this.startOnboarding();
    else if (!this.isTouch && this.instruments?.settings.mouse !== false && !this.pointerLocked) {
      // Wait for the countdown and team banner to clear before more text
      const delay = Math.max(0, this.countdownEndsAt - performance.now()) + 2500;
      setTimeout(() => {
        if (!this.pointerLocked) this.instruments.toast('🖱️', 'Click the world to steer with the mouse', 'A / D and ↑ / ↓ work too');
      }, delay);
    }
  }

  startOnboarding() {
    const key = (k) => `<span class="key">${k}</span>`;
    if (this.isTouch) {
      this.onboarding = {
        index: 0, progress: 0, doneTimer: 0,
        steps: [
          { label: 'Step 1 of 5 · Steer', html: 'Drag anywhere on the left half to steer', check: (g) => Math.abs(g.rotationVelocity) > 0.8, need: 0.8 },
          { label: 'Step 2 of 5 · Altitude', html: 'Push the stick up to climb, down to dive — fly OVER buildings', check: (g) => Math.abs(g.pitchAngle) > 0.18, need: 0.6 },
          { label: 'Step 3 of 5 · Boost', html: 'Hold BOOST for speed (it drains energy)', check: (g) => g.controls.boost && g.localPlayer.energy > 0, need: 0.5 },
          { label: 'Step 4 of 5 · Guns', html: 'Hold FIRE with an enemy in the red box', check: (g) => g.animationTime - g.lastFireTime < 0.3, need: 0.2 },
          { label: 'Step 5 of 5 · Objective', html: 'Follow the yellow marker and fly inside the windmill circle', check: (g) => g.nearAnyWindmill(), need: 1.2 },
        ],
      };
      this.showOnboardingStep();
      return;
    }
    this.onboarding = {
      index: 0,
      progress: 0,
      doneTimer: 0,
      steps: [
        { label: 'Step 1 of 5 · Steer',
          html: `Steer with ${key('A')} / ${key('D')} — or click the world and use the mouse`,
          check: (g) => Math.abs(g.rotationVelocity) > 0.8, need: 0.8 },
        { label: 'Step 2 of 5 · Altitude',
          html: `Climb with ${key('↑')} and dive with ${key('↓')} — fly OVER buildings`,
          check: (g) => Math.abs(g.pitchAngle) > 0.18, need: 0.6 },
        { label: 'Step 3 of 5 · Boost',
          html: `Hold ${key('Shift')} to boost (it drains energy)`,
          check: (g) => g.controls.boost && g.localPlayer.energy > 0, need: 0.5 },
        { label: 'Step 4 of 5 · Guns',
          html: `Put the crosshair on the yellow lead circle, then ${key('Space')} or ${key('LMB')} — the box turns red when you're locked`,
          check: (g) => g.animationTime - g.lastFireTime < 0.3, need: 0.2 },
        { label: 'Step 5 of 5 · Objective',
          html: 'Follow the yellow marker and circle the windmill to capture it',
          check: (g) => g.nearAnyWindmill(), need: 1.2 },
      ],
    };
    this.showOnboardingStep();
  }

  showOnboardingStep() {
    const ob = this.onboarding;
    if (!ob || !this.instruments) return;
    const step = ob.steps[ob.index];
    if (step) this.instruments.setHint(step.html, step.label, true);
  }

  updateOnboarding(ship, delta) {
    const ob = this.onboarding;
    if (!ob) return;
    if (ob.index >= ob.steps.length) {
      ob.doneTimer -= delta;
      if (ob.doneTimer <= 0) {
        this.instruments.setHint(null);
        this.onboarding = null;
      }
      return;
    }
    const step = ob.steps[ob.index];
    if (step.check(this)) ob.progress += delta;
    if (ob.progress >= step.need) {
      ob.progress = 0;
      ob.index++;
      this.playSound('pickup');
      if (ob.index >= ob.steps.length) {
        ob.doneTimer = 7;
        this.instruments.setHint(
          `You're ready! Hold windmills for points, +${this.rules.killScore} per shoot-down. Good hunting.`, 'Flight school complete');
      } else {
        this.showOnboardingStep();
      }
    }
  }

  skipOnboarding() {
    if (!this.onboarding) return;
    this.onboarding = null;
    this.instruments.setHint(null);
    this.instruments.toast('🎓', 'Tutorial skipped', 'Follow the yellow marker to a windmill');
  }

  nearAnyWindmill() {
    const ship = this.localPlayer ? this.players.get(this.localPlayer.id) : null;
    if (!ship) return false;
    for (const mill of CAPTURE_WINDMILLS) {
      const dx = ship.position.x - mill.x, dz = ship.position.z - mill.z;
      if (dx * dx + dz * dz < GAME_CONFIG.CAPTURE_RADIUS * GAME_CONFIG.CAPTURE_RADIUS) return true;
    }
    return false;
  }

  toggleControlsPanel() {
    this.controlsPanelHidden = !this.controlsPanelHidden;
    this.controlsPanelTimer = 0;
    this.instruments.setControlsPanel(!this.controlsPanelHidden);
  }

  /** Picks the windmill worth flying to and projects a marker onto the screen */
  updateWaypoint(ship) {
    if (!this.instruments) return;
    const myTeam = this.localPlayer?.team;
    if (this.mode === 'tdm') { this.updateHuntWaypoint(ship, myTeam); return; }
    let best = null, bestScore = Infinity;
    for (const mill of CAPTURE_WINDMILLS) {
      const state = this.windmillStates[mill.id];
      if (state?.team === myTeam) continue;
      const dx = mill.x - ship.position.x, dz = mill.z - ship.position.z;
      let score = Math.sqrt(dx * dx + dz * dz);
      if (state?.contestingTeam === myTeam && state.progress > 0) score *= 0.4; // finish what we started
      if (score < bestScore) { bestScore = score; best = { mill, state, dist: Math.sqrt(dx * dx + dz * dz) }; }
    }
    if (!best) {
      // Everything is ours: point at the nearest mill to defend it
      for (const mill of CAPTURE_WINDMILLS) {
        const dx = mill.x - ship.position.x, dz = mill.z - ship.position.z;
        const d = Math.sqrt(dx * dx + dz * dz);
        if (d < bestScore) { bestScore = d; best = { mill, state: this.windmillStates[mill.id], dist: d, defend: true }; }
      }
      if (!best) { this.instruments.updateWaypoint({ visible: false }); return; }
    }
    const v = this._wpVec || (this._wpVec = new THREE.Vector3());
    v.set(best.mill.x, 26, best.mill.z).project(this.camera);
    const w = window.innerWidth, h = window.innerHeight;
    const behind = v.z > 1;
    let x = (v.x * 0.5 + 0.5) * w;
    let y = (-v.y * 0.5 + 0.5) * h;
    if (behind) { x = w - x; y = h - y; }
    // Keep the marker clear of the HUD: controls panel (left), radar
    // (right), compass stack (top), hint + attitude cluster (bottom)
    const inset = this.hudInset();
    const onScreen = !behind && x > inset.left && x < w - inset.right && y > inset.top && y < h - inset.bottom;
    let angle = 0;
    if (!onScreen) {
      const cx = w / 2, cy = h / 2;
      const dx = (behind ? -1 : 1) * (x - cx), dy = (behind ? -1 : 1) * (y - cy);
      const ang = Math.atan2(dy, dx);
      // Intersect the ray from the centre with the inset rectangle
      const halfW = Math.min(cx - inset.left, w - inset.right - cx);
      const halfH = Math.min(cy - inset.top, h - inset.bottom - cy);
      const tx = Math.abs(Math.cos(ang)) > 1e-4 ? halfW / Math.abs(Math.cos(ang)) : Infinity;
      const ty = Math.abs(Math.sin(ang)) > 1e-4 ? halfH / Math.abs(Math.sin(ang)) : Infinity;
      const t = Math.min(tx, ty);
      x = cx + Math.cos(ang) * t;
      y = cy + Math.sin(ang) * t;
      angle = ang + Math.PI / 2;
    }
    const color = best.state?.team === 'red' ? '#ff6b6b' : best.state?.team === 'blue' ? '#7fb2ff' : '#FFD23F';
    this.waypointTargetId = best.mill.id;
    this.instruments.updateWaypoint({
      visible: true, x, y, onScreen, angle,
      label: `${best.defend ? 'DEFEND' : best.state?.team ? 'RETAKE' : 'CAPTURE'} · ${best.mill.name.toUpperCase()} MILL · ${Math.round(best.dist * 3)} m`,
      color,
    });
  }

  /**
   * Where to shoot so the bullet and the target meet: solves the intercept
   * of a straight-line shot against the target's estimated velocity.
   * Returns { point, dir, dist, angle } or null.
   */
  interceptFor(ship, other, noseDir) {
    const D = this._icD || (this._icD = new THREE.Vector3());
    const V = this._icV || (this._icV = new THREE.Vector3());
    const P = this._icP || (this._icP = new THREE.Vector3());
    D.subVectors(other.position, ship.position);
    const dist = D.length();
    if (dist < 4) return null;
    const vel = other.userData.vel || { x: 0, y: 0, z: 0 };
    V.set(vel.x, vel.y, vel.z);
    const s = GAME_CONFIG.PROJECTILE_SPEED;
    const a = V.dot(V) - s * s;
    const b = 2 * D.dot(V);
    const c = D.dot(D);
    let t = dist / s;
    const disc = b * b - 4 * a * c;
    if (Math.abs(a) > 1e-4 && disc >= 0) {
      const t1 = (-b - Math.sqrt(disc)) / (2 * a);
      const t2 = (-b + Math.sqrt(disc)) / (2 * a);
      const best = [t1, t2].filter(v => v > 0).sort((x, y) => x - y)[0];
      if (best) t = best;
    }
    P.copy(other.position).addScaledVector(V, t);
    const dir = P.clone().sub(ship.position).normalize();
    const angle = Math.acos(Math.max(-1, Math.min(1, dir.dot(noseDir)))) * 180 / Math.PI;
    return { point: P.clone(), dir, dist, angle };
  }

  /**
   * Picks the enemy closest to the nose inside the lock cone, draws the
   * bracket, health bar and lead circle, and plays a tone on lock.
   */
  updateTargeting(ship) {
    if (!this.instruments) return;
    const myTeam = this.localPlayer?.team;
    const info = {};
    if (this.gameState?.players) for (const p of this.gameState.players) info[p.id] = p;
    const cp = Math.cos(this.pitchAngle), sp = Math.sin(this.pitchAngle);
    const nose = this._noseVec || (this._noseVec = new THREE.Vector3());
    nose.set(-Math.sin(this.shipRotation) * cp, sp, -Math.cos(this.shipRotation) * cp);

    let best = null;
    for (const [id, other] of this.players) {
      if (id === this.localPlayer.id || !other.visible) continue;
      const p = info[id];
      if (!p || p.team === myTeam) continue;
      const ic = this.interceptFor(ship, other, nose);
      if (!ic || ic.dist > GAME_CONFIG.LOCK_RANGE * this.visionScale() || ic.angle > GAME_CONFIG.LOCK_CONE) continue;
      if (this.isHiddenFromMe(other, ic.dist)) continue;
      if (!best || ic.angle < best.ic.angle) best = { id, other, p, ic };
    }

    if (!best) {
      this.currentTarget = null;
      this.lockedId = null;
      this.instruments.updateLock({ visible: false });
      return;
    }

    const locked = best.ic.angle <= GAME_CONFIG.AIM_ASSIST_CONE;
    this.currentTarget = { id: best.id, dir: best.ic.dir, angle: best.ic.angle };
    if (locked && this.lockedId !== best.id) this.playSound('lock');
    this.lockedId = locked ? best.id : null;

    const v = this._lockVec || (this._lockVec = new THREE.Vector3());
    const w = window.innerWidth, h = window.innerHeight;
    v.copy(best.other.position).project(this.camera);
    const onScreen = v.z < 1 && v.x > -1 && v.x < 1 && v.y > -1 && v.y < 1;
    const size = Math.max(26, Math.min(96, 3200 / best.ic.dist));
    v.set(best.ic.point.x, best.ic.point.y, best.ic.point.z).project(this.camera);
    const lead = { visible: v.z < 1 && Math.abs(v.x) < 1 && Math.abs(v.y) < 1, x: (v.x * 0.5 + 0.5) * w, y: (-v.y * 0.5 + 0.5) * h };
    const bx = this._lockBox || (this._lockBox = new THREE.Vector3());
    bx.copy(best.other.position).project(this.camera);
    this.instruments.updateLock({
      visible: onScreen, x: (bx.x * 0.5 + 0.5) * w, y: (-bx.y * 0.5 + 0.5) * h, size, locked,
      name: `${best.p.username || 'Enemy'} · ${Math.round(best.ic.dist * 3)} m`,
      health: this.knownHealth[best.id] ?? best.p.health ?? 100,
      lead,
    });
  }

  /**
   * Magnetic aim assist: inside AIM_ASSIST_SNAP degrees the shot snaps to
   * the lead point; out to AIM_ASSIST_CONE it bends progressively less.
   */
  applyAimAssist(ship, dir) {
    if (this.instruments?.settings.assist === false) return;
    const t = this.currentTarget;
    if (!t || t.angle > GAME_CONFIG.AIM_ASSIST_CONE) return;
    const snap = GAME_CONFIG.AIM_ASSIST_SNAP, cone = GAME_CONFIG.AIM_ASSIST_CONE;
    const strength = t.angle <= snap ? 1 : 1 - ((t.angle - snap) / (cone - snap)) * 0.65;
    const out = this._assistVec || (this._assistVec = new THREE.Vector3());
    out.set(dir.x, dir.y, dir.z).lerp(t.dir, strength).normalize();
    dir.x = out.x; dir.y = out.y; dir.z = out.z;
  }

  /** Floating name / distance / BOT tags over nearby planes */  /** Team Deathmatch: the marker leads to the nearest enemy plane */
  updateHuntWaypoint(ship, myTeam) {
    const info = {};
    if (this.gameState?.players) for (const p of this.gameState.players) info[p.id] = p;
    let best = null, bestDist = Infinity;
    for (const [id, other] of this.players) {
      if (id === this.localPlayer.id || !other.visible || info[id]?.team === myTeam) continue;
      const d = other.position.distanceTo(ship.position);
      if (d < bestDist) { bestDist = d; best = { other, name: info[id]?.username || 'Enemy' }; }
    }
    if (!best) { this.instruments.updateWaypoint({ visible: false }); return; }
    const v = this._wpVec || (this._wpVec = new THREE.Vector3());
    v.copy(best.other.position).project(this.camera);
    const w = window.innerWidth, h = window.innerHeight;
    const behind = v.z > 1;
    let x = (v.x * 0.5 + 0.5) * w, y = (-v.y * 0.5 + 0.5) * h;
    if (behind) { x = w - x; y = h - y; }
    const inset = this.hudInset();
    const onScreen = !behind && x > inset.left && x < w - inset.right && y > inset.top && y < h - inset.bottom;
    let angle = 0;
    if (!onScreen) {
      const cx = w / 2, cy = h / 2;
      const ang = Math.atan2((behind ? -1 : 1) * (y - cy), (behind ? -1 : 1) * (x - cx));
      const halfW = Math.min(cx - inset.left, w - inset.right - cx);
      const halfH = Math.min(cy - inset.top, h - inset.bottom - cy);
      const tx = Math.abs(Math.cos(ang)) > 1e-4 ? halfW / Math.abs(Math.cos(ang)) : Infinity;
      const ty = Math.abs(Math.sin(ang)) > 1e-4 ? halfH / Math.abs(Math.sin(ang)) : Infinity;
      const t = Math.min(tx, ty);
      x = cx + Math.cos(ang) * t; y = cy + Math.sin(ang) * t; angle = ang + Math.PI / 2;
    }
    // Don't double up with the lock bracket when the enemy is already in view
    this.instruments.updateWaypoint({
      visible: !onScreen || bestDist > GAME_CONFIG.LOCK_RANGE, x, y, onScreen, angle,
      label: `HUNT · ${best.name.toUpperCase()} · ${Math.round(bestDist * 3)} m`, color: '#ff6b6b',
    });
  }

  showIntermission(d) {
    const el = document.getElementById('intermission');
    if (!el) return;
    const winName = d.winner ? TEAMS[d.winner].short : null;
    const acts = ['Act I · The opening ceremony', 'Act II · The long afternoon', 'Act III · The last light'];
    el.querySelector('.im-round').textContent = `${acts[d.round - 1] || 'Round ' + d.round} · complete`;
    const title = el.querySelector('.im-title');
    title.textContent = winName ? `${winName} WINS THE ROUND` : 'ROUND DRAWN';
    title.className = `im-title ${d.winner || ''}`;
    el.querySelector('.im-score').textContent = `${d.scores.red} – ${d.scores.blue}`;
    const wins = el.querySelector('.im-wins');
    wins.textContent = '';
    const r = document.createElement('span'); r.className = 'red'; r.textContent = TEAMS.red.short + ' ' + '●'.repeat(d.roundWins.red) + '○'.repeat(Math.max(0, (this.rules.roundsToWin || 2) - d.roundWins.red));
    const b = document.createElement('span'); b.className = 'blue'; b.textContent = '○'.repeat(Math.max(0, (this.rules.roundsToWin || 2) - d.roundWins.blue)) + '●'.repeat(d.roundWins.blue) + ' ' + TEAMS.blue.short;
    wins.append(r, b);
    el.querySelector('.im-mvp').textContent = d.mvp ? `Round MVP: ${d.mvp.username}${d.mvp.isBot ? ' (BOT)' : ''} · ${d.mvp.kills} kills` : '';
    el.querySelector('.im-sudden').textContent = d.nextSuddenDeath ? 'Next: sudden death · windmills score double' : '';
    el.classList.add('show');
    this.intermissionEndsAt = performance.now() + (d.intermission || 15000);
    clearInterval(this.intermissionTicker);
    const tick = () => {
      const left = Math.max(0, Math.ceil((this.intermissionEndsAt - performance.now()) / 1000));
      const next = el.querySelector('.im-next');
      next.textContent = '';
      next.append('Next round in ');
      const bEl = document.createElement('b'); bEl.textContent = `${left}s`;
      next.append(bEl);
      if (left <= 0) clearInterval(this.intermissionTicker);
    };
    tick();
    this.intermissionTicker = setInterval(tick, 250);
    this.playSound('medal');
  }

  hideIntermission() {
    clearInterval(this.intermissionTicker);
    const el = document.getElementById('intermission');
    if (el) el.classList.remove('show');
  }

  /** Mode-specific HUD: TDM hides the windmill machinery */
  applyModeHud() {
    const tdm = this.mode === 'tdm';
    const dots = document.getElementById('mill-dots');
    if (dots) dots.style.display = tdm ? 'none' : '';
    for (const [, mill] of this.captureWindmills) mill.group.visible = !tdm;
    const target = this.rules.tdmTarget || 30;
    const roundTag = `Round ${this.round} of ${this.rules.maxRounds || 3} · ${this.roundWins.red}–${this.roundWins.blue}${this.suddenDeath ? ' · sudden death' : ''}`;
    const village = this.localPlayer?.team ? TEAMS[this.localPlayer.team].short : '';
    this.instruments.setModeCaption(tdm ? `Team Deathmatch · first to ${target} · ${roundTag}` : `The Windmill Cup · ${roundTag}`, village);
  }

  /** Spawn already flying, pointed at something worth doing */
  spawnAirborne(ship, pos) {
    ship.position.set(pos?.x || 0, GAME_CONFIG.FLIGHT_HEIGHT, pos?.z || 0);
    ship.rotation.set(0, 0, 0);
    this.pitchAngle = 0;
    this.takeoffPhase = null;
    const overlay = document.getElementById('takeoff-overlay');
    if (overlay) overlay.style.display = 'none';
    // Face the nearest objective (Domination) or the arena centre
    let target = { x: 0, z: 0 };
    if (this.mode !== 'tdm') {
      let bestD = Infinity;
      for (const mill of CAPTURE_WINDMILLS) {
        const st = this.windmillStates[mill.id];
        if (st?.team === this.localPlayer?.team) continue;
        const d = Math.hypot(mill.x - ship.position.x, mill.z - ship.position.z);
        if (d < bestD) { bestD = d; target = mill; }
      }
    }
    this.shipRotation = Math.atan2(-(target.x - ship.position.x), -(target.z - ship.position.z));
    ship.rotation.y = this.shipRotation;
    this.controlsEnabled = true;
    this.crashGrace = GAME_CONFIG.CRASH_GRACE;
    this.camera.position.set(ship.position.x + Math.sin(this.shipRotation) * 14, ship.position.y + 8, ship.position.z + Math.cos(this.shipRotation) * 14);
    this.camera.lookAt(ship.position);
    this.onAirborne();
  }

  faceNearestEnemy(ship) {
    const info = {};
    if (this.gameState?.players) for (const p of this.gameState.players) info[p.id] = p;
    let best = null, bestD = Infinity;
    for (const [id, other] of this.players) {
      if (id === this.localPlayer.id || !other.visible || info[id]?.team === this.localPlayer.team) continue;
      const d = other.position.distanceTo(ship.position);
      if (d < bestD) { bestD = d; best = other; }
    }
    if (!best) return;
    this.shipRotation = Math.atan2(-(best.position.x - ship.position.x), -(best.position.z - ship.position.z));
    ship.rotation.y = this.shipRotation;
    this.pitchAngle = 0;
  }
}
