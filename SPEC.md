# LiveMock 3D — Build Prompt (Windows + macOS)

> Kickoff: "Read SPEC.md fully, write PLAN.md, then build milestone by milestone. Each milestone must run before you move on."

---

## 0. Your role

You are a senior desktop + graphics engineer. Build **LiveMock 3D**, a free, open-source desktop app for **Windows and macOS** that lets video editors, marketers and app makers put any screen content onto a 3D device (phone, tablet, laptop, monitor), animate it cinematically, and export a ready-to-edit video in minutes.

Build real, working, production-quality code. No stubs, no "TODO: implement", no fake data. Every milestone must launch and work before you start the next one.

---

## 1. Product in one paragraph

The user picks a device, puts content on its screen (a **live website**, a **screen/window mirror**, or **their own media**: images and videos like an app screen recording), picks a one-click camera **mode** (e.g. Cinematic Hero), adjusts it on a timeline if they want, and exports **MP4 / MOV with alpha / WebM / GIF / PNG** in any social aspect ratio (9:16, 1:1, 4:5, 16:9). Everything runs **locally**. **Free forever**: MIT license, no account, no watermark, no telemetry, no paywalls.

**Key differentiator:** live websites render in real Chromium, so **Arabic / RTL text renders perfectly** (most mockup tools break it because they use static screenshots).

---

## 2. Locked technical decisions

| Area | Decision | Why |
|---|---|---|
| Shell | **Electron** (latest stable) | Same Chromium engine on Windows + macOS; offscreen rendering of live pages |
| Language | **TypeScript, strict mode** everywhere | |
| Bundler | **Vite** (electron-vite or equivalent) | |
| 3D | **Three.js** (WebGL2) + postprocessing | |
| UI | **Plain TypeScript + Web Components (Lit is OK). NO React.** | The owner maintains this and does not use React |
| Video encode (fast path) | **WebCodecs `VideoEncoder`** (H.264 / HEVC, hardware accelerated) + **Mediabunny** for muxing | Fast, no raw-frame piping |
| Video decode (frame-accurate) | **Mediabunny** demux + WebCodecs `VideoDecoder` | `<video>` seeking is NOT frame-accurate; never use it for export |
| ffmpeg | **ffmpeg-static** (bundled per platform) | ProRes 4444 alpha, VP9 alpha WebM, GIF, audio mix/mux, fallback encoder |
| Packaging | **electron-builder**: macOS universal `.dmg` (arm64 + x64), Windows x64 NSIS installer + portable `.exe` | |
| Tests | **Vitest** (unit) + **Playwright for Electron** (E2E) | |
| CI | GitHub Actions matrix: `macos-latest`, `windows-latest` | |

Pin versions in `package.json`.

---

## 3. Data model (implement exactly, extend if needed)

```ts
// src/shared/types.ts
export interface Project {
  schemaVersion: 1;
  id: string;
  name: string;
  scenes: Scene[];
  exportPresets: ExportSettings[];
  createdAt: string; updatedAt: string;
}

export interface Scene {
  id: string;
  durationSec: number;            // 3–60
  fps: 24 | 30 | 60;
  devices: DeviceInstance[];      // max 4
  environment: EnvironmentSettings;
  camera: CameraTrack;
  overlays: TextOverlay[];
  audio?: AudioTrack;
}

export interface DeviceInstance {
  id: string;
  presetId: string;               // 'phone-6.9', 'tablet-13', 'laptop-14', ...
  material: { finish: 'titanium'|'aluminum'|'matte'|'glossy'; color: string };
  transform: Track<Transform>;    // keyframed position/rotation/scale
  screen: ScreenSource;
  screenGlare: number;            // 0..1
  lidAngleDeg?: Track<number>;    // laptops only
}

export type ScreenSource =
  | { kind: 'url'; url: string; viewport: { w: number; h: number; dpr: number };
      mobileEmulation: boolean; walkthrough?: WalkthroughStep[]; takeId?: string }
  | { kind: 'capture'; sourceId: string; crop?: Rect; takeId?: string }
  | { kind: 'image'; mediaId: string; fit: 'fill'|'fit'|'crop'; crop?: Rect }
  | { kind: 'video'; mediaId: string; fit: 'fill'|'fit'|'crop'; trimIn: number; trimOut: number;
      rate: number; loop: boolean; offsetSec: number };

export type WalkthroughStep =
  | { type: 'wait'; ms: number }
  | { type: 'scroll'; toY: number; durationMs: number; easing: EasingId }
  | { type: 'scrollToSelector'; selector: string; durationMs: number; easing: EasingId }
  | { type: 'tap'; x: number; y: number; showRipple: boolean }
  | { type: 'tapSelector'; selector: string; showRipple: boolean }
  | { type: 'type'; selector: string; text: string; cpm: number };

export interface Track<T> { keys: Keyframe<T>[] }
export interface Keyframe<T> { t: number; value: T; easing: EasingId; bezier?: [number,number,number,number] }
export type EasingId = 'linear'|'easeInOutCubic'|'easeOutExpo'|'easeInOutSine'|'spring'|'bezier';

export interface CameraTrack {
  position: Track<Vec3>; target: Track<Vec3>; fov: Track<number>;
  focusDistance: Track<number>; aperture: Track<number>;
}

export interface ExportSettings {
  name: string;
  width: number; height: number;
  fps: 24|30|60;
  format: 'mp4-h264'|'mp4-hevc'|'mov-prores4444'|'webm-vp9-alpha'|'gif'|'png-seq'|'png-still';
  quality: 'fast'|'high'|'max';
  transparentBackground: boolean;
  motionBlurSamples: 0|4|8|16;
}
```

