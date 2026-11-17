import type { DevicePreset, ExportSettings, EnvironmentSettings } from './types'

export const DEVICE_PRESETS: DevicePreset[] = [
  {
    id: 'phone-6.9',
    label: 'Phone 6.9"',
    kind: 'phone',
    viewport: { w: 440, h: 956 },
    body: { w: 77.6, h: 163.0, d: 8.3, bezelX: 3.2, bezelY: 3.4, cornerRadius: 13.5 },
    cutout: 'pill',
    sideButtons: { volume: true, power: true },
    backCamera: true,
    defaultFinish: 'titanium',
    defaultColor: '#4a4a4f',
    mobileEmulation: true
  },
  {
    id: 'phone-6.3',
    label: 'Phone 6.3"',
    kind: 'phone',
    viewport: { w: 402, h: 874 },
    body: { w: 71.6, h: 150.9, d: 8.1, bezelX: 3.1, bezelY: 3.3, cornerRadius: 12.5 },
    cutout: 'pill',
    sideButtons: { volume: true, power: true },
    backCamera: true,
    defaultFinish: 'aluminum',
    defaultColor: '#3c3c40',
    mobileEmulation: true
  },
  {
    id: 'phone-android-6.7',
    label: 'Android 6.7"',
    kind: 'phone',
    viewport: { w: 412, h: 915 },
    body: { w: 75.0, h: 160.8, d: 8.8, bezelX: 3.4, bezelY: 3.6, cornerRadius: 11.0 },
    cutout: 'punch-hole',
    sideButtons: { volume: true, power: true },
    backCamera: true,
    defaultFinish: 'glossy',
    defaultColor: '#2f3237',
    mobileEmulation: true
  },
  {
    id: 'tablet-13',
    label: 'Tablet 13"',
    kind: 'tablet',
    viewport: { w: 1032, h: 1376 },
    body: { w: 215.6, h: 289.6, d: 5.8, bezelX: 8.6, bezelY: 9.4, cornerRadius: 14.0 },
    cutout: 'none',
    sideButtons: { volume: true, power: true },
    backCamera: true,
    defaultFinish: 'aluminum',
    defaultColor: '#54555a',
    mobileEmulation: true
  },
  {
    id: 'tablet-11',
    label: 'Tablet 11"',
    kind: 'tablet',
    viewport: { w: 834, h: 1210 },
    body: { w: 178.5, h: 247.5, d: 5.9, bezelX: 8.4, bezelY: 9.2, cornerRadius: 13.0 },
    cutout: 'none',
    sideButtons: { volume: true, power: true },
    backCamera: true,
    defaultFinish: 'aluminum',
    defaultColor: '#4d4e53',
    mobileEmulation: true
  },
  {
    id: 'laptop-14',
    label: 'Laptop 14"',
    kind: 'laptop',
    viewport: { w: 1512, h: 982 },
    body: { w: 312.6, h: 221.2, d: 15.5, bezelX: 5.2, bezelY: 5.2, cornerRadius: 8.0 },
    cutout: 'notch',
    sideButtons: { volume: false, power: false },
    backCamera: false,
    lid: { hingeAtBack: true },
    standHeightMm: 0,
    defaultFinish: 'aluminum',
    defaultColor: '#8e9096',
    mobileEmulation: false
  },
  {
    id: 'laptop-16',
    label: 'Laptop 16"',
    kind: 'laptop',
    viewport: { w: 1728, h: 1117 },
    body: { w: 355.4, h: 248.1, d: 16.8, bezelX: 5.4, bezelY: 5.4, cornerRadius: 8.5 },
    cutout: 'notch',
    sideButtons: { volume: false, power: false },
    backCamera: false,
    lid: { hingeAtBack: true },
    standHeightMm: 0,
    defaultFinish: 'aluminum',
    defaultColor: '#2e2f33',
    mobileEmulation: false
  },
  {
    id: 'monitor-27',
    label: 'Monitor 27"',
    kind: 'monitor',
    viewport: { w: 2560, h: 1440 },
    body: { w: 612.4, h: 356.4, d: 22.0, bezelX: 8.0, bezelY: 8.0, cornerRadius: 10.0 },
    cutout: 'none',
    sideButtons: { volume: false, power: false },
    backCamera: false,
    standHeightMm: 160,
    defaultFinish: 'aluminum',
    defaultColor: '#b8bcc2',
    mobileEmulation: false
  }
]

