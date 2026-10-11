// The game's sound system: a mixer with buses, compression and reverb;
// recorded samples played in 3D with distance muffling and travel delay;
// synthesized piston engines with doppler for every nearby plane; an
// announcer with a radio voice; and the adaptive music director.
import { SFX, VOICE, STINGERS, SFX_BASE, VOICE_BASE } from './manifest';
import { playSynth, noise, SeekerTone } from './synth';
import { MusicDirector } from './music';

export type Vec = { x: number; y: number; z: number };
export interface Volumes { master: number; music: number; sfx: number; voice: number }

/** Speed of sound in world units per second (scaled so far blasts lag a beat, not seconds) */
const SOUND_SPEED = 600;
/** Doppler uses a slower, game-tuned speed so flybys bend audibly */
const DOPPLER_SPEED = 340;

interface PlayOpts {
  gain?: number;
  rate?: number;
  /** Panner reference distance: full volume inside this radius */
  ref?: number;
  /** Don't bother playing beyond this distance */
  maxDist?: number;
  /** Delay by distance / speed of sound (explosions) */
  travel?: boolean;
  /** Reverb send 0..1 (scaled up with distance) */
  reverb?: number;
  bus?: 'sfx' | 'ui';
  /** Cap on simultaneous voices of this key */
  limit?: number;
}

/**
 * A synthesized piston engine: a harmonic-rich wave shaped like a firing
 * pulse train, propeller beat, exhaust hiss, and a soft clipper for grit.
 */
class EngineVoice {
  readonly out: GainNode;
  readonly panner: PannerNode | null;
  private osc: OscillatorNode;
  private sub: OscillatorNode;
  private lfo: OscillatorNode;
  private lfoDepth: GainNode;
  private lp: BiquadFilterNode;
  private air: BiquadFilterNode;
  private hissGain: GainNode;
  private hissFilter: BiquadFilterNode;
  private ctx: AudioContext;
  assigned: string | null = null;
  level = 0;
  lastDist = Infinity;

  constructor(ctx: AudioContext, dest: AudioNode, wave: PeriodicWave, positional: boolean, hrtf: boolean) {
    this.ctx = ctx;
    this.osc = ctx.createOscillator();
    this.osc.setPeriodicWave(wave);
    this.sub = ctx.createOscillator();
    this.sub.type = 'triangle';
    const subGain = ctx.createGain();
    subGain.gain.value = 0.35;
    const shaper = ctx.createWaveShaper();
    const curve = new Float32Array(1024);
    for (let i = 0; i < curve.length; i++) { const x = (i / (curve.length - 1)) * 2 - 1; curve[i] = Math.tanh(x * 2.2) / Math.tanh(2.2); }
    shaper.curve = curve;
    this.lp = ctx.createBiquadFilter();
    this.lp.type = 'lowpass';
    this.lp.Q.value = 0.8;
    // Propeller beat: amplitude modulation at a fraction of the firing rate
    const am = ctx.createGain();
    am.gain.value = 0.78;
    this.lfo = ctx.createOscillator();
    this.lfo.type = 'sine';
    this.lfoDepth = ctx.createGain();
    this.lfoDepth.gain.value = 0.2;
    this.lfo.connect(this.lfoDepth).connect(am.gain);
    // Exhaust / intake hiss
    const hiss = ctx.createBufferSource();
    hiss.buffer = noise(ctx);
    hiss.loop = true;
    this.hissFilter = ctx.createBiquadFilter();
    this.hissFilter.type = 'bandpass';
    this.hissFilter.Q.value = 0.7;
    this.hissGain = ctx.createGain();
    this.hissGain.gain.value = 0;
    this.air = ctx.createBiquadFilter();
    this.air.type = 'lowpass';
    this.air.frequency.value = 18000;
    this.out = ctx.createGain();
    this.out.gain.value = 0;

    // Drive the clipper gently: grit, not fuzz
    const drive = ctx.createGain();
    drive.gain.value = 0.45;
    this.osc.connect(drive);
    this.sub.connect(subGain).connect(drive);
    drive.connect(shaper);
    shaper.connect(this.lp).connect(am).connect(this.air);
    hiss.connect(this.hissFilter).connect(this.hissGain).connect(this.air);
    this.air.connect(this.out);
    if (positional) {
      this.panner = ctx.createPanner();
      this.panner.panningModel = hrtf ? 'HRTF' : 'equalpower';
      this.panner.distanceModel = 'inverse';
      this.panner.refDistance = 22;
      this.panner.rolloffFactor = 1.25;
      this.panner.maxDistance = 2000;
      this.out.connect(this.panner).connect(dest);
    } else {
      this.panner = null;
      this.out.connect(dest);
    }
    this.osc.start(); this.sub.start(); this.lfo.start(); hiss.start(0, Math.random() * 1.5);
  }

