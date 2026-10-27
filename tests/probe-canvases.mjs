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
  const quadCanvas = rig.screenMesh.material?.map?.image
  // all 2D canvases in the doc with page-ish size
  const all = [...document.querySelectorAll('canvas')]
  const report = all.map((c, i) => {
    let px = null
    try {
      const ctx = c.getContext('2d')
      if (ctx && c.width > 300) {
        const d = ctx.getImageData(Math.floor(c.width / 2), Math.floor(c.height * 0.08), 1, 1).data
        px = [d[0], d[1], d[2]]
      }
    } catch { px = 'unreadable' }
    return { i, w: c.width, h: c.height, px, isQuadMap: c === quadCanvas, connected: c.isConnected }
  }).filter((c) => c.w > 300)
  return { quadMapSize: quadCanvas ? [quadCanvas.width, quadCanvas.height] : null, quadConnected: quadCanvas?.isConnected, report }
})
console.log(JSON.stringify(info, null, 1))
await app.close()
