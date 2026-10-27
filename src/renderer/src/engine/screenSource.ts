// Screen-source providers (SPEC §4): image / video / live-URL preview.
// Each provider yields a THREE.Texture and knows how to update at time t.

import * as THREE from 'three'
import type { ScreenSource } from '@shared/types'
import type { LiveEvent, LiveInputEvent } from '@shared/ipc'
import { ExportVideoDecoder } from '../export/videoDecode'

export interface ScreenProvider {
  readonly texture: THREE.Texture | null
  /** background color for 'fit' letterboxing */
  readonly background: THREE.Color
  /** content aspect (w/h) once known — drives fit/cover UV mapping */
  contentAspect: number | null
  /** called every frame with scene time (s) */
  update(timeSec: number, playing: boolean): void
  dispose(): void
  /** export hooks (video): decoded-frame swap */
  beginExport?: () => Promise<void>
  seekExport?: (timeSec: number) => Promise<void>
  endExport?: () => void
  // live-only surface
  sendInput?(ev: LiveInputEvent): void
  getLiveInfo?(): { scrollY: number; scrollHeight: number; viewportW: number; viewportH: number } | null
  ripple?(x: number, y: number): void
}

export function isLiveSource(s: ScreenSource): s is Extract<ScreenSource, { kind: 'url' }> {
  return s.kind === 'url'
}

// ---------- image ----------

class ImageProvider implements ScreenProvider {
  texture: THREE.Texture | null = null
  background = new THREE.Color(0x000000)
  contentAspect: number | null = null
  private mediaId: string

  constructor(mediaId: string, mediaUrl: string) {
    this.mediaId = mediaId
    const loader = new THREE.TextureLoader()
    loader.setCrossOrigin('anonymous')
    loader.load(
      mediaUrl,
      (tex) => {
        tex.colorSpace = THREE.SRGBColorSpace
        this.texture = tex
        const img = tex.image as { width?: number; height?: number }
        if (img?.width && img?.height) this.contentAspect = img.width / img.height
      },
      undefined,
      () => {
        console.warn(`[livemock] failed to load image ${this.mediaId}`)
      }
    )
  }

  update(): void {
    /* static */
  }

  dispose(): void {
    this.texture?.dispose()
    this.texture = null
  }
}

// ---------- video ----------

class VideoProvider implements ScreenProvider {
  texture: THREE.VideoTexture | null = null
  background = new THREE.Color(0x000000)
  contentAspect: number | null = null
  private video: HTMLVideoElement
  private source: Extract<ScreenSource, { kind: 'video' }>
  private mediaUrl: string
  private exportDecoder: ExportVideoDecoder | null = null
  private exportCanvas: HTMLCanvasElement | null = null
  private exportTexture: THREE.CanvasTexture | null = null

  constructor(source: Extract<ScreenSource, { kind: 'video' }>, mediaUrl: string) {
    this.source = source
    this.mediaUrl = mediaUrl
    const v = document.createElement('video')
    v.src = mediaUrl
    v.muted = true
    v.loop = source.loop
    v.playbackRate = source.rate
    v.playsInline = true
    v.preload = 'auto'
    this.video = v
    void v.play().catch(() => undefined)
    v.addEventListener('loadedmetadata', () => {
      if (v.videoWidth && v.videoHeight) this.contentAspect = v.videoWidth / v.videoHeight
    })
    this.texture = new THREE.VideoTexture(v)
    this.texture.colorSpace = THREE.SRGBColorSpace
  }

  /** Switch to a decoded-frame canvas texture for deterministic export. */
  async beginExport(): Promise<void> {
    this.exportDecoder = await ExportVideoDecoder.open(this.mediaUrl)
    if (!this.exportDecoder) return
    const w = this.exportDecoder.width || 1080
    const h = this.exportDecoder.height || 1920
    this.exportCanvas = document.createElement('canvas')
    this.exportCanvas.width = w
    this.exportCanvas.height = h
    this.exportTexture = new THREE.CanvasTexture(this.exportCanvas)
    this.exportTexture.colorSpace = THREE.SRGBColorSpace
    this.contentAspect = this.exportCanvas.width / this.exportCanvas.height
    this.texture = this.exportTexture as unknown as THREE.VideoTexture
  }

