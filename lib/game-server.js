// Game server logic shared by the local Express server (server.js)
// and the Vercel Function (api/socket-io.js).

// Game constants
const GAME_CONFIG = {
  PLAYERS_PER_GAME: 6,
  TEAM_SIZE: 3,
  RESPAWN_DELAY: 3000,
  MATCH_DURATION: 300000, // 5 minutes

  // Movement and position limits (no bounds - infinite world)
  MAX_POSITION_CHANGE_PER_FRAME: 50, // Relaxed for free flight

  // Validation
  USERNAME_MAX_LENGTH: 15,
  USERNAME_MIN_LENGTH: 1,
  CHAT_MESSAGE_MAX_LENGTH: 200,

  // Damage and health
  DEFAULT_DAMAGE: 10,
  MAX_HEALTH: 100,
  MAX_ENERGY: 100,
  CRASH_DAMAGE: 20,

  // AI bots (fill empty slots so the arena is never dead)
  BOT_TICK_INTERVAL: 100,   // ms between bot AI ticks
  BOT_SPEED: 46,            // slightly slower than players (50) so humans can disengage
  BOT_TURN_RATE: 2.0,       // rad/s
  BOT_CLIMB_RATE: 14,       // vertical units/s
  BOT_ENGAGE_RANGE: 170,    // starts chasing enemies within this range
  BOT_FIRE_RANGE: 120,
  BOT_FIRE_CONE: 0.25,      // rad — must roughly face the target to shoot
  BOT_FIRE_COOLDOWN: 900,   // ms
  BOT_AIM_ERROR: 0.055,     // rad of random spread — keeps bots beatable
  BOT_MAX_ALTITUDE: 60,     // bots give up chasing above this (escape valve)
  NEWCOMER_GRACE: 45000,    // ms bots leave a fresh human alone (until they shoot)
  KILL_SCORE: 5,            // team points per shoot-down (windmills give 1 per tick)
  BOT_NAMES: ['Daan', 'Femke', 'Bram', 'Lotte', 'Jesse', 'Sanne', 'Ruben', 'Anouk', 'Thijs', 'Maud', 'Koen', 'Fleur'],

  // Projectiles (server-side hit detection)
  PROJECTILE_SPEED: 220,          // must match client GAME_CONFIG.PROJECTILE_SPEED
  PROJECTILE_LIFETIME: 1500,      // ms (~330 units at 220 u/s, matches client despawn dist)
  HIT_RADIUS: 6,                  // plane collision radius (4) + margin for netcode (bot shots)
  HIT_RADIUS_HUMAN: 9,            // human shots get a more forgiving hit box
  PROJECTILE_TICK_INTERVAL: 100,  // ms between projectile simulation ticks

  // Windmill capture
  CAPTURE_RADIUS: 50,
  CAPTURE_RATE: 0.2, // progress per second (1.0 = captured)
  CAPTURE_DECAY: 0.1,
  WINDMILL_SCORE_INTERVAL: 5000, // ms between score ticks
  WINDMILL_TICK_INTERVAL: 500,   // ms between capture ticks
};

const CAPTURE_WINDMILLS = [
  { id: 'mill_n', x: 0, z: -300, name: 'North' },
  { id: 'mill_s', x: 0, z: 300, name: 'South' },
  { id: 'mill_e', x: 300, z: 0, name: 'East' },
  { id: 'mill_w', x: -300, z: 0, name: 'West' },
  { id: 'mill_c', x: 200, z: -200, name: 'Hill' },
];

/**
 * Validates username format and length
 * @param {string} username - Username to validate
 * @returns {boolean} Whether username is valid
 */
function isValidUsername(username) {
  if (!username || typeof username !== 'string') return false;
  if (username.length < GAME_CONFIG.USERNAME_MIN_LENGTH ||
      username.length > GAME_CONFIG.USERNAME_MAX_LENGTH) return false;
  return /^[a-zA-Z0-9 ]+$/.test(username);
}

/**
 * Sanitizes user input to prevent XSS
 * @param {string} input - Input to sanitize
 * @returns {string} Sanitized input
 */
function sanitizeInput(input) {
  if (typeof input !== 'string') return '';
  return input.replace(/[<>]/g, '');
}

/**
 * Validates position has valid numeric coordinates
 * @param {object} position - Position object with x, y, z
 * @returns {boolean} Whether position is valid
 */
