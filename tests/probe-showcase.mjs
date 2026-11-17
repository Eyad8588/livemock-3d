// Quick look-dev probe: build the showcase, export PNG frames at given times.
import { launch, waitForGlb } from './lib-launch.mjs'
import fs from 'node:fs'
const out = process.argv[2] ?? '.'
const times = (process.argv[3] ?? '0,3,6').split(',').map(Number)
const size = process.argv[4] ?? '16:9-1080'
fs.mkdirSync(out, { recursive: true })
const { app, win, errors } = await launch({ width: 1600, height: 960 })
await win.getByRole('button', { name: '✨ Mac + iPhone' }).click()
await waitForGlb(win, 2, 60000)
if (process.env.ENV) {
  await win.evaluate((env) => window.__lmTest.store.edit('env', (p) => { const s = p.scenes.find((x) => x.id === window.__lmTest.store.scene.id); Object.assign(s.environment, JSON.parse(env)) }), process.env.ENV)
}
await win.waitForTimeout(2000)
for (const t of times) {
  const p = await win.evaluate(async ({ t, size }) => {
    window.__lmTest.store.setPlaying(false)
    window.__lmTest.store.setTime(t)
    await new Promise((r) => setTimeout(r, 300))
    return window.__lmTest.exportFrameNow({ size, longEdge: 1920, transparent: false, editorCamera: false })
  }, { t, size })
  fs.copyFileSync(p, `${out}/show-${process.env.TAG ?? ''}${size.replace(/[:]/g, 'x')}-${t}s.png`)
}
await win.screenshot({ path: `${out}/show-app.png` })
console.log('errors', errors.slice(0, 5))
await app.close()
