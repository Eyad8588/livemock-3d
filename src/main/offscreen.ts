// Offscreen live-page sources (SPEC §4.1). Each source owns a hidden,
// sandboxed BrowserWindow rendering into a bitmap we throttle + stream to the
// renderer. Security: dedicated partition, permissions denied, downloads and
// file:// blocked.

import { BrowserWindow, session, type NativeImage, type WebContents } from 'electron'
import { registerOffscreenProtocolHandlers } from './index'
import { IPC, type LiveInputEvent, type LiveStartRequest } from '../shared/ipc'
import { EASING_SCRIPT } from '../shared/easingMath'
import type { LivePageInfo, WalkthroughStep } from '../shared/types'

const PREVIEW_MAX_SIDE = 900
const PREVIEW_FPS_MS = 1000 / 30
const INFO_POLL_MS = 500

let sessionConfigured = false

function configureOffscreenSession(): void {
  if (sessionConfigured) return
  sessionConfigured = true
  const ses = session.fromPartition('persist:livemock-offscreen')
  registerOffscreenProtocolHandlers(ses.protocol)
  const deny = (_wc: unknown, _perm: unknown, callback: (allow: boolean) => void) => callback(false)
  ses.setPermissionRequestHandler(deny)
  ses.setPermissionCheckHandler(() => false)
  ses.on('will-download', (e) => e.preventDefault())
  ses.setPreloads([])
  ses.setSpellCheckerEnabled(false)
}

interface LiveSource {
  key: string
  win: BrowserWindow
  wc: WebContents
  req: LiveStartRequest
  frameId: number
  latest: { image: NativeImage; width: number; height: number } | null
  flushTimer: NodeJS.Timeout
  infoTimer: NodeJS.Timeout
  lastScrollY: number
  lastScrollHeight: number
  destroyed: boolean
  easingInjected: boolean
}

const sources = new Map<string, LiveSource>()

function isMainWindow(wc: WebContents): boolean {
  return (wc as unknown as { __isMain?: boolean }).__isMain === true
}

function sendToRenderer(ev: unknown): void {
  for (const win of BrowserWindow.getAllWindows()) {
    if (!win.webContents.isDestroyed() && isMainWindow(win.webContents)) {
      win.webContents.send(IPC.LiveEvent, ev)
    }
  }
}

function swizzleBgraToRgba(buf: Buffer): void {
  const n = buf.length
  for (let i = 0; i < n; i += 4) {
    const b = buf[i]!
    buf[i] = buf[i + 2]!
    buf[i + 2] = b
  }
}

function flushFrame(src: LiveSource): void {
  if (src.destroyed || !src.latest) return
  const { image } = src.latest
  if (image.isEmpty()) return
  let img = image
  const size = img.getSize()
  const longest = Math.max(size.width, size.height)
  if (longest > PREVIEW_MAX_SIDE) {
    const scale = PREVIEW_MAX_SIDE / longest
    img = image.resize({ width: Math.max(2, Math.round(size.width * scale)), height: Math.max(2, Math.round(size.height * scale)) })
  }
  const s2 = img.getSize()
  const buf = img.toBitmap()
  swizzleBgraToRgba(buf)
  const payload = {
    sourceKey: src.key,
    width: s2.width,
    height: s2.height,
    data: buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength),
    frameId: ++src.frameId,
    pageScrollY: src.lastScrollY,
    pageHeight: src.lastScrollHeight
  }
  sendToRenderer({ type: 'frame', payload })
}

async function pollInfo(src: LiveSource): Promise<void> {
  if (src.destroyed || src.wc.isDestroyed()) return
  try {
    const info = (await src.wc.executeJavaScript(
      `({ y: Math.round(window.scrollY), h: Math.max(document.documentElement.scrollHeight, 1), t: document.title, u: location.href })`,
      true
    )) as { y: number; h: number; t: string; u: string }
    src.lastScrollY = info.y
    src.lastScrollHeight = info.h
    const payload: LivePageInfo = {
      sourceKey: src.key,
      title: info.t,
      url: info.u,
      scrollY: info.y,
      scrollHeight: info.h,
      viewportW: src.req.viewport.w,
      viewportH: src.req.viewport.h,
      loadOk: true
    }
    sendToRenderer({ type: 'info', payload })
  } catch {
    /* page navigating */
  }
}

