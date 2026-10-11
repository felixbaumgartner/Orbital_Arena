// Barrel roll, radar, HUD readouts, scoreboard and end screen.
// Methods are mixed into the Game class (see game.js); `this` is the Game.
import { TEAMS } from '../ui/chatter.js';
import { GAME_CONFIG, CAPTURE_WINDMILLS } from '../config.js';

export class HudMethods {
  // =========================================================================
  // BARREL ROLL
  // =========================================================================

  startBarrelRoll() {
    if (this.rollCooldown <= 0 && this.rollTimer <= 0) this.airspeed = Math.max(GAME_CONFIG.STALL_SPEED * 0.8, this.airspeed - GAME_CONFIG.ROLL_SPEED_COST);
    if (this.rollTimer > 0 || this.rollCooldown > 0) return;
    if (this.crashed || this.dead || !this.controlsEnabled) return;
    this.rollTimer = GAME_CONFIG.ROLL_DURATION;
    this.rollCooldown = GAME_CONFIG.ROLL_COOLDOWN;
    // Roll toward held direction; default left
    this.rollDir = this.controls.right ? -1 : 1;
    this.playSound('roll');
  }

  // =========================================================================
  // RADAR
  // =========================================================================

  updateRadar(ship) {
    const canvas = document.getElementById('radar');
    if (!canvas || !ship) return;
    const ctx = canvas.getContext('2d');
    const size = canvas.width;
    const half = size / 2;
    const scale = half / GAME_CONFIG.RADAR_RANGE;

    ctx.clearRect(0, 0, size, size);

    // Background + range rings
    ctx.fillStyle = 'rgba(0, 20, 0, 0.65)';
    ctx.beginPath();
    ctx.arc(half, half, half - 1, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = 'rgba(0, 255, 100, 0.25)';
    ctx.lineWidth = 1;
    for (const r of [0.5, 1]) {
      ctx.beginPath();
      ctx.arc(half, half, (half - 2) * r, 0, Math.PI * 2);
      ctx.stroke();
    }

    // Heading-up radar: rotate world points by ship heading
    const cos = Math.cos(this.shipRotation);
    const sin = Math.sin(this.shipRotation);
    const project = (wx, wz) => {
      const dx = wx - ship.position.x;
      const dz = wz - ship.position.z;
      // world -> ship-relative (facing -Z at rotation 0)
      const rx = dx * cos - dz * sin;
      const rz = dx * sin + dz * cos;
      return { x: half + rx * scale, y: half + rz * scale, inRange: dx * dx + dz * dz < GAME_CONFIG.RADAR_RANGE ** 2 };
    };

    // Capture windmills (color = owning team)
    for (const mill of CAPTURE_WINDMILLS) {
      const state = this.windmillStates[mill.id];
      const p = project(mill.x, mill.z);
      if (!p.inRange) continue;
      ctx.fillStyle = state?.team === 'red' ? '#ff5555'
        : state?.team === 'blue' ? '#5599ff' : '#cccccc';
      ctx.fillRect(p.x - 4, p.y - 4, 8, 8);
      ctx.fillStyle = '#000';
      ctx.font = 'bold 8px "Rajdhani", "Segoe UI", sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(mill.name[0], p.x, p.y + 0.5);
    }

    // Other players (enemy red, teammate green)
    const myTeam = this.localPlayer?.team;
    const teamOf = {};
    if (this.gameState?.players) {
      for (const pl of this.gameState.players) teamOf[pl.id] = pl.team;
    }
    const sweep = this.radarSweepActive();
    if (sweep) {
      ctx.strokeStyle = 'rgba(80, 255, 140, 0.9)';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(half, half, half - 2, 0, Math.PI * 2);
      ctx.stroke();
    }
    for (const [id, otherShip] of this.players) {
      if (id === this.localPlayer?.id) continue;
      if (teamOf[id] !== myTeam && this.isHiddenFromMe(otherShip, otherShip.position.distanceTo(ship.position))) continue;
      const p = project(otherShip.position.x, otherShip.position.z);
      if (!p.inRange) {
        if (!sweep || teamOf[id] === myTeam) continue;
        // Sweep: pin out-of-range enemies to the radar's edge
        const ang = Math.atan2(p.y - half, p.x - half);
        p.x = half + Math.cos(ang) * (half - 6);
        p.y = half + Math.sin(ang) * (half - 6);
      }
      ctx.fillStyle = teamOf[id] === myTeam ? '#44ff88' : '#ff4444';
      ctx.beginPath();
      ctx.arc(p.x, p.y, 3.5, 0, Math.PI * 2);
      ctx.fill();
    }

    // Own ship: triangle pointing up (heading-up display)
    ctx.fillStyle = '#ffffff';
    ctx.beginPath();
    ctx.moveTo(half, half - 6);
    ctx.lineTo(half - 4, half + 5);
    ctx.lineTo(half + 4, half + 5);
    ctx.closePath();
    ctx.fill();
  }

  // =========================================================================
  // HUD & UI
  // =========================================================================

  /**
   * Looks up a display name from the current roster
   */
  nameOf(playerId) {
    const p = this.gameState?.players?.find(pl => pl.id === playerId);
    return p ? p.username : 'Pilot';
  }

  /**
   * Records when the server last told us the remaining time so the HUD
   * can count down smoothly between updates
   */
  syncTimer(remainingMs) {
    if (typeof remainingMs !== 'number') return;
    this.timerSync = { remaining: remainingMs, at: performance.now() };
  }

  /**
   * Counts the match clock down every frame (called from animate)
   */
  updateTimer() {
    if (!this.timerSync) return;
    const el = document.getElementById('time-remaining');
    if (!el) return;
    const remaining = Math.max(0, this.timerSync.remaining - (performance.now() - this.timerSync.at));
    const minutes = Math.floor(remaining / 60000);
    const seconds = Math.floor((remaining % 60000) / 1000);
    const text = `${minutes}:${seconds.toString().padStart(2, '0')}`;
    if (text !== this.lastTimerText) {
      this.lastTimerText = text;
      el.textContent = text;
      el.classList.toggle('low', remaining < 31000);
    }

    // Match callouts
    if (this.gameState && this.localPlayer) {
      const s = this.gameState.scores || { red: 0, blue: 0 };
      const my = s[this.localPlayer.team] || 0, their = s[this.localPlayer.team === 'red' ? 'blue' : 'red'] || 0;
      const standing = my > their ? `You lead ${my}–${their}` : my < their ? `You trail ${my}–${their}` : `Tied ${my}–${their}`;
      if (remaining < 150000 && remaining > 140000 && !this.calloutsDone.has('half')) {
        this.calloutsDone.add('half');
        this.instruments.toast('⏱️', 'Halfway', standing);
      }
      if (remaining < 30000 && remaining > 20000 && !this.calloutsDone.has('final')) {
        this.calloutsDone.add('final');
        this.instruments.toast('⏱️', 'Final 30 seconds!', standing);
        this.playSound('warning');
      }
    }
  }

  /** Pre-match countdown overlay, driven from the server's start time */
  updateCountdown() {
    if (!this.countdownEndsAt) return;
    const left = this.countdownEndsAt - performance.now();
    if (left <= -1200) {
      this.countdownEndsAt = 0;
      this.countdownLast = null;
      this.instruments.setCountdown(null);
      return;
    }
    const n = left > 0 ? Math.ceil(left / 1000) : 'GO!';
    if (n !== this.countdownLast) {
      this.countdownLast = n;
      this.instruments.setCountdown(n === 'GO!' ? 'FIGHT' : 'MATCH STARTS IN', n);
      this.playSound(n === 'GO!' ? 'go' : 'tick');
    }
  }

  showHitmarker(killed) {
    const el = document.getElementById('hitmarker');
    if (!el) return;
    el.classList.remove('show', 'kill');
    void el.offsetWidth; // restart the CSS animation
    el.classList.add('show');
    if (killed) el.classList.add('kill');
  }

  addKillFeed(attackerName, victimName) {
    const feed = document.getElementById('kill-feed');
    if (!feed) return;
    const entry = document.createElement('div');
    entry.className = 'kill-entry';
    entry.innerHTML = `<span>${this.sanitizeInput(attackerName)}</span> &#9992; <span>${this.sanitizeInput(victimName)}</span>`;
    feed.prepend(entry);
    while (feed.children.length > 4) feed.removeChild(feed.lastChild);
    setTimeout(() => { if (entry.parentNode) entry.parentNode.removeChild(entry); }, 4500);
  }

  showKillBanner(victimName) {
    const el = document.getElementById('kill-banner');
    if (!el) return;
    el.textContent = `SPLASH! You shot down ${victimName}`;
    el.classList.remove('show');
    void el.offsetWidth;
    el.classList.add('show');
  }

  showTeamBanner(team) {
    const el = document.getElementById('team-banner');
    if (!el || !team) return;
    const enemy = team === 'red' ? 'blue' : 'red';
    el.textContent = '';
    el.appendChild(document.createTextNode(`YOU FLY FOR ${TEAMS[team].short}`));
    const sub = document.createElement('small');
    sub.textContent = this.mode === 'tdm'
      ? `${TEAMS[team].club} · Shoot down ${TEAMS[enemy].village}'s planes · first to ${this.rules.tdmTarget || 30}`
      : `${TEAMS[team].club} · Hold the windmills · Shoot down ${TEAMS[enemy].village}'s planes`;
    el.appendChild(sub);
    el.className = `show ${team}`;
    setTimeout(() => { el.className = ''; }, 4500);
  }

  displayChatMessage(username, message) {
    const chatMessages = document.getElementById('chat-messages');
    if (!chatMessages) return;
    const el = document.createElement('div');
    el.className = 'chat-message';
    el.innerHTML = `<strong>${this.sanitizeInput(username)}:</strong> ${this.sanitizeInput(message)}`;
    chatMessages.appendChild(el);
    chatMessages.scrollTop = chatMessages.scrollHeight;
    while (chatMessages.children.length > 50) chatMessages.removeChild(chatMessages.firstChild);
  }

  setHealthBar(health) {
    const healthFill = document.querySelector('.health-fill');
    if (!healthFill) return;
    const max = this.playerMaxHealth || 100;
    healthFill.style.width = `${Math.max(0, Math.min(100, (health / max) * 100))}%`;
  }

  handleLocalDeath(attackerName) {
    this.dead = true;
    const overlay = document.getElementById('crash-overlay');
    const sub = document.getElementById('crash-sub');
    if (overlay) {
      const text = overlay.querySelector('.crash-text');
      if (text) text.textContent = attackerName ? `SHOT DOWN BY ${attackerName.toUpperCase()}` : 'SHOT DOWN!';
      overlay.style.display = 'flex';
    }
    // Respawn countdown (server respawns after RESPAWN_DELAY = 3s)
    clearInterval(this.respawnTicker);
    let left = 3;
    const tick = () => { if (sub) sub.textContent = `Respawning in ${left}…`; };
    tick();
    this.respawnTicker = setInterval(() => { left = Math.max(1, left - 1); tick(); }, 1000);
  }

  updateSpeedBar(speed) {
    const speedFill = document.querySelector('.speed-fill');
    const speedValue = document.getElementById('speed-value');
    if (!speedFill) return;
    const pct = Math.max(0, Math.min(100, (speed / GAME_CONFIG.DIVE_MAX_SPEED) * 100));
    speedFill.style.width = `${pct}%`;
    speedFill.style.backgroundColor = speed < GAME_CONFIG.STALL_RECOVER ? '#ff4444' : speed > GAME_CONFIG.MOVEMENT_SPEED * 1.3 ? '#ffaa00' : '#2ecc71';
    if (speedValue) speedValue.textContent = `${Math.round(speed * 4)} km/h`;
  }

  updateEnergyBar(energyPercent) {
    const energyFill = document.querySelector('.energy-fill');
    if (!energyFill) return;
    const c = Math.max(0, Math.min(100, energyPercent));
    energyFill.style.width = `${c}%`;
    energyFill.style.backgroundColor = c < 20 ? '#ff4444' : c < 50 ? '#ffaa00' : '#00aaff';
  }

  updateHUD() {
    if (!this.gameState || !this.localPlayer) return;

    const killsEl = document.getElementById('kills');
    const deathsEl = document.getElementById('deaths');
    if (killsEl) killsEl.textContent = this.localPlayer.kills || 0;
    if (deathsEl) deathsEl.textContent = this.localPlayer.deaths || 0;

    // Team score bar
    const scores = this.gameState.scores || { red: 0, blue: 0 };
    const redEl = document.getElementById('score-red');
    const blueEl = document.getElementById('score-blue');
    if (redEl) {
      redEl.textContent = `${TEAMS.red.short} ${scores.red}`;
      redEl.classList.toggle('mine', this.localPlayer.team === 'red');
    }
    if (blueEl) {
      blueEl.textContent = `${scores.blue} ${TEAMS.blue.short}`;
      blueEl.classList.toggle('mine', this.localPlayer.team === 'blue');
    }
    const myTeamEl = document.getElementById('my-team');
    if (myTeamEl) myTeamEl.textContent = this.localPlayer.team ? TEAMS[this.localPlayer.team].short : '';

    if (this.scoreboardOpen) this.renderScoreboard();
  }

  renderScoreboard() {
    if (!this.instruments || !this.gameState?.players) return;
    const rows = this.gameState.players.map(p => ({
      name: p.username || 'Pilot',
      team: p.team || 'red',
      kills: p.kills || 0,
      deaths: p.deaths || 0,
      isBot: !!p.isBot,
      me: p.id === this.localPlayer?.id,
    }));
    this.instruments.setScoreboard(true, rows);
  }

  setScoreboardOpen(open) {
    if (this.scoreboardOpen === open) return;
    this.scoreboardOpen = open;
    if (open) this.renderScoreboard();
    else this.instruments?.setScoreboard(false);
  }

  showGameEnd() {
    const overlay = document.getElementById('end-screen');
    if (!overlay || !this.gameState) return;

    this.hideIntermission();
    const rw = this.gameState.roundWins || this.roundWins || { red: 0, blue: 0 };
    const scores = { red: rw.red, blue: rw.blue };
    const winner = scores.red > scores.blue ? 'red' : scores.blue > scores.red ? 'blue' : null;
    const myTeam = this.localPlayer?.team;

    const title = document.getElementById('end-title');
    if (title) {
      if (!winner) {
        title.textContent = "IT'S A DRAW!";
        title.className = '';
      } else {
        title.textContent = winner === myTeam ? 'VICTORY!' : 'DEFEAT';
        title.className = winner;
      }
    }

    const scoreEl = document.getElementById('end-score');
    if (scoreEl) scoreEl.innerHTML =
      `<span class="red">${TEAMS.red.short} ${scores.red}</span> &mdash; <span class="blue">${scores.blue} ${TEAMS.blue.short}</span> <span style="font-size:0.7em;color:#90a4ae">rounds</span>`;

    const statsEl = document.getElementById('end-stats');
    if (statsEl && this.localPlayer) {
      statsEl.textContent =
        `You: ${this.localPlayer.kills || 0} kills / ${this.localPlayer.deaths || 0} deaths`;
    }

    const reasonEl = document.getElementById('end-reason');
    if (reasonEl) {
      const target = this.rules.tdmTarget || 30;
      const winName = winner ? TEAMS[winner].village : '';
      reasonEl.textContent = winner
        ? `${winName} takes the Cup ${scores.red}–${scores.blue} in rounds · ${TEAMS[winner === 'red' ? 'blue' : 'red'].village} serves the flour`
        : 'Rounds split evenly · both villages bake';
    }
    const mvpEl = document.getElementById('end-mvp');
    const mvp = this.gameState.mvp;
    if (mvpEl) mvpEl.textContent = mvp
      ? `Top pilot: ${mvp.username}${mvp.isBot ? ' (BOT)' : ''} · ${mvp.kills} kills / ${mvp.deaths} deaths` : '';

    // XP and rank progress
    const winBonus = winner === myTeam ? 200 : 50;
    this.addPopup(winBonus, winner === myTeam ? 'VICTORY' : 'MATCH COMPLETE');
    const before = this.totalXp();
    this.bankXp();
    const after = before + this.sessionXp;
    const xpEl = document.getElementById('end-xp');
    if (xpEl) {
      const lvBefore = this.levelFor(before), lvAfter = this.levelFor(after);
      const unlocked = this.unlocksBetween(lvBefore, lvAfter);
      xpEl.textContent = `+${this.sessionXp.toLocaleString()} XP · Lv ${lvAfter} ${this.rankFor(after)} (${after.toLocaleString()} XP)` +
        (lvAfter > lvBefore ? ' · LEVEL UP!' : '') + (unlocked.length ? ` · Unlocked: ${unlocked.join(', ')}` : '');
    }
    const medalsEl = document.getElementById('end-medals');
    if (medalsEl) {
      const counts = {};
      for (const m of this.medalsEarned) counts[m] = (counts[m] || 0) + 1;
      const list = Object.entries(counts).map(([m, n]) => n > 1 ? `${m} ×${n}` : m);
      medalsEl.textContent = list.length ? `Medals: ${list.join(' · ')}` : 'No medals this time — go get a Double Kill';
    }

    this.controlsEnabled = false;
    overlay.style.display = 'flex';
  }
}
