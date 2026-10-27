import { _electron as electron } from 'playwright'
import path from 'node:path'
import fs from 'node:fs'
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
const dataUrl = await win.evaluate(() => {
  const { store, sceneController } = window.__lmTest
  const rig = sceneController.debugRig(store.scene.devices[0].id)
  const canvas = rig.screenMesh.material?.map?.image
  if (!canvas) return null
  return canvas.toDataURL('image/png')
})
if (dataUrl) {
  fs.writeFileSync('probe-quad-canvas.png', Buffer.from(dataUrl.split(',')[1], 'base64'))
  console.log('saved probe-quad-canvas.png', dataUrl.length)
} else {
  console.log('no canvas')
}
await app.close()
