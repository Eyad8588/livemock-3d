import { _electron as electron } from 'playwright'
import path from 'node:path'
const app = await electron.launch({ args: [path.resolve('out/main/index.js')], env: { ...process.env, NODE_ENV: 'production' } })
const win = await app.firstWindow()
await win.waitForTimeout(2200)
const discardBtn = await win.$('dialog button')
if (discardBtn) { await discardBtn.click(); await win.waitForTimeout(300) }
await win.evaluate(() => {
  const { store } = window.__lmTest
  store.addDevice('glb-iphone-17-pro-max')
  const dev = store.scene.devices[0]
  store.setDeviceScreen(dev.id, { kind: 'url', url: 'livemock-test://local/arabic.html', viewport: { w: 440, h: 956, dpr: 1 }, mobileEmulation: true })
})
await win.waitForTimeout(13000)
await win.evaluate(() => {
  const { sceneController } = window.__lmTest
  sceneController.debugCamera().position.set(0, 260, 420)
  sceneController.debugCamera().lookAt(0, 80, 0)
})

// hide every mesh EXCEPT the screen
const r = await win.evaluate(() => {
  const { store, sceneController } = window.__lmTest
  const rig = sceneController.debugRig(store.scene.devices[0].id)
  rig.root.traverse((o) => {
    if (o.isMesh && o !== rig.screenMesh) o.visible = false
  })
  // ALSO replace the map with a plain 2x2 red CanvasTexture to eliminate provider doubts
  const c = document.createElement('canvas')
  c.width = 2; c.height = 2
  const ctx = c.getContext('2d')
  ctx.fillStyle = '#ff0000'
  ctx.fillRect(0, 0, 2, 2)
  const T = window.__lmTest.getThree()
  const tex = new T.CanvasTexture(c)
  rig.screenMesh.material.map = tex
  rig.screenMesh.material.needsUpdate = true
  window.__THREE = window.THREE
  return 'isolated'
})
console.log(r)
await win.waitForTimeout(800)
await win.screenshot({ path: 'probe-4-oled-only-red.png' })
await app.close()
