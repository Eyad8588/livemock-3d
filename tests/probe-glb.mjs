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
await win.waitForTimeout(12000)
const info = await win.evaluate(() => {
  const { store, sceneController } = window.__lmTest
  const dev = store.scene.devices[0]
  const rig = sceneController.debugRig(dev.id)
  const picked = rig.screenMesh
  const pickedMat = picked.material
  // list all meshes + material names + whether they share the material
  const meshes = []
  rig.root.traverse((o) => {
    if (o.isMesh) {
      const m = Array.isArray(o.material) ? o.material[0] : o.material
      meshes.push({ node: o.name, mat: m?.name, isScreenMat: m === pickedMat, hasMap: !!m?.map, hasEmissive: !!m?.emissiveMap })
    }
  })
  return { pickedNode: picked.name, pickedMatName: pickedMat?.name, pickedHasMap: !!pickedMat?.map, meshCount: meshes.length, screenCandidates: meshes.filter((m) => /oled|display|glass/i.test(m.mat ?? '')) }
})
console.log(JSON.stringify(info, null, 1))
await app.close()
