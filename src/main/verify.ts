// Post-export verification, reported in plain language. Uses the bundled
// ffmpeg banner parsing (ffprobe-static ships broken binaries on some
// platforms).

import { probeWithFfmpeg } from './mediaProbe'
import type { VerifyResult } from '../shared/ipc'
import { ffmpegPath } from './ffmpegProc'

export async function verifyWithFfprobe(
  file: string,
  expect?: { width?: number; height?: number; fps?: number; durationSec?: number }
): Promise<VerifyResult> {
  if (!ffmpegPath()) {
    return { ok: false, error: 'ffmpeg unavailable', humanReport: 'Could not verify the export (ffmpeg missing).' }
  }
  const info = await probeWithFfmpeg(file)
  if (!info) {
    return { ok: false, error: 'probe failed', humanReport: 'Could not read the exported file. It may be corrupted.' }
  }
  const problems: string[] = []
  if (!info.hasVideo) problems.push('no video stream was found')
  if (expect?.width && info.width && Math.abs(info.width - expect.width) > 2) problems.push(`width is ${info.width}, expected ${expect.width}`)
  if (expect?.height && info.height && Math.abs(info.height - expect.height) > 2) problems.push(`height is ${info.height}, expected ${expect.height}`)
  if (expect?.fps && info.fps && Math.abs(info.fps - expect.fps) > 0.6) problems.push(`frame rate is ${info.fps.toFixed(2)}, expected ${expect.fps}`)
  if (expect?.durationSec && info.durationSec && Math.abs(info.durationSec - expect.durationSec) > Math.max(0.3, expect.fps ? 1 / expect.fps : 0.3)) {
    problems.push(`duration is ${info.durationSec.toFixed(2)}s, expected about ${expect.durationSec.toFixed(2)}s`)
  }
  const ok = problems.length === 0
  const fps = info.fps
  const durationSec = info.durationSec
  const humanReport = ok
    ? `Export verified: ${info.width ?? '?'}×${info.height ?? '?'}, ${fps ? fps.toFixed(2) : '?'} fps, ${durationSec ? durationSec.toFixed(2) : '?'}s.`
    : `Export finished, but: ${problems.join('; ')}. You may want to re-export.`
  return { ok, width: info.width, height: info.height, fps, durationSec, humanReport }
}