  /** rpm 0..1, load 0..1 (throttle/boost), gain, doppler pitch factor, distance (for air absorption) */
  set(rpm: number, load: number, gain: number, doppler = 1, dist = 0): void {
    const t = this.ctx.currentTime;
    const f0 = (30 + rpm * 58) * doppler;
    this.osc.frequency.setTargetAtTime(f0, t, 0.08);
    this.sub.frequency.setTargetAtTime(f0 * 0.5, t, 0.08);
    this.lfo.frequency.setTargetAtTime(f0 * 0.25, t, 0.1);
    this.lp.frequency.setTargetAtTime(380 + load * 1700 + rpm * 900, t, 0.1);
    this.hissFilter.frequency.setTargetAtTime((700 + rpm * 900) * doppler, t, 0.1);
    this.hissGain.gain.setTargetAtTime(0.05 + load * 0.12, t, 0.1);
    this.air.frequency.setTargetAtTime(Math.max(700, 18000 * Math.exp(-dist / 300)), t, 0.15);
    this.out.gain.setTargetAtTime(gain, t, 0.12);
    this.level = gain;
  }

  setPosition(p: Vec): void {
    if (!this.panner) return;
    const t = this.ctx.currentTime;
    if (this.panner.positionX) {
      this.panner.positionX.setTargetAtTime(p.x, t, 0.02);
      this.panner.positionY.setTargetAtTime(p.y, t, 0.02);
      this.panner.positionZ.setTargetAtTime(p.z, t, 0.02);
    } else {
      this.panner.setPosition(p.x, p.y, p.z);
    }
  }
}

/** A looping positional sound (missile motors) */
export interface LoopHandle { setPosition(p: Vec): void; stop(): void }

export class AudioEngine {
  readonly ctx: AudioContext;
  readonly music: MusicDirector;
  readonly seeker: SeekerTone;
  muted = false;
  volumes: Volumes;
  /** Pitch multiplier for new one-shots (slow motion lowers it) */
  rateScale = 1;

  private mix: GainNode;
  private muffle: BiquadFilterNode;
  private master: GainNode;
  private sfxBus: GainNode;
  private uiBus: GainNode;
  private voiceBus: GainNode;
  private musicBus: GainNode;
  private musicDuck: GainNode;
  private reverbIn: GainNode;
  private radioIn: GainNode;
  private buffers = new Map<string, AudioBuffer[]>();
  private voices = new Map<string, AudioBuffer>();
  private active = new Map<string, number>();
  private listener: Vec = { x: 0, y: 0, z: 0 };
  private listenerVel: Vec = { x: 0, y: 0, z: 0 };
  private hrtf: boolean;
  private engineWave: PeriodicWave;
  private local: EngineVoice;
  private remote: EngineVoice[] = [];
  private windGain: GainNode;
  private windFilter: BiquadFilterNode;
  private voiceQueue: { key: string; radio: boolean }[] = [];
  private pendingVoice: { key: string; radio: boolean }[] = [];
  private loaded = false;
  private voiceBusyUntil = 0;
  private flybyCooldown = new Map<string, number>();

