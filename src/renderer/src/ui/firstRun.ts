// First-run flow (SPEC §10): "Make your first video in 60 seconds" —
// choose device → add content → pick a mode → export. Also offers the
// bundled sample project (offline Arabic + English demo page).

import { createDefaultProject, createDefaultScene, trackOf, staticTransform, defaultCameraTrack, uid } from '@shared/serialize'
import type { DeviceInstance, Scene, Transform } from '@shared/types'
import { store } from '../state/store'
import { el } from './dom'
import { toast } from './toast'
import { applyMode } from '../engine/modes'
import { assignMedia } from './leftPanel'
import { loadShowcase } from './showcase'

const FLAG = 'livemock.firstRunDone'

export function maybeShowFirstRun(): void {
  try {
    if (localStorage.getItem(FLAG) === '1') return
  } catch {
    return
  }
  const dlg = document.createElement('dialog')
  dlg.style.minWidth = '560px'

  const title = el('h2', { style: 'margin:0 0 4px;font-size:20px' }, 'Make your first video in 60 seconds')
  const sub = el('p', { style: 'color:var(--text-dim);margin:0 0 16px' }, 'Four quick steps. Everything runs locally.')

  const steps = el('div', { style: 'display:flex;flex-direction:column;gap:10px' })
  const step = (n: number, label: string, control: HTMLElement): HTMLElement => {
    const row = el('div', { class: 'row', style: 'align-items:flex-start' })
    const badge = el('span', {
      style: 'display:inline-grid;place-items:center;width:24px;height:24px;border-radius:50%;background:var(--accent);color:#fff;font-weight:700;flex:none'
    }, String(n))
    const col = el('div', { style: 'flex:1;display:flex;flex-direction:column;gap:6px' }, el('strong', {}, label), control)
    row.append(badge, col)
    return row
  }

  // 1: device
  const deviceSel = el('select') as HTMLSelectElement
  for (const [id, label] of [
    ['phone-6.9', 'Phone 6.9"'],
    ['phone-6.3', 'Phone 6.3"'],
    ['tablet-11', 'Tablet 11"'],
    ['laptop-14', 'Laptop 14"']
  ] as const) {
    deviceSel.append(el('option', { value: id }, label))
  }

  // 2: content
  const contentBtns = el('div', { style: 'display:flex;gap:8px;flex-wrap:wrap' })
  const urlInput = el('input', { type: 'text', value: 'livemock-test://local/arabic.html', style: 'flex:1;min-width:220px' }) as HTMLInputElement
  const liveBtn = el('button', { class: 'accent' }, 'Use live URL')
  const fileBtn = el('button', {}, 'Use my image/video…')
  contentBtns.append(urlInput, liveBtn, fileBtn)

  // 3: mode
  const modeSel = el('select') as HTMLSelectElement
  for (const [id, label] of [
    ['cinematic-hero', 'Cinematic Hero'],
    ['spin-reveal', 'Spin Reveal'],
    ['float-tilt', 'Float & Tilt'],
    ['laptop-open', 'Laptop Open']
  ] as const) {
    modeSel.append(el('option', { value: id }, label))
  }

  // 4: export
  const goBtn = el('button', { class: 'primary', style: 'padding:9px 18px' }, 'Create & open Export')

  const sampleRow = el('div', { class: 'row', style: 'margin-top:14px;justify-content:space-between' })
  sampleRow.append(
    el('span', { style: 'color:var(--text-dim)' }, 'Or explore a ready-made demo:'),
    el('button', { class: 'accent', onclick: () => {
      finish()
      void loadShowcase()
    } }, '✨ Mac + iPhone showcase'),
    el('button', { onclick: () => {
      loadSampleProject()
      finish()
    } }, 'Open sample project')
  )

  steps.append(
    step(1, 'Choose a device', deviceSel),
    step(2, 'Put content on the screen', contentBtns),
    step(3, 'Pick a camera mode', modeSel),
    step(4, 'Export a 9:16 video', goBtn)
  )

  liveBtn.addEventListener('click', () => {
    const url = urlInput.value.trim() || 'livemock-test://local/arabic.html'
    const { device, viewport, mobile } = ensureDevice(deviceSel.value)
    store.setDeviceScreen(device.id, {
      kind: 'url',
      url,
      viewport: { w: viewport.w, h: viewport.h, dpr: 1 },
      mobileEmulation: mobile
    })
    toast('Live page attached — press ▶ to preview')
  })

  fileBtn.addEventListener('click', () => {
    void (async () => {
      const { device } = ensureDevice(deviceSel.value)
      const entries = await window.livemock.importMediaDialog(store.project.id)
      const media = entries.find((m) => m.kind === 'image' || m.kind === 'video')
      if (!media) return
      store.addMedia([media])
      assignMedia(device.id, media)
      toast('Media attached')
    })()
  })

  goBtn.addEventListener('click', () => {
    const { device, viewport, mobile } = ensureDevice(deviceSel.value)
    if (device.screen.kind === 'none') {
      // default to the bundled demo page so the flow never dead-ends
      store.setDeviceScreen(device.id, {
        kind: 'url',
        url: urlInput.value.trim() || 'livemock-test://local/arabic.html',
        viewport: { w: viewport.w, h: viewport.h, dpr: 1 },
        mobileEmulation: mobile
      })
    }
    store.edit('First-run mode', (p) => {
      const scene = p.scenes.find((s) => s.id === store.activeSceneId) ?? p.scenes[0]
      if (scene) applyMode(scene, modeSel.value as never, { speed: 1, intensity: 1, angle: modeSel.value === 'laptop-open' ? 25 : 30 })
    })
    store.setTime(0)
    store.setPlaying(true)
    finish()
    void import('./exportDialog').then((m) => m.openExportDialog())
  })

  function ensureDevice(presetId: string): { device: DeviceInstance; viewport: { w: number; h: number }; mobile: boolean } {
    let device = store.scene.devices[0]
    if (!device || device.presetId !== presetId) {
      if (device) store.removeDevice(device.id)
      store.addDevice(presetId)
      device = store.scene.devices[0]!
    }
    const VIEWPORTS: Record<string, { w: number; h: number }> = {
      'phone-6.9': { w: 440, h: 956 },
      'phone-6.3': { w: 402, h: 874 },
      'tablet-11': { w: 834, h: 1210 },
      'laptop-14': { w: 1512, h: 982 }
    }
    return {
      device: device!,
      viewport: VIEWPORTS[presetId] ?? { w: 440, h: 956 },
      mobile: presetId.startsWith('phone') || presetId.startsWith('tablet')
    }
  }

  function finish(): void {
    try {
      localStorage.setItem(FLAG, '1')
    } catch {
      /* ignore */
    }
    dlg.close()
  }

  dlg.append(title, sub, steps, sampleRow)
  document.body.appendChild(dlg)
  dlg.showModal()
  dlg.addEventListener('close', () => {
    finish()
    dlg.remove()
  })
}

/** Bundled sample: phone with the offline Arabic demo page + Cinematic Hero. */
export function loadSampleProject(): void {
  const project = createDefaultProject('Sample — Arabic demo')
  const scene: Scene = createDefaultScene('Phone hero')
  scene.durationSec = 6
  scene.devices = [
    {
      id: uid('dv_'),
      presetId: 'phone-6.9',
      material: { finish: 'titanium', color: '#4a4a4f' },
      transform: trackOf<Transform>(staticTransform({ x: 0, y: 84, z: 0 })),
      screen: {
        kind: 'url',
        url: 'livemock-test://local/arabic.html',
        viewport: { w: 440, h: 956, dpr: 1 },
        mobileEmulation: true,
        walkthrough: [{ type: 'scroll', toY: 900, durationMs: 2500, easing: 'easeInOutCubic' }]
      },
      screenGlare: 0.2,
      cutout: 'pill'
    }
  ]
  scene.camera = defaultCameraTrack()
  applyMode(scene, 'cinematic-hero', { speed: 0.8, intensity: 1, angle: 35 })
  project.scenes = [scene]
  store.loadProject(project, null)
  store.setPlaying(true)
  toast('Sample project loaded')
}
