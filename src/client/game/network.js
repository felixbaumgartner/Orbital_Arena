// Socket.IO connection and every server event.
// Methods are mixed into the Game class (see game.js); `this` is the Game.
import * as THREE from 'three';
import { io } from 'socket.io-client';
import { GAME_CONFIG, STORK_LEVEL, CAPTURE_WINDMILLS } from '../config.js';

export class NetworkMethods {
  // =========================================================================
  // NETWORKING
  // =========================================================================

  /**
   * Opens the first connection and joins a match. Every later connection
   * (a dropped link, or the scheduled swap before a serverless host ends
   * the WebSocket) goes through handoverConnection() and resumes the match.
   */
  connectToServer(username) {
    this.pilotName = username;
    if (!this.sessionId) {
      const bytes = new Uint8Array(12);
      crypto.getRandomValues(bytes);
      this.sessionId = Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
    }
    try {
      const socket = this.openSocket();
      this.socket = socket;
      socket.on('connect', () => {
        console.log('Connected to server');
        this.isConnected = true;
        this.reconnectAttempts = 0;
        this.connectedAt = performance.now();
        this.lastServerMsg = performance.now();
        if (!this.localPlayer) socket.emit('joinGame', this.joinPayload(false));
      });
      socket.on('connect_error', (error) => {
        console.error('Connection error:', error?.message || error);
        this.isConnected = false;
        if (this.localPlayer || socket !== this.socket) return; // in a match: the handover retries
        this.reconnectAttempts++;
        if (this.reconnectAttempts >= GAME_CONFIG.RECONNECT_ATTEMPTS) {
          alert('Failed to connect to server. Please refresh the page and try again.');
        } else {
          setTimeout(() => socket.connect(), GAME_CONFIG.RECONNECT_DELAY * this.reconnectAttempts);
        }
      });
      this.bindSocketEvents(socket);
    } catch (error) {
      console.error('Failed to initialize connection:', error);
      alert('Failed to connect to server. Please refresh the page.');
    }
  }

  /** A fresh Socket.IO connection (same origin unless VITE_GAME_SERVER_URL is set) */
  openSocket() {
    const opts = {
      // Matches the Socket.IO mount path used by both the local server
      // and the Vercel Function (api/socket-io.js)
      path: '/api/socket-io',
      transports: ['websocket'],
      reconnection: false,   // reconnects are handovers that resume the match
      forceNew: true,        // a handover needs a second, independent link
      timeout: 8000,
    };
    const url = import.meta.env.VITE_GAME_SERVER_URL;
    return url ? io(url, opts) : io(opts);
  }

  /** joinGame payload; with resume, it carries the match as this client sees it */
  joinPayload(resume) {
    const payload = {
      username: this.pilotName,
      mode: this.localPlayer ? this.mode : this.pendingMode,
      plane: this.localPlayer ? this.planeClass : this.pendingPlane,
      cosmetics: this.cosmetics,
      sessionId: this.sessionId,
    };
    if (resume && this.localPlayer && this.gameState) {
      payload.resume = { gameId: this.gameState.id, snapshot: this.resumeSnapshot() };
    }
    return payload;
  }