Project file: `.livemock` = zip containing `project.json` + `/media` (user files copied in) + `/takes` (recorded live sources). Same file must open on Windows and macOS. Include a `migrate(project)` function keyed on `schemaVersion`.

---

## 4. Screen sources

### 4.1 Live URL (the core feature)
- Render the URL in an **Electron offscreen `webContents`** sized to the device viewport, with mobile emulation via `webContents.debugger` (CDP) when the device is a phone/tablet.
- **Preview path:** stream paint frames to the renderer at reduced scale (DPR 1, ≤30 fps, dirty-rect updates only) → upload into a `THREE.DataTexture`/`CanvasTexture`.
- **Interaction panel:** a 2D view of the page where the user can click, scroll and type; forward input with `webContents.sendInputEvent`. Show a touch-ripple indicator on taps.
- **Auto Walkthrough:** user builds a list of `WalkthroughStep`s. Smooth scrolling is done by injecting an eased scroll script.
- **Record Take:** the live page (with its walkthrough) is captured at **full resolution** in the **main process** and piped directly to ffmpeg into `/takes/<id>.mp4` (H.264 CRF 12 or FFV1). The timeline then uses that take, so exports are deterministic.
- Security for the offscreen page: separate session partition, `sandbox: true`, `contextIsolation: true`, `nodeIntegration: false`, deny all permission requests by default, block downloads, block `file://` navigation.

### 4.2 Screen / window mirror
- `desktopCapturer` → `getUserMedia` → `VideoTexture`, with a crop rectangle.
- macOS: detect screen-recording permission and show a friendly guide.
- Mirrors also support **Record Take**.

### 4.3 Media (images + videos)
- Drag-and-drop a file onto a device.
- Images: PNG, JPG, WebP. Videos: MP4, MOV, WebM.
- Fit modes: fill / fit / crop. Auto-detect aspect ratio and warn if mismatched.
- Video: trim in/out, playback rate, loop, offset. Frame-accurate decode (Mediabunny + VideoDecoder) during export.

### 4.4 Color accuracy
- Screen texture `colorSpace = SRGBColorSpace`; screen material unlit (`MeshBasicMaterial`, `toneMapped: false`). Tone mapping (AgX or ACES) applies to the rest of the scene only.
- Optional glare: a separate thin glass layer above the screen, strength = `screenGlare`.

---

## 5. Devices — procedural, original models

**Do not ship Apple / Samsung / Google logos, trademarks, product names or copyrighted 3D models.** Build every device procedurally in Three.js with realistic, editable physical proportions (in mm):

- Body: rounded-rectangle extrusion with beveled edges; side buttons; back camera bump.
- Screen: inset with matching corner radius; cutout options: none / pill island / notch / punch-hole.
- Laptop: base + keyboard deck (simple) + hinge + lid with animatable `lidAngleDeg`.
- Monitor: panel + stand.
- Finishes: titanium, aluminum, matte, glossy; any color.

Presets (generic names, CSS viewport sizes, all editable):

