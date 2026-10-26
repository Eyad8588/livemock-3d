// Media probing: pure header parsing for images + ffprobe for A/V.

import { buildFfprobeArgs } from '../shared/exportUtils'

export interface ImageDim {
  width: number
  height: number
}

/** Parse PNG/JPEG/WebP/GIF headers. Returns null when unrecognized. */
export function probeImageFile(buf: Buffer): ImageDim | null {
  try {
    if (buf.length >= 33 && buf.readUInt32BE(0) === 0x89504e47) {
      return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) } // IHDR
    }
    if (buf.length >= 10 && buf.toString('ascii', 0, 3) === 'GIF') {
      return { width: buf.readUInt16LE(6), height: buf.readUInt16LE(8) }
    }
    if (buf.length >= 12 && buf.toString('ascii', 0, 4) === 'RIFF' && buf.toString('ascii', 8, 12) === 'WEBP') {
      const fourcc = buf.toString('ascii', 12, 16)
      if (fourcc === 'VP8X' && buf.length >= 30) {
        const w = 1 + ((buf[24]! | (buf[25]! << 8) | (buf[26]! << 16)) & 0xffffff)
        const h = 1 + ((buf[27]! | (buf[28]! << 8) | (buf[29]! << 16)) & 0xffffff)
        return { width: w, height: h }
      }
      if (fourcc === 'VP8 ' && buf.length >= 30) {
        return { width: buf.readUInt16LE(26) & 0x3fff, height: buf.readUInt16LE(28) & 0x3fff }
      }
      if (fourcc === 'VP8L' && buf.length >= 25) {
        const b = buf.readUInt32LE(21)
        return { width: (b & 0x3fff) + 1, height: ((b >> 14) & 0x3fff) + 1 }
      }
    }
    if (buf.length >= 4 && buf[0] === 0xff && buf[1] === 0xd8) {
      // JPEG: scan segments for SOFn
      let off = 2
      while (off + 9 < buf.length) {
        if (buf[off] !== 0xff) {
          off++
          continue
        }
        const marker = buf[off + 1]!
        if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
          return { height: buf.readUInt16BE(off + 5), width: buf.readUInt16BE(off + 7) }
        }
        const len = buf.readUInt16BE(off + 2)
        off += 2 + len
      }
    }
  } catch {
    /* fallthrough */
  }
  return null
}

export interface AvProbe {
  width?: number
  height?: number
  durationSec?: number
  fps?: number
  codec?: string
}

export async function probeWithFfprobe(file: string): Promise<AvProbe | null> {
  const { ffprobePath } = await import('./ffmpegProc')
  const bin = ffprobePath()
  if (!bin) return null
  const { spawn } = await import('node:child_process')
  return new Promise((resolve) => {
    const p = spawn(bin, buildFfprobeArgs(file), { stdio: ['ignore', 'pipe', 'ignore'] })
    let out = ''
    p.stdout.on('data', (d: Buffer) => (out += d.toString()))
    p.on('error', () => resolve(null))
    p.on('close', (code) => {
      if (code !== 0) return resolve(null)
      try {
        const json = JSON.parse(out) as {
          streams?: {
            codec_type?: string
            width?: number
            height?: number
            avg_frame_rate?: string
            codec_name?: string
          }[]
          format?: { duration?: string }
        }
        const video = json.streams?.find((s) => s.codec_type === 'video')
        const audio = json.streams?.find((s) => s.codec_type === 'audio')
        const stream = video ?? audio
        let fps: number | undefined
        const rate = video?.avg_frame_rate
        if (rate && rate.includes('/')) {
          const [num, den] = rate.split('/').map(Number)
          if (num && den) fps = num / den
        }
        resolve({
          width: video?.width,
          height: video?.height,
          durationSec: json.format?.duration ? Number(json.format.duration) : undefined,
          fps,
          codec: stream?.codec_name
        })
      } catch {
        resolve(null)
      }
    })
  })
}
