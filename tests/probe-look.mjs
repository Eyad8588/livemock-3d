import { _electron as electron } from 'playwright'
import path from 'node:path'
const app = await electron.launch({ args: [path.resolve('out/main/index.js')], env: { ...process.env, NODE_ENV: 'production' } })
const win = await app.firstWindow()
const errors = []
win.on('pageerror', (e) => errors.push(String(e)))
win.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()) })
await win.waitForTimeout(2000)
const discardBtn = await win.$('dialog button')
if (discardBtn) { await discardBtn.click(); await win.waitForTimeout(300) }
await win.selectOption('lm-left select', 'laptop-14')
await win.waitForTimeout(500)
const probe = await win.evaluate(async () => {
  const { store, sceneController } = window.__lmTest
  store.scene.durationSec = 4
  window.__lmModes.apply(store.scene, 'laptop-open', { speed: 1, intensity: 1, angle: 25 })
  // direct composer test
  let fxError = null
  try {
    store.scene.postFx.bloom = true
    sceneController.renderExportFrame(new OffscreenCanvas(320, 180), 1.0, 1)
  } catch (e) { fxError = String(e) }
  // lid eval check
  const dev = store.scene.devices[0]
  const lidKeys = dev.lidAngleDeg?.keys.map(k => [k.t, k.value])
  return { fxError, lidKeys, duration: store.scene.durationSec }
})
console.log('probe:', JSON.stringify(probe))
await win.waitForTimeout(1500)
const t1 = await win.evaluate(() => window.__lmTest.store.time)
console.log('time after 1.5s:', t1, 'errors:', errors.slice(0, 3))
await app.close()
