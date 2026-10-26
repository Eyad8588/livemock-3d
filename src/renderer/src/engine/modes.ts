// Camera/device modes (SPEC §7). Applying a mode GENERATES editable
// keyframes on the scene tracks — never a black box.

import type { DeviceInstance, EasingId, Scene, Track, Vec3 } from '@shared/types'
import { getPreset, type ModeId } from '@shared/presets'
import { trackOf } from '@shared/serialize'

export interface ModeOptions {
  speed: number // 0.25..3, 1 = default
  intensity: number // 0..2, 1 = default
  angle: number // degrees, mode-specific
}

export const DEFAULT_MODE_OPTIONS: ModeOptions = { speed: 1, intensity: 1, angle: 0 }

export interface ModeParams {
  id: ModeId
  sliders: { key: keyof ModeOptions; label: string; min: number; max: number; step: number; def: number }[]
}

export const MODE_PARAMS: Record<ModeId, ModeParams> = {
  'cinematic-hero': {
    id: 'cinematic-hero',
    sliders: [
      { key: 'speed', label: 'Speed', min: 0.25, max: 3, step: 0.05, def: 1 },
      { key: 'intensity', label: 'Push-in', min: 0, max: 2, step: 0.05, def: 1 },
      { key: 'angle', label: 'Orbit angle', min: -90, max: 90, step: 1, def: 30 }
    ]
  },
  'spin-reveal': {
    id: 'spin-reveal',
    sliders: [
      { key: 'speed', label: 'Speed', min: 0.25, max: 3, step: 0.05, def: 1 },
      { key: 'intensity', label: 'Spin amount', min: 0.5, max: 3, step: 0.05, def: 1.25 },
      { key: 'angle', label: 'Angle', min: -45, max: 45, step: 1, def: 0 }
    ]
  },
  'float-tilt': {
    id: 'float-tilt',
    sliders: [
      { key: 'speed', label: 'Speed', min: 0.25, max: 3, step: 0.05, def: 1 },
      { key: 'intensity', label: 'Hover', min: 0, max: 2, step: 0.05, def: 1 },
      { key: 'angle', label: 'Tilt', min: 0, max: 20, step: 0.5, def: 6 }
    ]
  },
  'zoom-detail': {
    id: 'zoom-detail',
    sliders: [
      { key: 'speed', label: 'Speed', min: 0.25, max: 3, step: 0.05, def: 1 },
      { key: 'intensity', label: 'Zoom depth', min: 0.2, max: 1, step: 0.05, def: 0.55 },
      { key: 'angle', label: 'Angle', min: -60, max: 60, step: 1, def: 0 }
    ]
  },
  'auto-walkthrough': {
    id: 'auto-walkthrough',
    sliders: [
      { key: 'speed', label: 'Drift speed', min: 0.25, max: 2, step: 0.05, def: 0.6 },
      { key: 'intensity', label: 'Drift amount', min: 0, max: 2, step: 0.05, def: 1 },
      { key: 'angle', label: 'Angle', min: -45, max: 45, step: 1, def: 12 }
    ]
  },
  'device-flip': {
    id: 'device-flip',
    sliders: [
      { key: 'speed', label: 'Speed', min: 0.25, max: 3, step: 0.05, def: 1 },
      { key: 'intensity', label: 'Flips', min: 1, max: 2, step: 1, def: 1 },
      { key: 'angle', label: 'Tilt', min: -30, max: 30, step: 1, def: 0 }
    ]
  },
  'side-by-side': {
    id: 'side-by-side',
    sliders: [
      { key: 'speed', label: 'Stagger speed', min: 0.25, max: 3, step: 0.05, def: 1 },
      { key: 'intensity', label: 'Slide distance', min: 0.2, max: 2, step: 0.05, def: 1 },
      { key: 'angle', label: 'Angle', min: -45, max: 45, step: 1, def: 18 }
    ]
  },
  carousel: {
    id: 'carousel',
    sliders: [
      { key: 'speed', label: 'Speed', min: 0.25, max: 3, step: 0.05, def: 1 },
      { key: 'intensity', label: 'Orbit radius', min: 0.5, max: 2, step: 0.05, def: 1 },
      { key: 'angle', label: 'Tilt', min: -30, max: 30, step: 1, def: 8 }
    ]
  },
  'laptop-open': {
    id: 'laptop-open',
    sliders: [
      { key: 'speed', label: 'Speed', min: 0.25, max: 3, step: 0.05, def: 1 },
      { key: 'intensity', label: 'Push-in', min: 0, max: 2, step: 0.05, def: 1 },
      { key: 'angle', label: 'Side angle', min: -60, max: 60, step: 1, def: 25 }
    ]
  }
}

