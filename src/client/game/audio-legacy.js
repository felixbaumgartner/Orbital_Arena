// Synthesized sound (superseded by audio/AudioEngine).
// Methods are mixed into the Game class (see game.js); `this` is the Game.

export class LegacyAudioMethods {
  // =========================================================================
  // SOUND (synthesized with Web Audio — no audio files)
  // =========================================================================

  initAudio() {
    if (this.audio) return;
    try {
      const ctx = new (window.AudioContext || window.webkitAudioContext)();
      const master = ctx.createGain();
      master.gain.value = 0.5;
      master.connect(ctx.destination);

      // Propeller: two detuned saws through a lowpass, amplitude-throbbed by
      // an LFO whose rate follows RPM, so it reads as blades not a buzzer
      const engineOsc = ctx.createOscillator();
      engineOsc.type = 'sawtooth';
      engineOsc.frequency.value = 62;
      const engineOsc2 = ctx.createOscillator();
      engineOsc2.type = 'sawtooth';
      engineOsc2.frequency.value = 62.9;
      const engineFilter = ctx.createBiquadFilter();
      engineFilter.type = 'lowpass';
      engineFilter.frequency.value = 320;
      const engineGain = ctx.createGain();
      engineGain.gain.value = 0.05;
      const lfo = ctx.createOscillator();
      lfo.type = 'sine';
      lfo.frequency.value = 24;
      const lfoGain = ctx.createGain();
      lfoGain.gain.value = 0.02;
      lfo.connect(lfoGain).connect(engineGain.gain);
      engineOsc.connect(engineFilter);
      engineOsc2.connect(engineFilter);
      engineFilter.connect(engineGain).connect(master);
      engineOsc.start(); engineOsc2.start(); lfo.start();

      // Wind: looping noise through a bandpass, louder with speed and in dives
      const len = ctx.sampleRate * 2;
      const buf = ctx.createBuffer(1, len, ctx.sampleRate);
      const d = buf.getChannelData(0);
      for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
      const wind = ctx.createBufferSource();
      wind.buffer = buf;
      wind.loop = true;
      const windFilter = ctx.createBiquadFilter();
      windFilter.type = 'bandpass';
      windFilter.frequency.value = 700;
      windFilter.Q.value = 0.6;
      const windGain = ctx.createGain();
      windGain.gain.value = 0;
      wind.connect(windFilter).connect(windGain).connect(master);
      wind.start();

      this.audio = { ctx, master, engineOsc, engineOsc2, engineGain, engineFilter, lfo, windGain, windFilter, muted: false };
    } catch (e) {
      console.error('Audio init failed:', e);
    }
  }

  toggleMute() {
    if (!this.audio) return;
    this.audio.muted = !this.audio.muted;
    this.audio.master.gain.value = this.audio.muted ? 0 : 0.5;
    this.displayChatMessage('🔊', this.audio.muted ? 'Sound muted (M to unmute)' : 'Sound on');
  }

