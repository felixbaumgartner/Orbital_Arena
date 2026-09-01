// Cockpit-style HUD widgets: compass tape, artificial horizon, terrain
// warning, toasts, environment readout, settings panel, photo mode.

const DEFAULT_SETTINGS = { quality: 'high', bloom: true, fps: false, time: 'auto' };
const STORAGE_KEY = 'dvf.settings.v1';

export class Instruments {
  constructor({ onSettingsChange } = {}) {
    this.onSettingsChange = onSettingsChange || (() => {});
    this.settings = this.loadSettings();
    this.settingsOpen = false;
    this.photoMode = false;
    this.toastQueue = [];
    this.fpsFrames = 0;
    this.fpsTime = 0;

    this.compass = document.getElementById('compass');
    this.attitude = document.getElementById('attitude');
    this.pullup = document.getElementById('pullup');
    this.toasts = document.getElementById('toasts');
    this.fpsEl = document.getElementById('fps');
    this.envClock = document.getElementById('env-clock');
    this.envWeather = document.getElementById('env-weather');
    this.envWind = document.getElementById('env-wind');
    this.boostVignette = document.getElementById('boost-vignette');
    this.damageVignette = document.getElementById('damage-vignette');

    this.bindSettingsPanel();
    this.applyFpsVisibility();
  }

  // --- Settings ---------------------------------------------------------------

