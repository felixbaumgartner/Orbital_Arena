// Game-side audio: starts the engine on the first gesture, maps game events
// to sounds, moves the listener with the camera, drives engine sounds and
// the adaptive music, and makes the announcer and radio speak.
// Methods are mixed into the Game class (see game.js); `this` is the Game.
import * as THREE from 'three';
import { GAME_CONFIG } from '../config.js';
import { AudioEngine } from '../audio/engine';

const _fwd = new THREE.Vector3();
const _up = new THREE.Vector3();

export class AudioMethods {
  // =========================================================================
  // SOUND
  // =========================================================================

  /** Creates the audio engine (must run inside a user gesture) */
  initAudio() {
    if (this.audio) { this.audio.resume(); return; }
    try {
      const s = this.instruments?.settings || {};
      this.audio = new AudioEngine({
        volumes: { master: s.volMaster ?? 0.8, music: s.volMusic ?? 0.6, sfx: s.volSfx ?? 0.9, voice: s.volVoice ?? 0.9 },
        hrtf: s.quality !== 'low',
      });
      this.audio.load().then(() => console.info('Audio ready:', this.audio.loadedCount, 'sounds'));
      this.audio.music.setEnabled(s.music !== false);
      this.audio.music.start();
      this.radioCooldowns = {};
      this.lastCombatAt = -999;
    } catch (e) {
      console.error('Audio init failed:', e);
      this.audio = null;
    }
  }

  toggleMute() {
    if (!this.audio) return;
    const muted = this.audio.toggleMute();
    this.instruments.toast('🔊', muted ? 'Sound muted' : 'Sound on', muted ? 'M to unmute' : '');
  }

  /** Applies the settings panel's volume sliders */
  applyAudioSettings(settings) {
    if (!this.audio) return;
    this.audio.setVolumes({ master: settings.volMaster, music: settings.volMusic, sfx: settings.volSfx, voice: settings.volVoice });
    this.audio.music.setEnabled(settings.music !== false);
  }

  /**
   * Plays a game sound. `at` (a world position) makes it 3D: panned,
   * attenuated, muffled by distance and, for blasts, delayed by distance.
   */
  playSound(name, at = null) {
    this.rumbleFor(name, at); // the controller feels what you hear
    const a = this.audio;
    if (!a) return;
    switch (name) {
      case 'shot':
        a.play('gun', null, { gain: 0.42, limit: 6 });
        this.lastCombatAt = this.animationTime;
        break;
      case 'shot-remote': {
        // Close guns crack; far ones are the softer mid-distance recording
        const d = at ? this.camera.position.distanceTo(at) : 0;
        a.play(d > 140 ? 'gun-far' : 'gun', at, { gain: 1.6, ref: 22, maxDist: 900, limit: 8 });
        break;
      }
      case 'bullet-hit':
        a.play('bullet-hit', at, { gain: 1.8, ref: 18, maxDist: 600, limit: 6 });
        break;
      case 'hit':
        a.play('hit-taken', null, { gain: 0.9 });
        this.lastCombatAt = this.animationTime;
        break;
      case 'explosion':
        a.play('explosion', at, { gain: 1.25, ref: 45, travel: true, reverb: 0.25, maxDist: 2500, limit: 5 });
        a.play('boom', at, { gain: 0.9, ref: 60, travel: true, maxDist: 2500, limit: 4 });
        break;
      case 'impact':
        a.play('impact', at, { gain: 1, ref: 30, travel: true, reverb: 0.2, limit: 4 });
        a.play('boom', at, { gain: 0.6, ref: 40, travel: true, rate: 0.85, limit: 4 });
        break;
      case 'thunder':
        a.ui('thunder');
        break;
      case 'missile-launch':
        // Yours: right in your ears; others': out in the world
        if (at) a.play('missile-launch', at, { gain: 1.2, ref: 25, maxDist: 1200, limit: 4 });
        else a.play('missile-launch', null, { gain: 0.8 });
        break;
      case 'missile-boom':
        a.play('explosion', at, { gain: 0.9, ref: 35, travel: true, reverb: 0.2, rate: 1.15, limit: 5 });
        break;
      case 'flare':
        a.play('flare', at, { gain: 1, ref: 20, maxDist: 900, limit: 4 });
        break;
      case 'bomb-whistle':
        a.play('bomb-whistle', at, { gain: 1.1, ref: 30, maxDist: 1000, limit: 3 });
        break;
      case 'hitconfirm':
      case 'kill':
      case 'lock':
        this.lastCombatAt = this.animationTime;
        a.ui(name);
        break;
      default:
        a.ui(name);
    }
  }

