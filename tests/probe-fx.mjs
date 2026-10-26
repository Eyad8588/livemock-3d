import { _electron as electron } from 'playwright'
import path from 'node:path'
const app = await electron.launch({ args: [path.resolve('out/main/index.js')], env: { ...process.env, NODE_ENV: 'production' } })
const win = await app.firstWindow()
const errors = []
win.on('pageerror', (e) => errors.push(String(e).slice(0, 300)))
await win.evaluate(() => {
  window.addEventListener('error', (e) => { window.__lastErr = String(e.message) + ' @ ' + String(e.filename).slice(-40) + ':' + e.lineno })
  window.addEventListener('unhandledrejection', (e) => { window.__lastErr = 'rej: ' + String(e.reason).slice(0, 200) })
})
await win.waitForTimeout(1500)
const discardBtn = await win.$('dialog button')
if (discardBtn) { await discardBtn.click(); await win.waitForTimeout(300) }
await win.selectOption('lm-left select', 'laptop-14')
await win.waitForTimeout(400)
const r = await win.evaluate(async () => {
  const { store } = window.__lmTest
  store.scene.durationSec = 4
  store.scene.postFx.bloom = true
  store.scene.postFx.vignette = true
  store.setTime(0)
  store.setPlaying(true)
  const samples = []
  for (let i = 0; i < 6; i++) {
    await new Promise((res) => setTimeout(res, 400))
    samples.push(Number(store.time.toFixed(2)))
  }
  return { samples, lastErr: window.__lastErr ?? null }
})
console.log(JSON.stringify(r), 'pageerrors:', errors.slice(0, 3))
await app.close()
