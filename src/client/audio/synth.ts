// Synthesized sounds: interface tones, cockpit alarms, the missile seeker
// growl, whooshes and fallbacks for any recorded sound still loading.
// Everything here is built from oscillators and shaped noise.

let noiseBuffer: AudioBuffer | null = null;

/** Two seconds of white noise, shared by every noise-based sound */
export function noise(ctx: BaseAudioContext): AudioBuffer {
  if (noiseBuffer && noiseBuffer.sampleRate === ctx.sampleRate) return noiseBuffer;
  const len = ctx.sampleRate * 2;
  noiseBuffer = ctx.createBuffer(1, len, ctx.sampleRate);
  const d = noiseBuffer.getChannelData(0);
  for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
  return noiseBuffer;
}

function env(g: GainNode, t: number, peak: number, attack: number, decay: number): void {
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(peak, t + attack);
  g.gain.exponentialRampToValueAtTime(0.0001, t + attack + decay);
}

function tone(ctx: AudioContext, out: AudioNode, type: OscillatorType, t: number, freqs: [number, number][], peak: number, dur: number): void {
  const o = ctx.createOscillator();
  const g = ctx.createGain();
  o.type = type;
  for (const [f, at] of freqs) o.frequency.setValueAtTime(f, t + at);
  env(g, t, peak, 0.004, dur);
  o.connect(g).connect(out);
  o.start(t);
  o.stop(t + dur + 0.05);
}

function noiseBurst(ctx: AudioContext, out: AudioNode, t: number, opts: {
  type?: BiquadFilterType; f0: number; f1?: number; q?: number; peak: number; attack?: number; dur: number;
}): void {
  const src = ctx.createBufferSource();
  src.buffer = noise(ctx);
  src.playbackRate.value = 0.8 + Math.random() * 0.4;
  const f = ctx.createBiquadFilter();
  f.type = opts.type || 'bandpass';
  f.Q.value = opts.q ?? 1;
  f.frequency.setValueAtTime(opts.f0, t);
  if (opts.f1) f.frequency.exponentialRampToValueAtTime(opts.f1, t + opts.dur);
  const g = ctx.createGain();
  env(g, t, opts.peak, opts.attack ?? 0.005, opts.dur);
  src.connect(f).connect(g).connect(out);
  src.start(t, Math.random() * 1.5);
  src.stop(t + opts.dur + 0.1);
}

/**
 * One-shot synthesized sound. Returns false for names it doesn't know.
 * `out` is the bus (or panner) to connect to.
 */