  /** Every server event, bound to one connection (the current one) */
  bindSocketEvents(socket) {
    try {
      // Any packet proves the link is alive (see updateConnection)
      socket.onAny(() => { if (socket === this.socket) this.lastServerMsg = performance.now(); });

      socket.on('disconnect', (reason) => {
        if (socket !== this.socket) return; // a connection we already replaced
        console.log('Disconnected from server:', reason);
        this.isConnected = false;
        if (this.localPlayer) this.handoverConnection('drop');
        else setTimeout(() => socket.connect(), GAME_CONFIG.RECONNECT_DELAY);
      });

      // Heartbeat: keeps the clock honest between score events
      socket.on('hb', (d) => {
        if (d && typeof d.timeRemaining === 'number' && d.phase === 'live') this.syncTimer(d.timeRemaining);
      });

      // Missiles, flares and bombs
      this.bindWeaponEvents(socket);

      socket.on('gameJoined', (data) => {
        this.gameState = data.gameState;
        this.localPlayer = data.player;
        this.syncTimer(data.gameState.timeRemaining);

        const myColor = this.getPlayerColor(data.player.id);
        const ship = this.createPlayerShip(myColor, data.player.plane, data.player.cosmetics);
        this.scene.add(ship);
        this.players.set(this.localPlayer.id, ship);
        this.markOwnPlane(ship);
        this.createTrail(data.player.id, data.player.cosmetics);
        if (data.player.cosmetics?.stork && this.levelFor(this.totalXp()) >= STORK_LEVEL) this.createStork();
        this.playerHealth = data.player.maxHealth || 100;
        this.setHealthBar(this.playerHealth);

        if (data.gameState.rules) this.rules = { ...this.rules, ...data.gameState.rules };
        this.mode = data.gameState.mode === 'tdm' ? 'tdm' : 'domination';
        this.planeClass = data.player.plane || 'scout';
        if (this.rules.planes && this.rules.planes[this.planeClass]) this.planeStats = this.rules.planes[this.planeClass];
        this.playerMaxHealth = data.player.maxHealth || this.planeStats.maxHealth || 100;
        if (data.player.ammo) this.ammo = data.player.ammo;
        this.updateWeaponsHud();
        this.round = data.gameState.round || 1;
        this.roundWins = data.gameState.roundWins || { red: 0, blue: 0 };
        this.suddenDeath = !!data.gameState.suddenDeath;
        this.applyModeHud();

        // Pre-match countdown: the server's clock is still ahead of "now"
        const total = data.gameState.rules?.matchDuration || 300000;
        if (typeof data.gameState.timeRemaining === 'number' && data.gameState.timeRemaining > total) {
          this.countdownEndsAt = performance.now() + (data.gameState.timeRemaining - total);
          this.announce(data.gameState.suddenDeath ? 'suddenDeath' : `round${data.gameState.round || 1}`);
        }

        // Late join: say so, and explain how points are scored
        if (typeof data.gameState.timeRemaining === 'number' && data.gameState.timeRemaining < total - 20000) {
          const rem = Math.max(0, data.gameState.timeRemaining);
          const m = Math.floor(rem / 60000), sec = Math.floor((rem % 60000) / 1000);
          this.instruments.toast('⏱️', 'Match in progress', `${m}:${sec.toString().padStart(2, '0')} left — jump in!`);
        }
        setTimeout(() => this.radio(this.localPlayer?.team, 'hello', null, true), 9000);
        setTimeout(() => this.instruments.toast('🏆', 'How to score', this.mode === 'tdm'
          ? `Team Deathmatch · every shoot-down counts · first to ${this.rules.tdmTarget || 30} wins`
          : `Hold windmills: +1 every ${this.rules.millTickSeconds}s each · Shoot down a plane: +${this.rules.killScore}`), 4000);

        // First run: park on the runway and show the tutorial; takeoff
        // starts when it's dismissed. Repeat visits take off immediately.
        if (!localStorage.getItem('tutorialSeen')) {
          localStorage.setItem('tutorialSeen', 'true');
          this.firstFlight = true;
          ship.position.set(0, 1, GAME_CONFIG.RUNWAY_LENGTH / 2 - 10);
          ship.rotation.set(0, 0, 0);
          this.shipRotation = 0;
          this.pendingTakeoffShip = ship;
          this.camera.position.set(ship.position.x, 9, ship.position.z + 14);
          this.camera.lookAt(ship.position);
          const tutorial = document.getElementById('tutorial');
          if (tutorial) tutorial.style.display = 'block';
        } else {
          // Repeat visits skip the runway: straight into the fight
          this.spawnAirborne(ship, data.player.position);
        }

        this.showTeamBanner(this.localPlayer.team);

        if (data.gameState.players) {
          data.gameState.players.forEach(player => {
            if (player.id !== this.localPlayer.id && !this.players.has(player.id)) {
              const otherColor = this.getPlayerColor(player.id);
              const otherShip = this.createPlayerShip(otherColor, player.plane, player.cosmetics);
              otherShip.position.copy(player.position);
              if (!player.position.y) otherShip.position.y = GAME_CONFIG.FLIGHT_HEIGHT;
              this.scene.add(otherShip);
              this.players.set(player.id, otherShip);
              this.createTrail(player.id, player.cosmetics);
            }
          });
        }

        // Load initial windmill state
        if (data.gameState.windmills) {
          for (const mill of data.gameState.windmills) {
            this.windmillStates[mill.id] = mill;
          }
        }

        this.updateHUD();
        this.updateEnergyBar(this.localPlayer.energy || 100);
      });

      socket.on('playerJoined', (player) => {
        if (player && player.id && !this.players.has(player.id)) {
          const playerColor = this.getPlayerColor(player.id);
          const ship = this.createPlayerShip(playerColor, player.plane, player.cosmetics);
          ship.position.copy(player.position);
          if (!player.position.y) ship.position.y = GAME_CONFIG.FLIGHT_HEIGHT;
          this.scene.add(ship);
          this.players.set(player.id, ship);
          this.createTrail(player.id, player.cosmetics);
          if (this.gameState && this.gameState.players &&
              !this.gameState.players.some(p => p.id === player.id)) {
            this.gameState.players.push(player);
          }
          this.updateHUD();
        }
      });

      socket.on('playerLeft', (playerId) => {
        const ship = this.players.get(playerId);
        if (ship) {
          this.scene.remove(ship);
          this.releaseShip(ship);
          this.players.delete(playerId);
          this.removeTrail(playerId);
        }
        if (this.gameState && this.gameState.players) {
          this.gameState.players = this.gameState.players.filter(p => p.id !== playerId);
        }
        this.updateHUD();
      });

      socket.on('playerMoved', (data) => {
        if (data && data.id) {
          const ship = this.players.get(data.id);
          if (ship && data.position) {
            // Store as a smoothing target; animate() lerps toward it so
            // remote planes glide instead of teleporting between updates.
            // Rotation arrives either as a serialized Euler (_x/_y/_z from
            // human clients) or a plain object (bots).
            const r = data.rotation || {};
            const nowMs = performance.now();
            const prevPos = ship.userData.netPos, prevT = ship.userData.netTime;
            if (data.vel) {
              // Sender-reported velocity (humans) is exact; bots are derived
              ship.userData.vel = { x: data.vel.x, y: data.vel.y, z: data.vel.z };
            } else if (prevPos && prevT) {
              const dt = (nowMs - prevT) / 1000;
              if (dt > 0.02 && dt < 1) {
                ship.userData.vel = {
                  x: (data.position.x - prevPos.x) / dt,
                  y: ((data.position.y || 0) - (prevPos.y || 0)) / dt,
                  z: (data.position.z - prevPos.z) / dt,
                };
              }
            }
            ship.userData.netTime = nowMs;
            ship.userData.netPos = data.position;
            ship.userData.netRot = {
              x: r._x !== undefined ? r._x : (r.x || 0),
              y: r._y !== undefined ? r._y : (r.y || 0),
              z: r._z !== undefined ? r._z : (r.z || 0),
            };
          }
        }
      });

      socket.on('projectileFired', (data) => {
        if (data && data.position && data.direction) {
          const projectile = this.createProjectile();
          projectile.position.copy(data.position);
          projectile.velocity = new THREE.Vector3(
            data.direction.x * GAME_CONFIG.PROJECTILE_SPEED,
            (data.direction.y || 0) * GAME_CONFIG.PROJECTILE_SPEED,
            data.direction.z * GAME_CONFIG.PROJECTILE_SPEED
          );
          this.orientProjectile(projectile);
          this.scene.add(projectile);
          this.projectiles.set(data.projectileId, projectile);
          this.fx.muzzleFlash(projectile.position);
          this.playSound('shot-remote', projectile.position);
          this.recordShot(data.playerId, projectile.position, data.direction);
        }
      });

      socket.on('playerHit', (data) => {
        // Remove the projectile visual that scored the hit
        if (data.projectileId) {
          const projectile = this.projectiles.get(data.projectileId);
          if (projectile) {
            this.scene.remove(projectile);
            this.projectiles.delete(data.projectileId);
          }
        }

        // Kill: explosion at the victim, ship hidden until respawn
        const victimShip = this.players.get(data.targetId);
        if (data.airstrike && victimShip) this.spawnExplosion(victimShip.position);
        if (data.killed && victimShip) {
          // The plane blows up and breaks apart, carrying its momentum down
          const vel = this.shipVelocity(data.targetId);
          this.spawnExplosion(victimShip.position, vel);
          this.spawnWreck(victimShip, vel);
          victimShip.visible = false;
          this.onKillEvent?.(data);
        }

        // Radio: the cast reacts to kills involving you
        if (data.killed) {
          const att = this.gameState?.players?.find(p => p.id === data.attackerId);
          const vic = this.gameState?.players?.find(p => p.id === data.targetId);
          if (data.targetId === this.localPlayer?.id && att?.isBot) this.radio(att.team, 'killedYou', att.username);
          else if (data.attackerId === this.localPlayer?.id && vic?.isBot) this.radio(vic.team, 'youKilledThem', vic.username);
        }

        // Shooter feedback: hitmarker + confirm sound, banner on kill
        if (data.attackerId === this.localPlayer?.id) {
          this.showHitmarker(data.killed);
          this.playSound(data.killed ? 'kill' : 'hitconfirm');
          if (data.killed) {
            this.showKillBanner(this.nameOf(data.targetId));
            this.onMyKill(data);
          }
        }
        if (data.killed) this.matchKills++;
        if (data.killed && data.targetId === this.localPlayer?.id) {
          this.lastKilledBy = data.attackerId;
          this.deathsSinceKill++;
          this.streak = 0;
        }

        if (data.killed) {
          this.addKillFeed(this.nameOf(data.attackerId), this.nameOf(data.targetId), data.weapon);
        }

        if (data.targetId === this.localPlayer?.id) {
          const attackerShip = this.players.get(data.attackerId);
          const me = this.players.get(this.localPlayer.id);
          if (attackerShip && me) {
            const dx = attackerShip.position.x - me.position.x;
            const dz = attackerShip.position.z - me.position.z;
            const bearing = Math.atan2(dx, -dz) * 180 / Math.PI;
            const heading = -this.shipRotation * 180 / Math.PI;
            this.instruments.showDamageDirection(bearing - heading);
          }
          this.playerHealth = typeof data.targetHealth === 'number'
            ? data.targetHealth
            : Math.max(0, this.playerHealth - data.damage);
          this.setHealthBar(this.playerHealth);
          this.playSound(data.killed ? 'explosion' : 'hit');
          this.hitAberration = 1;
          if (!data.killed && this.playerHealth / (this.playerMaxHealth || 100) < 0.3) this.radioLine('coverMe', 40);
          this.shake(data.killed ? 1.2 : 0.35, data.killed ? 0.8 : 0.3);
          if (data.killed) this.handleLocalDeath(this.nameOf(data.attackerId));
        }

        if (typeof data.targetHealth === 'number') this.knownHealth[data.targetId] = data.targetHealth;

        // Keep scoreboard stats in sync
        if (this.gameState?.players) {
          for (const p of this.gameState.players) {
            if (p.id === data.attackerId && typeof data.attackerKills === 'number') p.kills = data.attackerKills;
            if (p.id === data.targetId && typeof data.targetDeaths === 'number') p.deaths = data.targetDeaths;
          }
        }
        if (this.localPlayer) {
          if (data.attackerId === this.localPlayer.id && typeof data.attackerKills === 'number') {
            this.localPlayer.kills = data.attackerKills;
          }
          if (data.targetId === this.localPlayer.id && typeof data.targetDeaths === 'number') {
            this.localPlayer.deaths = data.targetDeaths;
          }
        }

        // Merge (don't replace) game state — the payload only carries scores/time
        if (data.gameState && this.gameState) {
          this.gameState.scores = data.gameState.scores;
          this.gameState.timeRemaining = data.gameState.timeRemaining;
          this.syncTimer(data.gameState.timeRemaining);
        }
        this.updateHUD();
      });

      socket.on('playerRespawn', (data) => {
        this.knownHealth[data.playerId] = typeof data.health === 'number' ? data.health : 100;
        const ship = this.players.get(data.playerId);
        if (ship) {
          ship.position.set(data.position.x, GAME_CONFIG.FLIGHT_HEIGHT, data.position.z);
          ship.visible = true;
          delete ship.userData.netPos;
          delete ship.userData.netRot;
        }
        if (data.playerId === this.localPlayer?.id) {
          // Flying again: the kill cam (if still rolling) gives way
          if (this.replay && this.replay.kind === 'killcam') this.endReplay(true);
          this.dead = false;
          if (this.audio) this.audio.setMuffle(0, 0.6);
          this.streak = 0;
          if (ship) this.faceNearestEnemy(ship);
          clearInterval(this.respawnTicker);
          const sub = document.getElementById('crash-sub');
          if (sub) sub.textContent = '';
          this.playerHealth = data.health;
          this.setHealthBar(data.health);
          this.updateEnergyBar(data.energy);
          if (this.localPlayer) this.localPlayer.energy = data.energy;
          const overlay = document.getElementById('crash-overlay');
          if (overlay) {
            overlay.style.display = 'none';
            const text = overlay.querySelector('.crash-text');
            if (text) text.textContent = 'CRASHED!';
          }
        }
      });

      socket.on('chatMessage', (data) => this.displayChatMessage(data.username, data.message));
      socket.on('gameStart', (gameState) => { this.gameState = gameState; this.updateHUD(); });
      socket.on('gameEnd', (gameState) => {
        this.matchOver = true;
        this.gameState = gameState;
        this.controlsEnabled = false;
        // The best moment of the match plays before the results
        this.playOfTheMatch(() => this.showGameEnd());
      });
      socket.on('error', (error) => console.error('Socket error:', error));

      // Authoritative health after crashes (server applies the damage)
      socket.on('healthUpdate', (data) => {
        if (typeof data?.health !== 'number') return;
        this.playerHealth = data.health;
        this.setHealthBar(data.health);
        if (data.died) {
          this.dead = true;
          const overlay = document.getElementById('crash-overlay');
          if (overlay) {
            const text = overlay.querySelector('.crash-text');
            if (text) text.textContent = 'DESTROYED!';
            overlay.style.display = 'flex';
          }
        }
      });

      // Windmill capture updates from server
      socket.on('windmillUpdate', (data) => {
        if (data && data.windmills) {
          for (const mill of data.windmills) {
            const prev = this.windmillStates[mill.id];
            const myTeam = this.localPlayer?.team;
            if (prev && prev.team !== mill.team && mill.team) {
              this.playSound(mill.team === myTeam ? 'bell' : 'bell-low');
              if (Math.random() < 0.6) this.radio(mill.team, 'capture');
              else if (prev.team) this.radio(prev.team, 'lost');
            }
            if (prev && prev.team !== mill.team && mill.team === myTeam) {
              const ship = this.players.get(this.localPlayer.id);
              const inside = ship && Math.hypot(ship.position.x - mill.x, ship.position.z - mill.z) <= GAME_CONFIG.CAPTURE_RADIUS;
              if (inside) { this.addPopup(150, 'CAPTURE'); this.announce('objective'); }
              else this.addPopup(50, 'TEAM CAPTURE');
            }
            this.windmillStates[mill.id] = mill;
          }
        }
      });

      // Rounds: intermission card, then a fresh countdown
      socket.on('roundEnd', (d) => {
        if (!d) return;
        this.roundWins = d.roundWins || this.roundWins;
        if (d.winner) {
          this.radio(d.winner, 'win', null, true);
          setTimeout(() => this.radio(d.winner === 'red' ? 'blue' : 'red', 'lose', null, true), 3500);
        }
        if (!d.final) {
          const intermission = () => {
            this.showIntermission(d);
            if (d.winner) this.stinger(d.winner === this.localPlayer?.team ? 'roundWin' : 'roundLose');
          };
          // A round decided by a fresh kill gets it replayed in slow motion first
          const clip = this.instruments?.settings.killcam !== false && !this.replay ? this.finalKillClip() : null;
          if (clip) this.startReplay(clip, 'final', intermission);
          else intermission();
        }
        this.controls.shooting = false;
      });
      socket.on('roundStart', (d) => {
        if (!d) return;
        this.round = d.round;
        this.roundWins = d.roundWins || this.roundWins;
        this.suddenDeath = !!d.suddenDeath;
        this.hideIntermission();
        this.calloutsDone.clear();
        this.airspeed = GAME_CONFIG.MOVEMENT_SPEED * (this.planeStats.speed || 1);
        this.stalled = false;
        this.countdownEndsAt = performance.now() + (d.countdown || 5000);
        this.windmillStates = {};
        for (const mill of CAPTURE_WINDMILLS) this.windmillStates[mill.id] = { id: mill.id, team: null, progress: 0 };
        if (this.gameState) this.gameState.scores = { red: 0, blue: 0 };
        this.updateHUD();
        this.applyModeHud();
        const acts = ['Act I · The opening ceremony', 'Act II · The long afternoon', 'Act III · The last light'];
        this.announce(this.suddenDeath ? 'suddenDeath' : d.round >= (d.maxRounds || 3) ? 'finalRound' : `round${d.round}`);
        this.instruments.toast(this.suddenDeath ? '🔥' : '🏁', acts[d.round - 1] || `Round ${d.round}`,
          this.suddenDeath ? 'The bells ring at sundown · windmills score double' : `Round ${d.round} of ${d.maxRounds} · fresh windmills, fresh scores`);
      });

      // Killstreak rewards
      socket.on('streak', (d) => {
        if (!d) return;
        const mine = d.playerId === this.localPlayer?.id;
        if (mine) {
          this.streak = d.streak;
          if (d.reward === 'radar') {
            this.radarSweepUntil = this.animationTime + 20;
            this.awardMedal('📡', 'RADAR SWEEP', 'Every enemy revealed for 20s', 0);
          } else if (d.reward === 'wingman') {
            this.awardMedal('🛩️', 'WINGMAN INBOUND', 'An escort guards you for 45s', 0);
          } else if (d.reward === 'airstrike') {
            this.awardMedal('💥', 'AIRSTRIKE', 'Every enemy nearby takes heavy damage', 0);
            const ship = this.players.get(this.localPlayer.id);
            if (ship) this.shake(1.0, 0.6);
          } else {
            this.awardMedal('🔥', `${d.streak} KILL STREAK`, 'Keep it going', 0);
          }
          this.playSound('streak');
        } else if (d.reward) {
          const sp = this.gameState?.players?.find(p => p.id === d.playerId);
          if (sp?.isBot) this.radio(sp.team, 'streak', sp.username);
          this.instruments.toast('🔥', `${d.username} is on a ${d.streak} kill streak`,
            d.reward === 'radar' ? 'Radar sweep' : d.reward === 'wingman' ? 'Wingman called in' : 'Airstrike!');
        }
      });

      socket.on('windmillScore', (data) => {
        if (data && data.scores && this.gameState) {
          this.gameState.scores = data.scores;
          this.updateHUD();
        }
      });

    } catch (error) {
      console.error('Failed to bind server events:', error);
    }
  }