// GLB-backed presets: load user-provided models from assets/models
// (see assets/models/README.md). They behave like built-ins everywhere.
export const GLB_DEVICE_PRESETS: DevicePreset[] = [
  {
    id: 'glb-iphone-17-pro-max',
    label: 'iPhone 17 Pro Max (GLB)',
    kind: 'phone',
    viewport: { w: 440, h: 956 },
    body: { w: 77.6, h: 163.0, d: 8.25, bezelX: 3.2, bezelY: 3.4, cornerRadius: 13.5 },
    cutout: 'none',
    defaultFinish: 'titanium',
    defaultColor: '#3a3c40',
    mobileEmulation: true,
    modelFile: 'phone_17_pro_max.glb',
    modelRotationYDeg: 180,
    targetSizeMm: { w: 77.6, h: 163.0, d: 8.25 },
    screenCornerRadiusMm: 9.2
  },
  {
    id: 'glb-macbook-16',
    label: 'MacBook Pro 16" (GLB)',
    kind: 'laptop',
    viewport: { w: 1728, h: 1117 },
    body: { w: 355.4, h: 248.1, d: 16.8, bezelX: 5.4, bezelY: 5.4, cornerRadius: 8.5 },
    cutout: 'none',
    lid: { hingeAtBack: true },
    defaultFinish: 'aluminum',
    defaultColor: '#2e2f33',
    mobileEmulation: false,
    modelFile: 'macbook_pro_m3_16_inch_2024.glb',
    targetSizeMm: { w: 355.4, h: 248.1, d: 16.8 },
    screenCornerRadiusMm: 2.5
  }
]

export function allDevicePresets(): DevicePreset[] {
  return [...DEVICE_PRESETS, ...GLB_DEVICE_PRESETS]
}

export function getPreset(presetId: string): DevicePreset {
  const all = [...DEVICE_PRESETS, ...GLB_DEVICE_PRESETS]
  const p = all.find((x) => x.id === presetId)
  if (!p) throw new Error(`Unknown device preset: ${presetId}`)
  return p
}

export const DEFAULT_ENVIRONMENT: EnvironmentSettings = {
  id: 'studio-gradient',
  colorA: '#c9ccd4',
  colorB: '#8a8f9c',
  colorC: '#ffffff'
}

export const ASPECT_PRESETS: { id: string; label: string; width: number; height: number }[] = [
  { id: '9:16', label: '9:16 — Reels / TikTok / Shorts', width: 1080, height: 1920 },
  { id: '1:1', label: '1:1 — Feed', width: 1080, height: 1080 },
  { id: '4:5', label: '4:5 — Portrait feed', width: 1080, height: 1350 },
  { id: '16:9', label: '16:9 — YouTube', width: 1920, height: 1080 },
  { id: '16:9-4k', label: '16:9 — 4K', width: 3840, height: 2160 }
]

export const EXPORT_FORMATS: {
  id: ExportSettings['format']
  label: string
  ext: string
  supportsAlpha: boolean
  via: 'webcodecs' | 'ffmpeg'
}[] = [
  { id: 'mp4-h264', label: 'MP4 (H.264)', ext: 'mp4', supportsAlpha: false, via: 'webcodecs' },
  { id: 'mp4-hevc', label: 'MP4 (HEVC)', ext: 'mp4', supportsAlpha: false, via: 'webcodecs' },
  { id: 'mov-prores4444', label: 'MOV — ProRes 4444 with alpha', ext: 'mov', supportsAlpha: true, via: 'ffmpeg' },
  { id: 'webm-vp9-alpha', label: 'WebM — VP9 with alpha', ext: 'webm', supportsAlpha: true, via: 'ffmpeg' },
  { id: 'gif', label: 'GIF', ext: 'gif', supportsAlpha: false, via: 'ffmpeg' },
  { id: 'png-seq', label: 'PNG sequence', ext: 'png', supportsAlpha: true, via: 'ffmpeg' },
  { id: 'png-still', label: 'PNG still frame', ext: 'png', supportsAlpha: true, via: 'ffmpeg' }
]

export const QUALITY_LABEL: Record<ExportSettings['quality'], string> = {
  fast: 'Fast (larger file)',
  high: 'High (recommended)',
  max: 'Maximum (slow, CRF 16)'
}

export const MODE_IDS = [
  'cinematic-hero',
  'spin-reveal',
  'float-tilt',
  'zoom-detail',
  'auto-walkthrough',
  'device-flip',
  'side-by-side',
  'carousel',
  'laptop-open'
] as const

export type ModeId = (typeof MODE_IDS)[number]

export const MODE_LABELS: Record<ModeId, string> = {
  'cinematic-hero': 'Cinematic Hero',
  'spin-reveal': 'Spin Reveal',
  'float-tilt': 'Float & Tilt',
  'zoom-detail': 'Zoom to Detail',
  'auto-walkthrough': 'Auto Walkthrough',
  'device-flip': 'Device Flip',
  'side-by-side': 'Side by Side',
  carousel: 'Carousel',
  'laptop-open': 'Laptop Open'
}

export const SCHEMA_VERSION = 1 as const
