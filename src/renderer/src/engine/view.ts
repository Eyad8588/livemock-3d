// Viewport controller: THREE scene assembly, device lifecycle, camera-track
// evaluation, picking, drag & drop, playback stepping, perf stats.

import * as THREE from 'three'
import { OrbitControls } from 'three/addons/controls/OrbitControls.js'
import { TransformControls } from 'three/addons/controls/TransformControls.js'
import { getPreset } from '@shared/presets'
import { evalTrack } from '@shared/easingMath'
import type { DeviceInstance, LiveFramePayload } from '@shared/types'
import { store } from '../state/store'
import { buildDevice, buildCustomDevice, applyTransform, type DeviceRig } from './devices'
import { createEnvironment, sceneEnvironment, type EnvRig } from './environments'
import { ImageProvider, VideoProvider, type ScreenProvider } from './screenSource'
import { LiveProvider } from './screenSource'
import { PostFxStack } from './postfx'

export interface ViewportStats {
  fps: number
  calls: number
  textures: number
  geometries: number
}

class SceneController {
  private renderer: THREE.WebGLRenderer | null = null
  private scene = new THREE.Scene()
  private camera = new THREE.PerspectiveCamera(32, 1, 1, 20000)
  private controls: OrbitControls | null = null
  private gizmo: TransformControls | null = null
  private envRig: EnvRig | null = null
  private container: HTMLElement | null = null
  private raf = 0
  private lastFrameTime = performance.now()
  private fpsSamples: number[] = []
  private cameraWasPlaying = false

  private postFx = new PostFxStack()
  private rigs = new Map<string, DeviceRig>()
  private providers = new Map<string, ScreenProvider>()
  private liveKeys = new Map<string, string>() // deviceId -> sourceKey
  private providerSig = new Map<string, string>()
  private unsubscribers: (() => void)[] = []

  onStats: ((s: ViewportStats) => void) | null = null

