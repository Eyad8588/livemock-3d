// Bottom timeline: transport + canvas-drawn tracks with keyframe editing.
// Rows per device (transform, lid for laptops) + camera (move, lens).
// Add/move/delete keyframes, easing via context menu, snap to frames,
// loop region on the ruler, horizontal zoom, scrub.

import { evalTrack } from '@shared/easingMath'
import type { EasingId, Keyframe, Track } from '@shared/types'
import { store } from '../state/store'
import { t, onLangChange } from '../i18n/i18n'
import { el, clear } from './dom'

interface RowRef {
  kind: 'transform' | 'lid' | 'cam-move' | 'cam-lens'
  deviceId?: string
  label: string
}

const EASING_CYCLE: EasingId[] = ['linear', 'easeInOutCubic', 'easeOutExpo', 'easeInOutSine', 'spring', 'bezier']

export function mountTimeline(root: HTMLElement): void {
  const canvas = document.createElement('canvas')
  canvas.style.height = '100%'
  const toolbar = el('div', { class: 'tl-toolbar' })
  root.append(toolbar, canvas)

  let zoom = 1 // horizontal zoom factor
  let viewT0 = 0 // left edge time
  let loopA: number | null = null
  let loopB: number | null = null
  let selected: { row: RowRef; index: number } | null = null
  let clip: Keyframe<unknown> | null = null

  // ---------- transport ----------
  const renderToolbar = (): void => {
    clear(toolbar)
    const playBtn = el('button', { onclick: () => store.togglePlay(), title: t('time.play') }, store.playing ? '⏸' : '▶')
    const stopBtn = el('button', { onclick: () => { store.setPlaying(false); store.setTime(0) } }, '⏮')
    const loopBtn = el('button', { onclick: () => { store.loop = !store.loop; renderToolbar() } }, store.loop ? '🔁 on' : '🔁 off')
    const timeLabel = el('span', { style: 'color:var(--text-dim);min-width:110px' }, formatTime(store.time, store.scene.durationSec))
    const zoomOut = el('button', { onclick: () => { zoom = Math.max(1, zoom / 1.3) } }, '−')
    const zoomIn = el('button', { onclick: () => { zoom = Math.min(12, zoom * 1.3) } }, '+')
    const zoomReset = el('button', { onclick: () => { zoom = 1; viewT0 = 0 } }, 'Fit')
    const help = el('span', { style: 'color:var(--text-dim);font-size:11px' }, 'click row: add key · drag: move · right-click: easing/delete · ⌘C/⌘V: copy/paste')
    toolbar.append(stopBtn, playBtn, loopBtn, timeLabel, el('span', { style: 'flex:1' }), help, zoomOut, zoomIn, zoomReset, el('span', { class: 'badge' }, `${store.scene.fps} fps`))
  }

  // ---------- rows ----------
  function rows(): RowRef[] {
    const scene = store.scene
    const out: RowRef[] = []
    for (const d of scene.devices) {
      out.push({ kind: 'transform', deviceId: d.id, label: `${d.presetId} · transform` })
      if (d.presetId.startsWith('laptop')) out.push({ kind: 'lid', deviceId: d.id, label: `${d.presetId} · lid` })
    }
    out.push({ kind: 'cam-move', label: 'camera · move' })
    out.push({ kind: 'cam-lens', label: 'camera · lens' })
    return out
  }

  function trackFor(row: RowRef): Track<unknown> | null {
    const scene = store.scene
    switch (row.kind) {
      case 'transform':
        return scene.devices.find((d) => d.id === row.deviceId)?.transform ?? null
      case 'lid':
        return scene.devices.find((d) => d.id === row.deviceId)?.lidAngleDeg ?? null
      case 'cam-move':
        return scene.camera.position as unknown as Track<unknown>
      case 'cam-lens':
        return scene.camera.fov as unknown as Track<unknown>
    }
  }

  /** Values on combined rows: merge multiple tracks for display. */
  function displayTimes(row: RowRef): { t: number; primary: boolean }[] {
    const scene = store.scene
    if (row.kind === 'cam-move') {
      const times = new Map<number, boolean>()
      for (const k of scene.camera.position.keys) times.set(k.t, true)
      for (const k of scene.camera.target.keys) if (!times.has(k.t)) times.set(k.t, false)
      return [...times.entries()].map(([t, primary]) => ({ t, primary }))
    }
    if (row.kind === 'cam-lens') {
      const times = new Map<number, boolean>()
      for (const k of scene.camera.fov.keys) times.set(k.t, true)
      for (const k of scene.camera.focusDistance.keys) if (!times.has(k.t)) times.set(k.t, false)
      for (const k of scene.camera.aperture.keys) if (!times.has(k.t)) times.set(k.t, false)
      return [...times.entries()].map(([t, primary]) => ({ t, primary }))
    }
    const track = trackFor(row)
    if (!track) return []
    return track.keys.map((k) => ({ t: k.t, primary: true }))
  }

  // ---------- drawing ----------
  const draw = (): void => {
    requestAnimationFrame(draw)
    const dpr = window.devicePixelRatio
    const w = canvas.clientWidth
    const h = canvas.clientHeight
    if (canvas.width !== Math.round(w * dpr) || canvas.height !== Math.round(h * dpr)) {
      canvas.width = Math.round(w * dpr)
      canvas.height = Math.round(h * dpr)
    }
    const ctx = canvas.getContext('2d')
    if (!ctx || w === 0) return
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    ctx.clearRect(0, 0, w, h)

    const styles = getComputedStyle(document.documentElement)
    const css = (v: string, fb: string): string => styles.getPropertyValue(v).trim() || fb
    const border = css('--border', '#262b36')
    const dim = css('--text-dim', '#9aa3b2')
    const accent = css('--accent', '#4f8cff')
    const accent2 = css('--accent-2', '#7ecbff')

    const scene = store.scene
    const dur = scene.durationSec
    const pxPerSec = (w / dur) * zoom
    const tToX = (tv: number): number => (tv - viewT0) * pxPerSec
    const rulerH = 22
    const rws = rows()
    const rowH = Math.max(20, Math.min(34, (h - rulerH - 8) / Math.max(rws.length, 1)))

    // rows background
    rws.forEach((row, i) => {
      const y = rulerH + 4 + i * rowH
      ctx.fillStyle = i % 2 === 0 ? 'rgba(255,255,255,0.02)' : 'transparent'
      ctx.fillRect(0, y, w, rowH)
      ctx.fillStyle = dim
      ctx.font = '10px system-ui'
      ctx.fillText(row.label, 8, y + rowH / 2 + 3)
    })

    // loop region
    if (loopA !== null && loopB !== null) {
      const x0 = tToX(Math.min(loopA, loopB))
      const x1 = tToX(Math.max(loopA, loopB))
      ctx.fillStyle = 'rgba(79,140,255,0.10)'
      ctx.fillRect(x0, 0, x1 - x0, h)
    }

    // ruler
    ctx.strokeStyle = border
    ctx.fillStyle = dim
    ctx.font = '10px system-ui'
    const step = niceStep(dur / zoom, w)
    for (let s = Math.floor(viewT0 / step) * step; s <= viewT0 + dur / zoom + step; s += step) {
      if (s < 0 || s > dur) continue
      const x = tToX(s)
      ctx.beginPath()
      ctx.moveTo(x, 0)
      ctx.lineTo(x, rulerH)
      ctx.stroke()
      if (step >= 1 || Number.isInteger(s)) ctx.fillText(`${Math.round(s)}s`, x + 3, 12)
    }

    // keyframes
    const frame = 1 / scene.fps
    rws.forEach((row, i) => {
      const y = rulerH + 4 + i * rowH + rowH / 2
      const marks = displayTimes(row)
      for (const m of marks) {
        const x = tToX(m.t)
        if (x < -8 || x > w + 8) continue
        const isSelected = selected && selected.row.kind === row.kind && selected.row.deviceId === row.deviceId && trackFor(row)?.keys[selected.index]?.t === m.t
        ctx.save()
        ctx.translate(x, y)
        ctx.rotate(Math.PI / 4)
        ctx.fillStyle = m.primary ? accent2 : dim
        ctx.strokeStyle = isSelected ? '#ffffff' : border
        ctx.lineWidth = 1.5
        const s = m.primary ? 5 : 3.6
        ctx.beginPath()
        ctx.rect(-s / 2, -s / 2, s, s)
        ctx.fill()
        ctx.stroke()
        ctx.restore()
      }
      void frame
    })

    // playhead
    const px = tToX(store.time)
    ctx.strokeStyle = accent
    ctx.lineWidth = 2
    ctx.beginPath()
    ctx.moveTo(px, 0)
    ctx.lineTo(px, h)
    ctx.stroke()
    ctx.lineWidth = 1
  }

  // ---------- interaction ----------
  const snap = (tv: number): number => Math.round(tv * store.scene.fps) / store.scene.fps

  function rowAt(y: number): { row: RowRef; index: number } | null {
    const rulerH = 22
    const rws = rows()
    const rowH = Math.max(20, Math.min(34, (canvas.clientHeight - rulerH - 8) / Math.max(rws.length, 1)))
    const i = Math.floor((y - rulerH - 4) / rowH)
    if (i < 0 || i >= rws.length) return null
    return { row: rws[i]!, index: i }
  }

  const tAtX = (x: number): number => {
    const pxPerSec = (canvas.clientWidth / store.scene.durationSec) * zoom
    return Math.max(0, viewT0 + x / pxPerSec)
  }

  canvas.addEventListener('pointerdown', (e) => {
    const rect = canvas.getBoundingClientRect()
    const x = e.clientX - rect.left
    const y = e.clientY - rect.top

    // ruler: scrub; drag with shift sets loop region
    if (y < 22) {
      const tv = snap(Math.min(store.scene.durationSec, tAtX(x)))
      if (e.shiftKey) {
        loopA = tv
        loopB = tv
        const move = (ev: PointerEvent): void => {
          loopB = snap(tAtX(ev.clientX - rect.left))
        }
        const up = (): void => {
          window.removeEventListener('pointermove', move)
          window.removeEventListener('pointerup', up)
          if (loopA !== null && loopB !== null && Math.abs(loopB - loopA) < 0.1) {
            loopA = null
            loopB = null
          }
        }
        window.addEventListener('pointermove', move)
        window.addEventListener('pointerup', up)
      } else {
        if (loopA !== null && loopB !== null) {
          const a = Math.min(loopA, loopB)
          const b = Math.max(loopA, loopB)
          store.setTime(Math.min(b, Math.max(a, tv)))
        } else {
          store.setTime(tv)
        }
        const move = (ev: PointerEvent): void => {
          const t2 = snap(Math.min(store.scene.durationSec, tAtX(ev.clientX - rect.left)))
          if (loopA !== null && loopB !== null) {
            const a = Math.min(loopA, loopB)
            const b = Math.max(loopA, loopB)
            store.setTime(Math.min(b, Math.max(a, t2)))
          } else {
            store.setTime(t2)
          }
        }
        const up = (): void => {
          window.removeEventListener('pointermove', move)
          window.removeEventListener('pointerup', up)
        }
        window.addEventListener('pointermove', move)
        window.addEventListener('pointerup', up)
      }
      return
    }

    const hit = rowAt(y)
    if (!hit) return
    const marks = displayTimes(hit.row)
    // find nearest keyframe diamond within 8px
    let nearest: { index: number; dist: number; t: number } | null = null
    marks.forEach((m, i) => {
      if (!m.primary) return
      const kx = (m.t - viewT0) * ((canvas.clientWidth / store.scene.durationSec) * zoom)
      const d = Math.abs(kx - x)
      if (d < 8 && (!nearest || d < nearest.dist)) nearest = { index: i, dist: d, t: m.t }
    })

    if (e.button === 2) {
      if (nearest) {
        // resolve actual key index across merged display (camera rows: primary only)
        showContextMenu(e.clientX, e.clientY, hit.row, nearestTIndex(hit.row, (nearest as { t: number }).t))
      }
      return
    }

    if (nearest) {
      selected = { row: hit.row, index: nearestTIndex(hit.row, (nearest as { t: number }).t) }
      const startIndex = selected.index
      const track = trackFor(hit.row)
      if (!track) return
      const key = track.keys[startIndex]
      if (!key) return
      const grabOffset = tAtX(x) - key.t
      const move = (ev: PointerEvent): void => {
        const nt = snap(tAtX(ev.clientX - rect.left) - grabOffset)
        store.edit('Move keyframe', (p) => {
          const tr = trackForInProject(p, hit.row)
          const k = tr?.keys[startIndex]
          if (k) k.t = Math.max(0, nt)
          tr?.keys.sort((a, b) => a.t - b.t)
        })
      }
      const up = (): void => {
        window.removeEventListener('pointermove', move)
        window.removeEventListener('pointerup', up)
      }
      window.addEventListener('pointermove', move)
      window.addEventListener('pointerup', up)
      return
    }

    // empty space: add keyframe at snapped time with the currently evaluated value
    const tv = snap(Math.min(store.scene.durationSec, tAtX(x)))
    addKeyframeAt(hit.row, tv)
  })

  canvas.addEventListener('contextmenu', (e) => e.preventDefault())

  function nearestTIndex(row: RowRef, time: number): number {
    const track = trackFor(row)
    if (!track) return 0
    let best = 0
    let bestDist = Infinity
    track.keys.forEach((k, i) => {
      const d = Math.abs(k.t - time)
      if (d < bestDist) {
        bestDist = d
        best = i
      }
    })
    return best
  }

  function trackForInProject(p: typeof store.project, row: RowRef): Track<unknown> | null {
    const scene = p.scenes.find((s) => s.id === store.activeSceneId) ?? p.scenes[0]
    if (!scene) return null
    switch (row.kind) {
      case 'transform':
        return scene.devices.find((d) => d.id === row.deviceId)?.transform ?? null
      case 'lid':
        return scene.devices.find((d) => d.id === row.deviceId)?.lidAngleDeg ?? null
      case 'cam-move':
        return scene.camera.position as unknown as Track<unknown>
      case 'cam-lens':
        return scene.camera.fov as unknown as Track<unknown>
    }
  }

  function addKeyframeAt(row: RowRef, time: number): void {
    // sample current evaluated value at that time and insert
    const scene = store.scene
    let value: unknown
    switch (row.kind) {
      case 'transform': {
        const dev = scene.devices.find((d) => d.id === row.deviceId)
        value = evalTrack(dev?.transform, time) ?? dev?.transform.keys[0]?.value
        break
      }
      case 'lid': {
        const dev = scene.devices.find((d) => d.id === row.deviceId)
        value = evalTrack(dev?.lidAngleDeg, time) ?? 105
        break
      }
      case 'cam-move':
        value = evalTrack(scene.camera.position, time)
        break
      case 'cam-lens':
        value = evalTrack(scene.camera.fov, time)
        break
    }
    if (value === undefined) return
    store.edit('Add keyframe', (p) => {
      const tr = trackForInProject(p, row)
      if (!tr) return
      if (tr.keys.some((k) => Math.abs(k.t - time) < 1e-6)) return
      tr.keys.push({ t: time, value: JSON.parse(JSON.stringify(value)), easing: 'easeInOutCubic' })
      tr.keys.sort((a, b) => a.t - b.t)
    })
  }

  function deleteSelected(): void {
    if (!selected) return
    const sel = selected
    store.edit('Delete keyframe', (p) => {
      const tr = trackForInProject(p, sel.row)
      if (tr && tr.keys.length > 1) tr.keys.splice(sel.index, 1)
    })
    selected = null
  }

  function showContextMenu(px: number, py: number, row: RowRef, keyIndex: number): void {
    const menu = el('div', {
      style: 'position:fixed;z-index:1000;background:var(--bg-2);border:1px solid var(--border);border-radius:9px;padding:6px;min-width:170px;box-shadow:0 10px 30px rgba(0,0,0,.4)'
    })
    const track = trackFor(row)
    const key = track?.keys[keyIndex]
    for (const ease of EASING_CYCLE) {
      menu.appendChild(
        el('div', {
          class: 'list-item',
          style: 'margin:0;padding:6px 9px',
          onclick: () => {
            store.edit('Change easing', (p) => {
              const tr = trackForInProject(p, row)
              const k = tr?.keys[keyIndex]
              if (k) k.easing = ease
            })
            menu.remove()
          }
        }, `${key?.easing === ease ? '● ' : '○ '} ${ease}`)
      )
    }
    menu.appendChild(
      el('div', {
        class: 'list-item',
        style: 'margin:0;padding:6px 9px;color:var(--danger)',
        onclick: () => {
          store.edit('Delete keyframe', (p) => {
            const tr = trackForInProject(p, row)
            if (tr && tr.keys.length > 1) tr.keys.splice(keyIndex, 1)
          })
          menu.remove()
        }
      }, 'Delete keyframe')
    )
    document.body.appendChild(menu)
    const closer = (ev: MouseEvent): void => {
      if (!menu.contains(ev.target as Node)) {
        menu.remove()
        window.removeEventListener('pointerdown', closer, true)
      }
    }
    window.addEventListener('pointerdown', closer, true)
    void px
    void py
  }

  // keyboard: delete / copy / paste when timeline has selection
  window.addEventListener('keydown', (e) => {
    if (!selected) return
    const target = e.target as HTMLElement
    if (target.tagName === 'INPUT' || target.tagName === 'SELECT') return
    const meta = e.metaKey || e.ctrlKey
    const track = selected ? trackFor(selected.row) : null
    if (e.key === 'Delete' || e.key === 'Backspace') {
      e.preventDefault()
      deleteSelected()
    } else if (meta && e.key.toLowerCase() === 'c' && track && selected) {
      const k = track.keys[selected.index]
      if (k) clip = JSON.parse(JSON.stringify(k))
    } else if (meta && e.key.toLowerCase() === 'v' && clip && track && selected) {
      store.edit('Paste keyframe', (p) => {
        const tr = trackForInProject(p, selected!.row)
        if (!tr) return
        const t = snap(store.time)
        if (tr.keys.some((k) => Math.abs(k.t - t) < 1e-6)) return
        tr.keys.push({ ...JSON.parse(JSON.stringify(clip)), t })
        tr.keys.sort((a, b) => a.t - b.t)
      })
    }
  })

  const updateTimeLabel = (): void => {
    const label = toolbar.children[3] as HTMLElement | undefined
    if (label) label.textContent = formatTime(store.time, store.scene.durationSec)
  }

  store.on('playback', renderToolbar)
  store.on('project', renderToolbar)
  store.on('time', updateTimeLabel)
  onLangChange(renderToolbar)
  renderToolbar()
  draw()
}

function formatTime(t: number, dur: number): string {
  return `${t.toFixed(2)}s / ${dur.toFixed(2)}s`
}

function niceStep(dur: number, widthPx: number): number {
  const target = widthPx / 12
  const raw = dur / Math.max(1, target)
  const steps = [0.25, 0.5, 1, 2, 5, 10, 15, 30, 60]
  for (const s of steps) if (raw <= s) return s
  return 60
}
