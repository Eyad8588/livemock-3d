// Typed IPC contracts (SPEC §12). Every channel is declared here and handled
// exactly once in the main process. Preload only exposes this surface.

import type {
  ExportSettings,
  LiveFramePayload,
  LivePageInfo,
  MediaEntry,
  Project,
  Scene,
  TakeEntry,
  WalkthroughStep
} from './types'

export type { MediaEntry }

// ---------- channels ----------

export const IPC = {
  // app / settings
  AppInfo: 'app:info',
  SettingsGet: 'settings:get',
  SettingsSet: 'settings:set',

  // project files
  ProjectNew: 'project:new',
  ProjectOpenDialog: 'project:open-dialog',
  ProjectOpenRecent: 'project:open-recent',
  ProjectSaveDialog: 'project:save-dialog',
  ProjectSaveToPath: 'project:save-to-path',
  ProjectAutosave: 'project:autosave',
  ProjectCheckRecovery: 'project:check-recovery',

  // media
  MediaImportDialog: 'media:import-dialog',
  MediaImportPath: 'media:import-path',
  MediaList: 'media:list',

  // live URL sources
  LiveStart: 'live:start',
  LiveStop: 'live:stop',
  LiveNavigate: 'live:navigate',
  LiveInput: 'live:input',
  LiveEvalScript: 'live:eval-script',
  LiveEvent: 'live:event', // main -> renderer

  // takes
  TakeRecord: 'take:record',
  TakeCancel: 'take:cancel',
  TakeEvent: 'take:event', // main -> renderer

  // capture (screen/window mirror)
  CapturePermission: 'capture:permission',
  CaptureOpenPermissionSettings: 'capture:open-permission-settings',

  // export (ffmpeg-backed formats + verification)
  ExportFfmpegStart: 'export:ffmpeg-start',
  ExportFfmpegCancel: 'export:ffmpeg-cancel',
  ExportFfmpegEvent: 'export:ffmpeg-event', // main -> renderer
  ExportVerify: 'export:verify',
  ExportWriteOutput: 'export:write-output',

  // misc
  DialogChooseDir: 'dialog:choose-dir',
  DialogSaveFile: 'dialog:save-file',
  ShellShowInFolder: 'shell:show-in-folder'
} as const

// ---------- payload types ----------

export interface AppInfoResult {
  version: string
  platform: NodeJS.Platform
  ffmpegAvailable: boolean
  ffprobeAvailable: boolean
  hdriDir: string
  testPagesDir: string
}

export interface AppSettings {
  language: 'en' | 'ar'
  theme: 'dark' | 'light'
  autoUpdate: boolean
  recentProjects: string[]
}

export interface SaveProjectRequest {
  suggestedName: string
  projectJson: string
}
export interface SaveProjectResult {
  ok: boolean
  path?: string
  cancelled?: boolean
  error?: string
}

export interface OpenProjectResult {
  ok: boolean
  projectJson?: string
  path?: string
  cancelled?: boolean
  error?: string
}

export interface MediaImportRequest {
  paths: string[]
}

export interface LiveStartRequest {
  sourceKey: string
  url: string
  viewport: { w: number; h: number; dpr: number }
  mobileEmulation: boolean
}

export interface LiveInputEvent {
  type: 'mousePressed' | 'mouseReleased' | 'mouseMoved' | 'mouseWheel' | 'char' | 'keyDown'
  x?: number
  y?: number
  deltaX?: number
  deltaY?: number
  keyCode?: number
  char?: string
  text?: string
  button?: 'left' | 'right' | 'middle'
}

export type LiveEvent =
  | { type: 'frame'; payload: LiveFramePayload }
  | { type: 'info'; payload: LivePageInfo }
  | { type: 'ripple'; sourceKey: string; x: number; y: number }
  | { type: 'error'; sourceKey: string; message: string }

export interface TakeRecordRequest {
  deviceId: string
  sourceKey: string
  url: string
  viewport: { w: number; h: number; dpr: number }
  mobileEmulation: boolean
  walkthrough: WalkthroughStep[]
  fps: 24 | 30 | 60
}

export type TakeEvent =
  | { type: 'progress'; sourceKey: string; elapsedMs: number; frames: number }
  | { type: 'done'; sourceKey: string; take: TakeEntry }
  | { type: 'error'; sourceKey: string; message: string }

export interface CapturePermissionResult {
  status: 'granted' | 'denied' | 'not-determined' | 'unsupported'
  platform: NodeJS.Platform
}

/** Renderer streams raw RGBA frames for ffmpeg-based exports over a MessagePort. */
export interface ExportFfmpegHandshake {
  settings: ExportSettings
  scene: Scene
  sceneName: string
  projectName: string
  outputPath: string
  /** frames are pushed as {index, width, height, data:ArrayBuffer} messages */
}