| Preset id | Label | Viewport (CSS px) |
|---|---|---|
| phone-6.9 | Phone 6.9" | 440 × 956 |
| phone-6.3 | Phone 6.3" | 402 × 874 |
| phone-android-6.7 | Android 6.7" | 412 × 915 |
| tablet-13 | Tablet 13" | 1032 × 1376 |
| tablet-11 | Tablet 11" | 834 × 1210 |
| laptop-14 | Laptop 14" | 1512 × 982 |
| laptop-16 | Laptop 16" | 1728 × 1117 |
| monitor-27 | Monitor 27" | 2560 × 1440 |

Also: **Import custom device** from `.glb/.gltf` — the mesh named `Screen` gets the screen texture (document the UV convention in README).

---

## 6. Environments (one click each)

1. **Studio Gradient** — soft two-color gradient backdrop, contact shadow.
2. **Floating Void** — dark, single key light, subtle rim light.
3. **Reflective Floor** — glossy floor with blurred reflection.
4. **Light Box** — bright white, soft shadows (product-shot look).
5. **Dark Cinematic** — low-key, volumetric-looking light shaft.
6. **Brand Color** — user picks 1–3 colors.
7. **Transparent** — no background, alpha export.

Lighting: bundle 3–4 small **CC0 HDRIs from Poly Haven** (1k/2k). Add `CREDITS.md`.
Post FX (each toggleable): depth of field (bokeh), subtle bloom, vignette, film grain, motion blur (export only).

---

## 7. Modes (camera presets) + timeline

Applying a mode **generates editable keyframes** (never a black box). Each mode has 2–3 sliders (speed, intensity, angle).

1. **Cinematic Hero** — slow orbit + push-in, shallow DOF.
2. **Spin Reveal** — device rotates in from the side, settles facing camera.
3. **Float & Tilt** — gentle hover with parallax.
4. **Zoom to Detail** — user clicks a region on the screen preview → camera flies to it and back.
5. **Auto Walkthrough** — camera drifts slowly while the page scrolls.
6. **Device Flip** — front to back to front.
7. **Side by Side** — 2–3 devices lined up, staggered entrance.
8. **Carousel** — devices orbit past camera.
9. **Laptop Open** — lid opens from closed, camera pushes in.

Timeline (bottom panel, canvas-drawn):
- Tracks per device (transform, lid), camera, overlays, audio.
- Keyframe add/move/delete, multi-select, copy/paste, easing picker with bezier editor.
- Scrub, play/pause, loop region, snap to frames, zoom.
- Undo/redo for **everything** (command pattern), autosave every 30s + on change, crash recovery.

---

## 8. Overlays + audio

- **Text overlays:** title / caption / label-with-arrow. Full Arabic support. Bundle OFL fonts: Inter + IBM Plex Sans Arabic (+ Cairo). Simple in/out animations.
- **Audio:** user adds a music file, trim, fade in/out, volume. Muxed on export with ffmpeg.

---

## 9. Export (must be deterministic)

- **Offline render loop:** for each frame `i`, set time `t = i / fps`, update all tracks + sources, render at target resolution into a `WebGLRenderTarget`, then encode. Never screen-record the viewport.
- **Encoders:** MP4 H.264 / HEVC → WebCodecs `VideoEncoder` + Mediabunny mux; fall back to ffmpeg. MOV ProRes 4444 alpha, WebM VP9 alpha, GIF, PNG sequence → ffmpeg via stdin raw RGBA.
- Quality presets map to `fast` / `high` / `max`.
- **Aspect presets:** 9:16 1080×1920, 1:1 1080×1080, 4:5 1080×1350, 16:9 1920×1080 and 3840×2160, custom. Safe-area guides in viewport only.
- **Batch export:** same scene in all selected aspect ratios.
- Progress dialog with ETA and cancel; open-folder button when done. Output file name: `<project>_<scene>_<WxH>_<fps>.<ext>`.
- After export, verify with ffprobe and report problems in plain language.

---

## 10. UI

- Layout: **left** scene list, **center** 3D viewport, **right** inspector, **bottom** timeline, **top bar** Modes · Record Take · Export.
- First-run screen: "Make your first video in 60 seconds".
- **English + Arabic UI**, full RTL mirroring; strings in `src/renderer/i18n/{en,ar}.json`.
- Dark theme default, light theme option. Keyboard shortcuts. Shortcut cheat sheet (`?`).
- Recent projects list, sample project bundled (with a bundled local Arabic + English test page).

