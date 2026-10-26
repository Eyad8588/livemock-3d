// Media probing via the bundled ffmpeg binary (ffprobe-static ships broken
// binaries on some platforms, so we parse `ffmpeg -i` stderr instead).

import { spawn } from 'node:child_process'
import { ffmpegPath } from './ffmpegProc'

export interface ProbeInfo {
  width?: number
  height?: number
  durationSec?: number
  fps?: number
  codec?: string
  hasVideo?: boolean
  hasAudio?: boolean
}

/** Run `ffmpeg -i <file>` and parse the banner. Exits 1 by design. */
export function probeWithFfmpeg(file: string, timeoutMs = 15000): Promise<ProbeInfo | null> {
  const bin = ffmpegPath()
  if (!bin) return Promise.resolve(null)
  return new Promise((resolve) => {
    const p = spawn(bin, ['-hide_banner', '-i', file], { stdio: ['ignore', 'ignore', 'pipe'] })
    let err = ''
    p.stderr?.on('data', (d: Buffer) => (err += d.toString()))
    const timer = setTimeout(() => {
      p.kill('SIGKILL')
      resolve(null)
    }, timeoutMs)
    p.on('error', () => {
      clearTimeout(timer)
      resolve(null)
    })
    p.on('close', () => {
      clearTimeout(timer)
      resolve(parseFfmpegBanner(err))
    })
  })
}

/** Parse dimensions from image headers (PNG/JPEG/WebP/GIF). */
export function probeImageFile(buf: Buffer): { width: number; height: number } | null {
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

export function parseFfmpegBanner(banner: string): ProbeInfo | null {
  try {
    const durMatch = banner.match(/Duration:\s*(\d+):(\d+):(\d+\.?\d*)/)
    let durationSec: number | undefined
    if (durMatch) {
      durationSec = Number(durMatch[1]) * 3600 + Number(durMatch[2]) * 60 + Number(durMatch[3])
    }
    const videoLine = banner.split('\n').find((l) => l.includes('Video:'))
    const audioLine = banner.split('\n').find((l) => l.includes('Audio:'))
    if (!videoLine && !audioLine) return null
    const info: ProbeInfo = { hasVideo: !!videoLine, hasAudio: !!audioLine, durationSec }
    if (videoLine) {
      const codec = videoLine.match(/Video:\s*([a-zA-Z0-9_]+)/)
      if (codec) info.codec = codec[1]
      const res = videoLine.match(/(\d{2,5})x(\d{2,5})/)
      if (res) {
        info.width = Number(res[1])
        info.height = Number(res[2])
      }
      const fps = videoLine.match(/([\d.]+)\s*fps/) ?? videoLine.match(/([\d.]+)\s*tbr/)
      if (fps) info.fps = Number(fps[1])
    }
    if (audioLine) {
      const codec = audioLine.match(/Audio:\s*([a-zA-Z0-9_]+)/)
      if (codec && !info.codec) info.codec = codec[1]
    }
    return info
  } catch {
    return null
  }
}
