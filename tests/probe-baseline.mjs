// Baseline probe: both GLB devices + sample videos, screenshot, PNG-still + MP4 export.
import { launch, importFiles } from './lib-launch.mjs'
import fs from 'node:fs'

const out = process.argv[2] ?? 'demo/before'
fs.mkdirSync(out, { recursive: true })
const { app, win, errors } = await launch()

const media = await importFiles(win, ['assets/sample-media/sample-laptop.mp4', 'assets/sample-media/sample-phone.mp4'])
console.log('imported', media.map((m) => `${m.kind} ${m.width}x${m.height} ${m.durationSec}s`))
await win.evaluate((media) => {
  const { store } = window.__lmTest
  store.addDevice('glb-macbook-16')
  store.addDevice('glb-iphone-17-pro-max')
  const [mac, phone] = store.scene.devices
  const v = (m) => ({ kind: 'video', mediaId: m.id, fit: 'fit', trimIn: 0, trimOut: m.durationSec ?? 5, rate: 1, loop: true, offsetSec: 0 })
  store.setDeviceScreen(mac.id, v(media[0]))
  store.setDeviceScreen(phone.id, v(media[1]))
  store.setPlaying(true)
}, media)
await win.waitForTimeout(16000)
await win.screenshot({ path: `${out}/app-window.png` })

const res = await win.evaluate(async () => {
  const r = {}
  const base = { name: 't', width: 1920, height: 1080, fps: 30, quality: 'high', transparentBackground: false, motionBlurSamples: 0 }
  window.__lmTest.store.setPlaying(false)
  window.__lmTest.store.scene.durationSec = 3
  try { r.png = await window.__lmTest.export({ ...base, format: 'png-still' }) } catch (e) { r.png = String(e) }
  try { r.mp4 = await window.__lmTest.export({ ...base, format: 'mp4-h264' }) } catch (e) { r.mp4 = String(e) }
  return r
})
console.log(JSON.stringify(res, null, 1))
console.log('errors:', errors.slice(0, 8))
await app.close()