export type ExportFfmpegEvent =
  | { type: 'accepted'; jobId: string; outputPath: string }
  | { type: 'progress'; jobId: string; frames: number; totalFrames: number; stage: string }
  | { type: 'done'; jobId: string; outputPath: string; verification?: string }
  | { type: 'error'; jobId: string; message: string }

export interface WriteExportRequest {
  bytes: ArrayBuffer
  projectName: string
  sceneName: string
  width: number
  height: number
  fps: number
  ext: string
}
export interface WriteExportResult {
  ok: boolean
  path?: string
  verification?: string
  error?: string
}

export interface VerifyResult {
  ok: boolean
  width?: number
  height?: number
  fps?: number
  durationSec?: number
  error?: string
  humanReport: string
}

// ---------- validation ----------

export function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

export function assertString(v: unknown, name: string, maxLen = 4096): string {
  if (typeof v !== 'string' || v.length === 0 || v.length > maxLen) {
    throw new Error(`Invalid payload field: ${name}`)
  }
  return v
}

export function assertNumber(v: unknown, name: string, min = -1e9, max = 1e9): number {
  if (typeof v !== 'number' || !Number.isFinite(v) || v < min || v > max) {
    throw new Error(`Invalid payload field: ${name}`)
  }
  return v
}

export function assertBool(v: unknown, name: string): boolean {
  if (typeof v !== 'boolean') throw new Error(`Invalid payload field: ${name}`)
  return v
}

/** Structural check for a deserialized project (used on open + import). */
export function looksLikeProject(v: unknown): v is Project {
  if (!isRecord(v)) return false
  const p = v as Partial<Project>
  return (
    typeof p.schemaVersion === 'number' &&
    typeof p.id === 'string' &&
    typeof p.name === 'string' &&
    Array.isArray(p.scenes) &&
    Array.isArray(p.exportPresets) &&
    Array.isArray(p.media) &&
    Array.isArray(p.takes) &&
    typeof p.createdAt === 'string' &&
    typeof p.updatedAt === 'string'
  )
}

// ---------- preload API surface (window.livemock) ----------

export interface LiveMockPreloadApi {
  appInfo(): Promise<AppInfoResult>
  settingsGet(): Promise<AppSettings>
  settingsSet(patch: Partial<AppSettings>): Promise<AppSettings>

  newProject(): Promise<{ projectJson: string; path: null }>
  openProjectDialog(): Promise<OpenProjectResult>
  openRecentProject(path: string): Promise<OpenProjectResult>
  saveProjectDialog(req: SaveProjectRequest): Promise<SaveProjectResult>
  saveProjectToPath(path: string, projectJson: string): Promise<SaveProjectResult>
  autosave(projectJson: string): Promise<void>
  checkRecovery(): Promise<{ available: boolean; projectJson?: string; savedAt?: string }>

  importMediaDialog(projectId: string): Promise<MediaEntry[]>
  importMediaFromPaths(paths: string[], projectId: string): Promise<MediaEntry[]>
  /** Resolve a File to an absolute path inside the sandboxed renderer. */
  pathForFile(file: File): string
  mediaMediaUrl(mediaId: string): string
  takeMediaUrl(takeId: string): string

  liveStart(req: LiveStartRequest): Promise<void>
  liveStop(sourceKey: string): Promise<void>
  liveNavigate(sourceKey: string, url: string): Promise<void>
  liveInput(sourceKey: string, ev: LiveInputEvent): void
  liveEval(sourceKey: string, expr: string): Promise<unknown>
  onLiveEvent(cb: (ev: LiveEvent) => void): () => void

  takeRecord(req: TakeRecordRequest): Promise<void>
  takeCancel(sourceKey: string): Promise<void>
  onTakeEvent(cb: (ev: TakeEvent) => void): () => void

  capturePermission(): Promise<CapturePermissionResult>
  captureOpenPermissionSettings(): Promise<void>

  exportVerify(path: string): Promise<VerifyResult>
  writeExportOutput(req: WriteExportRequest): Promise<WriteExportResult>
  /** ffmpeg-backed export: start job, stream raw chunks, finish. */
  exportFfmpegStart(handshake: unknown): Promise<{ jobId: string } | { error: string }>
  exportFfmpegFrame(jobId: string, data: ArrayBuffer): void
  exportFfmpegEnd(jobId: string): void
  exportFfmpegCancel(jobId: string): void
  onExportFfmpegEvent(cb: (ev: ExportFfmpegEvent) => void): () => void

  chooseDirectory(): Promise<string | null>
  saveFileDialog(defaultName: string, extensions: string[]): Promise<string | null>
  showInFolder(path: string): Promise<void>
}