  constructor(opts: { volumes: Volumes; hrtf?: boolean }) {
    const Ctx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    this.ctx = new Ctx({ latencyHint: 'interactive' });
    const ctx = this.ctx;
    this.volumes = { ...opts.volumes };
    this.hrtf = opts.hrtf !== false;

    // Master chain: buses -> mix -> muffle (death, slow motion) -> compressor -> master
    this.master = ctx.createGain();
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -16; comp.knee.value = 10; comp.ratio.value = 4;
    comp.attack.value = 0.004; comp.release.value = 0.22;
    this.muffle = ctx.createBiquadFilter();
    this.muffle.type = 'lowpass';
    this.muffle.frequency.value = 20000;
    this.muffle.Q.value = 0.5;
    this.mix = ctx.createGain();
    this.mix.connect(this.muffle).connect(comp).connect(this.master).connect(ctx.destination);

    this.sfxBus = ctx.createGain();
    this.uiBus = ctx.createGain();
    this.voiceBus = ctx.createGain();
    this.musicBus = ctx.createGain();
    this.musicDuck = ctx.createGain();
    this.sfxBus.connect(this.mix);
    this.uiBus.connect(this.mix);
    this.voiceBus.connect(this.mix);
    this.musicDuck.connect(this.musicBus).connect(this.mix);

    // Outdoor reverb: a generated decaying impulse with a few early echoes
    const verb = ctx.createConvolver();
    verb.buffer = this.makeImpulse(2.4);
    this.reverbIn = ctx.createGain();
    const verbOut = ctx.createGain();
    verbOut.gain.value = 0.55;
    this.reverbIn.connect(verb).connect(verbOut).connect(this.sfxBus);

    // Radio voice: band-limited, a touch of drive
    this.radioIn = ctx.createGain();
    const hp = ctx.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 450;
    const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 3200;
    const drive = ctx.createWaveShaper();
    const curve = new Float32Array(512);
    for (let i = 0; i < 512; i++) { const x = (i / 511) * 2 - 1; curve[i] = Math.tanh(x * 3); }
    drive.curve = curve;
    const radioGain = ctx.createGain(); radioGain.gain.value = 2.4;
    this.radioIn.connect(hp).connect(lp).connect(drive).connect(radioGain).connect(this.voiceBus);

    // Piston engines: one for you, a small pool for the nearest planes
    this.engineWave = this.makeEngineWave();
    this.local = new EngineVoice(ctx, this.sfxBus, this.engineWave, false, false);
    // Wind over the canopy
    const wind = ctx.createBufferSource();
    wind.buffer = noise(ctx);
    wind.loop = true;
    this.windFilter = ctx.createBiquadFilter();
    this.windFilter.type = 'bandpass';
    this.windFilter.Q.value = 0.6;
    this.windGain = ctx.createGain();
    this.windGain.gain.value = 0;
    wind.connect(this.windFilter).connect(this.windGain).connect(this.sfxBus);
    wind.start();

    this.seeker = new SeekerTone(ctx, this.uiBus);
    this.music = new MusicDirector(ctx, this.musicDuck);
    this.applyVolumes();
  }

  // ------------------------------------------------------------------ setup

  /** Fetches and decodes every sample (missing files fall back to synthesis) */
  async load(): Promise<void> {
    const decode = async (url: string): Promise<AudioBuffer | null> => {
      try {
        const res = await fetch(url);
        if (!res.ok) return null;
        const data = await res.arrayBuffer();
        return await new Promise<AudioBuffer>((resolve, reject) => this.ctx.decodeAudioData(data, resolve, reject));
      } catch (e) {
        console.warn('Audio failed to load:', url, e);
        return null;
      }
    };
    const jobs: Promise<void>[] = [];
    for (const [key, stems] of Object.entries(SFX)) {
      jobs.push(Promise.all(stems.map((s) => decode(`${SFX_BASE}${s}.mp3`))).then((list) => {
        const ok = list.filter((b): b is AudioBuffer => !!b);
        if (ok.length) this.buffers.set(key, ok);
      }));
    }
    for (const [key, stem] of Object.entries(STINGERS)) {
      jobs.push(decode(`${SFX_BASE}${stem}.mp3`).then((b) => { if (b) this.buffers.set('sting:' + key, [b]); }));
    }
    for (const [key, stem] of Object.entries(VOICE)) {
      jobs.push(decode(`${VOICE_BASE}${stem}.mp3`).then((b) => { if (b) this.voices.set(key, b); }));
    }
    await Promise.all(jobs);
    this.loaded = true;
    // Lines requested while loading: keep only recent, relevant ones
    const pending = this.pendingVoice.slice(-2);
    this.pendingVoice = [];
    for (const p of pending) this.say(p.key, p.radio);
  }

