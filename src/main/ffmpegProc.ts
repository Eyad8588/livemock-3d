// Bundled ffmpeg/ffprobe binary resolution (static imports; binaries ship in
// node_modules and are packaged via electron-builder asarUnpack).

import * as fs from 'node:fs'
import ffmpegStatic from 'ffmpeg-static'
import ffprobeStatic from 'ffprobe-static'

function resolveFfmpeg(): string | null {
  const mod = ffmpegStatic as unknown as string | { default?: string }
  const p = typeof mod === 'string' ? mod : (mod?.default ?? null)
  return p && fs.existsSync(p) ? p : null
}

function resolveFfprobe(): string | null {
  const mod = ffprobeStatic as unknown as { path?: string; default?: { path?: string } }
  const p = mod?.path ?? mod?.default?.path ?? null
  return p && fs.existsSync(p) ? p : null
}

let ffmpegCache: string | null | undefined
let ffprobeCache: string | null | undefined

export function ffmpegPath(): string | null {
  ffmpegCache ??= resolveFfmpeg()
  return ffmpegCache
}

export function ffprobePath(): string | null {
  ffprobeCache ??= resolveFfprobe()
  return ffprobeCache
}
