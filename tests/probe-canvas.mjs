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
  const dev = store.scene.devices[0]
  const rig = sceneController.debugRig(dev.id)
  const mat = rig.screenMesh.material
  const tex = mat?.map
  const canvas = tex?.image
  let px = null
  if (canvas?.getContext) {
    const ctx = canvas.getContext('2d')
    const d = ctx.getImageData(Math.floor(canvas.width / 2), Math.floor(canvas.height / 4), 1, 1).data
    px = [d[0], d[1], d[2]]
  }
  const uv = rig.screenMesh.geometry?.attributes?.uv
  let uvRange = null
  if (uv) {
    let minU = 1e9, maxU = -1e9, minV = 1e9, maxV = -1e9
    for (let i = 0; i < uv.count; i++) {
      const u = uv.getX(i), v = uv.getY(i)
      minU = Math.min(minU, u); maxU = Math.max(maxU, u)
      minV = Math.min(minV, v); maxV = Math.max(maxV, v)
    }
    uvRange = { minU: +minU.toFixed(3), maxU: +maxU.toFixed(3), minV: +minV.toFixed(3), maxV: +maxV.toFixed(3) }
  }
  return {
    mapIsCanvas: !!tex?.isCanvasTexture,
    canvasW: canvas?.width,
    canvasH: canvas?.height,
    centerPixel: px,
    uvRange,
    matColor: '#' + mat?.color?.getHexString(),
    toneMapped: mat?.toneMapped
  }
})
console.log(JSON.stringify(info))
await app.close()