  get loadedCount(): number { return this.buffers.size + this.voices.size; }

  resume(): void { if (this.ctx.state === 'suspended') void this.ctx.resume(); }

  setVolumes(v: Partial<Volumes>): void { this.volumes = { ...this.volumes, ...v }; this.applyVolumes(); }

  toggleMute(): boolean { this.muted = !this.muted; this.applyVolumes(); return this.muted; }

  private applyVolumes(): void {
    const t = this.ctx.currentTime;
    const v = this.volumes;
    this.master.gain.setTargetAtTime(this.muted ? 0 : v.master, t, 0.05);
    this.sfxBus.gain.setTargetAtTime(v.sfx, t, 0.05);
    this.uiBus.gain.setTargetAtTime(2.2 * Math.min(1, v.sfx * 0.9 + 0.1), t, 0.05);
    this.voiceBus.gain.setTargetAtTime(v.voice, t, 0.05);
    this.musicBus.gain.setTargetAtTime(v.music * 0.7, t, 0.05);
  }

  /** 0 = clear, 1 = heavily muffled (shot down, slow motion) */
  setMuffle(amount: number, time = 0.4): void {
    const f = 20000 * Math.pow(600 / 20000, Math.max(0, Math.min(1, amount)));
    this.muffle.frequency.setTargetAtTime(f, this.ctx.currentTime, time / 3);
  }

  /** Music dips under announcer lines and big moments */
  duck(amount = 0.45, hold = 1.2): void {
    const t = this.ctx.currentTime;
    this.musicDuck.gain.cancelScheduledValues(t);
    this.musicDuck.gain.setTargetAtTime(amount, t, 0.06);
    this.musicDuck.gain.setTargetAtTime(1, t + hold, 0.5);
  }

  // ------------------------------------------------------------------ listener

  setListener(pos: Vec, forward: Vec, up: Vec, vel: Vec): void {
    this.listener = pos;
    this.listenerVel = vel;
    const l = this.ctx.listener;
    const t = this.ctx.currentTime;
    if (l.positionX) {
      l.positionX.setTargetAtTime(pos.x, t, 0.01); l.positionY.setTargetAtTime(pos.y, t, 0.01); l.positionZ.setTargetAtTime(pos.z, t, 0.01);
      l.forwardX.setTargetAtTime(forward.x, t, 0.01); l.forwardY.setTargetAtTime(forward.y, t, 0.01); l.forwardZ.setTargetAtTime(forward.z, t, 0.01);
      l.upX.setTargetAtTime(up.x, t, 0.01); l.upY.setTargetAtTime(up.y, t, 0.01); l.upZ.setTargetAtTime(up.z, t, 0.01);
    } else {
      l.setPosition(pos.x, pos.y, pos.z);
      l.setOrientation(forward.x, forward.y, forward.z, up.x, up.y, up.z);
    }
  }

  private distTo(p: Vec): number {
    return Math.hypot(p.x - this.listener.x, p.y - this.listener.y, p.z - this.listener.z);
  }

  // ------------------------------------------------------------------ one-shots

