// Flight recorder: a rolling window of every plane's pose, plus the shots,
// missiles and kills that happened, so the last few seconds can be played
// back (kill cam, final kill, play of the match). Frames are sampled on
// game time at a fixed rate and interpolated on playback.

export interface PlanePose { x: number; y: number; z: number; rx: number; ry: number; rz: number; vis: boolean }
export interface Frame { t: number; planes: Map<string, PlanePose>; missiles: { id: string; x: number; y: number; z: number; vx: number; vy: number; vz: number }[] }
export type ReplayEvent =
  | { t: number; kind: 'shot'; owner: string; x: number; y: number; z: number; dx: number; dy: number; dz: number }
  | { t: number; kind: 'kill'; attacker: string; victim: string; weapon: string; x: number; y: number; z: number; vx: number; vy: number; vz: number }
  | { t: number; kind: 'explosion'; x: number; y: number; z: number; scale: number };

export interface Clip {
  frames: Frame[];
  events: ReplayEvent[];
  start: number;
  end: number;
  /** The moment the camera builds toward (slow motion around it) */
  focusTime: number;
  focusId: string;
  victimId: string;
  score: number;
  title: string;
  subtitle: string;
}

const RATE = 1 / 20;     // seconds between frames
const KEEP = 12;         // seconds of history

export class FlightRecorder {
  private frames: Frame[] = [];
  private events: ReplayEvent[] = [];
  private acc = 0;
  /** Game time of the most recent frame */
  now = 0;

  /** Call every frame with game time; samples at 20 Hz */
  record(time: number, delta: number, sample: () => Omit<Frame, 't'>): void {
    this.now = time;
    this.acc += delta;
    if (this.acc < RATE && this.frames.length) return;
    this.acc = 0;
    const f = sample() as Frame;
    f.t = time;
    this.frames.push(f);
    const cutoff = time - KEEP;
    while (this.frames.length && this.frames[0].t < cutoff) this.frames.shift();
    while (this.events.length && this.events[0].t < cutoff) this.events.shift();
  }

  event(e: ReplayEvent): void { this.events.push(e); }

  /** Copies the window [from, to] into a self-contained clip */
  clip(from: number, to: number, meta: Omit<Clip, 'frames' | 'events' | 'start' | 'end'>): Clip | null {
    const frames = this.frames.filter((f) => f.t >= from - RATE && f.t <= to + RATE);
    if (frames.length < 4) return null;
    const events = this.events.filter((e) => e.t >= from && e.t <= to);
    return { ...meta, frames, events, start: Math.max(from, frames[0].t), end: Math.min(to, frames[frames.length - 1].t) };
  }

  get latest(): number { return this.frames.length ? this.frames[this.frames.length - 1].t : 0; }

  clear(): void { this.frames = []; this.events = []; }
}

/** Interpolated pose of a plane at time t within a clip (null if absent) */
export function poseAt(clip: Clip, id: string, t: number): PlanePose | null {
  const fr = clip.frames;
  let i = 0;
  while (i < fr.length - 2 && fr[i + 1].t < t) i++;
  const a = fr[i], b = fr[Math.min(fr.length - 1, i + 1)];
  const pa = a.planes.get(id), pb = b.planes.get(id);
  if (!pa && !pb) return null;
  if (!pa || !pb) return (pa || pb)!;
  const k = b.t > a.t ? Math.max(0, Math.min(1, (t - a.t) / (b.t - a.t))) : 0;
  const lerpAng = (x: number, y: number) => { let d = y - x; d = Math.atan2(Math.sin(d), Math.cos(d)); return x + d * k; };
  return {
    x: pa.x + (pb.x - pa.x) * k, y: pa.y + (pb.y - pa.y) * k, z: pa.z + (pb.z - pa.z) * k,
    rx: lerpAng(pa.rx, pb.rx), ry: lerpAng(pa.ry, pb.ry), rz: lerpAng(pa.rz, pb.rz),
    vis: k < 0.5 ? pa.vis : pb.vis,
  };
}

/** Missiles in flight at time t (interpolated) */
export function missilesAt(clip: Clip, t: number): { id: string; x: number; y: number; z: number; vx: number; vy: number; vz: number }[] {
  const fr = clip.frames;
  let i = 0;
  while (i < fr.length - 2 && fr[i + 1].t < t) i++;
  const a = fr[i], b = fr[Math.min(fr.length - 1, i + 1)];
  const k = b.t > a.t ? Math.max(0, Math.min(1, (t - a.t) / (b.t - a.t))) : 0;
  const out = [];
  for (const m of a.missiles) {
    const n = b.missiles.find((q) => q.id === m.id) || m;
    out.push({ id: m.id, x: m.x + (n.x - m.x) * k, y: m.y + (n.y - m.y) * k, z: m.z + (n.z - m.z) * k, vx: n.vx, vy: n.vy, vz: n.vz });
  }
  return out;
}
