import { _electron as electron } from 'playwright'
import path from 'node:path'
const app = await electron.launch({ args: [path.resolve('out/main/index.js')], env: { ...process.env, NODE_ENV: 'production' } })
const win = await app.firstWindow()
const errors = []
win.on('pageerror', (e) => errors.push(String(e).slice(0, 200)))
await win.waitForTimeout(2200)
const dlgBtns = await win.$$('dialog button')
for (const b of dlgBtns) { await b.click().catch(() => {}); await win.waitForTimeout(200) }
await win.evaluate(() => {
  const { store } = window.__lmTest
  store.addDevice('glb-macbook-16')
  const dev = store.scene.devices[0]
  store.setDeviceScreen(dev.id, { kind: 'url', url: 'livemock-test://local/english.html', viewport: { w: 1728, h: 1117, dpr: 1 }, mobileEmulation: false })
})
await win.waitForTimeout(15000)
const cam = (px, py, pz, tx, ty, tz) => win.evaluate(([a, b, c, d, e, f]) => {
  const { sceneController } = window.__lmTest
  sceneController.debugCamera().position.set(a, b, c)
  sceneController.debugCamera().lookAt(d, e, f)
}, [px, py, pz, tx, ty, tz])
await cam(0, 480, 980, 0, 80, 0)
await win.evaluate(() => { window.__lmTest.store.setLidAngle(window.__lmTest.store.scene.devices[0].id, 115) })
await win.waitForTimeout(1200)
await win.screenshot({ path: 'enh2-open.png' })
await win.evaluate(() => { window.__lmTest.store.setLidAngle(window.__lmTest.store.scene.devices[0].id, 45) })
await win.waitForTimeout(1200)
await win.screenshot({ path: 'enh2-45.png' })
// placement: phone next to laptop with auto-frame
await win.evaluate(() => { window.__lmTest.store.addDevice('phone-6.9') })
await win.waitForTimeout(1800)
await win.screenshot({ path: 'enh2-placement.png' })
console.log('errors:', errors.length ? errors.slice(0, 4) : 'none')
await app.close()