  mount(container: HTMLElement): void {
    this.container = container
    this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, powerPreference: 'high-performance' })
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
    this.renderer.shadowMap.enabled = true
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping
    this.renderer.toneMappingExposure = 1.0
    this.renderer.outputColorSpace = THREE.SRGBColorSpace
    container.appendChild(this.renderer.domElement)
    this.renderer.domElement.style.width = '100%'
    this.renderer.domElement.style.height = '100%'
    this.renderer.domElement.style.display = 'block'
    this.renderer.domElement.tabIndex = 0

    this.scene.environment = sceneEnvironment(this.renderer)

    this.camera.position.set(0, 80, 420)
    this.controls = new OrbitControls(this.camera, this.renderer.domElement)
    this.controls.enableDamping = true
    this.controls.dampingFactor = 0.08
    this.controls.target.set(0, 60, 0)
    this.controls.maxDistance = 4000
    this.controls.minDistance = 40

    this.gizmo = new TransformControls(this.camera, this.renderer.domElement)
    this.gizmo.setSize(0.8)
    const gizmoHelper = this.gizmo.getHelper()
    this.scene.add(gizmoHelper)
    this.gizmo.addEventListener('dragging-changed', (e) => {
      if (this.controls) this.controls.enabled = !(e as unknown as { value: boolean }).value
    })
    this.gizmo.addEventListener('objectChange', () => {
      const dev = store.selectedDevice()
      const rig = dev ? this.rigs.get(dev.id) : null
      if (!dev || !rig) return
      const p = rig.root.position
      const r = rig.root.rotation
      const sc = rig.root.scale
      this.applyDeviceTransformFromGizmo(dev.id, {
        position: { x: p.x, y: p.y, z: p.z },
        rotation: { x: THREE.MathUtils.radToDeg(r.x), y: THREE.MathUtils.radToDeg(r.y), z: THREE.MathUtils.radToDeg(r.z) },
        scale: { x: sc.x, y: sc.y, z: sc.z }
      })
    })

    this.envRig = createEnvironment(this.renderer)
    this.scene.add(this.envRig.group)

    this.unsubscribers.push(
      store.on('project', () => this.syncDevices()),
      store.on('selection', () => this.syncGizmo()),
      store.on('frame', () => {
        const id = store.frameRequest
        store.frameRequest = null
        if (id) window.setTimeout(() => this.frameDevice(id), 450)
      }),
      store.on('time', () => void this.evaluateTime()),
      store.on('playback', () => {
        if (store.playing) {
          this.cameraWasPlaying = true
          void this.evaluateTime()
        }
      })
    )

    // picking
    const raycaster = new THREE.Raycaster()
    const pointer = new THREE.Vector2()
    let downAt: { x: number; y: number } | null = null
    this.renderer.domElement.addEventListener('pointerdown', (e) => {
      downAt = { x: e.clientX, y: e.clientY }
    })
    this.renderer.domElement.addEventListener('pointerup', (e) => {
      if (!downAt || !this.renderer) return
      const moved = Math.hypot(e.clientX - downAt.x, e.clientY - downAt.y)
      downAt = null
      if (moved > 4 || this.gizmo?.dragging) return
      const rect = this.renderer.domElement.getBoundingClientRect()
      pointer.set(((e.clientX - rect.left) / rect.width) * 2 - 1, -((e.clientY - rect.top) / rect.height) * 2 + 1)
      raycaster.setFromCamera(pointer, this.camera)
      const hits = raycaster.intersectObjects(this.scene.children, true)
      for (const hit of hits) {
        let o: THREE.Object3D | null = hit.object
        while (o) {
          const found = [...this.rigs.entries()].find(([, rig]) => rig.root === o)
          if (found) {
            store.selectedDeviceId = found[0]
            store.emit('selection')
            return
          }
          o = o.parent
        }
      }
    })

    // drag & drop media onto a device
    const dropHint = document.createElement('div')
    dropHint.className = 'drop-hint'
    container.appendChild(dropHint)
    let hideHint = 0
    container.addEventListener('dragover', (e) => {
      e.preventDefault()
      e.dataTransfer!.dropEffect = 'copy'
      const dev = this.pickDeviceAt(e.clientX, e.clientY) ?? store.selectedDevice()
      const label = dev ? (getPreset(dev.presetId).label ?? 'device') : null
      dropHint.textContent = label ? `Drop to put it on ${label}` : 'Add a device first'
      dropHint.classList.add('show')
      window.clearTimeout(hideHint)
      hideHint = window.setTimeout(() => dropHint.classList.remove('show'), 250)
    })
    container.addEventListener('drop', (e) => {
      e.preventDefault()
      dropHint.classList.remove('show')
      void this.handleDrop(e)
    })

    this.syncDevices()
    this.resize()
    window.addEventListener('resize', () => this.resize())
    this.loop()
  }

  private async handleDrop(e: DragEvent): Promise<void> {
    const target = this.pickDeviceAt(e.clientX, e.clientY) ?? store.selectedDevice() ?? store.scene.devices[store.scene.devices.length - 1]
    if (!target) {
      const { toast } = await import('../ui/toast')
      toast('Add a device first, then drop your video onto its screen')
      return
    }
    const { dropOntoDevice } = await import('../ui/leftPanel')
    await dropOntoDevice(target.id, e.dataTransfer)
  }

  private pickDeviceAt(clientX: number, clientY: number): DeviceInstance | null {
    if (!this.renderer) return null
    const rect = this.renderer.domElement.getBoundingClientRect()
    const pointer = new THREE.Vector2(((clientX - rect.left) / rect.width) * 2 - 1, -((clientY - rect.top) / rect.height) * 2 + 1)
    const raycaster = new THREE.Raycaster()
    raycaster.setFromCamera(pointer, this.camera)
    const hits = raycaster.intersectObjects(this.scene.children, true)
    for (const hit of hits) {
      let o: THREE.Object3D | null = hit.object
      while (o) {
        const found = [...this.rigs.entries()].find(([, rig]) => rig.root === o)
        if (found) return store.scene.devices.find((d) => d.id === found[0]) ?? null
        o = o.parent
      }
    }
    return null
  }

  private applyDeviceTransformFromGizmo(
    deviceId: string,
    t: { position: { x: number; y: number; z: number }; rotation: { x: number; y: number; z: number }; scale: { x: number; y: number; z: number } }
  ): void {
    if (this.snapOn) {
      // 10mm translation grid, 15° rotation steps
      t = {
        ...t,
        position: {
          x: Math.round(t.position.x / 10) * 10,
          y: Math.round(t.position.y / 10) * 10,
          z: Math.round(t.position.z / 10) * 10
        },
        rotation: {
          x: Math.round(t.rotation.x / 15) * 15,
          y: Math.round(t.rotation.y / 15) * 15,
          z: Math.round(t.rotation.z / 15) * 15
        }
      }
    }
    // gizmo edits write a single keyframe at current time (no history spam while dragging)
    store.edit('Move device', (p) => {
      for (const s of p.scenes) {
        const d = s.devices.find((x) => x.id === deviceId)
        if (!d) continue
        const keys = d.transform.keys
        const firstKey = keys[0]
        if (firstKey && keys.length === 1 && firstKey.t === 0) firstKey.value = t
        else {
          const existing = keys.find((k) => Math.abs(k.t - store.time) < 1 / 60)
          if (existing) existing.value = t
          else keys.push({ t: store.time, value: t, easing: 'easeInOutCubic' })
          keys.sort((a, b) => a.t - b.t)
        }
      }
    })
  }

  // ---------- device sync ----------
  private envSig = ''
  private envBackground: THREE.Color | null = null

  /** Rebuild lights/backdrop when the scene's environment settings change. */
  private syncEnvironment(): void {
    const env = store.scene.environment
    const sig = JSON.stringify(env)
    if (!this.envRig || sig === this.envSig) return
    this.envSig = sig
    this.envRig.update(env)
    // environments without a backdrop mesh still need an opaque background
    // in exports (the viewport canvas is alpha-enabled)
    const solid: Partial<Record<typeof env.id, string>> = {
      'floating-void': '#0b0d12',
      'dark-cinematic': '#06070a',
      'reflective-floor': '#0c0e13'
    }
    const bg = solid[env.id]
    this.envBackground = bg ? new THREE.Color(bg) : null
    this.scene.background = this.envBackground
  }

  private syncDevices(): void {
    this.syncEnvironment()
    const scene = store.scene
    const keep = new Set(scene.devices.map((d) => d.id))
    // remove gone
    for (const [id, rig] of this.rigs) {
      if (!keep.has(id)) {
        this.scene.remove(rig.root)
        rig.dispose()
        this.rigs.delete(id)
      }
    }
    for (const [id, p] of this.providers) {
      if (!keep.has(id)) {
        p.dispose()
        this.providers.delete(id)
      }
    }
    for (const [id, key] of this.liveKeys) {
      if (!keep.has(id)) {
        void window.livemock.liveStop(key)
        this.liveKeys.delete(id)
      }
    }

    for (const dev of scene.devices) {
      let rig = this.rigs.get(dev.id)
      const preset = getPreset(dev.presetId)
      const presetModelUrl = preset.modelFile ? `livemock-test://model/${preset.modelFile}` : null
      if (!rig && (dev.customModelMediaId || presetModelUrl)) {
        // async custom-model path: placeholder box while loading
        const placeholder = buildDevice(preset, dev.material.finish, dev.material.color, dev.cutout)
        this.scene.add(placeholder.root)
        this.rigs.set(dev.id, placeholder)
        const modelUrl = dev.customModelMediaId ? window.livemock.mediaMediaUrl(dev.customModelMediaId) : presetModelUrl!
        void buildCustomDevice(modelUrl, {
          targetSizeMm: preset.targetSizeMm,
          rotationYDeg: preset.modelRotationYDeg ?? 0,
          enableLid: preset.kind === 'laptop',
          screenCornerRadiusMm: preset.screenCornerRadiusMm
        }).then((custom) => {
          const current = this.rigs.get(dev.id)
          if (!custom || current !== placeholder) {
            if (custom && current !== placeholder) custom.dispose()
            return
          }
          this.scene.remove(placeholder.root)
          placeholder.dispose()
          custom.root.traverse((o) => {
            if (o instanceof THREE.Mesh) o.castShadow = true
          })
          addContactShadow(custom)
          this.scene.add(custom.root)
          this.rigs.set(dev.id, custom)
          const provider = this.providers.get(dev.id)
          if (provider) this.applyProviderToRig(custom, provider)
          this.syncGizmo()
          void this.evaluateTime()
        })
        continue
      }
      if (!rig) {
        rig = buildDevice(preset, dev.material.finish, dev.material.color, dev.cutout)
        rig.root.traverse((o) => {
          if (o instanceof THREE.Mesh) {
            o.castShadow = true
            o.receiveShadow = preset.kind !== 'phone'
          }
        })
        rig.screenMesh.castShadow = false
        rig.screenMesh.receiveShadow = false
        addContactShadow(rig)
        this.scene.add(rig.root)
        this.rigs.set(dev.id, rig)
        this.attachProvider(dev)
      } else if (!preset.modelFile && !dev.customModelMediaId) {
        // material / cutout changes: rebuild (cheap enough at these sizes)
        const needsRebuild =
          (rig.root.userData as { finish?: string; color?: string; cutout?: string }).finish !== dev.material.finish ||
          (rig.root.userData as { finish?: string; color?: string; cutout?: string }).color !== dev.material.color ||
          (rig.root.userData as { finish?: string; color?: string; cutout?: string }).cutout !== dev.cutout
        if (needsRebuild) {
          const provider = this.providers.get(dev.id)
          this.scene.remove(rig.root)
          rig.dispose()
          rig = buildDevice(preset, dev.material.finish, dev.material.color, dev.cutout)
          ;(rig.root.userData as { finish?: string; color?: string; cutout?: string }).finish = dev.material.finish
          ;(rig.root.userData as { finish?: string; color?: string; cutout?: string }).color = dev.material.color
          ;(rig.root.userData as { finish?: string; color?: string; cutout?: string }).cutout = dev.cutout
          rig.root.traverse((o) => {
            if (o instanceof THREE.Mesh) o.castShadow = true
          })
          rig.screenMesh.castShadow = false
          addContactShadow(rig)
          if (provider) this.applyProviderToRig(rig, provider)
          this.scene.add(rig.root)
          this.rigs.set(dev.id, rig)
        }
      }
      if (!this.providers.has(dev.id) || this.providerSig.get(dev.id) !== screenSig(dev)) {
        this.attachProvider(dev)
      }
      this.updateGlare(dev, rig)
    }
    this.syncGizmo()
    void this.evaluateTime()
  }

  private updateGlare(dev: DeviceInstance, rig: DeviceRig): void {
    if (!rig.glareMesh) return
    const mat = rig.glareMesh.material as THREE.MeshPhysicalMaterial
    mat.opacity = dev.screenGlare * 0.22
    mat.transmission = 0.9 - dev.screenGlare * 0.3
    mat.needsUpdate = true
  }

  private applyProviderToRig(rig: DeviceRig, provider: ScreenProvider | null): void {
    const mat = rig.screenMesh.material as THREE.MeshBasicMaterial
    const tex = provider?.texture ?? null
    mat.map = tex
    // white multiplies the texture faithfully; background color only when no map
    mat.color.set(tex ? 0xffffff : (provider?.background ?? 0x07080a))
    mat.needsUpdate = true
  }

  private attachProvider(dev: DeviceInstance): void {
    const old = this.providers.get(dev.id)
    if (old) {
      old.dispose()
      this.providers.delete(dev.id)
    }
    const liveKey = this.liveKeys.get(dev.id)
    if (liveKey) {
      void window.livemock.liveStop(liveKey)
      this.liveKeys.delete(dev.id)
    }
    this.providerSig.set(dev.id, screenSig(dev))

    const rig = this.rigs.get(dev.id)
    let provider: ScreenProvider | null = null

    if (dev.screen.kind === 'image') {
      provider = new ImageProvider(dev.screen.mediaId, window.livemock.mediaMediaUrl(dev.screen.mediaId))
    } else if (dev.screen.kind === 'video') {
      provider = new VideoProvider(dev.screen, window.livemock.mediaMediaUrl(dev.screen.mediaId))
    } else if (dev.screen.kind === 'url') {
      const preset = getPreset(dev.presetId)
      const vp = dev.screen.viewport
      const sourceKey = `live-${dev.id}`
      provider = new LiveProvider(sourceKey, { w: vp.w, h: vp.h }, (ev) => {
        void window.livemock.liveInput(sourceKey, ev)
      })
      this.liveKeys.set(dev.id, sourceKey)
      void window.livemock.liveStart({
        sourceKey,
        url: dev.screen.url,
        viewport: { w: vp.w, h: vp.h, dpr: 1 },
        mobileEmulation: dev.screen.mobileEmulation && preset.mobileEmulation
      })
    }

    if (provider && rig) {
      this.providers.set(dev.id, provider)
      this.applyProviderToRig(rig, provider)
    } else if (rig) {
      this.applyProviderToRig(rig, null)
    }
  }

  /** Re-attach provider when the screen source object changes (inspector edits). */
  refreshScreenOf(deviceId: string): void {
    const dev = store.scene.devices.find((d) => d.id === deviceId)
    if (!dev) return
    this.attachProvider(dev)
  }

  /** Live providers need re-attach when the URL changes without kind change. */
  syncLiveUrls(): void {
    for (const [deviceId, key] of this.liveKeys) {
      const dev = store.scene.devices.find((d) => d.id === deviceId)
      if (dev?.screen.kind === 'url') {
        void window.livemock.liveNavigate(key, dev.screen.url)
      }
    }
  }

  // ---------- gizmo ----------
  setGizmoMode(mode: 'translate' | 'rotate' | 'scale' | null): void {
    if (!this.gizmo) return
    if (mode === null) {
      this.gizmo.detach()
    } else {
      const dev = store.selectedDevice()
      const rig = dev ? this.rigs.get(dev.id) : null
      if (dev && rig) {
        this.gizmo.attach(rig.root)
        this.gizmo.setMode(mode)
      }
    }
  }

  private syncGizmo(): void {
    if (!this.gizmo) return
    const dev = store.selectedDevice()
    const rig = dev ? this.rigs.get(dev.id) : null
    if (dev && rig && this.gizmo.object !== rig.root) {
      this.gizmo.attach(rig.root)
    } else if (!dev) {
      this.gizmo.detach()
    }
  }

  // ---------- evaluation ----------
  /** Evaluate all tracks + providers at an exact time (used by export too). */
  prepareFrame(timeSec: number): void {
    let t = timeSec
    const dur = store.scene.durationSec
    if (t > dur) t = dur
    for (const dev of store.scene.devices) {
      const rig = this.rigs.get(dev.id)
      if (!rig) continue
      const transform = evalTrack(dev.transform, t) ?? dev.transform.keys[0]?.value
      if (transform) {
        applyTransform(rig, transform, dev.lidAngleDeg ? evalTrack(dev.lidAngleDeg, t) : 105)
      }
    }
    if (!this.useEditorCamera) {
      const cam = store.scene.camera
      const pos = evalTrack(cam.position, t)
      const target = evalTrack(cam.target, t)
      const fov = evalTrack(cam.fov, t)
      if (pos && target) {
        this.camera.position.set(pos.x, pos.y, pos.z)
        this.camera.lookAt(target.x, target.y, target.z)
        this.controls?.target.set(target.x, target.y, target.z)
      }
      if (fov !== undefined) this.camera.fov = fov
    }
    this.camera.updateProjectionMatrix()
    for (const p of this.providers.values()) p.update(t, true)
    this.applyScreenFits()
  }

  /** Re-bind a device's current provider texture to its screen (export swaps). */
  rebindScreen(deviceId: string): void {
    const rig = this.rigs.get(deviceId)
    const provider = this.providers.get(deviceId)
    if (rig && provider) this.applyProviderToRig(rig, provider)
    this.applyScreenFits()
  }

  /** Aspect of the editor viewport — exports keep its horizontal coverage. */
  viewportAspect(): number {
    const w = this.container?.clientWidth ?? 16
    const h = this.container?.clientHeight ?? 9
    return h > 0 ? w / h : 16 / 9
  }

  private exportRefAspect: number | null = null
  private useEditorCamera = false

  /**
   * Enter/leave export mode: hides editor-only helpers, pins reference framing.
   * `editorCamera`: render from the current viewport camera (what you see)
   * instead of the animated camera track — used for still frames.
   */
  setExportMode(on: boolean, opts: { editorCamera?: boolean } = {}): void {
    if (on) {
      this.useEditorCamera = opts.editorCamera === true
      this.exportRefAspect = this.viewportAspect()
      if (this.gizmo) this.gizmo.getHelper().visible = false
    } else {
      this.exportRefAspect = null
      this.useEditorCamera = false
      this.postFx.disposeExport()
      if (this.gizmo) this.gizmo.getHelper().visible = true
      this.resize()
      void this.evaluateTime()
    }
  }

  setBackdropVisible(visible: boolean): void {
    this.envRig?.setBackdropVisible(visible)
    this.scene.background = visible ? this.envBackground : null
  }

  providerFor(deviceId: string): ScreenProvider | null {
    return this.providers.get(deviceId) ?? null
  }

  /** @internal test hook */
  debugRig(deviceId: string): DeviceRig | null {
    return this.rigs.get(deviceId) ?? null
  }

  /** @internal test hook */
  debugCamera(): THREE.PerspectiveCamera {
    return this.camera
  }

  /** @internal test hook */
  debugThree(): typeof THREE {
    return THREE
  }

  /** @internal test hook: world-space screen orientation info */
  debugScreenInfo(deviceId: string): { normal: THREE.Vector3; position: THREE.Vector3; camera: THREE.Vector3; lidRotX: number } | null {
    const rig = this.rigs.get(deviceId)
    if (!rig) return null
    this.scene.updateMatrixWorld(true)
    const n = new THREE.Vector3(0, 0, 1)
    n.applyQuaternion(rig.screenMesh.getWorldQuaternion(new THREE.Quaternion()))
    return {
      normal: { x: n.x, y: n.y, z: n.z } as unknown as THREE.Vector3,
      position: rig.screenMesh.getWorldPosition(new THREE.Vector3()),
      camera: this.camera.position.clone(),
      lidRotX: rig.lidPivot?.rotation.x ?? 0
    }
  }

  private async evaluateTime(): Promise<void> {
    const t = store.time
    for (const dev of store.scene.devices) {
      const rig = this.rigs.get(dev.id)
      if (!rig) continue
      const transform = evalTrack(dev.transform, t) ?? dev.transform.keys[0]?.value
      if (transform) {
        applyTransform(rig, transform, dev.lidAngleDeg ? evalTrack(dev.lidAngleDeg, t) : 105)
      }
    }
    // camera
    const cam = store.scene.camera
    const pos = evalTrack(cam.position, t)
    const target = evalTrack(cam.target, t)
    const fov = evalTrack(cam.fov, t)
    if (pos && target) {
      this.camera.position.set(pos.x, pos.y, pos.z)
      this.controls?.target.set(target.x, target.y, target.z)
      this.camera.lookAt(target.x, target.y, target.z)
    }
    if (fov !== undefined) this.camera.fov = fov
    this.camera.updateProjectionMatrix()
  }

  /** Map content onto the screen plane honoring the fit mode (fill/fit/crop). */
  applyScreenFits(): void {
    for (const dev of store.scene.devices) {
      const provider = this.providers.get(dev.id)
      const rig = this.rigs.get(dev.id)
      if (!provider || !rig || !provider.texture) continue
      const fitKey = `${dev.screen.kind === 'image' || dev.screen.kind === 'video' ? dev.screen.fit : 'fill'}:${provider.contentAspect}:${rig.screenWmm.toFixed(2)}x${rig.screenHmm.toFixed(2)}`
      const tagged = provider.texture as unknown as { __fitKey?: string }
      if (provider.contentAspect === null || tagged.__fitKey === fitKey) continue
      const mat = rig.screenMesh.material as THREE.MeshBasicMaterial
      if (mat.map !== provider.texture) continue
      const fit = dev.screen.kind === 'image' || dev.screen.kind === 'video' ? dev.screen.fit : 'fill'
      const screenAspect = rig.screenWmm / Math.max(1, rig.screenHmm)
      const ca = provider.contentAspect
      const tex = provider.texture
      tex.repeat.set(1, 1)
      tex.offset.set(0, 0)
      tex.wrapS = THREE.ClampToEdgeWrapping
      tex.wrapT = THREE.ClampToEdgeWrapping
      if (fit !== 'fill' && ca > 0 && screenAspect > 0) {
        const wider = ca > screenAspect // content wider than screen
        if (fit === 'fit') {
          // contain + letterbox
          if (wider) {
            tex.repeat.set(1, screenAspect / ca)
            tex.offset.set(0, (1 - screenAspect / ca) / 2)
          } else {
            tex.repeat.set(ca / screenAspect, 1)
            tex.offset.set((1 - ca / screenAspect) / 2, 0)
          }
        } else {
          // crop = cover
          if (wider) {
            tex.repeat.set(screenAspect / ca, 1)
            tex.offset.set((1 - screenAspect / ca) / 2, 0)
          } else {
            tex.repeat.set(1, ca / screenAspect)
            tex.offset.set(0, (1 - ca / screenAspect) / 2)
          }
        }
      }
      tagged.__fitKey = fitKey
      tex.needsUpdate = true
      mat.needsUpdate = true
    }
  }

  private snapOn = true

  setSnap(on: boolean): void {
    this.snapOn = on
  }

  /** Point the camera at a device so it fills the viewport nicely. */
  frameDevice(deviceId: string): void {
    const rig = this.rigs.get(deviceId)
    if (!rig || !this.container) return
    const box = new THREE.Box3().setFromObject(rig.root)
    const center = box.getCenter(new THREE.Vector3())
    const size = box.getSize(new THREE.Vector3())
    const radius = Math.max(60, Math.max(size.x, size.y, size.z) * 0.62)
    const dist = radius / Math.tan(THREE.MathUtils.degToRad(this.camera.fov / 2)) * 1.12
    const dir = new THREE.Vector3(0.12, 0.32, 1).normalize()
    this.camera.position.copy(center).add(dir.multiplyScalar(dist))
    this.controls?.target.copy(center)
    this.camera.lookAt(center)
    this.controls?.update()
  }

  /** Place the editor camera (orbit target included). */
  lookFrom(pos: { x: number; y: number; z: number }, target: { x: number; y: number; z: number }, fov?: number): void {
    this.camera.position.set(pos.x, pos.y, pos.z)
    this.controls?.target.set(target.x, target.y, target.z)
    this.camera.lookAt(target.x, target.y, target.z)
    if (fov !== undefined) this.camera.fov = fov
    this.camera.updateProjectionMatrix()
    this.controls?.update()
  }

  /** Nudge the selected device along an axis (viewport arrow keys). */
  nudgeSelected(dx: number, dy: number, dz: number): void {
    const dev = store.selectedDevice()
    if (!dev) return
    store.edit('Nudge device', (p) => {
      for (const s of p.scenes) {
        const d = s.devices.find((x) => x.id === dev.id)
        const kv = d?.transform.keys[0]
        if (kv) {
          kv.value.position.x += dx
          kv.value.position.y += dy
          kv.value.position.z += dz
        }
      }
    })
  }

  // ---------- loop ----------
  private loop = (): void => {
    this.raf = requestAnimationFrame(this.loop)
    if (!this.renderer) return
    const now = performance.now()
    const dt = (now - this.lastFrameTime) / 1000
    this.lastFrameTime = now
    this.fpsSamples.push(1 / Math.max(dt, 1e-4))
    if (this.fpsSamples.length > 30) this.fpsSamples.shift()

    if (store.playing) {
      let t = store.time + dt
      const dur = store.scene.durationSec
      if (t > dur) {
        if (store.loop) t = 0
        else {
          t = dur
          store.setPlaying(false)
        }
      }
      store.setTime(t)
    }

    for (const p of this.providers.values()) p.update(store.time, store.playing)
    this.applyScreenFits()
    if (!store.playing && this.cameraWasPlaying) {
      this.cameraWasPlaying = false
      void this.evaluateTime()
    }
    this.controls?.update()
    const fx = store.scene.postFx
    const fxOn = fx.bloom || fx.vignette || fx.filmGrain || fx.depthOfField
    if (fxOn) {
      this.postFx.ensure(this.renderer, this.scene, this.camera, this.container?.clientWidth ?? 800, this.container?.clientHeight ?? 600)
      this.postFx.setCamera(this.camera)
      this.postFx.apply(fx, store.time)
      this.postFx.render(dt)
    } else {
      this.renderer.render(this.scene, this.camera)
    }

    if (this.onStats) {
      const fps = this.fpsSamples.reduce((a, b) => a + b, 0) / Math.max(1, this.fpsSamples.length)
      this.onStats({
        fps: Math.round(fps),
        calls: this.renderer.info.render.calls,
        textures: this.renderer.info.memory.textures,
        geometries: this.renderer.info.memory.geometries
      })
    }
  }

  private resize(): void {
    if (!this.renderer || !this.container) return
    const w = this.container.clientWidth
    const h = this.container.clientHeight
    if (w === 0 || h === 0) return
    this.renderer.setSize(w, h, false)
    this.camera.aspect = w / h
    this.camera.updateProjectionMatrix()
    this.postFx.resize(w, h)
  }

  /**
   * Render one frame at target resolution into an offscreen target (export).
   * Returns bottom-up RGBA pixels.
   */
  renderToTarget(width: number, height: number): Uint8Array | null {
    if (!this.renderer) return null
    const fx = store.scene.postFx
    const fxOn = fx.bloom || fx.vignette || fx.filmGrain
    const clearAlphaWas = this.renderer.getClearAlpha()
    this.renderer.setClearAlpha(0)
    try {
      if (fxOn) {
        return this.postFx.renderExportPixels(this.renderer, this.scene, this.camera, fx, store.time, width, height)
      }
      const target = new THREE.WebGLRenderTarget(width, height, {
        samples: 4,
        colorSpace: THREE.SRGBColorSpace
      })
      this.renderer.setRenderTarget(target)
      this.renderer.clear()
      this.renderer.render(this.scene, this.camera)
      const buf = new Uint8Array(width * height * 4)
      this.renderer.readRenderTargetPixels(target, 0, 0, width, height, buf)
      this.renderer.setRenderTarget(null)
      target.dispose()
      return buf
    } finally {
      this.renderer.setClearAlpha(clearAlphaWas)
    }
  }

  /** Compose one export frame (with optional motion-blur accumulation) into a canvas. */
  renderExportFrame(canvas: OffscreenCanvas, timeSec: number, samples: number): void {
    const ctx = canvas.getContext('2d') as OffscreenCanvasRenderingContext2D
    const w = canvas.width
    const h = canvas.height
    const gizmoHelper = this.gizmo?.getHelper()
    const gizmoWas = gizmoHelper?.visible ?? false
    const fovWas = this.camera.fov
    if (gizmoHelper) gizmoHelper.visible = false
    try {
      this.renderExportFrameInner(ctx, w, h, timeSec, samples)
    } finally {
      if (gizmoHelper) gizmoHelper.visible = gizmoWas
      // restore the editor camera projection
      this.camera.fov = fovWas
      if (this.container && this.container.clientHeight > 0) this.camera.aspect = this.container.clientWidth / this.container.clientHeight
      this.camera.updateProjectionMatrix()
    }
  }

  /** prepareFrame + export framing: target aspect, horizontal coverage of the editor view kept. */
  private prepareExportFrame(timeSec: number, w: number, h: number): void {
    this.prepareFrame(timeSec)
    const aspect = w / h
    const ref = this.exportRefAspect ?? this.viewportAspect()
    this.camera.aspect = aspect
    if (aspect < ref) {
      // narrower output (e.g. 9:16 from a 16:9 editor): widen the vertical FOV
      // so everything visible left-to-right in the editor stays in frame
      const half = THREE.MathUtils.degToRad(this.camera.fov / 2)
      this.camera.fov = THREE.MathUtils.radToDeg(2 * Math.atan(Math.tan(half) * (ref / aspect)))
    }
    this.camera.updateProjectionMatrix()
  }

  private renderExportFrameInner(ctx: OffscreenCanvasRenderingContext2D, w: number, h: number, timeSec: number, samples: number): void {
    if (samples <= 1) {
      this.prepareExportFrame(timeSec, w, h)
      const buf = this.renderToTarget(w, h)
      if (buf) putPixelsFlipped(ctx, buf, w, h)
      return
    }
    const acc = new Float64Array(w * h * 4)
    for (let s = 0; s < samples; s++) {
      const st = timeSec + (s / samples - 0.5) / store.scene.fps
      this.prepareExportFrame(st, w, h)
      const buf = this.renderToTarget(w, h)
      if (!buf) continue
      for (let i = 0; i < acc.length; i++) acc[i] = (acc[i] ?? 0) + (buf[i] ?? 0)
    }
    const out = new Uint8ClampedArray(acc.length)
    for (let i = 0; i < acc.length; i++) out[i] = acc[i]! / samples
    putPixelsFlipped(ctx, new Uint8Array(out.buffer as ArrayBuffer), w, h)
  }

  dispose(): void {
    this.postFx.dispose()
    cancelAnimationFrame(this.raf)
    for (const u of this.unsubscribers) u()
    for (const key of this.liveKeys.values()) void window.livemock.liveStop(key)
    for (const p of this.providers.values()) p.dispose()
    for (const rig of this.rigs.values()) rig.dispose()
    this.envRig?.dispose()
    this.controls?.dispose()
    this.gizmo?.dispose()
    this.renderer?.dispose()
    if (this.renderer?.domElement.parentElement) {
      this.renderer.domElement.parentElement.removeChild(this.renderer.domElement)
    }
  }
}