// ---------- framing helpers ----------

function deviceHeight(dev: DeviceInstance): number {
  const preset = getPreset(dev.presetId)
  if (preset.kind === 'laptop') return preset.body.h * 0.68 + 20
  if (preset.kind === 'monitor') return (preset.standHeightMm ?? 160) + preset.body.h
  return preset.body.h
}

function deviceWidth(dev: DeviceInstance): number {
  const preset = getPreset(dev.presetId)
  return preset.body.w
}

/** Frame the given devices: returns {center, distance} for a camera at angle 0. */
export function framing(devices: DeviceInstance[]): { center: Vec3; distance: number; height: number } {
  if (devices.length === 0) {
    return { center: { x: 0, y: 90, z: 0 }, distance: 560, height: 90 }
  }
  let minX = Infinity
  let maxX = -Infinity
  let maxY = 0
  for (const d of devices) {
    const t = d.transform.keys[0]?.value
    const x = t?.position.x ?? 0
    minX = Math.min(minX, x - deviceWidth(d) / 2)
    maxX = Math.max(maxX, x + deviceWidth(d) / 2)
    const h = deviceHeight(d)
    maxY = Math.max(maxY, (presetIsStanding(d) ? h : h / 2 + 40))
  }
  const width = Math.max(120, maxX - minX)
  const cx = (minX + maxX) / 2
  const cy = maxY * 0.52
  // fov 32° → distance to fit height and width
  const distH = (maxY * 1.35) / Math.tan((16 * Math.PI) / 180)
  const distW = (width * 1.6) / Math.tan((16 * Math.PI) / 180) / (9 / 16 > 1 ? 1 : 1)
  return { center: { x: cx, y: cy, z: 0 }, distance: Math.max(320, Math.max(distH, distW)), height: cy }
}

function presetIsStanding(dev: DeviceInstance): boolean {
  const preset = getPreset(dev.presetId)
  return preset.kind === 'phone' || preset.kind === 'tablet'
}

function orbitPos(center: Vec3, distance: number, angleDeg: number, elevationDeg = 8): Vec3 {
  const a = (angleDeg * Math.PI) / 180
  const e = (elevationDeg * Math.PI) / 180
  return {
    x: center.x + distance * Math.sin(a) * Math.cos(e),
    y: center.y + distance * Math.sin(e),
    z: center.z + distance * Math.cos(a) * Math.cos(e)
  }
}

// ---------- generators ----------

/**
 * Apply a mode to a scene: overwrite camera tracks (+ device tracks for the
 * modes that move devices) with generated keyframes.
 */
