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
  const p = rig.lidPivot
  const quad = rig.screenMesh
  const r = (v) => Math.round(v * 10) / 10
  // world positions with a manual full update
  sceneController.prepareFrame(0)
  rig.root.updateMatrixWorld(true)
  const quadWorld = quad.getWorldPosition(new T.Vector3())
  const pivotWorld = p.getWorldPosition(new T.Vector3())
  return {
    lidCloseRadDeg: r((rig.lidCloseRad ?? 0) * 180 / Math.PI),
    lidOpenDeg: rig.lidOpenDeg,
    pivotPosLocal: p.position.toArray().map(r),
    pivotRotXDeg: r(p.rotation.x * 180 / Math.PI),
    quadLocalInPivot: quad.position.toArray().map(r),
    quadWorld: quadWorld.toArray().map(r),
    pivotWorld: pivotWorld.toArray().map(r),
    lidAngleTrack: store.scene.devices[0].lidAngleDeg?.keys[0]?.value
  }
})
console.log(JSON.stringify(info, null, 1))
await app.close()
