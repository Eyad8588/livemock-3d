# LiveMock 3D

Put any screen content onto a 3D device, animate it cinematically, and export a
ready-to-edit video. Free, open source (MIT), no accounts, no watermarks, no
telemetry.

> Under active development — see SPEC.md (product spec) and PLAN.md (build plan
> + status).

## Development

```bash
npm install
npm run dev        # launch the app in dev mode
npm run typecheck  # strict TS across main + renderer
npm test           # unit tests (vitest)
npm run build      # production build to out/
npm run dist       # platform packages via electron-builder
```

Windows + macOS. Requires Node 22+.

## Quick start: frames, videos, your own clips

- **✨ Mac + iPhone** (top bar, also in the first-run dialog) builds a ready
  showcase: MacBook Pro 16" + iPhone 17 Pro Max (GLB models when present in
  `assets/models/`, built-in devices otherwise), a sample clip on each screen
  and a slow hero push-in. Press ▶ to preview.
- **Put your own video/image on a screen** — any of:
  drag a file from Finder onto a device in the viewport (a drop hint shows
  which device), drop it on the device's row in the left panel, click the
  **🎬** button on a device row, or use *Screen content → Video* in the
  inspector. Videos play in the preview and are decoded frame-exactly in
  exports. Default fit is *Crop* (fills the screen); switch to *Fit* to
  letterbox. Loop / speed / trim in / trim out are in the inspector.
- **📷 Frame** exports a PNG of exactly what the viewport shows (⌘⇧F).
  **▾** next to it sets the size (match viewport up to 5120 px, 16:9 1080p/4K,
  9:16, 1:1, 4:5, 3:2), transparent background, and whether to use the
  current view or the animated camera at the playhead.
- **Export** renders the animated scene: MP4 (H.264/HEVC via hardware
  WebCodecs), ProRes 4444 / WebM VP9 with alpha, GIF, PNG sequence. Pick
  several aspect ratios for a batch. Narrower outputs (e.g. 9:16 from a wide
  scene) keep everything that is visible left-to-right in the editor.

Files land in `~/Downloads/LiveMock/`. Example outputs: `demo/`.

`node tests/e2e-flows.mjs [outDir]` (after `npm run build`) drives the built
app through all four flows and verifies the outputs with the bundled ffmpeg.

## Custom GLB device models

Drop your own `.glb` models into `assets/models/` (gitignored — not distributed):

| File | Preset |
|---|---|
| `phone_17_pro_max.glb` | iPhone 17 Pro Max (GLB) |
| `macbook_pro_m3_16_inch_2024.glb` | MacBook Pro 16" (GLB) |

They appear in **Add device** automatically. Screen mapping: a mesh named
`Screen` wins; otherwise the self-lit (emissive) display mesh; otherwise the
largest flat mesh. Models are normalized to real-world mm and grounded.
