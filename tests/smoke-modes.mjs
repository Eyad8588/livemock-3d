// M3 smoke: apply Cinematic Hero, verify keyframes generated + playback moves camera.
import { _electron as electron } from 'playwright'
import path from 'node:path'

const app = await electron.launch({
  args: [path.resolve('out/main/index.js')],
  env: { ...process.env, NODE_ENV: 'production' }
})
const win = await app.firstWindow()
const errors = []
win.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()) })
win.on('pageerror', (e) => errors.push(String(e)))

await win.waitForTimeout(2000)
const discardBtn = await win.$('dialog button')
if (discardBtn) { await discardBtn.click(); await win.waitForTimeout(300) }

await win.selectOption('lm-left select', 'phone-6.9')
await win.waitForTimeout(500)

const before = await win.evaluate(() => {
  const { store } = window.__lmTest
  return { camKeys: store.scene.camera.position.keys.length, time: store.time }
})

// apply mode via the store path (same as dialog Apply)
await win.evaluate(() => {
  const { store } = window.__lmTest
  const mod = window.__lmModes
  mod.apply(store.scene, 'cinematic-hero', { speed: 1, intensity: 1, angle: 30 })
})
await win.evaluate(() => { window.__lmTest.store.setPlaying(true) })
await win.waitForTimeout(2500)

const after = await win.evaluate(() => {
  const { store } = window.__lmTest
  return {
    camKeys: store.scene.camera.position.keys.length,
    time: store.time,
    pos: store.scene.camera.position.keys.map((k) => [k.t, Math.round(k.value.z)]),
    playing: store.playing
  }
})
console.log('before:', before)
console.log('after:', after)
await win.screenshot({ path: 'smoke-modes.png' })
console.log('console errors:', errors.length ? errors.slice(0, 5) : 'none')
await app.close()
