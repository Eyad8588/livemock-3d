import { _electron as electron } from 'playwright'
import path from 'node:path'
const app = await electron.launch({ args: [path.resolve('out/main/index.js')], env: { ...process.env, NODE_ENV: 'production' } })
const win = await app.firstWindow()
await win.waitForTimeout(2000)
const discardBtn = await win.$('dialog button')
if (discardBtn) { await discardBtn.click(); await win.waitForTimeout(300) }
await win.selectOption('lm-left select', 'laptop-14')
await win.waitForTimeout(600)
const probe = await win.evaluate(() => {
  const { sceneController, store } = window.__lmTest
  const dev = store.scene.devices[0]
  sceneController.prepareFrame(3.4)
  const info = sceneController.debugScreenInfo(dev.id)
  return {
    lidRotXDeg: Math.round((info.lidRotX * 180) / Math.PI),
    screenNormal: { x: +info.normal.x.toFixed(2), y: +info.normal.y.toFixed(2), z: +info.normal.z.toFixed(2) },
    screenPos: { x: Math.round(info.position.x), y: Math.round(info.position.y), z: Math.round(info.position.z) },
    camera: { x: Math.round(info.camera.x), y: Math.round(info.camera.y), z: Math.round(info.camera.z) }
  }
})
console.log(JSON.stringify(probe))
await app.close()
