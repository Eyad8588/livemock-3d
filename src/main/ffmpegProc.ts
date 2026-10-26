// Bundled ffmpeg/ffprobe binary resolution (static imports; binaries ship in
// node_modules and are packaged via electron-builder asarUnpack).

import * as fs from 'node:fs'
import ffmpegStatic from 'ffmpeg-static'

function resolveFfmpeg(): string | null {
  const mod = ffmpegStatic as unknown as string | { default?: string }
  const p = typeof mod === 'string' ? mod : (mod?.default ?? null)
  return p && fs.existsSync(p) ? p : null
}

let ffmpegCache: string | null | undefined

export function ffmpegPath(): string | null {
  ffmpegCache ??= resolveFfmpeg()
  return ffmpegCache
}

/** ffprobe is not shipped (broken upstream binaries); ffmpeg banner parsing is used instead. */
export function ffprobePath(): string | null {
  return ffmpegPath()
}
