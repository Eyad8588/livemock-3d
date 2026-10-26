// Environment rigs (SPEC §6). One click each; lights + backdrop + optional
// ground. Transparent env yields no background for alpha export.

import * as THREE from 'three'
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js'
import type { EnvironmentSettings } from '@shared/types'

export interface EnvRig {
  group: THREE.Group
  /** when true, renderer clear alpha stays 1 and scene.background is set */
  hasBackground: boolean
  update(settings: EnvironmentSettings): void
  dispose(): void
}

let pmrem: THREE.PMREMGenerator | null = null
let roomEnvTexture: THREE.Texture | null = null

function getSceneEnvironment(renderer: THREE.WebGLRenderer): THREE.Texture {
  if (!roomEnvTexture) {
    pmrem ??= new THREE.PMREMGenerator(renderer)
    roomEnvTexture = pmrem.fromScene(new RoomEnvironment(), 0.04).texture
  }
  return roomEnvTexture
}

export function createEnvironment(_renderer: THREE.WebGLRenderer): EnvRig {
  const group = new THREE.Group()

  function clearGroup(): void {
    for (const child of [...group.children]) {
      group.remove(child)
      if (child instanceof THREE.Mesh) {
        child.geometry.dispose()
        const mats = Array.isArray(child.material) ? child.material : [child.material]
        for (const m of mats) m.dispose()
      }
    }
  }

  function addKeyFillRim(): { key: THREE.DirectionalLight } {
    const key = new THREE.DirectionalLight(0xffffff, 2.6)
    key.position.set(-350, 600, 500)
    key.castShadow = true
    key.shadow.mapSize.set(1024, 1024)
    key.shadow.camera.near = 50
    key.shadow.camera.far = 3000
    const c = key.shadow.camera
    c.left = -600
    c.right = 600
    c.top = 600
    c.bottom = -600
    key.shadow.radius = 6
    key.shadow.bias = -0.0004
    group.add(key)
    group.add(new THREE.HemisphereLight(0xdfe6f0, 0x30323a, 0.9))
    const rim = new THREE.DirectionalLight(0xbfd0ff, 1.4)
    rim.position.set(400, 300, -500)
    group.add(rim)
    return { key }
  }

  function addFloor(color: string, roughness: number, metalness: number): void {
    const floor = new THREE.Mesh(new THREE.CircleGeometry(2400, 48), new THREE.MeshStandardMaterial({ color, roughness, metalness }))
    floor.rotation.x = -Math.PI / 2
    floor.receiveShadow = true
    group.add(floor)
  }

  function update(settings: EnvironmentSettings): void {
    clearGroup()
    const A = new THREE.Color(settings.colorA)
    const B = new THREE.Color(settings.colorB)

    switch (settings.id) {
      case 'studio-gradient': {
        addKeyFillRim()
        const cv = document.createElement('canvas')
        cv.width = 8
        cv.height = 256
        const ctx = cv.getContext('2d')!
        const grad = ctx.createLinearGradient(0, 0, 0, 256)
        grad.addColorStop(0, `#${B.getHexString()}`)
        grad.addColorStop(1, `#${A.getHexString()}`)
        ctx.fillStyle = grad
        ctx.fillRect(0, 0, 8, 256)
        const tex = new THREE.CanvasTexture(cv)
        tex.colorSpace = THREE.SRGBColorSpace
        const backdrop = new THREE.Mesh(
          new THREE.CylinderGeometry(1800, 1800, 2400, 48, 1, true),
          new THREE.MeshBasicMaterial({ map: tex, side: THREE.BackSide, toneMapped: false })
        )
        backdrop.position.y = 900
        group.add(backdrop)
        addFloor(`#${A.getHexString()}`, 0.55, 0.25)
        break
      }
      case 'floating-void': {
        const key = new THREE.DirectionalLight(0xffffff, 3.2)
        key.position.set(-200, 500, 400)
        key.castShadow = true
        key.shadow.mapSize.set(1024, 1024)
        group.add(key)
        const rim = new THREE.DirectionalLight(0x88aaff, 2.0)
        rim.position.set(350, 150, -500)
        group.add(rim)
        break
      }
      case 'reflective-floor': {
        addKeyFillRim()
        const floor = new THREE.Mesh(
          new THREE.CircleGeometry(2400, 48),
          new THREE.MeshStandardMaterial({ color: 0x14161c, roughness: 0.08, metalness: 0.9, envMapIntensity: 1.6 })
        )
        floor.rotation.x = -Math.PI / 2
        group.add(floor)
        break
      }
      case 'light-box': {
        const { key } = addKeyFillRim()
        key.intensity = 3.4
        const backdrop = new THREE.Mesh(
          new THREE.SphereGeometry(2600, 32, 16),
          new THREE.MeshBasicMaterial({ color: 0xf4f5f7, side: THREE.BackSide, toneMapped: false })
        )
        group.add(backdrop)
        addFloor('#f4f5f7', 0.9, 0)
        break
      }
      case 'dark-cinematic': {
        const key = new THREE.SpotLight(0xfff2dd, 6.0, 0, Math.PI / 5, 0.45, 1.2)
        key.position.set(-250, 900, 300)
        key.target.position.set(0, 60, 0)
        key.castShadow = true
        key.shadow.mapSize.set(1024, 1024)
        group.add(key)
        group.add(key.target)
        const rim = new THREE.DirectionalLight(0x3350ff, 1.2)
        rim.position.set(400, 100, -600)
        group.add(rim)
        const cv = document.createElement('canvas')
        cv.width = 256
        cv.height = 256
        const ctx = cv.getContext('2d')!
        const grad = ctx.createLinearGradient(0, 0, 0, 256)
        grad.addColorStop(0, 'rgba(255,240,210,0.35)')
        grad.addColorStop(1, 'rgba(255,240,210,0)')
        ctx.fillStyle = grad
        ctx.beginPath()
        ctx.moveTo(100, 0)
        ctx.lineTo(160, 0)
        ctx.lineTo(240, 256)
        ctx.lineTo(20, 256)
        ctx.closePath()
        ctx.fill()
        const tex = new THREE.CanvasTexture(cv)
        const shaft = new THREE.Mesh(
          new THREE.PlaneGeometry(1400, 1600),
          new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide })
        )
        shaft.position.set(-150, 500, -150)
        shaft.rotation.z = 0.22
        group.add(shaft)
        break
      }
      case 'brand-color': {
        addKeyFillRim()
        const cv = document.createElement('canvas')
        cv.width = 256
        cv.height = 256
        const ctx = cv.getContext('2d')!
        const grad = ctx.createRadialGradient(128, 160, 20, 128, 128, 190)
        grad.addColorStop(0, `#${A.getHexString()}`)
        grad.addColorStop(1, `#${B.getHexString()}`)
        ctx.fillStyle = grad
        ctx.fillRect(0, 0, 256, 256)
        const tex = new THREE.CanvasTexture(cv)
        tex.colorSpace = THREE.SRGBColorSpace
        const backdrop = new THREE.Mesh(
          new THREE.SphereGeometry(2600, 32, 16),
          new THREE.MeshBasicMaterial({ map: tex, side: THREE.BackSide, toneMapped: false })
        )
        group.add(backdrop)
        break
      }
      case 'transparent': {
        const key = new THREE.DirectionalLight(0xffffff, 2.2)
        key.position.set(-250, 600, 450)
        group.add(key)
        group.add(new THREE.HemisphereLight(0xffffff, 0x444444, 0.7))
        break
      }
    }
  }

  update({
    id: 'studio-gradient',
    colorA: '#c9ccd4',
    colorB: '#8a8f9c',
    colorC: '#ffffff'
  })

  return {
    group,
    hasBackground: true,
    update,
    dispose: () => {
      clearGroup()
    }
  }
}

/** Shared environment map for PBR reflections. */
export function sceneEnvironment(renderer: THREE.WebGLRenderer): THREE.Texture {
  return getSceneEnvironment(renderer)
}
