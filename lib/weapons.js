// Server-authoritative missiles, flares and bombs.
// installWeapons() adds the weapon methods to the Game class in
// game-server.js; the socket handlers there call fireMissile(),
// deployFlares() and dropBomb(), and tickWeapons() runs every 50 ms.

const WEAPONS = {
  TICK: 50,                     // ms between weapon simulation steps
  // Loadouts by plane class (bots fly the same classes)
  LOADOUT: {
    interceptor: { missiles: 4, flares: 3, bombs: 0, missileReload: 15000 },
    scout:       { missiles: 2, flares: 4, bombs: 0, missileReload: 20000 },
    bomber:      { missiles: 0, flares: 3, bombs: 6, missileReload: 0 },
  },
  FLARE_RELOAD: 12000,
  BOMB_RELOAD: 9000,

  // Heat-seeking missile
  MISSILE_SPEED_START: 70,
  MISSILE_SPEED_MAX: 185,
  MISSILE_ACCEL: 130,           // u/s^2 while the motor burns
  MISSILE_TURN: 1.75,           // rad/s: a hard, early break can beat it
  MISSILE_LIFETIME: 7000,
  MISSILE_HIT_RADIUS: 7,
  MISSILE_DAMAGE: 55,
  BOT_MISSILE_DAMAGE: 40,
  MISSILE_RANGE: 520,           // max launch distance the server accepts
  MISSILE_CONE: 0.75,           // rad off the nose the server accepts (client locks at ~15 deg)
  MISSILE_COOLDOWN: 900,        // ms between launches

  // Flares
  FLARE_RANGE: 450,             // missiles this close to you can be decoyed
  FLARE_DECOY_CHANCE: 0.78,
  FLARE_COOLDOWN: 900,
  DECOY_FUSE: 1600,             // ms a decoyed missile chases the flare before bursting

  // Bombs (bomber only)
  BOMB_GRAVITY: 38,
  BOMB_DRAG: 0.15,
  BOMB_RADIUS: 40,              // plane damage radius
  BOMB_DAMAGE: 70,
  BOMB_MILL_RADIUS: 55,         // a hit this close to an enemy windmill shakes their hold
  BOMB_MILL_DAMAGE: 0.5,        // capture progress removed per bomb
  BOMB_COOLDOWN: 650,

  // Bots
  BOT_MISSILE_MIN: 150,
  BOT_MISSILE_MAX: 420,
  BOT_MISSILE_INTERVAL: 15000,
  BOT_FLARE_CHANCE: 0.6,
  BOT_BOMB_INTERVAL: 5000,
};

const len3 = (v) => Math.sqrt(v.x * v.x + v.y * v.y + v.z * v.z);
const sub3 = (a, b) => ({ x: a.x - b.x, y: (a.y || 0) - (b.y || 0), z: a.z - b.z });

/** Unit forward vector of a plane from its rotation (humans send _x/_y, bots x/y) */
function forwardOf(p) {
  const r = p.rotation || {};
  const yaw = r._y !== undefined ? r._y : (r.y || 0);
  const pitch = r._x !== undefined ? r._x : (r.x || 0);
  const cp = Math.cos(pitch);
  return { x: -Math.sin(yaw) * cp, y: Math.sin(pitch), z: -Math.cos(yaw) * cp };
}

/** Rotates unit vector `dir` toward unit vector `want` by at most `maxAngle` */
function steer(dir, want, maxAngle) {
  const dot = Math.max(-1, Math.min(1, dir.x * want.x + dir.y * want.y + dir.z * want.z));
  const ang = Math.acos(dot);
  if (ang <= maxAngle || ang < 1e-5) return { ...want };
  const t = maxAngle / ang;
  const out = { x: dir.x + (want.x - dir.x) * t, y: dir.y + (want.y - dir.y) * t, z: dir.z + (want.z - dir.z) * t };
  const l = len3(out) || 1;
  return { x: out.x / l, y: out.y / l, z: out.z / l };
}