  /**
   * Plays a sound, positioned in the world when `at` is given. Falls back
   * to a synthesized version while (or if) the recording isn't loaded.
   */
  play(key: string, at?: Vec | null, o: PlayOpts = {}): void {
    if (this.muted) return;
    const ctx = this.ctx;
    const dist = at ? this.distTo(at) : 0;
    if (at && dist > (o.maxDist ?? 1400)) return;
    const limit = o.limit ?? 10;
    if ((this.active.get(key) || 0) >= limit) return;

    const bus = o.bus === 'ui' ? this.uiBus : this.sfxBus;
    // Build the chain: gain -> air absorption -> panner -> bus (+ reverb send)
    const gain = ctx.createGain();
    gain.gain.value = o.gain ?? 1;
    let head: AudioNode = gain;
    let panner: PannerNode | null = null;
    if (at) {
      const air = ctx.createBiquadFilter();
      air.type = 'lowpass';
      air.frequency.value = Math.max(800, 19000 * Math.exp(-dist / 380));
      panner = ctx.createPanner();
      panner.panningModel = this.hrtf ? 'HRTF' : 'equalpower';
      panner.distanceModel = 'inverse';
      panner.refDistance = o.ref ?? 18;
      panner.rolloffFactor = 1.1;
      panner.maxDistance = 3000;
      if (panner.positionX) { panner.positionX.value = at.x; panner.positionY.value = at.y; panner.positionZ.value = at.z; }
      else panner.setPosition(at.x, at.y, at.z);
      gain.connect(air).connect(panner).connect(bus);
      head = gain;
    } else {
      gain.connect(bus);
    }
    const send = (o.reverb ?? 0) + (at ? Math.min(0.5, dist / 900) : 0);
    if (send > 0.01) {
      const s = ctx.createGain();
      s.gain.value = send;
      gain.connect(s).connect(this.reverbIn);
    }
    const start = ctx.currentTime + (o.travel && at ? Math.max(0, dist - 80) / SOUND_SPEED : 0);

    const list = this.buffers.get(key);
    if (list && list.length) {
      const src = ctx.createBufferSource();
      src.buffer = list[Math.floor(Math.random() * list.length)];
      src.playbackRate.value = (o.rate ?? 1) * this.rateScale * (0.94 + Math.random() * 0.12);
      src.connect(head);
      this.active.set(key, (this.active.get(key) || 0) + 1);
      src.onended = () => {
        this.active.set(key, Math.max(0, (this.active.get(key) || 1) - 1));
        try { gain.disconnect(); if (panner) panner.disconnect(); } catch (e) { /* already gone */ }
      };
      src.start(start);
    } else if (!playSynth(ctx, head, key)) {
      gain.disconnect();
    }
  }

  /** Interface and alarm tones (non-positional, synthesized) */
  ui(name: string): void {
    if (this.muted) return;
    playSynth(this.ctx, this.uiBus, name);
  }

  /** A short musical sting (round won, level up...) */
  sting(key: string): void {
    if (this.muted) return;
    const list = this.buffers.get('sting:' + key);
    if (!list) return;
    const src = this.ctx.createBufferSource();
    src.buffer = list[0];
    const g = this.ctx.createGain();
    g.gain.value = 0.85;
    src.connect(g).connect(this.uiBus);
    this.duck(0.3, list[0].duration);
    src.start();
  }

