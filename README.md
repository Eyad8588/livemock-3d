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
