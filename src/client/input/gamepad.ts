// Controller support via the Gamepad API (standard mapping: Xbox,
// PlayStation and most others). Polled once a frame; reports stick values
// with a radial deadzone, held buttons, and buttons pressed this frame.

export interface PadState {
  connected: boolean;
  id: string;
  lx: number; ly: number;   // left stick  -1..1 (y down = +)
  rx: number; ry: number;   // right stick
  lt: number; rt: number;   // triggers 0..1
  held: Set<string>;
  pressed: Set<string>;     // went down this frame
}

const NAMES: Record<number, string> = {
  0: 'a', 1: 'b', 2: 'x', 3: 'y', 4: 'lb', 5: 'rb', 6: 'lt', 7: 'rt',
  8: 'back', 9: 'start', 10: 'ls', 11: 'rs', 12: 'up', 13: 'down', 14: 'left', 15: 'right',
};

function deadzone(x: number, y: number, dz = 0.16): [number, number] {
  const m = Math.hypot(x, y);
  if (m < dz) return [0, 0];
  const k = Math.min(1, (m - dz) / (1 - dz)) / m;
  return [x * k, y * k];
}

export class GamepadInput {
  private prev = new Set<string>();
  private index: number | null = null;
  state: PadState = { connected: false, id: '', lx: 0, ly: 0, rx: 0, ry: 0, lt: 0, rt: 0, held: new Set(), pressed: new Set() };
  onConnect: ((id: string) => void) | null = null;
  onDisconnect: (() => void) | null = null;

  constructor() {
    window.addEventListener('gamepadconnected', (e) => {
      const ev = e as GamepadEvent;
      if (this.index === null) this.index = ev.gamepad.index;
      if (this.onConnect) this.onConnect(ev.gamepad.id);
    });
    window.addEventListener('gamepaddisconnected', (e) => {
      const ev = e as GamepadEvent;
      if (ev.gamepad.index === this.index) {
        this.index = null;
        this.state.connected = false;
        if (this.onDisconnect) this.onDisconnect();
      }
    });
  }

  private pad(): Gamepad | null {
    if (!navigator.getGamepads) return null;
    const pads = navigator.getGamepads();
    if (this.index !== null && pads[this.index]) return pads[this.index];
    for (const p of pads) if (p && p.connected) { this.index = p.index; return p; }
    return null;
  }

  poll(): PadState {
    const p = this.pad();
    const s = this.state;
    s.pressed = new Set();
    if (!p) { s.connected = false; s.held = new Set(); this.prev = new Set(); return s; }
    s.connected = true;
    s.id = p.id;
    [s.lx, s.ly] = deadzone(p.axes[0] || 0, p.axes[1] || 0);
    [s.rx, s.ry] = deadzone(p.axes[2] || 0, p.axes[3] || 0);
    const held = new Set<string>();
    p.buttons.forEach((b, i) => {
      const name = NAMES[i];
      if (!name) return;
      const v = typeof b === 'object' ? b.value : (b as unknown as number);
      const down = typeof b === 'object' ? b.pressed || b.value > 0.4 : v > 0.4;
      if (name === 'lt') s.lt = v;
      if (name === 'rt') s.rt = v;
      if (down) held.add(name);
    });
    for (const n of held) if (!this.prev.has(n)) s.pressed.add(n);
    s.held = held;
    this.prev = held;
    return s;
  }

  /** Short rumble (ignored where unsupported) */
  rumble(strong: number, weak: number, ms: number): void {
    const p = this.pad() as (Gamepad & { vibrationActuator?: { playEffect?: (t: string, o: object) => Promise<unknown> } }) | null;
    const act = p && p.vibrationActuator;
    if (act && act.playEffect) {
      act.playEffect('dual-rumble', { duration: ms, strongMagnitude: Math.min(1, strong), weakMagnitude: Math.min(1, weak) }).catch(() => {});
    }
  }
}
