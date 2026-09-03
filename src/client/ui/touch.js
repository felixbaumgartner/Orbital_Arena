// Touch controls for phones and tablets: a floating thumbstick on the left
// half of the screen (steer + climb/dive) and hold buttons on the right.
// Uses pointer events so several fingers work at once.

export class TouchControls {
  static isTouchDevice() {
    return (window.matchMedia && window.matchMedia('(pointer: coarse)').matches) ||
      'ontouchstart' in window || navigator.maxTouchPoints > 0;
  }

  constructor({ onFire, onBoost, onRoll, onSettings, onScores } = {}) {
    this.stick = { x: 0, y: 0 };   // -1..1, x right, y down (screen space)
    this.active = false;
    this.stickPointer = null;
    this.base = { x: 0, y: 0 };
    this.radius = 48;

    this.root = document.getElementById('touch-ui');
    this.zone = document.getElementById('stick-zone');
    this.baseEl = document.getElementById('stick-base');
    this.knobEl = document.getElementById('stick-knob');
    if (!this.root || !this.zone) return;

    this.zone.addEventListener('pointerdown', (e) => {
      if (this.stickPointer !== null) return;
      this.stickPointer = e.pointerId;
      this.zone.setPointerCapture(e.pointerId);
      this.base.x = e.clientX;
      this.base.y = e.clientY;
      this.active = true;
      this.baseEl.style.display = 'block';
      this.baseEl.style.left = `${e.clientX}px`;
      this.baseEl.style.top = `${e.clientY}px`;
      this.moveKnob(0, 0);
      e.preventDefault();
    });
    const release = (e) => {
      if (e.pointerId !== this.stickPointer) return;
      this.stickPointer = null;
      this.active = false;
      this.stick.x = 0;
      this.stick.y = 0;
      this.baseEl.style.display = 'none';
    };
    this.zone.addEventListener('pointermove', (e) => {
      if (e.pointerId !== this.stickPointer) return;
      let dx = e.clientX - this.base.x, dy = e.clientY - this.base.y;
      const len = Math.hypot(dx, dy);
      if (len > this.radius) { dx *= this.radius / len; dy *= this.radius / len; }
      this.stick.x = dx / this.radius;
      this.stick.y = dy / this.radius;
      this.moveKnob(dx, dy);
      e.preventDefault();
    });
    this.zone.addEventListener('pointerup', release);
    this.zone.addEventListener('pointercancel', release);

    const hold = (id, down, up) => {
      const el = document.getElementById(id);
      if (!el) return;
      el.addEventListener('pointerdown', (e) => { el.classList.add('down'); down(); e.preventDefault(); });
      const end = () => { el.classList.remove('down'); if (up) up(); };
      el.addEventListener('pointerup', end);
      el.addEventListener('pointercancel', end);
      el.addEventListener('pointerleave', end);
    };
    hold('btn-fire', () => onFire && onFire(true), () => onFire && onFire(false));
    hold('btn-boost', () => onBoost && onBoost(true), () => onBoost && onBoost(false));
    hold('btn-roll', () => onRoll && onRoll());
    const tap = (id, fn) => {
      const el = document.getElementById(id);
      if (el) el.addEventListener('click', (e) => { fn(); e.preventDefault(); });
    };
    tap('btn-settings', () => onSettings && onSettings());
    tap('btn-scores', () => onScores && onScores());
  }

  moveKnob(dx, dy) {
    if (this.knobEl) this.knobEl.style.transform = `translate(calc(-50% + ${dx}px), calc(-50% + ${dy}px))`;
  }

  show(visible) {
    if (this.root) this.root.style.display = visible ? 'block' : 'none';
  }
}