  playSound(name) {
    if (!this.audio || this.audio.muted) return;
    const { ctx, master } = this.audio;
    const t = ctx.currentTime;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.connect(gain).connect(master);

    switch (name) {
      case 'shot':
        osc.type = 'square';
        osc.frequency.setValueAtTime(700, t);
        osc.frequency.exponentialRampToValueAtTime(180, t + 0.09);
        gain.gain.setValueAtTime(0.12, t);
        gain.gain.exponentialRampToValueAtTime(0.001, t + 0.1);
        osc.start(t); osc.stop(t + 0.1);
        break;
      case 'hit':
        osc.type = 'sawtooth';
        osc.frequency.setValueAtTime(140, t);
        osc.frequency.exponentialRampToValueAtTime(50, t + 0.2);
        gain.gain.setValueAtTime(0.25, t);
        gain.gain.exponentialRampToValueAtTime(0.001, t + 0.22);
        osc.start(t); osc.stop(t + 0.22);
        break;
      case 'explosion':
        osc.type = 'sawtooth';
        osc.frequency.setValueAtTime(90, t);
        osc.frequency.exponentialRampToValueAtTime(30, t + 0.6);
        gain.gain.setValueAtTime(0.35, t);
        gain.gain.exponentialRampToValueAtTime(0.001, t + 0.65);
        osc.start(t); osc.stop(t + 0.65);
        break;
      case 'pickup':
        osc.type = 'sine';
        osc.frequency.setValueAtTime(660, t);
        osc.frequency.setValueAtTime(990, t + 0.09);
        gain.gain.setValueAtTime(0.2, t);
        gain.gain.exponentialRampToValueAtTime(0.001, t + 0.25);
        osc.start(t); osc.stop(t + 0.25);
        break;
      case 'roll':
        osc.type = 'triangle';
        osc.frequency.setValueAtTime(220, t);
        osc.frequency.exponentialRampToValueAtTime(880, t + 0.3);
        osc.frequency.exponentialRampToValueAtTime(220, t + 0.6);
        gain.gain.setValueAtTime(0.1, t);
        gain.gain.exponentialRampToValueAtTime(0.001, t + 0.65);
        osc.start(t); osc.stop(t + 0.65);
        break;
      case 'hitconfirm': {
        // Crisp tick plus a low thud — "your shot landed"
        osc.type = 'sine';
        osc.frequency.setValueAtTime(1300, t);
        osc.frequency.exponentialRampToValueAtTime(1800, t + 0.05);
        gain.gain.setValueAtTime(0.16, t);
        gain.gain.exponentialRampToValueAtTime(0.001, t + 0.07);
        osc.start(t); osc.stop(t + 0.07);
        const thud = ctx.createOscillator();
        const thudGain = ctx.createGain();
        thud.type = 'triangle';
        thud.frequency.setValueAtTime(160, t);
        thud.frequency.exponentialRampToValueAtTime(55, t + 0.14);
        thudGain.gain.setValueAtTime(0.28, t);
        thudGain.gain.exponentialRampToValueAtTime(0.001, t + 0.16);
        thud.connect(thudGain).connect(master);
        thud.start(t); thud.stop(t + 0.16);
        break;
      }
      case 'medal':
        // Quick bright arpeggio
        osc.type = 'triangle';
        osc.frequency.setValueAtTime(659, t);
        osc.frequency.setValueAtTime(880, t + 0.07);
        osc.frequency.setValueAtTime(1319, t + 0.14);
        gain.gain.setValueAtTime(0.14, t);
        gain.gain.exponentialRampToValueAtTime(0.001, t + 0.4);
        osc.start(t); osc.stop(t + 0.4);
        break;
      case 'streak':
        // Rising power chord
        osc.type = 'sawtooth';
        osc.frequency.setValueAtTime(220, t);
        osc.frequency.exponentialRampToValueAtTime(660, t + 0.35);
        gain.gain.setValueAtTime(0.12, t);
        gain.gain.exponentialRampToValueAtTime(0.001, t + 0.6);
        osc.start(t); osc.stop(t + 0.6);
        break;
      case 'tick':
        osc.type = 'square';
        osc.frequency.setValueAtTime(1000, t);
        gain.gain.setValueAtTime(0.08, t);
        gain.gain.exponentialRampToValueAtTime(0.001, t + 0.08);
        osc.start(t); osc.stop(t + 0.08);
        break;
      case 'go':
        osc.type = 'square';
        osc.frequency.setValueAtTime(1500, t);
        gain.gain.setValueAtTime(0.14, t);
        gain.gain.exponentialRampToValueAtTime(0.001, t + 0.4);
        osc.start(t); osc.stop(t + 0.4);
        break;
      case 'radio':
        // Squelch blip
        osc.type = 'square';
        osc.frequency.setValueAtTime(1800, t);
        osc.frequency.setValueAtTime(2400, t + 0.03);
        gain.gain.setValueAtTime(0.03, t);
        gain.gain.exponentialRampToValueAtTime(0.001, t + 0.09);
        osc.start(t); osc.stop(t + 0.09);
        break;
      case 'stall':
        // Low pulsing buzzer
        osc.type = 'square';
        osc.frequency.setValueAtTime(140, t);
        osc.frequency.setValueAtTime(120, t + 0.15);
        gain.gain.setValueAtTime(0.09, t);
        gain.gain.exponentialRampToValueAtTime(0.001, t + 0.3);
        osc.start(t); osc.stop(t + 0.3);
        break;
      case 'bell':
      case 'bell-low': {
        // Church bell: fundamental plus two partials, long decay
        const f0 = name === 'bell' ? 523 : 392;
        for (const [ratio, amp] of [[1, 0.22], [2.02, 0.09], [2.98, 0.05]]) {
          const o = ctx.createOscillator();
          const g = ctx.createGain();
          o.type = 'sine';
          o.frequency.setValueAtTime(f0 * ratio, t);
          g.gain.setValueAtTime(amp, t);
          g.gain.exponentialRampToValueAtTime(0.001, t + 1.8 / ratio);
          o.connect(g).connect(master);
          o.start(t); o.stop(t + 2);
        }
        break;
      }
      case 'lock':
        // Short two-note chirp when the bracket turns red
        osc.type = 'sine';
        osc.frequency.setValueAtTime(880, t);
        osc.frequency.setValueAtTime(1320, t + 0.06);
        gain.gain.setValueAtTime(0.1, t);
        gain.gain.exponentialRampToValueAtTime(0.001, t + 0.14);
        osc.start(t); osc.stop(t + 0.14);
        break;
      case 'warning':
        // Two-tone terrain alert
        osc.type = 'square';
        osc.frequency.setValueAtTime(880, t);
        osc.frequency.setValueAtTime(660, t + 0.12);
        gain.gain.setValueAtTime(0.08, t);
        gain.gain.exponentialRampToValueAtTime(0.001, t + 0.24);
        osc.start(t); osc.stop(t + 0.24);
        break;
      case 'thunder': {
        // Filtered noise burst with a long rumbling tail
        const len = Math.floor(ctx.sampleRate * 2.2);
        const buffer = ctx.createBuffer(1, len, ctx.sampleRate);
        const data = buffer.getChannelData(0);
        for (let i = 0; i < len; i++) data[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 2.2);
        const src = ctx.createBufferSource();
        src.buffer = buffer;
        const filter = ctx.createBiquadFilter();
        filter.type = 'lowpass';
        filter.frequency.setValueAtTime(420, t);
        filter.frequency.exponentialRampToValueAtTime(90, t + 2.0);
        const rumble = ctx.createGain();
        rumble.gain.setValueAtTime(0.55, t);
        rumble.gain.exponentialRampToValueAtTime(0.001, t + 2.2);
        src.connect(filter).connect(rumble).connect(master);
        src.start(t);
        break;
      }
      case 'kill':
        // Rising three-note fanfare
        osc.type = 'square';
        osc.frequency.setValueAtTime(523, t);
        osc.frequency.setValueAtTime(659, t + 0.08);
        osc.frequency.setValueAtTime(1047, t + 0.16);
        gain.gain.setValueAtTime(0.15, t);
        gain.gain.exponentialRampToValueAtTime(0.001, t + 0.35);
        osc.start(t); osc.stop(t + 0.35);
        break;
    }
  }

  updateEngineSound(speed) {
    if (!this.audio || this.audio.muted) return;
    const a = this.audio;
    const base = 40 + speed * 0.55;
    a.engineOsc.frequency.value = base;
    a.engineOsc2.frequency.value = base * 1.012;
    a.lfo.frequency.value = 14 + speed * 0.22;
    a.engineFilter.frequency.value = 220 + speed * 3;
    a.engineGain.gain.value = this.stalled ? 0.035 : 0.05 + (this.controls.boost ? 0.02 : 0);
    // Wind rises with the square of speed and in a dive
    const s = Math.max(0, (speed - 30) / 100);
    const dive = Math.max(0, -this.pitchAngle) * 0.5;
    a.windGain.gain.value = Math.min(0.2, s * s * 0.16 + dive * 0.06);
    a.windFilter.frequency.value = 500 + speed * 6;
  }
}
