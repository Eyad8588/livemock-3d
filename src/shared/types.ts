// LiveMock 3D — shared data model (SPEC §3). Single source of truth for
// main, preload and renderer. Extend-only; never rename serialized fields.

export type EasingId =
  | 'linear'
  | 'easeInOutCubic'
  | 'easeOutExpo'
  | 'easeInOutSine'
  | 'spring'
  | 'bezier'

export interface Vec3 {
  x: number
  y: number
  z: number
}

export interface Rect {
  x: number
  y: number
  w: number
  h: number
}

export interface Transform {
  position: Vec3 // mm, scene units are mm
  rotation: Vec3 // degrees, XYZ order
  scale: Vec3
}

export interface Track<T> {
  keys: Keyframe<T>[]
}

export interface Keyframe<T> {
  t: number // seconds
  value: T
  easing: EasingId
  bezier?: [number, number, number, number]
}

export type Finish = 'titanium' | 'aluminum' | 'matte' | 'glossy'

export type DeviceKind = 'phone' | 'tablet' | 'laptop' | 'monitor'

export type Cutout = 'none' | 'pill' | 'notch' | 'punch-hole'

export interface DevicePreset {
  id: string
  label: string
  kind: DeviceKind
  /** CSS viewport the screen source should use */
  viewport: { w: number; h: number }
  /** physical body size in mm (w × h × d), bezels in mm */
  body: { w: number; h: number; d: number; bezelX: number; bezelY: number; cornerRadius: number }
  cutout: Cutout
  sideButtons?: { volume: boolean; power: boolean }
  backCamera?: boolean
  /** laptop: diagonal size in inches of the screen; monitor: stand height mm */
  lid?: { hingeAtBack: true }
  standHeightMm?: number
  defaultFinish: Finish
  defaultColor: string
  mobileEmulation: boolean
}

export interface WalkthroughStepWait {
  type: 'wait'
  ms: number
}
export interface WalkthroughStepScroll {
  type: 'scroll'
  toY: number
  durationMs: number
  easing: EasingId
}
export interface WalkthroughStepScrollToSelector {
  type: 'scrollToSelector'
  selector: string
  durationMs: number
  easing: EasingId
}
export interface WalkthroughStepTap {
  type: 'tap'
  x: number
  y: number
  showRipple: boolean
}
export interface WalkthroughStepTapSelector {
  type: 'tapSelector'
  selector: string
  showRipple: boolean
}
export interface WalkthroughStepType {
  type: 'type'
  selector: string
  text: string
  cpm: number
}

export type WalkthroughStep =
  | WalkthroughStepWait
  | WalkthroughStepScroll
  | WalkthroughStepScrollToSelector
  | WalkthroughStepTap
  | WalkthroughStepTapSelector
  | WalkthroughStepType

export type ScreenSource =
  | {
      kind: 'none'
    }
  | {
      kind: 'url'
      url: string
      viewport: { w: number; h: number; dpr: number }
      mobileEmulation: boolean
      walkthrough?: WalkthroughStep[]
      takeId?: string
    }
  | { kind: 'capture'; sourceId: string; crop?: Rect; takeId?: string }
  | { kind: 'image'; mediaId: string; fit: 'fill' | 'fit' | 'crop'; crop?: Rect }
  | {
      kind: 'video'
      mediaId: string
      fit: 'fill' | 'fit' | 'crop'
      trimIn: number
      trimOut: number
      rate: number
      loop: boolean
      offsetSec: number
    }

export interface DeviceInstance {
  id: string
  presetId: string
  /** custom GLB device import: relative media id of the model file */
  customModelMediaId?: string
  material: { finish: Finish; color: string }
  transform: Track<Transform>
  screen: ScreenSource
  screenGlare: number // 0..1
  cutout: Cutout
  lidAngleDeg?: Track<number> // laptops only, 0 = closed, 105 = open
}

export interface EnvironmentSettings {
  id:
    | 'studio-gradient'
    | 'floating-void'
    | 'reflective-floor'
    | 'light-box'
    | 'dark-cinematic'
    | 'brand-color'
    | 'transparent'
  colorA: string // primary gradient / floor / brand color
  colorB: string // secondary
  colorC: string // tertiary (brand mode)
  hdriId?: string // optional bundled HDRI
}

