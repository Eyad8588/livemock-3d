// Shared Playwright-Electron launcher for the e2e probes. Uses an isolated
// user-data dir so it never fights the single-instance lock of a running copy.
import { _electron as electron } from 'playwright'
import path from 'node:path'
import os from 'node:os'
import fs from 'node:fs'

export async function launch({ width = 1500, height = 920 } = {}) {
  const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'livemock-e2e-'))
  const app = await electron.launch({
    args: [path.resolve('out/main/index.js'), `--user-data-dir=${userData}`],
    env: { ...process.env, NODE_ENV: 'production' }
  })
  const win = await app.firstWindow()
  const errors = []
  win.on('console', (m) => { if (m.type() === 'error') errors.push(m.text().slice(0, 300)) })
  win.on('pageerror', (e) => errors.push(String(e).slice(0, 300)))
  await app.evaluate(({ BrowserWindow }, s) => {
    const w = BrowserWindow.getAllWindows()[0]
    w.setSize(s.width, s.height)
    w.center()
  }, { width, height })
  await win.waitForFunction(() => !!window.__lmTest, null, { timeout: 20000 })
  await win.waitForTimeout(900)
  // dismiss recovery / first-run dialogs
  for (let i = 0; i < 3; i++) {
    const open = await win.$('dialog[open]')
    if (!open) break
    await win.evaluate(() => document.querySelectorAll('dialog[open]').forEach((d) => d.close()))
    await win.waitForTimeout(200)
  }
  return { app, win, errors }
}

/** Import files from disk through the real main-process import path. */
export async function importFiles(win, files) {
  return win.evaluate(async (paths) => {
    const { store } = window.__lmTest
    const entries = await window.livemock.importMediaFromPaths(paths, store.project.id)
    store.addMedia(entries)
    return entries
  }, files.map((f) => path.resolve(f)))
}

export async function waitForGlb(win, count, timeout = 40000) {
  await win.waitForFunction((n) => {
    const { store, sceneController } = window.__lmTest
    const devs = store.scene.devices
    if (devs.length < n) return false
    return devs.every((d) => {
      const rig = sceneController.debugRig(d.id)
      return rig && rig.root.userData && rig.root.userData.glb === true
    })
  }, count, { timeout })
}
