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
  const dev = store.scene.devices[0]
  const rig = sceneController.debugRig(dev.id)
  const mat = rig.screenMesh.material
  const canvas = mat?.map?.image
  let pixels = null
  if (canvas?.getContext) {
    const ctx = canvas.getContext('2d')
    const pts = [[0.5, 0.08], [0.5, 0.5], [0.5, 0.9], [0.1, 0.3]]
    pixels = pts.map(([fx, fy]) => {
      const d = ctx.getImageData(Math.floor(fx * canvas.width), Math.floor(fy * canvas.height), 1, 1).data
      return [d[0], d[1], d[2]]
    })
  }
  return {
    screenNode: rig.screenMesh.type,
    mapIsCanvas: !!mat?.map?.isCanvasTexture,
    canvasSize: canvas ? [canvas.width, canvas.height] : null,
    pixels,
    quadPos: rig.screenMesh.position.toArray().map((v) => Math.round(v)),
    screenWmm: Math.round(rig.screenWmm),
    screenHmm: Math.round(rig.screenHmm)
  }
})
console.log(JSON.stringify(info, null, 1))
await app.close()
