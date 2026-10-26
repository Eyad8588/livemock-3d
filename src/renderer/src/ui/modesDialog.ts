// Modes dialog: one-click camera/device animation presets that generate
// editable keyframes, with 2–3 sliders each (SPEC §7).

import { MODE_LABELS, type ModeId } from '@shared/presets'
import { applyMode, DEFAULT_MODE_OPTIONS, MODE_PARAMS, type ModeOptions } from '../engine/modes'
import { store } from '../state/store'
import { t } from '../i18n/i18n'
import { el, clear } from './dom'

export function openModesDialog(): void {
  const dlg = document.createElement('dialog')
  dlg.style.minWidth = '560px'

  const title = el('h3', { style: 'margin:0 0 4px' }, t('top.modes'))
  const note = el('p', { style: 'color:var(--text-dim);margin:0 0 12px' }, 'Applying a mode overwrites the camera (and where relevant device) keyframes — everything stays editable on the timeline.')
  const grid = el('div', { style: 'display:grid;grid-template-columns:repeat(3,1fr);gap:8px;margin-bottom:14px' })
  const slidersBox = el('div')
  const footer = el('div', { class: 'row', style: 'justify-content:flex-end;margin-top:12px' })

  let currentMode: ModeId = 'cinematic-hero'
  let opts: ModeOptions = { ...DEFAULT_MODE_OPTIONS }

  const renderSliders = (): void => {
    clear(slidersBox)
    for (const s of MODE_PARAMS[currentMode].sliders) {
      const row = el('div', { class: 'row' })
      const valLabel = el('span', { style: 'min-width:44px;color:var(--text-dim)' }, String(opts[s.key]))
      const input = el('input', {
        type: 'range',
        min: String(s.min),
        max: String(s.max),
        step: String(s.step),
        value: String(opts[s.key]),
        oninput: (e: Event) => {
          opts = { ...opts, [s.key]: Number((e.target as HTMLInputElement).value) }
          valLabel.textContent = String(opts[s.key])
        }
      })
      row.append(el('label', { style: 'min-width:100px' }, s.label), input, valLabel)
      slidersBox.appendChild(row)
    }
  }

  const renderGrid = (): void => {
    clear(grid)
    for (const id of Object.keys(MODE_PARAMS) as ModeId[]) {
      grid.appendChild(
        el('button', {
          class: id === currentMode ? 'accent' : '',
          style: 'padding:10px 6px;font-size:12px',
          onclick: (e: Event) => {
            currentMode = id
            opts = { ...DEFAULT_MODE_OPTIONS }
            renderGrid()
            renderSliders()
            ;(e.target as HTMLElement).focus()
          }
        }, MODE_LABELS[id])
      )
    }
  }

  const applyBtn = el('button', {
    class: 'primary',
    onclick: () => {
      if (store.scene.devices.length === 0) {
        alert('Add a device first.')
        return
      }
      store.edit(`Apply mode: ${MODE_LABELS[currentMode]}`, (p) => {
        const scene = p.scenes.find((s) => s.id === store.activeSceneId) ?? p.scenes[0]
        if (scene) applyMode(scene, currentMode, opts)
      })
      store.setTime(0)
      store.setPlaying(true)
      dlg.close()
    }
  }, `Apply ${MODE_LABELS[currentMode]}`)

  const cancelBtn = el('button', { onclick: () => dlg.close() }, 'Cancel')
  footer.append(cancelBtn, applyBtn)

  dlg.append(title, note, grid, slidersBox, footer)
  document.body.appendChild(dlg)
  renderGrid()
  renderSliders()
  dlg.showModal()
  dlg.addEventListener('close', () => dlg.remove())
}
