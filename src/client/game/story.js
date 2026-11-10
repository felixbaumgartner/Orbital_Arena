// The story. Sky raiders have come for the harvest: every windmill they
// take, they loot and burn. The player is one of the village's last three
// pilots. Whichever team the server assigns, on your own screen you are the
// village (blue) and the other team are the raiders (red and black).
//
// This file holds everything that tells that story: who is on which side,
// the opening and ending scenes, the miller's radio lines, the fires on
// raider-held mills, the one-line orders under the score, and the dip to
// black that covers every jump across the map.
// Methods are mixed into the Game class (see game.js); `this` is the Game.
import { SIDES } from '../ui/chatter.js';
import { GAME_CONFIG, CAPTURE_WINDMILLS } from '../config.js';

export class StoryMethods {
  // =========================================================================
  // SIDES: the village (you) and the raiders (them)
  // =========================================================================

  /** 'us', 'them' or null for a server team as seen from this player's seat */
  sideOf(team) {
    if (!team) return null;
    if (team === '_us') return 'us';
    if (team === '_them') return 'them';
    const my = this.localPlayer?.team;
    if (!my) return null;
    return team === my ? 'us' : 'them';
  }

  foeTeam() {
    return this.localPlayer?.team === 'red' ? 'blue' : 'red';
  }

  /** CSS colour for a team: blue for the village, red for raiders */
  teamCss(team, neutral = '#cccccc') {
    const s = this.sideOf(team);
    return s ? SIDES[s].css : neutral;
  }

  teamHex(team, neutral = 0xffffff) {
    const s = this.sideOf(team);
    return s ? SIDES[s].hex : neutral;
  }

  /** Points the page's team colours at the right side for this player */
  applySides() {
    const my = this.localPlayer?.team;
    document.body.classList.toggle('side-red', my === 'red');
    document.body.classList.toggle('side-blue', my === 'blue');
  }

  /** How many mills each side holds right now */
  millCount() {
    const c = { us: 0, them: 0, free: 0 };
    for (const mill of CAPTURE_WINDMILLS) {
      const s = this.sideOf(this.windmillStates[mill.id]?.team);
      if (s) c[s]++; else c.free++;
    }
    return c;
  }

  // =========================================================================
  // ORDERS: one line under the score that says where things stand and what
  // to do about it
  // =========================================================================

  updateOrders() {
    if (!this.localPlayer) return;
    let text, tone = '';
    if (this.mode === 'tdm') {
      text = `Shoot down the raiders · first to ${this.rules.tdmTarget || 30} wins the raid`;
    } else {
      const c = this.millCount();
      const total = CAPTURE_WINDMILLS.length;
      if (!c.us && !c.them) text = 'Fly into a windmill’s ring to take it';
      else if (c.them > c.us) { text = `Raiders hold ${c.them} of ${total} mills · take one back`; tone = 'bad'; }
      else if (c.us > c.them) { text = `You hold ${c.us} of ${total} mills · keep them safe`; tone = 'good'; }
      else text = `${c.us} mill${c.us === 1 ? '' : 's'} each · take another to pull ahead`;
    }
    if (text === this.ordersText) return;
    this.ordersText = text;
    const el = document.getElementById('orders');
    if (!el) return;
    el.textContent = text;
    el.className = tone;
  }

  // =========================================================================
  // FIRE: a mill the raiders hold is burning
  // =========================================================================

  updateMillFires(delta) {
    if (this.mode === 'tdm' || !this.fx) return;
    this.fireClock = (this.fireClock || 0) + delta;
    if (this.fireClock < 0.16) return;
    this.fireClock = 0;
    const cam = this.camera.position;
    for (const [id, mill] of this.captureWindmills) {
      if (this.sideOf(this.windmillStates[id]?.team) !== 'them') continue;
      const c = mill.config;
      if (Math.hypot(c.x - cam.x, c.z - cam.z) > 1100) continue;
      for (const y of [29, 13 + Math.random() * 12]) {
        this.fx.damageSmoke({
          x: c.x + (Math.random() - 0.5) * 6,
          y: y + Math.random() * 4,
          z: c.z + (Math.random() - 0.5) * 6,
        }, true, y > 26 ? 3.2 : 2.2);
      }
    }
  }