function isValidPosition(position) {
  if (!position || typeof position !== 'object') return false;
  if (typeof position.x !== 'number' || typeof position.z !== 'number') return false;
  if (!isFinite(position.x) || !isFinite(position.z)) return false;
  return true;
}

/**
 * Validates a direction vector has finite numeric components
 * @param {object} direction - Direction object with x, y, z
 * @returns {boolean} Whether direction is valid
 */
function isValidDirection(direction) {
  if (!direction || typeof direction !== 'object') return false;
  return ['x', 'y', 'z'].every(axis =>
    typeof direction[axis] === 'number' && isFinite(direction[axis]));
}

/**
 * Sanitizes position values
 * @param {object} position - Position object with x, y, z
 * @returns {object} Sanitized position
 */
function clampPosition(position) {
  return {
    x: isFinite(position.x) ? position.x : 0,
    y: position.y || 0,
    z: isFinite(position.z) ? position.z : 0,
  };
}

/**
 * Distance from point p to the segment [a, b] in 3D.
 * Used for projectile hit detection so fast projectiles can't tunnel
 * through a plane between two ticks.
 */
function pointSegmentDistance(p, a, b) {
  const abx = b.x - a.x, aby = b.y - a.y, abz = b.z - a.z;
  const apx = p.x - a.x, apy = p.y - a.y, apz = p.z - a.z;
  const abLenSq = abx * abx + aby * aby + abz * abz;
  let t = abLenSq > 0 ? (apx * abx + apy * aby + apz * abz) / abLenSq : 0;
  t = Math.max(0, Math.min(1, t));
  const dx = p.x - (a.x + abx * t);
  const dy = p.y - (a.y + aby * t);
  const dz = p.z - (a.z + abz * t);
  return Math.sqrt(dx * dx + dy * dy + dz * dz);
}

/**
 * Attaches all game state and socket handlers to a Socket.IO server.
 * @param {import('socket.io').Server} io - Socket.IO server instance
 */
