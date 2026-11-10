// Frame-rate independent smoothing. Everything that eases toward a target
// goes through here, so motion feels the same at 30, 60 and 144 fps.

/** Fraction of the remaining gap to close this frame, for a rate in 1/s */
export function dampK(lambda, dt) {
  return 1 - Math.exp(-lambda * dt);
}

/** Ease `cur` toward `target`; a higher lambda is snappier */
export function damp(cur, target, lambda, dt) {
  return cur + (target - cur) * dampK(lambda, dt);
}

/** Wraps an angle into (-PI, PI] */
export function wrapAngle(a) {
  a = (a + Math.PI) % (Math.PI * 2);
  if (a < 0) a += Math.PI * 2;
  return a - Math.PI;
}

/** Like damp, but takes the short way round the circle */
export function dampAngle(cur, target, lambda, dt) {
  return cur + wrapAngle(target - cur) * dampK(lambda, dt);
}

export function clamp(v, lo, hi) {
  return v < lo ? lo : v > hi ? hi : v;
}

/** 0..1 ease-in-out between two edges */
export function smoothstep(a, b, x) {
  const t = clamp((x - a) / (b - a), 0, 1);
  return t * t * (3 - 2 * t);
}

/** Smooth wandering value in roughly -1..1 (for camera shake and engine buzz) */
export function noise1(t, seed = 0) {
  return (Math.sin(t * 1.0 + seed * 12.9898) + Math.sin(t * 2.31 + seed * 78.233) * 0.6 + Math.sin(t * 4.73 + seed * 37.719) * 0.35) / 1.95;
}
