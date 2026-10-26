// App state: project, selection, playback, undo/redo (command pattern via
// snapshot pairs), autosave. The single mutable source of truth for the app.

import type { DeviceInstance, Project, Scene, ScreenSource } from '@shared/types'
import { createDefaultProject, createDefaultScene, uid } from '@shared/serialize'
import { getPreset } from '@shared/presets'

export interface Command {
  label: string
  undo(): void
  redo(): void
}

type StoreEvent = 'project' | 'time' | 'selection' | 'playback'

class Store {
  project: Project = createDefaultProject()
  activeSceneId = ''
  selectedDeviceId: string | null = null
  selectedOverlayId: string | null = null
  time = 0
  playing = false
  loop = true
  filePath: string | null = null
  dirty = false

  private undoStack: Command[] = []
  private redoStack: Command[] = []
  private listeners = new Map<StoreEvent, Set<() => void>>()
  private autosaveTimer: number | null = null

  constructor() {
    this.activeSceneId = this.project.scenes[0]?.id ?? ''
  }

  // ---------- events ----------
  on(ev: StoreEvent, cb: () => void): () => void {
    let set = this.listeners.get(ev)
    if (!set) {
      set = new Set()
      this.listeners.set(ev, set)
    }
    set.add(cb)
    return () => set?.delete(cb)
  }

  emit(ev: StoreEvent): void {
    for (const cb of this.listeners.get(ev) ?? []) cb()
  }

  // ---------- scene access ----------
  get scene(): Scene {
    const s = this.project.scenes.find((x) => x.id === this.activeSceneId)
    if (s) return s
    const first = this.project.scenes[0]
    if (first) {
      this.activeSceneId = first.id
      return first
    }
    const created = { ...createDefaultScene(), id: uid('sc_') }
    this.project.scenes.push(created)
    this.activeSceneId = created.id
    return created
  }

  selectedDevice(): DeviceInstance | null {
    return this.scene.devices.find((d) => d.id === this.selectedDeviceId) ?? null
  }

  // ---------- commands ----------
  run(cmd: Command): void {
    cmd.redo()
    this.undoStack.push(cmd)
    if (this.undoStack.length > 100) this.undoStack.shift()
    this.redoStack = []
    this.markDirty()
    this.emit('project')
  }

  undo(): boolean {
    const cmd = this.undoStack.pop()
    if (!cmd) return false
    cmd.undo()
    this.redoStack.push(cmd)
    this.markDirty()
    this.emit('project')
    return true
  }

  redo(): boolean {
    const cmd = this.redoStack.pop()
    if (!cmd) return false
    cmd.redo()
    this.undoStack.push(cmd)
    this.markDirty()
    this.emit('project')
    return true
  }

  /** Generic whole-project snapshot edit — simple + correct undo for everything. */
  edit(label: string, mutate: (p: Project) => void): void {
    const before = JSON.stringify(this.project)
    mutate(this.project)
    const after = JSON.stringify(this.project)
    if (before === after) return
    const self = this
    this.run({
      label,
      undo: () => {
        self.project = JSON.parse(before) as Project
        if (!self.project.scenes.find((s) => s.id === self.activeSceneId)) {
          self.activeSceneId = self.project.scenes[0]?.id ?? ''
        }
      },
      redo: () => {
        self.project = JSON.parse(after) as Project
        if (!self.project.scenes.find((s) => s.id === self.activeSceneId)) {
          self.activeSceneId = self.project.scenes[0]?.id ?? ''
        }
      }
    })
    // run() already emitted 'project'
  }

