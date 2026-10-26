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

## Custom GLB device models

Drop your own `.glb` models into `assets/models/` (gitignored — not distributed):

| File | Preset |
|---|---|
| `phone_17_pro_max.glb` | iPhone 17 Pro Max (GLB) |
| `macbook_pro_m3_16_inch_2024.glb` | MacBook Pro 16" (GLB) |

They appear in **Add device** automatically. Screen mapping: a mesh named
`Screen` wins; otherwise the self-lit (emissive) display mesh; otherwise the
largest flat mesh. Models are normalized to real-world mm and grounded.
