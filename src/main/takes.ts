// Take recorder (SPEC §4.1): runs the walkthrough on a live source and pipes
// full-resolution frames straight into ffmpeg → /takes/<id>.mp4 (H.264 CRF 12).
// Deterministic exports later read the take file instead of the live page.

import { spawn, type ChildProcess } from 'node:child_process'
import * as path from 'node:path'
import * as crypto from 'node:crypto'
import { BrowserWindow } from 'electron'
import { IPC, type TakeRecordRequest } from '../shared/ipc'
import { walkthroughDurationMs } from '../shared/serialize'
import type { TakeEntry } from '../shared/types'
import { ffmpegPath } from './ffmpegProc'
import { captureLatest, invalidate, liveStart, liveStop, runWalkthrough } from './offscreen'
import { ensureWorkspace, findStoredFile, isMediaId } from './workspace'

interface TakeJob {
  sourceKey: string
  ffmpeg: ChildProcess | null
  cancelled: boolean
  timer: NodeJS.Timeout | null
}

const jobs = new Map<string, TakeJob>()

function sendToRenderer(ev: unknown): void {
  for (const win of BrowserWindow.getAllWindows()) {
    const wc = win.webContents
    if (!wc.isDestroyed() && (wc as unknown as { __isMain?: boolean }).__isMain === true) {
      wc.send(IPC.TakeEvent, ev)
    }
  }
}

export function hasTake(takeId: string): boolean {
  return findStoredFile('take', takeId) !== null
}

export function takeFilePath(takeId: string): string | null {
  return findStoredFile('take', takeId)
}

/**
 * Record a take. Frames are captured at `req.fps` by forcing repaints and
 * grabbing the latest paint. The walkthrough runs in real time.
 */
export function recordTake(req: TakeRecordRequest): void {
  if (jobs.has(req.sourceKey)) return
  const ffmpegBin = ffmpegPath()
  if (!ffmpegBin) {
    sendToRenderer({ type: 'error', sourceKey: req.sourceKey, message: 'ffmpeg not found on this machine' })
    return
  }
  const ws = ensureWorkspace('__default__')
  const takeId = crypto.createHash('sha1').update(`${req.url}|${Date.now()}|${Math.random()}`).digest('hex')
  const outPath = path.join(ws.takesDir, `${takeId}.mp4`)

  liveStart({ sourceKey: req.sourceKey, url: req.url, viewport: req.viewport, mobileEmulation: req.mobileEmulation })

  // let the page load, then start
  const job: TakeJob = { sourceKey: req.sourceKey, ffmpeg: null, cancelled: false, timer: null }
  jobs.set(req.sourceKey, job)

  const startDelayMs = 1200
  let elapsed = 0
  const totalWalkMs = Math.max(3000, walkthroughDurationMs(req.walkthrough))
  const totalMs = totalWalkMs + 800

  const frameInterval = 1000 / req.fps
  let frames = 0

  setTimeout(async () => {
    const ffmpegBin2 = ffmpegPath()
    if (!ffmpegBin2 || job.cancelled) return
    const ff = spawn(
      ffmpegBin2,
      [
        '-y', '-hide_banner',
        '-f', 'rawvideo', '-pixel_format', 'rgba',
        '-video_size', `${req.viewport.w}x${req.viewport.h}`,
        '-framerate', String(req.fps),
        '-i', 'pipe:0',
        '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '12',
        '-pix_fmt', 'yuv420p',
        '-movflags', '+faststart',
        outPath
      ],
      { stdio: ['pipe', 'ignore', 'pipe'] }
    )
    job.ffmpeg = ff
    let errOut = ''
    ff.stderr.on('data', (d: Buffer) => {
      errOut += d.toString()
      if (errOut.length > 8000) errOut = errOut.slice(-4000)
    })
    ff.on('error', (err) => {
      sendToRenderer({ type: 'error', sourceKey: req.sourceKey, message: `ffmpeg failed to start: ${err.message}` })
    })
    ff.on('close', (code) => {
      jobs.delete(req.sourceKey)
      liveStop(req.sourceKey)
      if (job.cancelled) {
        sendToRenderer({ type: 'error', sourceKey: req.sourceKey, message: 'Take cancelled' })
        return
      }
      if (code !== 0 && frames === 0) {
        sendToRenderer({ type: 'error', sourceKey: req.sourceKey, message: `ffmpeg exited ${code}: ${errOut.slice(-400)}` })
        return
      }
      const durationSec = frames / req.fps
      const take: TakeEntry = {
        id: takeId,
        deviceId: req.deviceId,
        url: req.url,
        width: req.viewport.w,
        height: req.viewport.h,
        fps: req.fps,
        durationSec,
        createdAt: new Date().toISOString()
      }
      sendToRenderer({ type: 'done', sourceKey: req.sourceKey, take })
    })

    // capture loop: force repaint at fps, write latest frame
    const startedAt = Date.now()
    job.timer = setInterval(() => {
      if (job.cancelled) {
        cleanup()
        return
      }
      invalidate(req.sourceKey)
      const latest = captureLatest(req.sourceKey)
      if (latest && latest.width === req.viewport.w && latest.height === req.viewport.h) {
        const buf = latest.image.toBitmap()
        swizzleBgraToRgba(buf)
        if (ff.stdin && ff.stdin.writable) {
          frames++
          if (!ff.stdin.write(buf)) {
            ff.stdin.once('drain', () => undefined)
          }
        }
      }
      elapsed = Date.now() - startedAt
      sendToRenderer({ type: 'progress', sourceKey: req.sourceKey, elapsedMs: elapsed, frames })
      if (elapsed >= totalMs) {
        cleanup()
      }
    }, frameInterval)

    // run walkthrough concurrently so the page motion is captured
    void runWalkthrough(req.sourceKey, req.walkthrough, () => invalidate(req.sourceKey)).catch(() => undefined)
  }, startDelayMs)

  function cleanup(): void {
    if (job.timer) clearInterval(job.timer)
    job.timer = null
    try {
      ffStdinEnd()
    } catch {
      /* ignore */
    }
  }
  function ffStdinEnd(): void {
    const ff = job.ffmpeg
    if (ff && ff.stdin && ff.stdin.writable) ff.stdin.end()
  }
}

function swizzleBgraToRgba(buf: Buffer): void {
  const n = buf.length
  for (let i = 0; i < n; i += 4) {
    const b = buf[i]!
    buf[i] = buf[i + 2]!
    buf[i + 2] = b
  }
}

export function cancelTake(sourceKey: string): void {
  const job = jobs.get(sourceKey)
  if (!job) return
  job.cancelled = true
  if (job.timer) clearInterval(job.timer)
  try {
    job.ffmpeg?.stdin?.end()
    job.ffmpeg?.kill('SIGKILL')
  } catch {
    /* ignore */
  }
  jobs.delete(sourceKey)
  liveStop(sourceKey)
}

export function cancelAllTakes(): void {
  for (const key of [...jobs.keys()]) cancelTake(key)
}

/** Validate a take id before using it in a path context. */
export { isMediaId }
