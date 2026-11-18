// Export dialog (SPEC §9): format, aspect presets with batch export,
// quality, fps, transparency, motion blur, progress with ETA + cancel.

import { ASPECT_PRESETS, EXPORT_FORMATS, QUALITY_LABEL } from '@shared/presets'
import type { ExportFormat, ExportSettings } from '@shared/types'
import { store } from '../state/store'
import { t } from '../i18n/i18n'
import { el } from './dom'
import { toast } from './toast'
import { startExport, type ExportHandle, type ExportProgressInfo } from '../export/exporter'
import { sceneController } from '../engine/view'

export function openExportDialog(): void {
  const dlg = document.createElement('dialog')
  dlg.style.minWidth = '620px'

  const scene = store.scene
  let format: ExportFormat = 'mp4-h264'
  let quality: ExportSettings['quality'] = 'high'
  let fps: 24 | 30 | 60 = scene.fps
  let transparent = false
  let motionBlur: 0 | 4 | 8 | 16 = 0
  let handle: ExportHandle | null = null

  const title = el('h3', { style: 'margin:0 0 10px' }, t('top.export'))

  // format
  const formatSelect = el('select', {
    onchange: (e: Event) => {
      format = (e.target as HTMLSelectElement).value as ExportFormat
      const fmt = EXPORT_FORMATS.find((f) => f.id === format)
      alphaToggle.checked = false
      alphaToggle.disabled = !fmt?.supportsAlpha
      alphaRow.style.opacity = fmt?.supportsAlpha ? '1' : '0.4'
      fmtInfo.textContent =
        format === 'png-still'
          ? `Single PNG of the frame at the playhead (${store.time.toFixed(2)}s), animated camera. Tip: 📷 Frame in the top bar exports exactly what the viewport shows.`
          : fmt?.via === 'webcodecs'
            ? 'Encoded with hardware WebCodecs + Mediabunny (ffmpeg fallback).'
            : 'Encoded with bundled ffmpeg.'
      exportBtn.textContent = format === 'png-still' ? 'Export PNG' : `Export (${scene.durationSec}s)`
    }
  }) as HTMLSelectElement
  for (const f of EXPORT_FORMATS) formatSelect.append(el('option', { value: f.id }, f.label))
  const fmtInfo = el('div', { style: 'color:var(--text-dim);font-size:11px;margin:2px 10px 8px' }, '')

  // aspect presets (batch: multiple)
  const aspectBox = el('div', { style: 'display:flex;flex-wrap:wrap;gap:6px;margin:4px 10px 8px' })
  // default to the shape the user is composing in
  const va = sceneController.viewportAspect()
  const selectedAspects = new Set<string>([va > 1.2 ? '16:9' : va < 0.85 ? '9:16' : '1:1'])
  for (const a of ASPECT_PRESETS) {
    const chip = el('button', {
      class: selectedAspects.has(a.id) ? 'accent' : '',
      onclick: (e: Event) => {
        const btn = e.currentTarget as HTMLButtonElement
        if (selectedAspects.has(a.id)) {
          if (selectedAspects.size === 1) return
          selectedAspects.delete(a.id)
          btn.className = ''
        } else {
          selectedAspects.add(a.id)
          btn.className = 'accent'
        }
      }
    }, a.id.replace('-4k', ' 4K'))
    chip.title = a.label
    aspectBox.appendChild(chip)
  }

  // quality + fps
  const qualitySelect = el('select', {
    onchange: (e: Event) => (quality = (e.target as HTMLSelectElement).value as ExportSettings['quality'])
  }) as HTMLSelectElement
  for (const q of ['fast', 'high', 'max'] as const) {
    qualitySelect.append(el('option', { value: q, selected: q === 'high' }, QUALITY_LABEL[q]))
  }
  const fpsSelect = el('select', {
    onchange: (e: Event) => (fps = Number((e.target as HTMLSelectElement).value) as 24 | 30 | 60)
  }) as HTMLSelectElement
  for (const f of [24, 30, 60] as const) fpsSelect.append(el('option', { value: String(f), selected: f === scene.fps }, `${f} fps`))

  // transparency
  const alphaToggle = el('input', {
    type: 'checkbox',
    onchange: (e: Event) => (transparent = (e.target as HTMLInputElement).checked)
  }) as HTMLInputElement
  const alphaRow = el('div', { class: 'row' }, el('label', {}, 'Transparent background'), alphaToggle)
  alphaRow.style.opacity = '0.4'
  alphaToggle.disabled = true

  // motion blur
  const mbSelect = el('select', {
    onchange: (e: Event) => (motionBlur = Number((e.target as HTMLSelectElement).value) as 0 | 4 | 8 | 16)
  }) as HTMLSelectElement
  for (const m of [0, 4, 8, 16] as const) mbSelect.append(el('option', { value: String(m), selected: m === 0 }, m === 0 ? 'Off' : `${m} samples`))

  // progress
  const progressWrap = el('div', { style: 'display:none;margin:10px' })
  const progressBar = el('div', {
    style: 'height:8px;background:var(--bg-3);border-radius:6px;overflow:hidden'
  })
  const progressFill = el('div', { style: 'height:100%;width:0%;background:var(--accent);transition:width .15s' })
  progressBar.appendChild(progressFill)
  const progressLabel = el('div', { style: 'color:var(--text-dim);font-size:12px;margin-top:6px' }, '')
  const cancelBtn = el('button', { style: 'margin-top:8px' }, 'Cancel')
  const doneBtn = el('button', { class: 'primary', style: 'display:none;margin-top:8px;margin-inline-start:8px' }, 'Show in folder')
  let lastPath: string | null = null
  doneBtn.addEventListener('click', () => {
    if (lastPath) void window.livemock.showInFolder(lastPath)
  })
  cancelBtn.addEventListener('click', () => handle?.cancel())
  progressWrap.append(progressBar, progressLabel, el('div', { class: 'row' }, cancelBtn, doneBtn))

  const exportBtn = el('button', {
    class: 'primary',
    onclick: () => {
      const targets = ASPECT_PRESETS.filter((a) => selectedAspects.has(a.id))
      exportBtn.disabled = true
      formatSelect.disabled = true
      void runBatch(targets)
    }
  }, `Export (${scene.durationSec}s)`)

  async function runBatch(targets: typeof ASPECT_PRESETS): Promise<void> {
    progressWrap.style.display = 'block'
    for (const target of targets) {
      const settings: ExportSettings = {
        name: target.id,
        width: target.width,
        height: target.height,
        fps,
        format,
        quality,
        transparentBackground: transparent,
        motionBlurSamples: motionBlur
      }
      const res = await runOne(settings, (p) => updateProgress(p, targets.indexOf(target), targets.length))
      if (!res.ok) {
        toast(`Export failed: ${res.error}`)
        break
      }
      lastPath = res.path ?? null
      toast(t('toast.exported'))
    }
    progressWrap.querySelector('.row')?.remove()
    doneBtn.style.display = 'inline-block'
    cancelBtn.style.display = 'none'
  }

  function runOne(settings: ExportSettings, onProgress: (p: ExportProgressInfo) => void): Promise<{ ok: boolean; path?: string; error?: string }> {
    return new Promise((resolve) => {
      handle = startExport(settings, store.scene, onProgress)
      handle.promise
        .then((r) => {
          updateProgress({ frame: 1, totalFrames: 1, stage: 'done', message: r.verification }, 1, 1)
          resolve({ ok: true, path: r.path })
        })
        .catch((err: unknown) => {
          if (err instanceof Error && err.message === 'cancelled') resolve({ ok: true })
          else resolve({ ok: false, error: err instanceof Error ? err.message : String(err) })
        })
    })
  }

  function updateProgress(p: ExportProgressInfo, batchIndex: number, batchTotal: number): void {
    const pct = p.totalFrames > 0 ? (p.frame / p.totalFrames) * 100 : 0
    progressFill.style.width = `${pct}%`
    const parts = [
      batchTotal > 1 ? `Target ${batchIndex + 1}/${batchTotal}: ` : '',
      p.stage === 'done' ? 'Done' : `Frame ${p.frame}/${p.totalFrames}`
    ]
    if (p.etaSec !== undefined && p.stage !== 'done') parts.push(`· ETA ${Math.ceil(p.etaSec)}s`)
    if (p.message) parts.push(`· ${p.message}`)
    progressLabel.textContent = parts.join(' ')
    if (p.stage === 'done') progressFill.style.width = '100%'
  }

  const closeBtn = el('button', {
    onclick: () => {
      handle?.cancel()
      dlg.close()
    }
  }, 'Close')

  const rows = el(
    'div',
    { style: 'display:flex;flex-direction:column' },
    el('div', { class: 'row' }, el('label', { style: 'min-width:110px' }, 'Format'), formatSelect),
    fmtInfo,
    el('div', { class: 'section-title' }, 'Aspect ratio (select multiple for batch export)'),
    aspectBox,
    el('div', { class: 'row' }, el('label', { style: 'min-width:110px' }, 'Quality'), qualitySelect),
    el('div', { class: 'row' }, el('label', { style: 'min-width:110px' }, 'Frame rate'), fpsSelect),
    el('div', { class: 'row' }, el('label', { style: 'min-width:110px' }, 'Motion blur'), mbSelect),
    alphaRow,
    el('div', { class: 'row', style: 'justify-content:flex-end;margin-top:10px' }, closeBtn, exportBtn),
    progressWrap
  )

  dlg.append(title, rows)
  document.body.appendChild(dlg)
  formatSelect.dispatchEvent(new Event('change'))
  dlg.showModal()
  dlg.addEventListener('close', () => {
    handle?.cancel()
    dlg.remove()
  })
}
