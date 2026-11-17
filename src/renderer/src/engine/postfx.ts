// Post FX stack (SPEC §6): bloom, vignette, film grain — each toggleable,
// driven from scene.postFx. Depth of field lands with the bokeh pass when
// focus tracks are exercised (kept behind a flag until then).

import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js'
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js'
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js'
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js'
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js'
import * as THREE from 'three'
import type { PostFxSettings } from '@shared/types'

const VignetteShader = {
  uniforms: {
    tDiffuse: { value: null },
    strength: { value: 0.35 }
  },
  vertexShader: /* glsl */ `
    varying vec2 vUv;
    void main() {
      vUv = uv;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }
  `,
  fragmentShader: /* glsl */ `
    uniform sampler2D tDiffuse;
    uniform float strength;
    varying vec2 vUv;
    void main() {
      vec4 color = texture2D(tDiffuse, vUv);
      float d = distance(vUv, vec2(0.5));
      float vig = smoothstep(0.35, 0.85, d) * strength;
      color.rgb *= 1.0 - vig;
      gl_FragColor = color;
    }
  `
}

const GrainShader = {
  uniforms: {
    tDiffuse: { value: null },
    time: { value: 0 },
    amount: { value: 0.045 }
  },
  vertexShader: VignetteShader.vertexShader,
  fragmentShader: /* glsl */ `
    uniform sampler2D tDiffuse;
    uniform float time;
    uniform float amount;
    varying vec2 vUv;
    float hash(vec2 p) {
      return fract(sin(dot(p + time, vec2(12.9898, 78.233))) * 43758.5453);
    }
    void main() {
      vec4 color = texture2D(tDiffuse, vUv);
      float g = hash(vUv * vec2(1920.0, 1080.0)) - 0.5;
      color.rgb += g * amount;
      gl_FragColor = color;
    }
  `
}

export class PostFxStack {
  private composer: EffectComposer | null = null
  private bloom: UnrealBloomPass | null = null
  private vignette: ShaderPass | null = null
  private grain: ShaderPass | null = null
  private renderPass: RenderPass | null = null
  private outputPass: OutputPass | null = null

  ensure(renderer: THREE.WebGLRenderer, scene: THREE.Scene, camera: THREE.Camera, w: number, h: number): void {
    if (this.composer) return
    this.composer = new EffectComposer(renderer)
    this.renderPass = new RenderPass(scene, camera)
    this.composer.addPass(this.renderPass)
    this.bloom = new UnrealBloomPass(new THREE.Vector2(w, h), 0.25, 0.4, 1.05)
    this.vignette = new ShaderPass(VignetteShader)
    this.grain = new ShaderPass(GrainShader)
    this.outputPass = new OutputPass()
    this.composer.addPass(this.bloom)
    this.composer.addPass(this.vignette)
    this.composer.addPass(this.grain)
    this.composer.addPass(this.outputPass)
  }

  resize(w: number, h: number): void {
    this.composer?.setSize(w, h)
  }

  apply(settings: PostFxSettings, timeSec: number): void {
    if (!this.composer) return
    this.bloom!.enabled = settings.bloom
    this.bloom!.strength = settings.bloomStrength
    this.vignette!.enabled = settings.vignette
    this.grain!.enabled = settings.filmGrain
    const grainUniforms = this.grain!.uniforms as Record<string, { value: number }>
    grainUniforms['time']!.value = timeSec % 10
  }

  setCamera(camera: THREE.Camera): void {
    if (this.renderPass) this.renderPass.camera = camera
  }

  render(dt: number): void {
    this.composer?.render(dt)
  }

  // ---- export: offscreen composer writing into an 8-bit RGBA target ----
  private exportComposer: EffectComposer | null = null
  private exportPasses: { render: RenderPass; bloom: UnrealBloomPass; vignette: ShaderPass; grain: ShaderPass } | null = null
  private exportSize = ''

  /**
   * Render the scene through the FX chain at export resolution and return
   * bottom-up RGBA pixels. Never touches the viewport composer or the canvas.
   */
  renderExportPixels(renderer: THREE.WebGLRenderer, scene: THREE.Scene, camera: THREE.Camera, settings: PostFxSettings, timeSec: number, w: number, h: number): Uint8Array {
    const key = `${w}x${h}`
    if (!this.exportComposer || this.exportSize !== key) {
      this.exportComposer?.dispose()
      const rt = new THREE.WebGLRenderTarget(w, h, { type: THREE.UnsignedByteType, samples: 4 })
      const composer = new EffectComposer(renderer, rt)
      composer.renderToScreen = false
      const render = new RenderPass(scene, camera)
      render.clearAlpha = 0
      const bloom = new UnrealBloomPass(new THREE.Vector2(w, h), 0.25, 0.4, 1.05)
      const vignette = new ShaderPass(VignetteShader)
      const grain = new ShaderPass(GrainShader)
      composer.addPass(render)
      composer.addPass(bloom)
      composer.addPass(vignette)
      composer.addPass(grain)
      composer.addPass(new OutputPass())
      this.exportComposer = composer
      this.exportPasses = { render, bloom, vignette, grain }
      this.exportSize = key
    }
    const ps = this.exportPasses!
    ps.render.camera = camera
    ps.bloom.enabled = settings.bloom
    ps.bloom.strength = settings.bloomStrength
    ps.vignette.enabled = settings.vignette
    ps.grain.enabled = settings.filmGrain
    ;(ps.grain.uniforms as Record<string, { value: number }>)['time']!.value = timeSec % 10
    this.exportComposer!.render(1 / 60)
    const buf = new Uint8Array(w * h * 4)
    renderer.readRenderTargetPixels(this.exportComposer!.readBuffer, 0, 0, w, h, buf)
    renderer.setRenderTarget(null)
    return buf
  }

  disposeExport(): void {
    this.exportComposer?.dispose()
    this.exportComposer = null
    this.exportPasses = null
    this.exportSize = ''
  }

  get enabled(): boolean {
    return this.composer !== null
  }

  dispose(): void {
    this.composer?.dispose()
    this.composer = null
    this.disposeExport()
  }
}
