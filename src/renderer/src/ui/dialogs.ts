// Dialogs: export (placeholder until M4), recovery, shortcuts, WebGL error.
import type { Project } from '@shared/types'
import { el } from './dom'
import { t } from '../i18n/i18n'
import { toast } from './toast'
import { store } from '../state/store'
import { sceneController } from '../engine/view'

export function openExportDialog(): void {
  const dlg = document.createElement('dialog')
  const title = el('h3', { style: 'margin:0 0 6px' }, t('top.export'))
  const note = el(
    'p',
    { style: 'color:var(--text-dim)' },
    'Export pipeline lands in M4 (WebCodecs + ffmpeg). Scene settings and takes you record now will be used by it.'
  )
  const info = el(
    'pre',
    {
      style: 'background:var(--bg-3);padding:10px;border-radius:8px;font-size:12px;white-space:pre-wrap'
    },
    JSON.stringify(
      {
        scene: store.scene.name,
        durationSec: store.scene.durationSec,
        fps: store.scene.fps,
        devices: store.scene.devices.map((d) => ({ preset: d.presetId, source: d.screen.kind })),
        environment: store.scene.environment.id
      },
      null,
      2
    )
  )
  const close = el('button', { class: 'primary', onclick: () => dlg.close() }, 'OK')
  dlg.append(title, note, info, el('div', { class: 'row', style: 'justify-content:flex-end;margin:10px 0 0' }, close))
  document.body.appendChild(dlg)
  dlg.showModal()
  dlg.addEventListener('close', () => dlg.remove())
}

export function showWebGlError(): void {
  const dlg = document.createElement('dialog')
  dlg.append(el('h3', { style: 'margin:0 0 8px' }, 'LiveMock 3D'), el('p', {}, t('err.webgl')))
  const quit = el('button', { class: 'primary', onclick: () => window.close() }, 'Quit')
  dlg.append(el('div', { class: 'row', style: 'justify-content:flex-end' }, quit))
  document.body.appendChild(dlg)
  dlg.showModal()
}

export async function checkRecovery(): Promise<void> {
  const res = await window.livemock.checkRecovery()
  if (!res.available || !res.projectJson) return
  const dlg = document.createElement('dialog')
  dlg.append(
    el('h3', { style: 'margin:0 0 8px' }, 'Recover session?'),
    el('p', {}, `${t('recovery.found')} (${res.savedAt ?? ''})`)
  )
  const restore = el(
    'button',
    {
      class: 'primary',
      onclick: () => {
        store.loadProject(JSON.parse(res.projectJson!) as Project, null)
        toast(t('recovery.restore'))
        dlg.close()
      }
    },
    t('recovery.restore')
  )
  const discard = el(
    'button',
    {
      onclick: () => {
        void window.livemock.autosave('{"id":"__discard__"}')
        dlg.close()
      }
    },
    t('recovery.discard')
  )
  dlg.append(el('div', { class: 'row', style: 'justify-content:flex-end;gap:8px' }, discard, restore))
  document.body.appendChild(dlg)
  dlg.showModal()
  dlg.addEventListener('close', () => dlg.remove())
}

export function showShortcuts(): void {
  const dlg = document.createElement('dialog')
  const rows: [string, string][] = [
    ['Space', 'Play / pause'],
    ['← / →', 'Step 1 frame'],
    ['Shift+← / →', 'Step 1 second'],
    ['G / R', 'Move / rotate tool'],
    ['F', 'Frame selected device'],
    ['⌘/Ctrl+Z', 'Undo'],
    ['⌘/Ctrl+Shift+Z', 'Redo'],
    ['⌘/Ctrl+S', 'Save'],
    ['⌘/Ctrl+E', 'Export'],
    ['?', 'This cheat sheet']
  ]
  dlg.append(el('h3', { style: 'margin:0 0 10px' }, t('top.shortcuts')))
  for (const [k, v] of rows) {
    dlg.append(
      el(
        'div',
        { class: 'row', style: 'justify-content:space-between' },
        el('kbd', { style: 'background:var(--bg-3);padding:2px 8px;border-radius:5px' }, k),
        el('span', { style: 'color:var(--text-dim)' }, v)
      )
    )
  }
  const close = el('button', { class: 'primary', onclick: () => dlg.close() }, 'OK')
  dlg.append(el('div', { class: 'row', style: 'justify-content:flex-end;margin-top:12px' }, close))
  document.body.appendChild(dlg)
  dlg.showModal()
  dlg.addEventListener('close', () => dlg.remove())
}

export { sceneController }