export interface CameraTrack {
  position: Track<Vec3>
  target: Track<Vec3>
  fov: Track<number>
  focusDistance: Track<number>
  aperture: Track<number>
}

export type TextOverlayKind = 'title' | 'caption' | 'label-arrow'

export interface TextOverlay {
  id: string
  kind: TextOverlayKind
  text: string
  font: 'Inter' | 'IBMPlexSansArabic' | 'Cairo'
  fontSizePx: number
  color: string
  /** normalized position on frame, 0..1, y from top */
  x: number
  y: number
  align: 'start' | 'center' | 'end'
  /** animation timing on the scene timeline, seconds */
  inAt: number
  outAt: number
  inAnim: 'none' | 'fade' | 'slide-up' | 'slide-down' | 'typewriter'
  outAnim: 'none' | 'fade'
  rtl?: boolean
}

export interface AudioTrack {
  mediaId: string
  trimIn: number
  trimOut: number
  volume: number // 0..1
  fadeIn: number // seconds
  fadeOut: number
  offsetSec: number
}

export interface PostFxSettings {
  depthOfField: boolean
  bloom: boolean
  bloomStrength: number
  vignette: boolean
  filmGrain: boolean
}

export interface Scene {
  id: string
  name: string
  durationSec: number // 3–60
  fps: 24 | 30 | 60
  devices: DeviceInstance[] // max 4
  environment: EnvironmentSettings
  camera: CameraTrack
  overlays: TextOverlay[]
  audio?: AudioTrack
  postFx: PostFxSettings
}

export type ExportFormat =
  | 'mp4-h264'
  | 'mp4-hevc'
  | 'mov-prores4444'
  | 'webm-vp9-alpha'
  | 'gif'
  | 'png-seq'
  | 'png-still'

export type ExportQuality = 'fast' | 'high' | 'max'

export interface ExportSettings {
  name: string
  width: number
  height: number
  fps: 24 | 30 | 60
  format: ExportFormat
  quality: ExportQuality
  transparentBackground: boolean
  motionBlurSamples: 0 | 4 | 8 | 16
  /** optional per-aspect camera offset (batch export reframing) */
  cameraOffset?: { position: Vec3; target: Vec3 }
}

export interface MediaEntry {
  id: string
  name: string
  kind: 'image' | 'video' | 'audio' | 'model'
  ext: string
  mime: string
  width?: number
  height?: number
  durationSec?: number
  bytes: number
}

export interface TakeEntry {
  id: string
  deviceId: string
  url: string
  width: number
  height: number
  fps: number
  durationSec: number
  createdAt: string
}

export interface Project {
  schemaVersion: 1
  id: string
  name: string
  scenes: Scene[]
  exportPresets: ExportSettings[]
  media: MediaEntry[]
  takes: TakeEntry[]
  createdAt: string
  updatedAt: string
}

// ---------- runtime (non-serialized) ----------

export interface MediaPickedPayload {
  mediaId: string
  name: string
  kind: MediaEntry['kind']
  width?: number
  height?: number
  durationSec?: number
}

export interface ExportProgress {
  jobId: string
  frame: number
  totalFrames: number
  fps: number
  stage: 'rendering' | 'encoding' | 'muxing' | 'verifying' | 'done' | 'error'
  message?: string
  outputPath?: string
}

export type TakeStatus =
  | { state: 'idle' }
  | { state: 'recording'; elapsedMs: number }
  | { state: 'recorded'; takeId: string; durationSec: number }
  | { state: 'error'; message: string }

/** One throttled frame of an offscreen live page, sent to the renderer. */
export interface LiveFramePayload {
  sourceKey: string
  width: number
  height: number
  /** RGBA bytes, length = width * height * 4 */
  data: ArrayBuffer
  /** full-frame metadata; renderer should mark texture dirty */
  frameId: number
  pageScrollY: number
  pageHeight: number
}

export interface LivePageInfo {
  sourceKey: string
  title: string
  url: string
  scrollY: number
  scrollHeight: number
  viewportW: number
  viewportH: number
  loadOk: boolean
  error?: string
}
