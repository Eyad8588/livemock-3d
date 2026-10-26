// M2 smoke: live URL source — bundled Arabic test page renders onto the phone.
import { _electron as electron } from 'playwright'
import path from 'node:path'

const app = await electron.launch({
  args: [path.resolve('out/main/index.js')],
  env: { ...process.env, NODE_ENV: 'production' }
})

const win = await app.firstWindow()
const errors = []
win.on('console', (msg) => {
  if (msg.type() === 'error') errors.push(msg.text())
})
win.on('pageerror', (err) => errors.push(String(err)))

await win.waitForTimeout(2000)
const discardBtn = await win.$('dialog button')
if (discardBtn) {
  await discardBtn.click()
  await win.waitForTimeout(300)
}

await win.selectOption('lm-left select', 'phone-6.9')
await win.waitForTimeout(600)

// set a live URL source pointing at the bundled Arabic page (same code path as inspector)
await win.evaluate(() => {
  const { store } = window.__lmTest
  const dev = store.scene.devices[0]
  store.setDeviceScreen(dev.id, {
    kind: 'url',
    url: 'livemock-test://local/arabic.html',
    viewport: { w: 440, h: 956, dpr: 1 },
    mobileEmulation: true
  })
})

// wait for the page to load + frames to stream
await win.waitForTimeout(7000)
await win.screenshot({ path: 'smoke-live.png' })

const info = await win.evaluate(() => {
  return new Promise((resolve) => {
    const off = window.livemock.onLiveEvent((ev) => {
      if (ev.type === 'info') {
        off()
        resolve(ev.payload)
      }
    })
    setTimeout(() => resolve(null), 3000)
  })
})
console.log('live info:', info)

const stats = await win.evaluate(() => document.getElementById('stats')?.textContent ?? '')
console.log('stats:', stats)
console.log('console errors:', errors.length ? errors.slice(0, 5) : 'none')

await app.close()