  /** A mill changed hands: say so, once, in plain words */
  millChanged(mill, name, inside) {
    const side = this.sideOf(mill.team);
    if (side === 'them') {
      this.instruments.notify({ key: 'mill', pri: 2, icon: '🔥', title: `Raiders took the ${name} Mill`, sub: 'It is burning · take it back', ttl: 3800 });
    } else if (side === 'us') {
      this.instruments.notify({ key: 'mill', pri: 2, icon: '🌾', title: `${name} Mill saved`, sub: inside ? 'You took it back' : 'Your wingmen took it back', ttl: 3200 });
    }
  }

  // =========================================================================
  // THE MILLER: three radio lines a match, and the last word
  // =========================================================================

  /** Says a beat's line, at most once per match */
  storyBeat(beat) {
    if (!this.localPlayer || this.matchOver || this.storyDone.has(beat)) return;
    const line = this.storyLine(beat);
    if (!line || !this.chatter) return;
    this.storyDone.add(beat);
    this.chatter.guide(line);
  }

  storyLine(beat) {
    const my = this.localPlayer.team, foe = this.foeTeam();
    const tdm = this.mode === 'tdm';
    const wins = this.roundWins || { red: 0, blue: 0 };
    if (beat === 'opening') {
      return tdm
        ? `No mills today. Just shoot them down. First to ${this.rules.tdmTarget || 30}.`
        : 'They are over the mills. Take them back, one at a time.';
    }
    if (beat === 'turning') {
      if (wins[my] > wins[foe]) return 'First raid beaten off. One more and they will give up.';
      if (wins[my] < wins[foe]) return 'They got away with that one. Stop this raid or the harvest is gone.';
      return 'Nothing decided yet. This raid matters.';
    }
    if (beat === 'last') {
      return tdm ? 'Last raid. Whoever wins this one wins it all.' : 'Last raid. Every mill counts double. Do not let them have it.';
    }
    return null;
  }

  /** Which beat belongs to the round being played */
  beatForRound() {
    if (this.round <= 1) return 'opening';
    return this.round >= (this.rules.maxRounds || 3) || this.suddenDeath ? 'last' : 'turning';
  }

  /** Queues the round's line for just after the countdown clears */
  scheduleStory(extraMs = 1500) {
    clearTimeout(this.storyTimer);
    const wait = Math.max(0, (this.countdownEndsAt || 0) - performance.now()) + extraMs;
    this.storyTimer = setTimeout(() => {
      // Flight school has the floor on a first flight; the line follows it
      if (!this.onboarding) this.storyBeat(this.beatForRound());
    }, wait);
  }

  /** How the story ends, for the ending scene and the results card */
  storyCloser(winner) {
    if (!winner) return 'Nobody won today. They will be back tomorrow, and so will we.';
    return this.sideOf(winner) === 'us'
      ? 'The raiders turn for home. The harvest is safe.'
      : 'The mills burn tonight. The raiders take the harvest.';
  }

  // =========================================================================
  // OPENING SCENE: three shots, three sentences, then you fly
  // =========================================================================

  /**
   * Plays the opening over the world behind the menu, before joining.
   * full: the whole story (first visit). Otherwise one short shot.
   */
  playOpening(full, done) {
    const mill = (id) => CAPTURE_WINDMILLS.find(m => m.id === id) || CAPTURE_WINDMILLS[0];
    const west = mill('mill_w'), east = mill('mill_e');
    const RL = GAME_CONFIG.RUNWAY_LENGTH;
    const burn = () => {
      this.windmillStates[east.id] = { id: east.id, team: '_them', progress: 1 };
      this.cineRaiders(east);
    };
    const raid = {
      from: [east.x - 100, 30, east.z + 62], to: [east.x - 62, 42, east.z + 104], look: [east.x, 24, east.z], setup: burn,
    };
    const shots = full ? [
      { dur: 6, text: 'Harvest week. The five windmills are full of grain.',
        from: [west.x - 118, 44, west.z + 84], to: [west.x - 74, 34, west.z + 112], look: [west.x, 22, west.z] },
      { dur: 6.5, text: 'Then the raiders came. Every mill they take, they loot and burn.', ...raid },
      { dur: 7, text: 'Only three pilots are left. You are one. Take the mills back and hold them.',
        from: [-24, 4, RL / 2 - 62], to: [-15, 7.5, RL / 2 - 74], look: [0, 2.5, RL / 2 - 26], setup: () => this.cinePilots() },
    ] : [
      { dur: 4.5, text: 'The raiders are back. Take the mills, and hold them until the bell.', ...raid },
    ];
    this.cine = { shots, index: -1, startedAt: 0, bornAt: performance.now(), done, props: [], orbiters: [], switching: false };
    document.body.classList.add('cine');
    // Any key or click skips, and while the scene plays a key press does
    // nothing else (Esc must not open the settings behind it). Not in the
    // first moment: the click that started the scene must not also skip it.
    this.cineSkip = (e) => {
      if (e && e.type === 'keydown') e.stopImmediatePropagation();
      if (this.cine && performance.now() - this.cine.bornAt > 600) this.endCine();
    };
    document.addEventListener('keydown', this.cineSkip, true);
    document.addEventListener('pointerdown', this.cineSkip, true);
    this.cineShot(0);
  }

