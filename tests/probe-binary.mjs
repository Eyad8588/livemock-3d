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
  const { store, sceneController } = window.__lmTest
  const T = window.__lmTest.getThree()
  const rig = sceneController.debugRig(store.scene.devices[0].id)
  // hide glare, kill map, loud magenta, DoubleSide
  if (rig.glareMesh) rig.glareMesh.visible = false
  const m = rig.screenMesh.material
  m.map = null
  m.color.set(0xff00ff)
  m.side = T.DoubleSide
  m.needsUpdate = true
  sceneController.debugCamera().position.set(0, 480, 980)
  sceneController.debugCamera().lookAt(0, 80, 0)
})
await win.waitForTimeout(900)
await win.screenshot({ path: 'binary-magenta.png' })
// also dump scene graph around the quad: what meshes exist near the display?
const near = await win.evaluate(() => {
  const { store, sceneController } = window.__lmTest
  const T = window.__lmTest.getThree()
  const rig = sceneController.debugRig(store.scene.devices[0].id)
  rig.root.updateMatrixWorld(true)
  const sc = rig.screenMesh.position.clone()
  const nearMeshes = []
  rig.root.traverse((o) => {
    if (o.isMesh && o.visible) {
      const wp = o.getWorldPosition(new T.Vector3())
      const d = wp.distanceTo(rig.screenMesh.getWorldPosition(new T.Vector3()))
      if (d < 260) {
        const mat = Array.isArray(o.material) ? o.material[0] : o.material
        nearMeshes.push({ name: o.name || '(unnamed)', dist: Math.round(d), color: mat?.color ? '#' + mat.color.getHexString() : null, map: !!mat?.map, transparent: mat?.transparent, opacity: +((mat?.opacity ?? 1).toFixed(2)), transmission: +(mat?.transmission ?? 0).toFixed(2), isQuad: o === rig.screenMesh })
      }
    }
  })
  void sc
  return nearMeshes.sort((a, b) => a.dist - b.dist).slice(0, 10)
})
console.log(JSON.stringify(near, null, 1))
await app.close()
