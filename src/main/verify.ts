// Post-export verification with ffprobe, reported in plain language.

import { spawn } from 'node:child_process'
import { buildFfprobeArgs } from '../shared/exportUtils'
import type { VerifyResult } from '../shared/ipc'
import { ffprobePath } from './ffmpegProc'

export async function verifyWithFfprobe(file: string, expect?: { width?: number; height?: number; fps?: number; durationSec?: number }): Promise<VerifyResult> {
  const bin = ffprobePath()
  if (!bin) {
    return { ok: false, error: 'ffprobe unavailable', humanReport: 'Could not verify the export (ffprobe missing).' }
  }
  const out = await new Promise<string | null>((resolve) => {
    const p = spawn(bin, buildFfprobeArgs(file), { stdio: ['ignore', 'pipe', 'ignore'] })
    let data = ''
    p.stdout.on('data', (d: Buffer) => (data += d.toString()))
    p.on('error', () => resolve(null))
    p.on('close', (code) => resolve(code === 0 ? data : null))
  })
  if (!out) {
    return { ok: false, error: 'ffprobe failed', humanReport: 'Could not read the exported file. It may be corrupted.' }
  }
  try {
    const json = JSON.parse(out) as {
      streams?: { codec_type?: string; width?: number; height?: number; avg_frame_rate?: string; nb_frames?: string }[]
      format?: { duration?: string; size?: string }
    }
    const video = json.streams?.find((s) => s.codec_type === 'video')
    const fps = parseRate(video?.avg_frame_rate)
    const durationSec = json.format?.duration ? Number(json.format.duration) : undefined
    const problems: string[] = []
    if (!video) problems.push('no video stream was found')
    if (expect?.width && video?.width && Math.abs(video.width - expect.width) > 2) problems.push(`width is ${video.width}, expected ${expect.width}`)
    if (expect?.height && video?.height && Math.abs(video.height - expect.height) > 2) problems.push(`height is ${video.height}, expected ${expect.height}`)
    if (expect?.fps && fps && Math.abs(fps - expect.fps) > 0.5) problems.push(`frame rate is ${fps.toFixed(2)}, expected ${expect.fps}`)
    if (expect?.durationSec && durationSec && Math.abs(durationSec - expect.durationSec) > Math.max(0.3, expect.fps ? 1 / expect.fps : 0.3)) {
      problems.push(`duration is ${durationSec.toFixed(2)}s, expected about ${expect.durationSec.toFixed(2)}s`)
    }
    const ok = problems.length === 0
    const humanReport = ok
      ? `Export verified: ${video?.width ?? '?'}×${video?.height ?? '?'}, ${fps ? fps.toFixed(2) : '?'} fps, ${durationSec ? durationSec.toFixed(2) : '?'}s.`
      : `Export finished, but: ${problems.join('; ')}. You may want to re-export.`
    return { ok, width: video?.width, height: video?.height, fps, durationSec, humanReport }
  } catch (err) {
    return { ok: false, error: String(err), humanReport: 'Could not parse verification output.' }
  }
}

function parseRate(rate?: string): number | undefined {
  if (!rate || !rate.includes('/')) return undefined
  const [num, den] = rate.split('/').map(Number)
  if (!num || !den) return undefined
  return num / den
}