  /** Decode + draw the exact frame for scene time `timeSec` (scene → media mapping). */
  async seekExport(timeSec: number): Promise<void> {
    if (!this.exportDecoder || !this.exportCanvas || !this.exportTexture) return
    const s = this.source
    const local = timeSec - s.offsetSec
    if (local < 0) return
    let mediaTime = s.trimIn + local * s.rate
    const span = Math.max(0.1, s.trimOut - s.trimIn)
    if (s.loop) mediaTime = s.trimIn + ((mediaTime - s.trimIn) % span)
    else if (mediaTime > s.trimOut) mediaTime = s.trimOut
    const ctx = this.exportCanvas.getContext('2d') as CanvasRenderingContext2D | null
    if (!ctx) return
    ctx.fillStyle = '#000'
    ctx.fillRect(0, 0, this.exportCanvas.width, this.exportCanvas.height)
    await this.exportDecoder.drawFrameAt(ctx as unknown as OffscreenCanvasRenderingContext2D, mediaTime, 0, 0, this.exportCanvas.width, this.exportCanvas.height)
    this.exportTexture.needsUpdate = true
  }

  endExport(): void {
    this.exportDecoder?.dispose()
    this.exportDecoder = null
    this.exportTexture?.dispose()
    this.exportTexture = null
    this.exportCanvas = null
    // restore live preview texture
    this.texture = new THREE.VideoTexture(this.video)
    this.texture.colorSpace = THREE.SRGBColorSpace
  }

  update(timeSec: number, playing: boolean): void {
    const s = this.source
    const inRange = timeSec >= s.offsetSec
    if (playing && inRange) {
      if (this.video.paused) void this.video.play().catch(() => undefined)
    } else if (!this.video.paused) {
      this.video.pause()
    }
    if (!playing && inRange) {
      // scrub: approximate frame position via seek (export uses Mediabunny)
      const local = ((timeSec - s.offsetSec) * s.rate) % Math.max(0.1, s.trimOut - s.trimIn)
      const target = s.trimIn + local
      if (Math.abs(this.video.currentTime - target) > 0.08) this.video.currentTime = target
    }
  }

  dispose(): void {
    this.video.pause()
    this.video.removeAttribute('src')
    this.video.load()
    this.texture?.dispose()
    this.texture = null
  }
}

// ---------- live URL ----------

export class LiveProvider implements ScreenProvider {
  texture: THREE.CanvasTexture | null = null
  background = new THREE.Color(0x101014)
  contentAspect: number | null = null
  private canvas: HTMLCanvasElement
  private ctx: CanvasRenderingContext2D
  private sourceKey: string
  private info = { scrollY: 0, scrollHeight: 1, viewportW: 0, viewportH: 0 }
  private unsubscribe: () => void
  private ripples: { x: number; y: number; t0: number }[] = []
  private frameCount = 0

  constructor(sourceKey: string, viewport: { w: number; h: number }, onInput: (ev: LiveInputEvent) => void) {
    this.sourceKey = sourceKey
    this.canvas = document.createElement('canvas')
    this.canvas.width = viewport.w
    this.canvas.height = viewport.h
    this.ctx = this.canvas.getContext('2d')!
    this.ctx.fillStyle = '#101014'
    this.ctx.fillRect(0, 0, this.canvas.width, this.canvas.height)
    this.texture = new THREE.CanvasTexture(this.canvas)
    this.texture.colorSpace = THREE.SRGBColorSpace

    this.unsubscribe = window.livemock.onLiveEvent((ev: LiveEvent) => {
      if (ev.type === 'frame' && ev.payload.sourceKey === this.sourceKey) {
        this.drawFrame(ev.payload.width, ev.payload.height, new Uint8ClampedArray(ev.payload.data))
      } else if (ev.type === 'info' && ev.payload.sourceKey === this.sourceKey) {
        this.info = {
          scrollY: ev.payload.scrollY,
          scrollHeight: ev.payload.scrollHeight,
          viewportW: ev.payload.viewportW,
          viewportH: ev.payload.viewportH
        }
      } else if (ev.type === 'ripple' && ev.sourceKey === this.sourceKey) {
        this.addRipple(ev.x, ev.y)
      }
    })

    this.sendInput = (input) => onInput(input)
  }