  // ---------- device ops ----------
  addDevice(presetId: string): void {
    const preset = getPreset(presetId)
    const count = this.scene.devices.length
    if (count >= 4) return
    const spread = count === 0 ? 0 : ((count % 2 === 0 ? 1 : -1) * Math.ceil(count / 2) * (preset.kind === 'phone' ? 110 : 380))
    const standY =
      preset.modelFile || (preset.kind !== 'phone' && preset.kind !== 'tablet')
        ? 0
        : preset.body.h / 2 + 2
    this.edit(`Add ${preset.label}`, (p) => {
      const scene = p.scenes.find((s) => s.id === this.activeSceneId) ?? p.scenes[0]
      if (!scene || scene.devices.length >= 4) return
      scene.devices.push({
        id: uid('dv_'),
        presetId,
        material: { finish: preset.defaultFinish, color: preset.defaultColor },
        transform: {
          keys: [
            {
              t: 0,
              value: { position: { x: spread, y: standY, z: 0 }, rotation: { x: 0, y: 0, z: 0 }, scale: { x: 1, y: 1, z: 1 } },
              easing: 'easeInOutCubic'
            }
          ]
        },
        screen: { kind: 'none' },
        screenGlare: 0.25,
        cutout: preset.cutout,
        ...(preset.kind === 'laptop' ? { lidAngleDeg: { keys: [{ t: 0, value: 105, easing: 'easeInOutCubic' }] } } : {})
      })
    })
    const scene = this.scene
    this.selectedDeviceId = scene.devices[scene.devices.length - 1]?.id ?? null
    this.emit('selection')
  }

  removeDevice(id: string): void {
    this.edit('Delete device', (p) => {
      for (const s of p.scenes) s.devices = s.devices.filter((d) => d.id !== id)
    })
    if (this.selectedDeviceId === id) {
      this.selectedDeviceId = null
      this.emit('selection')
    }
  }

  setDeviceScreen(id: string, source: ScreenSource): void {
    this.edit('Change screen content', (p) => {
      for (const s of p.scenes) {
        const d = s.devices.find((x) => x.id === id)
        if (d) d.screen = source
      }
    })
  }

  patchDevice(id: string, patch: Partial<DeviceInstance>, label: string): void {
    this.edit(label, (p) => {
      for (const s of p.scenes) {
        const d = s.devices.find((x) => x.id === id)
        if (d) Object.assign(d, patch)
      }
    })
  }

  // ---------- media registry ----------
  addMedia(entries: import('@shared/types').MediaEntry[]): void {
    const known = new Set(this.project.media.map((m) => m.id))
    const fresh = entries.filter((e) => !known.has(e.id))
    if (fresh.length === 0) return
    this.edit('Import media', (p) => {
      p.media.push(...fresh)
    })
  }

  mediaById(id: string): import('@shared/types').MediaEntry | undefined {
    return this.project.media.find((m) => m.id === id)
  }

  takeById(id: string): import('@shared/types').TakeEntry | undefined {
    return this.project.takes.find((tk) => tk.id === id)
  }

  upsertTake(take: import('@shared/types').TakeEntry): void {
    this.edit('Record take', (p) => {
      const i = p.takes.findIndex((x) => x.id === take.id)
      if (i >= 0) p.takes[i] = take
      else p.takes.push(take)
    })
  }

  // ---------- playback ----------
  setTime(t: number): void {
    const dur = this.scene.durationSec
    this.time = Math.min(dur, Math.max(0, t))
    this.emit('time')
  }

  setPlaying(playing: boolean): void {
    this.playing = playing
    this.emit('playback')
  }

  togglePlay(): void {
    this.setPlaying(!this.playing)
  }

  // ---------- project io ----------
  loadProject(project: Project, filePath: string | null): void {
    this.project = project
    this.activeSceneId = project.scenes[0]?.id ?? ''
    this.selectedDeviceId = null
    this.time = 0
    this.playing = false
    this.filePath = filePath
    this.undoStack = []
    this.redoStack = []
    this.dirty = false
    this.emit('project')
    this.emit('selection')
    this.emit('time')
    this.emit('playback')
  }

  markDirty(): void {
    this.dirty = true
    this.project.updatedAt = new Date().toISOString()
    this.scheduleAutosave()
  }

  private scheduleAutosave(): void {
    if (this.autosaveTimer !== null) window.clearTimeout(this.autosaveTimer)
    this.autosaveTimer = window.setTimeout(() => {
      this.autosaveTimer = null
      void window.livemock.autosave(JSON.stringify(this.project))
    }, 800)
  }
}

export const store = new Store()
