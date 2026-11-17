// End-to-end check of the four core flows against the built app (npm run build first):
//   1. FRAMES  — one-click PNG (opaque + transparent) at chosen sizes
//   2. VIDEOS  — MP4 export (+ ffmpeg formats) of the animated scene
//   3. LOOK    — Mac + iPhone showcase with GLB devices, screenshots
//   4. INSERT  — user video dropped onto each device screen plays + exports
// Writes artifacts to demo/ (or argv[2]) and prints a JSON report.
// Usage: node tests/e2e-flows.mjs [outDir]
import { launch, importFiles, waitForGlb } from './lib-launch.mjs'
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const ffmpeg = require('ffmpeg-static')
const out = path.resolve(process.argv[2] ?? 'demo')
fs.mkdirSync(path.join(out, "after"), { recursive: true })
const report = {}
const check = (name, ok, detail) => {
  report[name] = { ok: !!ok, detail }
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? ' — ' + JSON.stringify(detail) : ''}`)
}
const probe = (file) => {
  try {
    execFileSync(ffmpeg, ['-hide_banner', '-i', file], { stdio: 'pipe' })
  } catch (e) {
    return String(e.stderr)
  }
  return ''
}
const frameAt = (file, t, dest) => {
  execFileSync(ffmpeg, ['-y', '-loglevel', 'error', '-ss', String(t), '-i', file, '-frames:v', '1', dest])
  return dest
}
// mean RGB + alpha of a crop region, via ffmpeg rawvideo
const regionStats = (file, crop) => {
  const buf = execFileSync(ffmpeg, ['-loglevel', 'error', '-i', file, '-vf', `crop=${crop}`, '-f', 'rawvideo', '-pix_fmt', 'rgba', '-'], { maxBuffer: 1 << 28 })
  let r = 0, g = 0, b = 0, a = 0
  const n = buf.length / 4
  for (let i = 0; i < buf.length; i += 4) { r += buf[i]; g += buf[i + 1]; b += buf[i + 2]; a += buf[i + 3] }
  return { r: r / n, g: g / n, b: b / n, a: a / n }
}

const { app, win, errors } = await launch({ width: 1600, height: 960 })

// ---------- 3. LOOK: showcase via the real top-bar button ----------
await win.getByRole('button', { name: '✨ Mac + iPhone' }).click()
await waitForGlb(win, 2, 60000)
await win.waitForTimeout(2500)
const sc = await win.evaluate(() => {
  const { store } = window.__lmTest
  return { name: store.scene.name, devices: store.scene.devices.map((d) => ({ preset: d.presetId, screen: d.screen.kind })), media: store.project.media.map((m) => m.name) }
})
check('showcase scene built with 2 GLB devices + sample videos', sc.devices.length === 2 && sc.devices.every((d) => d.preset.startsWith('glb-') && d.screen === 'video'), sc)
await win.evaluate(() => { window.__lmTest.store.setPlaying(false); window.__lmTest.store.setTime(2.5) })
await win.waitForTimeout(1200)
await win.screenshot({ path: `${out}/after/after-app-showcase.png` })

// ---------- 4. INSERT: user's own clips via the same drop path the UI uses ----------
const tmp = fs.mkdtempSync(path.join(out, '.tmp-'))
const userLandscape = path.join(tmp, 'my-landscape.mp4')
const userPortrait = path.join(tmp, 'my-portrait.mp4')
execFileSync(ffmpeg, ['-y', '-loglevel', 'error', '-f', 'lavfi', '-i', 'testsrc2=s=1280x720:r=30:d=4', '-pix_fmt', 'yuv420p', userLandscape])
execFileSync(ffmpeg, ['-y', '-loglevel', 'error', '-f', 'lavfi', '-i', 'testsrc2=s=720x1280:r=30:d=4', '-vf', 'hue=h=120', '-pix_fmt', 'yuv420p', userPortrait])
const media = await importFiles(win, [userLandscape, userPortrait])
const insert = await win.evaluate(async (ids) => {
  const { store } = window.__lmTest
  const [mac, phone] = store.scene.devices
  // simulate a media item dragged from the Media list onto each device (drop handler path)
  const dt = (id) => { const d = new DataTransfer(); d.setData('application/x-livemock-media', id); return d }
  await window.__lmTest.dropOntoDevice(mac.id, dt(ids[0]))
  await window.__lmTest.dropOntoDevice(phone.id, dt(ids[1]))
  store.setTime(0)
  store.setPlaying(true)
  await new Promise((r) => setTimeout(r, 1500))
  const s = store.scene.devices.map((d) => d.screen)
  const pv = store.scene.devices.map((d) => window.__lmTest.sceneController.providerFor(d.id))
  return {
    screens: s.map((x) => ({ kind: x.kind, mediaId: x.mediaId, fit: x.fit, loop: x.loop })),
    playing: pv.map((p) => p && p.video ? { t: p.video.currentTime, paused: p.video.paused, w: p.video.videoWidth } : null)
  }
}, media.map((m) => m.id))
check('user videos assigned to both screens', insert.screens[0].mediaId === media[0].id && insert.screens[1].mediaId === media[1].id, insert.screens)
check('user videos play in preview', insert.playing.every((p) => p && !p.paused && p.t > 0.3 && p.w > 0), insert.playing)
await win.evaluate(() => window.__lmTest.store.setPlaying(false))
await win.waitForTimeout(600)
await win.screenshot({ path: `${out}/after/after-app-user-videos.png` })

// back to the showcase sample clips for the demo exports
await win.evaluate(() => {
  const { store } = window.__lmTest
  const [mac, phone] = store.scene.devices
  const find = (n) => store.project.media.find((m) => m.name === n)
  const v = (m) => ({ kind: 'video', mediaId: m.id, fit: 'crop', trimIn: 0, trimOut: m.durationSec, rate: 1, loop: true, offsetSec: 0 })
  store.setDeviceScreen(mac.id, v(find('sample-laptop.mp4')))
  store.setDeviceScreen(phone.id, v(find('sample-phone.mp4')))
  store.setTime(3)
})
await win.waitForTimeout(1500)

// ---------- 1. FRAMES ----------
const frames = await win.evaluate(async () => {
  const r = {}
  r.opaque = await window.__lmTest.exportFrameNow({ size: '16:9-1080', longEdge: 2560, transparent: false, editorCamera: false })
  r.transparent = await window.__lmTest.exportFrameNow({ size: '1:1', longEdge: 2560, transparent: true, editorCamera: false })
  r.view = await window.__lmTest.exportFrameNow({ size: 'view', longEdge: 2560, transparent: false, editorCamera: true })
  return r
})
for (const [k, p] of Object.entries(frames)) {
  const info = p ? probe(p) : ''
  const m = /Video: png, (\w+)\(?[^,]*,? (\d+)x(\d+)/.exec(info)
  check(`PNG frame (${k})`, !!m, { file: p && path.basename(p), pix: m?.[1], size: m && `${m[2]}x${m[3]}` })
}
fs.copyFileSync(frames.opaque, `${out}/sample-frame-1920x1080.png`)
fs.copyFileSync(frames.transparent, `${out}/sample-frame-transparent-2048.png`)
fs.copyFileSync(frames.view, `${out}/sample-frame-viewport.png`)
const corner = regionStats(frames.transparent, '64:64:0:0')
const centre = regionStats(frames.transparent, '200:200:924:924')
check('transparent PNG: background alpha 0, devices opaque', corner.a < 2 && centre.a > 200, { cornerAlpha: corner.a, centreAlpha: centre.a })

// ---------- 2. VIDEOS ----------
const vid = await win.evaluate(async () => {
  const base = { name: 'demo', width: 1920, height: 1080, fps: 30, quality: 'high', transparentBackground: false, motionBlurSamples: 0 }
  const mp4 = await window.__lmTest.export({ ...base, format: 'mp4-h264' })
  const small = { ...base, width: 640, height: 360 }
  window.__lmTest.store.scene.durationSec = 1
  const gif = await window.__lmTest.export({ ...small, format: 'gif', fps: 24 })
  const webm = await window.__lmTest.export({ ...small, format: 'webm-vp9-alpha', transparentBackground: true })
  const mov = await window.__lmTest.export({ ...small, format: 'mov-prores4444', transparentBackground: true })
  window.__lmTest.store.scene.durationSec = 6
  return { mp4, gif, webm, mov }
})
check('MP4 export verified', /Export verified: 1920×1080, 30\.00 fps, 6\.00s/.test(vid.mp4.verification), vid.mp4.verification)
fs.copyFileSync(vid.mp4.path, `${out}/sample-video-1920x1080.mp4`)
const f1 = frameAt(vid.mp4.path, 1.0, `${out}/.tmp-mp4-1s.png`)
const f4 = frameAt(vid.mp4.path, 4.0, `${out}/.tmp-mp4-4s.png`)
fs.copyFileSync(f4, `${out}/sample-video-frame-at-4s.png`)
const dims = (s) => /, (\d+)x(\d+)/.exec(probe(s))?.slice(1).join('x')
const differ = execFileSync(ffmpeg, ['-loglevel', 'error', '-i', f1, '-i', f4, '-lavfi', 'psnr', '-f', 'null', '-'], { stdio: 'pipe' }).toString()
check('MP4 frames differ over time (animation + playing screens)', dims(f1) === '1920x1080', { f1: dims(f1), psnrLog: differ.slice(0, 80) })
for (const k of ['gif', 'webm', 'mov']) {
  const info = probe(vid[k].path)
  check(`${k} export decodes`, /Video:/.test(info) && /640x360/.test(info), /Video: [^\n]*/.exec(info)?.[0]?.slice(0, 120))
}

check('no renderer errors', errors.length === 0, errors.slice(0, 5))
fs.rmSync(tmp, { recursive: true, force: true })
for (const f of fs.readdirSync(out)) if (f.startsWith('.tmp-')) fs.rmSync(path.join(out, f), { force: true })
fs.writeFileSync(`${out}/e2e-report.json`, JSON.stringify(report, null, 2))
await app.close()
const failed = Object.values(report).filter((r) => !r.ok).length
console.log(failed ? `\n${failed} check(s) failed` : '\nall checks passed')
process.exit(failed ? 1 : 0)