  /** Looping positional sound; returns a handle to move or stop it */
  loop(key: string, at: Vec, gain = 1): LoopHandle {
    const ctx = this.ctx;
    const list = this.buffers.get(key);
    const g = ctx.createGain();
    g.gain.value = 0;
    g.gain.setTargetAtTime(gain, ctx.currentTime, 0.05);
    const panner = ctx.createPanner();
    panner.panningModel = this.hrtf ? 'HRTF' : 'equalpower';
    panner.distanceModel = 'inverse';
    panner.refDistance = 16;
    panner.rolloffFactor = 1.2;
    let src: AudioScheduledSourceNode;
    if (list && list.length) {
      const b = ctx.createBufferSource();
      b.buffer = list[Math.floor(Math.random() * list.length)];
      b.loop = true;
      b.loopStart = Math.min(0.3, b.buffer.duration * 0.1);
      b.loopEnd = Math.max(b.loopStart + 0.2, b.buffer.duration - 0.3);
      src = b;
    } else {
      const b = ctx.createBufferSource();
      b.buffer = noise(ctx);
      b.loop = true;
      const f = ctx.createBiquadFilter();
      f.type = 'bandpass'; f.frequency.value = 900; f.Q.value = 0.6;
      b.connect(f);
      src = b;
      (src as unknown as { _tail: AudioNode })._tail = f;
    }
    const tail = (src as unknown as { _tail?: AudioNode })._tail || src;
    tail.connect(g).connect(panner).connect(this.sfxBus);
    const set = (p: Vec) => {
      if (panner.positionX) {
        const t = ctx.currentTime;
        panner.positionX.setTargetAtTime(p.x, t, 0.02); panner.positionY.setTargetAtTime(p.y, t, 0.02); panner.positionZ.setTargetAtTime(p.z, t, 0.02);
      } else panner.setPosition(p.x, p.y, p.z);
    };
    set(at);
    src.start();
    let stopped = false;
    return {
      setPosition: set,
      stop: () => {
        if (stopped) return;
        stopped = true;
        g.gain.setTargetAtTime(0, ctx.currentTime, 0.08);
        src.stop(ctx.currentTime + 0.4);
        src.onended = () => { try { g.disconnect(); panner.disconnect(); } catch (e) { /* gone */ } };
      },
    };
  }

  // ------------------------------------------------------------------ voice

  /** Announcer line, or a radio call when `radio` is true. Lines queue, never overlap. */
  say(key: string, radio = false): void {
    if (this.muted) return;
    if (!this.voices.has(key)) {
      // Still loading (the first countdown races the download): say it once ready
      if (!this.loaded && key in VOICE) this.pendingVoice.push({ key, radio });
      return;
    }
    if (this.voiceQueue.length >= 2) this.voiceQueue.shift();
    this.voiceQueue.push({ key, radio });
    this.pumpVoice();
  }

  private pumpVoice(): void {
    const now = this.ctx.currentTime;
    if (now < this.voiceBusyUntil || !this.voiceQueue.length) {
      if (this.voiceQueue.length) setTimeout(() => this.pumpVoice(), Math.max(30, (this.voiceBusyUntil - now) * 1000 + 20));
      return;
    }
    const { key, radio } = this.voiceQueue.shift()!;
    const buf = this.voices.get(key)!;
    const src = this.ctx.createBufferSource();
    src.buffer = buf;
    if (radio) {
      playSynth(this.ctx, this.uiBus, 'radio');
      src.connect(this.radioIn);
      src.start(now + 0.08);
      setTimeout(() => playSynth(this.ctx, this.uiBus, 'radio'), (buf.duration + 0.1) * 1000);
    } else {
      src.connect(this.voiceBus);
      src.start(now);
    }
    this.duck(0.4, buf.duration + 0.2);
    this.voiceBusyUntil = now + buf.duration + (radio ? 0.25 : 0.12);
  }

  // ------------------------------------------------------------------ engines

  /** Your own engine and the wind: rpm/load 0..1, speed in units/s */
  setLocalEngine(rpm: number, load: number, speed: number, dive: number, alive: boolean): void {
    this.local.set(rpm, load, alive ? 0.05 + load * 0.025 : 0);
    const t = this.ctx.currentTime;
    const s = Math.max(0, (speed - 30) / 100);
    this.windGain.gain.setTargetAtTime(alive ? Math.min(0.09, s * s * 0.07 + Math.max(0, dive) * 0.03) : 0, t, 0.15);
    this.windFilter.frequency.setTargetAtTime(500 + speed * 6, t, 0.15);
  }

