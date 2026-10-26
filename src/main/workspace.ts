// Active project workspace: on-disk store for media + takes, .livemock zip I/O,
// autosave + crash recovery. One workspace is active at a time.

import { app } from 'electron'
import * as fs from 'node:fs'
import * as fsp from 'node:fs/promises'
import * as path from 'node:path'
import * as crypto from 'node:crypto'
import { zipSync, unzipSync, type Zippable } from 'fflate'
import { migrate } from '../shared/serialize'
import type { MediaEntry } from '../shared/types'
import { probeImageFile, probeWithFfprobe } from './mediaProbe'

const IMAGE_EXT = new Set(['png', 'jpg', 'jpeg', 'webp', 'gif', 'bmp'])
const VIDEO_EXT = new Set(['mp4', 'mov', 'webm', 'm4v', 'mkv'])
const AUDIO_EXT = new Set(['mp3', 'wav', 'm4a', 'aac', 'ogg', 'flac'])
const MODEL_EXT = new Set(['glb', 'gltf'])

export function workspaceRoot(): string {
  return path.join(app.getPath('userData'), 'workspaces')
}

interface ActiveWorkspace {
  projectId: string
  dir: string
  mediaDir: string
  takesDir: string
}

let active: ActiveWorkspace | null = null

export function getActive(): ActiveWorkspace | null {
  return active
}

export function ensureWorkspace(projectId: string): ActiveWorkspace {
  if (active && active.projectId === projectId) return active
  const dir = path.join(workspaceRoot(), sanitizeSegment(projectId))
  const mediaDir = path.join(dir, 'media')
  const takesDir = path.join(dir, 'takes')
  fs.mkdirSync(mediaDir, { recursive: true })
  fs.mkdirSync(takesDir, { recursive: true })
  active = { projectId, dir, mediaDir, takesDir }
  return active
}

export function closeWorkspace(): void {
  active = null
}

export function sanitizeSegment(s: string): string {
  return s.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 80) || 'workspace'
}

export function isMediaId(id: string): boolean {
  return /^[a-f0-9]{40}$/.test(id)
}

/** Find a stored file by bare id (any extension). */
export function findStoredFile(kind: 'media' | 'take', id: string): string | null {
  const ws = active
  if (!ws || !isMediaId(id)) return null
  const dir = kind === 'media' ? ws.mediaDir : ws.takesDir
  try {
    for (const f of fs.readdirSync(dir)) {
      if (f.startsWith(id + '.')) return path.join(dir, f)
    }
  } catch {
    /* dir missing */
  }
  return null
}

function detectKind(ext: string): MediaEntry['kind'] {
  const e = ext.toLowerCase()
  if (IMAGE_EXT.has(e)) return 'image'
  if (VIDEO_EXT.has(e)) return 'video'
  if (AUDIO_EXT.has(e)) return 'audio'
  if (MODEL_EXT.has(e)) return 'model'
  return 'image'
}

function mimeFor(_kind: MediaEntry['kind'], ext: string): string {
  const e = ext.toLowerCase()
  const table: Record<string, string> = {
    png: 'image/png',
    jpg: 'image/jpeg',
    jpeg: 'image/jpeg',
    webp: 'image/webp',
    gif: 'image/gif',
    bmp: 'image/bmp',
    mp4: 'video/mp4',
    m4v: 'video/mp4',
    mov: 'video/quicktime',
    webm: 'video/webm',
    mkv: 'video/x-matroska',
    mp3: 'audio/mpeg',
    wav: 'audio/wav',
    m4a: 'audio/mp4',
    aac: 'audio/aac',
    ogg: 'audio/ogg',
    flac: 'audio/flac',
    glb: 'model/gltf-binary',
    gltf: 'model/gltf+json'
  }
  return table[e] ?? 'application/octet-stream'
}

