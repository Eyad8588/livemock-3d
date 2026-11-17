// Deterministic export orchestrator (SPEC §9). Offline render loop →
// WebCodecs VideoEncoder via Mediabunny (MP4 H.264/HEVC) or bundled ffmpeg
// (ProRes 4444 alpha, VP9 alpha, GIF, PNG seq/still, H.264 fallback).

import { BufferTarget, CanvasSource, Mp4OutputFormat, Output } from 'mediabunny'
import { EXPORT_FORMATS } from '@shared/presets'
import { h264Bitrate } from '@shared/exportUtils'
import type { ExportSettings, Scene } from '@shared/types'
import { store } from '../state/store'
import { sceneController } from '../engine/view'

export interface ExportProgressInfo {
  frame: number
  totalFrames: number
  stage: 'rendering' | 'encoding' | 'saving' | 'done' | 'error'
  message?: string
  etaSec?: number
}

export class CancelledError extends Error {
  constructor() {
    super('cancelled')
  }
}

export interface ExportHandle {
  promise: Promise<{ path: string; verification?: string }>
  cancel(): void
}

/**
 * Export session: pause playback, swap every video screen to frame-exact
 * decoded textures (kept bound to the device), hide editor helpers and the
 * backdrop if transparent. Returns per-frame seek + cleanup.
 */
async function beginSession(
  settings: ExportSettings,
  scene: Scene,
  opts: { editorCamera?: boolean } = {}
): Promise<{ seek: (t: number) => Promise<void>; end: () => void }> {
  store.setPlaying(false)
  const providers: { id: string; seekExport: (t: number) => Promise<void>; endExport: () => void }[] = []
  for (const dev of scene.devices) {
    if (dev.screen.kind !== 'video') continue
    const provider = sceneController.providerFor(dev.id)
    if (!provider?.beginExport || !provider.seekExport || !provider.endExport) continue
    await provider.beginExport()
    sceneController.rebindScreen(dev.id)
    providers.push({ id: dev.id, seekExport: provider.seekExport.bind(provider), endExport: provider.endExport.bind(provider) })
  }
  sceneController.setExportMode(true, opts)
  sceneController.setBackdropVisible(!settings.transparentBackground)
  return {
    seek: async (t: number) => {
      for (const p of providers) await p.seekExport(t)
    },
    end: () => {
      sceneController.setBackdropVisible(true)
      for (const p of providers) {
        p.endExport()
        sceneController.rebindScreen(p.id)
      }
      sceneController.setExportMode(false)
    }
  }
}

async function pickFfmpegFallback(
  settings: ExportSettings,
  scene: Scene,
  onProgress: (p: ExportProgressInfo) => void,
  isCancelled: () => boolean
): Promise<{ path: string; verification?: string }> {
  // stream raw RGBA frames over IPC into the bundled ffmpeg
  const start = await window.livemock.exportFfmpegStart({ settings, scene, projectName: store.project.name })
  if ('error' in start) throw new Error(start.error)
  const jobId = start.jobId

  const done = new Promise<{ type: string; outputPath?: string; message?: string; verification?: string }>((resolve) => {
    const off = window.livemock.onExportFfmpegEvent((ev) => {
      if (ev.type === 'done' && ev.jobId === jobId) {
        off()
        resolve(ev)
      } else if (ev.type === 'error' && ev.jobId === jobId) {
        off()
        resolve(ev)
      } else if (ev.type === 'progress' && ev.jobId === jobId) {
        onProgress({ frame: ev.frames, totalFrames: ev.totalFrames, stage: 'rendering' })
      }
    })
  })

  const totalFrames = Math.max(1, Math.round(scene.durationSec * settings.fps))
  const canvas = new OffscreenCanvas(settings.width, settings.height)
  const ctx = canvas.getContext('2d', { willReadFrequently: true }) as OffscreenCanvasRenderingContext2D
  const session = await beginSession(settings, scene)
  const startedAt = performance.now()
  try {
    for (let i = 0; i < totalFrames; i++) {
      if (isCancelled()) {
        window.livemock.exportFfmpegCancel(jobId)
        throw new CancelledError()
      }
      const t = i / settings.fps
      await session.seek(t)
      sceneController.renderExportFrame(canvas, t, settings.motionBlurSamples)
      const imageData = ctx.getImageData(0, 0, settings.width, settings.height)
      window.livemock.exportFfmpegFrame(jobId, imageData.data.buffer as ArrayBuffer)
      const elapsed = (performance.now() - startedAt) / 1000
      const eta = i > 0 ? (elapsed / (i + 1)) * (totalFrames - i - 1) : undefined
      onProgress({ frame: i + 1, totalFrames, stage: 'rendering', etaSec: eta })
      // yield so IPC drains and the UI stays responsive
      if (i % 4 === 3) await new Promise((r) => setTimeout(r, 0))
    }
  } finally {
    session.end()
  }
  window.livemock.exportFfmpegEnd(jobId)

  const result = await done
  if (result.type === 'error') throw new Error(result.message)
  return { path: result.outputPath ?? '', verification: result.verification }
}

