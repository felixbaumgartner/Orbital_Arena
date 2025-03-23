const express = require('express');
const { createServer } = require('http');
const { Server } = require('socket.io');
const path = require('path');

const app = express();
const httpServer = createServer(app);
const io = new Server(httpServer);

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

// Game constants
const PLAYERS_PER_GAME = 6;
const TEAM_SIZE = 3;
const RESPAWN_DELAY = 3000;
const MATCH_DURATION = 300000; // 5 minutes

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
  }

  addPlayer(player) {
    // Assign team based on current team sizes
    const team = this.teams.red.size <= this.teams.blue.size ? 'red' : 'blue';
    this.teams[team].add(player.id);
    this.players.set(player.id, {
      ...player,
      team,
      health: 100,
      energy: 100,
      position: this.getRandomSpawnPosition(team),
      rotation: { x: 0, y: 0, z: 0 },
      kills: 0,
      assists: 0,
      deaths: 0,
    });

    return team;
  }

  removePlayer(playerId) {
    const player = this.players.get(playerId);
    if (player) {
      this.teams[player.team].delete(playerId);
      this.players.delete(playerId);
    }
  }

  getRandomSpawnPosition(team) {
    // Team-based spawn positions
    const basePosition = team === 'red' ? 
      { x: -100, y: 0, z: 0 } : 
      { x: 100, y: 0, z: 0 };
    
    return {
      x: basePosition.x + (Math.random() - 0.5) * 20,
      y: basePosition.y + (Math.random() - 0.5) * 20,
      z: basePosition.z + (Math.random() - 0.5) * 20,
    };
  }

  updatePlayerPosition(playerId, position, rotation) {
    const player = this.players.get(playerId);
    if (player) {
      player.position = position;
      player.rotation = rotation;
    }
  }

  handlePlayerHit(attackerId, targetId, damage) {
    const target = this.players.get(targetId);
    if (target && target.health > 0) {
      target.health -= damage;
      if (target.health <= 0) {
        // Player killed
        const attacker = this.players.get(attackerId);
        if (attacker) {
          attacker.kills++;
          target.deaths++;
          this.scores[attacker.team]++;
          
          // Schedule respawn
          setTimeout(() => this.respawnPlayer(targetId), RESPAWN_DELAY);
        }
        return true;
      }
    }
    return false;
  }

  respawnPlayer(playerId) {
    const player = this.players.get(playerId);
    if (player) {
      player.health = 100;
      player.energy = 100;
      player.position = this.getRandomSpawnPosition(player.team);
      player.rotation = { x: 0, y: 0, z: 0 };
    }
  }

  isEnded() {
    return Date.now() - this.startTime >= MATCH_DURATION;
  }

  getGameState() {
    return {
      id: this.id,
      players: Array.from(this.players.values()),
      scores: this.scores,
      timeRemaining: Math.max(0, MATCH_DURATION - (Date.now() - this.startTime)),
      status: this.status,
    };
  }
}

// Find or create a game for a player
function findOrCreateGame() {
  for (const [id, game] of games) {
    if (game.players.size < PLAYERS_PER_GAME && game.status === 'waiting') {
      return game;
    }
  }
  
  const gameId = `game_${Date.now()}`;
  const newGame = new Game(gameId);
  games.set(gameId, newGame);
  return newGame;
}

// Socket.IO event handling
io.on('connection', (socket) => {
  console.log('Client connected');

  socket.on('joinGame', (username) => {
    console.log(`${username} attempting to join game`);
    
    // Find or create a game
    let game = findOrCreateGame();
    if (!game) {
      game = new Game(`game_${Date.now()}`);
      games.set(game.id, game);
    }
    
    // Create player
    const player = {
      id: socket.id,
      username: username,
      position: { x: 0, y: 0, z: 0 },
      rotation: { x: 0, y: 0, z: 0 }
    };
    
    // Add player to game
    const team = game.addPlayer(player);
    players.set(socket.id, { gameId: game.id, username });
    
    // Join socket room for this game
    socket.join(game.id);
    
    console.log(`${username} joined game ${game.id} on team ${team}`);
    
    // Send game joined event with required data structure
    socket.emit('gameJoined', {
      player: game.players.get(socket.id),
      gameState: {
        id: game.id,
        players: Array.from(game.players.values()),
        scores: game.scores,
        timeRemaining: MATCH_DURATION - (Date.now() - game.startTime)
      }
    });
    
    // Notify other players
    socket.to(game.id).emit('playerJoined', game.players.get(socket.id));
  });

  // Handle player position updates
  socket.on('position', (data) => {
    const playerInfo = players.get(socket.id);
    if (playerInfo) {
      const game = games.get(playerInfo.gameId || data.gameId);
      if (game) {
        const player = game.players.get(socket.id);
        if (player) {
          // Update player position
          player.position = data.position;
          player.rotation = data.rotation;
          
          // Broadcast to other players
          socket.to(game.id).emit('playerMoved', {
            id: socket.id,
            position: player.position,
            rotation: player.rotation,
            username: player.username,
            team: player.team
          });
        }
      }
    }
  });
  
  // Handle projectile firing
  socket.on('fireProjectile', (data) => {
    const player = players.get(socket.id);
    if (player) {
      const game = games.get(player.gameId || data.gameId);
      if (game) {
        // Relay the projectile to other players in the game
        socket.to(game.id).emit('projectileFired', {
          playerId: socket.id,
          position: data.position,
          direction: data.direction,
          projectileId: data.projectileId
        });
      }
    }
  });
  
  // Handle player hits
  socket.on('shoot', (data) => {
    const playerInfo = players.get(socket.id);
    if (playerInfo) {
      const game = games.get(playerInfo.gameId || data.gameId);
      if (game) {
        const targetPlayer = game.players.get(data.targetId);
        if (targetPlayer) {
          // Damage target player
          targetPlayer.health -= data.damage;
          
          // Update score on every hit
          const attackerTeam = game.players.get(socket.id).team;
          game.scores[attackerTeam]++;
          
          // Check if player is killed
          const killed = targetPlayer.health <= 0;
          if (killed) {
            // Respawn player
            targetPlayer.health = 100;
            targetPlayer.position = game.getRandomSpawnPosition(targetPlayer.team);
          }
          
          // Broadcast hit to all players
          io.to(game.id).emit('playerHit', {
            attackerId: socket.id,
            targetId: data.targetId,
            damage: data.damage,
            killed: killed,
            gameState: {
              scores: game.scores,
              timeRemaining: MATCH_DURATION - (Date.now() - game.startTime)
            }
          });
        }
      }
    }
  });

  socket.on('disconnect', () => {
    const playerInfo = players.get(socket.id);
    if (playerInfo) {
      const game = games.get(playerInfo.gameId);
      if (game) {
        // Remove player from game
        game.removePlayer(socket.id);
        
        // Notify other players
        socket.to(game.id).emit('playerLeft', socket.id);
        
        console.log(`Player ${playerInfo.username} disconnected from game ${game.id}`);
        
        // Remove game if empty
        if (game.players.size === 0) {
          games.delete(game.id);
          console.log(`Game ${game.id} removed due to no players`);
        }
      }
      
      // Remove player from server
      players.delete(socket.id);
    }
  });
});

// Start server
const PORT = process.env.PORT || 5000;
httpServer.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
}); 