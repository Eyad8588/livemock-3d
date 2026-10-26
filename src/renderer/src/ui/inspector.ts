// Right inspector: selected device properties + screen source controls.
import { DEVICE_PRESETS, getPreset } from '@shared/presets'
import type { DeviceInstance, Finish, ScreenSource, TakeEntry } from '@shared/types'
import { store } from '../state/store'
import { t, onLangChange } from '../i18n/i18n'
import { el, clear } from './dom'
import { toast } from './toast'
import { LiveProvider } from '../engine/screenSource'

export function mountInspector(root: HTMLElement): void {
  const render = (): void => {
    const prev = (root as unknown as { __cleanup?: () => void }).__cleanup
    prev?.()
    ;(root as unknown as { __cleanup?: () => void }).__cleanup = undefined
    clear(root)
    const dev = store.selectedDevice()
    if (!dev) {
      root.appendChild(el('div', { style: 'color:var(--text-dim);margin:12px' }, 'Select a device to edit it.'))
      return
    }
    const preset = getPreset(dev.presetId)

    root.appendChild(el('div', { class: 'section-title' }, `${t('inspector.device')} — ${preset.label}`))

    // model swap
    const modelSelect = el('select', {
      onchange: (e: Event) => {
        const v = (e.target as HTMLSelectElement).value
        if (v && v !== dev.presetId) store.patchDevice(dev.id, { presetId: v }, 'Change model')
      }
    }) as HTMLSelectElement
    for (const p of DEVICE_PRESETS) modelSelect.append(el('option', { value: p.id, selected: p.id === dev.presetId }, p.label))
    root.appendChild(row(t('inspector.preset'), modelSelect))
    root.appendChild(
      row(
        'Custom GLB',
        el('button', {
          onclick: () => void importCustomModel(dev)
        }, dev.customModelMediaId ? 'Replace .glb' : 'Import .glb…')
      )
    )

    // finish
    const finishSelect = el('select', {
      onchange: (e: Event) => {
        store.patchDevice(dev.id, { material: { ...dev.material, finish: (e.target as HTMLSelectElement).value as Finish } }, 'Change finish')
      }
    }) as HTMLSelectElement
    for (const f of ['titanium', 'aluminum', 'matte', 'glossy'] as Finish[]) {
      finishSelect.append(el('option', { value: f, selected: f === dev.material.finish }, t(`finish.${f}`)))
    }
    root.appendChild(row(t('inspector.finish'), finishSelect))

    // color
    root.appendChild(
      row(
        t('inspector.color'),
        el('input', {
          type: 'color',
          value: dev.material.color,
          onchange: (e: Event) => {
            store.patchDevice(dev.id, { material: { ...dev.material, color: (e.target as HTMLInputElement).value } }, 'Change color')
          }
        })
      )
    )

    // glare
    root.appendChild(
      row(
        t('inspector.glare'),
        el('input', {
          type: 'range',
          min: '0',
          max: '1',
          step: '0.05',
          value: String(dev.screenGlare),
          onchange: (e: Event) => {
            store.patchDevice(dev.id, { screenGlare: Number((e.target as HTMLInputElement).value) }, 'Change glare')
          }
        })
      )
    )

    // cutout
    const cutoutSelect = el('select', {
      onchange: (e: Event) => {
        store.patchDevice(dev.id, { cutout: (e.target as HTMLSelectElement).value as DeviceInstance['cutout'] }, 'Change cutout')
      }
    }) as HTMLSelectElement
    for (const c of ['none', 'pill', 'notch', 'punch-hole'] as const) {
      cutoutSelect.append(el('option', { value: c, selected: c === dev.cutout }, t(`cutout.${c}`)))
    }
    root.appendChild(row(t('inspector.cutout'), cutoutSelect))

    // screen source
    root.appendChild(el('div', { class: 'section-title' }, t('inspector.screen')))
    const kindSelect = el('select', {
      onchange: (e: Event) => {
        const v = (e.target as HTMLSelectElement).value as 'none' | 'url' | 'image' | 'video'
        switchSource(dev, v)
      }
    }) as HTMLSelectElement
    for (const k of ['none', 'url', 'image', 'video'] as const) {
      kindSelect.append(el('option', { value: k, selected: k === dev.screen.kind }, t(`inspector.source.${k}`)))
    }
    root.appendChild(row('', kindSelect))

    if (dev.screen.kind === 'url') {
      renderUrlControls(root, dev)
    } else if (dev.screen.kind === 'image' || dev.screen.kind === 'video') {
      const media = store.mediaById(dev.screen.mediaId)
      root.appendChild(
        row(
          '',
          el('button', { onclick: () => void pickMedia(dev) }, `${t('inspector.chooseMedia')} ${media ? `(${media.name})` : ''}`)
        )
      )
      const fitSelect = el('select', {
        onchange: (e: Event) => {
          const fit = (e.target as HTMLSelectElement).value as 'fill' | 'fit' | 'crop'
          store.edit('Change fit', (p) => {
            for (const s of p.scenes) {
              const d = s.devices.find((x) => x.id === dev.id)
              if (d && (d.screen.kind === 'image' || d.screen.kind === 'video')) d.screen.fit = fit
            }
          })
        }
      }) as HTMLSelectElement
      for (const f of ['fill', 'fit', 'crop'] as const) {
        fitSelect.append(el('option', { value: f, selected: dev.screen.fit === f }, t(`inspector.fit.${f}`)))
      }
      root.appendChild(row(t('inspector.fit'), fitSelect))

      if (dev.screen.kind === 'video') {
        const media2 = store.mediaById(dev.screen.mediaId)
        const maxDur = media2?.durationSec ?? 10
        root.appendChild(
          row(
            'Trim in',
            el('input', {
              type: 'range',
              min: '0',
              max: String(Math.max(0.1, maxDur - 0.2)),
              step: '0.1',
              value: String(dev.screen.trimIn),
              onchange: (e: Event) => {
                const v = Number((e.target as HTMLInputElement).value)
                store.edit('Trim video', (p) => {
                  for (const s of p.scenes) {
                    const d = s.devices.find((x) => x.id === dev.id)
                    if (d && d.screen.kind === 'video') d.screen.trimIn = v
                  }
                })
              }
            })
          )
        )
        root.appendChild(
          row(
            'Trim out',
            el('input', {
              type: 'range',
              min: '0.2',
              max: String(maxDur),
              step: '0.1',
              value: String(dev.screen.trimOut),
              onchange: (e: Event) => {
                const v = Number((e.target as HTMLInputElement).value)
                store.edit('Trim video', (p) => {
                  for (const s of p.scenes) {
                    const d = s.devices.find((x) => x.id === dev.id)
                    if (d && d.screen.kind === 'video') d.screen.trimOut = v
                  }
                })
              }
            })
          )
        )
      }
    }

    // transform
    root.appendChild(el('div', { class: 'section-title' }, t('inspector.transform')))
    const tr = dev.transform.keys[0]?.value
    if (tr) {
      const vec = (label: string, key: 'position' | 'rotation'): HTMLElement => {
        const wrap = el('div', { class: 'row' }, el('label', {}, label))
        for (const axis of ['x', 'y', 'z'] as const) {
          wrap.append(
            el('input', {
              type: 'number',
              step: key === 'rotation' ? '5' : '10',
              value: String(Math.round(tr[key][axis] * 10) / 10),
              onchange: (e: Event) => {
                const v = Number((e.target as HTMLInputElement).value)
                store.edit(`Set ${key}.${axis}`, (p) => {
                  for (const s of p.scenes) {
                    const d = s.devices.find((x) => x.id === dev.id)
                    if (d) {
                      const kv = d.transform.keys[0]
                      if (kv) kv.value[key][axis] = v
                    }
                  }
                })
              }
            })
          )
        }
        return wrap
      }
      root.appendChild(vec(t('inspector.position'), 'position'))
      root.appendChild(vec(t('inspector.rotation'), 'rotation'))
    }

    root.appendChild(
      el('div', { class: 'row' }, el('button', { class: 'danger', onclick: () => store.removeDevice(dev.id) }, t('inspector.deleteDevice')))
    )
  }

  store.on('project', render)
  store.on('selection', render)
  onLangChange(render)
  render()
}