async function encodeWithWebCodecs(
  settings: ExportSettings,
  scene: Scene,
  codec: 'avc' | 'hevc',
  onProgress: (p: ExportProgressInfo) => void,
  isCancelled: () => boolean
): Promise<{ path: string; verification?: string }> {
  const width = evenDim(settings.width)
  const height = evenDim(settings.height)
  const canvas = new OffscreenCanvas(width, height)

  const output = new Output({
    format: new Mp4OutputFormat({ fastStart: 'in-memory' }),
    target: new BufferTarget()
  })
  const source = new CanvasSource(canvas, {
    codec,
    bitrate: h264Bitrate(width, height, settings.fps, settings.quality),
    keyFrameInterval: 2
  })
  output.addVideoTrack(source, { frameRate: settings.fps })
  await output.start()

  const totalFrames = Math.max(1, Math.round(scene.durationSec * settings.fps))
  const startedAt = performance.now()

  const session = await beginSession(settings, scene)
  try {
    for (let i = 0; i < totalFrames; i++) {
      if (isCancelled()) {
        await output.cancel()
        throw new CancelledError()
      }
      const t = i / settings.fps
      await session.seek(t)
      sceneController.renderExportFrame(canvas, t, settings.motionBlurSamples)
      await source.add(t, 1 / settings.fps)

      const elapsed = (performance.now() - startedAt) / 1000
      const eta = i > 0 ? (elapsed / (i + 1)) * (totalFrames - i - 1) : undefined
      onProgress({ frame: i + 1, totalFrames, stage: 'rendering', etaSec: eta })
    }
  } finally {
    session.end()
  }

  await output.finalize()
  const buffer = output.target?.buffer
  if (!buffer) throw new Error('Encoder produced no data')

  onProgress({ frame: totalFrames, totalFrames, stage: 'saving' })
  const res = await window.livemock.writeExportOutput({
    bytes: buffer,
    projectName: store.project.name,
    sceneName: scene.name,
    width,
    height,
    fps: settings.fps,
    ext: 'mp4'
  })
  if (!res.ok || !res.path) throw new Error(res.error ?? 'Failed to write output')
  return { path: res.path, verification: res.verification }
}

function evenDim(v: number): number {
  return Math.max(2, Math.round(v / 2) * 2)
}


/**
 * Export a single PNG frame of the scene at `timeSec` (default: playhead).
 * Rendered natively at full resolution — transparent background supported.
 */
export async function exportStill(
  opts: { width: number; height: number; transparentBackground: boolean; timeSec?: number; sceneName?: string; editorCamera?: boolean }
): Promise<{ path: string; verification?: string }> {
  const scene = store.scene
  const width = Math.max(16, Math.round(opts.width))
  const height = Math.max(16, Math.round(opts.height))
  const t = Math.min(scene.durationSec, Math.max(0, opts.timeSec ?? store.time))
  const settings: ExportSettings = {
    name: 'still', width, height, fps: scene.fps, format: 'png-still', quality: 'max',
    transparentBackground: opts.transparentBackground, motionBlurSamples: 0
  }
  const canvas = new OffscreenCanvas(width, height)
  const session = await beginSession(settings, scene, { editorCamera: opts.editorCamera })
  try {
    await session.seek(t)
    sceneController.renderExportFrame(canvas, t, 0)
  } finally {
    session.end()
  }
  const blob = await canvas.convertToBlob({ type: 'image/png' })
  const stamp = `${t.toFixed(2).replace('.', '_')}s`
  const res = await window.livemock.writeExportOutput({
    bytes: await blob.arrayBuffer(),
    projectName: store.project.name,
    sceneName: `${opts.sceneName ?? scene.name}_frame_${stamp}`,
    width,
    height,
    fps: scene.fps,
    ext: 'png'
  })
  if (!res.ok || !res.path) throw new Error(res.error ?? 'Failed to write PNG')
  return { path: res.path, verification: res.verification }
}

export function startExport(settings: ExportSettings, scene: Scene, onProgress: (p: ExportProgressInfo) => void): ExportHandle {
  let cancelled = false
  const isCancelled = (): boolean => cancelled

  const promise = (async (): Promise<{ path: string; verification?: string }> => {
    if (settings.format === 'png-still') {
      return await exportStill({ width: settings.width, height: settings.height, transparentBackground: settings.transparentBackground })
    }
    const via = EXPORT_FORMATS.find((f) => f.id === settings.format)?.via ?? 'ffmpeg'
    if (via === 'webcodecs') {
      // prefer hardware AVC; try HEVC if requested and supported
      let codec: 'avc' | 'hevc' = 'avc'
      if (settings.format === 'mp4-hevc') {
        try {
          const support = await VideoEncoder.isConfigSupported({
            codec: 'hvc1.1.6.L123.00',
            width: evenDim(settings.width),
            height: evenDim(settings.height),
            bitrate: 8_000_000,
            framerate: settings.fps
          })
          if (support.supported) codec = 'hevc'
        } catch {
          codec = 'avc'
        }
      }
      try {
        const support = await VideoEncoder.isConfigSupported({
          codec: codec === 'hevc' ? 'hvc1.1.6.L123.00' : 'avc1.640028',
          width: evenDim(settings.width),
          height: evenDim(settings.height),
          bitrate: h264Bitrate(settings.width, settings.height, settings.fps, settings.quality),
          framerate: settings.fps
        })
        if (support.supported) {
          return await encodeWithWebCodecs(settings, scene, codec, onProgress, isCancelled)
        }
      } catch {
        /* fall through to ffmpeg */
      }
      onProgress({ frame: 0, totalFrames: 0, stage: 'rendering', message: 'Hardware encoder unavailable — using ffmpeg fallback' })
    }
    return await pickFfmpegFallback(settings, scene, onProgress, isCancelled)
  })()

  return {
    promise,
    cancel: () => {
      cancelled = true
    }
  }
}
