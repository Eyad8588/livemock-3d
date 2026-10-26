import { _electron as electron } from 'playwright'
import path from 'node:path'
const app = await electron.launch({ args: [path.resolve('out/main/index.js')], env: { ...process.env, NODE_ENV: 'production' } })
const win = await app.firstWindow()
const errors = []
win.on('pageerror', (e) => errors.push(String(e)))
await win.waitForTimeout(2000)
const discardBtn = await win.$('dialog button')
if (discardBtn) { await discardBtn.click(); await win.waitForTimeout(300) }
await win.selectOption('lm-left select', 'laptop-14')
await win.waitForTimeout(500)
const r = await win.evaluate(async () => {
  const { store } = window.__lmTest
  store.setTime(0)
  store.setPlaying(true)
  const samples = []
  for (let i = 0; i < 10; i++) {
    await new Promise((res) => setTimeout(res, 300))
    samples.push({ t: Number(store.time.toFixed(3)), playing: store.playing })
  }
  return samples
})
console.log(r.map((s) => s.t).join(' '))
console.log('playing still:', r[r.length - 1].playing, 'errors:', errors.slice(0, 3))
await app.close()
