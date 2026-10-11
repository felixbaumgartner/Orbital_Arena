// Progression that lasts: a pilot identity (with a code to carry it to
// another device), a lifetime career record, three daily challenges, and a
// cloud profile plus leaderboard when the server has storage configured.
// Everything also works offline, saved in this browser.
// Methods are mixed into the Game class (see game.js); `this` is the Game.

/** The daily challenge pool; three are drawn per (UTC) day for everyone */
const CHALLENGES = [
  { id: 'kills5', text: 'Shoot down 5 planes', goal: 5, stat: 'kills', xp: 300 },
  { id: 'kills12', text: 'Shoot down 12 planes', goal: 12, stat: 'kills', xp: 600 },
  { id: 'missile2', text: 'Down 2 planes with missiles', goal: 2, stat: 'missileKills', xp: 400 },
  { id: 'capture3', text: 'Capture 3 windmills', goal: 3, stat: 'captures', xp: 400 },
  { id: 'win1', text: 'Win a match', goal: 1, stat: 'wins', xp: 500 },
  { id: 'rounds2', text: 'Win 2 rounds', goal: 2, stat: 'roundsWon', xp: 350 },
  { id: 'long1', text: 'Land a Long Shot', goal: 1, stat: 'longShots', xp: 300 },
  { id: 'double1', text: 'Score a Double Kill', goal: 1, stat: 'multiKills', xp: 450 },
  { id: 'evade2', text: 'Shake off 2 missiles with flares', goal: 2, stat: 'evades', xp: 400 },
  { id: 'millbomb2', text: 'Bomb enemy windmills twice', goal: 2, stat: 'millBombs', xp: 400 },
  { id: 'medals4', text: 'Earn 4 medals', goal: 4, stat: 'medals', xp: 300 },
  { id: 'matches2', text: 'Fly 2 full matches', goal: 2, stat: 'matches', xp: 250 },
  { id: 'bomber1', text: 'Finish a match flying the Bomber', goal: 1, stat: 'bomberMatches', xp: 300 },
  { id: 'interceptor1', text: 'Finish a match flying the Interceptor', goal: 1, stat: 'interceptorMatches', xp: 300 },
  { id: 'scout1', text: 'Finish a match flying the Scout', goal: 1, stat: 'scoutMatches', xp: 250 },
];

const CAREER_KEYS = ['matches', 'wins', 'kills', 'deaths', 'missileKills', 'bombKills', 'captures', 'roundsWon', 'bestStreak', 'medals'];

const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const today = () => new Date().toISOString().slice(0, 10);

function hex(n) {
  const b = new Uint8Array(n);
  crypto.getRandomValues(b);
  return Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('');
}

