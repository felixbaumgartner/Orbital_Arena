// Adaptive score: a calm bed while you cruise the countryside and a combat
// track that swells in when enemies close in or the guns start, then fades
// back after the fight. Tracks stream from <audio> elements (no big decode)
// and keep their place, so each return to combat continues the piece.
import { MUSIC, MUSIC_BASE } from './manifest';

interface Track { el: HTMLAudioElement; gain: GainNode; level: number; playing: boolean }

export class MusicDirector {
  private ctx: AudioContext;
  private calm: Track;
  private combat: Track;
  /** 0 = calm only, 1 = combat only (smoothed) */
  private weight = 0;
  private target = 0;
  private quietFor = 0;
  private started = false;
  enabled = true;
  /** Overall level (menu is quieter than flight) */
  level = 0.7;

  constructor(ctx: AudioContext, out: AudioNode) {
    this.ctx = ctx;
    this.calm = this.track(MUSIC.calm, out);
    this.combat = this.track(MUSIC.combat, out);
  }

  private track(stem: string, out: AudioNode): Track {
    const el = new Audio();
    el.src = `${MUSIC_BASE}${stem}.mp3`;
    el.loop = true;
    el.preload = 'none';
    el.crossOrigin = 'anonymous';
    const gain = this.ctx.createGain();
    gain.gain.value = 0;
    try {
      this.ctx.createMediaElementSource(el).connect(gain).connect(out);
    } catch (e) {
      console.warn('Music routing failed', e);
    }
    return { el, gain, level: 0, playing: false };
  }

  /** Call from a user gesture (browsers block autoplay otherwise) */
  start(): void {
    if (this.started) return;
    this.started = true;
    this.play(this.calm);
  }

  private play(t: Track): void {
    if (t.playing || !this.enabled) return;
    t.playing = true;
    t.el.play().catch(() => { t.playing = false; });
  }

  private pause(t: Track): void {
    if (!t.playing) return;
    t.playing = false;
    t.el.pause();
  }

  /** 0..1 how intense the moment is (computed by the game each frame) */
  setIntensity(x: number): void { this.target = Math.max(0, Math.min(1, x)); }

  setEnabled(on: boolean): void {
    this.enabled = on;
    if (!on) { this.pause(this.calm); this.pause(this.combat); }
    else if (this.started) this.play(this.weight > 0.5 ? this.combat : this.calm);
  }

  update(dt: number): void {
    if (!this.started || !this.enabled) return;
    // Swell in fast (1.5 s), linger, then ease out slowly (8 s)
    if (this.target > this.weight) {
      this.weight = Math.min(this.target, this.weight + dt / 1.5);
      this.quietFor = 0;
    } else {
      this.quietFor += dt;
      if (this.quietFor > 6) this.weight = Math.max(this.target, this.weight - dt / 8);
    }
    const w = this.weight;
    const calm = Math.cos(w * Math.PI / 2) * this.level;
    const combat = Math.sin(w * Math.PI / 2) * this.level;
    const t = this.ctx.currentTime;
    this.calm.gain.gain.setTargetAtTime(calm, t, 0.1);
    this.combat.gain.gain.setTargetAtTime(combat * 0.9, t, 0.1);
    // Only stream what can be heard
    if (combat > 0.01) this.play(this.combat); else if (w === 0) this.pause(this.combat);
    if (calm > 0.01) this.play(this.calm); else if (w >= 1) this.pause(this.calm);
  }

  /** Jump straight to calm (after a match, in menus) */
  resetCalm(): void { this.target = 0; this.weight = 0; }
}
