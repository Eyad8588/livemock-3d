// Sandboxed preload: exposes the typed API via contextBridge (SPEC §12).
import { contextBridge, ipcRenderer, webUtils } from 'electron'
import {
  IPC,
  type AppInfoResult,
  type AppSettings,
  type CapturePermissionResult,
  type ExportFfmpegEvent,
  type LiveEvent,
  type LiveInputEvent,
  type LiveMockPreloadApi,
  type LiveStartRequest,
  type MediaEntry,
  type OpenProjectResult,
  type SaveProjectRequest,
  type SaveProjectResult,
  type TakeEvent,
  type TakeRecordRequest,
  type VerifyResult
} from '../shared/ipc'

const api: LiveMockPreloadApi = {
  appInfo: (): Promise<AppInfoResult> => ipcRenderer.invoke(IPC.AppInfo),
  settingsGet: (): Promise<AppSettings> => ipcRenderer.invoke(IPC.SettingsGet),
  settingsSet: (patch: Partial<AppSettings>): Promise<AppSettings> => ipcRenderer.invoke(IPC.SettingsSet, patch),

  newProject: () => ipcRenderer.invoke(IPC.ProjectNew),
  openProjectDialog: (): Promise<OpenProjectResult> => ipcRenderer.invoke(IPC.ProjectOpenDialog),
  openRecentProject: (path: string): Promise<OpenProjectResult> => ipcRenderer.invoke(IPC.ProjectOpenRecent, path),
  saveProjectDialog: (req: SaveProjectRequest): Promise<SaveProjectResult> =>
    ipcRenderer.invoke(IPC.ProjectSaveDialog, req.projectJson),
  saveProjectToPath: (path: string, projectJson: string): Promise<SaveProjectResult> =>
    ipcRenderer.invoke(IPC.ProjectSaveToPath, { path, projectJson }),
  autosave: (projectJson: string): Promise<void> => ipcRenderer.invoke(IPC.ProjectAutosave, projectJson),
  checkRecovery: () => ipcRenderer.invoke(IPC.ProjectCheckRecovery),

  importMediaDialog: (projectId: string): Promise<MediaEntry[]> => ipcRenderer.invoke(IPC.MediaImportDialog, { projectId }),
  importMediaFromPaths: (paths: string[], projectId: string): Promise<MediaEntry[]> =>
    ipcRenderer.invoke('media:import-path', { paths, projectId }),
  pathForFile: (file: File): string => webUtils.getPathForFile(file),
  mediaMediaUrl: (mediaId: string): string => `livemock-media://media/${mediaId}`,
  takeMediaUrl: (takeId: string): string => `livemock-media://take/${takeId}`,

  liveStart: (req: LiveStartRequest): Promise<void> => ipcRenderer.invoke(IPC.LiveStart, req),
  liveStop: (sourceKey: string): Promise<void> => ipcRenderer.invoke(IPC.LiveStop, sourceKey),
  liveNavigate: (sourceKey: string, url: string): Promise<void> => ipcRenderer.invoke(IPC.LiveNavigate, { sourceKey, url }),
  liveInput: (sourceKey: string, ev: LiveInputEvent): void => {
    ipcRenderer.send(IPC.LiveInput, sourceKey, ev)
  },
  liveEval: (sourceKey: string, expr: string): Promise<unknown> =>
    ipcRenderer.invoke(IPC.LiveEvalScript, { sourceKey, expr }),
  onLiveEvent: (cb: (ev: LiveEvent) => void) => {
    const listener = (_e: Electron.IpcRendererEvent, ev: LiveEvent): void => cb(ev)
    ipcRenderer.on(IPC.LiveEvent, listener)
    return () => ipcRenderer.removeListener(IPC.LiveEvent, listener)
  },

  takeRecord: (req: TakeRecordRequest): Promise<void> => ipcRenderer.invoke(IPC.TakeRecord, req),
  takeCancel: (sourceKey: string): Promise<void> => ipcRenderer.invoke(IPC.TakeCancel, sourceKey),
  onTakeEvent: (cb: (ev: TakeEvent) => void) => {
    const listener = (_e: Electron.IpcRendererEvent, ev: TakeEvent): void => cb(ev)
    ipcRenderer.on(IPC.TakeEvent, listener)
    return () => ipcRenderer.removeListener(IPC.TakeEvent, listener)
  },

  capturePermission: (): Promise<CapturePermissionResult> => ipcRenderer.invoke(IPC.CapturePermission),
  captureOpenPermissionSettings: (): Promise<void> => ipcRenderer.invoke(IPC.CaptureOpenPermissionSettings),

  exportVerify: (path: string): Promise<VerifyResult> => ipcRenderer.invoke(IPC.ExportVerify, path),
  exportFfmpegConnect: (): Promise<MessagePort> =>
    new Promise((resolve) => {
      const channel = new MessageChannel()
      const { port1, port2 } = channel
      ipcRenderer.postMessage('export:ffmpeg-connect', null, [port2])
      port1.start()
      resolve(port1)
    }),
  onExportFfmpegEvent: (cb: (ev: ExportFfmpegEvent) => void) => {
    const listener = (_e: Electron.IpcRendererEvent, ev: ExportFfmpegEvent): void => cb(ev)
    ipcRenderer.on(IPC.ExportFfmpegEvent, listener)
    return () => ipcRenderer.removeListener(IPC.ExportFfmpegEvent, listener)
  },

  chooseDirectory: (): Promise<string | null> => ipcRenderer.invoke(IPC.DialogChooseDir),
  saveFileDialog: (defaultName: string, extensions: string[]): Promise<string | null> =>
    ipcRenderer.invoke(IPC.DialogSaveFile, { defaultName, extensions }),
  showInFolder: (path: string): Promise<void> => ipcRenderer.invoke(IPC.ShellShowInFolder, path)
}

contextBridge.exposeInMainWorld('livemock', api)
