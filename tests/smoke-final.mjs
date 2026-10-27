// Final verification: iPhone GLB (Arabic) + MacBook GLB (English) both render live pages.
import { _electron as electron } from 'playwright'
import path from 'node:path'
const app = await electron.launch({ args: [path.resolve('out/main/index.js')], env: { ...process.env, NODE_ENV: 'production' } })
const win = await app.firstWindow()
const errors = []
win.on('pageerror', (e) => errors.push(String(e).slice(0, 150)))
await win.waitForTimeout(2200)
const dlgBtns = await win.$$('dialog button')
for (const b of dlgBtns) { await b.click().catch(() => {}); await win.waitForTimeout(200) }
await win.evaluate(() => {
  const { store } = window.__lmTest
  store.addDevice('glb-macbook-16')
  store.setDeviceScreen(store.scene.devices[0].id, { kind: 'url', url: 'livemock-test://local/english.html', viewport: { w: 1728, h: 1117, dpr: 1 }, mobileEmulation: false })
  store.addDevice('glb-iphone-17-pro-max')
  const dev = store.scene.devices[1]
  const t = dev.transform.keys[0].value.position
  t.x = 420; t.z = 60
  store.setDeviceScreen(dev.id, { kind: 'url', url: 'livemock-test://local/arabic.html', viewport: { w: 440, h: 956, dpr: 1 }, mobileEmulation: true })
})
await win.waitForTimeout(16000)
await win.evaluate(() => {
  const { sceneController } = window.__lmTest
  sceneController.debugCamera().position.set(-120, 420, 900)
  sceneController.debugCamera().lookAt(180, 100, 0)
})
await win.waitForTimeout(800)
await win.screenshot({ path: 'final-both.png' })
console.log('errors:', errors.length ? errors.slice(0, 4) : 'none')
await app.close()
