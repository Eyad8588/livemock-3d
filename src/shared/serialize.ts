// Project serialization: defaults, validation and schema migration.
// Pure module — unit tested.

import { DEFAULT_ENVIRONMENT, SCHEMA_VERSION } from './presets'
import type {
  CameraTrack,
  DeviceInstance,
  EasingId,
  Keyframe,
  Project,
  Scene,
  Transform,
  Track,
  Vec3,
  WalkthroughStep
} from './types'
import { looksLikeProject } from './ipc'

export function uid(prefix = ''): string {
  const b = new Uint8Array(8)
  crypto.getRandomValues(b)
  const hex = Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('')
  return `${prefix}${hex}`
}

export function zeroVec(): Vec3 {
  return { x: 0, y: 0, z: 0 }
}

export function trackOf<T>(value: T): Track<T> {
  return { keys: [{ t: 0, value: structuredClone(value), easing: 'easeInOutCubic' }] }
}

export function staticTransform(position: Vec3 = zeroVec(), rotation: Vec3 = zeroVec()): Transform {
  return { position, rotation, scale: { x: 1, y: 1, z: 1 } }
}

export function defaultCameraTrack(): CameraTrack {
  return {
    position: trackOf<Vec3>({ x: 0, y: 95, z: 540 }),
    target: trackOf<Vec3>({ x: 0, y: 80, z: 0 }),
    fov: trackOf<number>(32),
    focusDistance: trackOf<number>(540),
    aperture: trackOf<number>(0.4)
  }
}

export function createDefaultScene(name = 'Scene 1'): Scene {
  return {
    id: uid('sc_'),
    name,
    durationSec: 8,
    fps: 30,
    devices: [],
    environment: { ...DEFAULT_ENVIRONMENT },
    camera: defaultCameraTrack(),
    overlays: [],
    postFx: {
      depthOfField: false,
      bloom: false,
      bloomStrength: 0.25,
      vignette: false,
      filmGrain: false
    }
  }
}

export function createDefaultProject(name = 'Untitled Project'): Project {
  const now = new Date().toISOString()
  return {
    schemaVersion: SCHEMA_VERSION,
    id: uid('pr_'),
    name,
    scenes: [createDefaultScene()],
    exportPresets: [],
    media: [],
    takes: [],
    createdAt: now,
    updatedAt: now
  }
}

/** Keyframe type guards / normalizers used by migration. */
function normalizeTrack<T>(t: unknown, clampT: number): Track<T> | null {
  if (!t || typeof t !== 'object') return null
  const keys = (t as Track<T>).keys
  if (!Array.isArray(keys) || keys.length === 0) return null
  return {
    keys: keys
      .filter((k): k is Keyframe<T> => k !== null && typeof k === 'object' && 't' in k && 'value' in k)
      .map((k) => ({
        t: Math.min(clampT, Math.max(0, Number(k.t) || 0)),
        value: k.value,
        easing: (['linear', 'easeInOutCubic', 'easeOutExpo', 'easeInOutSine', 'spring', 'bezier'] as EasingId[]).includes(
          k.easing
        )
          ? k.easing
          : 'easeInOutCubic',
        ...(k.bezier && Array.isArray(k.bezier) && k.bezier.length === 4 ? { bezier: k.bezier } : {})
      }))
      .sort((a, b) => a.t - b.t)
  }
}

const MIGRATIONS: Record<number, (p: Record<string, unknown>) => Record<string, unknown>> = {
  // schemaVersion 1 is current; future migrations chain from older versions here.
  1: (p) => p
}