function row(label: string, control: HTMLElement): HTMLElement {
  const r = el('div', { class: 'row' })
  if (label) r.append(el('label', {}, label))
  else r.style.marginInlineStart = '10px'
  r.append(control)
  return r
}

function switchSource(dev: DeviceInstance, kind: 'none' | 'url' | 'image' | 'video'): void {
  const preset = getPreset(dev.presetId)
  let source: ScreenSource
  switch (kind) {
    case 'none':
      source = { kind: 'none' }
      break
    case 'url':
      source = {
        kind: 'url',
        url: 'https://example.com',
        viewport: { w: preset.viewport.w, h: preset.viewport.h, dpr: 1 },
        mobileEmulation: preset.mobileEmulation
      }
      break
    case 'image':
      source = { kind: 'image', mediaId: '', fit: 'fit' }
      break
    case 'video':
      source = { kind: 'video', mediaId: '', fit: 'fit', trimIn: 0, trimOut: 5, rate: 1, loop: true, offsetSec: 0 }
      break
  }
  store.setDeviceScreen(dev.id, source)
  if (kind === 'image' || kind === 'video') void pickMedia(dev)
}

async function pickMedia(dev: DeviceInstance): Promise<void> {
  const entries = await window.livemock.importMediaDialog(store.project.id)
  const media = entries.find((m) => m.kind === 'image' || m.kind === 'video')
  if (!media) {
    if (entries.length === 0) {
      // keep kind but empty
      return
    }
    toast('Pick an image or video file')
    return
  }
  store.addMedia([media])
  if (media.kind === 'image') {
    store.setDeviceScreen(dev.id, { kind: 'image', mediaId: media.id, fit: 'fit' })
  } else {
    store.setDeviceScreen(dev.id, {
      kind: 'video',
      mediaId: media.id,
      fit: 'fit',
      trimIn: 0,
      trimOut: media.durationSec ?? 5,
      rate: 1,
      loop: true,
      offsetSec: 0
    })
  }
}