export function playSynth(ctx: AudioContext, out: AudioNode, name: string): boolean {
  const t = ctx.currentTime;
  switch (name) {
    case 'gun': {
      // Fallback machine-gun report: crack + body thump + short tail
      noiseBurst(ctx, out, t, { type: 'highpass', f0: 1800, peak: 0.5, attack: 0.001, dur: 0.05 });
      noiseBurst(ctx, out, t, { type: 'lowpass', f0: 900, f1: 200, peak: 0.6, attack: 0.002, dur: 0.12 });
      tone(ctx, out, 'sine', t, [[140, 0]], 0.35, 0.08);
      return true;
    }
    case 'pickup':
      tone(ctx, out, 'sine', t, [[660, 0], [990, 0.09]], 0.2, 0.25);
      return true;
    case 'roll':
      // Air rushing over the wings as the plane rolls
      noiseBurst(ctx, out, t, { f0: 500, f1: 1800, q: 0.8, peak: 0.22, attack: 0.25, dur: 0.45 });
      return true;
    case 'hitconfirm': {
      tone(ctx, out, 'sine', t, [[1300, 0], [1800, 0.05]], 0.16, 0.07);
      const o = ctx.createOscillator(), g = ctx.createGain();
      o.type = 'triangle';
      o.frequency.setValueAtTime(160, t);
      o.frequency.exponentialRampToValueAtTime(55, t + 0.14);
      env(g, t, 0.28, 0.003, 0.16);
      o.connect(g).connect(out); o.start(t); o.stop(t + 0.2);
      return true;
    }
    case 'kill':
      tone(ctx, out, 'triangle', t, [[523, 0], [659, 0.08], [1047, 0.16]], 0.18, 0.4);
      tone(ctx, out, 'sine', t + 0.16, [[1568, 0]], 0.08, 0.35);
      return true;
    case 'medal':
      tone(ctx, out, 'triangle', t, [[659, 0], [880, 0.07], [1319, 0.14]], 0.14, 0.4);
      return true;
    case 'streak':
      tone(ctx, out, 'sawtooth', t, [[220, 0]], 0.1, 0.6);
      tone(ctx, out, 'sawtooth', t, [[330, 0]], 0.08, 0.6);
      tone(ctx, out, 'triangle', t + 0.12, [[660, 0]], 0.1, 0.5);
      return true;
    case 'tick':
      tone(ctx, out, 'square', t, [[1000, 0]], 0.06, 0.08);
      return true;
    case 'go':
      tone(ctx, out, 'square', t, [[1500, 0]], 0.1, 0.4);
      return true;
    case 'radio':
      noiseBurst(ctx, out, t, { f0: 2400, q: 2, peak: 0.06, attack: 0.002, dur: 0.07 });
      tone(ctx, out, 'square', t, [[1800, 0], [2400, 0.03]], 0.025, 0.09);
      return true;
    case 'stall':
      tone(ctx, out, 'square', t, [[140, 0], [120, 0.15]], 0.07, 0.3);
      return true;
    case 'bell':
    case 'bell-low': {
      const f0 = name === 'bell' ? 523 : 392;
      for (const [ratio, amp] of [[1, 0.22], [2.02, 0.09], [2.98, 0.05], [4.1, 0.025]] as const) {
        tone(ctx, out, 'sine', t, [[f0 * ratio, 0]], amp, 1.8 / ratio);
      }
      return true;
    }
    case 'lock':
      tone(ctx, out, 'sine', t, [[880, 0], [1320, 0.06]], 0.1, 0.14);
      return true;
    case 'warning':
      tone(ctx, out, 'square', t, [[880, 0], [660, 0.12]], 0.07, 0.24);
      return true;
    case 'missile-warn':
      tone(ctx, out, 'square', t, [[1250, 0]], 0.09, 0.07);
      return true;
    case 'thunder': {
      const len = Math.floor(ctx.sampleRate * 2.2);
      const buffer = ctx.createBuffer(1, len, ctx.sampleRate);
      const data = buffer.getChannelData(0);
      for (let i = 0; i < len; i++) data[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 2.2);
      const src = ctx.createBufferSource();
      src.buffer = buffer;
      const f = ctx.createBiquadFilter();
      f.type = 'lowpass';
      f.frequency.setValueAtTime(420, t);
      f.frequency.exponentialRampToValueAtTime(90, t + 2.0);
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.55, t);
      g.gain.exponentialRampToValueAtTime(0.001, t + 2.2);
      src.connect(f).connect(g).connect(out);
      src.start(t);
      return true;
    }
    case 'whoosh':
      // A plane tearing past: band of noise sweeping down with doppler
      noiseBurst(ctx, out, t, { f0: 2200, f1: 380, q: 0.7, peak: 0.5, attack: 0.18, dur: 0.75 });
      return true;
    case 'flare':
      noiseBurst(ctx, out, t, { type: 'highpass', f0: 1200, peak: 0.45, attack: 0.002, dur: 0.12 });
      noiseBurst(ctx, out, t + 0.03, { f0: 3500, f1: 2200, q: 1.5, peak: 0.12, attack: 0.02, dur: 0.9 });
      return true;
    case 'missile-launch':
      noiseBurst(ctx, out, t, { type: 'lowpass', f0: 3000, f1: 700, peak: 0.6, attack: 0.01, dur: 0.6 });
      noiseBurst(ctx, out, t, { f0: 300, f1: 900, q: 0.8, peak: 0.35, attack: 0.05, dur: 1.2 });
      return true;
    case 'bomb-release':
      tone(ctx, out, 'square', t, [[220, 0]], 0.08, 0.06);
      noiseBurst(ctx, out, t, { type: 'highpass', f0: 2500, peak: 0.12, attack: 0.002, dur: 0.05 });
      return true;
    case 'bomb-whistle': {
      // The classic falling-bomb whistle: a sine gliding down with vibrato
      const o = ctx.createOscillator(), g = ctx.createGain(), lfo = ctx.createOscillator(), lg = ctx.createGain();
      o.type = 'sine';
      o.frequency.setValueAtTime(1500, t);
      o.frequency.exponentialRampToValueAtTime(420, t + 2.2);
      lfo.frequency.value = 7; lg.gain.value = 18;
      lfo.connect(lg).connect(o.frequency);
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(0.12, t + 0.3);
      g.gain.setValueAtTime(0.12, t + 2.0);
      g.gain.exponentialRampToValueAtTime(0.0001, t + 2.3);
      o.connect(g).connect(out);
      o.start(t); lfo.start(t); o.stop(t + 2.4); lfo.stop(t + 2.4);
      return true;
    }
    case 'explosion':
      // Fallback blast: sub drop + filtered noise
      tone(ctx, out, 'sine', t, [[90, 0]], 0.5, 0.7);
      noiseBurst(ctx, out, t, { type: 'lowpass', f0: 1800, f1: 120, peak: 0.7, attack: 0.004, dur: 1.2 });
      return true;
    case 'bullet-hit':
      noiseBurst(ctx, out, t, { f0: 3200, q: 3, peak: 0.25, attack: 0.001, dur: 0.06 });
      tone(ctx, out, 'triangle', t, [[700, 0]], 0.08, 0.08);
      return true;
    case 'hit-taken':
      tone(ctx, out, 'sawtooth', t, [[140, 0]], 0.2, 0.22);
      noiseBurst(ctx, out, t, { type: 'lowpass', f0: 1500, peak: 0.4, attack: 0.002, dur: 0.15 });
      return true;
    case 'impact':
      tone(ctx, out, 'sine', t, [[70, 0]], 0.5, 0.5);
      noiseBurst(ctx, out, t, { type: 'lowpass', f0: 600, f1: 90, peak: 0.6, attack: 0.003, dur: 0.8 });
      return true;
    default:
      return false;
  }
}