function attachGameServer(io) {
  // Game state
  const games = new Map();
  const players = new Map();

  /**
   * Game class representing a single game instance
   */
  class Game {
    constructor(id) {
      this.id = id;
      this.players = new Map();
      this.teams = {
        red: new Set(),
        blue: new Set(),
      };
      this.scores = {
        red: 0,
        blue: 0,
      };
      this.startTime = Date.now();
      this.status = 'waiting'; // waiting, playing, ended

      // Windmill capture state
      this.windmills = CAPTURE_WINDMILLS.map(w => ({
        id: w.id, x: w.x, z: w.z, name: w.name,
        team: null,
        progress: 0,
        contestingTeam: null,
      }));

      // Live projectiles for server-side hit detection
      this.projectiles = new Map();

      // Windmill capture tick
      this.windmillTickInterval = setInterval(() => this.tickWindmills(), GAME_CONFIG.WINDMILL_TICK_INTERVAL);

      // Windmill scoring tick
      this.windmillScoreInterval = setInterval(() => this.tickWindmillScores(), GAME_CONFIG.WINDMILL_SCORE_INTERVAL);

      // Projectile simulation tick
      this.projectileTickInterval = setInterval(() => this.tickProjectiles(), GAME_CONFIG.PROJECTILE_TICK_INTERVAL);

      // AI bot tick
      this.botCounter = 0;
      this.botTickInterval = setInterval(() => this.tickBots(), GAME_CONFIG.BOT_TICK_INTERVAL);
    }

    /** Restarts the clock, scores and windmills for a fresh match */
    resetMatch() {
      this.startTime = Date.now();
      this.scores = { red: 0, blue: 0 };
      for (const mill of this.windmills) {
        mill.team = null;
        mill.progress = 0;
        mill.contestingTeam = null;
      }
      for (const [, p] of this.players) {
        p.kills = 0;
        p.deaths = 0;
      }
    }

    /**
     * Counts human (non-bot) players in the game
     * @returns {number} Number of real players
     */
    realPlayerCount() {
      let n = 0;
      for (const [, p] of this.players) {
        if (!p.isBot) n++;
      }
      return n;
    }

    /**
     * Fills empty player slots with AI bots so matches are never empty
     */
    fillBots() {
      while (this.players.size < GAME_CONFIG.PLAYERS_PER_GAME) {
        const name = GAME_CONFIG.BOT_NAMES[this.botCounter % GAME_CONFIG.BOT_NAMES.length];
        const id = `bot_${this.id}_${this.botCounter++}`;
        this.addPlayer({
          id,
          username: name,
          position: { x: 0, y: 0, z: 0 },
          rotation: { x: 0, y: 0, z: 0 },
        });
        const bot = this.players.get(id);
        bot.isBot = true;
        bot.position.y = 28 + Math.random() * 10;
        bot.heading = Math.random() * Math.PI * 2;
        bot.waypoint = null;
        bot.waypointUntil = 0;
        bot.lastFire = 0;
        io.to(this.id).emit('playerJoined', bot);
      }
    }

    /**
     * Removes one bot to make room for a joining human player
     * @returns {boolean} Whether a bot was removed
     */
    removeOneBot() {
      for (const [id, p] of this.players) {
        if (p.isBot) {
          this.removePlayer(id);
          io.to(this.id).emit('playerLeft', id);
          return true;
        }
      }
      return false;
    }

    /**
     * AI update for all bots: pick a target (enemy in range, else an
     * uncaptured windmill, else wander), steer toward it, and shoot when
     * lined up on an enemy.
     */
    tickBots() {
      if (this.status === 'ended') return;
      const now = Date.now();
      const dt = GAME_CONFIG.BOT_TICK_INTERVAL / 1000;

      for (const [id, bot] of this.players) {
        if (!bot.isBot || bot.health <= 0) continue;

        // Nearest living enemy below the pursuit ceiling
        let enemy = null;
        let enemyDist = Infinity;
        for (const [oid, other] of this.players) {
          if (oid === id || other.team === bot.team || other.health <= 0) continue;
          if (!other.position || other.position.y > GAME_CONFIG.BOT_MAX_ALTITUDE) continue;
          // Newcomers get a quiet first minute to learn the controls
          if (!other.isBot && !other.hasFired && now - other.joinedAt < GAME_CONFIG.NEWCOMER_GRACE) continue;
          const dx = other.position.x - bot.position.x;
          const dz = other.position.z - bot.position.z;
          const d = Math.sqrt(dx * dx + dz * dz);
          if (d < enemyDist) {
            enemyDist = d;
            enemy = other;
          }
        }

        // Decide where to fly
        let tx, tz, ty;
        if (enemy && enemyDist < GAME_CONFIG.BOT_ENGAGE_RANGE) {
          tx = enemy.position.x;
          tz = enemy.position.z;
          ty = Math.max(12, Math.min(GAME_CONFIG.BOT_MAX_ALTITUDE, enemy.position.y || 30));
        } else {
          // Objective: nearest windmill the bot's team doesn't own
          let mill = null;
          let millDist = Infinity;
          for (const m of this.windmills) {
            if (m.team === bot.team) continue;
            const dx = m.x - bot.position.x;
            const dz = m.z - bot.position.z;
            const d = Math.sqrt(dx * dx + dz * dz);
            if (d < millDist) {
              millDist = d;
              mill = m;
            }
          }
          if (mill) {
            if (millDist < GAME_CONFIG.CAPTURE_RADIUS * 0.7) {
              // Orbit inside the capture ring while progress ticks
              const ang = Math.atan2(bot.position.z - mill.z, bot.position.x - mill.x) + 0.9;
              tx = mill.x + Math.cos(ang) * 35;
              tz = mill.z + Math.sin(ang) * 35;
            } else {
              tx = mill.x;
              tz = mill.z;
            }
            ty = 26;
          } else {
            // Team owns everything — wander near the arena center
            if (!bot.waypoint || now > bot.waypointUntil) {
              bot.waypoint = { x: (Math.random() - 0.5) * 700, z: (Math.random() - 0.5) * 700 };
              bot.waypointUntil = now + 8000;
            }
            tx = bot.waypoint.x;
            tz = bot.waypoint.z;
            ty = 30;
          }
        }

        // Steer: turn toward the target at a limited rate, then advance.
        // Heading convention matches the client (forward = -sin/-cos).
        const desired = Math.atan2(-(tx - bot.position.x), -(tz - bot.position.z));
        let dh = desired - bot.heading;
        dh = Math.atan2(Math.sin(dh), Math.cos(dh));
        const maxTurn = GAME_CONFIG.BOT_TURN_RATE * dt;
        const turn = Math.max(-maxTurn, Math.min(maxTurn, dh));
        bot.heading += turn;

        bot.position.x -= Math.sin(bot.heading) * GAME_CONFIG.BOT_SPEED * dt;
        bot.position.z -= Math.cos(bot.heading) * GAME_CONFIG.BOT_SPEED * dt;
        const dy = ty - bot.position.y;
        const maxClimb = GAME_CONFIG.BOT_CLIMB_RATE * dt;
        bot.position.y += Math.max(-maxClimb, Math.min(maxClimb, dy));

        const bank = (turn / maxTurn || 0) * 0.5;
        bot.rotation = { x: 0, y: bot.heading, z: bank };
        bot.lastPosition = { ...bot.position };

        // Shoot when roughly lined up on an enemy in range
        // Rookie humans (fewer than 2 kills) face slower, sloppier bot gunnery
        const rookie = enemy && !enemy.isBot && (enemy.kills || 0) < 2;
        if (enemy && enemyDist < GAME_CONFIG.BOT_FIRE_RANGE &&
            Math.abs(dh) < GAME_CONFIG.BOT_FIRE_CONE &&
            now - bot.lastFire > GAME_CONFIG.BOT_FIRE_COOLDOWN * (rookie ? 1.8 : 1)) {
          bot.lastFire = now;
          const spread = GAME_CONFIG.BOT_AIM_ERROR * (rookie ? 2.4 : 1);
          const err = () => (Math.random() - 0.5) * 2 * spread;
          const dx = enemy.position.x - bot.position.x;
          const dyv = (enemy.position.y || 30) - bot.position.y;
          const dz = enemy.position.z - bot.position.z;
          const len = Math.sqrt(dx * dx + dyv * dyv + dz * dz) || 1;
          const dir = { x: dx / len + err(), y: dyv / len + err() * 0.5, z: dz / len + err() };
          const projectileId = `${id}_${now}`;
          this.addProjectile(projectileId, id, { ...bot.position }, dir);
          io.to(this.id).emit('projectileFired', {
            playerId: id,
            position: { ...bot.position },
            direction: dir,
            projectileId,
          });
        }
      }

      // Broadcast bot positions to the room
      for (const [id, bot] of this.players) {
        if (!bot.isBot || bot.health <= 0) continue;
        io.to(this.id).emit('playerMoved', {
          id,
          position: bot.position,
          rotation: bot.rotation,
          username: bot.username,
          team: bot.team,
          energy: 100,
        });
      }
    }

    /**
     * Adds a player to the game and assigns them to a team
     * @param {object} player - Player object with id and username
     * @returns {string} The team the player was assigned to ('red' or 'blue')
     */
    addPlayer(player) {
      // Assign team based on current team sizes
      const team = this.teams.red.size <= this.teams.blue.size ? 'red' : 'blue';
      this.teams[team].add(player.id);
      this.players.set(player.id, {
        ...player,
        team,
        health: GAME_CONFIG.MAX_HEALTH,
        energy: GAME_CONFIG.MAX_ENERGY,
        position: this.getRandomSpawnPosition(team),
        rotation: { x: 0, y: 0, z: 0 },
        kills: 0,
        assists: 0,
        deaths: 0,
        lastPosition: null, // For teleport detection
        joinedAt: Date.now(),
        hasFired: false,
      });

      return team;
    }

    /**
     * Removes a player from the game
     * @param {string} playerId - Socket ID of the player
     */
    removePlayer(playerId) {
      const player = this.players.get(playerId);
      if (player) {
        this.teams[player.team].delete(playerId);
        this.players.delete(playerId);
      }
      // Drop their in-flight projectiles
      for (const [id, projectile] of this.projectiles) {
        if (projectile.ownerId === playerId) this.projectiles.delete(id);
      }
    }

    /**
     * Generates a random spawn position for a team
     * @param {string} team - Team name ('red' or 'blue')
     * @returns {object} Position object with x, y, z coordinates
     */
    getRandomSpawnPosition(team) {
      // Team-based spawn positions
      const basePosition = team === 'red'
        ? { x: -50, y: 0, z: 0 }
        : { x: 50, y: 0, z: 0 };

      return {
        x: basePosition.x + (Math.random() - 0.5) * 20,
        y: basePosition.y,
        z: basePosition.z + (Math.random() - 0.5) * 20,
      };
    }

    /**
     * Updates player position with validation
     * @param {string} playerId - Socket ID of the player
     * @param {object} position - New position
     * @param {object} rotation - New rotation
     * @param {number} energy - Current energy level
     * @returns {boolean} Whether the update was successful
     */
    updatePlayerPosition(playerId, position, rotation, energy) {
      const player = this.players.get(playerId);
      if (!player) return false;

      // Validate position
      if (!isValidPosition(position)) {
        console.warn(`Invalid position for player ${playerId}:`, position);
        return false;
      }

      // Detect teleportation (anti-cheat)
      if (player.lastPosition) {
        const dx = position.x - player.lastPosition.x;
        const dz = position.z - player.lastPosition.z;
        const distance = Math.sqrt(dx * dx + dz * dz);

        if (distance > GAME_CONFIG.MAX_POSITION_CHANGE_PER_FRAME) {
          console.warn(`Teleport detected for player ${playerId}, distance: ${distance}`);
          // Clamp position instead of rejecting
          position = clampPosition(position);
        }
      }

      player.position = position;
      player.rotation = rotation;
      player.lastPosition = { ...position };

      if (typeof energy === 'number') {
        player.energy = Math.max(0, Math.min(GAME_CONFIG.MAX_ENERGY, energy));
      }

      return true;
    }

    /**
     * Registers a projectile for server-side simulation
     * @param {string} projectileId - Unique projectile identifier
     * @param {string} ownerId - Socket ID of the shooter
     * @param {object} position - Spawn position {x, y, z}
     * @param {object} direction - Unit direction vector {x, y, z}
     */
    addProjectile(projectileId, ownerId, position, direction) {
      const owner = this.players.get(ownerId);
      if (!owner) return;

      // Normalize direction defensively (client should already send a unit vector)
      const len = Math.sqrt(direction.x ** 2 + direction.y ** 2 + direction.z ** 2);
      if (!isFinite(len) || len === 0) return;

      this.projectiles.set(projectileId, {
        ownerId,
        team: owner.team,
        position: { x: position.x, y: position.y || 0, z: position.z },
        direction: { x: direction.x / len, y: direction.y / len, z: direction.z / len },
        firedAt: Date.now(),
        lastTick: Date.now(),
      });
    }

    /**
     * Advances all projectiles and applies hits to enemy players
     */
    tickProjectiles() {
      if (this.status === 'ended' || this.projectiles.size === 0) return;

      const now = Date.now();

      for (const [projectileId, projectile] of this.projectiles) {
        // Expire old projectiles
        if (now - projectile.firedAt > GAME_CONFIG.PROJECTILE_LIFETIME) {
          this.projectiles.delete(projectileId);
          continue;
        }

        const dt = (now - projectile.lastTick) / 1000;
        projectile.lastTick = now;

        const prev = { ...projectile.position };
        projectile.position.x += projectile.direction.x * GAME_CONFIG.PROJECTILE_SPEED * dt;
        projectile.position.y += projectile.direction.y * GAME_CONFIG.PROJECTILE_SPEED * dt;
        projectile.position.z += projectile.direction.z * GAME_CONFIG.PROJECTILE_SPEED * dt;

        // Human-fired shots use the friendlier hit radius
        const owner = this.players.get(projectile.ownerId);
        const hitRadius = owner && !owner.isBot ? GAME_CONFIG.HIT_RADIUS_HUMAN : GAME_CONFIG.HIT_RADIUS;

        // Check the swept path against every living enemy (prevents tunneling)
        for (const [targetId, target] of this.players) {
          if (targetId === projectile.ownerId) continue;
          if (target.team === projectile.team) continue; // No friendly fire
          if (target.health <= 0) continue;
          if (!target.position) continue;

          const dist = pointSegmentDistance(target.position, prev, projectile.position);
          if (dist <= hitRadius) {
            this.projectiles.delete(projectileId);

            const killed = this.handlePlayerHit(projectile.ownerId, targetId, GAME_CONFIG.DEFAULT_DAMAGE);
            const attacker = this.players.get(projectile.ownerId);

            io.to(this.id).emit('playerHit', {
              attackerId: projectile.ownerId,
              targetId,
              damage: GAME_CONFIG.DEFAULT_DAMAGE,
              killed,
              projectileId,
              targetHealth: target.health,
              attackerKills: attacker ? attacker.kills : 0,
              targetDeaths: target.deaths,
              gameState: {
                scores: this.scores,
                timeRemaining: GAME_CONFIG.MATCH_DURATION - (Date.now() - this.startTime),
              },
            });
            break;
          }
        }
      }
    }

    /**
     * Handles a player hitting another player
     * @param {string} attackerId - Socket ID of attacker
     * @param {string} targetId - Socket ID of target
     * @param {number} damage - Damage amount
     * @returns {boolean} Whether the target was killed
     */
    handlePlayerHit(attackerId, targetId, damage) {
      const target = this.players.get(targetId);
      const attacker = this.players.get(attackerId);

      if (!target || !attacker || target.health <= 0) return false;

      // Validate damage amount
      const validDamage = Math.min(Math.max(0, damage), GAME_CONFIG.MAX_HEALTH);
      target.health = Math.max(0, target.health - validDamage);

      if (target.health <= 0) {
        // Player killed
        attacker.kills++;
        target.deaths++;
        this.scores[attacker.team] += GAME_CONFIG.KILL_SCORE;

        // Schedule respawn
        setTimeout(() => this.respawnPlayer(targetId), GAME_CONFIG.RESPAWN_DELAY);
        return true;
      }

      return false;
    }

    /**
     * Respawns a player at their team's spawn point and notifies clients
     * @param {string} playerId - Socket ID of the player
     */
    respawnPlayer(playerId) {
      const player = this.players.get(playerId);
      if (player) {
        player.health = GAME_CONFIG.MAX_HEALTH;
        player.energy = GAME_CONFIG.MAX_ENERGY;
        player.position = this.getRandomSpawnPosition(player.team);
        player.rotation = { x: 0, y: 0, z: 0 };
        player.lastPosition = null;

        io.to(this.id).emit('playerRespawn', {
          playerId,
          position: player.position,
          health: player.health,
          energy: player.energy,
        });
      }
    }

    /**
     * Processes windmill capture logic each tick
     */
    tickWindmills() {
      if (this.players.size === 0) return;

      // Match end: announce once, then freeze all game systems
      if (this.status !== 'ended' && this.isEnded()) {
        this.status = 'ended';
        io.to(this.id).emit('gameEnd', this.getGameState());
        console.log(`Game ${this.id} ended — Red ${this.scores.red} : Blue ${this.scores.blue}`);
        return;
      }
      if (this.status === 'ended') return;

      let changed = false;
      const tickSeconds = GAME_CONFIG.WINDMILL_TICK_INTERVAL / 1000;

      for (const mill of this.windmills) {
        const nearbyTeams = { red: 0, blue: 0 };

        for (const [, player] of this.players) {
          const dx = player.position.x - mill.x;
          const dz = player.position.z - mill.z;
          const dist = Math.sqrt(dx * dx + dz * dz);
          if (dist <= GAME_CONFIG.CAPTURE_RADIUS) {
            nearbyTeams[player.team]++;
          }
        }

        const redNear = nearbyTeams.red > 0;
        const blueNear = nearbyTeams.blue > 0;

        if (redNear && blueNear) {
          // Contested — no progress change
          continue;
        }

        const capturingTeam = redNear ? 'red' : blueNear ? 'blue' : null;

        if (!capturingTeam) {
          // No one near — slowly decay uncaptured progress
          if (mill.team === null && mill.progress > 0) {
            mill.progress = Math.max(0, mill.progress - GAME_CONFIG.CAPTURE_DECAY * tickSeconds);
            if (mill.progress === 0) mill.contestingTeam = null;
            changed = true;
          }
          continue;
        }

        if (mill.team === capturingTeam) continue; // Already own it

        if (mill.contestingTeam !== capturingTeam) {
          // New team is contesting, reset progress
          mill.contestingTeam = capturingTeam;
          mill.progress = 0;
          changed = true;
        }

        mill.progress = Math.min(1, mill.progress + GAME_CONFIG.CAPTURE_RATE * tickSeconds);
        changed = true;

        if (mill.progress >= 1) {
          mill.team = capturingTeam;
          mill.progress = 1;
          console.log(`Windmill ${mill.name} captured by team ${capturingTeam} in game ${this.id}`);
        }
      }

      if (changed) {
        this.broadcastWindmillState();
      }
    }

    /**
     * Awards score points for owned windmills
     */
    tickWindmillScores() {
      if (this.status === 'ended' || this.players.size === 0) return;

      let scored = false;
      for (const mill of this.windmills) {
        if (mill.team) {
          this.scores[mill.team]++;
          scored = true;
        }
      }

      if (scored) {
        // Broadcast updated scores
        io.to(this.id).emit('windmillScore', { scores: this.scores });
      }
    }

    /**
     * Broadcasts windmill state to all players in the game
     */
    broadcastWindmillState() {
      io.to(this.id).emit('windmillUpdate', { windmills: this.windmills });
    }

    /**
     * Cleans up intervals when game is destroyed
     */
    destroy() {
      if (this.windmillTickInterval) clearInterval(this.windmillTickInterval);
      if (this.windmillScoreInterval) clearInterval(this.windmillScoreInterval);
      if (this.projectileTickInterval) clearInterval(this.projectileTickInterval);
      if (this.botTickInterval) clearInterval(this.botTickInterval);
    }

    /**
     * Checks if the match has ended
     * @returns {boolean} Whether the match duration has been exceeded
     */
    isEnded() {
      return Date.now() - this.startTime >= GAME_CONFIG.MATCH_DURATION;
    }

    /**
     * Gets the current game state for broadcasting to clients
     * @returns {object} Game state object
     */
    getGameState() {
      return {
        id: this.id,
        players: Array.from(this.players.values()),
        scores: this.scores,
        timeRemaining: Math.max(0, GAME_CONFIG.MATCH_DURATION - (Date.now() - this.startTime)),
        status: this.status,
        windmills: this.windmills,
      };
    }
  }

  /**
   * Finds an available game or creates a new one
   * @returns {Game} Available game instance
   */
  function findOrCreateGame() {
    for (const [id, game] of games) {
      // Bots don't count toward capacity — they make room for humans
      if (game.realPlayerCount() < GAME_CONFIG.PLAYERS_PER_GAME && game.status === 'waiting') {
        return game;
      }
    }

    const gameId = `game_${Date.now()}`;
    const newGame = new Game(gameId);
    games.set(gameId, newGame);
    console.log(`Created new game: ${gameId}`);
    return newGame;
  }

  // Socket.IO event handling
  io.on('connection', (socket) => {
    console.log(`Client connected: ${socket.id}`);

    /**
     * Handle player joining a game
     */
    socket.on('joinGame', (username) => {
      try {
        // Validate username
        const sanitizedUsername = sanitizeInput(username);
        if (!isValidUsername(sanitizedUsername)) {
          console.warn(`Invalid username attempt: ${username}`);
          socket.emit('error', { message: 'Invalid username' });
          return;
        }

        console.log(`${sanitizedUsername} attempting to join game`);

        // Find or create a game
        const game = findOrCreateGame();
        if (!game) {
          socket.emit('error', { message: 'No available games' });
          return;
        }

        // Create player
        const player = {
          id: socket.id,
          username: sanitizedUsername,
          position: { x: 0, y: 0, z: 0 },
          rotation: { x: 0, y: 0, z: 0 }
        };

        // A game full of bots always has room for a human
        if (game.players.size >= GAME_CONFIG.PLAYERS_PER_GAME) {
          game.removeOneBot();
        }

        // First human in: start a fresh match rather than joining one the
        // bots have been playing among themselves
        if (game.realPlayerCount() === 0) game.resetMatch();

        // Add player to game
        const team = game.addPlayer(player);
        players.set(socket.id, { gameId: game.id, username: sanitizedUsername });

        // Join socket room for this game
        socket.join(game.id);

        console.log(`${sanitizedUsername} joined game ${game.id} on team ${team}`);

        // Send game joined event
        socket.emit('gameJoined', {
          player: game.players.get(socket.id),
          gameState: {
            id: game.id,
            players: Array.from(game.players.values()),
            scores: game.scores,
            timeRemaining: GAME_CONFIG.MATCH_DURATION - (Date.now() - game.startTime),
            windmills: game.windmills,
            rules: {
              killScore: GAME_CONFIG.KILL_SCORE,
              millTickSeconds: GAME_CONFIG.WINDMILL_SCORE_INTERVAL / 1000,
              matchDuration: GAME_CONFIG.MATCH_DURATION,
            },
          }
        });

        // Notify other players
        socket.to(game.id).emit('playerJoined', game.players.get(socket.id));

        // Top up the arena with AI wingmen and opponents
        game.fillBots();

      } catch (error) {
        console.error('Error in joinGame:', error);
        socket.emit('error', { message: 'Failed to join game' });
      }
    });

    /**
     * Handle player position updates with validation
     */
    socket.on('position', (data) => {
      try {
        const playerInfo = players.get(socket.id);
        if (!playerInfo) return;

        const game = games.get(playerInfo.gameId || data?.gameId);
        if (!game) return;

        // Validate and update position
        const success = game.updatePlayerPosition(
          socket.id,
          data.position,
          data.rotation,
          data.energy
        );

        if (success) {
          const player = game.players.get(socket.id);
          if (player) {
            // Broadcast to other players
            socket.to(game.id).emit('playerMoved', {
              id: socket.id,
              position: player.position,
              rotation: player.rotation,
              username: player.username,
              team: player.team,
              energy: player.energy
            });
          }
        }
      } catch (error) {
        console.error('Error in position update:', error);
      }
    });

    /**
     * Handle chat messages
     */
    socket.on('chatMessage', (data) => {
      try {
        const playerInfo = players.get(socket.id);
        if (!playerInfo) return;

        const game = games.get(playerInfo.gameId || data?.gameId);
        if (!game) return;

        // Validate and sanitize message
        const message = sanitizeInput(data.message);
        if (!message || message.length > GAME_CONFIG.CHAT_MESSAGE_MAX_LENGTH) {
          return;
        }

        const username = sanitizeInput(data.username || playerInfo.username);

        // Broadcast chat message to all players in the game
        io.to(game.id).emit('chatMessage', {
          username: username,
          message: message,
          timestamp: Date.now()
        });

        console.log(`Chat [${game.id}] ${username}: ${message}`);

      } catch (error) {
        console.error('Error in chat message:', error);
      }
    });

    /**
     * Handle projectile firing — relays the visual to other clients and
     * registers the projectile for server-side hit detection.
     */
    socket.on('fireProjectile', (data) => {
      try {
        const playerInfo = players.get(socket.id);
        if (!playerInfo) return;

        const game = games.get(playerInfo.gameId || data?.gameId);
        if (!game) return;

        const player = game.players.get(socket.id);
        if (!player || !data.position || !data.direction) return;
        if (!isValidPosition(data.position) || !isValidDirection(data.direction)) return;
        if (player.health <= 0) return; // Dead players can't shoot
        player.hasFired = true;

        const projectileId = data.projectileId || `${socket.id}_${Date.now()}`;

        // Simulate on the server for authoritative hit detection
        game.addProjectile(projectileId, socket.id, data.position, data.direction);

        // Relay the projectile to other players in the game
        socket.to(game.id).emit('projectileFired', {
          playerId: socket.id,
          position: data.position,
          direction: data.direction,
          projectileId,
        });

      } catch (error) {
        console.error('Error in fireProjectile:', error);
      }
    });

    /**
     * Handle terrain/obstacle crashes — applies real damage server-side so
     * the health bar and the server agree, and crashes can actually kill.
     */
    socket.on('crashDamage', () => {
      try {
        const playerInfo = players.get(socket.id);
        if (!playerInfo) return;

        const game = games.get(playerInfo.gameId);
        if (!game || game.status === 'ended') return;

        const player = game.players.get(socket.id);
        if (!player || player.health <= 0) return;

        player.health = Math.max(0, player.health - GAME_CONFIG.CRASH_DAMAGE);
        const died = player.health <= 0;
        if (died) {
          player.deaths++;
          setTimeout(() => game.respawnPlayer(socket.id), GAME_CONFIG.RESPAWN_DELAY);
        }
        socket.emit('healthUpdate', { health: player.health, died });
      } catch (error) {
        console.error('Error in crashDamage:', error);
      }
    });

    /**
     * Handle player disconnection
     */
    socket.on('disconnect', (reason) => {
      try {
        console.log(`Client disconnected: ${socket.id}, reason: ${reason}`);

        const playerInfo = players.get(socket.id);
        if (!playerInfo) return;

        const game = games.get(playerInfo.gameId);
        if (game) {
          // Remove player from game
          game.removePlayer(socket.id);

          // Notify other players
          socket.to(game.id).emit('playerLeft', socket.id);

          console.log(`Player ${playerInfo.username} disconnected from game ${game.id}`);

          // Remove game once no humans remain (bots don't keep games alive)
          if (game.realPlayerCount() === 0) {
            game.destroy();
            games.delete(game.id);
            console.log(`Game ${game.id} removed due to no players`);
          }
        }

        // Remove player from server
        players.delete(socket.id);

      } catch (error) {
        console.error('Error in disconnect handler:', error);
      }
    });

    /**
     * Handle socket errors
     */
    socket.on('error', (error) => {
      console.error(`Socket error for ${socket.id}:`, error);
    });
  });

  // Periodic cleanup of ended games
  const cleanupInterval = setInterval(() => {
    let cleanedGames = 0;
    for (const [id, game] of games) {
      if (game.isEnded() || game.realPlayerCount() === 0) {
        game.destroy();
        games.delete(id);
        cleanedGames++;
      }
    }
    if (cleanedGames > 0) {
      console.log(`Cleaned up ${cleanedGames} ended/empty games`);
    }
  }, 60000); // Run every minute

  return { games, players, cleanupInterval };
}

module.exports = { attachGameServer, GAME_CONFIG };
