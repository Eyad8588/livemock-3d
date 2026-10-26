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
await win.evaluate(() => {
  const { sceneController } = window.__lmTest
  sceneController.debugCamera().position.set(0, 260, 420)
  sceneController.debugCamera().lookAt(0, 80, 0)
})
await win.waitForTimeout(500)

const setVis = (name, visible) => win.evaluate(([n, v]) => {
  const { store, sceneController } = window.__lmTest
  const rig = sceneController.debugRig(store.scene.devices[0].id)
  rig.root.traverse((o) => { if (o.isMesh && o.name === n) o.visible = v })
}, [name, visible])

// baseline
await win.screenshot({ path: 'probe-0-baseline.png' })
// hide Display_Frame
await setVis('Object_12', false)
await win.waitForTimeout(400)
await win.screenshot({ path: 'probe-1-noframe.png' })
// also hide Glass
await setVis('Object_17', false)
await win.waitForTimeout(400)
await win.screenshot({ path: 'probe-2-noglass.png' })
// hide Metal_mesh too
await setVis('Object_16', false)
await win.waitForTimeout(400)
await win.screenshot({ path: 'probe-3-nomesh.png' })
// material info
const mats = await win.evaluate(() => {
  const { store, sceneController } = window.__lmTest
  const rig = sceneController.debugRig(store.scene.devices[0].id)
  const out = []
  rig.root.traverse((o) => {
    if (o.isMesh && ['Object_12', 'Object_16', 'Object_17', 'Object_19'].includes(o.name)) {
      const m = Array.isArray(o.material) ? o.material[0] : o.material
      out.push({ node: o.name, visible: o.visible, type: m?.type, color: m?.color ? '#' + m.color.getHexString() : null, transparent: m?.transparent, opacity: m?.opacity, transmission: m?.transmission, hasMap: !!m?.map, alphaTest: m?.alphaTest })
    }
  })
  return out
})
console.log(JSON.stringify(mats, null, 1))
await app.close()
