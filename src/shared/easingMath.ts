// Pure math for easing + keyframe track evaluation. No imports.
// Used by: renderer engine, offscreen-page script injection, unit tests.

import type { EasingId, Track, Vec3 } from './types'

export function clamp01(x: number): number {
  return x < 0 ? 0 : x > 1 ? 1 : x
}

export const EASINGS: Record<Exclude<EasingId, 'spring' | 'bezier'>, (t: number) => number> = {
  linear: (t) => t,
  easeInOutCubic: (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2),
  easeOutExpo: (t) => (t >= 1 ? 1 : 1 - Math.pow(2, -10 * t)),
  easeInOutSine: (t) => -(Math.cos(Math.PI * t) - 1) / 2
}

/** Critically-damped-ish spring used for keyframe easing; zeta<1 overshoots. */
export function spring(t: number, zeta = 0.62, omega = 5.4): number {
  t = clamp01(t)
  if (t === 0 || t === 1) return t
  const e = Math.exp(-zeta * omega * t)
  const c =
    1 -
    e * (Math.cos(omega * Math.sqrt(1 - zeta * zeta) * t) + ((zeta * omega) / (omega * Math.sqrt(1 - zeta * zeta))) * Math.sin(omega * Math.sqrt(1 - zeta * zeta) * t))
  return c
}

/** Solve cubic bezier (like CSS timing functions) for progress x ∈ [0,1]. */
export function cubicBezier(x1: number, y1: number, x2: number, y2: number, x: number): number {
  x = clamp01(x)
  if (x === 0 || x === 1) return x
  // Newton-Raphson on x(t) then evaluate y(t)
  const cx = 3 * x1
  const bx = 3 * (x2 - x1) - cx
  const ax = 1 - cx - bx
  const cy = 3 * y1
  const by = 3 * (y2 - y1) - cy
  const ay = 1 - cy - by
  const sampleX = (t: number) => ((ax * t + bx) * t + cx) * t
  const sampleDX = (t: number) => (3 * ax * t + 2 * bx) * t + cx
  let t = x
  for (let i = 0; i < 10; i++) {
    const err = sampleX(t) - x
    if (Math.abs(err) < 1e-6) break
    const d = sampleDX(t)
    if (Math.abs(d) < 1e-6) break
    t -= err / d
    t = Math.min(1, Math.max(0, t))
  }
  return ((ay * t + by) * t + cy) * t
}

export function applyEasing(id: EasingId, t: number, bezier?: [number, number, number, number]): number {
  t = clamp01(t)
  switch (id) {
    case 'spring':
      return spring(t)
    case 'bezier':
      return bezier ? cubicBezier(bezier[0], bezier[1], bezier[2], bezier[3], t) : t
    default:
      return EASINGS[id](t)
  }
}

// ---------- track evaluation ----------

export function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t
}

export function lerpVec3(a: Vec3, b: Vec3, t: number): Vec3 {
  return { x: lerp(a.x, b.x, t), y: lerp(a.y, b.y, t), z: lerp(a.z, b.z, t) }
}

function blend<T>(a: T, b: T, t: number): T {
  if (typeof a === 'number' && typeof b === 'number') return lerp(a, b, t) as T
  if (isVec3(a) && isVec3(b)) return lerpVec3(a, b, t) as T
  return (t < 1 ? a : b)
}

function isVec3(v: unknown): v is Vec3 {
  return typeof v === 'object' && v !== null && 'x' in v && 'y' in v && 'z' in v
}

/**
 * Evaluate a keyframe track at time t (seconds).
 * Holds first/last value outside the key range. `extra` gives spring params.
 */
export function evalTrack<T>(track: Track<T> | undefined, t: number): T | undefined {
  const keys = track?.keys
  if (!keys || keys.length === 0) return undefined
  const first = keys[0]
  const last = keys[keys.length - 1]
  if (keys.length === 1 || first === undefined || last === undefined) return first?.value
  if (t <= first.t) return first.value
  if (t >= last.t) return last.value
  let i = 0
  // keys are kept sorted by migrate/save; linear scan fine for ≤ few dozen keys
  while (i < keys.length - 1 && (keys[i + 1]?.t ?? Infinity) <= t) i++
  const a = keys[i]
  const b = keys[i + 1]
  if (!a || !b) return a?.value
  const span = b.t - a.t
  const raw = span <= 1e-9 ? 1 : (t - a.t) / span
  const eased = applyEasing(a.easing, raw, a.bezier)
  return blend(a.value, b.value, eased)
}

/** Serializable easing evaluator injected into offscreen pages (self-contained). */
export const EASING_SCRIPT = `(function(){
  function clamp01(x){return x<0?0:x>1?1:x}
  function cubicBezier(x1,y1,x2,y2,x){
    x=clamp01(x); if(x===0||x===1)return x;
    var cx=3*x1,bx=3*(x2-x1)-cx,ax=1-cx-bx,cy=3*y1,by=3*(y2-y1)-cy,ay=1-cy-by;
    function sx(t){return ((ax*t+bx)*t+cx)*t}
    function dx(t){return (3*ax*t+2*bx)*t+cx}
    var t=x;
    for(var i=0;i<10;i++){var e=sx(t)-x; if(Math.abs(e)<1e-6)break; var d=dx(t); if(Math.abs(d)<1e-6)break; t-=e/d; t=Math.min(1,Math.max(0,t));}
    return ((ay*t+by)*t+cy)*t;
  }
  function spring(t){t=clamp01(t); if(t===0||t===1)return t; var zeta=0.62,omega=5.4; var e=Math.exp(-zeta*omega*t); var sq=Math.sqrt(1-zeta*zeta); return 1-e*(Math.cos(omega*sq*t)+(zeta*omega/(omega*sq))*Math.sin(omega*sq*t));}
  function ease(id,t,b){
    t=clamp01(t);
    switch(id){
      case 'linear':return t;
      case 'easeInOutCubic':return t<0.5?4*t*t*t:1-Math.pow(-2*t+2,3)/2;
      case 'easeOutExpo':return t>=1?1:1-Math.pow(2,-10*t);
      case 'easeInOutSine':return -(Math.cos(Math.PI*t)-1)/2;
      case 'spring':return spring(t);
      case 'bezier':return b?cubicBezier(b[0],b[1],b[2],b[3],t):t;
      default:return t;
    }
  }
  window.__lmEase=ease;
})()`
