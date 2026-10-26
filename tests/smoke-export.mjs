// M4 smoke: deterministic offline render → MP4 → ffprobe verification.
import { _electron as electron } from 'playwright'
import path from 'node:path'

const app = await electron.launch({
  args: [path.resolve('out/main/index.js')],
  env: { ...process.env, NODE_ENV: 'production' }
})
const win = await app.firstWindow()
const errors = []
win.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()) })
win.on('pageerror', (e) => errors.push(String(e)))

await win.waitForTimeout(2500)
const discardBtn = await win.$('dialog button')
if (discardBtn) { await discardBtn.click(); await win.waitForTimeout(300) }

await win.selectOption('lm-left select', 'phone-6.9')
await win.waitForTimeout(400)

await win.evaluate(() => {
  const { store } = window.__lmTest
  store.scene.durationSec = 2
  window.__lmModes.apply(store.scene, 'cinematic-hero', { speed: 1, intensity: 1, angle: 30 })
})
await win.waitForTimeout(300)

const result = await win.evaluate(async () => {
  const started = await new Promise((resolve) => {
    const check = () => (window.__lmTest && window.__lmTest.export) ? resolve(true) : setTimeout(check, 200)
    check()
  })
  if (!started) return { ok: false, error: 'export hook missing' }
  const settings = {
    name: 'test', width: 540, height: 960, fps: 30,
    format: 'mp4-h264', quality: 'fast', transparentBackground: false, motionBlurSamples: 0
  }
  const frames = []
  const out = await window.__lmTest.export(settings, (p) => frames.push(p.frame))
  return { ok: true, path: out.path, verification: out.verification, framesRendered: frames.length }
})
console.log('export result:', result)

if (result.ok && result.path) {
  const verify = await win.evaluate(async (p) => window.livemock.exportVerify(p), result.path)
  console.log('verify:', verify)
}
console.log('console errors:', errors.length ? errors.slice(0, 5) : 'none')
await app.close()
