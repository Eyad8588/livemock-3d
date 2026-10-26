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
const info = await win.evaluate(() => {
  const { store, sceneController } = window.__lmTest
  const T = window.__lmTest.getThree()
  const rig = sceneController.debugRig(store.scene.devices[0].id)
  sceneController.prepareFrame(0)
  rig.root.updateMatrixWorld(true)
  const screen = rig.screenMesh
  const normal = new T.Vector3(0, 0, 1).applyQuaternion(screen.getWorldQuaternion(new T.Quaternion()))
  const pos = screen.getWorldPosition(new T.Vector3())
  const cam = sceneController.debugCamera().position
  // face dot: is the front facing the camera?
  const toCam = cam.clone().sub(pos).normalize()
  return {
    screenWorldPos: { x: +pos.x.toFixed(1), y: +pos.y.toFixed(1), z: +pos.z.toFixed(1) },
    normal: { x: +normal.x.toFixed(2), y: +normal.y.toFixed(2), z: +normal.z.toFixed(2) },
    facesCamera: +normal.dot(toCam).toFixed(2),
    rootWorldPos: { x: +rig.root.position.x.toFixed(1), y: +rig.root.position.y.toFixed(1), z: +rig.root.position.z.toFixed(1) }
  }
})
console.log(JSON.stringify(info))
await app.close()
