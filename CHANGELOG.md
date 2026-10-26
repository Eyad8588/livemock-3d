# Changelog

## 0.1.0 — M1 Shell + viewport

- Electron 45 + electron-vite 6 + TypeScript strict shell, sandboxed renderer,
  typed contextBridge IPC (`src/shared/ipc.ts`), strict CSP.
- `.livemock` project format: zip (project.json + media/ + takes/), sha1 media
  store, autosave + crash recovery.
- Three.js viewport: procedural phone/tablet/laptop/monitor devices (original
  geometry, mm units, finishes + cutouts), studio environments, orbit controls,
  transform gizmo, picking, drag-and-drop media onto devices.
- Screen sources: image + video on screen, `livemock-media://` streaming
  protocol with CORS for WebGL-safe textures.
- Left panel (scenes/devices/environments/media), inspector, timeline transport
  with canvas ruler + playhead, undo/redo, EN/AR i18n scaffolding with RTL,
  dark/light themes, keyboard shortcuts, dev stats overlay.
