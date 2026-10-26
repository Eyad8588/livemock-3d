// M7 smoke: first-run flow + sample project.
import { _electron as electron } from 'playwright'
import path from 'node:path'
const app = await electron.launch({ args: [path.resolve('out/main/index.js')], env: { ...process.env, NODE_ENV: 'production' } })
const win = await app.firstWindow()
const errors = []
win.on('pageerror', (e) => errors.push(String(e)))
win.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()) })
await win.waitForTimeout(2000)

// force first-run to show
await win.evaluate(() => localStorage.removeItem('livemock.firstRunDone'))
await win.reload()
await win.waitForTimeout(3000)

let dlgText = await win.evaluate(() => document.querySelector('dialog')?.textContent?.slice(0, 60) ?? 'no dialog')
console.log('dialog:', dlgText)

// dismiss recovery dialog if it appeared over the first-run one
const dlgCount = await win.evaluate(() => document.querySelectorAll('dialog').length)
if (dlgCount > 1) {
  await win.evaluate(() => document.querySelectorAll('dialog')[0]?.close())
  await win.waitForTimeout(300)
}

// click "Open sample project"
const clicked = await win.evaluate(() => {
  const dlg = document.querySelector('dialog')
  if (!dlg) return false
  const btns = [...dlg.querySelectorAll('button')]
  const sample = btns.find((b) => b.textContent?.includes('sample project'))
  if (!sample) return false
  sample.click()
  return true
})
console.log('sample clicked:', clicked)
await win.waitForTimeout(8000) // let the live page load + play
await win.screenshot({ path: 'smoke-firstrun.png' })
const state = await win.evaluate(() => ({
  devices: window.__lmTest.store.scene.devices.length,
  source: window.__lmTest.store.scene.devices[0]?.screen.kind,
  time: Number(window.__lmTest.store.time.toFixed(2)),
  playing: window.__lmTest.store.playing
}))
console.log('state:', state)
console.log('console errors:', errors.length ? errors.slice(0, 5) : 'none')
await app.close()
