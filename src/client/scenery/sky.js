// Atmospheric sky with a moving sun, day/night cycle, stars, moon and
// weather-driven overcast. Also drives the scene's key light, hemisphere
// and ambient lights, fog color and exposure so everything stays coherent.
import * as THREE from 'three';

const skyVertex = `
  varying vec3 vWorldPos;
  void main() {
    vec4 wp = modelMatrix * vec4(position, 1.0);
    vWorldPos = wp.xyz;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

const skyFragment = `
  uniform vec3 zenithColor;
  uniform vec3 horizonColor;
  uniform vec3 sunColor;
  uniform vec3 sunDir;
  uniform float sunGlow;
  uniform float night;
  uniform float overcast;
  uniform float flash;
  uniform float time;
  varying vec3 vWorldPos;

  float hash(vec3 p) {
    p = fract(p * 0.3183099 + vec3(0.1, 0.2, 0.3));
    p *= 17.0;
    return fract(p.x * p.y * p.z * (p.x + p.y + p.z));
  }

  void main() {
    vec3 d = normalize(vWorldPos - cameraPosition);
    float h = d.y;
    float t = pow(clamp(h, 0.0, 1.0), 0.42);
    vec3 col = mix(horizonColor, zenithColor, t);
    col = mix(col, horizonColor * 0.55, smoothstep(0.0, -0.25, h));

    // Sun: wide Mie-style haze, tighter corona, and a small hot disc
    float c = max(dot(d, sunDir), 0.0);
    float glow = pow(c, 6.0) * 0.28 + pow(c, 48.0) * 0.55 + pow(c, 900.0) * 2.2;
    col += sunColor * glow * sunGlow;

    // Star field, fades in at night and only above the horizon
    vec3 sp = floor(d * 260.0);
    float s = hash(sp);
    float star = smoothstep(0.986, 1.0, s);
    float twinkle = 0.6 + 0.4 * sin(time * 2.0 + s * 60.0);
    col += vec3(star * twinkle * night * smoothstep(0.0, 0.2, h) * (1.0 - overcast));

    // Overcast flattens and desaturates the whole dome
    float lum = dot(col, vec3(0.299, 0.587, 0.114));
    col = mix(col, vec3(lum) * 0.92, overcast * 0.8);

    col += flash * vec3(0.8, 0.85, 1.0);

    gl_FragColor = vec4(col, 1.0);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }
`;

function smoothstep(a, b, x) {
  const t = Math.max(0, Math.min(1, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
}

export class SkySystem {
  constructor(scene, textures, { startHour = 8.5, cycleMinutes = 16 } = {}) {
    this.scene = scene;
    this.hour = startHour;
    this.cycleMinutes = cycleMinutes;
    this.mode = 'auto'; // 'auto' | fixed hour
    this.fixedHour = null;
    this.flash = 0;

    // Colors (linear working space) reused every frame
    this.c = {
      dayZenith: new THREE.Color(0x2F6FD6),
      dayHorizon: new THREE.Color(0xC9E4F4),
      duskZenith: new THREE.Color(0x2B3A6E),
      duskHorizon: new THREE.Color(0xFF9A5C),
      nightZenith: new THREE.Color(0x03060F),
      nightHorizon: new THREE.Color(0x0E1830),
      sunHigh: new THREE.Color(0xFFF4E0),
      sunLow: new THREE.Color(0xFFA85A),
      moon: new THREE.Color(0x9FB4DC),
      overcastGrey: new THREE.Color(0x8A939C),
      hemiGround: new THREE.Color(0x3E6B2E),
    };

    this.state = {
      sunDir: new THREE.Vector3(0, 1, 0),
      moonDir: new THREE.Vector3(0, -1, 0),
      elevation: 1,
      daylight: 1,
      nightFactor: 0,
      sunColor: new THREE.Color(),
      zenithColor: new THREE.Color(),
      horizonColor: new THREE.Color(),
      fogColor: new THREE.Color(),
      cloudColor: new THREE.Color(),
      overcast: 0,
    };

    const geo = new THREE.SphereGeometry(1500, 32, 16);
    this.material = new THREE.ShaderMaterial({
      side: THREE.BackSide,
      depthWrite: false,
      fog: false,
      uniforms: {
        zenithColor: { value: new THREE.Color() },
        horizonColor: { value: new THREE.Color() },
        sunColor: { value: new THREE.Color() },
        sunDir: { value: new THREE.Vector3(0, 1, 0) },
        sunGlow: { value: 1 },
        night: { value: 0 },
        overcast: { value: 0 },
        flash: { value: 0 },
        time: { value: 0 },
      },
      vertexShader: skyVertex,
      fragmentShader: skyFragment,
    });
    this.dome = new THREE.Mesh(geo, this.material);
    this.dome.renderOrder = -10;
    this.dome.frustumCulled = false;
    scene.add(this.dome);

    // Moon sprite (the sun itself is drawn in the shader)
    this.moon = new THREE.Sprite(new THREE.SpriteMaterial({
      map: textures.moon(), transparent: true, depthWrite: false, fog: false, opacity: 0,
    }));
    this.moon.scale.set(90, 90, 1);
    this.moon.renderOrder = -9;
    scene.add(this.moon);
  }

  setTimeMode(mode) {
    this.mode = mode;
    const presets = { dawn: 6.4, noon: 13.0, golden: 19.3, night: 23.6 };
    if (mode in presets) {
      this.fixedHour = presets[mode];
      this.hour = this.fixedHour;
    } else {
      this.fixedHour = null;
    }
  }

  get clockText() {
    const h = Math.floor(this.hour) % 24;
    const m = Math.floor((this.hour % 1) * 60);
    return `${h.toString().padStart(2, '0')}:${m.toString().padStart(2, '0')}`;
  }

  /**
   * Advance the clock and recompute every lighting parameter.
   * weather: { overcast, fogNear, fogFar }
   * lights:  { sun, hemi, ambient }
   */
  update(delta, camera, weather, lights, renderer, time) {
    if (this.fixedHour === null) {
      this.hour = (this.hour + delta * (24 / (this.cycleMinutes * 60))) % 24;
    }
    this.flash = Math.max(0, this.flash - delta * 3.5);

    const st = this.state;
    const c = this.c;

    // Long June days: sun rises in the east around 06:00, peaks in the south
    // at 13:00 (summer time) and sets in the west around 20:00
    const angle = ((this.hour - 13) / 24) * Math.PI * 2;
    st.sunDir.set(-Math.sin(angle), Math.cos(angle) * 0.75 + 0.2, 0.45).normalize();
    st.moonDir.set(-st.sunDir.x, -st.sunDir.y, st.sunDir.z).normalize();
    const e = st.sunDir.y;
    st.elevation = e;

    const daylight = smoothstep(-0.08, 0.28, e);
    const dusk = Math.max(0, 1 - Math.abs(e - 0.04) / 0.22); // warm band around sunrise/sunset
    const nightFactor = 1 - smoothstep(-0.14, 0.04, e);
    st.daylight = daylight;
    st.nightFactor = nightFactor;
    st.overcast = weather.overcast;

    // Sky gradient colors
    st.zenithColor.copy(c.nightZenith).lerp(c.dayZenith, daylight);
    st.zenithColor.lerp(c.duskZenith, dusk * 0.5 * (1 - nightFactor));
    st.horizonColor.copy(c.nightHorizon).lerp(c.dayHorizon, daylight);
    st.horizonColor.lerp(c.duskHorizon, dusk * 0.75 * (1 - nightFactor * 0.7));

    // Sun light color: deep orange at the horizon, near-white overhead
    const warm = smoothstep(0.0, 0.45, e);
    st.sunColor.copy(c.sunLow).lerp(c.sunHigh, warm);

    // Overcast greys everything toward a flat sky
    const grey = c.overcastGrey.clone().multiplyScalar(0.25 + daylight * 0.75);
    st.horizonColor.lerp(grey, weather.overcast * 0.7);
    st.zenithColor.lerp(grey.clone().multiplyScalar(0.8), weather.overcast * 0.7);

    st.fogColor.copy(st.horizonColor);
    st.cloudColor.copy(c.nightHorizon).multiplyScalar(1.6).lerp(new THREE.Color(0xFFFFFF), daylight);
    st.cloudColor.lerp(st.sunColor, dusk * 0.55 * daylight);
    st.cloudColor.lerp(grey, weather.overcast * 0.5);

    // Push to the shader
    const u = this.material.uniforms;
    u.zenithColor.value.copy(st.zenithColor);
    u.horizonColor.value.copy(st.horizonColor);
    u.sunColor.value.copy(st.sunColor);
    u.sunDir.value.copy(st.sunDir);
    u.sunGlow.value = smoothstep(-0.12, 0.05, e) * (1 - weather.overcast * 0.85);
    u.night.value = nightFactor;
    u.overcast.value = weather.overcast;
    u.flash.value = this.flash;
    u.time.value = time;

    this.dome.position.copy(camera.position);
    this.moon.position.copy(camera.position).addScaledVector(st.moonDir, 1350);
    this.moon.material.opacity = nightFactor * (1 - weather.overcast * 0.9) * smoothstep(-0.05, 0.15, st.moonDir.y);

    // Scene fog and clear color follow the horizon
    if (this.scene.fog) {
      this.scene.fog.color.copy(st.fogColor);
      this.scene.fog.near = weather.fogNear;
      this.scene.fog.far = weather.fogFar;
    }
    if (this.scene.background && this.scene.background.isColor) {
      this.scene.background.copy(st.fogColor);
    }

    // Key light: the sun by day, the moon by night (one shadow caster)
    if (lights.sun) {
      const sunUp = e > -0.03;
      const dir = sunUp ? st.sunDir : st.moonDir;
      const anchor = lights.sun.target.position;
      lights.sun.position.set(anchor.x + dir.x * 260, dir.y * 260 + 20, anchor.z + dir.z * 260);
      if (sunUp) {
        lights.sun.color.copy(st.sunColor);
        lights.sun.intensity = 2.3 * smoothstep(-0.03, 0.3, e) * (1 - weather.overcast * 0.75) + this.flash * 4;
      } else {
        lights.sun.color.copy(c.moon);
        lights.sun.intensity = 0.5 * smoothstep(-0.03, 0.15, st.moonDir.y) * (1 - weather.overcast * 0.8) + this.flash * 4;
      }
    }
    if (lights.hemi) {
      lights.hemi.color.copy(st.zenithColor).lerp(new THREE.Color(0xFFFFFF), 0.25);
      lights.hemi.groundColor.copy(c.hemiGround).multiplyScalar(0.3 + daylight * 0.7);
      lights.hemi.intensity = 0.28 + daylight * 0.5;
    }
    if (lights.ambient) {
      lights.ambient.intensity = 0.16 + daylight * 0.24 + this.flash * 1.5;
    }
    if (renderer) {
      renderer.toneMappingExposure = 1.15 - nightFactor * 0.1;
    }
  }

  /** Brightness multiplier for windows, lamps and beacons */
  get lampFactor() {
    return this.state.nightFactor * 0.9 + (1 - this.state.daylight) * 0.3;
  }

  triggerLightning() {
    this.flash = 1.0;
  }
}
