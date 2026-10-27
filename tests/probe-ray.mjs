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
const info = await win.evaluate(() => {
  const { store, sceneController } = window.__lmTest
  const T = window.__lmTest.getThree()
  const rig = sceneController.debugRig(store.scene.devices[0].id)
  sceneController.prepareFrame(0)
  sceneController.debugCamera().position.set(0, 480, 980)
  sceneController.debugCamera().lookAt(0, 80, 0)
  rig.root.updateMatrixWorld(true)
  const target = rig.screenMesh.getWorldPosition(new T.Vector3())
  const camPos = sceneController.debugCamera().position.clone()
  const dir = target.clone().sub(camPos).normalize()
  const ray = new T.Raycaster(camPos, dir)
  ray.far = 3000
  const hits = ray.intersectObject(rig.root, true)
  const quadDist = hits.find((h) => h.object === rig.screenMesh)?.distance ?? null
  return {
    quadWorld: target.toArray().map((v) => Math.round(v)),
    hits: hits.slice(0, 8).map((h) => {
      const mat = Array.isArray(h.object.material) ? h.object.material[0] : h.object.material
      return {
        name: h.object.name || '(quad)',
        isQuad: h.object === rig.screenMesh,
        dist: Math.round(h.distance * 10) / 10,
        vis: h.object.visible,
        faceNormal: h.face ? { x: +h.face.normal.x.toFixed(2), y: +h.face.normal.y.toFixed(2), z: +h.face.normal.z.toFixed(2) } : null,
        color: mat?.color ? '#' + mat.color.getHexString() : null,
        map: !!mat?.map,
        opacity: mat?.opacity
      }
    }),
    quadDist
  }
})
console.log(JSON.stringify(info, null, 1))
await app.close()
