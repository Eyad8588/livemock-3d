// Pure export helpers shared between main (ffmpeg) and renderer (WebCodecs).
// Kept free of any Electron/three imports so unit tests run in plain node.

import type { ExportSettings } from './types'

export function sanitizeNamePart(name: string): string {
  return (
    name
      .replace(/[\\/:*?"<>|]+/g, '_')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 80) || 'untitled'
  )
}

export function buildExportFilename(
  projectName: string,
  sceneName: string,
  width: number,
  height: number,
  fps: number,
  ext: string
): string {
  return `${sanitizeNamePart(projectName)}_${sanitizeNamePart(sceneName)}_${width}x${height}_${fps}.${ext}`
}

const X264_PRESET: Record<ExportSettings['quality'], string> = {
  fast: 'veryfast',
  high: 'medium',
  max: 'slow'
}
const X264_CRF: Record<ExportSettings['quality'], string> = {
  fast: '23',
  high: '19',
  max: '16'
}

/** Approximate target bitrate in bits/s for WebCodecs encoders. */
export function h264Bitrate(width: number, height: number, fps: number, quality: ExportSettings['quality']): number {
  const px = width * height
  const base = px * fps * 0.09 // bits per pixel-second heuristic
  const q = quality === 'fast' ? 0.75 : quality === 'high' ? 1 : 1.4
  return Math.min(80_000_000, Math.max(2_000_000, Math.round(base * q)))
}

export interface FfmpegInputOptions {
  /** rawvideo input size; omit when frames are pre-encoded (png) */
  frameFormat: 'rgba' | 'png'
  width: number
  height: number
  fps: number
  /** pipe:0 or a raw temp file path */
  inputPath: string
  audioPath?: string
  audioTrim?: { in: number; out: number; fadeIn: number; fadeOut: number; volume: number }
  transparent: boolean
  quality: ExportSettings['quality']
  stillOnly?: boolean
}

/**
 * Builds the ffmpeg argument vector for ffmpeg-backed export formats.
 * `format` is one of mov-prores4444 | webm-vp9-alpha | gif | png-seq | png-still,
 * plus mp4-h264 fallback.
 */
export function buildFfmpegArgs(format: ExportSettings['format'], o: FfmpegInputOptions): string[] {
  const args: string[] = ['-y', '-hide_banner']
  if (o.frameFormat === 'rgba') {
    args.push('-f', 'rawvideo', '-pixel_format', o.transparent ? 'rgba' : 'rgb24')
    args.push('-video_size', `${o.width}x${o.height}`, '-framerate', String(o.fps))
  }
  args.push('-i', o.inputPath)
  if (o.audioPath) {
    args.push('-ss', String(o.audioTrim?.in ?? 0), '-i', o.audioPath)
    const fadeOutStart = Math.max(0, (o.audioTrim?.out ?? 0) - (o.audioTrim?.fadeOut ?? 0))
    if ((o.audioTrim?.fadeIn ?? 0) > 0) args.push('-af', `afade=t=in:st=0:d=${o.audioTrim!.fadeIn}`)
    if ((o.audioTrim?.fadeOut ?? 0) > 0) {
      const af = `afade=t=in:st=0:d=${o.audioTrim!.fadeIn},afade=t=out:st=${fadeOutStart}:d=${o.audioTrim!.fadeOut}`
      args.push('-af', af)
    }
    args.push('-t', String(Math.max(0.1, (o.audioTrim?.out ?? 0) - (o.audioTrim?.in ?? 0))))
  }

  switch (format) {
    case 'mp4-h264':
      args.push('-c:v', 'libx264', '-preset', X264_PRESET[o.quality], '-crf', X264_CRF[o.quality])
      args.push('-pix_fmt', 'yuv420p', '-movflags', '+faststart')
      if (o.audioPath) args.push('-c:a', 'aac', '-b:a', '192k')
      break
    case 'mov-prores4444':
      args.push('-c:v', 'prores_ks', '-profile:v', '4', '-vendor', 'apl0', '-pix_fmt', 'yuva444p10le')
      if (o.audioPath) args.push('-c:a', 'pcm_s16le')
      break
    case 'webm-vp9-alpha':
      args.push('-c:v', 'libvpx-vp9', '-pix_fmt', 'yuva420p', '-b:v', '0', '-crf', o.quality === 'max' ? '24' : o.quality === 'high' ? '30' : '34', '-row-mt', '1', '-deadline', o.quality === 'max' ? 'best' : 'good', '-cpu-used', o.quality === 'fast' ? '4' : '2')
      if (o.audioPath) args.push('-c:a', 'libopus', '-b:a', '160k')
      break
    case 'gif':
      // single-pass palette approximation (per-frame palette avoids two-pass complexity)
      args.push('-vf', 'split[s0][s1];[s0]palettegen=stat_mode=diff[p];[s1][p]paletteuse=dither=bayer:bayer_scale=3')
      args.push('-loop', '0')
      break
    case 'png-seq':
      args.push('-c:v', 'png')
      break
    case 'png-still':
      args.push('-frames:v', '1')
      break
    default:
      throw new Error(`buildFfmpegArgs: unsupported format ${format}`)
  }
  if (o.stillOnly && format !== 'png-still') args.push('-frames:v', '1')
  return args
}

/** ffprobe argument vector returning JSON. */
export function buildFfprobeArgs(path: string): string[] {
  return [
    '-v', 'error',
    '-print_format', 'json',
    '-show_format', '-show_streams',
    path
  ]
}
