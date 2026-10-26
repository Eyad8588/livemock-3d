// Left panel: scene tabs, device list, add device, environment picker, media.
import { DEVICE_PRESETS } from '@shared/presets'
import type { MediaEntry } from '@shared/types'
import { store } from '../state/store'
import { t, onLangChange } from '../i18n/i18n'
import { el, clear } from './dom'
import { toast } from './toast'

const ENVS: { id: string; key: string }[] = [
  { id: 'studio-gradient', key: 'env.studio-gradient' },
  { id: 'floating-void', key: 'env.floating-void' },
  { id: 'reflective-floor', key: 'env.reflective-floor' },
  { id: 'light-box', key: 'env.light-box' },
  { id: 'dark-cinematic', key: 'env.dark-cinematic' },
  { id: 'brand-color', key: 'env.brand-color' },
  { id: 'transparent', key: 'env.transparent' }
]

export function mountLeftPanel(root: HTMLElement): void {
  const render = (): void => {
    clear(root)
    const scene = store.scene

    // scenes
    root.appendChild(el('div', { class: 'section-title' }, t('left.scenes')))
    for (const s of store.project.scenes) {
      root.appendChild(
        el(
          'div',
          {
            class: `list-item ${s.id === scene.id ? 'selected' : ''}`,
            onclick: () => {
              store.activeSceneId = s.id
              store.selectedDeviceId = null
              store.emit('selection')
              store.emit('project')
            }
          },
          el('span', { class: 'name' }, s.name),
          el('span', { class: 'badge' }, `${s.durationSec}s`)
        )
      )
    }

    // devices
    root.appendChild(el('div', { class: 'section-title' }, t('left.devices')))
    if (scene.devices.length === 0) {
      root.appendChild(el('div', { style: 'color:var(--text-dim);margin:4px 12px 8px' }, t('left.noDevices')))
    }
    for (const d of scene.devices) {
      const preset = DEVICE_PRESETS.find((p) => p.id === d.presetId)
      const badge =
        d.screen.kind === 'url'
          ? el('span', { class: 'badge live' }, d.screen.takeId ? 'take' : 'live')
          : d.screen.kind === 'image'
            ? el('span', { class: 'badge' }, 'img')
            : d.screen.kind === 'video'
              ? el('span', { class: 'badge' }, 'vid')
              : el('span', { class: 'badge' }, '—')
      root.appendChild(
        el(
          'div',
          {
            class: `list-item ${d.id === store.selectedDeviceId ? 'selected' : ''}`,
            onclick: () => {
              store.selectedDeviceId = d.id
              store.emit('selection')
            }
          },
          el('span', { class: 'name' }, preset?.label ?? d.presetId),
          badge
        )
      )
    }

    // add device
    const addRow = el('div', { class: 'row' })
    const addSelect = el('select', { onchange: (e: Event) => {
      const v = (e.target as HTMLSelectElement).value
      if (!v) return
      if (scene.devices.length >= 4) {
        toast(t('left.maxDevices'))
        return
      }
      store.addDevice(v)
      addSelect.value = ''
    } }) as HTMLSelectElement
    addSelect.append(el('option', { value: '' }, `+ ${t('left.addDevice')}`))
    for (const p of DEVICE_PRESETS) {
      addSelect.append(el('option', { value: p.id }, p.label))
    }
    addRow.append(addSelect)
    root.appendChild(addRow)

    // environment
    root.appendChild(el('div', { class: 'section-title' }, t('left.environment')))
    for (const e of ENVS) {
      root.appendChild(
        el(
          'div',
          {
            class: `list-item ${scene.environment.id === e.id ? 'selected' : ''}`,
            onclick: () => {
              store.edit('Change environment', (p) => {
                const s = p.scenes.find((x) => x.id === scene.id)
                if (s) s.environment.id = e.id as typeof s.environment.id
              })
            }
          },
          el('span', { class: 'name' }, t(e.key))
        )
      )
    }
    if (scene.environment.id === 'brand-color' || scene.environment.id === 'studio-gradient') {
      const colors = el('div', { class: 'row' })
      const mkColor = (key: 'colorA' | 'colorB'): HTMLElement => {
        const input = el('input', {
          type: 'color',
          value: scene.environment[key],
          onchange: (ev: Event) => {
            const v = (ev.target as HTMLInputElement).value
            store.edit('Change color', (p) => {
              const s = p.scenes.find((x) => x.id === scene.id)
              if (s) s.environment[key] = v
            })
          }
        })
        return el('span', { style: 'display:flex;align-items:center;gap:4px' }, input)
      }
      colors.append(mkColor('colorA'), mkColor('colorB'))
      root.appendChild(colors)
    }

    // media
    root.appendChild(el('div', { class: 'section-title' }, t('left.media')))
    const importBtn = el(
      'div',
      {
        class: 'list-item',
        onclick: () => void importMedia()
      },
      el('span', { class: 'name' }, `⬆ ${t('left.importMedia')}`)
    )
    root.appendChild(importBtn)
    for (const m of store.project.media) {
      root.appendChild(mediaItem(m))
    }
  }

  async function importMedia(): Promise<void> {
    const entries = await window.livemock.importMediaDialog(store.project.id)
    if (entries.length > 0) {
      store.addMedia(entries)
      toast(t('toast.mediaImported'))
    }
  }

  store.on('project', render)
  store.on('selection', render)
  onLangChange(render)
  render()
}

function mediaItem(m: MediaEntry): HTMLElement {
  const item = el(
    'div',
    {
      class: 'list-item',
      draggable: 'true',
      ondragstart: (e: DragEvent) => {
        e.dataTransfer?.setData('application/x-livemock-media', m.id)
      }
    },
    el('span', { class: 'name' }, m.name),
    el('span', { class: 'badge' }, m.kind)
  )
  item.addEventListener('dblclick', () => {
    const dev = store.selectedDevice()
    if (!dev) return
    assignMedia(dev.id, m)
  })
  return item
}

export function assignMedia(deviceId: string, m: MediaEntry): void {
  if (m.kind === 'image') {
    store.setDeviceScreen(deviceId, { kind: 'image', mediaId: m.id, fit: 'fit' })
  } else if (m.kind === 'video') {
    store.setDeviceScreen(deviceId, {
      kind: 'video',
      mediaId: m.id,
      fit: 'fit',
      trimIn: 0,
      trimOut: m.durationSec ?? 5,
      rate: 1,
      loop: true,
      offsetSec: 0
    })
  }
}

export function initLeftPanel(): void {
  mountLeftPanel(document.querySelector('lm-left') as HTMLElement)
}