  // =========================================================================
  // CONNECTION HANDOVER (resume the same match on a new connection)
  // =========================================================================

  /**
   * Opens a second connection, resumes the match on it, then retires the
   * old one. Used when the link drops or stalls, and ahead of a serverless
   * host's WebSocket time limit ('refresh') so the swap is seamless.
   */
  handoverConnection(reason) {
    if (this.handover || !this.localPlayer || this.matchOver) return;
    const old = this.socket;
    const socket = this.openSocket();
    const startedAt = performance.now();
    this.handover = { socket, reason, startedAt };
    if (reason !== 'refresh') this.setNetChip('Reconnecting…');

    const fail = () => {
      if (!this.handover || this.handover.socket !== socket) return;
      socket.removeAllListeners();
      socket.close();
      this.handover = null;
      this.handoverFailures = (this.handoverFailures || 0) + 1;
      // A planned refresh can wait for the next check; a dead link retries with backoff
      if (reason !== 'refresh' || !old || !old.connected) {
        this.setNetChip('Reconnecting…');
        setTimeout(() => this.handoverConnection(old && old.connected ? reason : 'drop'),
          Math.min(8000, 600 * 2 ** Math.min(4, this.handoverFailures)));
      }
    };
    const timer = setTimeout(fail, 10000);
    socket.on('connect', () => socket.emit('joinGame', this.joinPayload(true)));
    socket.on('connect_error', () => { clearTimeout(timer); fail(); });
    socket.on('error', (e) => console.error('Handover socket error:', e));
    socket.once('gameJoined', (data) => {
      clearTimeout(timer);
      if (!this.handover || this.handover.socket !== socket) { socket.close(); return; }
      this.handover = null;
      this.handoverFailures = 0;
      if (old) { old.removeAllListeners(); old.disconnect(); }
      this.socket = socket;
      this.isConnected = true;
      this.connectedAt = performance.now();
      this.lastServerMsg = performance.now();
      socket.off('connect');
      socket.off('connect_error');
      this.applyResume(data);
      this.bindSocketEvents(socket);
      this.setNetChip(null);
      const took = performance.now() - startedAt;
      console.info(`Connection handover (${reason}) in ${Math.round(took)} ms`);
      if (reason !== 'refresh' && took > 2500) this.instruments.toast('📡', 'Back online', 'Your match carried on');
    });
  }

