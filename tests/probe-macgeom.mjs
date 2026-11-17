// Dump GLB mesh structure + screen quad pose; screenshot from several angles.
import { launch, waitForGlb } from './lib-launch.mjs'
const preset = process.argv[2] ?? 'glb-macbook-16'
const out = process.argv[3] ?? '.'
const { app, win, errors } = await launch()
await win.evaluate((p) => window.__lmTest.store.addDevice(p), preset)
await waitForGlb(win, 1)
const info = await win.evaluate(() => {
  const { store, sceneController } = window.__lmTest
  const THREE = sceneController.debugThree()
  const rig = sceneController.debugRig(store.scene.devices[0].id)
  rig.root.updateMatrixWorld(true)
  const rows = []
  rig.root.traverse((o) => {
    if (!o.isMesh) return
    const b = new THREE.Box3().setFromObject(o)
    const m = Array.isArray(o.material) ? o.material[0] : o.material
    const f = (v) => `${v.x.toFixed(1)},${v.y.toFixed(1)},${v.z.toFixed(1)}`
    rows.push(`${o.visible ? 'V' : 'h'} ${o.name.slice(0, 28).padEnd(28)} min ${f(b.min)} max ${f(b.max)} mat=${(m?.name ?? '').slice(0, 20)} em=${m?.emissiveMap ? 'map' : ''}${m?.emissive ? m.emissive.getHexString() : ''} tr=${m?.transparent ? 1 : 0} tx=${m?.transmission ?? ''}`)
  })
  const s = rig.screenMesh
  const p = s.getWorldPosition(new THREE.Vector3())
  return { rows, screen: { pos: [p.x, p.y, p.z], w: rig.screenWmm, h: rig.screenHmm }, lid: rig.lidPivot ? [rig.lidPivot.position.x, rig.lidPivot.position.y, rig.lidPivot.position.z, rig.lidPivot.rotation.x] : null }
})
console.log(info.rows.join('\n'))
console.log('screen', info.screen, 'lid', info.lid)
const views = JSON.parse(process.env.VIEWS ?? '{"front":[0,150,700],"side":[700,150,0],"top3q":[350,400,550]}')
const tgt = JSON.parse(process.env.TGT ?? '[0,90,0]')
for (const [name, pos] of Object.entries(views)) {
  await win.evaluate((a) => { const pos = a.slice(0,3), tgt = a.slice(3)
    const { sceneController } = window.__lmTest
    sceneController.lookFrom({ x: pos[0], y: pos[1], z: pos[2] }, { x: tgt[0], y: tgt[1], z: tgt[2] })
  }, [pos, tgt].flat())
  await win.waitForTimeout(400)
  await win.locator('canvas').first().screenshot({ path: `${out}/geom-${name}.png` })
}
console.log('errors', errors.slice(0, 4))
await app.close()
