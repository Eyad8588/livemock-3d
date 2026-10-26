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

  const hint = el('div', { class: 'viewport-hint' }, 'Drag = orbit · Scroll = zoom · Right-drag = pan · Drop media onto a device')
  viewport.appendChild(hint)

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
    if (meta && e.key.toLowerCase() === 'e') {
      e.preventDefault()
      import('./ui/dialogs').then((m) => m.openExportDialog())
      return
    }
    switch (e.key) {
      case ' ':
        e.preventDefault()
        store.togglePlay()
        break
      case 'ArrowRight':
        e.preventDefault()
        store.setTime(store.time + (e.shiftKey ? 1 : 1 / store.scene.fps))
        break
      case 'ArrowLeft':
        e.preventDefault()
        store.setTime(store.time - (e.shiftKey ? 1 : 1 / store.scene.fps))
        break
      case 'g':
      case 'G':
        sceneController.setGizmoMode('translate')
        break
      case 'r':
      case 'R':
        sceneController.setGizmoMode('rotate')
        break
      case 'Escape':
        sceneController.setGizmoMode(null)
        break
      case '?':
        showShortcuts()
        break
    }
  })

  await checkRecovery()

  // expose for E2E tests only (never used in production code paths)
  ;(window as unknown as { __lmTest?: unknown }).__lmTest = { store, sceneController }
}

void bootstrap()
