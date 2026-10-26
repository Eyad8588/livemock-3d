// ffmpeg-backed export pipeline (SPEC §9). The renderer renders frames
// deterministically and streams raw chunks via IPC; main pipes them into the
// bundled ffmpeg and reports progress. Handles MOV ProRes 4444 (alpha),
// WebM VP9 (alpha), GIF, PNG sequence/still, and the H.264 fallback.

import { spawn, type ChildProcess } from 'node:child_process'
import * as fs from 'node:fs'
import * as path from 'node:path'
import { BrowserWindow, ipcMain } from 'electron'
import { IPC, type ExportFfmpegEvent } from '../shared/ipc'
import { buildFfmpegArgs, buildExportFilename } from '../shared/exportUtils'
import type { ExportSettings, Scene } from '../shared/types'
import { ffmpegPath } from './ffmpegProc'

interface ExportJob {
  jobId: string
  proc: ChildProcess | null
  cancelled: boolean
  frames: number
  totalFrames: number
  outputPath: string
  onDone?: (ok: boolean, error?: string) => void
}

interface Handshake {
  settings: ExportSettings
  scene: Scene
  projectName: string
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

function appDownloadsDir(): string {
  return path.join(process.env.HOME ?? process.env.USERPROFILE ?? '.', 'Downloads', 'LiveMock')
}

export function registerExportIpc(): void {
  ipcMain.handle('export:ffmpeg-start', async (_e, handshake: unknown): Promise<{ jobId: string } | { error: string }> => {
    if (typeof handshake !== 'object' || handshake === null) return { error: 'bad payload' }
    const { settings, scene, projectName } = handshake as Handshake
    const ffmpegBin = ffmpegPath()
    if (!ffmpegBin) return { error: 'ffmpeg is not available on this machine' }

    const jobId = String(nextJobId++)
    const job: ExportJob = { jobId, proc: null, cancelled: false, frames: 0, totalFrames: 0, outputPath: '' }
    jobs.set(jobId, job)

    const ext = extFor(settings.format)
    const dir = appDownloadsDir()
    fs.mkdirSync(dir, { recursive: true })
    const name = buildExportFilename(projectName, scene.name, settings.width, settings.height, settings.fps, ext)
    let outputPath = path.join(dir, name)
    let i = 2
    while (fs.existsSync(outputPath)) {
      const dot = name.lastIndexOf('.')
      outputPath = path.join(dir, `${name.slice(0, dot)}_${i}${name.slice(dot)}`)
      i++
    }
    job.outputPath = outputPath
    job.totalFrames = settings.format === 'png-still' ? 1 : Math.max(1, Math.round(scene.durationSec * settings.fps))

    const missingTakes = scene.devices.filter((d) => d.screen.kind === 'url' && !d.screen.takeId).length
    if (missingTakes > 0) {
      jobs.delete(jobId)
      return { error: 'URL sources need a recorded take before export (Record Take first)' }
    }

    const args = buildFfmpegArgs(settings.format, {
      frameFormat: settings.format === 'png-seq' || settings.format === 'png-still' ? 'png' : 'rgba',
      width: settings.width,
      height: settings.height,
      fps: settings.fps,
      inputPath: 'pipe:0',
      transparent: settings.transparentBackground && supportsAlpha(settings.format),
      quality: settings.quality,
      stillOnly: settings.format === 'png-still'
    })

    if (settings.format === 'png-seq') {
      args.push(path.join(dir, replaceExt(name, '') + '_%06d.png'))
    } else {
      args.push(outputPath)
    }

    const proc = spawn(ffmpegBin, args, { stdio: ['pipe', 'ignore', 'pipe'] })
    job.proc = proc
    let errOut = ''
    proc.stderr?.on('data', (d: Buffer) => {
      errOut += d.toString()
      if (errOut.length > 12000) errOut = errOut.slice(-6000)
    })
    proc.on('error', (err) => {
      sendToRenderer({ type: 'error', jobId, message: `ffmpeg failed to start: ${err.message}` })
      job.onDone?.(false, err.message)
    })
    proc.on('close', async (code) => {
      jobs.delete(jobId)
      if (job.cancelled) {
        sendToRenderer({ type: 'error', jobId, message: 'Export cancelled' })
        job.onDone?.(false, 'cancelled')
        return
      }
      if (code !== 0 && settings.format !== 'png-seq') {
        sendToRenderer({ type: 'error', jobId, message: `ffmpeg exited with code ${code}: ${errOut.slice(-500)}` })
        job.onDone?.(false, `ffmpeg exited ${code}`)
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
      sendToRenderer({ type: 'done', jobId, outputPath, verification })
      job.onDone?.(true)
    })

    sendToRenderer({ type: 'accepted', jobId, outputPath })
    return { jobId }
  })

  ipcMain.on('export:ffmpeg-frame', (_e, jobId: unknown, data: unknown) => {
    const job = typeof jobId === 'string' ? jobs.get(jobId) : undefined
    if (!job || !job.proc?.stdin?.writable || job.cancelled) return
    const buf = Buffer.from(data as ArrayBuffer)
    job.frames++
    if (!job.proc.stdin.write(buf)) {
      job.proc.stdin.once('drain', () => undefined)
    }
    if (job.frames % 5 === 0 || job.frames === job.totalFrames) {
      sendToRenderer({ type: 'progress', jobId: job.jobId, frames: job.frames, totalFrames: job.totalFrames, stage: 'encoding' })
    }
  })

  ipcMain.on('export:ffmpeg-end', (_e, jobId: unknown) => {
    const job = typeof jobId === 'string' ? jobs.get(jobId) : undefined
    if (!job?.proc?.stdin) return
    try {
      job.proc.stdin.end()
    } catch {
      /* ignore */
    }
  })

  ipcMain.on(IPC.ExportFfmpegCancel, (_e, jobId: unknown) => {
    if (typeof jobId !== 'string') return
    const job = jobs.get(jobId)
    if (!job) return
    job.cancelled = true
    try {
      job.proc?.kill('SIGKILL')
    } catch {
      /* ignore */
    }
  })
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
