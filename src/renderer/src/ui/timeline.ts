// Bottom timeline: transport controls + canvas-drawn track area (tracks land
// in M3; transport + ruler are live from M1).
import { store } from '../state/store'
import { t, onLangChange } from '../i18n/i18n'
import { el, clear } from './dom'

export function mountTimeline(root: HTMLElement): void {
  const canvas = document.createElement('canvas')
  canvas.style.height = '100%'
  const toolbar = el('div', { class: 'tl-toolbar' })
  root.append(toolbar, canvas)

  let raf = 0

  const renderToolbar = (): void => {
    clear(toolbar)
    const playBtn = el(
      'button',
      {
        onclick: () => store.togglePlay(),
        title: t('time.play')
      },
      store.playing ? '⏸' : '▶'
    )
    const stopBtn = el('button', { onclick: () => { store.setPlaying(false); store.setTime(0) } }, '⏮')
    const loopBtn = el('button', { onclick: () => { store.loop = !store.loop } }, store.loop ? '🔁 on' : '🔁 off')
    const timeLabel = el('span', { style: 'color:var(--text-dim);min-width:110px' }, formatTime(store.time, store.scene.durationSec))
    toolbar.append(stopBtn, playBtn, loopBtn, timeLabel, el('span', { style: 'flex:1' }), el('span', { class: 'badge' }, `${store.scene.fps} fps`))
    void raf
  }

  const draw = (): void => {
    raf = requestAnimationFrame(draw)
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
    const border = styles.getPropertyValue('--border').trim() || '#262b36'
    const dim = styles.getPropertyValue('--text-dim').trim() || '#9aa3b2'
    const accent = styles.getPropertyValue('--accent').trim() || '#4f8cff'

    const scene = store.scene
    const rulerH = 22
    // ruler
    ctx.strokeStyle = border
    ctx.fillStyle = dim
    ctx.font = '10px system-ui'
    const dur = scene.durationSec
    const pxPerSec = w / dur
    const step = niceStep(dur, w)
    for (let s = 0; s <= dur + 1e-6; s += step) {
      const x = s * pxPerSec
      ctx.beginPath()
      ctx.moveTo(x, 0)
      ctx.lineTo(x, rulerH)
      ctx.stroke()
      if (step >= 1 || Number.isInteger(s)) ctx.fillText(`${Math.round(s)}s`, x + 3, 12)
    }

    // track area: one row per device + camera
    const rows = scene.devices.length + 1
    const rowH = Math.max(18, (h - rulerH - 8) / Math.max(rows, 1))
    scene.devices.forEach((d, i) => {
      const y = rulerH + 6 + i * rowH
      ctx.fillStyle = border
      ctx.beginPath()
      ctx.roundRect(4, y, w - 8, rowH - 4, 5)
      ctx.fill()
      ctx.fillStyle = dim
      ctx.font = '11px system-ui'
      const preset = d.presetId
      ctx.fillText(`${preset} · ${d.screen.kind}`, 12, y + rowH / 2 + 1)
    })
    const cy = rulerH + 6 + scene.devices.length * rowH
    ctx.fillStyle = border
    ctx.beginPath()
    ctx.roundRect(4, cy, w - 8, rowH - 4, 5)
    ctx.fill()
    ctx.fillStyle = dim
    ctx.fillText('camera', 12, cy + rowH / 2 + 1)

    // playhead
    const px = store.time * pxPerSec
    ctx.strokeStyle = accent
    ctx.lineWidth = 2
    ctx.beginPath()
    ctx.moveTo(px, 0)
    ctx.lineTo(px, h)
    ctx.stroke()
    ctx.lineWidth = 1

    // scrub interaction
    canvas.onpointerdown = (e) => {
      const rect = canvas.getBoundingClientRect()
      const frac = (e.clientX - rect.left) / rect.width
      store.setTime(frac * store.scene.durationSec)
      const move = (ev: PointerEvent): void => {
        const r = canvas.getBoundingClientRect()
        store.setTime(((ev.clientX - r.left) / r.width) * store.scene.durationSec)
      }
      const up = (): void => {
        window.removeEventListener('pointermove', move)
        window.removeEventListener('pointerup', up)
      }
      window.addEventListener('pointermove', move)
      window.addEventListener('pointerup', up)
    }
  }

  const updateTimeLabel = (): void => {
    const label = toolbar.children[3] as HTMLElement | undefined
    if (label) label.textContent = formatTime(store.time, store.scene.durationSec)
    // playhead redraw handled by draw loop
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
  const target = widthPx / 12 // want ~12 labels
  const raw = dur / Math.max(1, target)
  const steps = [0.5, 1, 2, 5, 10, 15, 30, 60]
  for (const s of steps) if (raw <= s) return s
  return 60
}
