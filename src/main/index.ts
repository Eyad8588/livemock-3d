// LiveMock 3D — Electron main process.

import { app, BrowserWindow, dialog, ipcMain, net, protocol, session, shell } from 'electron'
import * as fs from 'node:fs'
import * as path from 'node:path'
import { pathToFileURL } from 'node:url'
import {
  IPC,
  assertString,
  isRecord,
  type AppInfoResult,
  type AppSettings,
  type CapturePermissionResult,
  type LiveInputEvent,
  type LiveStartRequest,
  type OpenProjectResult,
  type SaveProjectResult,
  type TakeRecordRequest,
  type VerifyResult
} from '../shared/ipc'
import { createDefaultProject } from '../shared/serialize'
import {
  closeWorkspace,
  ensureWorkspace,
  findStoredFile,
  importMediaFromPaths,
  listRecoveries,
  openProjectZip,
  saveProjectZip,
  writeRecovery
} from './workspace'
import { liveEval, liveInput, liveNavigate, liveStart, liveStop, stopAllLive } from './offscreen'
import { cancelAllTakes, cancelTake, recordTake } from './takes'
import { cancelAllExports, cancelExport, registerExportIpc } from './exportFfmpeg'
import { verifyWithFfprobe } from './verify'
import { ffmpegPath, ffprobePath } from './ffmpegProc'

// __dirname is provided by the electron-vite ESM shim

process.on('uncaughtException', (err) => {
  console.error('[livemock] uncaught:', err)
})

// ---------- custom protocols ----------

protocol.registerSchemesAsPrivileged([
  {
    scheme: 'livemock-media',
    privileges: { standard: true, secure: true, stream: true, supportFetchAPI: true, corsEnabled: true, bypassCSP: true }
  },
  {
    scheme: 'livemock-test',
    privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true }
  }
])

function assetsRoot(): string {
  return process.env['ELECTRON_RENDERER_URL'] ? process.cwd() : path.resolve(__dirname, '../../..')
}

function registerProtocols(): void {
  protocol.handle('livemock-media', async (request) => {
    const url = new URL(request.url)
    const kind = url.host === 'take' ? 'take' : 'media'
    const id = decodeURIComponent(url.pathname.replace(/^\//, '')).replace(/\.[a-z0-9]+$/i, '')
    const file = findStoredFile(kind as 'media' | 'take', id)
    if (!file) return new Response('Not found', { status: 404 })
    const res = await net.fetch(pathToFileURL(file).toString())
    const headers = new Headers(res.headers)
    headers.set('Access-Control-Allow-Origin', '*')
    headers.set('Content-Type', res.headers.get('Content-Type') ?? 'application/octet-stream')
    return new Response(res.body, { status: res.status, headers })
  })

  protocol.handle('livemock-test', (request) => {
    const url = new URL(request.url)
    const rel = decodeURIComponent(url.pathname).replace(/^\/+/, '') || 'index.html'
    const base = path.join(assetsRoot(), 'assets', 'test-pages')
    const resolved = path.resolve(base, rel)
    if (!resolved.startsWith(base)) return new Response('Forbidden', { status: 403 })
    if (!fs.existsSync(resolved)) return new Response('Not found', { status: 404 })
    return net.fetch(pathToFileURL(resolved).toString())
  })
}

// ---------- settings ----------

const settingsPath = () => path.join(app.getPath('userData'), 'settings.json')

function loadSettings(): AppSettings {
  try {
    const raw = JSON.parse(fs.readFileSync(settingsPath(), 'utf8')) as Partial<AppSettings>
    return {
      language: raw.language === 'ar' ? 'ar' : 'en',
      theme: raw.theme === 'light' ? 'light' : 'dark',
      autoUpdate: raw.autoUpdate === true, // off by default (SPEC §12)
      recentProjects: Array.isArray(raw.recentProjects) ? raw.recentProjects.slice(0, 10) : []
    }
  } catch {
    return { language: 'en', theme: 'dark', autoUpdate: false, recentProjects: [] }
  }
}

function saveSettings(s: AppSettings): void {
  fs.mkdirSync(path.dirname(settingsPath()), { recursive: true })
  fs.writeFileSync(settingsPath(), JSON.stringify(s, null, 2))
}

let settings: AppSettings

// ---------- main window ----------

let mainWindow: BrowserWindow | null = null

function markMainSession(win: BrowserWindow): void {
  ;(win.webContents as unknown as { __isMain?: boolean }).__isMain = true
}

async function createMainWindow(): Promise<void> {
  const preloadPath = path.join(__dirname, '../preload/index.js')
  const win = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 1180,
    minHeight: 720,
    show: false,
    backgroundColor: '#101216',
    title: 'LiveMock 3D',
    autoHideMenuBar: true,
    webPreferences: {
      preload: preloadPath,
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
      webSecurity: true,
      spellcheck: false
    }
  })
  markMainSession(win)
  win.once('ready-to-show', () => win.show())

  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//i.test(url)) void shell.openExternal(url)
    return { action: 'deny' }
  })

  if (process.env['ELECTRON_RENDERER_URL']) {
    await win.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    await win.loadFile(path.join(__dirname, '../renderer/index.html'))
  }
  mainWindow = win
}

