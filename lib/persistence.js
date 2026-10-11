// Pilot profiles and the leaderboard.
//
// Backends, picked from the environment:
//  - Supabase (production): SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY. Uses
//    the REST API with the service key, server-side only; see
//    supabase/schema.sql. Browsers never talk to the database.
//  - File (local development): PILOT_STORE_FILE=./data/pilots.json
//  - None: cloud features report themselves as off; play is unaffected.
//
// The server records results it witnessed (kills, wins, captures...). XP
// claimed by a client is capped by what those results could have earned.
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const SUPABASE_URL = (process.env.SUPABASE_URL || '').replace(/\/$/, '');
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || '';
const STORE_FILE = process.env.PILOT_STORE_FILE || '';

const BACKEND = SUPABASE_URL && SUPABASE_KEY ? 'supabase' : STORE_FILE ? 'file' : 'none';

const sha256 = (s) => crypto.createHash('sha256').update(String(s)).digest('hex');
const isUuid = (s) => typeof s === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(s);
const isSecret = (s) => typeof s === 'string' && /^[0-9a-f]{32,64}$/i.test(s);

const STAT_FIELDS = ['matches', 'wins', 'kills', 'deaths', 'missile_kills', 'bomb_kills', 'captures', 'rounds_won'];
/** Three daily challenges pay at most this much XP per pilot per day */
const DAILY_CHALLENGE_XP = 1800;

function levelFor(xp) { return Math.min(30, Math.floor(Math.sqrt(xp / 400)) + 1); }

function emptyRow(id, name, secretHash) {
  return {
    id, name, secret_hash: secretHash, xp: 0, level: 1, best_streak: 0,
    matches: 0, wins: 0, kills: 0, deaths: 0, missile_kills: 0, bomb_kills: 0, captures: 0, rounds_won: 0,
    challenge_day: null, challenge_xp: 0,
    updated_at: new Date().toISOString(),
  };
}

// ---------------------------------------------------------------- backends

const fileStore = {
  data: null,
  load() {
    if (this.data) return this.data;
    try { this.data = JSON.parse(fs.readFileSync(STORE_FILE, 'utf8')); } catch (e) { this.data = { pilots: {} }; }
    return this.data;
  },
  save() {
    fs.mkdirSync(path.dirname(path.resolve(STORE_FILE)), { recursive: true });
    fs.writeFileSync(STORE_FILE, JSON.stringify(this.data, null, 1));
  },
  async get(id) { return this.load().pilots[id] || null; },
  async put(row) { this.load().pilots[row.id] = row; this.save(); },
  async top(limit) {
    return Object.values(this.load().pilots).sort((a, b) => b.xp - a.xp).slice(0, limit);
  },
};

const supabaseStore = {
  headers(extra = {}) {
    return { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}`, 'Content-Type': 'application/json', ...extra };
  },
  async get(id) {
    const res = await fetch(`${SUPABASE_URL}/rest/v1/pilots?id=eq.${encodeURIComponent(id)}&select=*`, { headers: this.headers() });
    if (!res.ok) throw new Error(`pilot read ${res.status}`);
    const rows = await res.json();
    return rows[0] || null;
  },
  async put(row) {
    const res = await fetch(`${SUPABASE_URL}/rest/v1/pilots`, {
      method: 'POST',
      headers: this.headers({ Prefer: 'resolution=merge-duplicates,return=minimal' }),
      body: JSON.stringify(row),
    });
    if (!res.ok) throw new Error(`pilot write ${res.status} ${await res.text()}`);
  },
  async top(limit) {
    const res = await fetch(`${SUPABASE_URL}/rest/v1/pilots?select=name,xp,level,kills,wins,matches,best_streak&order=xp.desc&limit=${limit}`, { headers: this.headers() });
    if (!res.ok) throw new Error(`leaderboard ${res.status}`);
    return res.json();
  },
};

const store = BACKEND === 'supabase' ? supabaseStore : BACKEND === 'file' ? fileStore : null;

// ---------------------------------------------------------------- API

/** Public view of a profile (never the secret hash) */
function publicProfile(row) {
  if (!row) return null;
  const out = { name: row.name, xp: row.xp, level: row.level, best_streak: row.best_streak };
  for (const f of STAT_FIELDS) out[f] = row[f] || 0;
  return out;
}

/** Loads a pilot after checking the secret. Unknown pilots get an empty profile. */
async function getProfile(pilotId, secret) {
  if (!store) return { cloud: false };
  if (!isUuid(pilotId) || !isSecret(secret)) return { cloud: true, error: 'bad-pilot' };
  const row = await store.get(pilotId);
  if (!row) return { cloud: true, profile: null };
  if (row.secret_hash !== sha256(secret)) return { cloud: true, error: 'wrong-secret' };
  return { cloud: true, profile: publicProfile(row) };
}

/**
 * Adds one finished match to a pilot. `stats` are what the server saw;
 * `claimedXp` is the client's tally (medals, challenges), capped here.
 */
async function recordMatch(pilotId, secret, name, stats, claimedXp) {
  if (!store || !isUuid(pilotId) || !isSecret(secret)) return null;
  const hash = sha256(secret);
  let row = await store.get(pilotId);
  if (row && row.secret_hash !== hash) return null;
  if (!row) row = emptyRow(pilotId, name, hash);
  // What these results could honestly be worth (kills with medals, captures,
  // the result, round wins). Anything claimed above that is daily-challenge
  // XP, allowed up to DAILY_CHALLENGE_XP per pilot per (UTC) day.
  const perf = 300 + stats.kills * 450 + stats.captures * 200 + stats.rounds_won * 100 + (stats.won ? 200 : 50);
  const base = stats.kills * 100 + stats.captures * 150 + (stats.won ? 200 : 50);
  const claimed = Math.max(0, Math.round(Number(claimedXp) || 0));
  const day = new Date().toISOString().slice(0, 10);
  if (row.challenge_day !== day) { row.challenge_day = day; row.challenge_xp = 0; }
  const extra = Math.min(Math.max(0, claimed - perf), Math.max(0, DAILY_CHALLENGE_XP - (row.challenge_xp || 0)));
  row.challenge_xp = (row.challenge_xp || 0) + extra;
  const xp = Math.max(base, Math.min(perf, claimed) + extra);
  row.name = name || row.name;
  row.xp = (row.xp || 0) + xp;
  row.level = levelFor(row.xp);
  row.matches = (row.matches || 0) + 1;
  row.wins = (row.wins || 0) + (stats.won ? 1 : 0);
  for (const f of ['kills', 'deaths', 'missile_kills', 'bomb_kills', 'captures', 'rounds_won']) row[f] = (row[f] || 0) + (stats[f] || 0);
  row.best_streak = Math.max(row.best_streak || 0, stats.best_streak || 0);
  row.updated_at = new Date().toISOString();
  await store.put(row);
  return { xpAwarded: xp, profile: publicProfile(row) };
}

async function leaderboard(limit = 20) {
  if (!store) return { cloud: false, rows: [] };
  const rows = await store.top(limit);
  return { cloud: true, rows: rows.map((r) => ({ name: r.name, xp: r.xp, level: r.level, kills: r.kills, wins: r.wins, matches: r.matches, best_streak: r.best_streak })) };
}

module.exports = { BACKEND, getProfile, recordMatch, leaderboard, isUuid, isSecret };
