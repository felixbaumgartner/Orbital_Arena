const express = require('express');
const { createServer } = require('http');
const { Server } = require('socket.io');
const path = require('path');

const app = express();
const httpServer = createServer(app);
const io = new Server(httpServer);

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

// Debug logs for static file serving
console.log('Current working directory:', process.cwd());
console.log('Public directory path:', path.join(process.cwd(), 'public'));

// Serve static files
app.use(express.static('public'));

// Debug route to check if Express is working
app.get('/debug', (req, res) => {
  res.send('Express server is working');
});

// Debug middleware to log all requests
app.use((req, res, next) => {
  console.log('Request URL:', req.url);
  console.log('Request method:', req.method);
  next();
});

// Game state
const games = new Map();
const players = new Map();

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

    // Windmill capture tick
    this.windmillTickInterval = setInterval(() => this.tickWindmills(), GAME_CONFIG.WINDMILL_TICK_INTERVAL);

    // Windmill scoring tick
    this.windmillScoreInterval = setInterval(() => this.tickWindmillScores(), GAME_CONFIG.WINDMILL_SCORE_INTERVAL);
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
      this.scores[attacker.team]++;

      // Schedule respawn
      setTimeout(() => this.respawnPlayer(targetId), GAME_CONFIG.RESPAWN_DELAY);
      return true;
    }

    return false;
  }

  /**
   * Respawns a player at their team's spawn point
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
    }
  }

  /**
   * Processes windmill capture logic each tick
   */
  tickWindmills() {
    if (this.players.size === 0) return;

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
    if (this.players.size === 0) return;

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
    if (game.players.size < GAME_CONFIG.PLAYERS_PER_GAME && game.status === 'waiting') {
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
        }
      });

      // Notify other players
      socket.to(game.id).emit('playerJoined', game.players.get(socket.id));

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
   * Handle projectile firing
   */
  socket.on('fireProjectile', (data) => {
    try {
      const playerInfo = players.get(socket.id);
      if (!playerInfo) return;

      const game = games.get(playerInfo.gameId || data?.gameId);
      if (!game) return;

      const player = game.players.get(socket.id);
      if (!player || !data.position || !data.direction) return;

      // Relay the projectile to other players in the game
      socket.to(game.id).emit('projectileFired', {
        playerId: socket.id,
        position: data.position,
        direction: data.direction,
        projectileId: data.projectileId || `${socket.id}_${Date.now()}`
      });

    } catch (error) {
      console.error('Error in fireProjectile:', error);
    }
  });

  /**
   * Handle player hits with validation
   */
  socket.on('shoot', (data) => {
    try {
      const playerInfo = players.get(socket.id);
      if (!playerInfo) return;

      const game = games.get(playerInfo.gameId || data?.gameId);
      if (!game) return;

      const attacker = game.players.get(socket.id);
      const target = game.players.get(data.targetId);

      if (!attacker || !target) return;

      // Prevent friendly fire
      if (attacker.team === target.team) {
        console.warn(`Friendly fire attempt by ${socket.id}`);
        return;
      }

      // Validate damage
      const damage = Math.min(Math.max(0, data.damage || GAME_CONFIG.DEFAULT_DAMAGE), GAME_CONFIG.MAX_HEALTH);

      // Apply damage
      const killed = game.handlePlayerHit(socket.id, data.targetId, damage);

      // Broadcast hit to all players
      io.to(game.id).emit('playerHit', {
        attackerId: socket.id,
        targetId: data.targetId,
        damage: damage,
        killed: killed,
        gameState: {
          scores: game.scores,
          timeRemaining: GAME_CONFIG.MATCH_DURATION - (Date.now() - game.startTime)
        }
      });

    } catch (error) {
      console.error('Error in shoot handler:', error);
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

        // Remove game if empty
        if (game.players.size === 0) {
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
setInterval(() => {
  let cleanedGames = 0;
  for (const [id, game] of games) {
    if (game.isEnded() || game.players.size === 0) {
      game.destroy();
      games.delete(id);
      cleanedGames++;
    }
  }
  if (cleanedGames > 0) {
    console.log(`Cleaned up ${cleanedGames} ended/empty games`);
  }
}, 60000); // Run every minute

// Error handling for the server
httpServer.on('error', (error) => {
  console.error('Server error:', error);
  if (error.code === 'EADDRINUSE') {
    console.error(`Port ${PORT} is already in use`);
    process.exit(1);
  }
});

// Graceful shutdown
process.on('SIGTERM', () => {
  console.log('SIGTERM received, shutting down gracefully');
  httpServer.close(() => {
    console.log('Server closed');
    process.exit(0);
  });
});

process.on('SIGINT', () => {
  console.log('SIGINT received, shutting down gracefully');
  httpServer.close(() => {
    console.log('Server closed');
    process.exit(0);
  });
});

// Start server
const PORT = process.env.PORT || 5000;
httpServer.listen(PORT, () => {
  console.log(`
═══════════════════════════════════════
  Orbital Arena Server
  Port: ${PORT}
  Environment: ${process.env.NODE_ENV || 'development'}
  Max players per game: ${GAME_CONFIG.PLAYERS_PER_GAME}
  Match duration: ${GAME_CONFIG.MATCH_DURATION / 1000}s
═══════════════════════════════════════
  `);
}); 