function uuid() {
  if (crypto.randomUUID) return crypto.randomUUID();
  const h = hex(16);
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-4${h.slice(13, 16)}-a${h.slice(17, 20)}-${h.slice(20, 32)}`;
}

export class CareerMethods {
  // =========================================================================
  // CAREER: pilot identity, record, daily challenges, cloud profile
  // =========================================================================

  initCareer() {
    this.pilot = this.loadPilot();
    this.career = this.loadJSON('dvf.career', {});
    for (const k of CAREER_KEYS) if (typeof this.career[k] !== 'number') this.career[k] = 0;
    this.daily = this.loadDaily();
    this.challengeXpThisMatch = 0;
    this.cloud = { status: 'unknown', profile: null, board: null };
    this.careerTab = 'daily';
  }

  loadJSON(key, fallback) {
    try { const v = JSON.parse(localStorage.getItem(key) || 'null'); return v && typeof v === 'object' ? v : fallback; } catch (e) { return fallback; }
  }

  saveJSON(key, value) {
    try { localStorage.setItem(key, JSON.stringify(value)); } catch (e) { /* private mode */ }
  }

  /** This browser's pilot: a random id and secret (made on first visit) */
  loadPilot() {
    const p = this.loadJSON('dvf.pilot', null);
    if (p && /^[0-9a-f-]{36}$/i.test(p.id) && /^[0-9a-f]{32,64}$/i.test(p.secret)) return p;
    const fresh = { id: uuid(), secret: hex(24) };
    this.saveJSON('dvf.pilot', fresh);
    return fresh;
  }

  /** A code that moves this pilot to another device */
  pilotCode() {
    return btoa(`${this.pilot.id}:${this.pilot.secret}`).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  }

  restorePilotCode(code) {
    try {
      const raw = atob(String(code).trim().replace(/-/g, '+').replace(/_/g, '/'));
      const [id, secret] = raw.split(':');
      if (!/^[0-9a-f-]{36}$/i.test(id) || !/^[0-9a-f]{32,64}$/i.test(secret)) return false;
      this.pilot = { id, secret };
      this.saveJSON('dvf.pilot', this.pilot);
      this.fetchCloud();
      return true;
    } catch (e) {
      return false;
    }
  }

  /** Today's three challenges (the same draw for every pilot) */
  loadDaily() {
    const d = this.loadJSON('dvf.daily', null);
    if (d && d.date === today() && Array.isArray(d.ids)) return d;
    let seed = 0;
    for (const ch of today()) seed = (seed * 31 + ch.charCodeAt(0)) >>> 0;
    const rnd = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; };
    const ids = [], stats = new Set();
    let guard = 0;
    while (ids.length < 3 && guard++ < 100) {
      const c = CHALLENGES[Math.floor(rnd() * CHALLENGES.length)];
      if (ids.includes(c.id) || stats.has(c.stat)) continue;
      ids.push(c.id); stats.add(c.stat);
    }
    const fresh = { date: today(), ids, progress: {}, done: {} };
    this.saveJSON('dvf.daily', fresh);
    return fresh;
  }

  /**
   * Something happened that counts: updates the lifetime record and today's
   * challenges (a finished challenge pays out at once).
   */
  careerEvent(stat, n = 1) {
    if (!this.career) return;
    if (CAREER_KEYS.includes(stat)) {
      if (stat === 'bestStreak') this.career.bestStreak = Math.max(this.career.bestStreak, n);
      else this.career[stat] += n;
      this.saveJSON('dvf.career', this.career);
    }
    if (this.daily.date !== today()) this.daily = this.loadDaily();
    for (const id of this.daily.ids) {
      const c = CHALLENGES.find((x) => x.id === id);
      if (!c || c.stat !== stat || this.daily.done[id]) continue;
      this.daily.progress[id] = Math.min(c.goal, (this.daily.progress[id] || 0) + n);
      if (this.daily.progress[id] >= c.goal) {
        this.daily.done[id] = true;
        this.payChallenge(c);
      }
    }
    this.saveJSON('dvf.daily', this.daily);
  }

  /** Challenge XP is banked immediately so it survives a closed tab */
  payChallenge(c) {
    this.challengeXpThisMatch += c.xp;
    try { localStorage.setItem('dvf.xp', String(this.totalXp() + c.xp)); } catch (e) { /* ignore */ }
    if (this.instruments) {
      this.instruments.popup(c.xp, 'CHALLENGE');
      this.instruments.medal('🏅', 'DAILY CHALLENGE', c.text);
    }
    this.playSound('medal');
    this.stinger('levelUp');
  }

  /** Match over: count it, then send our XP tally for the server to record */
  onCareerMatchEnd(won) {
    this.careerEvent('matches');
    if (won) this.careerEvent('wins');
    if (this.planeClass) this.careerEvent(`${this.planeClass}Matches`);
    if (this.socket && this.isConnected) {
      this.socket.emit('matchResult', { xp: (this.sessionXp || 0) + (this.challengeXpThisMatch || 0) });
    }
    this.renderEndChallenges();
  }

  /** The server saved our match: adopt the authoritative profile */
  onProfileUpdated(r) {
    if (!r || !r.profile) return;
    this.cloud.profile = r.profile;
    this.cloud.status = 'on';
    if (r.profile.xp > this.totalXp()) {
      try { localStorage.setItem('dvf.xp', String(r.profile.xp)); } catch (e) { /* ignore */ }
    }
    const el = document.getElementById('end-cloud');
    if (el) el.textContent = `☁️ Saved to your pilot record · ${r.profile.xp.toLocaleString()} XP total`;
  }

  /** Loads the cloud profile and leaderboard over a short-lived connection */
  fetchCloud() {
    let socket;
    try { socket = this.openSocket(); } catch (e) { return; }
    const done = () => { try { socket.close(); } catch (e) { /* ignore */ } };
    const timer = setTimeout(() => { if (this.cloud.status === 'unknown') this.cloud.status = 'offline'; this.renderCareer(); done(); }, 12000);
    socket.on('connect', () => {
      socket.emit('profile:get', { pilotId: this.pilot.id, secret: this.pilot.secret }, (r) => {
        if (!r || r.cloud === false) this.cloud.status = 'off';
        else if (r.error) this.cloud.status = r.error === 'wrong-secret' ? 'wrong' : 'offline';
        else {
          this.cloud.status = 'on';
          this.cloud.profile = r.profile;
          // A pilot restored on a new device gets their level back
          if (r.profile && r.profile.xp > this.totalXp()) {
            try { localStorage.setItem('dvf.xp', String(r.profile.xp)); } catch (e) { /* ignore */ }
            this.refreshLoginRank();
          }
        }
        this.renderCareer();
        socket.emit('leaderboard:get', {}, (lb) => {
          this.cloud.board = lb && lb.cloud ? lb.rows || [] : null;
          this.renderCareer();
          clearTimeout(timer);
          done();
        });
      });
    });
    socket.on('connect_error', () => { this.cloud.status = 'offline'; this.renderCareer(); clearTimeout(timer); done(); });
  }

  refreshLoginRank() {
    const rankEl = document.getElementById('login-rank');
    if (rankEl) {
      const xp = this.totalXp();
      rankEl.textContent = `Lv ${this.levelFor(xp)} · ${this.rankFor(xp)} · ${xp.toLocaleString()} XP`;
    }
    this.setupHangar();
  }

  setupCareerPanel() {
    const root = document.getElementById('career');
    if (!root) return;
    root.querySelectorAll('.career-tabs button').forEach((b) => {
      b.addEventListener('click', () => {
        this.careerTab = b.dataset.tab;
        root.querySelectorAll('.career-tabs button').forEach((x) => x.classList.toggle('on', x === b));
        this.renderCareer();
      });
    });
    this.renderCareer();
    this.fetchCloud();
  }

  renderCareer() {
    const body = document.getElementById('career-body');
    if (!body) return;
    const cloudNote = {
      on: '☁️ Your progress is saved online and on this device.',
      off: '💾 Progress is saved on this device. Use your pilot code to move it to another one.',
      offline: '📡 Couldn\'t reach the record office. Progress is still saved on this device.',
      wrong: '⚠️ That pilot code doesn\'t match the saved record.',
      unknown: '…checking the record office',
    }[this.cloud.status] || '';
    if (this.careerTab === 'daily') {
      if (this.daily.date !== today()) this.daily = this.loadDaily();
      const rows = this.daily.ids.map((id) => {
        const c = CHALLENGES.find((x) => x.id === id);
        if (!c) return '';
        const n = this.daily.progress[id] || 0, done = !!this.daily.done[id];
        return `<div class="ch-row${done ? ' done' : ''}"><div class="ch-top"><span>${done ? '✅ ' : ''}${esc(c.text)}</span><span class="ch-xp">${done ? 'Done' : `+${c.xp} XP`}</span></div>`
          + `<div class="ch-bar"><i style="width:${Math.round((n / c.goal) * 100)}%"></i></div></div>`;
      }).join('');
      const left = new Date(); left.setUTCHours(24, 0, 0, 0);
      const hrs = Math.max(0, Math.round((left - new Date()) / 3600000));
      body.innerHTML = `${rows}<div class="career-note">New challenges in ${hrs} h · ${cloudNote}</div>`;
    } else if (this.careerTab === 'record') {
      const c = this.cloud.profile ? {
        matches: this.cloud.profile.matches, wins: this.cloud.profile.wins, kills: this.cloud.profile.kills,
        deaths: this.cloud.profile.deaths, missileKills: this.cloud.profile.missile_kills, bombKills: this.cloud.profile.bomb_kills,
        captures: this.cloud.profile.captures, bestStreak: this.cloud.profile.best_streak, roundsWon: this.cloud.profile.rounds_won,
      } : this.career;
      const kd = c.deaths ? (c.kills / c.deaths).toFixed(2) : c.kills.toFixed(0);
      const cell = (k, v) => `<div><span>${k}</span><b>${esc(v)}</b></div>`;
      body.innerHTML = `<div class="rec-grid">${cell('Matches', c.matches || 0)}${cell('Wins', c.wins || 0)}${cell('Kills', c.kills || 0)}${cell('K/D', kd)}`
        + `${cell('Missile kills', c.missileKills || 0)}${cell('Bomb kills', c.bombKills || 0)}${cell('Windmills', c.captures || 0)}${cell('Best streak', c.bestStreak || 0)}</div>`
        + `<div class="career-note">${this.cloud.profile ? 'From your online record.' : 'Recorded on this device.'} ${cloudNote}</div>`;
    } else if (this.careerTab === 'board') {
      if (!this.cloud.board) {
        body.innerHTML = `<div class="career-note">${this.cloud.status === 'off'
          ? 'The online leaderboard isn\'t switched on for this server yet. Your record is kept on this device.'
          : this.cloud.status === 'unknown' ? '…loading the leaderboard' : 'The leaderboard is out of reach right now.'}</div>`;
      } else if (!this.cloud.board.length) {
        body.innerHTML = '<div class="career-note">No pilots on the board yet. Finish a match to claim the top spot.</div>';
      } else {
        const me = this.cloud.profile && this.cloud.profile.name;
        body.innerHTML = `<table class="lb-table">${this.cloud.board.map((r, i) => `<tr class="${r.name === me ? 'me' : ''}"><td>${i + 1}</td><td>${esc(r.name)}</td><td class="num">Lv ${r.level}</td><td class="num">${(r.xp || 0).toLocaleString()} XP</td><td class="num">${r.wins || 0} W</td></tr>`).join('')}</table>`;
      }
    } else {
      body.innerHTML = `<div class="career-note" style="margin-top:0">Your pilot code carries your level and record to another browser or device. Keep it private: anyone with it can fly as you.</div>`
        + `<input type="text" id="pilot-code" readonly value="${esc(this.pilotCode())}">`
        + `<button class="small-btn" id="pilot-copy">Copy code</button>`
        + `<input type="text" id="pilot-restore" placeholder="Paste a pilot code to restore">`
        + `<button class="small-btn" id="pilot-load">Restore</button><span id="pilot-msg" class="career-note"></span>`;
      document.getElementById('pilot-copy')?.addEventListener('click', () => {
        const el = document.getElementById('pilot-code');
        el.select();
        try { navigator.clipboard.writeText(el.value); } catch (e) { document.execCommand && document.execCommand('copy'); }
        document.getElementById('pilot-msg').textContent = ' Copied';
      });
      document.getElementById('pilot-load')?.addEventListener('click', () => {
        const ok = this.restorePilotCode(document.getElementById('pilot-restore').value);
        document.getElementById('pilot-msg').textContent = ok ? ' Restored · loading your record…' : ' That isn\'t a valid pilot code';
      });
    }
  }

  /** Daily challenge lines on the end screen */
  renderEndChallenges() {
    const el = document.getElementById('end-challenges');
    if (!el || !this.daily) return;
    el.innerHTML = this.daily.ids.map((id) => {
      const c = CHALLENGES.find((x) => x.id === id);
      if (!c) return '';
      const n = this.daily.progress[id] || 0, done = !!this.daily.done[id];
      return `<div class="${done ? 'done' : ''}">${done ? '✅' : '◻️'} ${esc(c.text)} · ${n}/${c.goal}</div>`;
    }).join('');
    const cloud = document.getElementById('end-cloud');
    if (cloud && !cloud.textContent) cloud.textContent = this.cloud.status === 'on' ? '☁️ Saving to your pilot record…' : '💾 Saved on this device';
  }
}
