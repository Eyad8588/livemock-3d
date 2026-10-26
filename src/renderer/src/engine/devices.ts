// Procedural device models (SPEC §5). Original geometry, realistic mm
// proportions. No trademarks, no imported models — everything built here.

import * as THREE from 'three'
import type { Cutout, DevicePreset, Finish } from '@shared/types'

export interface DeviceRig {
  root: THREE.Group
  screenMesh: THREE.Mesh
  glareMesh: THREE.Mesh | null
  lidPivot: THREE.Group | null
  screenWmm: number
  screenHmm: number
  dispose(): void
}

const FINISH_PARAMS: Record<Finish, { metalness: number; roughness: number; clearcoat: number }> = {
  titanium: { metalness: 0.82, roughness: 0.42, clearcoat: 0.2 },
  aluminum: { metalness: 0.9, roughness: 0.3, clearcoat: 0.25 },
  matte: { metalness: 0.2, roughness: 0.85, clearcoat: 0.0 },
  glossy: { metalness: 0.35, roughness: 0.12, clearcoat: 1.0 }
}

function finishParams(finish: Finish): { metalness: number; roughness: number; clearcoat: number } {
  return FINISH_PARAMS[finish] ?? FINISH_PARAMS.aluminum!
}

/** Rounded-rectangle shape centered at origin. */
export function roundedRectShape(w: number, h: number, r: number): THREE.Shape {
  const s = new THREE.Shape()
  const rr = Math.min(r, w / 2 - 0.01, h / 2 - 0.01)
  s.moveTo(-w / 2 + rr, -h / 2)
  s.lineTo(w / 2 - rr, -h / 2)
  s.absarc(w / 2 - rr, -h / 2 + rr, rr, -Math.PI / 2, 0, false)
  s.lineTo(w / 2, h / 2 - rr)
  s.absarc(w / 2 - rr, h / 2 - rr, rr, 0, Math.PI / 2, false)
  s.lineTo(-w / 2 + rr, h / 2)
  s.absarc(-w / 2 + rr, h / 2 - rr, rr, Math.PI / 2, Math.PI, false)
  s.lineTo(-w / 2, -h / 2 + rr)
  s.absarc(-w / 2 + rr, -h / 2 + rr, rr, Math.PI, (3 * Math.PI) / 2, false)
  return s
}

function roundedRectGeometry(w: number, h: number, r: number): THREE.ShapeGeometry {
  const geo = new THREE.ShapeGeometry(roundedRectShape(w, h, r), 24)
  // ShapeGeometry is in XY; UVs need remap to 0..1
  const uv = geo.attributes.uv as THREE.BufferAttribute
  const pos = geo.attributes.position as THREE.BufferAttribute
  for (let i = 0; i < uv.count; i++) {
    uv.setXY(i, pos.getX(i) / w + 0.5, pos.getY(i) / h + 0.5)
  }
  return geo
}

function slabGeometry(w: number, h: number, d: number, r: number): THREE.ExtrudeGeometry {
  const shape = roundedRectShape(w, h, r)
  const geo = new THREE.ExtrudeGeometry(shape, {
    depth: Math.max(0.2, d - 1.2),
    bevelEnabled: true,
    bevelThickness: 0.6,
    bevelSize: 0.6,
    bevelSegments: 3,
    curveSegments: 24
  })
  geo.center()
  geo.computeVertexNormals()
  return geo
}

export function bodyMaterial(finish: Finish, colorHex: string): THREE.MeshPhysicalMaterial {
  const p = finishParams(finish)
  return new THREE.MeshPhysicalMaterial({
    color: new THREE.Color(colorHex),
    metalness: p.metalness,
    roughness: p.roughness,
    clearcoat: p.clearcoat,
    clearcoatRoughness: 0.25,
    envMapIntensity: 1.1
  })
}

