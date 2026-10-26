// Frame-accurate video decoding for export (SPEC §4.3/§9): Mediabunny demux
// + WebCodecs VideoDecoder. Never uses <video> seeking during export.

import { ALL_FORMATS, BufferSource, Input, VideoSampleSink, type VideoSample } from 'mediabunny'

export class ExportVideoDecoder {
  private sink: VideoSampleSink | null = null
  private lastSample: VideoSample | null = null
  readonly durationSec: number
  readonly width: number
  readonly height: number

  private constructor(durationSec: number, width: number, height: number) {
    this.durationSec = durationSec
    this.width = width
    this.height = height
  }

  static async open(mediaUrl: string): Promise<ExportVideoDecoder | null> {
    try {
      const res = await fetch(mediaUrl)
      if (!res.ok) return null
      const bytes = await res.arrayBuffer()
      const input = new Input({ formats: ALL_FORMATS, source: new BufferSource(bytes) })
      const track = await input.getPrimaryVideoTrack()
      if (!track) return null
      const sink = new VideoSampleSink(track)
      const dec = new ExportVideoDecoder(await input.computeDuration(), track.codedWidth, track.codedHeight)
      dec.sink = sink
      return dec
    } catch (err) {
      console.warn('[livemock] ExportVideoDecoder open failed:', err)
      return null
    }
  }

  /** Draw the exact frame at media time onto the context (fills the rect). */
  async drawFrameAt(ctx: OffscreenCanvasRenderingContext2D, mediaTime: number, dx: number, dy: number, dw: number, dh: number): Promise<boolean> {
    if (!this.sink) return false
    try {
      const sample = await this.sink.getSample(Math.max(0, mediaTime))
      if (!sample) {
        if (this.lastSample) {
          this.lastSample.draw(ctx, dx, dy, dw, dh)
          return true
        }
        return false
      }
      this.lastSample?.close()
      this.lastSample = sample
      sample.draw(ctx, dx, dy, dw, dh)
      return true
    } catch (err) {
      console.warn('[livemock] drawFrameAt failed:', err)
      return false
    }
  }

  dispose(): void {
    this.lastSample?.close()
    this.lastSample = null
    this.sink = null
  }
}