export const sceneController = new SceneController()
export type { LiveFramePayload }

/** WebGL reads bottom-up; flip rows into a 2D context. */
function putPixelsFlipped(ctx: OffscreenCanvasRenderingContext2D, buf: Uint8Array, w: number, h: number): void {
  const img = new ImageData(w, h)
  const rowBytes = w * 4
  for (let y = 0; y < h; y++) {
    const src = (h - 1 - y) * rowBytes
    img.data.set(buf.subarray(src, src + rowBytes), y * rowBytes)
  }
  ctx.putImageData(img, 0, 0)
}

let contactShadowTex: THREE.Texture | null = null

/**
 * Soft contact shadow under a device's footprint: grounds devices on any
 * environment (and survives transparent exports, like a product shot).
 */
function addContactShadow(rig: DeviceRig): void {
  const root = rig.root
  if (root.userData.contactShadow) return
  const savedPos = root.position.clone()
  const savedRot = root.rotation.clone()
  const savedScale = root.scale.clone()
  root.position.set(0, 0, 0)
  root.rotation.set(0, 0, 0)
  root.scale.set(1, 1, 1)
  root.updateMatrixWorld(true)
  const box = new THREE.Box3()
  root.traverse((o) => {
    if (o instanceof THREE.Mesh && o.visible) box.expandByObject(o)
  })
  root.position.copy(savedPos)
  root.rotation.copy(savedRot)
  root.scale.copy(savedScale)
  if (box.isEmpty()) return
  if (!contactShadowTex) {
    const cv = document.createElement('canvas')
    cv.width = cv.height = 128
    const ctx = cv.getContext('2d')!
    const g = ctx.createRadialGradient(64, 64, 0, 64, 64, 64)
    g.addColorStop(0, 'rgba(0,0,0,0.7)')
    g.addColorStop(0.5, 'rgba(0,0,0,0.35)')
    g.addColorStop(1, 'rgba(0,0,0,0)')
    ctx.fillStyle = g
    ctx.fillRect(0, 0, 128, 128)
    contactShadowTex = new THREE.CanvasTexture(cv)
  }
  const size = box.getSize(new THREE.Vector3())
  const center = box.getCenter(new THREE.Vector3())
  const w = size.x * 1.18 + 24
  const d = Math.max(size.z, 6) * 1.25 + 24
  const plane = new THREE.Mesh(
    new THREE.PlaneGeometry(w, d),
    new THREE.MeshBasicMaterial({ map: contactShadowTex, transparent: true, depthWrite: false, toneMapped: false, polygonOffset: true, polygonOffsetFactor: -2 })
  )
  plane.rotation.x = -Math.PI / 2
  plane.position.set(center.x, box.min.y + 0.15, center.z)
  plane.renderOrder = -1
  plane.raycast = () => undefined
  plane.name = 'contact-shadow'
  root.add(plane)
  root.userData.contactShadow = plane
}

function screenSig(dev: DeviceInstance): string {
  return JSON.stringify(dev.screen)
}
