// App bootstrap: theme/lang from settings, WebGL2 guard, layout mount,
// keyboard shortcuts, recovery check, stats overlay.

import './ui/styles.css'
import { setLang, t } from './i18n/i18n'
import { store } from './state/store'
import { sceneController } from './engine/view'
import { mountTopbar } from './ui/topbar'
import { initLeftPanel } from './ui/leftPanel'
import { mountInspector } from './ui/inspector'
import { mountTimeline } from './ui/timeline'
import { checkRecovery, showShortcuts, showWebGlError } from './ui/dialogs'
import { maybeShowFirstRun } from './ui/firstRun'
import { el } from './ui/dom'

function hasWebGL2(): boolean {
  try {
    const canvas = document.createElement('canvas')
    return canvas.getContext('webgl2') !== null
  } catch {
    return false
  }
}

async function bootstrap(): Promise<void> {
  const settings = await window.livemock.settingsGet()
  document.documentElement.dataset['theme'] = settings.theme
  setLang(settings.language)

  const app = document.getElementById('app')!
  if (!hasWebGL2()) {
    app.textContent = ''
    showWebGlError()
    return
  }

  const topbar = document.createElement('lm-topbar')
  const left = document.createElement('lm-left')
  const viewport = document.createElement('lm-viewport')
  const inspector = document.createElement('lm-inspector')
  const timeline = document.createElement('lm-timeline')
  app.append(topbar, left, viewport, inspector, timeline)

  mountTopbar(topbar)
  initLeftPanel()
  mountInspector(inspector)
  mountTimeline(timeline)

  // stats overlay
  const stats = el('div', { id: 'stats' })
  viewport.appendChild(stats)
  let statAcc = 0
  sceneController.onStats = (s) => {
    statAcc++
    if (statAcc % 15 === 0) {
      stats.textContent = t('dev.stats', { fps: s.fps, calls: s.calls, tex: s.textures, geom: s.geometries })
    }
  }

  const hint = el('div', { class: 'viewport-hint' }, 'Drag = orbit · Scroll = zoom · Right-drag = pan · Drop media onto a device · G/R/S = move/rotate/scale · F = frame')
  viewport.appendChild(hint)

  // transform toolbar
  const toolbar = el('div', {
    style:
      'position:absolute;top:8px;left:10px;display:flex;gap:6px;align-items:center;background:color-mix(in srgb, var(--bg-2) 85%, transparent);border:1px solid var(--border);border-radius:9px;padding:4px 6px;backdrop-filter:blur(6px)'
  })
  let snapOn = true
  const mkTool = (label: string, title: string, fn: () => void, id: string): HTMLElement => {
    const b = el('button', { title, onclick: fn, style: 'padding:3px 9px;font-size:12px' }, label)
    b.dataset['tool'] = id
    return b
  }
  const markActive = (id: string): void => {
    for (const b of toolbar.querySelectorAll('button')) {
      if (b.dataset['tool']) {
        b.classList.toggle('primary', b.dataset['tool'] === id)
        b.classList.toggle('accent', b.dataset['tool'] === id)
      }
    }
  }
  const setMode = (mode: 'translate' | 'rotate' | 'scale'): void => {
    sceneController.setGizmoMode(mode)
    markActive(mode)
  }
  toolbar.append(
    mkTool('↔ Move', 'Move (G)', () => setMode('translate'), 'translate'),
    mkTool('⟳ Rotate', 'Rotate (R)', () => setMode('rotate'), 'rotate'),
    mkTool('⤢ Scale', 'Scale (S)', () => setMode('scale'), 'scale'),
    el('span', { style: 'width:6px' }),
    mkTool('⊞ Snap', 'Snap to grid (10mm / 15°)', () => {
      snapOn = !snapOn
      sceneController.setSnap(snapOn)
      toolbar.children[4]?.classList.toggle('accent', snapOn)
    }, 'snap'),
    mkTool('⤢ Frame', 'Frame selected (F)', () => {
      const id = store.selectedDeviceId ?? store.scene.devices[0]?.id
      if (id) sceneController.frameDevice(id)
    }, 'frame')
  )
  markActive('translate')
  viewport.appendChild(toolbar)

  sceneController.mount(viewport)

  // keyboard shortcuts
  window.addEventListener('keydown', (e) => {
    const target = e.target as HTMLElement
    if (target.tagName === 'INPUT' || target.tagName === 'SELECT' || target.tagName === 'TEXTAREA') return
    const meta = e.metaKey || e.ctrlKey
    if (meta && e.key.toLowerCase() === 'z') {
      e.preventDefault()
      if (e.shiftKey) store.redo()
      else store.undo()
      return
    }
    if (meta && e.key.toLowerCase() === 's') {
      e.preventDefault()
      topbar.querySelector<HTMLButtonElement>('button')?.focus()
      return
    }
    if (meta && e.shiftKey && e.key.toLowerCase() === 'f') {
      e.preventDefault()
      void import('./ui/frameExport').then((m) => m.exportFrameNow())
      return
    }
    if (meta && e.key.toLowerCase() === 'e') {
      e.preventDefault()
      import('./ui/exportDialog').then((m) => m.openExportDialog())
      return
    }
    switch (e.key) {
      case ' ':
        e.preventDefault()
        store.togglePlay()
        break
      case 'g':
      case 'G':
        sceneController.setGizmoMode('translate')
        break
      case 'r':
      case 'R':
        sceneController.setGizmoMode('rotate')
        break
      case 's':
      case 'S':
        sceneController.setGizmoMode('scale')
        break
      case 'f':
      case 'F': {
        const id = store.selectedDeviceId ?? store.scene.devices[0]?.id
        if (id) sceneController.frameDevice(id)
        break
      }
      case 'ArrowUp':
      case 'ArrowDown':
      case 'ArrowLeft':
      case 'ArrowRight': {
        e.preventDefault()
        if (store.selectedDeviceId && !store.playing) {
          // nudge selected device in X/Z (shift = 50mm)
          const step = e.shiftKey ? 50 : 10
          const dz = e.key === 'ArrowUp' ? -step : e.key === 'ArrowDown' ? step : 0
          const dx = e.key === 'ArrowLeft' ? -step : e.key === 'ArrowRight' ? step : 0
          sceneController.nudgeSelected(dx, 0, dz)
        } else {
          // scrub
          store.setTime(store.time + (e.shiftKey ? 1 : 1 / store.scene.fps) * (e.key === 'ArrowLeft' ? -1 : 1))
        }
        break
      }
      case 'Escape':
        sceneController.setGizmoMode(null)
        break
      case '?':
        showShortcuts()
        break
    }
  })

  await checkRecovery()
  window.setTimeout(() => maybeShowFirstRun(), 600)

  // expose for E2E tests only (never used in production code paths)
  void Promise.all([import('./engine/modes'), import('./export/exporter'), import('./ui/frameExport'), import('./ui/leftPanel')]).then(([m, ex, fr, lp]) => {
    ;(window as unknown as { __lmTest?: unknown }).__lmTest = {
      store,
      sceneController,
      export: (settings: Parameters<typeof ex.startExport>[0], onProgress?: (p: unknown) => void) => {
        const handle = ex.startExport(settings, store.scene, (p) => onProgress?.(p))
        return handle.promise
      },
      getThree: () => sceneController.debugThree(),
      exportStill: ex.exportStill,
      exportFrameNow: fr.exportFrameNow,
      dropOntoDevice: lp.dropOntoDevice
    }
    ;(window as unknown as { __lmModes?: unknown }).__lmModes = { apply: m.applyMode }
  })
}

void bootstrap()
