import { describe, expect, it } from 'vitest'
import { buildExportFilename, buildFfmpegArgs, h264Bitrate, parseByteRange, sanitizeNamePart } from '../../src/shared/exportUtils'

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
  it('vp9 alpha uses yuva420p only when transparent', () => {
    expect(buildFfmpegArgs('webm-vp9-alpha', { ...base, transparent: true })).toContain('yuva420p')
    expect(buildFfmpegArgs('webm-vp9-alpha', base)).toContain('yuv420p')
  })
  it('raw input is always 4-byte RGBA (matches what the renderer streams)', () => {
    for (const f of ['mp4-h264', 'gif', 'png-seq', 'mov-prores4444'] as const) {
      const args = buildFfmpegArgs(f, base)
      expect(args[args.indexOf('-pixel_format') + 1]).toBe('rgba')
    }
  })
  it('png output keeps alpha only when transparent', () => {
    expect(buildFfmpegArgs('png-seq', { ...base, transparent: true })).toContain('rgba')
    const opaque = buildFfmpegArgs('png-seq', base)
    expect(opaque[opaque.lastIndexOf('-pix_fmt') + 1]).toBe('rgb24')
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

describe('http byte ranges (media protocol)', () => {
  it('parses open, closed and suffix ranges', () => {
    expect(parseByteRange('bytes=0-', 1000)).toEqual({ start: 0, end: 999 })
    expect(parseByteRange('bytes=100-199', 1000)).toEqual({ start: 100, end: 199 })
    expect(parseByteRange('bytes=-100', 1000)).toEqual({ start: 900, end: 999 })
    expect(parseByteRange('bytes=900-5000', 1000)).toEqual({ start: 900, end: 999 })
  })
  it('rejects absent, malformed or unsatisfiable ranges', () => {
    expect(parseByteRange(null, 1000)).toBeNull()
    expect(parseByteRange('bytes=1000-', 1000)).toBeNull()
    expect(parseByteRange('bytes=5-2', 1000)).toBeNull()
    expect(parseByteRange('bytes=0-1,5-6', 1000)).toBeNull()
    expect(parseByteRange('items=0-1', 1000)).toBeNull()
  })
})