/**
 * Missile seeker tone: a low pulsing growl while the seeker searches, a
 * faster growl while it tracks, and a steady high tone when locked.
 */
export class SeekerTone {
  private osc: OscillatorNode;
  private gain: GainNode;
  private pulse: OscillatorNode;
  private pulseGain: GainNode;
  private state: 'off' | 'search' | 'track' | 'lock' = 'off';
  private ctx: AudioContext;

  constructor(ctx: AudioContext, out: AudioNode) {
    this.ctx = ctx;
    this.osc = ctx.createOscillator();
    this.osc.type = 'square';
    this.osc.frequency.value = 380;
    const f = ctx.createBiquadFilter();
    f.type = 'lowpass';
    f.frequency.value = 2400;
    this.gain = ctx.createGain();
    this.gain.gain.value = 0;
    // Amplitude pulsing gives the classic growl
    this.pulse = ctx.createOscillator();
    this.pulse.type = 'square';
    this.pulse.frequency.value = 9;
    this.pulseGain = ctx.createGain();
    this.pulseGain.gain.value = 0;
    const vca = ctx.createGain();
    vca.gain.value = 0.5;
    this.pulse.connect(this.pulseGain).connect(vca.gain);
    this.osc.connect(f).connect(vca).connect(this.gain).connect(out);
    this.osc.start();
    this.pulse.start();
  }

  set(state: 'off' | 'search' | 'track' | 'lock', progress = 0): void {
    const t = this.ctx.currentTime;
    if (state !== this.state) {
      this.state = state;
      this.gain.gain.setTargetAtTime(state === 'off' ? 0 : state === 'lock' ? 0.07 : 0.05, t, 0.03);
      this.pulseGain.gain.setTargetAtTime(state === 'lock' ? 0 : 0.5, t, 0.02);
    }
    if (state === 'search') { this.osc.frequency.setTargetAtTime(360, t, 0.05); this.pulse.frequency.setTargetAtTime(7, t, 0.05); }
    if (state === 'track') {
      this.osc.frequency.setTargetAtTime(420 + progress * 500, t, 0.05);
      this.pulse.frequency.setTargetAtTime(9 + progress * 14, t, 0.05);
    }
    if (state === 'lock') this.osc.frequency.setTargetAtTime(1150, t, 0.02);
  }
}
