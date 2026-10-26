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
  const out = { screenNode: rig.screenMesh.name, screenHasMap: !!rig.screenMesh.material?.map, mapIsCanvas: rig.screenMesh.material?.map?.isCanvasTexture, canvasSize: rig.screenMesh.material?.map?.image ? [rig.screenMesh.material.map.image.width, rig.screenMesh.material.map.image.height] : null }
  const others = []
  rig.root.traverse((o) => {
    if (o.isMesh && o !== rig.screenMesh) {
      const m = Array.isArray(o.material) ? o.material[0] : o.material
      if (/glass/i.test(o.name) || m?.transmission > 0 || (m?.transparent && o.name !== 'Object_18')) {
        others.push({ node: o.name, transparent: m?.transparent, opacity: m?.opacity, transmission: m?.transmission, color: m?.color ? '#' + m.color.getHexString() : null })
      }
    }
  })
  out.glassMeshes = others
  return out
})
console.log(JSON.stringify(info, null, 1))
await app.close()
