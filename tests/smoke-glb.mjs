// GLB device presets: iPhone 17 Pro Max + MacBook Pro 16" load, map screens.
import { _electron as electron } from 'playwright'
import path from 'node:path'
const app = await electron.launch({ args: [path.resolve('out/main/index.js')], env: { ...process.env, NODE_ENV: 'production' } })
const win = await app.firstWindow()
const errors = []
win.on('pageerror', (e) => errors.push(String(e).slice(0, 300)))
win.on('console', (m) => { if (m.type() === 'error') errors.push(m.text().slice(0, 300)) })
await win.waitForTimeout(2200)
const discardBtn = await win.$('dialog button')
if (discardBtn) { await discardBtn.click(); await win.waitForTimeout(300) }
const frBtns = await win.$$('dialog button')
for (const b of frBtns) { const t = await b.textContent(); if (t?.includes('sample')) { /* skip */ } }

// iPhone GLB
await win.evaluate(() => {
  const { store } = window.__lmTest
  store.addDevice('glb-iphone-17-pro-max')
  const dev = store.scene.devices[0]
  store.setDeviceScreen(dev.id, {
    kind: 'url', url: 'livemock-test://local/arabic.html',
    viewport: { w: 440, h: 956, dpr: 1 }, mobileEmulation: true
  })
})
await win.waitForTimeout(11000) // 24MB GLB load + page render
await win.evaluate(() => { window.__lmTest.store.setTime(0); window.__lmTest.store.setPlaying(false) })
await win.evaluate(() => {
  const { sceneController } = window.__lmTest
  sceneController.debugCamera().position.set(60, 260, 420)
  sceneController.debugCamera().lookAt(0, 80, 0)
})
await win.waitForTimeout(1200)
await win.screenshot({ path: 'smoke-glb-iphone.png' })

// MacBook GLB alongside
await win.evaluate(() => {
  const { store } = window.__lmTest
  store.addDevice('glb-macbook-16')
  const dev = store.scene.devices[1]
  store.setDeviceScreen(dev.id, {
    kind: 'url', url: 'livemock-test://local/english.html',
    viewport: { w: 1728, h: 1117, dpr: 1 }, mobileEmulation: false
  })
  const p = dev.transform.keys[0].value.position
  p.x = 320; p.z = -140
})
await win.waitForTimeout(14000)
await win.evaluate(() => {
  const { sceneController } = window.__lmTest
  sceneController.debugCamera().position.set(0, 420, 900)
  sceneController.debugCamera().lookAt(100, 100, 0)
})
await win.waitForTimeout(1200)
await win.screenshot({ path: 'smoke-glb-macbook.png' })
console.log('console errors:', errors.length ? errors.slice(0, 6) : 'none')
await app.close()
