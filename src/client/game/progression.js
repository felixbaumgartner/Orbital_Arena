// Score popups, medals, radio, hangar, stork, XP and vision.
// Methods are mixed into the Game class (see game.js); `this` is the Game.
import * as THREE from 'three';
import { GAME_CONFIG, PAINTS, TRAILS, STORK_LEVEL, CAPTURE_WINDMILLS } from '../config.js';

export class ProgressionMethods {
  // =========================================================================
  // SCORE POPUPS, MEDALS, XP
  // =========================================================================

  addPopup(points, label) {
    this.sessionXp += points;
    this.instruments.popup(points, label);
  }

  awardMedal(icon, title, sub, points) {
    this.medalsEarned.push(title);
    this.instruments.medal(icon, title, sub);
    if (points) this.addPopup(points, title);
    this.playSound('medal');
  }

  /** Called when one of my shots (or an airstrike) downs an enemy */
  onMyKill(data) {
    const now = this.animationTime;
    this.streak++;
    this.addPopup(100, 'KILL');
    if (this.killTimes.filter(t => now - t < 4).length < 2) this.radioLine('targetDestroyed', 14);
    this.killTimes = this.killTimes.filter(t => now - t < 4).concat(now);
    const burst = this.killTimes.length;
    if (burst === 2) this.awardMedal('✌️', 'DOUBLE KILL', 'Two down in four seconds', 100);
    else if (burst >= 3) { this.awardMedal('🔱', 'TRIPLE KILL', 'Three down in four seconds', 200); this.announce('multiKill'); }
    if (this.matchKills === 0) this.awardMedal('🩸', 'FIRST BLOOD', 'First kill of the match', 50);
    if (data.targetId && data.targetId === this.lastKilledBy) {
      this.awardMedal('😤', 'REVENGE', `Payback on ${this.nameOf(data.targetId)}`, 50);
      this.lastKilledBy = null;
    }
    const me = this.players.get(this.localPlayer.id);
    const victim = this.players.get(data.targetId);
    if (me && victim && !data.airstrike && me.position.distanceTo(victim.position) > 170) {
      this.awardMedal('🎯', 'LONG SHOT', `${Math.round(me.position.distanceTo(victim.position) * 3)} m`, 75);
    }
    if (this.deathsSinceKill >= 3) this.awardMedal('💪', 'COMEBACK', 'Back in the fight', 50);
    this.deathsSinceKill = 0;
    if (this.mode !== 'tdm' && me) {
      for (const mill of CAPTURE_WINDMILLS) {
        const st = this.windmillStates[mill.id];
        if (st?.team === this.localPlayer.team && Math.hypot(me.position.x - mill.x, me.position.z - mill.z) <= GAME_CONFIG.CAPTURE_RADIUS) {
          this.addPopup(50, 'DEFEND');
          break;
        }
      }
    }
  }

  /** A random bot on a team speaks (or a specific one when named) */
  radio(team, event, name = null, force = false) {
    if (!this.chatter || !this.gameState?.players) return;
    let speaker = name;
    if (!speaker) {
      const bots = this.gameState.players.filter(p => p.isBot && (!team || p.team === team) && !String(p.username).includes('Wingman'));
      if (!bots.length) return;
      const pick = bots[Math.floor(Math.random() * bots.length)];
      speaker = pick.username; team = pick.team;
    }
    this.chatter.say(speaker, team, event, force);
  }

  /** Fills the login-screen hangar with what this pilot has unlocked */
  setupHangar() {
    const level = this.levelFor(this.totalXp());
    let saved = { paint: 'classic', trail: 'white', stork: false };
    try { saved = { ...saved, ...JSON.parse(localStorage.getItem('dvf.cosmetics') || '{}') }; } catch (e) { /* ignore */ }
    const fill = (id, table, chosen) => {
      const sel = document.getElementById(id);
      if (!sel) return;
      sel.textContent = '';
      for (const [key, item] of Object.entries(table)) {
        const opt = document.createElement('option');
        opt.value = key;
        const locked = level < item.level;
        opt.textContent = locked ? `${item.label} (Lv ${item.level})` : item.label;
        opt.disabled = locked;
        if (key === chosen && !locked) opt.selected = true;
        sel.appendChild(opt);
      }
    };
    fill('set-paint', PAINTS, saved.paint);
    fill('set-trail', TRAILS, saved.trail);
    const stork = document.getElementById('set-stork');
    const storkLabel = document.getElementById('stork-label');
    if (stork) {
      const locked = level < STORK_LEVEL;
      stork.disabled = locked;
      stork.checked = !locked && !!saved.stork;
      if (storkLabel) {
        storkLabel.classList.toggle('locked', locked);
        storkLabel.lastChild.textContent = locked ? ` Stork wingman (Lv ${STORK_LEVEL})` : ' Stork wingman';
      }
    }
  }

  readHangar() {
    const c = {
      paint: document.getElementById('set-paint')?.value || 'classic',
      trail: document.getElementById('set-trail')?.value || 'white',
      stork: !!document.getElementById('set-stork')?.checked,
    };
    try { localStorage.setItem('dvf.cosmetics', JSON.stringify(c)); } catch (e) { /* ignore */ }
    return c;
  }

  /** Names of everything that unlocks between two levels */
  unlocksBetween(lvA, lvB) {
    const out = [];
    for (const [, p] of Object.entries(PAINTS)) if (p.level > lvA && p.level <= lvB) out.push(`${p.label} paint`);
    for (const [, t] of Object.entries(TRAILS)) if (t.level > lvA && t.level <= lvB) out.push(`${t.label} contrail`);
    if (STORK_LEVEL > lvA && STORK_LEVEL <= lvB) out.push('Stork wingman');
    return out;
  }