// ---------- live URL controls + interaction panel + record take ----------

function renderUrlControls(root: HTMLElement, dev: DeviceInstance): void {
  if (dev.screen.kind !== 'url') return
  const screen = dev.screen
  const sourceKey = `live-${dev.id}`

  const urlInput = el('input', { type: 'text', value: screen.url, placeholder: 'https://…', style: 'flex:1' }) as HTMLInputElement
  const goBtn = el('button', { class: 'accent', onclick: () => {
    let url = urlInput.value.trim()
    if (!url) return
    if (!/^https?:\/\//i.test(url) && !url.startsWith('livemock-test://')) {
      url = `https://${url}`
      urlInput.value = url
    }
    store.edit('Set URL', (p) => {
      for (const s of p.scenes) {
        const d = s.devices.find((x) => x.id === dev.id)
        if (d && d.screen.kind === 'url') d.screen.url = url
      }
    })
    void window.livemock.liveNavigate(sourceKey, url)
  } }, t('inspector.go'))
  root.appendChild(row(t('inspector.url'), urlInput))
  root.appendChild(row('', goBtn))

  // bundled test page shortcuts (offline demo of the RTL feature)
  const demoRow = el('div', { class: 'row', style: 'flex-wrap:wrap' })
  demoRow.append(
    el('button', {
      onclick: () => {
        urlInput.value = 'livemock-test://local/arabic.html'
        goBtn.click()
      }
    }, 'تجربة RTL'),
    el('button', {
      onclick: () => {
        urlInput.value = 'livemock-test://local/english.html'
        goBtn.click()
      }
    }, 'Demo EN')
  )
  root.appendChild(demoRow)

  // interaction panel: 2D mirror of the live page
  root.appendChild(el('div', { class: 'section-title' }, t('inspector.interact')))
  const cv = document.createElement('canvas')
  cv.width = screen.viewport.w
  cv.height = screen.viewport.h
  cv.style.width = '100%'
  cv.style.borderRadius = '10px'
  cv.style.border = '1px solid var(--border)'
  cv.style.touchAction = 'none'
  root.appendChild(cv)

  const ctx = cv.getContext('2d')!
  const provider = new LiveProvider(sourceKey, { w: screen.viewport.w, h: screen.viewport.h }, (ev) => {
    void window.livemock.liveInput(sourceKey, ev)
  })
  // render the live page canvas into the interaction panel each frame
  let rafId = 0
  const drawLoop = (): void => {
    if (provider.texture) {
      ctx.drawImage(provider.texture.image as HTMLCanvasElement, 0, 0)
    }
    rafId = requestAnimationFrame(drawLoop)
  }
  rafId = requestAnimationFrame(drawLoop)

  // input forwarding: map mouse events into page coordinates
  const toPage = (e: PointerEvent | WheelEvent): { x: number; y: number } => {
    const rect = cv.getBoundingClientRect()
    return {
      x: ((e.clientX - rect.left) / rect.width) * screen.viewport.w,
      y: ((e.clientY - rect.top) / rect.height) * screen.viewport.h
    }
  }
  cv.addEventListener('pointerdown', (e) => {
    const { x, y } = toPage(e)
    provider.addRipple(x, y)
    provider.sendInput?.({ type: 'mousePressed', x, y, button: 'left' })
    cv.setPointerCapture(e.pointerId)
  })
  cv.addEventListener('pointerup', (e) => {
    const { x, y } = toPage(e)
    provider.sendInput?.({ type: 'mouseReleased', x, y, button: 'left' })
  })
  cv.addEventListener('pointermove', (e) => {
    if (e.buttons === 0) return
    const { x, y } = toPage(e)
    provider.sendInput?.({ type: 'mouseMoved', x, y })
  })
  cv.addEventListener(
    'wheel',
    (e) => {
      e.preventDefault()
      const { x, y } = toPage(e)
      provider.sendInput?.({ type: 'mouseWheel', x, y, deltaX: e.deltaX, deltaY: e.deltaY })
    },
    { passive: false }
  )

  // take status
  const takeRow = el('div', { class: 'row' })
  const updateTakeRow = (take: TakeEntry | null, recording: boolean): void => {
    clear(takeRow)
    if (recording) {
      takeRow.append(el('span', { class: 'badge live' }, '● recording…'))
    } else if (take) {
      takeRow.append(el('span', { class: 'badge ok' }, t('inspector.take.recorded', { sec: take.durationSec.toFixed(1) })))
    } else {
      takeRow.append(el('span', { class: 'badge' }, t('inspector.take.live')))
    }
    takeRow.append(
      el('button', {
        class: 'accent',
        onclick: () => {
          void recordTake(dev)
        }
      }, take ? t('inspector.take.rerecord') : t('top.recordTake'))
    )
  }
  let recording = false
  let currentTake: TakeEntry | null = (screen.takeId ? store.takeById(screen.takeId) : null) ?? null
  updateTakeRow(currentTake, recording)
  root.appendChild(takeRow)

  const offTake = window.livemock.onTakeEvent((ev) => {
    if (ev.sourceKey !== sourceKey) return
    if (ev.type === 'progress') {
      recording = true
      updateTakeRow(currentTake, recording)
    } else if (ev.type === 'done') {
      recording = false
      currentTake = ev.take
      store.upsertTake(ev.take)
      store.edit('Attach take', (p) => {
        for (const s of p.scenes) {
          const d = s.devices.find((x) => x.id === dev.id)
          if (d && d.screen.kind === 'url') d.screen.takeId = ev.take.id
        }
      })
      updateTakeRow(currentTake, recording)
      toast(t('inspector.take.recorded', { sec: ev.take.durationSec.toFixed(1) }))
    } else if (ev.type === 'error') {
      recording = false
      updateTakeRow(currentTake, recording)
      toast(ev.message)
    }
  })

  // re-attach when url changes
  let currentUrl = screen.url
  const checkUrl = (): void => {
    const devNow = store.scene.devices.find((d) => d.id === dev.id)
    if (!devNow || devNow.screen.kind !== 'url') {
      cleanup()
      return
    }
    if (devNow.screen.url !== currentUrl) {
      currentUrl = devNow.screen.url
      urlInput.value = currentUrl
    }
    urlCheckTimer = window.setTimeout(checkUrl, 500)
  }
  let urlCheckTimer = window.setTimeout(checkUrl, 500)

  function cleanup(): void {
    window.clearTimeout(urlCheckTimer)
    cancelAnimationFrame(rafId)
    provider.dispose()
    offTake()
    ;(root as unknown as { __cleanup?: () => void }).__cleanup = undefined
  }
  ;(root as unknown as { __cleanup?: () => void }).__cleanup = cleanup
}

async function importCustomModel(dev: DeviceInstance): Promise<void> {
  const entries = await window.livemock.importMediaDialog(store.project.id)
  const model = entries.find((m) => m.kind === 'model')
  if (!model) return
  store.addMedia([model])
  store.patchDevice(dev.id, { customModelMediaId: model.id }, 'Import custom model')
  sceneControllerSync(dev.id)
}

function sceneControllerSync(deviceId: string): void {
  void import('../engine/view').then(({ sceneController }) => {
    sceneController.refreshScreenOf(deviceId)
  })
}

async function recordTake(dev: DeviceInstance): Promise<void> {
  if (dev.screen.kind !== 'url') return
  const preset = getPreset(dev.presetId)
  await window.livemock.takeRecord({
    deviceId: dev.id,
    sourceKey: `live-${dev.id}`,
    url: dev.screen.url,
    viewport: { w: dev.screen.viewport.w, h: dev.screen.viewport.h, dpr: 1 },
    mobileEmulation: dev.screen.mobileEmulation && preset.mobileEmulation,
    walkthrough: dev.screen.walkthrough ?? [],
    fps: 30
  })
}