function installWeapons(Game, { io, GAME_CONFIG, planeOf, pointSegmentDistance }) {
  const proto = Game.prototype;

  /** Full ammo for a plane's class (spawn, respawn, new round) */
  proto.refillAmmo = function (p) {
    const L = WEAPONS.LOADOUT[p.plane] || WEAPONS.LOADOUT.scout;
    p.ammo = { missiles: L.missiles, flares: L.flares, bombs: L.bombs };
    const now = Date.now();
    p.reload = { missiles: now + L.missileReload, flares: now + WEAPONS.FLARE_RELOAD, bombs: now + WEAPONS.BOMB_RELOAD };
    p.lastMissileAt = 0; p.lastFlareAt = 0; p.lastBombAt = 0;
    if (!p.isBot) io.to(p.id).emit('ammo', p.ammo);
  };

  proto.initWeapons = function () {
    this.missiles = new Map();
    this.bombs = new Map();
    this.weaponSeq = 0;
    this.weaponInterval = setInterval(() => this.tickWeapons(), WEAPONS.TICK);
  };

  proto.stopWeapons = function () {
    clearInterval(this.weaponInterval);
    this.missiles.clear();
    this.bombs.clear();
  };

  /** A plane launches a heat-seeker at targetId. Returns the missile or null. */
  proto.fireMissile = function (shooterId, targetId) {
    const p = this.players.get(shooterId);
    const t = this.players.get(targetId);
    if (!p || !t || p.health <= 0 || t.health <= 0 || t.team === p.team || !p.position || !t.position) return null;
    if (!p.ammo || p.ammo.missiles <= 0) return null;
    const now = Date.now();
    if (now - (p.lastMissileAt || 0) < WEAPONS.MISSILE_COOLDOWN) return null;
    const fwd = forwardOf(p);
    const to = sub3(t.position, p.position);
    const d = len3(to);
    if (d > WEAPONS.MISSILE_RANGE || d < 8) return null;
    const cos = (fwd.x * to.x + fwd.y * to.y + fwd.z * to.z) / d;
    if (cos < Math.cos(WEAPONS.MISSILE_CONE)) return null;

    p.ammo.missiles--;
    p.lastMissileAt = now;
    if (p.ammo.missiles < (WEAPONS.LOADOUT[p.plane] || {}).missiles) {
      const L = WEAPONS.LOADOUT[p.plane] || WEAPONS.LOADOUT.scout;
      if (p.reload.missiles < now) p.reload.missiles = now + L.missileReload;
    }
    p.hasFired = true;
    const id = `m${this.weaponSeq++}_${now % 100000}`;
    const pos = { x: p.position.x + fwd.x * 6, y: (p.position.y || 30) + fwd.y * 6 - 0.8, z: p.position.z + fwd.z * 6 };
    const m = {
      id, ownerId: shooterId, team: p.team, targetId, pos, dir: fwd,
      speed: WEAPONS.MISSILE_SPEED_START, born: now, decoy: null, decoyAt: 0, botReacted: false,
      damage: p.isBot ? WEAPONS.BOT_MISSILE_DAMAGE : WEAPONS.MISSILE_DAMAGE,
    };
    this.missiles.set(id, m);
    io.to(this.id).emit('missileLaunched', { id, ownerId: shooterId, targetId, pos, dir: fwd, speed: m.speed });
    if (!p.isBot) io.to(p.id).emit('ammo', p.ammo);
    return m;
  };

  /** Pops a flare salvo; nearby missiles chasing this plane may take the bait */
  proto.deployFlares = function (playerId) {
    const p = this.players.get(playerId);
    if (!p || p.health <= 0 || !p.ammo || p.ammo.flares <= 0) return false;
    const now = Date.now();
    if (now - (p.lastFlareAt || 0) < WEAPONS.FLARE_COOLDOWN) return false;
    p.ammo.flares--;
    p.lastFlareAt = now;
    if (p.reload.flares < now) p.reload.flares = now + WEAPONS.FLARE_RELOAD;
    const vel = p.vel || { x: 0, y: 0, z: 0 };
    io.to(this.id).emit('flares', { playerId, pos: { ...p.position }, vel });
    for (const [, m] of this.missiles) {
      if (m.targetId !== playerId || m.decoy) continue;
      if (len3(sub3(m.pos, p.position)) > WEAPONS.FLARE_RANGE || now - m.born < 300) continue;
      if (Math.random() < WEAPONS.FLARE_DECOY_CHANCE) {
        m.decoy = {
          pos: { x: p.position.x, y: p.position.y, z: p.position.z },
          vel: { x: vel.x * 0.4 + (Math.random() - 0.5) * 12, y: -6, z: vel.z * 0.4 + (Math.random() - 0.5) * 12 },
        };
        m.decoyAt = now;
        m.targetId = null;
        io.to(this.id).emit('missileDecoyed', { id: m.id, targetId: playerId });
      }
    }
    if (!p.isBot) io.to(p.id).emit('ammo', p.ammo);
    return true;
  };

  /** Bomber releases a bomb that falls with the plane's momentum */
  proto.dropBomb = function (playerId) {
    const p = this.players.get(playerId);
    if (!p || p.health <= 0 || p.plane !== 'bomber' || !p.ammo || p.ammo.bombs <= 0 || !p.position) return null;
    const now = Date.now();
    if (now - (p.lastBombAt || 0) < WEAPONS.BOMB_COOLDOWN) return null;
    p.ammo.bombs--;
    p.lastBombAt = now;
    if (p.reload.bombs < now) p.reload.bombs = now + WEAPONS.BOMB_RELOAD;
    p.hasFired = true;
    const id = `b${this.weaponSeq++}_${now % 100000}`;
    const v = p.vel || { x: 0, y: 0, z: 0 };
    const b = {
      id, ownerId: playerId, team: p.team,
      pos: { x: p.position.x, y: (p.position.y || 30) - 1.5, z: p.position.z },
      vel: { x: v.x, y: Math.min(0, v.y || 0), z: v.z },
    };
    this.bombs.set(id, b);
    io.to(this.id).emit('bombDropped', { id, ownerId: playerId, pos: b.pos, vel: b.vel });
    if (!p.isBot) io.to(p.id).emit('ammo', p.ammo);
    return b;
  };

  proto.explodeMissile = function (m, hitId) {
    this.missiles.delete(m.id);
    io.to(this.id).emit('missileExplode', { id: m.id, pos: m.pos, hit: hitId || null });
  };

  proto.tickWeapons = function () {
    if (this.status === 'ended') return;
    const now = Date.now();
    const dt = WEAPONS.TICK / 1000;
    const live = this.isLive();

    // Ammo trickles back
    for (const [, p] of this.players) {
      if (!p.ammo || p.health <= 0) continue;
      const L = WEAPONS.LOADOUT[p.plane] || WEAPONS.LOADOUT.scout;
      let changed = false;
      if (p.ammo.missiles < L.missiles && L.missileReload && now >= p.reload.missiles) {
        p.ammo.missiles++; changed = true; p.reload.missiles = now + L.missileReload;
      }
      if (p.ammo.flares < L.flares && now >= p.reload.flares) {
        p.ammo.flares++; changed = true; p.reload.flares = now + WEAPONS.FLARE_RELOAD;
      }
      if (p.ammo.bombs < L.bombs && now >= p.reload.bombs) {
        p.ammo.bombs++; changed = true; p.reload.bombs = now + WEAPONS.BOMB_RELOAD;
      }
      if (changed && !p.isBot) io.to(p.id).emit('ammo', p.ammo);
    }

    // Missiles: accelerate, steer toward a lead point, sweep-test for hits
    for (const [, m] of this.missiles) {
      const age = now - m.born;
      if (age > WEAPONS.MISSILE_LIFETIME || !live) { this.explodeMissile(m, null); continue; }
      let aim = null;
      if (m.decoy) {
        m.decoy.vel.y -= 9.8 * dt;
        m.decoy.pos.x += m.decoy.vel.x * dt; m.decoy.pos.y += m.decoy.vel.y * dt; m.decoy.pos.z += m.decoy.vel.z * dt;
        aim = m.decoy.pos;
        if (now - m.decoyAt > WEAPONS.DECOY_FUSE) { this.explodeMissile(m, null); continue; }
      } else if (m.targetId) {
        const t = this.players.get(m.targetId);
        if (!t || t.health <= 0 || !t.position) {
          m.targetId = null;
        } else {
          const to = sub3(t.position, m.pos);
          const tgo = len3(to) / Math.max(60, m.speed);
          const v = t.vel || { x: 0, y: 0, z: 0 };
          aim = { x: t.position.x + v.x * tgo * 0.8, y: (t.position.y || 30) + (v.y || 0) * tgo * 0.8, z: t.position.z + v.z * tgo * 0.8 };
          // Bots under fire may pop flares once, after a human-ish reaction time
          if (t.isBot && !m.botReacted && len3(to) < 230) {
            m.botReacted = true;
            if (Math.random() < WEAPONS.BOT_FLARE_CHANCE) {
              setTimeout(() => this.deployFlares(t.id), 250 + Math.random() * 500);
            }
          }
        }
      }
      m.speed = Math.min(WEAPONS.MISSILE_SPEED_MAX, m.speed + WEAPONS.MISSILE_ACCEL * dt);
      if (aim) {
        const want = sub3(aim, m.pos);
        const l = len3(want) || 1;
        m.dir = steer(m.dir, { x: want.x / l, y: want.y / l, z: want.z / l }, WEAPONS.MISSILE_TURN * dt);
      }
      const prev = { ...m.pos };
      m.pos.x += m.dir.x * m.speed * dt; m.pos.y += m.dir.y * m.speed * dt; m.pos.z += m.dir.z * m.speed * dt;
      if (m.pos.y <= 0.5) { m.pos.y = 0.5; this.explodeMissile(m, null); continue; }

      let hit = null;
      for (const [id, t] of this.players) {
        if (t.team === m.team || t.health <= 0 || !t.position) continue;
        if (pointSegmentDistance(t.position, prev, m.pos) <= WEAPONS.MISSILE_HIT_RADIUS) { hit = t; break; }
      }
      if (hit) {
        const attacker = this.players.get(m.ownerId);
        const killed = attacker ? this.handlePlayerHit(m.ownerId, hit.id, m.damage, 'missile') : false;
        this.explodeMissile(m, hit.id);
        io.to(this.id).emit('playerHit', {
          attackerId: m.ownerId, targetId: hit.id, damage: m.damage, killed, projectileId: null, weapon: 'missile',
          targetHealth: hit.health, attackerKills: attacker ? attacker.kills : 0, targetDeaths: hit.deaths,
          gameState: { scores: this.scores, timeRemaining: GAME_CONFIG.MATCH_DURATION - (Date.now() - this.startTime) },
        });
      }
    }
    if (this.missiles.size) {
      const list = [];
      for (const [, m] of this.missiles) list.push({ id: m.id, x: m.pos.x, y: m.pos.y, z: m.pos.z, vx: m.dir.x * m.speed, vy: m.dir.y * m.speed, vz: m.dir.z * m.speed, t: m.targetId });
      io.to(this.id).emit('missiles', list);
    }

    // Bombs: ballistic fall, then a blast on the ground
    for (const [, b] of this.bombs) {
      b.vel.y -= WEAPONS.BOMB_GRAVITY * dt;
      const drag = Math.exp(-WEAPONS.BOMB_DRAG * dt);
      b.vel.x *= drag; b.vel.z *= drag;
      b.pos.x += b.vel.x * dt; b.pos.y += b.vel.y * dt; b.pos.z += b.vel.z * dt;
      if (b.pos.y > 0) continue;
      b.pos.y = 0;
      this.bombs.delete(b.id);
      this.bombImpact(b, live);
    }
  };

  /** Ground blast: splash damage to low planes, and a dent in an enemy windmill's hold */
  proto.bombImpact = function (b, live) {
    const attacker = this.players.get(b.ownerId);
    const hits = [];
    if (live) {
      for (const [id, t] of this.players) {
        if (t.team === b.team || t.health <= 0 || !t.position) continue;
        const d = len3(sub3(t.position, b.pos));
        if (d > WEAPONS.BOMB_RADIUS) continue;
        const dmg = Math.round(WEAPONS.BOMB_DAMAGE * (1 - (d / WEAPONS.BOMB_RADIUS) * 0.7));
        const killed = attacker ? this.handlePlayerHit(b.ownerId, id, dmg, 'bomb') : false;
        hits.push(id);
        io.to(this.id).emit('playerHit', {
          attackerId: b.ownerId, targetId: id, damage: dmg, killed, projectileId: null, weapon: 'bomb',
          targetHealth: t.health, attackerKills: attacker ? attacker.kills : 0, targetDeaths: t.deaths,
          gameState: { scores: this.scores, timeRemaining: GAME_CONFIG.MATCH_DURATION - (Date.now() - this.startTime) },
        });
      }
    }
    let millId = null, neutralized = false;
    if (live && this.mode === 'domination') {
      for (const mill of this.windmills) {
        if (!mill.team || mill.team === b.team) continue;
        if (Math.hypot(mill.x - b.pos.x, mill.z - b.pos.z) > WEAPONS.BOMB_MILL_RADIUS) continue;
        mill.progress = Math.max(0, mill.progress - WEAPONS.BOMB_MILL_DAMAGE);
        millId = mill.id;
        if (mill.progress <= 0.001) {
          mill.team = null; mill.progress = 0; mill.contestingTeam = null; mill.capturedAt = 0;
          neutralized = true;
        }
        this.broadcastWindmillState();
        break;
      }
    }
    io.to(this.id).emit('bombExplode', { id: b.id, ownerId: b.ownerId, pos: b.pos, hits, millId, neutralized });
  };

  /** Bot weapon choices, called from tickBots for each living bot */
  proto.botWeapons = function (bot, enemy, enemyDist3d, headingError, now) {
    if (!bot.ammo) return;
    // Missiles: a lined-up enemy at medium range, now and then
    if (enemy && bot.ammo.missiles > 0 && now > (bot.nextMissileAt || 0) &&
        enemyDist3d > WEAPONS.BOT_MISSILE_MIN && enemyDist3d < WEAPONS.BOT_MISSILE_MAX &&
        Math.abs(headingError) < 0.3 && !(!enemy.isBot && (enemy.kills || 0) < 2) && Math.random() < 0.05) {
      if (this.fireMissile(bot.id, enemy.id)) bot.nextMissileAt = now + WEAPONS.BOT_MISSILE_INTERVAL * (0.8 + Math.random() * 0.5);
    }
    // Bombers: drop on enemy-held windmills they fly over
    if (bot.plane === 'bomber' && bot.ammo.bombs > 0 && this.mode === 'domination' && now > (bot.nextBombAt || 0)) {
      for (const mill of this.windmills) {
        if (!mill.team || mill.team === bot.team) continue;
        if (Math.hypot(mill.x - bot.position.x, mill.z - bot.position.z) < 22) {
          if (this.dropBomb(bot.id)) bot.nextBombAt = now + WEAPONS.BOT_BOMB_INTERVAL;
          break;
        }
      }
    }
  };

  return WEAPONS;
}

module.exports = { installWeapons, WEAPONS, forwardOf };
