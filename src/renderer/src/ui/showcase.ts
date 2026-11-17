// "Mac + iPhone" showcase preset: MacBook Pro 16" + iPhone 17 Pro Max (GLB
// models when present, procedural fallbacks otherwise) with a sample video on
// each screen, a composed hero camera with a slow push-in, ready to export.

import { createDefaultScene, staticTransform, trackOf, uid } from '@shared/serialize'
import { getPreset } from '@shared/presets'
import type { DeviceInstance, MediaEntry, Scene, ScreenSource, Transform, Vec3 } from '@shared/types'
import { store } from '../state/store'
import { toast } from './toast'

const MAC_GLB = 'macbook_pro_m3_16_inch_2024.glb'
const PHONE_GLB = 'phone_17_pro_max.glb'

export function videoScreen(m: Pick<MediaEntry, 'id' | 'durationSec'>, fit: 'fill' | 'fit' | 'crop' = 'crop'): ScreenSource {
  return { kind: 'video', mediaId: m.id, fit, trimIn: 0, trimOut: m.durationSec ?? 5, rate: 1, loop: true, offsetSec: 0 }
}

function device(presetId: string, t: Transform, screen: ScreenSource): DeviceInstance {
  const preset = getPreset(presetId)
  return {
    id: uid('dv_'),
    presetId,
    material: { finish: preset.defaultFinish, color: preset.defaultColor },
    transform: trackOf(t),
    screen,
    screenGlare: preset.modelFile ? 0.06 : 0.18,
    cutout: preset.cutout,
    ...(preset.kind === 'laptop' ? { lidAngleDeg: trackOf(105) } : {})
  }
}

/** Composition numbers (mm). Laptop centered, phone standing front-right, angled in. */
export function buildShowcaseScene(opts: { glb: boolean; laptopMedia?: MediaEntry; phoneMedia?: MediaEntry }): Scene {
  const scene = createDefaultScene('Mac + iPhone')
  scene.durationSec = 6
  scene.fps = 30
  const laptopId = opts.glb ? 'glb-macbook-16' : 'laptop-16'
  const phoneId = opts.glb ? 'glb-iphone-17-pro-max' : 'phone-6.9'
  const phoneY = opts.glb ? 0 : getPreset(phoneId).body.h / 2 + 2
  const none: ScreenSource = { kind: 'none' }
  scene.devices = [
    device(laptopId, staticTransform({ x: -40, y: 0, z: 0 }), opts.laptopMedia ? videoScreen(opts.laptopMedia) : none),
    device(phoneId, staticTransform({ x: 215, y: phoneY, z: 95 }, { x: 0, y: -16, z: 0 }), opts.phoneMedia ? videoScreen(opts.phoneMedia) : none)
  ]
  scene.environment = { id: 'studio-gradient', colorA: '#e6e8ed', colorB: '#7a8191', colorC: '#ffffff' }
  // slow, eased push-in + drift: reads as "hero product shot"
  const p0: Vec3 = { x: -190, y: 270, z: 900 }
  const p1: Vec3 = { x: -10, y: 225, z: 790 }
  const tgt0: Vec3 = { x: 30, y: 100, z: 40 }
  const tgt1: Vec3 = { x: 40, y: 98, z: 45 }
  scene.camera.position = { keys: [{ t: 0, value: p0, easing: 'easeInOutSine' }, { t: scene.durationSec, value: p1, easing: 'easeInOutSine' }] }
  scene.camera.target = { keys: [{ t: 0, value: tgt0, easing: 'easeInOutSine' }, { t: scene.durationSec, value: tgt1, easing: 'easeInOutSine' }] }
  scene.camera.fov = trackOf(30)
  scene.camera.focusDistance = trackOf(700)
  scene.postFx = { depthOfField: false, bloom: false, bloomStrength: 0.2, vignette: true, filmGrain: false }
  return scene
}

/** Add the showcase as a new scene in the current project and switch to it. */
export async function loadShowcase(): Promise<Scene | null> {
  try {
    const models = await window.livemock.modelsAvailable()
    const glb = models.includes(MAC_GLB) && models.includes(PHONE_GLB)
    const media = await window.livemock.importSampleMedia(['sample-laptop.mp4', 'sample-phone.mp4'], store.project.id)
    store.addMedia(media)
    const scene = buildShowcaseScene({
      glb,
      laptopMedia: media.find((m) => m.name === 'sample-laptop.mp4'),
      phoneMedia: media.find((m) => m.name === 'sample-phone.mp4')
    })
    // reuse an empty default scene instead of piling up scenes
    const current = store.scene
    const replace = current.devices.length === 0
    store.edit('Add Mac + iPhone showcase', (p) => {
      if (replace) {
        const i = p.scenes.findIndex((s) => s.id === current.id)
        if (i >= 0) p.scenes[i] = scene
        else p.scenes.push(scene)
      } else {
        p.scenes.push(scene)
      }
    })
    store.activeSceneId = scene.id
    store.selectedDeviceId = null
    store.emit('selection')
    store.emit('project')
    store.setTime(0)
    store.setPlaying(true)
    toast(glb ? 'Mac + iPhone showcase ready — drop your own videos onto the screens' : 'Showcase ready (GLB models not found — using built-in devices)')
    return scene
  } catch (err) {
    toast(`Could not build showcase: ${err instanceof Error ? err.message : String(err)}`)
    return null
  }
}