  /**
   * Engines for the nearest other planes, with doppler, and a whoosh when
   * one tears past. `planes`: id, position, velocity (units/s).
   */
  updateRemoteEngines(planes: { id: string; pos: Vec; vel: Vec }[]): void {
    const MAX = 4, RANGE = 480;
    const near = planes
      .map((p) => ({ ...p, d: this.distTo(p.pos) }))
      .filter((p) => p.d < RANGE)
      .sort((a, b) => a.d - b.d)
      .slice(0, MAX);
    while (this.remote.length < Math.min(MAX, near.length)) {
      this.remote.push(new EngineVoice(this.ctx, this.sfxBus, this.engineWave, true, this.hrtf));
    }
    const keep = new Set(near.map((p) => p.id));
    // Release voices whose plane left the set
    for (const v of this.remote) if (v.assigned && !keep.has(v.assigned)) { v.assigned = null; v.set(0.5, 0.3, 0); }
    for (const p of near) {
      let v = this.remote.find((x) => x.assigned === p.id);
      if (!v) { v = this.remote.find((x) => !x.assigned); if (!v) continue; v.assigned = p.id; v.lastDist = p.d; }
      const speed = Math.hypot(p.vel.x, p.vel.y, p.vel.z);
      const rpm = Math.max(0, Math.min(1, (speed - 25) / 95));
      // Doppler: relative speed along the line from you to the plane
      const dx = p.pos.x - this.listener.x, dy = p.pos.y - this.listener.y, dz = p.pos.z - this.listener.z;
      const inv = 1 / (p.d || 1);
      const vr = ((p.vel.x - this.listenerVel.x) * dx + (p.vel.y - this.listenerVel.y) * dy + (p.vel.z - this.listenerVel.z) * dz) * inv;
      const doppler = Math.max(0.6, Math.min(1.6, DOPPLER_SPEED / (DOPPLER_SPEED + vr)));
      v.setPosition(p.pos);
      v.set(rpm, 0.5 + rpm * 0.4, 0.17, doppler, p.d);
      // Close, fast pass: a whoosh of air
      const now = this.ctx.currentTime;
      if (p.d < 38 && v.lastDist > p.d && vr < -45 && (this.flybyCooldown.get(p.id) || 0) < now) {
        this.flybyCooldown.set(p.id, now + 2.5);
        this.play('whoosh', p.pos, { ref: 14, gain: 0.9, limit: 2 });
      }
      v.lastDist = p.d;
    }
  }

  stopRemoteEngines(): void { for (const v of this.remote) { v.assigned = null; v.set(0.5, 0.3, 0); } }

  // ------------------------------------------------------------------ helpers

  /** Harmonic recipe of a piston engine's firing pulse train */
  private makeEngineWave(): PeriodicWave {
    const N = 48;
    const real = new Float32Array(N), imag = new Float32Array(N);
    let seed = 3;
    const rnd = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
    for (let n = 1; n < N; n++) {
      const formant = 1 + 1.6 * Math.exp(-((n - 5) ** 2) / 6) + 0.8 * Math.exp(-((n - 13) ** 2) / 10);
      const amp = formant / Math.pow(n, 0.85);
      const ph = rnd() * Math.PI * 2;
      real[n] = amp * Math.cos(ph);
      imag[n] = amp * Math.sin(ph);
    }
    return this.ctx.createPeriodicWave(real, imag, { disableNormalization: false });
  }

  /** Stereo outdoor impulse: early reflections plus a smooth decay */
  private makeImpulse(seconds: number): AudioBuffer {
    const sr = this.ctx.sampleRate, len = Math.floor(sr * seconds);
    const b = this.ctx.createBuffer(2, len, sr);
    for (let c = 0; c < 2; c++) {
      const d = b.getChannelData(c);
      for (let i = 0; i < len; i++) {
        const t = i / sr;
        d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 3.2) * (t < 0.01 ? t / 0.01 : 1) * 0.6;
      }
      for (const [ms, g] of [[23, 0.5], [41, 0.35], [67, 0.25], [110, 0.18]]) {
        const i = Math.floor((ms + c * 3) * sr / 1000);
        if (i < len) d[i] += g * (Math.random() < 0.5 ? -1 : 1);
      }
    }
    return b;
  }
}
