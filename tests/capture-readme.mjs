// Captures README screenshots: export dialogs + a close-up of a video playing on a screen.
// Usage: npm run build && node tests/capture-readme.mjs [outDir]
import { launch, waitForGlb } from './lib-launch.mjs'
import fs from 'node:fs'
const out = process.argv[2] ?? 'docs/screenshots'
fs.mkdirSync(out, { recursive: true })
const { app, win, errors } = await launch({ width: 1600, height: 960 })
await win.getByRole('button', { name: '✨ Mac + iPhone' }).click()
await waitForGlb(win, 2, 60000)
await win.waitForTimeout(2500)
await win.evaluate(() => { window.__lmTest.store.setPlaying(false); window.__lmTest.store.setTime(2.5) })
await win.waitForTimeout(800)
// video export dialog
await win.getByRole('button', { name: 'Export', exact: true }).click()
await win.waitForTimeout(700)
await win.locator('dialog[open]').screenshot({ path: `${out}/export-video-dialog.png` })
await win.keyboard.press('Escape')
await win.waitForTimeout(300)
// frame export dialog
await win.locator('[data-testid="export-frame-options"]').click()
await win.waitForTimeout(500)
await win.locator('dialog[open]').screenshot({ path: `${out}/export-frame-dialog.png` })
await win.keyboard.press('Escape')
await win.waitForTimeout(300)
// close-up: iPhone screen playing the video
await win.evaluate(() => {
  const { store, sceneController } = window.__lmTest
  const phone = store.scene.devices[1]
  const p = phone.transform.keys[0].value.position
  // freeze the animated camera so the orbit view sticks
  store.scene.camera.position.keys = store.scene.camera.position.keys.slice(0, 1)
  store.scene.camera.target.keys = store.scene.camera.target.keys.slice(0, 1)
  store.scene.camera.position.keys[0].value = { x: p.x - 150, y: 150, z: p.z + 330 }
  store.scene.camera.target.keys[0].value = { x: p.x + 5, y: 82, z: p.z }
  store.setTime(1.2)
  store.setPlaying(true)
})
await win.waitForTimeout(1600)
await win.locator('lm-viewport').screenshot({ path: `${out}/video-playing-on-iphone.png` })
console.log('errors', errors.slice(0, 5))
await app.close()
