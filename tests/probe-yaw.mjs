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
  const { store, sceneController } = window.__lmTest
  const T = window.__lmTest.getThree()
  const rig = sceneController.debugRig(store.scene.devices[0].id)
  sceneController.debugCamera().position.set(0, 260, 420)
  sceneController.debugCamera().lookAt(0, 80, 0)
  // isolate OLED + red texture + DoubleSide
  rig.root.traverse((o) => { if (o.isMesh && o !== rig.screenMesh) o.visible = false })
  const c = document.createElement('canvas')
  c.width = 2; c.height = 2
  const ctx = c.getContext('2d')
  ctx.fillStyle = '#ff0000'
  ctx.fillRect(0, 0, 2, 2)
  const tex = new (window.__lmTest.getThree().CanvasTexture)(c)
  rig.screenMesh.material.map = tex
  rig.screenMesh.material.side = T.DoubleSide
  rig.screenMesh.material.needsUpdate = true
})
await win.waitForTimeout(600)
await win.screenshot({ path: 'probe-5-doubleside.png' })
// measure normal with and without yaw
const m = await win.evaluate(() => {
  const { store, sceneController } = window.__lmTest
  const T = window.__lmTest.getThree()
  const rig = sceneController.debugRig(store.scene.devices[0].id)
  const screen = rig.screenMesh
  const measure = () => {
    rig.root.updateMatrixWorld(true)
    const n = new T.Vector3(0, 0, 1).applyQuaternion(screen.getWorldQuaternion(new T.Quaternion()))
    return { x: +n.x.toFixed(2), y: +n.y.toFixed(2), z: +n.z.toFixed(2) }
  }
  const withYaw = measure()
  rig.root.rotation.y = 0
  const noYaw = measure()
  rig.root.rotation.y = Math.PI
  return { withYaw, noYaw, rootRotY: rig.root.rotation.y, innerRotY: screen.parent.rotation.y }
})
console.log(JSON.stringify(m))
await app.close()