  /** A white stork that flies on your wing (a level-12 reward; seen by you) */
  createStork() {
    const g = new THREE.Group();
    const white = new THREE.MeshStandardMaterial({ color: 0xF7F7F2, roughness: 0.8 });
    const black = new THREE.MeshStandardMaterial({ color: 0x1B1B1B, roughness: 0.8, side: THREE.DoubleSide });
    const orange = new THREE.MeshStandardMaterial({ color: 0xE8642A, roughness: 0.6 });
    const body = new THREE.Mesh(new THREE.SphereGeometry(0.9, 8, 6), white);
    body.scale.set(1, 0.8, 1.8);
    g.add(body);
    const neck = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.3, 2.2, 6), white);
    neck.rotation.x = Math.PI / 2 - 0.5; neck.position.set(0, 0.4, -2.0);
    g.add(neck);
    const head = new THREE.Mesh(new THREE.SphereGeometry(0.42, 7, 6), white);
    head.position.set(0, 0.95, -2.9);
    g.add(head);
    const beak = new THREE.Mesh(new THREE.ConeGeometry(0.16, 1.6, 6), orange);
    beak.rotation.x = -Math.PI / 2; beak.position.set(0, 0.9, -3.9);
    g.add(beak);
    for (const side of [-1, 1]) {
      const wing = new THREE.Mesh(new THREE.PlaneGeometry(3.6, 1.1), white);
      wing.rotation.x = -Math.PI / 2; wing.position.set(side * 2.3, 0.3, 0);
      g.add(wing);
      const tip = new THREE.Mesh(new THREE.PlaneGeometry(1.4, 1.0), black);
      tip.rotation.x = -Math.PI / 2; tip.position.set(side * 4.7, 0.3, 0.05);
      g.add(tip);
      g.userData[side < 0 ? 'lw' : 'rw'] = [wing, tip];
    }
    const legs = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, 1.6, 4), orange);
    legs.rotation.x = Math.PI / 2 + 0.3; legs.position.set(0, -0.3, 1.9);
    g.add(legs);
    g.traverse(c => { if (c.isMesh) c.castShadow = true; });
    this.scene.add(g);
    this.stork = g;
  }

  updateStork(delta) {
    if (!this.stork || !this.localPlayer) return;
    const ship = this.players.get(this.localPlayer.id);
    if (!ship) return;
    // Formation slot: left, slightly behind and above, with a lazy follow
    const back = 9, side = -11, up = 3.5;
    const tx = ship.position.x + Math.sin(this.shipRotation) * back + Math.cos(this.shipRotation) * side;
    const tz = ship.position.z + Math.cos(this.shipRotation) * back - Math.sin(this.shipRotation) * side;
    const ty = ship.position.y + up + Math.sin(this.animationTime * 1.7) * 0.8;
    const k = Math.min(1, delta * 2.2);
    this.stork.position.x += (tx - this.stork.position.x) * k;
    this.stork.position.y += (ty - this.stork.position.y) * k;
    this.stork.position.z += (tz - this.stork.position.z) * k;
    this.stork.rotation.y = this.shipRotation;
    const flap = Math.sin(this.animationTime * 6) * 0.45;
    for (const m of this.stork.userData.lw || []) m.rotation.z = flap;
    for (const m of this.stork.userData.rw || []) m.rotation.z = -flap;
    this.stork.visible = ship.visible && !this.dead;
  }

  totalXp() {
    try { return parseInt(localStorage.getItem('dvf.xp') || '0', 10) || 0; } catch (e) { return 0; }
  }

  bankXp() {
    if (this.xpBanked) return;
    this.xpBanked = true;
    try { localStorage.setItem('dvf.xp', String(this.totalXp() + this.sessionXp)); } catch (e) { /* ignore */ }
  }

  levelFor(xp) {
    return Math.min(30, Math.floor(Math.sqrt(xp / 400)) + 1);
  }

  rankFor(xp) {
    const lv = this.levelFor(xp);
    if (lv >= 17) return 'Ace';
    if (lv >= 14) return 'Commander';
    if (lv >= 11) return 'Major';
    if (lv >= 8) return 'Captain';
    if (lv >= 5) return 'Lieutenant';
    if (lv >= 3) return 'Pilot';
    return 'Cadet';
  }

  radarSweepActive() {
    return this.radarSweepUntil > this.animationTime;
  }

  /**
   * How far I can see other planes right now. Storms and fog shorten it,
   * night lengthens it (lit planes), scouts see further.
   */
  visionScale() {
    let k = this.planeStats.vision || 1;
    const rain = this.weatherNow?.rain || 0;
    const fog = this.weatherNow?.fogFar ? Math.max(0, 1 - this.weatherNow.fogFar / 1000) : 0;
    k *= 1 - rain * 0.45 - fog * 0.5;
    if (this.sky && this.sky.state.nightFactor > 0.5) k *= 1.4;
    return Math.max(0.35, k);
  }

  /** True when an enemy plane is hidden from my sensors (below the treeline, not close) */
  isHiddenFromMe(other, dist) {
    if (this.radarSweepActive()) return false;
    const stealthAlt = this.rules.stealthAltitude || 18;
    const reveal = (this.rules.stealthReveal || 130) * (this.planeStats.vision || 1);
    return other.position.y < stealthAlt && dist > reveal;
  }
}