  /** The match as this client sees it, for a server that has to rebuild it */
  resumeSnapshot() {
    const gs = this.gameState || {};
    const me = this.players.get(this.localPlayer.id);
    const remaining = this.timerSync ? Math.max(0, this.timerSync.remaining - (performance.now() - this.timerSync.at)) : undefined;
    const intermission = !!document.getElementById('intermission')?.classList.contains('show');
    const pos = (o) => (o ? { x: o.position.x, y: o.position.y, z: o.position.z } : undefined);
    return {
      round: this.round,
      roundWins: this.roundWins,
      scores: gs.scores,
      timeRemaining: remaining,
      intermission,
      windmills: Object.values(this.windmillStates).map(m => ({ id: m.id, team: m.team, progress: m.progress, contestingTeam: m.contestingTeam })),
      self: {
        team: this.localPlayer.team,
        kills: this.localPlayer.kills || 0,
        deaths: this.localPlayer.deaths || 0,
        streak: this.streak || 0,
        health: this.dead ? (this.playerMaxHealth || 100) : this.playerHealth,
        hasFired: this.lastFireTime > 0,
        position: pos(me),
        ammo: this.ammo,
      },
      bots: (gs.players || []).filter(p => p.isBot && p.id !== this.localPlayer.id).map(p => ({
        username: p.username, team: p.team, plane: p.plane, kills: p.kills || 0, deaths: p.deaths || 0,
        position: pos(this.players.get(p.id)),
      })),
    };
  }