  /** Engine note follows airspeed; throttle and boost load it up */
  updateEngineSound(speed) {
    if (!this.audio) return;
    const boosting = this.controls.boost && this.localPlayer?.energy > 0;
    const rpm = Math.max(0, Math.min(1, (speed - 25) / 100));
    const load = Math.max(0, Math.min(1, (this.throttle - GAME_CONFIG.THROTTLE_MIN) / (GAME_CONFIG.THROTTLE_MAX - GAME_CONFIG.THROTTLE_MIN))) * 0.7 + (boosting ? 0.3 : 0);
    this.audio.setLocalEngine(this.stalled ? rpm * 0.6 : rpm, load, speed, -this.pitchAngle, true);
    this.engineFed = true;
  }

  /** Announcer line (queued; never talks over itself) */
  announce(key) {
    if (this.audio) this.audio.say(key, false);
  }

  /** Wingman radio call, at most once per `cooldown` seconds per line */
  radioLine(key, cooldown = 20) {
    if (!this.audio) return;
    const now = this.animationTime;
    if ((this.radioCooldowns[key] || -1e9) > now) return;
    this.radioCooldowns[key] = now + cooldown;
    this.audio.say(key, true);
  }

  stinger(key) {
    if (this.audio) this.audio.sting(key);
  }

  /** Per-frame: listener, engines, music intensity and situational radio */
  updateAudio(realDelta) {
    const a = this.audio;
    if (!a) return;
    const cam = this.camera;
    cam.getWorldDirection(_fwd);
    _up.set(0, 1, 0).applyQuaternion(cam.quaternion);
    const me = this.localPlayer ? this.players.get(this.localPlayer.id) : null;
    const alive = !!(me && !this.dead && this.controlsEnabled);
    const vel = alive ? this.shipVelocity(this.localPlayer.id) : { x: 0, y: 0, z: 0 };
    a.setListener(cam.position, _fwd, _up, vel);

    // Engine when the flight model isn't feeding it (takeoff roll, shot down, menus)
    if (!this.engineFed) {
      if (this.takeoffPhase) a.setLocalEngine(Math.min(1, (this.takeoffSpeed || 0) / 100), 0.85, this.takeoffSpeed || 0, 0, true);
      else a.setLocalEngine(0.3, 0.2, 0, 0, false);
    }
    this.engineFed = false;

    // Other planes: positional engines with doppler
    if (this.localPlayer) {
      const list = [];
      for (const [id, ship] of this.players) {
        if (id === this.localPlayer.id || !ship.visible) continue;
        const v = ship.userData.vel || { x: 0, y: 0, z: 0 };
        list.push({ id, pos: ship.position, vel: v });
      }
      a.updateRemoteEngines(list);
    }

    // Music: calm in the countryside, combat when the fight is on
    let intensity = 0;
    if (me && this.gameState) {
      const myTeam = this.localPlayer.team;
      let nearest = Infinity;
      for (const p of this.gameState.players || []) {
        if (p.team === myTeam || p.id === this.localPlayer.id) continue;
        const s = this.players.get(p.id);
        if (!s || !s.visible) continue;
        nearest = Math.min(nearest, s.position.distanceTo(me.position));
      }
      const closeness = Math.max(0, Math.min(1, 1 - (nearest - 140) / 360));
      const recent = this.animationTime - (this.lastCombatAt ?? -999) < 5 ? 1 : 0;
      const threat = this.incomingMissiles && this.incomingMissiles.size ? 1 : 0;
      intensity = Math.max(closeness * 0.85, recent, threat);
    }
    a.music.level = this.localPlayer ? 0.75 : 0.5;
    a.music.setIntensity(intensity);
    a.music.update(realDelta);

    // Situational radio: an enemy sitting on your tail
    this.radioScan = (this.radioScan || 0) - realDelta;
    if (alive && this.radioScan <= 0) {
      this.radioScan = 0.5;
      const fx = -Math.sin(this.shipRotation), fz = -Math.cos(this.shipRotation);
      for (const p of this.gameState?.players || []) {
        if (p.team === this.localPlayer.team) continue;
        const s = this.players.get(p.id);
        if (!s || !s.visible) continue;
        const dx = s.position.x - me.position.x, dz = s.position.z - me.position.z;
        const d = Math.hypot(dx, dz);
        if (d > 130 || d < 15) continue;
        const behind = (dx * fx + dz * fz) / d < -0.75;
        const v = s.userData.vel;
        const chasing = v && (v.x * fx + v.z * fz) > 20;
        if (behind && chasing) { this.radioLine('watchMyBack', 30); break; }
      }
    }
  }
}
