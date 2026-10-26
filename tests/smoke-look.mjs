// M5 smoke: laptop preset + lid track + post fx toggle render without errors.
import { _electron as electron } from 'playwright'
import path from 'node:path'
const app = await electron.launch({ args: [path.resolve('out/main/index.js')], env: { ...process.env, NODE_ENV: 'production' } })
const win = await app.firstWindow()
const errors = []
win.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()) })
win.on('pageerror', (e) => errors.push(String(e)))
await win.waitForTimeout(2000)
const discardBtn = await win.$('dialog button')
if (discardBtn) { await discardBtn.click(); await win.waitForTimeout(300) }

// laptop + float-tilt (moves device) + lid open mode
await win.selectOption('lm-left select', 'laptop-14')
await win.waitForTimeout(500)
await win.evaluate(() => {
  const { store } = window.__lmTest
  store.setDeviceScreen(store.scene.devices[0].id, {
    kind: 'url', url: 'livemock-test://local/arabic.html',
    viewport: { w: 1512, h: 982, dpr: 1 }, mobileEmulation: false
  })
})
await win.waitForTimeout(6000)
await win.evaluate(() => {
  const { store } = window.__lmTest
  store.scene.durationSec = 4
  window.__lmModes.apply(store.scene, 'laptop-open', { speed: 1, intensity: 1, angle: 25 })
  store.scene.postFx.vignette = true
  store.scene.postFx.filmGrain = true
})
await win.evaluate(() => { window.__lmTest.store.setTime(2.8); window.__lmTest.store.setPlaying(true) })
await win.waitForTimeout(600)
await win.screenshot({ path: 'smoke-look.png' })
const stats = await win.evaluate(() => document.getElementById('stats')?.textContent ?? '')
console.log('stats:', stats)
console.log('console errors:', errors.length ? errors.slice(0, 5) : 'none')
await app.close()
