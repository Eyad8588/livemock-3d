# User-provided device models

Drop your own `.glb` / `.gltf` device models here. Files in this folder are
**not part of the repository** (they are gitignored) — LiveMock 3D ships no
manufacturer models or trademarks.

Bundled presets that load from this folder (when the files exist):

| Preset | File | Screen viewport |
|---|---|---|
| iPhone 17 Pro Max (GLB) | `phone_17_pro_max.glb` | 440 × 956 |
| MacBook Pro 16" (GLB) | `macbook_pro_m3_16_inch_2024.glb` | 1728 × 1117 |

Screen mapping convention: a mesh named `Screen` (case-insensitive) gets the
screen texture; otherwise a mesh whose *material* name contains
`display`/`screen`/`oled`; otherwise the largest flat mesh.

Respecting trademark law is your responsibility for models you add.
