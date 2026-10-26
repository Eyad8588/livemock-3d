// ffmpeg-backed export pipeline (SPEC §9). The renderer renders frames
// deterministically and streams them over a MessagePort; main pipes them into
// the bundled ffmpeg and reports progress. Handles MOV ProRes 4444 (alpha),
// WebM VP9 (alpha), GIF, PNG sequence/still, and the H.264 fallback.

import { spawn, type ChildProcess } from 'node:child_process'
import * as fs from 'node:fs'
import * as path from 'node:path'
import { BrowserWindow, ipcMain, type MessagePortMain, type WebContents } from 'electron'
import { IPC, type ExportFfmpegEvent } from '../shared/ipc'
import { buildFfmpegArgs, buildExportFilename } from '../shared/exportUtils'
import type { ExportSettings, Scene } from '../shared/types'
import { ffmpegPath } from './ffmpegProc'

interface ExportJob {
  jobId: string
  port: MessagePortMain | null
  proc: ChildProcess | null
  cancelled: boolean
  frames: number
  totalFrames: number
  outputPath: string
}

const jobs = new Map<string, ExportJob>()
let nextJobId = 1

function sendToRenderer(ev: ExportFfmpegEvent): void {
  for (const win of BrowserWindow.getAllWindows()) {
    const wc = win.webContents
    if (!wc.isDestroyed() && (wc as unknown as { __isMain?: boolean }).__isMain === true) {
      wc.send(IPC.ExportFfmpegEvent, ev)
    }
  }
}

interface Handshake {
  type: 'start'
  settings: ExportSettings
  scene: Scene
  projectName: string
  outputPath?: string
  audioPath?: string
}
type PortMessage = Handshake | { type: 'frame'; index: number; data: ArrayBuffer } | { type: 'end' }

/**
 * MessageChannel flow:
 *  renderer: const {p1, p2} = new MessageChannel(); ipcRenderer.postMessage('export:ffmpeg-connect', null, [p2]); p1...
 *  main: receives port, waits for 'start', then 'frame' messages, then 'end'.
 */
export function registerExportIpc(): void {
  ipcMain.on('export:ffmpeg-connect', (event) => {
    const [port] = event.ports
    if (!port) return
    const jobId = String(nextJobId++)
    const job: ExportJob = { jobId, port, proc: null, cancelled: false, frames: 0, totalFrames: 0, outputPath: '' }
    jobs.set(jobId, job)

    port.on('message', (e: Electron.MessageEvent) => {
      const msg = e.data as PortMessage
      try {
        if (msg.type === 'start') void handleStart(job, msg, event.sender)
        else if (msg.type === 'frame') handleFrame(job, msg)
        else if (msg.type === 'end') handleEnd(job)
      } catch (err) {
        fail(job, err instanceof Error ? err.message : String(err))
      }
    })
    port.start()
  })
}

