/**
 * 程序化音效：不依赖任何音频资源文件（PLAN.md §6 的降级策略）。
 * WebAudio 需要用户手势后才能启动，因此由第一次点击时 unlock()。
 */
export class Sfx {
  private context: AudioContext | null = null
  private master: GainNode | null = null
  private enabled = true

  unlock(): void {
    if (this.context) {
      void this.context.resume()
      return
    }
    const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
    if (!Ctor) {
      this.enabled = false
      return
    }
    this.context = new Ctor()
    this.master = this.context.createGain()
    this.master.gain.value = 0.32
    this.master.connect(this.context.destination)
  }

  swing(): void {
    this.noiseBurst(0.18, 700, 180, 0.35)
  }

  hit(power: number): void {
    const strength = 0.4 + power * 0.6
    this.tone(180, 90, 0.09, strength * 0.7, 'triangle')
    this.noiseBurst(0.06, 2400, 900, strength * 0.5)
  }

  land(strength: number): void {
    this.tone(120, 70, 0.08, Math.min(0.5, 0.15 + strength * 0.35), 'sine')
  }

  splash(): void {
    this.noiseBurst(0.34, 1200, 260, 0.45)
    this.tone(300, 120, 0.22, 0.25, 'sine')
  }

  cup(): void {
    this.tone(660, 660, 0.09, 0.35, 'sine')
    window.setTimeout(() => this.tone(990, 990, 0.16, 0.3, 'sine'), 90)
  }

  dispose(): void {
    void this.context?.close()
    this.context = null
    this.master = null
  }

  private tone(from: number, to: number, duration: number, gain: number, type: OscillatorType): void {
    const context = this.context
    const master = this.master
    if (!context || !master || !this.enabled) return

    const now = context.currentTime
    const oscillator = context.createOscillator()
    const envelope = context.createGain()
    oscillator.type = type
    oscillator.frequency.setValueAtTime(from, now)
    oscillator.frequency.exponentialRampToValueAtTime(Math.max(20, to), now + duration)
    envelope.gain.setValueAtTime(gain, now)
    envelope.gain.exponentialRampToValueAtTime(0.0001, now + duration)
    oscillator.connect(envelope).connect(master)
    oscillator.start(now)
    oscillator.stop(now + duration + 0.02)
  }

  private noiseBurst(duration: number, fromHz: number, toHz: number, gain: number): void {
    const context = this.context
    const master = this.master
    if (!context || !master || !this.enabled) return

    const frames = Math.floor(context.sampleRate * duration)
    const buffer = context.createBuffer(1, frames, context.sampleRate)
    const data = buffer.getChannelData(0)
    for (let i = 0; i < frames; i++) {
      data[i] = (Math.random() * 2 - 1) * (1 - i / frames)
    }

    const source = context.createBufferSource()
    source.buffer = buffer

    const filter = context.createBiquadFilter()
    filter.type = 'bandpass'
    filter.frequency.setValueAtTime(fromHz, context.currentTime)
    filter.frequency.exponentialRampToValueAtTime(Math.max(60, toHz), context.currentTime + duration)
    filter.Q.value = 0.9

    const envelope = context.createGain()
    envelope.gain.value = gain

    source.connect(filter).connect(envelope).connect(master)
    source.start()
  }
}
