// Enhancements: MacBook lid control + screen fit on GLB + placement/toolbar.
import { _electron as electron } from 'playwright'
import path from 'node:path'
const app = await electron.launch({ args: [path.resolve('out/main/index.js')], env: { ...process.env, NODE_ENV: 'production' } })
const win = await app.firstWindow()
const errors = []
win.on('pageerror', (e) => errors.push(String(e).slice(0, 200)))
win.on('console', (m) => { if (m.type() === 'error') errors.push(m.text().slice(0, 200)) })
await win.waitForTimeout(2200)
const dlgBtns = await win.$$('dialog button')
for (const b of dlgBtns) { await b.click().catch(() => {}); await win.waitForTimeout(200) }

// MacBook GLB with live URL
await win.evaluate(() => {
  const { store } = window.__lmTest
  store.addDevice('glb-macbook-16')
  const dev = store.scene.devices[0]
  store.setDeviceScreen(dev.id, { kind: 'url', url: 'livemock-test://local/english.html', viewport: { w: 1728, h: 1117, dpr: 1 }, mobileEmulation: false })
})
await win.waitForTimeout(15000) // model + page load

// closed lid
await win.evaluate(() => { window.__lmTest.store.setLidAngle(window.__lmTest.store.scene.devices[0].id, 0) })
await win.waitForTimeout(1200)
await win.evaluate(() => {
  const { sceneController } = window.__lmTest
  sceneController.debugCamera().position.set(-60, 320, 700)
  sceneController.debugCamera().lookAt(0, 60, 0)
})
await win.waitForTimeout(600)
await win.screenshot({ path: 'enh-lid-closed.png' })

// half open
await win.evaluate(() => { window.__lmTest.store.setLidAngle(window.__lmTest.store.scene.devices[0].id, 45) })
await win.waitForTimeout(1200)
await win.screenshot({ path: 'enh-lid-45.png' })

// fully open
await win.evaluate(() => { window.__lmTest.store.setLidAngle(window.__lmTest.store.scene.devices[0].id, 115) })
await win.waitForTimeout(1200)
await win.screenshot({ path: 'enh-lid-open.png' })

// placement: add a phone — auto-framing + spacing
await win.evaluate(() => { window.__lmTest.store.addDevice('phone-6.9') })
await win.waitForTimeout(1500)
await win.screenshot({ path: 'enh-placement.png' })

console.log('errors:', errors.length ? errors.slice(0, 5) : 'none')
await app.close()