async function applyMobileEmulation(src: LiveSource): Promise<void> {
  if (!src.req.mobileEmulation) return
  const { w, h } = src.req.viewport
  const ua =
    'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Mobile Safari/537.36'
  try {
    const dbg = src.wc.debugger
    dbg.attach('1.3')
    await dbg.sendCommand('Emulation.setDeviceMetricsOverride', {
      width: w,
      height: h,
      deviceScaleFactor: 1,
      mobile: true,
      screenWidth: w,
      screenHeight: h
    })
    await dbg.sendCommand('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 })
    await dbg.sendCommand('Network.setUserAgentOverride', {
      userAgent: ua,
      userAgentMetadata: {
        brands: [{ brand: 'Chromium', version: '131' }],
        mobile: true,
        platform: 'Android',
        platformVersion: '14',
        architecture: '',
        model: 'Pixel 8'
      }
    })
  } catch (err) {
    // fallback: UA via webContents API at least
    src.wc.setUserAgent(ua)
    console.warn('[livemock] mobile emulation via CDP failed:', err)
  }
}

export function liveStart(req: LiveStartRequest): void {
  const existing = sources.get(req.sourceKey)
  if (existing) {
    if (existing.req.url !== req.url || existing.req.viewport.w !== req.viewport.w || existing.req.viewport.h !== req.viewport.h || existing.req.mobileEmulation !== req.mobileEmulation) {
      liveStop(req.sourceKey)
    } else {
      return
    }
  }
  configureOffscreenSession()
  const ses = session.fromPartition('persist:livemock-offscreen')

  const win = new BrowserWindow({
    show: false,
    useContentSize: true,
    width: req.viewport.w,
    height: req.viewport.h,
    webPreferences: {
      offscreen: true,
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
      session: ses,
      backgroundThrottling: false,
      spellcheck: false
    }
  })
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
  win.webContents.on('will-navigate', (e, url) => {
    if (!/^https?:\/\//i.test(url)) e.preventDefault()
  })
  win.webContents.on('paint', (_e, _dirty, image) => {
    const src = sources.get(req.sourceKey)
    if (!src || src.destroyed) return
    const size = image.getSize()
    src.latest = { image, width: size.width, height: size.height }
  })
  win.webContents.on('render-process-gone', (_e, details) => {
    sendToRenderer({ type: 'error', sourceKey: req.sourceKey, message: `Page crashed: ${details.reason}` })
  })

  const src: LiveSource = {
    key: req.sourceKey,
    win,
    wc: win.webContents,
    req,
    frameId: 0,
    latest: null,
    flushTimer: setInterval(() => flushFrame(sources.get(req.sourceKey) as LiveSource), PREVIEW_FPS_MS),
    infoTimer: setInterval(() => void pollInfo(sources.get(req.sourceKey) as LiveSource), INFO_POLL_MS),
    lastScrollY: 0,
    lastScrollHeight: 1,
    destroyed: false,
    easingInjected: false
  }
  sources.set(req.sourceKey, src)

  win.loadURL(req.url, { userAgent: req.mobileEmulation ? 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Mobile Safari/537.36' : undefined }).catch((err) => {
    sendToRenderer({ type: 'error', sourceKey: req.sourceKey, message: `Failed to load: ${String(err)}` })
  })
  void applyMobileEmulation(src)
}

export function liveStop(sourceKey: string): void {
  const src = sources.get(sourceKey)
  if (!src) return
  src.destroyed = true
  clearInterval(src.flushTimer)
  clearInterval(src.infoTimer)
  try {
    src.wc.debugger.detach()
  } catch {
    /* not attached */
  }
  sources.delete(sourceKey)
  if (!src.win.isDestroyed()) src.win.destroy()
}

export function liveNavigate(sourceKey: string, url: string): void {
  const src = sources.get(sourceKey)
  if (!src) return
  void src.win.loadURL(url).catch((err) => {
    sendToRenderer({ type: 'error', sourceKey, message: `Failed to navigate: ${String(err)}` })
  })
}

export function liveInput(sourceKey: string, ev: LiveInputEvent): void {
  const src = sources.get(sourceKey)
  if (!src) return
  try {
    switch (ev.type) {
      case 'mouseWheel':
        src.wc.sendInputEvent({ type: 'mouseWheel', x: ev.x ?? 0, y: ev.y ?? 0, deltaX: ev.deltaX ?? 0, deltaY: ev.deltaY ?? 0 })
        break
      case 'char':
        if (ev.char) src.wc.insertText(ev.char)
        break
      case 'mousePressed':
      case 'mouseReleased':
        src.wc.sendInputEvent({
          type: ev.type === 'mousePressed' ? 'mouseDown' : 'mouseUp',
          x: ev.x ?? 0,
          y: ev.y ?? 0,
          button: ev.button ?? 'left',
          clickCount: 1
        })
        break
      case 'mouseMoved':
        src.wc.sendInputEvent({ type: 'mouseMove', x: ev.x ?? 0, y: ev.y ?? 0 })
        break
      case 'keyDown':
        src.wc.sendInputEvent({ type: 'keyDown', keyCode: ev.text ?? '' })
        break
    }
  } catch (err) {
    console.warn('[livemock] liveInput failed:', err)
  }
}

export function liveEval(sourceKey: string, expr: string): Promise<unknown> {
  const src = sources.get(sourceKey)
  if (!src) return Promise.reject(new Error('Live source not active'))
  return src.wc.executeJavaScript(expr, true)
}

export function stopAllLive(): void {
  for (const key of [...sources.keys()]) liveStop(key)
}

// ---------- walkthrough ----------

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms))
}