/** Import files into the active workspace. Returns registry entries. */
export async function importMediaFromPaths(paths: string[]): Promise<MediaEntry[]> {
  const ws = ensureWorkspace('__default__') // caller sets real workspace before import
  const out: MediaEntry[] = []
  for (const p of paths) {
    const stat = await fsp.stat(p).catch(() => null)
    if (!stat || !stat.isFile()) continue
    if (stat.size > 4 * 1024 * 1024 * 1024) continue // >4GB skip
    const ext = path.extname(p).replace(/^\./, '') || 'bin'
    const kind = detectKind(ext)
    const buf = await fsp.readFile(p)
    const id = crypto.createHash('sha1').update(buf).digest('hex')
    const dest = path.join(ws.mediaDir, `${id}.${ext.toLowerCase()}`)
    if (!fs.existsSync(dest)) await fsp.writeFile(dest, buf)

    let width: number | undefined
    let height: number | undefined
    let durationSec: number | undefined
    if (kind === 'image') {
      const dim = probeImageFile(buf)
      width = dim?.width
      height = dim?.height
    } else if (kind === 'video' || kind === 'audio') {
      const probe = await probeWithFfprobe(dest)
      width = probe?.width
      height = probe?.height
      durationSec = probe?.durationSec
    }
    out.push({
      id,
      name: path.basename(p),
      kind,
      ext: ext.toLowerCase(),
      mime: mimeFor(kind, ext),
      width,
      height,
      durationSec,
      bytes: stat.size
    })
  }
  return out
}

/** Write a .livemock zip: project.json + media/ + takes/. */
export function saveProjectZip(destPath: string, projectJson: string): void {
  const files: Zippable = {}
  files['project.json'] = [Buffer.from(projectJson, 'utf8'), { level: 6 }]
  if (active) {
    for (const [sub, dir] of [
      ['media', active.mediaDir],
      ['takes', active.takesDir]
    ] as const) {
      let names: string[] = []
      try {
        names = fs.readdirSync(dir)
      } catch {
        /* ignore */
      }
      for (const n of names) {
        const fp = path.join(dir, n)
        try {
          const data = fs.readFileSync(fp)
          files[`${sub}/${n}`] = [data, { level: 0 }] // media is already compressed
        } catch {
          /* unreadable file: skip */
        }
      }
    }
  }
  const zipped = zipSync(files, { level: 0 })
  // atomic-ish write
  const tmp = destPath + '.tmp'
  fs.writeFileSync(tmp, Buffer.from(zipped))
  fs.renameSync(tmp, destPath)
}

/** Open a .livemock zip into a fresh workspace; returns migrated project JSON. */
export function openProjectZip(srcPath: string): { projectJson: string; mediaAdded: number } {
  const zipped = unzipSync(new Uint8Array(fs.readFileSync(srcPath)))
  const projectEntry = zipped['project.json']
  if (!projectEntry) throw new Error('Not a LiveMock project (missing project.json)')
  const raw = JSON.parse(Buffer.from(projectEntry).toString('utf8'))
  const project = migrate(raw)
  const ws = ensureWorkspace(project.id)
  let mediaAdded = 0
  for (const [name, data] of Object.entries(zipped)) {
    if (name === 'project.json' || name.endsWith('/')) continue
    const sub = name.startsWith('takes/') ? ws.takesDir : name.startsWith('media/') ? ws.mediaDir : null
    if (!sub) continue
    const base = path.basename(name)
    if (!base) continue
    fs.writeFileSync(path.join(sub, base), Buffer.from(data))
    mediaAdded++
  }
  // clear any stale autosave for this project
  try {
    fs.rmSync(recoveryPath(project.id), { force: true })
  } catch {
    /* ignore */
  }
  return { projectJson: JSON.stringify(project), mediaAdded }
}

export function recoveryPath(projectId: string): string {
  return path.join(app.getPath('userData'), 'recovery', `${sanitizeSegment(projectId)}.livemock`)
}

export function writeRecovery(projectId: string, projectJson: string): void {
  const dir = path.dirname(recoveryPath(projectId))
  fs.mkdirSync(dir, { recursive: true })
  saveProjectZip(recoveryPath(projectId), projectJson)
}

export function listRecoveries(): { projectId: string; savedAt: string; projectJson: string }[] {
  const dir = path.join(app.getPath('userData'), 'recovery')
  try {
    return fs
      .readdirSync(dir)
      .filter((f) => f.endsWith('.livemock'))
      .map((f) => {
        const fp = path.join(dir, f)
        try {
          const stat = fs.statSync(fp)
          const entry = unzipSync(new Uint8Array(fs.readFileSync(fp)))['project.json']
          if (!entry) return null
          const projectJson = JSON.stringify(migrate(JSON.parse(Buffer.from(entry).toString('utf8'))))
          const parsed = JSON.parse(projectJson)
          return { projectId: parsed.id as string, savedAt: stat.mtime.toISOString(), projectJson }
        } catch {
          return null
        }
      })
      .filter((x): x is { projectId: string; savedAt: string; projectJson: string } => x !== null)
  } catch {
    return []
  }
}

/** Parse dimensions from image headers (PNG/JPEG/WebP/GIF). */
export { probeImageFile } from './mediaProbe'
