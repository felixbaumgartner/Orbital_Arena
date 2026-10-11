// Dynamic weather: rain, fog, storms and lightning.
// Methods are mixed into the Game class (see game.js); `this` is the Game.
import * as THREE from 'three';
import { GAME_CONFIG } from '../config.js';

export class WeatherMethods {
  // =========================================================================
  // DYNAMIC WEATHER
  // =========================================================================

  initWeather() {
    this.weatherState = {
      current: 'clear',
      next: null,
      progress: 0,
      timer: 0,
      holdDuration: GAME_CONFIG.WEATHER_HOLD_MIN +
        Math.random() * (GAME_CONFIG.WEATHER_HOLD_MAX - GAME_CONFIG.WEATHER_HOLD_MIN),
      transitioning: false,
      index: 0,
    };

    this.weatherPresets = {
      clear:  { fogNear: 320, fogFar: 1000, overcast: 0.0,  rain: 0, cover: 0.3,  wind: 7 },
      cloudy: { fogNear: 220, fogFar: 720,  overcast: 0.55, rain: 0, cover: 0.75, wind: 11 },
      rainy:  { fogNear: 90,  fogFar: 380,  overcast: 0.92, rain: 1, cover: 1.0,  wind: 16 },
      foggy:  { fogNear: 30,  fogFar: 200,  overcast: 0.8,  rain: 0, cover: 0.5,  wind: 4 },
    };

    this.weatherCycle = ['clear', 'cloudy', 'rainy', 'cloudy', 'foggy', 'cloudy'];

    this.createRainSystem();
  }

  createRainSystem() {
    const count = GAME_CONFIG.RAIN_COUNT;
    const positions = new Float32Array(count * 3);
    this.rainVelocities = [];

    for (let i = 0; i < count; i++) {
      positions[i * 3] = (Math.random() - 0.5) * 300;
      positions[i * 3 + 1] = Math.random() * 80;
      positions[i * 3 + 2] = (Math.random() - 0.5) * 300;
      this.rainVelocities.push(40 + Math.random() * 30);
    }

    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));

    // Screen-space streaks: constant pixel size so drops near the camera
    // never balloon into blobs
    const mat = new THREE.PointsMaterial({
      color: 0xC8D6E4, size: 14, sizeAttenuation: false, transparent: true, opacity: 0,
      map: this.textures.rainStreak(), depthWrite: false,
    });

    this.rainMesh = new THREE.Points(geo, mat);
    this.scene.add(this.rainMesh);
  }

  updateWeather(delta) {
    const ws = this.weatherState;
    if (!ws) return;
    ws.timer += delta;

    if (!ws.transitioning) {
      Object.assign(this.weatherNow, this.weatherPresets[ws.current]);
      if (ws.timer >= ws.holdDuration) {
        ws.transitioning = true;
        ws.timer = 0;
        ws.index = (ws.index + 1) % this.weatherCycle.length;
        ws.next = this.weatherCycle[ws.index];
        if (ws.next === 'rainy' && this.localPlayer) {
          this.instruments.toast('🌧️', 'A storm is coming in off the sea', 'Radar and vision shrink for everyone');
          setTimeout(() => this.radio(null, 'storm'), 2500);
        }
      }
    } else {
      ws.progress = Math.min(1, ws.timer / GAME_CONFIG.WEATHER_TRANSITION_DURATION);
      const from = this.weatherPresets[ws.current];
      const to = this.weatherPresets[ws.next];
      const t = ws.progress;

      const now = this.weatherNow;
      for (const k of ['fogNear', 'fogFar', 'overcast', 'rain', 'cover', 'wind']) {
        now[k] = from[k] + (to[k] - from[k]) * t;
      }
      this.rainMesh.material.opacity = now.rain * 0.6;

      if (ws.progress >= 1) {
        ws.current = ws.next;
        ws.next = null;
        ws.transitioning = false;
        ws.progress = 0;
        ws.timer = 0;
        ws.holdDuration = GAME_CONFIG.WEATHER_HOLD_MIN +
          Math.random() * (GAME_CONFIG.WEATHER_HOLD_MAX - GAME_CONFIG.WEATHER_HOLD_MIN);
      }
    }

    // Animate rain
    if (this.rainMesh.material.opacity > 0.01) {
      const pos = this.rainMesh.geometry.attributes.position.array;
      for (let i = 0; i < this.rainVelocities.length; i++) {
        pos[i * 3 + 1] -= this.rainVelocities[i] * delta;
        pos[i * 3] += this.wind.x * 0.6 * delta;
        pos[i * 3 + 2] += this.wind.z * 0.6 * delta;
        if (pos[i * 3 + 1] < 0 || Math.abs(pos[i * 3]) > 160 || Math.abs(pos[i * 3 + 2]) > 160) {
          pos[i * 3 + 1] = 60 + Math.random() * 20;
          pos[i * 3] = (Math.random() - 0.5) * 300;
          pos[i * 3 + 2] = (Math.random() - 0.5) * 300;
        }
      }
      this.rainMesh.geometry.attributes.position.needsUpdate = true;
    }

    // Move rain with player
    const ship = this.localPlayer ? this.players.get(this.localPlayer.id) : null;
    if (ship) {
      this.rainMesh.position.x = ship.position.x;
      this.rainMesh.position.z = ship.position.z;
    }

    // Lightning during storms
    if (this.weatherNow.rain > 0.5) {
      this.lightningTimer -= delta;
      if (this.lightningTimer <= 0) {
        this.lightningTimer = 5 + Math.random() * 12;
        if (this.sky) this.sky.triggerLightning();
        this.shake(0.25, 0.3);
        setTimeout(() => this.playSound('thunder'), 300 + Math.random() * 900);
      }
    }

    // Wet surfaces turn glossy in the rain
    const wet = this.weatherNow.rain;
    if (this.groundMat) this.groundMat.roughness = 0.95 - wet * 0.45;
    if (this.mats) {
      this.mats.asphalt.roughness = 0.95 - wet * 0.6;
      this.mats.grassPatch.roughness = 0.95 - wet * 0.4;
      this.mats.soil.roughness = 0.98 - wet * 0.5;
      this.mats.roof.roughness = 0.85 - wet * 0.45;
    }

    // Environment readout
    if (this.instruments && this.sky) {
      const names = { clear: 'Clear', cloudy: 'Cloudy', foggy: 'Fog', rainy: 'Rain' };
      const night = this.sky.state.nightFactor > 0.5;
      const icons = { clear: night ? '🌙' : '☀️', cloudy: night ? '☁️' : '⛅', foggy: '🌫️', rainy: '🌧️' };
      const label = ws.transitioning ? `${names[ws.current]} → ${names[ws.next]}` : names[ws.current];
      this.instruments.setEnv(`${icons[ws.current]} ${this.sky.clockText}`, label, this.wind.speed * 3.6);
    }
  }
}
