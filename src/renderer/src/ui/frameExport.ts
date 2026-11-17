// Still-frame export (PNG): one-click "📷 Frame" with remembered settings,
// plus an options dialog — size/aspect, transparent background, camera.

import { store } from '../state/store'
import { sceneController } from '../engine/view'
import { exportStill } from '../export/exporter'
import { el } from './dom'
import { toast } from './toast'

export interface FrameSettings {
  /** 'view' = match the viewport aspect; otherwise a fixed WxH preset id */
  size: string
  /** long edge in px when size === 'view' */
  longEdge: number
  transparent: boolean
  /** render what the viewport shows (true) or the animated camera track (false) */
  editorCamera: boolean
}

export const FRAME_SIZES: { id: string; label: string; w: number; h: number }[] = [
  { id: 'view', label: 'Match viewport', w: 0, h: 0 },
  { id: '16:9-1080', label: '16:9 — 1920×1080', w: 1920, h: 1080 },
  { id: '16:9-4k', label: '16:9 — 3840×2160 (4K)', w: 3840, h: 2160 },
  { id: '9:16', label: '9:16 — 1080×1920', w: 1080, h: 1920 },
  { id: '1:1', label: '1:1 — 2048×2048', w: 2048, h: 2048 },
  { id: '4:5', label: '4:5 — 1080×1350', w: 1080, h: 1350 },
  { id: '3:2', label: '3:2 — 3000×2000', w: 3000, h: 2000 }
]

const KEY = 'livemock.frameSettings'
const DEFAULTS: FrameSettings = { size: 'view', longEdge: 2560, transparent: false, editorCamera: true }

export function loadFrameSettings(): FrameSettings {
  try {
    const raw = localStorage.getItem(KEY)
    if (raw) return { ...DEFAULTS, ...(JSON.parse(raw) as Partial<FrameSettings>) }
  } catch {
    /* ignore */
  }
  return { ...DEFAULTS }
}

function saveFrameSettings(s: FrameSettings): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(s))
  } catch {
    /* ignore */
  }
}

/** Resolve output pixel size for the settings (even dimensions). */
export function frameDims(s: FrameSettings, viewportAspect: number): { width: number; height: number } {
  const even = (v: number): number => Math.max(16, Math.round(v / 2) * 2)
  const preset = FRAME_SIZES.find((f) => f.id === s.size)
  if (preset && preset.id !== 'view') return { width: preset.w, height: preset.h }
  const a = viewportAspect > 0 ? viewportAspect : 16 / 9
  const L = Math.min(8192, Math.max(256, s.longEdge))
  return a >= 1 ? { width: even(L), height: even(L / a) } : { width: even(L * a), height: even(L) }
}

let busy = false

/** One-click export with the remembered settings. */
export async function exportFrameNow(settings: FrameSettings = loadFrameSettings()): Promise<string | null> {
  if (busy) return null
  busy = true
  const { width, height } = frameDims(settings, sceneController.viewportAspect())
  toast(`Rendering ${width}×${height} PNG…`)
  try {
    const res = await exportStill({
      width,
      height,
      transparentBackground: settings.transparent,
      editorCamera: settings.editorCamera
    })
    const name = res.path.split(/[\\/]/).pop() ?? res.path
    showSavedToast(name, res.path)
    return res.path
  } catch (err) {
    toast(`Frame export failed: ${err instanceof Error ? err.message : String(err)}`)
    return null
  } finally {
    busy = false
  }
}

function showSavedToast(name: string, path: string): void {
  toast(`Saved ${name} to Downloads/LiveMock — click to show`, 5000, () => void window.livemock.showInFolder(path))
}

export function openFrameDialog(): void {
  const s = loadFrameSettings()
  const dlg = document.createElement('dialog')
  dlg.style.minWidth = '440px'

  const sizeSel = el('select') as HTMLSelectElement
  for (const f of FRAME_SIZES) sizeSel.append(el('option', { value: f.id, ...(f.id === s.size ? { selected: 'true' } : {}) }, f.label))
  const edgeSel = el('select') as HTMLSelectElement
  for (const e of [1920, 2560, 3840, 5120]) edgeSel.append(el('option', { value: String(e), ...(e === s.longEdge ? { selected: 'true' } : {}) }, `${e}px long edge`))
  const alpha = el('input', { type: 'checkbox', ...(s.transparent ? { checked: 'true' } : {}) }) as HTMLInputElement
  const cam = el('input', { type: 'checkbox', ...(s.editorCamera ? { checked: 'true' } : {}) }) as HTMLInputElement
  const dims = el('div', { style: 'color:var(--text-dim);font-size:12px;margin:2px 10px 8px' }, '')

  const read = (): FrameSettings => ({
    size: sizeSel.value,
    longEdge: Number(edgeSel.value),
    transparent: alpha.checked,
    editorCamera: cam.checked
  })
  const refresh = (): void => {
    const cur = read()
    edgeSel.disabled = cur.size !== 'view'
    const d = frameDims(cur, sceneController.viewportAspect())
    dims.textContent = `Output: ${d.width}×${d.height} PNG · frame at ${store.time.toFixed(2)}s${cur.transparent ? ' · transparent background (shadows off)' : ''}`
  }
  for (const c of [sizeSel, edgeSel, alpha, cam]) c.addEventListener('change', refresh)

  const go = el('button', { class: 'primary' }, 'Export PNG')
  go.addEventListener('click', () => {
    const cur = read()
    saveFrameSettings(cur)
    dlg.close()
    void exportFrameNow(cur)
  })
  const row = (label: string, ctl: HTMLElement): HTMLElement =>
    el('div', { class: 'row' }, el('label', { style: 'min-width:130px' }, label), ctl)

  dlg.append(
    el('h3', { style: 'margin:0 0 10px' }, 'Export frame'),
    row('Size', sizeSel),
    row('Resolution', edgeSel),
    row('Transparent background', alpha),
    row('Use current view', cam),
    el('div', { style: 'color:var(--text-dim);font-size:11px;margin:0 10px 6px' }, 'Off = use the animated camera at the playhead (matches the video export).'),
    dims,
    el('div', { class: 'row', style: 'justify-content:flex-end' }, el('button', { onclick: () => dlg.close() }, 'Cancel'), go)
  )
  document.body.appendChild(dlg)
  refresh()
  dlg.showModal()
  dlg.addEventListener('close', () => dlg.remove())
}
