import { describe, expect, it } from 'vitest'
import { buildExportFilename, buildFfmpegArgs, h264Bitrate, sanitizeNamePart } from '../../src/shared/exportUtils'

describe('export filename', () => {
  it('matches <project>_<scene>_<WxH>_<fps>.<ext>', () => {
    expect(buildExportFilename('My Project', 'Scene 1', 1080, 1920, 30, 'mp4')).toBe('My Project_Scene 1_1080x1920_30.mp4')
  })
  it('sanitizes unsafe characters (runs collapse to one underscore)', () => {
    expect(sanitizeNamePart('a/b:c*?')).toBe('a_b_c_')
    expect(sanitizeNamePart('')).toBe('untitled')
  })
})

describe('ffmpeg args', () => {
  const base = {
    frameFormat: 'rgba' as const, width: 1080, height: 1920, fps: 30,
    inputPath: 'pipe:0', transparent: false, quality: 'high' as const
  }
  it('prores4444 uses yuva444p10le with alpha', () => {
    const args = buildFfmpegArgs('mov-prores4444', { ...base, transparent: true })
    expect(args).toContain('prores_ks')
    expect(args).toContain('yuva444p10le')
  })
  it('h264 fallback picks preset by quality', () => {
    expect(buildFfmpegArgs('mp4-h264', { ...base, quality: 'fast' })).toContain('veryfast')
    expect(buildFfmpegArgs('mp4-h264', { ...base, quality: 'max' })).toContain('slow')
  })
  it('vp9 alpha uses yuva420p', () => {
    expect(buildFfmpegArgs('webm-vp9-alpha', base)).toContain('yuva420p')
  })
  it('png-still caps one frame', () => {
    const args = buildFfmpegArgs('png-still', base)
    expect(args.indexOf('-frames:v')).toBeGreaterThan(-1)
  })
  it('audio trims add -ss/-t and fades', () => {
    const args = buildFfmpegArgs('mp4-h264', { ...base, audioPath: '/m.mp3', audioTrim: { in: 2, out: 10, fadeIn: 1, fadeOut: 2, volume: 0.8 } })
    expect(args).toContain('-ss')
    expect(args.join(' ')).toContain('afade=t=out')
  })
})

describe('h264 bitrate heuristic', () => {
  it('scales with pixels and fps, within sane bounds', () => {
    const low = h264Bitrate(540, 960, 24, 'fast')
    const high = h264Bitrate(1080, 1920, 60, 'max')
    expect(low).toBeLessThan(high)
    expect(high).toBeLessThanOrEqual(80_000_000)
    expect(low).toBeGreaterThanOrEqual(2_000_000)
  })
})