  private buf: HTMLCanvasElement | null = null

  private drawFrame(w: number, h: number, rgba: Uint8ClampedArray): void {
    // blit into an intermediate buffer at frame size, then scale into the
    // STABLE fixed-size canvas — resizing the texture-backed canvas every
    // time the preview scale changes corrupts the GPU upload
    if (!this.buf || this.buf.width !== w || this.buf.height !== h) {
      this.buf = document.createElement('canvas')
      this.buf.width = w
      this.buf.height = h
      this.contentAspect = w / h
    }
    const bctx = this.buf.getContext('2d')!
    const clamped = new Uint8ClampedArray(rgba.buffer as ArrayBuffer, rgba.byteOffset, rgba.length)
    const imageData = bctx.createImageData(w, h)
    imageData.data.set(clamped)
    bctx.putImageData(imageData, 0, 0)
    this.ctx.drawImage(this.buf, 0, 0, this.canvas.width, this.canvas.height)
    this.frameCount++
    this.texture!.needsUpdate = true
  }

  addRipple(x: number, y: number): void {
    this.ripples.push({ x, y, t0: performance.now() })
    if (this.ripples.length > 8) this.ripples.shift()
  }

  sendInput: (ev: LiveInputEvent) => void

  getLiveInfo(): { scrollY: number; scrollHeight: number; viewportW: number; viewportH: number } | null {
    return this.info
  }

  update(_timeSec: number, _playing: boolean): void {
    const now = performance.now()
    this.ripples = this.ripples.filter((r) => now - r.t0 < 650)
    if (this.ripples.length > 0 && this.ctx) {
      // ripples are drawn on the shared canvas; restore by re-drawing is costly,
      // so we overlay and mark dirty only (transient UI, acceptable in preview)
      for (const r of this.ripples) {
        const p = (now - r.t0) / 650
        const scale = 0.4 + p * 1.8
        const alpha = (1 - p) * 0.55
        this.ctx.save()
        this.ctx.globalAlpha = alpha
        this.ctx.strokeStyle = '#7ecbff'
        this.ctx.lineWidth = 3
        this.ctx.beginPath()
        this.ctx.arc(r.x, r.y, 26 * scale, 0, Math.PI * 2)
        this.ctx.stroke()
        this.ctx.restore()
      }
      this.texture!.needsUpdate = true
    }
  }

  dispose(): void {
    this.unsubscribe()
    this.texture?.dispose()
    this.texture = null
    void this.frameCount
  }
}

// ---------- factory ----------

export function createProvider(source: ScreenSource): ScreenProvider | null {
  switch (source.kind) {
    case 'none':
      return null
    case 'image': {
      const url = window.livemock.mediaMediaUrl(source.mediaId)
      return new ImageProvider(source.mediaId, url)
    }
    case 'video': {
      const url = window.livemock.mediaMediaUrl(source.mediaId)
      return new VideoProvider(source, url)
    }
    case 'url':
      // Live providers are managed by the scene controller (needs a source key
      // + IPC lifecycle); never constructed here.
      return null
    default:
      return null
  }
}

export { ImageProvider, VideoProvider }

export function hashString(s: string): number {
  let h = 0
  for (let i = 0; i < s.length; i++) {
    h = (Math.imul(31, h) + s.charCodeAt(i)) | 0
  }
  return h
}
