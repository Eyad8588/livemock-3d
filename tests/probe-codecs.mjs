import { _electron as electron } from 'playwright'
import path from 'node:path'
const app = await electron.launch({ args: [path.resolve('out/main/index.js')], env: { ...process.env, NODE_ENV: 'production' } })
const win = await app.firstWindow()
await win.waitForTimeout(2500)
const probe = await win.evaluate(async () => {
  const hasVE = typeof VideoEncoder !== 'undefined'
  let avc = null
  try {
    const s = await VideoEncoder.isConfigSupported({ codec: 'avc1.640028', width: 540, height: 960, bitrate: 4_000_000, framerate: 30 })
    avc = s.supported
  } catch (e) { avc = 'throw: ' + String(e) }
  let portOk = null
  try {
    const p = await window.livemock.exportFfmpegConnect()
    portOk = typeof p.postMessage
  } catch (e) { portOk = 'throw: ' + String(e) }
  return { hasVE, avc, portOk }
})
console.log(probe)
await app.close()
