// Controller play: left stick flies, right stick looks around, triggers
// fire and boost, bumpers launch missiles and flares, face buttons roll,
// bomb, switch view and look back. Rumble follows hits, guns and blasts.
// Methods are mixed into the Game class (see game.js); `this` is the Game.
import { GamepadInput } from '../input/gamepad';

export class GamepadMethods {
  // =========================================================================
  // GAMEPAD
  // =========================================================================

  initGamepad() {
    this.gamepad = new GamepadInput();
    this.padStick = null;
    this.padLook = null;
    this.padTrig = { rt: false, lt: false, up: false, down: false };
    this.gamepad.onConnect = () => {
      document.body.classList.add('pad');
      this.instruments?.toast('🎮', 'Controller connected', 'Left stick fly · RT guns · LT boost · RB missile · LB flares · A roll · Y view');
    };
    this.gamepad.onDisconnect = () => {
      document.body.classList.remove('pad');
      this.padStick = null;
      this.padLook = null;
      this.instruments?.toast('🎮', 'Controller disconnected', 'Keyboard and mouse still work');
    };
  }

  /** Polls the controller once a frame (before the flight update) */
  updateGamepad() {
    if (!this.gamepad) return;
    const s = this.gamepad.poll();
    if (!s.connected) return;
    // Login screen: A or Start takes off
    if (!this.localPlayer) {
      if (s.pressed.has('a') || s.pressed.has('start')) document.getElementById('start-button')?.click();
      return;
    }
    // Replays: any face button skips
    if (this.replay) {
      if (s.pressed.has('a') || s.pressed.has('b') || s.pressed.has('start')) this.skipReplay();
      return;
    }
    if (s.pressed.has('start')) this.instruments.toggleSettings();
    if (this.instruments.settingsOpen) return;
    const tutorial = document.getElementById('tutorial');
    if (tutorial && tutorial.style.display === 'block' && s.pressed.has('a')) { this.closeTutorial(); return; }
    if (this.takeoffPhase && s.pressed.has('a')) { this.skipTakeoff(); return; }

    const inv = this.instruments.settings.invertY ? -1 : 1;
    this.padStick = (s.lx || s.ly) ? { x: s.lx, y: s.ly * inv } : null;
    this.padLook = (s.rx || s.ry) ? { x: s.rx, y: -s.ry } : null;

    // Held controls change only on transitions, so keyboard and pad coexist
    const edge = (key, down, set) => { if (down !== this.padTrig[key]) { this.padTrig[key] = down; set(down); } };
    edge('rt', s.rt > 0.35, (d) => { this.controls.shooting = d; });
    edge('lt', s.lt > 0.35, (d) => { this.controls.boost = d; });
    edge('up', s.held.has('up'), (d) => { this.controls.throttleUp = d; });
    edge('down', s.held.has('down'), (d) => { this.controls.throttleDown = d; });
    this.look.back = s.held.has('b') || this.keyLookBack === true;
    this.setScoreboardOpen(s.held.has('back') || this.tabHeld === true);

    if (s.pressed.has('rb')) this.fireMissile();
    if (s.pressed.has('lb')) this.deployFlares();
    if (s.pressed.has('a')) this.startBarrelRoll();
    if (s.pressed.has('x')) this.dropBomb();
    if (s.pressed.has('y')) this.toggleCameraMode();
    if (s.pressed.has('ls')) this.toggleControlsPanel();
  }

  /** Rumble that matches a game sound (guns tick, hits thump, blasts roll) */
  rumbleFor(name, at) {
    if (!this.gamepad || !this.gamepad.state.connected) return;
    const near = (r) => (at ? Math.max(0, 1 - this.camera.position.distanceTo(at) / r) : 1);
    switch (name) {
      case 'shot': this.rumble(0, 0.22, 45); break;
      case 'hit': this.rumble(0.75, 0.45, 220); break;
      case 'explosion': { const k = near(260); if (k > 0) this.rumble(0.8 * k, 0.5 * k, 350); break; }
      case 'impact': { const k = near(200); if (k > 0) this.rumble(0.6 * k, 0.3 * k, 250); break; }
      case 'missile-launch': if (!at) this.rumble(0.35, 0.55, 200); break;
      case 'kill': this.rumble(0.35, 0.2, 140); break;
      case 'missile-warn': this.rumble(0, 0.15, 40); break;
      default: break;
    }
  }

  /** Controller rumble (strong motor, weak motor, milliseconds) */
  rumble(strong, weak, ms) {
    if (!this.gamepad || !this.gamepad.state.connected || this.instruments?.settings.rumble === false) return;
    this.gamepad.rumble(strong, weak, ms);
  }
}