export function applyMode(scene: Scene, mode: ModeId, opts: ModeOptions): void {
  const dur = scene.durationSec
  const devs = scene.devices
  const cam = scene.camera

  const setTrack = <T>(track: Track<T>, keys: { t: number; value: T; easing?: EasingId; bezier?: [number, number, number, number] }[]): void => {
    track.keys = keys.map((k) => ({
      t: k.t,
      value: k.value,
      easing: k.easing ?? 'easeInOutCubic',
      ...(k.bezier ? { bezier: k.bezier } : {})
    }))
  }

  const frame = framing(devs)
  const speed = opts.speed

  switch (mode) {
    case 'cinematic-hero': {
      const dist = frame.distance
      const a0 = opts.angle * 0.5
      const a1 = -opts.angle * 0.5
      const push = 1 - 0.14 * opts.intensity
      setTrack(cam.position, [
        { t: 0, value: orbitPos(frame.center, dist * 1.02, a0, 9), easing: 'easeInOutSine' },
        { t: dur, value: orbitPos(frame.center, dist * push, a1, 7), easing: 'easeInOutSine' }
      ])
      setTrack(cam.target, [{ t: 0, value: frame.center }])
      setTrack(cam.fov, [{ t: 0, value: 32 }])
      setTrack(cam.focusDistance, [{ t: 0, value: dist * push }])
      setTrack(cam.aperture, [{ t: 0, value: Math.min(1.2, 0.35 * opts.intensity + 0.2) }])
      break
    }
    case 'spin-reveal': {
      const dist = frame.distance
      // device spins in from the side and settles facing camera
      setTrack(cam.position, [{ t: 0, value: orbitPos(frame.center, dist, opts.angle, 6) }])
      setTrack(cam.target, [{ t: 0, value: frame.center }])
      setTrack(cam.fov, [{ t: 0, value: 30 }])
      setTrack(cam.focusDistance, [{ t: 0, value: dist }])
      setTrack(cam.aperture, [{ t: 0, value: 0.3 }])
      const spin = 360 * opts.intensity
      devs.forEach((d) => {
        const t0 = d.transform.keys[0]?.value ?? { position: { x: 0, y: 0, z: 0 }, rotation: { x: 0, y: 0, z: 0 }, scale: { x: 1, y: 1, z: 1 } }
        const settleT = Math.min(dur, 1.6 / speed)
        setTrack(d.transform, [
          { t: 0, value: { ...t0, rotation: { x: 0, y: spin + opts.angle, z: 0 } }, easing: 'easeOutExpo' },
          { t: settleT, value: { ...t0, rotation: { x: 0, y: opts.angle, z: 0 } }, easing: 'easeInOutSine' },
          { t: dur, value: { ...t0, rotation: { x: 0, y: opts.angle, z: 0 } } }
        ])
      })
      break
    }
    case 'float-tilt': {
      const dist = frame.distance
      const hover = 14 * opts.intensity
      setTrack(cam.position, [{ t: 0, value: orbitPos(frame.center, dist, opts.angle, 6) }])
      setTrack(cam.target, [{ t: 0, value: frame.center }])
      setTrack(cam.fov, [{ t: 0, value: 32 }])
      setTrack(cam.focusDistance, [{ t: 0, value: dist }])
      setTrack(cam.aperture, [{ t: 0, value: 0.25 }])
      devs.forEach((d) => {
        const t0 = d.transform.keys[0]?.value ?? { position: { x: 0, y: 0, z: 0 }, rotation: { x: 0, y: 0, z: 0 }, scale: { x: 1, y: 1, z: 1 } }
        const tilt = opts.angle
        const keys = [] as { t: number; value: typeof t0; easing: 'easeInOutSine' }[]
        const cycles = Math.max(1, Math.round(dur * 0.5 * speed))
        for (let i = 0; i <= cycles * 2; i++) {
          const t = (dur / (cycles * 2)) * i
          const up = i % 2 === 1
          keys.push({
            t,
            value: {
              position: { x: t0.position.x, y: t0.position.y + (up ? hover : 0), z: t0.position.z },
              rotation: { x: up ? tilt : -tilt * 0.4, y: t0.rotation.y, z: up ? tilt * 0.35 : -tilt * 0.2 },
              scale: t0.scale
            },
            easing: 'easeInOutSine'
          })
        }
        setTrack(d.transform, keys)
      })
      break
    }
    case 'zoom-detail': {
      // opts.angle doubles as the target screen-Y fraction in percent (-60..60 → 0.2..0.8)
      const frac = 0.5 + opts.angle / 150
      const dist = frame.distance
      const closeDist = Math.max(90, dist * (1 - opts.intensity))
      const center = frame.center
      const targetY = center.y + (frac - 0.5) * deviceHeight(devs[0]!) * 0.7
      const closeTarget = { x: center.x, y: targetY, z: 0 }
      const tIn = Math.min(dur * 0.45, 2.2 / speed)
      const tOut = Math.max(tIn + 0.5, dur - 1.4 / speed)
      setTrack(cam.position, [
        { t: 0, value: orbitPos(center, dist, 0, 6), easing: 'easeInOutCubic' },
        { t: tIn, value: orbitPos(closeTarget, closeDist, 0, 4), easing: 'easeInOutCubic' },
        { t: tOut, value: orbitPos(closeTarget, closeDist, 0, 4), easing: 'easeInOutCubic' },
        { t: dur, value: orbitPos(center, dist, 0, 6) }
      ])
      setTrack(cam.target, [
        { t: 0, value: center, easing: 'easeInOutCubic' },
        { t: tIn, value: closeTarget, easing: 'easeInOutCubic' },
        { t: tOut, value: closeTarget, easing: 'easeInOutCubic' },
        { t: dur, value: center }
      ])
      setTrack(cam.fov, [{ t: 0, value: 32 }])
      setTrack(cam.focusDistance, [
        { t: 0, value: dist, easing: 'easeInOutCubic' },
        { t: tIn, value: closeDist, easing: 'easeInOutCubic' },
        { t: tOut, value: closeDist, easing: 'easeInOutCubic' },
        { t: dur, value: dist }
      ])
      setTrack(cam.aperture, [{ t: 0, value: 0.5 }])
      break
    }
    case 'auto-walkthrough': {
      const dist = frame.distance
      const drift = 30 * opts.intensity
      setTrack(cam.position, [
        { t: 0, value: orbitPos(frame.center, dist, opts.angle, 4), easing: 'easeInOutSine' },
        { t: dur, value: orbitPos({ ...frame.center, y: frame.center.y + drift }, dist, opts.angle * 1.6, 6), easing: 'easeInOutSine' }
      ])
      setTrack(cam.target, [
        { t: 0, value: frame.center, easing: 'easeInOutSine' },
        { t: dur, value: { x: frame.center.x, y: frame.center.y + drift * 0.5, z: 0 }, easing: 'easeInOutSine' }
      ])
      setTrack(cam.fov, [{ t: 0, value: 34 }])
      setTrack(cam.focusDistance, [{ t: 0, value: dist }])
      setTrack(cam.aperture, [{ t: 0, value: 0.25 }])
      break
    }
    case 'device-flip': {
      const dist = frame.distance
      setTrack(cam.position, [{ t: 0, value: orbitPos(frame.center, dist, 0, 5) }])
      setTrack(cam.target, [{ t: 0, value: frame.center }])
      setTrack(cam.fov, [{ t: 0, value: 32 }])
      setTrack(cam.focusDistance, [{ t: 0, value: dist }])
      setTrack(cam.aperture, [{ t: 0, value: 0.3 }])
      devs.forEach((d) => {
        const t0 = d.transform.keys[0]?.value ?? { position: { x: 0, y: 0, z: 0 }, rotation: { x: 0, y: 0, z: 0 }, scale: { x: 1, y: 1, z: 1 } }
        const flips = Math.round(opts.intensity)
        const total = 360 * flips
        setTrack(d.transform, [
          { t: 0, value: { ...t0, rotation: { x: opts.angle * 0.3, y: 0, z: 0 } }, easing: 'easeInOutCubic' },
          { t: dur * 0.5, value: { ...t0, rotation: { x: opts.angle * 0.3, y: total / 2, z: 0 } }, easing: 'easeInOutCubic' },
          { t: dur, value: { ...t0, rotation: { x: opts.angle * 0.3, y: total, z: 0 } }, easing: 'easeInOutCubic' }
        ])
      })
      break
    }
    case 'side-by-side': {
      // line devices up along X with staggered entrance
      const n = Math.max(1, devs.length)
      const spacing = devs.reduce((m, d) => Math.max(m, deviceWidth(d)), 90) + 40
      const dist = frame.distance * 1.25
      devs.forEach((d, i) => {
        const t0 = d.transform.keys[0]?.value ?? { position: { x: 0, y: 0, z: 0 }, rotation: { x: 0, y: 0, z: 0 }, scale: { x: 1, y: 1, z: 1 } }
        const targetX = (i - (n - 1) / 2) * spacing
        const slide = 160 * opts.intensity
        const start = (i * 0.5) / speed
        const arrive = start + Math.min(dur * 0.5, 1.2 / speed)
        setTrack(d.transform, [
          { t: 0, value: { ...t0, position: { x: targetX + slide, y: t0.position.y, z: t0.position.z - 60 }, rotation: { x: 0, y: -opts.angle, z: 0 } }, easing: 'easeOutExpo' },
          { t: Math.min(dur, start), value: { ...t0, position: { x: targetX + slide, y: t0.position.y, z: t0.position.z - 60 }, rotation: { x: 0, y: -opts.angle, z: 0 } }, easing: 'easeOutExpo' },
          { t: Math.min(dur, arrive), value: { ...t0, position: { x: targetX, y: t0.position.y, z: t0.position.z }, rotation: { x: 0, y: 0, z: 0 } } }
        ])
      })
      const centerAfter = { x: 0, y: frame.center.y, z: 0 }
      setTrack(cam.position, [{ t: 0, value: orbitPos(centerAfter, dist, 0, 5) }])
      setTrack(cam.target, [{ t: 0, value: centerAfter }])
      setTrack(cam.fov, [{ t: 0, value: 34 }])
      setTrack(cam.focusDistance, [{ t: 0, value: dist }])
      setTrack(cam.aperture, [{ t: 0, value: 0.3 }])
      break
    }
    case 'carousel': {
      const dist = frame.distance * (0.9 + 0.6 * opts.intensity)
      const a0 = 40 * opts.speed
      const a1 = -40 * opts.speed
      setTrack(cam.position, [
        { t: 0, value: orbitPos(frame.center, dist, a0, 4 + opts.angle * 0.2), easing: 'easeInOutSine' },
        { t: dur, value: orbitPos(frame.center, dist, a1, 4 + opts.angle * 0.2), easing: 'easeInOutSine' }
      ])
      setTrack(cam.target, [{ t: 0, value: frame.center }])
      setTrack(cam.fov, [{ t: 0, value: 36 }])
      setTrack(cam.focusDistance, [{ t: 0, value: dist }])
      setTrack(cam.aperture, [{ t: 0, value: 0.35 }])
      const n = Math.max(1, devs.length)
      const spacing = devs.reduce((m, d) => Math.max(m, deviceWidth(d)), 90) + 50
      devs.forEach((d, i) => {
        const t0 = d.transform.keys[0]?.value ?? { position: { x: 0, y: 0, z: 0 }, rotation: { x: 0, y: 0, z: 0 }, scale: { x: 1, y: 1, z: 1 } }
        const x = (i - (n - 1) / 2) * spacing
        setTrack(d.transform, [
          { t: 0, value: { ...t0, position: { x, y: t0.position.y, z: 0 }, rotation: { x: 0, y: a0 * 0.5, z: 0 } }, easing: 'easeInOutSine' },
          { t: dur, value: { ...t0, position: { x, y: t0.position.y, z: 0 }, rotation: { x: 0, y: a1 * 0.5, z: 0 } }, easing: 'easeInOutSine' }
        ])
      })
      break
    }
    case 'laptop-open': {
      const dist = frame.distance * (1 + 0.1 * opts.intensity)
      const closeDist = dist * 0.72
      setTrack(cam.position, [
        { t: 0, value: orbitPos(frame.center, closeDist, opts.angle, 26), easing: 'easeInOutCubic' },
        { t: dur * 0.55, value: orbitPos(frame.center, dist, opts.angle, 12), easing: 'easeInOutCubic' },
        { t: dur, value: orbitPos(frame.center, dist, opts.angle * 0.4, 6) }
      ])
      setTrack(cam.target, [{ t: 0, value: frame.center }])
      setTrack(cam.fov, [{ t: 0, value: 32 }])
      setTrack(cam.focusDistance, [
        { t: 0, value: closeDist, easing: 'easeInOutCubic' },
        { t: dur * 0.55, value: dist, easing: 'easeInOutCubic' },
        { t: dur, value: dist }
      ])
      setTrack(cam.aperture, [{ t: 0, value: 0.35 }])
      devs.forEach((d) => {
        const preset = getPreset(d.presetId)
        if (preset.kind === 'laptop') {
          setTrack(d.lidAngleDeg ?? (d.lidAngleDeg = trackOf(0)), [
            { t: 0, value: 0, easing: 'easeInOutCubic' },
            { t: Math.min(dur, 2.2 / speed), value: 105, easing: 'easeOutExpo' },
            { t: dur, value: 105 }
          ])
        }
      })
      break
    }
  }
}