function buildCutout(cutout: Cutout, screenW: number, screenH: number, screenR: number, frontZ: number): THREE.Object3D | null {
  const mat = new THREE.MeshBasicMaterial({ color: 0x000000 })
  const z = frontZ + 0.12
  switch (cutout) {
    case 'none':
      return null
    case 'pill': {
      const w = screenW * 0.24
      const h = screenH * 0.026
      const geo = new THREE.ExtrudeGeometry(roundedRectShape(w, h, h / 2), { depth: 0.3, bevelEnabled: false })
      const m = new THREE.Mesh(geo, mat)
      m.position.set(0, screenH / 2 - h * 2.2, z)
      return m
    }
    case 'notch': {
      const w = screenW * 0.32
      const h = screenH * 0.032
      const geo = new THREE.ExtrudeGeometry(roundedRectShape(w, h, h / 2), { depth: 0.3, bevelEnabled: false })
      const m = new THREE.Mesh(geo, mat)
      m.position.set(0, screenH / 2 - h / 2, z)
      return m
    }
    case 'punch-hole': {
      const r = screenW * 0.038
      const geo = new THREE.CircleGeometry(r, 24)
      const m = new THREE.Mesh(geo, mat)
      m.position.set(0, screenH / 2 - screenR - r * 2.4, z)
      return m
    }
  }
  return null
}