// ---------- ipc plumbing ----------

function handle<T>(channel: string, fn: (payload: unknown) => Promise<T> | T): void {
  ipcMain.handle(channel, async (_e, payload: unknown) => {
    try {
      return await fn(payload)
    } catch (err) {
      console.error(`[livemock] ${channel} failed:`, err)
      throw err instanceof Error ? err : new Error(String(err))
    }
  })
}

function pushRecent(p: string): void {
  settings.recentProjects = [p, ...settings.recentProjects.filter((x) => x !== p)].slice(0, 10)
  saveSettings(settings)
}

async function saveDialog(): Promise<SaveProjectResult> {
  const win = mainWindow
  if (!win) return { ok: false, error: 'no window' }
  const res = await dialog.showSaveDialog(win, {
    title: 'Save LiveMock project',
    defaultPath: 'project.livemock',
    filters: [{ name: 'LiveMock Project', extensions: ['livemock'] }]
  })
  if (res.canceled || !res.filePath) return { ok: false, cancelled: true }
  return { ok: true, path: res.filePath }
}

function registerIpc(): void {
  handle<AppInfoResult>(IPC.AppInfo, () => ({
    version: app.getVersion(),
    platform: process.platform,
    ffmpegAvailable: ffmpegPath() !== null,
    ffprobeAvailable: ffprobePath() !== null,
    hdriDir: path.join(assetsRoot(), 'assets', 'hdri'),
    testPagesDir: path.join(assetsRoot(), 'assets', 'test-pages')
  }))

  handle<AppSettings>(IPC.SettingsGet, () => settings)
  handle<AppSettings>(IPC.SettingsSet, (payload) => {
    if (isRecord(payload)) settings = { ...settings, ...(payload as Partial<AppSettings>) }
    saveSettings(settings)
    return settings
  })

  handle<{ projectJson: string; path: null }>(IPC.ProjectNew, () => {
    closeWorkspace()
    const project = createDefaultProject()
    ensureWorkspace(project.id)
    return { projectJson: JSON.stringify(project), path: null }
  })

  handle<OpenProjectResult>(IPC.ProjectOpenDialog, async () => {
    const win = mainWindow
    if (!win) return { ok: false, error: 'no window' }
    const res = await dialog.showOpenDialog(win, {
      title: 'Open LiveMock project',
      filters: [{ name: 'LiveMock Project', extensions: ['livemock'] }],
      properties: ['openFile']
    })
    if (res.canceled || res.filePaths.length === 0) return { ok: false, cancelled: true }
    try {
      const opened = openProjectZip(res.filePaths[0]!)
      pushRecent(res.filePaths[0]!)
      return { ok: true, projectJson: opened.projectJson, path: res.filePaths[0]! }
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) }
    }
  })

  handle<OpenProjectResult>(IPC.ProjectOpenRecent, (payload) => {
    const p = assertString(payload, 'path', 4096)
    const opened = openProjectZip(p)
    pushRecent(p)
    return { ok: true, projectJson: opened.projectJson, path: p }
  })

  handle<SaveProjectResult>(IPC.ProjectSaveDialog, async (payload) => {
    if (typeof payload !== 'string') return { ok: false, error: 'bad payload' }
    const picked = await saveDialog()
    if (!picked.ok || !picked.path) return picked
    saveProjectZip(picked.path, payload)
    pushRecent(picked.path)
    return picked
  })

  handle<SaveProjectResult>(IPC.ProjectSaveToPath, (payload) => {
    if (!isRecord(payload) || typeof payload.path !== 'string' || typeof payload.projectJson !== 'string') {
      return { ok: false, error: 'bad payload' }
    }
    saveProjectZip(payload.path, payload.projectJson)
    pushRecent(payload.path)
    return { ok: true, path: payload.path }
  })

  handle<void>(IPC.ProjectAutosave, (payload) => {
    if (typeof payload !== 'string' || payload.length > 64 * 1024 * 1024) return
    try {
      const project = JSON.parse(payload) as { id?: string }
      if (typeof project.id !== 'string') return
      writeRecovery(project.id, payload)
    } catch {
      /* ignore malformed autosave */
    }
  })

  handle<{ available: boolean; projectJson?: string; savedAt?: string }>(IPC.ProjectCheckRecovery, () => {
    const list = listRecoveries()
    if (list.length === 0) return { available: false }
    return { available: true, projectJson: list[0]!.projectJson, savedAt: list[0]!.savedAt }
  })

  handle(importMediaPathChannel, async (payload) => {
    if (!isRecord(payload) || !Array.isArray(payload.paths)) throw new Error('bad payload')
    const projectId = typeof payload.projectId === 'string' ? payload.projectId : '__default__'
    ensureWorkspace(projectId)
    return importMediaFromPaths(payload.paths as string[])
  })

  handle(IPC.MediaImportDialog, async (payload) => {
    const win = mainWindow
    if (!win) return []
    const projectId = isRecord(payload) && typeof payload.projectId === 'string' ? payload.projectId : '__default__'
    const res = await dialog.showOpenDialog(win, {
      title: 'Import media',
      properties: ['openFile', 'multiSelections'],
      filters: [
        {
          name: 'Media',
          extensions: [
            'png', 'jpg', 'jpeg', 'webp', 'gif', 'mp4', 'mov', 'webm', 'm4v',
            'mp3', 'wav', 'm4a', 'aac', 'ogg', 'flac', 'glb', 'gltf'
          ]
        }
      ]
    })
    if (res.canceled || res.filePaths.length === 0) return []
    ensureWorkspace(projectId)
    return importMediaFromPaths(res.filePaths)
  })

  // live sources
  handle<void>(IPC.LiveStart, (payload) => {
    const req = payload as LiveStartRequest
    if (!isRecord(req) || typeof req.sourceKey !== 'string' || typeof req.url !== 'string') throw new Error('bad payload')
    if (!/^(https?|livemock-test):\/\//i.test(req.url)) throw new Error('only http(s) or livemock-test URLs are allowed')
    liveStart(req)
  })
  handle<void>(IPC.LiveStop, (payload) => {
    liveStop(assertString(payload, 'sourceKey', 200))
  })
  handle<void>(IPC.LiveNavigate, (payload) => {
    if (!isRecord(payload)) throw new Error('bad payload')
    liveNavigate(assertString(payload.sourceKey, 'sourceKey', 200), assertString(payload.url, 'url', 4096))
  })
  ipcMain.on(IPC.LiveInput, (_e, sourceKey: unknown, ev: unknown) => {
    if (typeof sourceKey !== 'string' || !isRecord(ev)) return
    liveInput(sourceKey, ev as unknown as LiveInputEvent)
  })
  handle<unknown>(IPC.LiveEvalScript, (payload) => {
    if (!isRecord(payload)) throw new Error('bad payload')
    return liveEval(assertString(payload.sourceKey, 'sourceKey', 200), assertString(payload.expr, 'expr', 65536))
  })

  // takes
  handle<void>(IPC.TakeRecord, (payload) => {
    const req = payload as TakeRecordRequest
    if (!isRecord(req) || typeof req.sourceKey !== 'string' || typeof req.url !== 'string') throw new Error('bad payload')
    if (!/^(https?|livemock-test):\/\//i.test(req.url)) throw new Error('only http(s) or livemock-test URLs are allowed')
    ensureWorkspace('__default__')
    recordTake(req)
  })
  handle<void>(IPC.TakeCancel, (payload) => cancelTake(assertString(payload, 'sourceKey', 200)))

  // capture (screen/window mirror)
  handle<CapturePermissionResult>(IPC.CapturePermission, async () => {
    if (process.platform !== 'darwin') return { status: 'granted', platform: process.platform }
    const { systemPreferences } = await import('electron')
    const status = systemPreferences.getMediaAccessStatus('screen')
    return { status: status as 'granted' | 'denied' | 'not-determined', platform: process.platform }
  })
  handle<void>(IPC.CaptureOpenPermissionSettings, async () => {
    if (process.platform === 'darwin') {
      await shell.openExternal('x-apple.systempreferences:com.apple.preference.security?Privacy_ScreenCapture')
    }
  })

  // export
  handle<VerifyResult>(IPC.ExportVerify, (payload) => {
    const p = assertString(payload, 'path', 4096)
    return verifyWithFfprobe(p)
  })
  ipcMain.on(IPC.ExportFfmpegCancel, (_e, jobId: unknown) => {
    if (typeof jobId === 'string') cancelExport(jobId)
  })

  // dialogs
  handle<string | null>(IPC.DialogChooseDir, async () => {
    const win = mainWindow
    if (!win) return null
    const res = await dialog.showOpenDialog(win, { properties: ['openDirectory', 'createDirectory'] })
    return res.canceled || res.filePaths.length === 0 ? null : res.filePaths[0]!
  })
  handle<string | null>(IPC.DialogSaveFile, async (payload) => {
    const win = mainWindow
    if (!win || !isRecord(payload)) return null
    const res = await dialog.showSaveDialog(win, {
      defaultPath: assertString(payload.defaultName, 'defaultName', 300),
      filters: [{ name: 'Files', extensions: (payload.extensions as string[]) ?? ['*'] }]
    })
    return res.canceled ? null : (res.filePath ?? null)
  })
  handle<void>(IPC.ShellShowInFolder, (payload) => {
    const p = assertString(payload, 'path', 4096)
    if (fs.existsSync(p)) shell.showItemInFolder(p)
  })
}

const importMediaPathChannel = 'media:import-path'

// ---------- lifecycle ----------

const gotLock = app.requestSingleInstanceLock()
if (!gotLock) {
  app.quit()
} else {
  app.on('second-instance', () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore()
      mainWindow.focus()
    }
  })

  void app.whenReady().then(() => {
    settings = loadSettings()
    registerProtocols()
    registerIpc()
    registerExportIpc()

    // main session hardening
    const ses = session.defaultSession
    ses.setPermissionRequestHandler((_wc, _perm, cb) => cb(false))
    ses.setPermissionCheckHandler(() => false)

    void createMainWindow()

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) void createMainWindow()
    })
  })

  app.on('before-quit', () => {
    stopAllLive()
    cancelAllTakes()
    cancelAllExports()
  })

  app.on('window-all-closed', () => {
    stopAllLive()
    cancelAllTakes()
    cancelAllExports()
    app.quit()
  })
}
