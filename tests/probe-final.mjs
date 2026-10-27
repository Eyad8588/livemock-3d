import { _electron as electron } from 'playwright'
import path from 'node:path'
const app = await electron.launch({ args: [path.resolve('out/main/index.js')], env: { ...process.env, NODE_ENV: 'production' } })
const win = await app.firstWindow()
win.on('console', (m) => { if (m.text().includes('lid-debug')) console.log(m.text()) })
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
const info = await win.evaluate(() => {
  const { store, sceneController } = window.__lmTest
  const T = window.__lmTest.getThree()
  const rig = sceneController.debugRig(store.scene.devices[0].id)
  sceneController.prepareFrame(0)
  rig.root.updateMatrixWorld(true)
  const quad = rig.screenMesh
  // world corners of the quad
  const corners = []
  const geo = quad.geometry
  const pos = geo.attributes.position
  for (let i = 0; i < pos.count; i++) {
    const v = new T.Vector3().fromBufferAttribute(pos, i)
    quad.localToWorld(v)
    corners.push([+v.x.toFixed(0), +v.y.toFixed(0), +v.z.toFixed(0)])
  }
  const pivot = rig.lidPivot
  return {
    quadWorldCorners: corners,
    pivotPos: pivot ? pivot.position.toArray().map((v) => Math.round(v)) : null,
    pivotRotXDeg: pivot ? Math.round((pivot.rotation.x * 180) / Math.PI) : null,
    quadParentType: quad.parent === rig.root ? 'root' : quad.parent === pivot ? 'lidPivot' : 'other',
    parentScale: quad.parent ? quad.parent.scale.toArray().map((v) => +v.toFixed(2)) : null
  }
})
console.log(JSON.stringify(info, null, 1))
// isolated red screenshot
await win.evaluate(() => {
  const { store, sceneController } = window.__lmTest
  const T = window.__lmTest.getThree()
  const rig = sceneController.debugRig(store.scene.devices[0].id)
  rig.root.traverse((o) => { if (o.isMesh && o !== rig.screenMesh && o !== rig.glareMesh) o.visible = false })
  if (rig.glareMesh) rig.glareMesh.visible = false
  const m = rig.screenMesh.material
  m.map = null
  m.color.set(0xff0000)
  m.side = T.DoubleSide
  m.needsUpdate = true
  sceneController.debugCamera().position.set(0, 480, 980)
  sceneController.debugCamera().lookAt(0, 80, 0)
})
await win.waitForTimeout(700)
await win.screenshot({ path: 'final-red.png' })
await app.close()