/** Build a full device rig from a preset. Scene units are millimeters. */
export function buildDevice(preset: DevicePreset, finish: Finish, colorHex: string, cutout: Cutout): DeviceRig {
  const root = new THREE.Group()
  const disposables: { dispose(): void }[] = []
  const body = bodyMaterial(finish, colorHex)
  disposables.push(body)

  let screenMesh: THREE.Mesh
  let glareMesh: THREE.Mesh | null = null
  let lidPivot: THREE.Group | null = null
  let screenW = 0
  let screenHmm = 0

  const screenMaterial = new THREE.MeshBasicMaterial({ toneMapped: false })
  disposables.push(screenMaterial)
  const glareMaterial = new THREE.MeshPhysicalMaterial({
    color: 0xffffff,
    metalness: 0,
    roughness: 0.06,
    transmission: 0.6,
    transparent: true,
    opacity: 0.0,
    envMapIntensity: 1.4
  })
  disposables.push(glareMaterial)

  if (preset.kind === 'phone' || preset.kind === 'tablet') {
    const { w, h, d, bezelX, bezelY, cornerRadius } = preset.body
    const bodyGeo = slabGeometry(w, h, d, cornerRadius)
    disposables.push(bodyGeo)
    root.add(new THREE.Mesh(bodyGeo, body))

    screenW = w - bezelX * 2
    screenHmm = h - bezelY * 2
    const screenR = Math.max(1, cornerRadius - Math.min(bezelX, bezelY))
    const screenGeo = roundedRectGeometry(screenW, screenHmm, screenR)
    disposables.push(screenGeo)
    screenMesh = new THREE.Mesh(screenGeo, screenMaterial)
    screenMesh.position.z = d / 2 + 0.06
    root.add(screenMesh)

    const glareGeo = roundedRectGeometry(screenW, screenHmm, screenR)
    disposables.push(glareGeo)
    glareMesh = new THREE.Mesh(glareGeo, glareMaterial)
    glareMesh.position.z = d / 2 + 0.42
    root.add(glareMesh)

    const co = buildCutout(cutout, screenW, screenHmm, screenR, d / 2)
    if (co) {
      if (co instanceof THREE.Mesh) disposables.push(co.material as THREE.Material)
      root.add(co)
    }

    if (preset.sideButtons?.volume || preset.sideButtons?.power) {
      const btnMat = body.clone()
      btnMat.color = new THREE.Color(colorHex).multiplyScalar(0.85)
      const mk = (hmm: number, y: number, side: 1 | -1): void => {
        const g = new THREE.BoxGeometry(d * 0.35, hmm, 1.4)
        const m = new THREE.Mesh(g, btnMat)
        m.position.set((side * w) / 2, y, 0)
        m.rotation.y = Math.PI / 2
        root.add(m)
        disposables.push(g)
      }
      if (preset.sideButtons.volume) {
        mk(h * 0.06, h * 0.18, -1)
        mk(h * 0.06, h * 0.26, -1)
      }
      if (preset.sideButtons.power) mk(h * 0.09, h * 0.22, 1)
    }

    if (preset.backCamera) {
      const bump = new THREE.Mesh(
        slabGeometry(w * 0.3, h * 0.08 * (w / h > 0.5 ? 2.6 : 1), d * 0.25, w * 0.06),
        body.clone()
      )
      bump.position.set(-w * 0.26, h * 0.38, -d / 2 - d * 0.1)
      root.add(bump)
      const lensMat = new THREE.MeshPhysicalMaterial({ color: 0x0a0a12, metalness: 0.6, roughness: 0.2 })
      disposables.push(lensMat)
      for (let i = 0; i < 2; i++) {
        const lens = new THREE.Mesh(new THREE.CylinderGeometry(w * 0.055, w * 0.055, d * 0.1, 20), lensMat)
        lens.rotation.x = Math.PI / 2
        lens.position.set(-w * 0.3 + i * w * 0.13, h * 0.4, -d / 2 - d * 0.22)
        root.add(lens)
        disposables.push(lens.geometry)
      }
    }
  } else if (preset.kind === 'laptop') {
    const { w, h, d, cornerRadius } = preset.body
    const lidH = h * 0.68 // lid length
    const baseDepth = d + 6
    // base
    const baseGeo = slabGeometry(w, baseDepth, 6, cornerRadius * 0.4)
    disposables.push(baseGeo)
    const baseMesh = new THREE.Mesh(baseGeo, body)
    baseMesh.position.y = 3 // half thickness
    root.add(baseMesh)

    // keyboard deck detail (simple): dark inset rounded rect on top
    const kbMat = new THREE.MeshStandardMaterial({ color: 0x17181c, roughness: 0.7, metalness: 0.1 })
    disposables.push(kbMat)
    const kbGeo = roundedRectGeometry(w * 0.76, baseDepth * 0.62, 4)
    disposables.push(kbGeo)
    const kb = new THREE.Mesh(kbGeo, kbMat)
    kb.rotation.x = -Math.PI / 2
    kb.position.set(0, 6.1, -baseDepth * 0.08)
    root.add(kb)
    const padGeo = roundedRectGeometry(w * 0.24, baseDepth * 0.24, 3)
    disposables.push(padGeo)
    const pad = new THREE.Mesh(padGeo, kbMat)
    pad.rotation.x = -Math.PI / 2
    pad.position.set(0, 6.1, baseDepth * 0.32)
    root.add(pad)

    // lid + hinge pivot at back edge
    lidPivot = new THREE.Group()
    lidPivot.position.set(0, 6, -baseDepth / 2 + 1)
    root.add(lidPivot)
    const lidGeo = slabGeometry(w, lidH, 5, cornerRadius * 0.5)
    disposables.push(lidGeo)
    const lidMesh = new THREE.Mesh(lidGeo, body)
    lidMesh.position.set(0, 0, lidH / 2 - 2) // extends +z from hinge; rotated open by pivot
    lidPivot.add(lidMesh)

    // screen on -y face of lid (faces camera when open)
    screenW = w - preset.body.bezelX * 2
    screenHmm = lidH - preset.body.bezelY * 2 - 4
    const screenGeo = roundedRectGeometry(screenW, screenHmm, cornerRadius * 0.5)
    disposables.push(screenGeo)
    screenMesh = new THREE.Mesh(screenGeo, screenMaterial)
    screenMesh.rotation.x = Math.PI / 2 // face -y
    screenMesh.position.set(0, -3.1, lidH / 2 - 2)
    lidPivot.add(screenMesh)

    const glareGeo2 = roundedRectGeometry(screenW, screenHmm, cornerRadius * 0.5)
    disposables.push(glareGeo2)
    glareMesh = new THREE.Mesh(glareGeo2, glareMaterial)
    glareMesh.rotation.x = Math.PI / 2
    glareMesh.position.set(0, -3.4, lidH / 2 - 2)
    lidPivot.add(glareMesh)

    const co = buildCutout(cutout, screenW, screenHmm, cornerRadius * 0.5, 0)
    if (co) {
      // screen plane was rotated +90° around X to face -y; match that for the cutout
      co.rotation.x = Math.PI / 2
      co.position.set(0, -3.0, lidH / 2 - 2 + 0.42)
      lidPivot.add(co)
    }
    root.position.y = 0
    // laptop sits on ground; raise pivot by base thickness handled above
    root.userData.lidOpenRad = THREE.MathUtils.degToRad(105)
    lidPivot.rotation.x = -(root.userData.lidOpenRad as number)
    // when open, lid stands up: top of lid reaches lidH above base
    root.position.y = 0
  } else {
    // monitor
    const { w, h, d, cornerRadius } = preset.body
    const standH = preset.standHeightMm ?? 160
    const panelGeo = slabGeometry(w, h, d * 0.55, cornerRadius)
    disposables.push(panelGeo)
    const panel = new THREE.Mesh(panelGeo, body)
    panel.position.y = standH + h / 2
    root.add(panel)

    screenW = w - preset.body.bezelX * 2
    screenHmm = h - preset.body.bezelY * 2
    const screenGeo = roundedRectGeometry(screenW, screenHmm, cornerRadius * 0.55)
    disposables.push(screenGeo)
    screenMesh = new THREE.Mesh(screenGeo, screenMaterial)
    screenMesh.position.set(0, standH + h / 2, d * 0.28)
    root.add(screenMesh)

    const glareGeo3 = roundedRectGeometry(screenW, screenHmm, cornerRadius * 0.55)
    disposables.push(glareGeo3)
    glareMesh = new THREE.Mesh(glareGeo3, glareMaterial)
    glareMesh.position.set(0, standH + h / 2, d * 0.31)
    root.add(glareMesh)

    const standMat = body.clone()
    disposables.push(standMat)
    const pole = new THREE.Mesh(new THREE.BoxGeometry(w * 0.16, standH, d * 0.3), standMat)
    pole.position.y = standH / 2
    pole.position.z = -d * 0.1
    root.add(pole)
    disposables.push(pole.geometry)
    const foot = new THREE.Mesh(slabGeometry(w * 0.34, d * 1.1, 8, 8), standMat)
    foot.position.set(0, 4, -d * 0.1)
    root.add(foot)
  }

  const dispose = (): void => {
    root.traverse((o) => {
      if (o instanceof THREE.Mesh) o.geometry.dispose()
    })
    for (const d of disposables) d.dispose()
  }

  return { root, screenMesh, glareMesh, lidPivot, screenWmm: screenW, screenHmm, dispose }
}

/** Apply a Transform value to a rig root. */
export function applyTransform(
  rig: DeviceRig,
  t: { position: { x: number; y: number; z: number }; rotation: { x: number; y: number; z: number }; scale: { x: number; y: number; z: number } },
  lidAngleDeg?: number
): void {
  rig.root.position.set(t.position.x, t.position.y, t.position.z)
  rig.root.rotation.set(
    THREE.MathUtils.degToRad(t.rotation.x),
    THREE.MathUtils.degToRad(t.rotation.y),
    THREE.MathUtils.degToRad(t.rotation.z)
  )
  rig.root.scale.set(t.scale.x, t.scale.y, t.scale.z)
  if (rig.lidPivot && lidAngleDeg !== undefined) {
    rig.lidPivot.rotation.x = -THREE.MathUtils.degToRad(Math.min(115, Math.max(0, lidAngleDeg)))
  }
}
