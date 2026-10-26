import { describe, expect, it } from 'vitest'
import { createDefaultProject, createDefaultScene, migrate, walkthroughDurationMs } from '../../src/shared/serialize'

describe('project serialize/migrate', () => {
  it('creates a valid default project', () => {
    const p = createDefaultProject()
    expect(p.schemaVersion).toBe(1)
    expect(p.scenes).toHaveLength(1)
    expect(migrate(JSON.parse(JSON.stringify(p)))).toBeTruthy()
  })
  it('rejects non-projects', () => {
    expect(() => migrate({ hello: 1 })).toThrow()
    expect(() => migrate(null)).toThrow()
  })
  it('clamps out-of-range values', () => {
    const p = createDefaultProject()
    p.scenes[0]!.durationSec = 999
    const m = migrate(JSON.parse(JSON.stringify(p)))
    expect(m.scenes[0]!.durationSec).toBe(60)
  })
  it('drops broken devices and keeps valid ones', () => {
    const p = createDefaultProject()
    const scene = createDefaultScene()
    scene.devices.push({
      id: 'dv_ok', presetId: 'phone-6.9', material: { finish: 'aluminum', color: '#000' },
      transform: { keys: [{ t: 0, value: { position: { x: 1, y: 2, z: 3 }, rotation: { x: 0, y: 0, z: 0 }, scale: { x: 1, y: 1, z: 1 } }, easing: 'linear' }] },
      screen: { kind: 'none' }, screenGlare: 0.5, cutout: 'pill'
    })
    p.scenes[0]!.devices = scene.devices
    const m = migrate(JSON.parse(JSON.stringify(p)))
    expect(m.scenes[0]!.devices).toHaveLength(1)
    expect(m.scenes[0]!.devices[0]!.screenGlare).toBe(0.5)
  })
})

describe('walkthrough timing', () => {
  it('sums waits and scrolls', () => {
    const total = walkthroughDurationMs([
      { type: 'wait', ms: 500 },
      { type: 'scroll', toY: 800, durationMs: 1500, easing: 'easeInOutCubic' },
      { type: 'tap', x: 10, y: 10, showRipple: true }
    ])
    expect(total).toBe(500 + 1500 + 350)
  })
  it('computes typing time from cpm with floor', () => {
    const total = walkthroughDurationMs([{ type: 'type', selector: '#q', text: 'hello', cpm: 600 }])
    expect(total).toBe(600) // 5 chars @600cpm = 500ms, floored to 600ms
  })
})