  cineShot(i) {
    const c = this.cine;
    if (!c || c.ending) return;
    c.index = i;
    c.startedAt = performance.now();
    c.switching = false;
    const shot = c.shots[i];
    if (shot.setup) { try { shot.setup(); } catch (e) { console.error('scene setup failed', e); } }
    this.cineCaption(shot.text);
  }

  cineCaption(text) {
    const el = document.getElementById('cine');
    if (!el) return;
    const cap = el.querySelector('.cine-cap');
    el.classList.remove('on');
    if (!text) return;
    cap.textContent = text;
    void el.offsetWidth; // restart the fade
    el.classList.add('on');
  }

  /** Two raiders circling the mill they have taken */
  cineRaiders(mill) {
    const c = this.cine;
    if (!c || c.orbiters.length) return;
    for (let i = 0; i < 2; i++) {
      const ship = this.createPlayerShip(0, 'interceptor', null, 'them');
      this.scene.add(ship);
      c.props.push(ship);
      c.orbiters.push({ ship, cx: mill.x, cz: mill.z, r: 58 + i * 26, y: 40 + i * 10, w: 0.55 - i * 0.14, a: i * Math.PI });
    }
  }

  /** The last three planes, parked on the runway */
  cinePilots() {
    const c = this.cine;
    if (!c) return;
    const RL = GAME_CONFIG.RUNWAY_LENGTH;
    ['scout', 'interceptor', 'bomber'].forEach((plane, i) => {
      const ship = this.createPlayerShip(this.getPlayerColor(`pilot${i}`), plane, null, 'us');
      ship.position.set((i - 1) * 4.2, 1, RL / 2 - 12 - i * 13);
      this.scene.add(ship);
      c.props.push(ship);
    });
  }

  updateCine() {
    const c = this.cine;
    const shot = c && c.shots[c.index];
    if (!shot) return;
    const now = performance.now();
    const t = (now - c.startedAt) / 1000;
    const k = Math.min(1, t / shot.dur);
    const cam = this.camera;
    cam.position.set(
      shot.from[0] + (shot.to[0] - shot.from[0]) * k,
      shot.from[1] + (shot.to[1] - shot.from[1]) * k,
      shot.from[2] + (shot.to[2] - shot.from[2]) * k);
    cam.lookAt(shot.look[0], shot.look[1], shot.look[2]);
    const life = (now - c.bornAt) / 1000;
    for (const o of c.orbiters) {
      const a = o.a + life * o.w;
      o.ship.position.set(o.cx + Math.cos(a) * o.r, o.y, o.cz + Math.sin(a) * o.r);
      o.ship.rotation.set(0, Math.atan2(Math.sin(a), -Math.cos(a)), -0.5);
    }
    for (const p of c.props) if (p.userData.props) for (const prop of p.userData.props) prop.rotation.z += 0.5;
    if (t >= shot.dur - 0.19 && !c.switching) {
      c.switching = true;
      this.cineCaption(null);
      if (c.index + 1 < c.shots.length) this.curtain(() => this.cineShot(c.index + 1));
      else this.endCine();
    }
  }

  endCine() {
    const c = this.cine;
    if (!c || c.ending) return;
    c.ending = true;
    c.switching = true;
    document.removeEventListener('keydown', this.cineSkip, true);
    document.removeEventListener('pointerdown', this.cineSkip, true);
    this.cineCaption(null);
    this.curtain(() => {
      for (const p of c.props) { this.scene.remove(p); this.releaseShip(p); }
      this.windmillStates = {};
      document.body.classList.remove('cine');
      this.cine = null;
      c.done();
    });
  }