---

## 11. Performance targets

- Preview ≥ 60 fps with 2 phones + Studio Gradient on Apple M1 and GTX 1650-class.
- Export 10 s, 1080×1920, 30 fps, H.264 `high` in < 60 s on M1.
- No memory growth over 30 min; dev overlay with fps, GPU memory estimate, texture count.

---

## 12. Security & privacy

- Main window: `contextIsolation: true`, `nodeIntegration: false`, `sandbox: true`, strict CSP, typed IPC through `contextBridge` only (define every channel in `src/shared/ipc.ts`; validate payloads).
- No telemetry, no analytics, no accounts, no network calls except URLs the user loads. Auto-update off by default.

---

## 13. Platform specifics

- **macOS:** universal build, hardened runtime + entitlements; notarization via env vars — build must succeed unsigned.
- **Windows:** NSIS installer + portable exe; signing via env vars if present. Handle high-DPI and Unicode paths.
- Both: hardware acceleration on; clear WebGL2-unavailable message. README explains unsigned warnings.

---

## 14. Project structure

```
livemock-3d/
  src/
    main/            # Electron main
    preload/         # contextBridge API
    renderer/
      ui/            # Web Components
      engine/        # scene, devices, environments, postfx, camera, sources, timeline eval, easing
      export/        # render loop, WebCodecs encoder, Mediabunny, ffmpeg bridge
      i18n/
    shared/          # types, ipc contracts, constants, presets
  assets/            # hdri/, fonts/, sample-project/, test-pages/
  tests/
    unit/  e2e/  golden/
  build/             # icons, entitlements, installer config
  .github/workflows/ci.yml
  README.md  CREDITS.md  LICENSE (MIT)  CHANGELOG.md  PLAN.md
```

---

## 15. Tests

- **Unit (Vitest):** easing, keyframe interpolation, mode → keyframes, project serialize/deserialize + migration, export filename + ffmpeg args, walkthrough timing.
- **Golden frames:** render frame N of 3 fixed scenes at 540×960.
- **E2E (Playwright for Electron):** launch → add phone → drop sample video → Cinematic Hero → export 2 s 9:16 MP4 → ffprobe asserts. Arabic test page take test.
- **CI:** lint + typecheck + unit + E2E on macOS and Windows; upload artifacts.

---

## 16. Milestones (build in order — each must run)

1. **M1 Shell + viewport:** Electron + Vite + TS, secure window, Three.js viewport, one procedural phone, image/video media on screen, orbit controls, save/open `.livemock`.
2. **M2 Live URL:** offscreen source, mobile emulation, interaction panel, tap ripples, bundled Arabic test page.
3. **M3 Timeline + modes:** keyframes, easing, undo/redo, modes 1–4.
4. **M4 Export:** deterministic render loop, MP4 H.264 via WebCodecs + Mediabunny, ffmpeg fallback, Record Take, aspect presets, batch export.
5. **M5 Look:** all environments, HDRIs, post FX, all device presets, custom GLB import.
6. **M6 More sources + output:** mirror, walkthrough editor, modes 5–9, overlays, audio, ProRes 4444 / WebM alpha / GIF / PNG seq.
7. **M7 Ship:** EN/AR UI, first-run flow, sample project, packaging, CI, README, CREDITS.

After each milestone: run the app, run tests, update `CHANGELOG.md`, commit.

---

## 17. Definition of done

- [ ] Fresh clone → `npm install` → `npm run dev` works on Windows and macOS.
- [ ] `npm run dist` produces a universal `.dmg` and a Windows installer + portable exe.
- [ ] New user makes and exports a 9:16 video in under 60 seconds via first-run flow.
- [ ] Arabic website exports with correct RTL text and exact UI colors.
- [ ] Transparent ProRes 4444 works in DaVinci / Premiere / Final Cut.
- [ ] `.livemock` cross-platform compatible.
- [ ] Works fully offline (except user URLs).
- [ ] No trademarks; every bundled asset in `CREDITS.md`.
- [ ] All tests green in CI on both platforms.

## 18. Out of scope for v1

Accounts, cloud sync, collaboration, AI generation, iOS/Android versions, plugin system, anything paid.
