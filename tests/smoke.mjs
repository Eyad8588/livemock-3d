// Smoke test: launch app, dismiss recovery, add phone, import image onto it,
// save project to disk, reopen, verify round-trip.
import { _electron as electron } from 'playwright'
import path from 'node:path'
import fs from 'node:fs'
import os from 'node:os'

const app = await electron.launch({
  args: [path.resolve('out/main/index.js')],
  env: { ...process.env, NODE_ENV: 'production' }
})

const win = await app.firstWindow()
const errors = []
win.on('console', (msg) => {
  if (msg.type() === 'error') errors.push(msg.text())
})
win.on('pageerror', (err) => errors.push(String(err)))

await win.waitForTimeout(2000)

// dismiss recovery dialog if present
const discardBtn = await win.$('dialog button')
if (discardBtn) {
  await discardBtn.click()
  await win.waitForTimeout(300)
}

// add a phone
await win.selectOption('lm-left select', 'phone-6.9')
await win.waitForTimeout(800)

// generate a small test image (4x4 blue PNG)
const pngB64 = 'iVBORw0KGgoAAAANSUhEUgAAAAQAAAAECAYAAACp8Z5+AAAAFElEQVR4nGP8z8DAwMDAxAADDw4EAAOkAgoecG6IAAAAAElFTkSuQmCC'
const imgPath = path.join(os.tmpdir(), 'livemock-test.png')
fs.writeFileSync(imgPath, Buffer.from(pngB64, 'base64'))

// import via the real IPC path
const mediaEntry = await win.evaluate(async (p) => {
  const api = window.livemock
  const entries = await api.importMediaFromPaths([p], '__smoke__')
  return entries[0] ?? null
}, imgPath)
console.log('media entry:', mediaEntry && { name: mediaEntry.name, kind: mediaEntry.kind, w: mediaEntry.width, h: mediaEntry.height })

// assign to the phone via the store (same code path as dblclick in UI)
await win.evaluate((id) => {
  const { store } = window.__lmTest
  const dev = store.scene.devices[0]
  store.setDeviceScreen(dev.id, { kind: 'image', mediaId: id, fit: 'fit' })
}, mediaEntry.id)
await win.waitForTimeout(1500)

// save project to disk via zip path, then reopen
const projPath = path.join(os.tmpdir(), 'livemock-smoke.livemock')
const saveRes = await win.evaluate(async (p) => {
  const api = window.livemock
  const json = JSON.stringify(window.__lmTest.store.project)
  return api.saveProjectToPath(p, json)
}, projPath)
console.log('save ok:', saveRes.ok, 'exists:', fs.existsSync(projPath), 'size:', fs.existsSync(projPath) ? fs.statSync(projPath).size : 0)

await win.evaluate(async (p) => {
  const res = await window.livemock.openRecentProject(p)
  window.__lmTest.reopened = res
}, projPath)
await win.waitForTimeout(1500)
const reopenedDevices = await win.evaluate(() => {
  const res = window.__lmTest.reopened
  const project = JSON.parse(res.projectJson)
  return { devices: project.scenes[0].devices.length, source: project.scenes[0].devices[0]?.screen?.kind }
})
console.log('reopened:', reopenedDevices)

await win.screenshot({ path: 'smoke-phone.png' })
const stats = await win.evaluate(() => document.getElementById('stats')?.textContent ?? '')
console.log('stats:', stats)
console.log('console errors:', errors.length ? errors : 'none')

await app.close()