async function handleStart(job: ExportJob, msg: Handshake, _sender: WebContents): Promise<void> {
  const { settings, scene } = msg
  const ffmpegBin = ffmpegPath()
  if (!ffmpegBin) {
    fail(job, 'ffmpeg is not available on this machine')
    return
  }
  const ext = extFor(settings.format)
  const dir = msg.outputPath ? path.dirname(msg.outputPath) : appDownloadsDir()
  const name =
    msg.outputPath
      ? path.basename(msg.outputPath)
      : buildExportFilename(msg.projectName, scene.name, settings.width, settings.height, settings.fps, ext)
  const outputPath = path.join(dir, dedupeName(dir, name))
  job.outputPath = outputPath
  job.totalFrames =
    settings.format === 'png-still' ? 1 : Math.max(1, Math.round(scene.durationSec * settings.fps))

  // Take-based live sources must exist; if a URL source has no take yet, fail fast
  const missingTakes = scene.devices
    .filter((d) => d.screen.kind === 'url' && !d.screen.takeId)
    .map((d) => d.id)
  if (missingTakes.length > 0) {
    fail(job, 'URL sources need a recorded take before export (Record Take first)')
    return
  }

  const args = buildFfmpegArgs(settings.format, {
    frameFormat: settings.format === 'png-seq' || settings.format === 'png-still' ? 'png' : 'rgba',
    width: settings.width,
    height: settings.height,
    fps: settings.fps,
    inputPath: 'pipe:0',
    audioPath: msg.audioPath,
    audioTrim: msg.scene.audio
      ? {
          in: msg.scene.audio.trimIn,
          out: msg.scene.audio.trimOut,
          fadeIn: msg.scene.audio.fadeIn,
          fadeOut: msg.scene.audio.fadeOut,
          volume: msg.scene.audio.volume
        }
      : undefined,
    transparent: settings.transparentBackground && supportsAlpha(settings.format),
    quality: settings.quality,
    stillOnly: settings.format === 'png-still'
  })

  if (settings.format === 'png-seq') {
    // per-frame files: pattern output
    args.push(path.join(dir, replaceExt(name, '') + '_%06d.png'))
  } else {
    args.push(outputPath)
  }

  fs.mkdirSync(dir, { recursive: true })
  const proc = spawn(ffmpegBin, args, { stdio: ['pipe', 'ignore', 'pipe'] })
  job.proc = proc
  let errOut = ''
  proc.stderr.on('data', (d: Buffer) => {
    errOut += d.toString()
    if (errOut.length > 12000) errOut = errOut.slice(-6000)
  })
  proc.on('error', (err) => fail(job, `ffmpeg failed to start: ${err.message}`))
  proc.on('close', async (code) => {
    jobs.delete(job.jobId)
    job.port?.postMessage({ type: 'close' })
    if (job.cancelled) {
      sendToRenderer({ type: 'error', jobId: job.jobId, message: 'Export cancelled' })
      return
    }
    if (code !== 0 && !fs.existsSync(outputPath.replace('%06d', '000001')) && settings.format !== 'png-seq') {
      sendToRenderer({ type: 'error', jobId: job.jobId, message: `ffmpeg exited with code ${code}: ${errOut.slice(-500)}` })
      return
    }
    const { verifyWithFfprobe } = await import('./verify')
    let verification = ''
    try {
      const target = settings.format === 'png-seq' ? replaceExt(outputPath, '').replace(/%06d/, '') + '_000001.png' : outputPath
      const v = await verifyWithFfprobe(target)
      verification = v.humanReport
    } catch {
      verification = 'Verification skipped'
    }
    sendToRenderer({ type: 'done', jobId: job.jobId, outputPath, verification })
  })

  sendToRenderer({ type: 'accepted', jobId: job.jobId, outputPath })
  job.port?.postMessage({ type: 'ready', jobId: job.jobId, outputPath })
}

function handleFrame(job: ExportJob, msg: { type: 'frame'; index: number; data: ArrayBuffer }): void {
  const proc = job.proc
  if (!proc || job.cancelled) return
  const buf = Buffer.from(msg.data)
  job.frames++
  if (proc.stdin && proc.stdin.writable) {
    if (!proc.stdin.write(buf)) {
      proc.stdin.once('drain', () => undefined)
    }
  }
  if (job.frames % 5 === 0 || job.frames === job.totalFrames) {
    sendToRenderer({
      type: 'progress',
      jobId: job.jobId,
      frames: job.frames,
      totalFrames: job.totalFrames,
      stage: 'encoding'
    })
  }
}

function handleEnd(job: ExportJob): void {
  const proc = job.proc
  if (!proc) return
  try {
    proc.stdin?.end()
  } catch {
    /* ignore */
  }
}

function fail(job: ExportJob, message: string): void {
  job.cancelled = true
  try {
    job.proc?.kill('SIGKILL')
  } catch {
    /* ignore */
  }
  jobs.delete(job.jobId)
  sendToRenderer({ type: 'error', jobId: job.jobId, message })
}

export function cancelExport(jobId: string): void {
  const job = jobs.get(jobId)
  if (!job) return
  job.cancelled = true
  try {
    job.proc?.kill('SIGKILL')
  } catch {
    /* ignore */
  }
}

export function cancelAllExports(): void {
  for (const id of [...jobs.keys()]) cancelExport(id)
}

function extFor(format: ExportSettings['format']): string {
  switch (format) {
    case 'mp4-h264':
    case 'mp4-hevc':
      return 'mp4'
    case 'mov-prores4444':
      return 'mov'
    case 'webm-vp9-alpha':
      return 'webm'
    case 'gif':
      return 'gif'
    default:
      return 'png'
  }
}

function supportsAlpha(format: ExportSettings['format']): boolean {
  return format === 'mov-prores4444' || format === 'webm-vp9-alpha' || format === 'png-seq' || format === 'png-still'
}

function replaceExt(name: string, ext: string): string {
  const base = name.replace(/\.[^.]+$/, '')
  return ext ? `${base}.${ext}` : base
}

function dedupeName(dir: string, name: string): string {
  let candidate = name
  let i = 2
  while (fs.existsSync(path.join(dir, candidate))) {
    const dot = name.lastIndexOf('.')
    candidate = dot > 0 ? `${name.slice(0, dot)}_${i}${name.slice(dot)}` : `${name}_${i}`
    i++
  }
  return candidate
}

function appDownloadsDir(): string {
  return path.join(process.env.HOME ?? process.env.USERPROFILE ?? '.', 'Downloads', 'LiveMock')
}

