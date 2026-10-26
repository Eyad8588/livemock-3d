import { describe, expect, it } from 'vitest'
import { applyEasing, cubicBezier, evalTrack, spring, EASINGS, lerpVec3 } from '../../src/shared/easingMath'
import type { Track } from '../../src/shared/types'

describe('easing functions', () => {
  it('linear returns input', () => {
    expect(EASINGS.linear(0)).toBe(0)
    expect(EASINGS.linear(0.4)).toBeCloseTo(0.4)
    expect(EASINGS.linear(1)).toBe(1)
  })
  it('easeInOutCubic is point-symmetric and clamped', () => {
    expect(EASINGS.easeInOutCubic(0)).toBe(0)
    expect(EASINGS.easeInOutCubic(1)).toBe(1)
    // f(0.25) + f(0.75) = 1 for ease-in-out
    expect(EASINGS.easeInOutCubic(0.25) + EASINGS.easeInOutCubic(0.75)).toBeCloseTo(1, 6)
  })
  it('easeOutExpo approaches 1', () => {
    expect(EASINGS.easeOutExpo(1)).toBe(1)
    expect(EASINGS.easeOutExpo(0.5)).toBeGreaterThan(0.9)
  })
  it('spring overshoots then settles', () => {
    expect(spring(0)).toBe(0)
    expect(spring(1)).toBeCloseTo(1)
    const peak = Math.max(...Array.from({ length: 100 }, (_, i) => spring((i + 1) / 100)))
    expect(peak).toBeGreaterThan(1.0)
  })
  it('cubic bezier matches CSS ease-in-out samples', () => {
    // CSS ease-in-out = cubic-bezier(0.42, 0, 0.58, 1)
    expect(cubicBezier(0.42, 0, 0.58, 1, 0)).toBe(0)
    expect(cubicBezier(0.42, 0, 0.58, 1, 1)).toBe(1)
    expect(cubicBezier(0.42, 0, 0.58, 1, 0.5)).toBeCloseTo(0.5, 2)
  })
  it('applyEasing dispatches bezier params', () => {
    expect(applyEasing('bezier', 0.5, [0.3, 0, 0.7, 1])).toBeCloseTo(0.5, 1)
  })
})

describe('track evaluation', () => {
  const track: Track<number> = {
    keys: [
      { t: 0, value: 0, easing: 'linear' },
      { t: 2, value: 100, easing: 'easeInOutCubic' },
      { t: 4, value: 200, easing: 'linear' }
    ]
  }
  it('holds first/last outside range', () => {
    expect(evalTrack(track, -1)).toBe(0)
    expect(evalTrack(track, 99)).toBe(200)
  })
  it('interpolates between keys with easing', () => {
    expect(evalTrack(track, 1)).toBeCloseTo(50)
    const eased = evalTrack(track, 1.5) as number
    expect(eased).toBeGreaterThan(50)
    expect(eased).toBeLessThan(100)
  })
  it('lerps Vec3 per component', () => {
    expect(lerpVec3({ x: 0, y: 1, z: 2 }, { x: 10, y: 11, z: 12 }, 0.5)).toEqual({ x: 5, y: 6, z: 7 })
  })
})