  /** Builds a remote plane (and its contrail) from a server player record */
  addRemotePlane(player) {
    if (!player || !player.id || this.players.has(player.id)) return null;
    const ship = this.createPlayerShip(this.getPlayerColor(player.id), player.plane, player.cosmetics);
    ship.position.copy(player.position);
    if (!player.position.y) ship.position.y = GAME_CONFIG.FLIGHT_HEIGHT;
    this.scene.add(ship);
    this.players.set(player.id, ship);
    this.createTrail(player.id, player.cosmetics);
    return ship;
  }

  /**
   * Re-attaches to a match after a handover. The local plane keeps flying
   * exactly where it is; ids, the roster and the scoreboard come from the
   * server (which may have rebuilt the match on another instance).
   */
  applyResume(data) {
    if (!data || !data.player || !data.gameState) return;
    const oldId = this.localPlayer?.id;
    const newId = data.player.id;
    const me = oldId ? this.players.get(oldId) : null;
    if (me && oldId !== newId) {
      this.players.delete(oldId);
      this.players.set(newId, me);
      const trail = this.trails.get(oldId);
      if (trail) { this.trails.delete(oldId); this.trails.set(newId, trail); }
    }
    const energy = this.localPlayer?.energy;
    this.localPlayer = { ...data.player, energy: typeof energy === 'number' ? energy : data.player.energy };
    const gs = data.gameState;
    this.gameState = gs;
    if (gs.rules) this.rules = { ...this.rules, ...gs.rules };

    // The server's roster replaces ours (a rebuilt match has new bot ids)
    const roster = new Set((gs.players || []).map(p => p.id));
    for (const [id, ship] of [...this.players]) {
      if (id === newId || roster.has(id)) continue;
      this.scene.remove(ship);
      this.releaseShip(ship);
      this.players.delete(id);
      this.removeTrail(id);
    }
    for (const p of gs.players || []) if (p.id !== newId) this.addRemotePlane(p);
    // In-flight shots belong to the old connection
    for (const [, projectile] of this.projectiles) this.scene.remove(projectile);
    this.projectiles.clear();
    this.knownHealth = {};

    this.windmillStates = {};
    for (const mill of gs.windmills || []) this.windmillStates[mill.id] = mill;
    this.round = gs.round || this.round;
    this.roundWins = gs.roundWins || this.roundWins;
    this.suddenDeath = !!gs.suddenDeath;
    this.syncTimer(gs.timeRemaining);
    this.playerHealth = data.player.health;
    this.clearWeaponVisuals();
    if (data.player.ammo) this.ammo = data.player.ammo;
    this.updateWeaponsHud();
    this.setHealthBar(this.playerHealth);

    // Shot down when the link went: the resumed seat is a fresh plane
    if (this.dead && me) {
      this.dead = false;
      clearInterval(this.respawnTicker);
      const overlay = document.getElementById('crash-overlay');
      if (overlay) overlay.style.display = 'none';
      me.visible = true;
      this.spawnAirborne(me, data.player.position);
    }
    this.applyModeHud();
    this.updateHUD();
  }

  /**
   * Per-frame link check: a connection that has gone quiet is replaced
   * (the server's heartbeat arrives every second), and on serverless hosts
   * the link is swapped before the platform's time limit closes it.
   */
  updateConnection() {
    if (!this.socket || !this.localPlayer || this.matchOver || this.handover) return;
    const now = performance.now();
    if (this.socket.connected && this.lastServerMsg && now - this.lastServerMsg > 3500) {
      this.handoverConnection('stall');
      return;
    }
    const ttl = this.rules.connectionTtl || 0;
    if (ttl && this.connectedAt && now - this.connectedAt > ttl) {
      // Wait for a quiet moment, but never past the hard limit
      const calm = !this.dead && !this.crashed && !this.replay;
      if (calm || now - this.connectedAt > ttl + 40000) this.handoverConnection('refresh');
    }
  }

  /** Small status chip under the score bar (null hides it) */
  setNetChip(text) {
    const el = document.getElementById('net-chip');
    if (!el) return;
    el.textContent = text || '';
    el.classList.toggle('show', !!text);
  }
}