export function migrate(raw: unknown): Project {
  if (!looksLikeProject(raw)) throw new Error('File is not a LiveMock project')
  let p = raw as unknown as Record<string, unknown>
  let v = Number(p.schemaVersion)
  while (v < SCHEMA_VERSION) {
    const next = MIGRATIONS[v]
    if (!next) throw new Error(`Cannot migrate project schema v${v}`)
    p = next(p)
    v = Number(p.schemaVersion)
    if (!Number.isFinite(v)) throw new Error('Corrupt schemaVersion after migration')
  }
  if (v > SCHEMA_VERSION) throw new Error(`Project was created by a newer version (schema v${v})`)

  // Re-validate deeply; drop anything structurally broken rather than crash.
  const out = raw as Project
  out.scenes = out.scenes
    .map((s, si) => {
      if (!s || typeof s !== 'object') return null
      const durationSec = Math.min(60, Math.max(3, Number(s.durationSec) || 8))
      const fps = ([24, 30, 60] as const).includes(s.fps) ? s.fps : 30
      const devices = (Array.isArray(s.devices) ? s.devices : [])
        .slice(0, 4)
        .map((d) => normalizeDevice(d, durationSec))
        .filter((d): d is DeviceInstance => d !== null)
      const camera = s.camera ?? defaultCameraTrack()
      return {
        ...s,
        id: s.id || uid('sc_'),
        name: s.name || `Scene ${si + 1}`,
        durationSec,
        fps,
        devices,
        environment: { ...DEFAULT_ENVIRONMENT, ...(s.environment ?? {}) },
        camera: {
          position: normalizeTrack<Vec3>(camera.position, durationSec) ?? defaultCameraTrack().position,
          target: normalizeTrack<Vec3>(camera.target, durationSec) ?? defaultCameraTrack().target,
          fov: normalizeTrack<number>(camera.fov, durationSec) ?? trackOf(32),
          focusDistance: normalizeTrack<number>(camera.focusDistance, durationSec) ?? trackOf(320),
          aperture: normalizeTrack<number>(camera.aperture, durationSec) ?? trackOf(0.4)
        },
        overlays: Array.isArray(s.overlays) ? s.overlays : [],
        postFx: { ...createDefaultScene().postFx, ...(s.postFx ?? {}) }
      } satisfies Scene
    })
    .filter((s): s is Scene => s !== null)
  if (out.scenes.length === 0) out.scenes = [createDefaultScene()]
  out.media = Array.isArray(out.media) ? out.media : []
  out.takes = Array.isArray(out.takes) ? out.takes : []
  out.exportPresets = Array.isArray(out.exportPresets) ? out.exportPresets : []
  return out
}

function normalizeDevice(d: unknown, durationSec: number): DeviceInstance | null {
  if (!d || typeof d !== 'object') return null
  const dev = d as Partial<DeviceInstance>
  if (typeof dev.id !== 'string' || typeof dev.presetId !== 'string') return null
  return {
    ...dev,
    id: dev.id,
    presetId: dev.presetId,
    material: {
      finish: dev.material?.finish ?? 'aluminum',
      color: dev.material?.color ?? '#8e9096'
    },
    transform:
      normalizeTrack<Transform>(dev.transform, durationSec) ??
      trackOf<Transform>(staticTransform()),
    screen: dev.screen ?? { kind: 'none' },
    screenGlare: Math.min(1, Math.max(0, Number(dev.screenGlare) || 0)),
    cutout: dev.cutout ?? 'none',
    ...(dev.lidAngleDeg ? { lidAngleDeg: normalizeTrack<number>(dev.lidAngleDeg, durationSec) ?? trackOf(105) } : {})
  } as DeviceInstance
}

/** Total wall-clock duration of a walkthrough script, in ms. */
export function walkthroughDurationMs(steps: WalkthroughStep[]): number {
  let total = 0
  for (const s of steps) {
    switch (s.type) {
      case 'wait':
        total += s.ms
        break
      case 'scroll':
      case 'scrollToSelector':
        total += s.durationMs
        break
      case 'tap':
      case 'tapSelector':
        total += 350
        break
      case 'type': {
        const text = s.text ?? ''
        const chars = Math.max(1, text.length)
        total += Math.max(600, (chars / Math.max(60, s.cpm)) * 60_000)
        break
      }
    }
  }
  return total
}