  loadSettings() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) return { ...DEFAULT_SETTINGS, ...JSON.parse(raw) };
    } catch (e) { /* private mode etc. */ }
    return { ...DEFAULT_SETTINGS };
  }

  saveSettings() {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(this.settings)); } catch (e) { /* ignore */ }
  }

  bindSettingsPanel() {
    const panel = document.getElementById('settings-panel');
    if (!panel) return;
    const quality = document.getElementById('set-quality');
    const bloom = document.getElementById('set-bloom');
    const fps = document.getElementById('set-fps');
    const time = document.getElementById('set-time');
    const close = document.getElementById('settings-close');

    if (quality) quality.value = this.settings.quality;
    if (bloom) bloom.checked = this.settings.bloom;
    if (fps) fps.checked = this.settings.fps;
    if (time) time.value = this.settings.time;

    const change = (key, value) => {
      this.settings[key] = value;
      this.saveSettings();
      this.applyFpsVisibility();
      this.onSettingsChange(key, value, this.settings);
    };
    if (quality) quality.addEventListener('change', () => change('quality', quality.value));
    if (bloom) bloom.addEventListener('change', () => change('bloom', bloom.checked));
    if (fps) fps.addEventListener('change', () => change('fps', fps.checked));
    if (time) time.addEventListener('change', () => change('time', time.value));
    if (close) close.addEventListener('click', () => this.toggleSettings(false));
  }

  toggleSettings(force) {
    const panel = document.getElementById('settings-panel');
    if (!panel) return;
    this.settingsOpen = force === undefined ? !this.settingsOpen : force;
    panel.style.display = this.settingsOpen ? 'block' : 'none';
    if (this.settingsOpen) {
      const first = panel.querySelector('select, input, button');
      if (first) first.focus();
    } else if (document.activeElement && panel.contains(document.activeElement)) {
      document.activeElement.blur();
    }
  }

  applyFpsVisibility() {
    if (this.fpsEl) this.fpsEl.style.display = this.settings.fps ? 'block' : 'none';
  }

  // --- Per-frame readouts --------------------------------------------------------

  tickFps(delta) {
    if (!this.settings.fps || !this.fpsEl) return;
    this.fpsFrames++;
    this.fpsTime += delta;
    if (this.fpsTime >= 0.5) {
      this.fpsEl.textContent = `${Math.round(this.fpsFrames / this.fpsTime)} FPS`;
      this.fpsFrames = 0;
      this.fpsTime = 0;
    }
  }

  setEnv(clock, weather, windKmh) {
    if (this.envClock) this.envClock.textContent = clock;
    if (this.envWeather) this.envWeather.textContent = weather;
    if (this.envWind) this.envWind.textContent = `Wind ${Math.round(windKmh)} km/h`;
  }

  setVignettes({ boost = 0, damage = 0 } = {}) {
    if (this.boostVignette) this.boostVignette.style.opacity = boost.toFixed(2);
    if (this.damageVignette) this.damageVignette.style.opacity = damage.toFixed(2);
  }

  /**
   * headingDeg: 0 = north, clockwise. markers: [{ rel: deg offset from
   * heading (-180..180), color, size }]
   */
  updateCompass(headingDeg, markers = []) {
    const canvas = this.compass;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    const w = canvas.width, h = canvas.height;
    const span = 120; // degrees visible across the tape
    const pxPerDeg = w / span;
    ctx.clearRect(0, 0, w, h);

    // Backing
    ctx.fillStyle = 'rgba(8, 12, 16, 0.55)';
    ctx.beginPath();
    ctx.roundRect(0, 0, w, h, 8);
    ctx.fill();

    ctx.save();
    ctx.beginPath();
    ctx.rect(0, 0, w, h);
    ctx.clip();

    ctx.strokeStyle = 'rgba(255,255,255,0.85)';
    ctx.fillStyle = 'rgba(255,255,255,0.9)';
    ctx.font = 'bold 12px "Rajdhani", "Segoe UI", sans-serif';
    ctx.textAlign = 'center';
    ctx.lineWidth = 1.5;
    const labels = { 0: 'N', 90: 'E', 180: 'S', 270: 'W' };
    const start = Math.floor((headingDeg - span / 2) / 5) * 5;
    for (let deg = start; deg <= headingDeg + span / 2; deg += 5) {
      const x = w / 2 + (deg - headingDeg) * pxPerDeg;
      const norm = ((deg % 360) + 360) % 360;
      const major = norm % 30 === 0;
      ctx.beginPath();
      ctx.moveTo(x, h);
      ctx.lineTo(x, h - (major ? 12 : norm % 10 === 0 ? 8 : 4));
      ctx.stroke();
      if (major) {
        const label = labels[norm] !== undefined ? labels[norm] : String(norm / 10);
        ctx.fillStyle = labels[norm] ? '#FFD23F' : 'rgba(255,255,255,0.9)';
        ctx.fillText(label, x, h - 16);
      }
    }

    // Objective / contact markers
    for (const m of markers) {
      const rel = Math.max(-span / 2, Math.min(span / 2, m.rel));
      const x = w / 2 + rel * pxPerDeg;
      const clamped = Math.abs(m.rel) > span / 2;
      ctx.fillStyle = m.color;
      ctx.globalAlpha = clamped ? 0.5 : 1;
      ctx.beginPath();
      const s = m.size || 5;
      ctx.moveTo(x, 4);
      ctx.lineTo(x - s, 4 + s * 1.6);
      ctx.lineTo(x + s, 4 + s * 1.6);
      ctx.closePath();
      ctx.fill();
      ctx.globalAlpha = 1;
    }
    ctx.restore();

    // Centre lubber line and heading readout
    ctx.strokeStyle = '#FFD23F';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(w / 2, h - 14);
    ctx.lineTo(w / 2, h);
    ctx.stroke();
    ctx.fillStyle = '#FFD23F';
    ctx.font = 'bold 13px "Rajdhani", "Segoe UI", sans-serif';
    ctx.fillText(`${Math.round(((headingDeg % 360) + 360) % 360).toString().padStart(3, '0')}°`, w / 2, 14);
  }

  /** pitch/bank in radians (positive pitch = nose up, positive bank = left wing down) */
  updateAttitude(pitch, bank, altitudeM, verticalSpeed) {
    const canvas = this.attitude;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    const size = canvas.width;
    const c = size / 2;
    const r = c - 3;
    ctx.clearRect(0, 0, size, size);

    ctx.save();
    ctx.beginPath();
    ctx.arc(c, c, r, 0, Math.PI * 2);
    ctx.clip();

    ctx.translate(c, c);
    ctx.rotate(bank);
    const pxPerRad = 110;
    const horizonY = pitch * pxPerRad;

    // Sky and ground halves
    ctx.fillStyle = '#3C8DDE';
    ctx.fillRect(-size, -size * 2 + horizonY, size * 2, size * 2);
    ctx.fillStyle = '#8B5A2B';
    ctx.fillRect(-size, horizonY, size * 2, size * 2);
    ctx.strokeStyle = 'rgba(255,255,255,0.95)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(-size, horizonY);
    ctx.lineTo(size, horizonY);
    ctx.stroke();

    // Pitch ladder every 10 degrees
    ctx.lineWidth = 1;
    ctx.strokeStyle = 'rgba(255,255,255,0.7)';
    for (let deg = -30; deg <= 30; deg += 10) {
      if (deg === 0) continue;
      const y = horizonY - (deg * Math.PI / 180) * pxPerRad;
      const half = deg % 20 === 0 ? 16 : 9;
      ctx.beginPath();
      ctx.moveTo(-half, y);
      ctx.lineTo(half, y);
      ctx.stroke();
    }
    ctx.restore();

    // Bezel
    ctx.strokeStyle = 'rgba(255,255,255,0.35)';
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.arc(c, c, r, 0, Math.PI * 2);
    ctx.stroke();

    // Fixed aircraft symbol
    ctx.strokeStyle = '#FFD23F';
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(c - 26, c); ctx.lineTo(c - 8, c); ctx.lineTo(c - 4, c + 5);
    ctx.moveTo(c + 26, c); ctx.lineTo(c + 8, c); ctx.lineTo(c + 4, c + 5);
    ctx.stroke();
    ctx.fillStyle = '#FFD23F';
    ctx.beginPath();
    ctx.arc(c, c, 2.2, 0, Math.PI * 2);
    ctx.fill();

    // Bank pointer
    ctx.beginPath();
    ctx.moveTo(c, 6);
    ctx.lineTo(c - 5, 15);
    ctx.lineTo(c + 5, 15);
    ctx.closePath();
    ctx.fill();

    const altEl = document.getElementById('att-alt');
    if (altEl) altEl.textContent = `${Math.round(altitudeM)} m`;
    const vsEl = document.getElementById('att-vs');
    if (vsEl) {
      const v = Math.round(verticalSpeed);
      vsEl.textContent = `${v > 0 ? '▲' : v < 0 ? '▼' : '•'} ${Math.abs(v)} m/s`;
      vsEl.className = v > 1 ? 'up' : v < -1 ? 'down' : '';
    }
  }

  setPullUp(active) {
    if (!this.pullup) return;
    this.pullup.classList.toggle('show', !!active);
  }

  // --- Toasts ----------------------------------------------------------------------

  toast(icon, title, subtitle = '') {
    if (!this.toasts) return;
    const el = document.createElement('div');
    el.className = 'toast';
    const iconEl = document.createElement('span');
    iconEl.className = 'toast-icon';
    iconEl.textContent = icon;
    const body = document.createElement('div');
    const t = document.createElement('div');
    t.className = 'toast-title';
    t.textContent = title;
    body.appendChild(t);
    if (subtitle) {
      const s = document.createElement('div');
      s.className = 'toast-sub';
      s.textContent = subtitle;
      body.appendChild(s);
    }
    el.appendChild(iconEl);
    el.appendChild(body);
    this.toasts.appendChild(el);
    while (this.toasts.children.length > 3) this.toasts.removeChild(this.toasts.firstChild);
    setTimeout(() => { if (el.parentNode) el.parentNode.removeChild(el); }, 4600);
  }

  // --- Photo mode ---------------------------------------------------------------------

  setPhotoMode(on) {
    this.photoMode = on;
    document.body.classList.toggle('photo', on);
  }

  /** Save the current canvas frame as a PNG download */
  static saveScreenshot(canvas) {
    try {
      const url = canvas.toDataURL('image/png');
      const a = document.createElement('a');
      const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
      a.href = url;
      a.download = `dutch-skies-${stamp}.png`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      return true;
    } catch (e) {
      console.error('Screenshot failed:', e);
      return false;
    }
  }
}