async function injectEasing(src: LiveSource): Promise<void> {
  if (src.easingInjected) return
  await src.wc.executeJavaScript(EASING_SCRIPT, true)
  src.easingInjected = true
}

const SMOOTH_SCROLL = `(async (toY, dur, easingId, bezier) => {
  if (!window.__lmEase) return;
  const startY = window.scrollY; const t0 = performance.now();
  await new Promise((res) => {
    function step(now){ const p = dur<=0?1:Math.min(1,(now-t0)/dur); window.scrollTo(0, startY + (toY-startY)*window.__lmEase(easingId,p,bezier)); if(p<1) requestAnimationFrame(step); else res(undefined); }
    requestAnimationFrame(step);
  });
  return window.scrollY;
})`

async function centerOf(src: LiveSource, selector: string): Promise<{ x: number; y: number } | null> {
  const r = (await src.wc.executeJavaScript(
    `(function(){ const el = document.querySelector(${JSON.stringify(selector)}); if(!el) return null; const r = el.getBoundingClientRect(); return {x: r.left + r.width/2, y: r.top + r.height/2}; })()`,
    true
  )) as { x: number; y: number } | null
  return r
}

/** Run the walkthrough on a live source. Returns wall-clock duration ms. */
export async function runWalkthrough(
  sourceKey: string,
  steps: WalkthroughStep[],
  forceRepaint: () => void
): Promise<number> {
  const src = sources.get(sourceKey)
  if (!src) throw new Error('Live source not active')
  await injectEasing(src)
  const t0 = Date.now()
  for (const step of steps) {
    if (src.destroyed) break
    switch (step.type) {
      case 'wait':
        await sleep(step.ms)
        break
      case 'scroll':
        await src.wc
          .executeJavaScript(`${SMOOTH_SCROLL}(${JSON.stringify(step.toY)}, ${step.durationMs}, ${JSON.stringify(step.easing)}, null)`, true)
          .catch(() => undefined)
        forceRepaint()
        break
      case 'scrollToSelector': {
        const sel = step.selector
        const target = (await src.wc
          .executeJavaScript(
            `(function(){ const el=document.querySelector(${JSON.stringify(sel)}); if(!el) return null; const r=el.getBoundingClientRect(); return Math.round(r.top + window.scrollY - window.innerHeight/2 + r.height/2); })()`,
            true
          )
          .catch(() => null)) as number | null
        if (target !== null) {
          await src.wc
            .executeJavaScript(`${SMOOTH_SCROLL}(${target}, ${step.durationMs}, ${JSON.stringify(step.easing)}, null)`, true)
            .catch(() => undefined)
        }
        forceRepaint()
        break
      }
      case 'tap': {
        const { x, y } = step
        if (step.showRipple) sendToRenderer({ type: 'ripple', sourceKey, x, y })
        src.wc.sendInputEvent({ type: 'mouseDown', x, y, button: 'left', clickCount: 1 })
        src.wc.sendInputEvent({ type: 'mouseUp', x, y, button: 'left', clickCount: 1 })
        await sleep(350)
        break
      }
      case 'tapSelector': {
        const c = await centerOf(src, step.selector).catch(() => null)
        if (c) {
          if (step.showRipple) sendToRenderer({ type: 'ripple', sourceKey, x: c.x, y: c.y })
          src.wc.sendInputEvent({ type: 'mouseDown', x: c.x, y: c.y, button: 'left', clickCount: 1 })
          src.wc.sendInputEvent({ type: 'mouseUp', x: c.x, y: c.y, button: 'left', clickCount: 1 })
        }
        await sleep(350)
        break
      }
      case 'type': {
        const sel = step.selector
        await src.wc
          .executeJavaScript(
            `(function(){ const el=document.querySelector(${JSON.stringify(sel)}); if(el){ el.focus(); } })()`,
            true
          )
          .catch(() => undefined)
        const perChar = Math.max(8, 60_000 / Math.max(60, step.cpm))
        for (const ch of step.text) {
          await src.wc.insertText(ch).catch(() => undefined)
          await sleep(perChar)
        }
        break
      }
    }
  }
  return Date.now() - t0
}

/** Force the offscreen page to repaint (used during take recording). */
export function invalidate(sourceKey: string): void {
  const src = sources.get(sourceKey)
  if (src && !src.destroyed && !src.wc.isDestroyed()) {
    try {
      src.wc.invalidate()
    } catch {
      /* ignore */
    }
  }
}

export function captureLatest(sourceKey: string): { image: NativeImage; width: number; height: number } | null {
  return sources.get(sourceKey)?.latest ?? null
}