  // =========================================================================
  // ENDING SCENE: what your flying did to the village
  // =========================================================================

  playEnding(done) {
    const rw = this.gameState?.roundWins || this.roundWins || { red: 0, blue: 0 };
    const winner = rw.red > rw.blue ? 'red' : rw.blue > rw.red ? 'blue' : null;
    const side = this.sideOf(winner);
    const me = this.localPlayer ? this.players.get(this.localPlayer.id) : null;
    let at = CAPTURE_WINDMILLS[0], best = Infinity;
    if (me) {
      for (const m of CAPTURE_WINDMILLS) {
        const d = Math.hypot(m.x - me.position.x, m.z - me.position.z);
        if (d < best) { best = d; at = m; }
      }
    }
    let finished = false, skippable = false;
    const finish = () => {
      if (finished) return;
      finished = true;
      document.removeEventListener('keydown', onInput, true);
      document.removeEventListener('pointerdown', onInput, true);
      this.cineCaption(null);
      document.body.classList.remove('cine');
      document.body.classList.add('ended');
      done();
    };
    const onInput = (e) => {
      if (e.type === 'keydown') e.stopImmediatePropagation();
      if (skippable) finish();
    };
    document.addEventListener('keydown', onInput, true);
    document.addEventListener('pointerdown', onInput, true);
    this.curtain(() => {
      // The epilogue: saved mills turn under blue beacons, lost ones burn
      if (this.mode !== 'tdm' && side) {
        for (const m of CAPTURE_WINDMILLS) this.windmillStates[m.id] = { id: m.id, team: side === 'us' ? '_us' : '_them', progress: 1 };
      }
      this.ending = { cx: at.x, cz: at.z, startedAt: performance.now(), a0: Math.random() * Math.PI * 2 };
      document.body.classList.add('cine');
      this.cineCaption(this.storyCloser(winner));
      setTimeout(finish, 6000);
      setTimeout(() => { skippable = true; }, 700);
    });
  }

  /** Slow circle around a windmill; keeps turning behind the results card */
  updateEnding() {
    const e = this.ending;
    if (!e) return;
    const a = e.a0 + ((performance.now() - e.startedAt) / 1000) * 0.11;
    this.camera.position.set(e.cx + Math.cos(a) * 125, 52, e.cz + Math.sin(a) * 125);
    this.camera.lookAt(e.cx, 24, e.cz);
    this.camera.rotateY(-0.42);
  }

  // =========================================================================
  // FLAVOUR: landmark and windmill lore
  // =========================================================================

  /** Lore waits for a quiet moment: not early, not mid-fight, once a round */
  loreOk() {
    const now = this.animationTime;
    return this.controlsEnabled && !this.onboarding && !this.dead
      && now - (this.airborneAt ?? now) > 40
      && now - (this.lastCombatAt ?? -99) > 8
      && this.loreRound !== this.round
      && !this.instruments.busy();
  }

  lore(icon, title, sub) {
    this.loreRound = this.round;
    this.instruments.notify({ key: 'lore', pri: 0, icon, title, sub, ttl: 5200 });
  }

  // =========================================================================
  // CURTAIN
  // =========================================================================

  /**
   * Dips to black, runs `mid` while nothing can be seen, and comes back.
   * With hold, the screen stays dark until curtainRelease().
   */
  curtain(mid, hold = false) {
    const el = document.getElementById('curtain');
    if (!el) { if (mid) mid(); return; }
    if (mid) this.curtainJobs.push(mid);
    if (hold) this.curtainHeld = true;
    el.classList.add('on');
    if (this.curtainTimer) return;
    this.curtainTimer = setTimeout(() => {
      this.curtainTimer = null;
      const jobs = this.curtainJobs.splice(0);
      for (const job of jobs) { try { job(); } catch (e) { console.error('curtain job failed', e); } }
      if (this.curtainHeld) {
        // Never leave the player in the dark if the release is missed
        clearTimeout(this.curtainFailsafe);
        this.curtainFailsafe = setTimeout(() => this.curtainRelease(), 6000);
      } else {
        el.classList.remove('on');
      }
    }, 190);
  }

  curtainRelease() {
    this.curtainHeld = false;
    clearTimeout(this.curtainFailsafe);
    if (this.curtainTimer) return; // still closing: it opens by itself when the jobs have run
    const el = document.getElementById('curtain');
    if (el) el.classList.remove('on');
  }
}
