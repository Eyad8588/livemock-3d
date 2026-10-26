# LiveMock 3D — Build Plan

Spec: see `SPEC.md`. Rule: **each milestone must run before starting the next.**

## Status board

| Milestone | Scope | Status |
|---|---|---|
| M0 | Scaffold: electron-vite + TS strict + Vitest, pinned deps, security baseline | ✅ |
| M1 | Shell + viewport: secure window, typed IPC, `.livemock` save/open (zip via fflate), Three.js viewport, procedural devices (phone/tablet/laptop/monitor), image/video on screen, orbit controls | ✅ |
| M2 | Live URL: offscreen webContents, mobile emulation (CDP), frame streaming to texture, interaction panel + input forwarding, tap ripples, bundled Arabic/English test page | ✅ |
| M3 | Timeline + modes: keyframe tracks, easing (+bezier), undo/redo (command pattern), canvas timeline UI, camera modes 1–4, mode keyframe generation with sliders | ✅ |
| M4 | Export: deterministic offline render loop, WebCodecs VideoEncoder + Mediabunny MP4 mux, ffmpeg fallback, Record Take for URL sources, aspect presets, batch export, progress + ETA + cancel | ✅ |
| M5 | Look: 7 environments, procedural HDRI-free lighting rigs (CC0 HDRI slot), post FX (DOF/bloom/vignette/grain), motion blur accumulation, all device presets, GLB custom device import | ✅ |
| M6 | More sources + output: window/screen mirror + macOS permission flow, walkthrough editor, modes 5–9, text overlays (Arabic), audio mux, ProRes 4444 / WebM alpha / GIF / PNG seq | ✅ |
| M7 | Ship: EN/AR i18n + RTL, themes, shortcuts, first-run flow, sample project, electron-builder config, CI, README/CREDITS/CHANGELOG | ✅ |
| GLB | User-supplied device presets (iPhone 17 Pro Max, MacBook Pro 16") from assets/models — protocol serving, yaw-safe rig, emissive display pick, screen quad overlay | ✅ |

## Architecture decisions

- **electron-vite 6** (Vite 8 under the hood): three builds — `main` (cjs/esm), `preload`, `renderer`.
- **Security**: `sandbox: true`, `contextIsolation: true`, `nodeIntegration: false` everywhere; offscreen pages get their own session partition (`persist:livemock-offscreen`) with permission-deny handler; strict CSP meta tag in renderer HTML; all IPC channels declared in `src/shared/ipc.ts` and validated in main.
- **`.livemock`** = zip (`fflate`): `project.json`, `media/`, `takes/`. Media files stored by content-hash id (`sha1`), so saves stay small when re-using files.
- **Frame streaming (live URL)**: offscreen `webContents.paint` events → main throttles to ≤30 fps, packs dirty rects → single IPC message with `NativeImage` bitmap buffer → renderer paints into `CanvasTexture`. GPU shared-texture import is not exposed to sandboxed renderers, so bitmap path is the primary path.
- **Record Take**: main runs the walkthrough, captures `paint` frames at full res → pipes rawvideo to bundled ffmpeg (`-f rawvideo -pix_fmt rgba` → libx264 CRF 12). Deterministic export reads the take via Mediabunny/WebCodecs.
- **Export**: renderer offline loop renders into `WebGLRenderTarget` (MSAA), reads pixels, feeds `VideoEncoder` (hardware-first) with Mediabunny `Output`/`Mp4OutputFormat` mux; ffmpeg fallback + all ffmpeg-only formats via stdin pipe through IPC-free streaming (renderer → main via MessagePort to avoid main-thread copies).
- **Timeline**: single canvas, device-pixel-ratio aware; all tracks derive from `Track<T>` in shared types; one evaluator used by preview AND export.
- **Devices**: procedural rounded-box bodies (custom geometry, beveled), glass layer, unlit screen; laptop lid pivot group; monitor stand. GLB import maps mesh named `Screen`.

## Verification per milestone

- `npm run typecheck` + `npm test` green.
- `npm run dev` launches: window opens, viewport renders phone, add media, save/open project round-trip.
- E2E (Playwright Electron) covers launch → device → export; unit tests cover easing/interpolation/migration/ffmpeg-args/walkthrough timing.
