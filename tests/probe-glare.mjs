import { _electron as electron } from 'playwright'
import path from 'node:path'
const app = await electron.launch({ args: [path.resolve('out/main/index.js')], env: { ...process.env, NODE_ENV: 'production' } })
const win = await app.firstWindow()
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
await win.evaluate(() => {
  const { sceneController } = window.__lmTest
  sceneController.debugCamera().position.set(0, 480, 980)
  sceneController.debugCamera().lookAt(0, 80, 0)
  window.__lmTest.store.setLidAngle(window.__lmTest.store.scene.devices[0].id, 115)
})
await win.waitForTimeout(1000)
await win.screenshot({ path: 'glare-before.png' })
await win.evaluate(() => {
  const { store } = window.__lmTest
  store.patchDevice(store.scene.devices[0].id, { screenGlare: 0.02 }, 'glare test')
})
await win.waitForTimeout(800)
await win.screenshot({ path: 'glare-after.png' })
await app.close()
