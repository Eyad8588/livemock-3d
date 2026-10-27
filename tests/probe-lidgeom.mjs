import { _electron as electron } from 'playwright'
import path from 'node:path'
const app = await electron.launch({ args: [path.resolve('out/main/index.js')], env: { ...process.env, NODE_ENV: 'production' } })
const win = await app.firstWindow()
await win.waitForTimeout(2200)
const discardBtn = await win.$('dialog button')
if (discardBtn) { await discardBtn.click(); await win.waitForTimeout(300) }
await win.evaluate(() => {
  const { store } = window.__lmTest
  store.addDevice('glb-macbook-16')
})
await win.waitForTimeout(15000)
const out = await win.evaluate(() => {
  const { store, sceneController } = window.__lmTest
  const T = window.__lmTest.getThree()
  const rig = sceneController.debugRig(store.scene.devices[0].id)
  rig.root.updateMatrixWorld(true)
  const meshes = []
  rig.root.traverse((o) => {
    if (o.isMesh) {
      const b = new T.Box3().setFromObject(o)
      const c = b.getCenter(new T.Vector3())
      const s = b.getSize(new T.Vector3())
      const mat = Array.isArray(o.material) ? o.material[0] : o.material
      meshes.push({ n: o.name, cx: +c.x.toFixed(0), cy: +c.y.toFixed(0), cz: +c.z.toFixed(0), sx: +s.x.toFixed(0), sy: +s.y.toFixed(0), sz: +s.z.toFixed(0), em: !!mat?.emissiveMap, vis: o.visible })
    }
  })
  return { count: meshes.length, meshes }
})
console.log(JSON.stringify(out.meshes.sort((a, b) => a.cz - b.cz), null, 0))
await app.close()
