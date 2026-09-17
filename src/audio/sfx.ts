import { getAudioContext, resumeAudioContext } from "./context";

/**
 * Diegetic sound effects (engine drone, impacts, the pump beep) synthesised
 * with the Web Audio API - no sample files to license yet, swap this out
 * for real recordings later without touching gameplay code.
 */
export class SynthAudio {
  private ctx: AudioContext | null = null;
  private engineOsc: OscillatorNode | null = null;
  private engineGain: GainNode | null = null;
  private engineFilter: BiquadFilterNode | null = null;

  unlock(): void {
    resumeAudioContext();
    if (this.ctx) return;
    this.ctx = getAudioContext();
    this.startEngine();
  }

  private startEngine(): void {
    if (!this.ctx) return;
    const osc = this.ctx.createOscillator();
    osc.type = "sawtooth";
    osc.frequency.value = 60;

    const filter = this.ctx.createBiquadFilter();
    filter.type = "lowpass";
    filter.frequency.value = 300;

    const gain = this.ctx.createGain();
    gain.gain.value = 0.05;

    osc.connect(filter);
    filter.connect(gain);
    gain.connect(this.ctx.destination);
    osc.start();

    this.engineOsc = osc;
    this.engineGain = gain;
    this.engineFilter = filter;
  }

  setEngineIntensity(throttle01: number, speed01: number): void {
    if (!this.ctx || !this.engineOsc || !this.engineGain || !this.engineFilter) return;
    const now = this.ctx.currentTime;
    const freq = 55 + speed01 * 160 + throttle01 * 40;
    this.engineOsc.frequency.setTargetAtTime(freq, now, 0.05);
    this.engineGain.gain.setTargetAtTime(0.03 + throttle01 * 0.05, now, 0.08);
    this.engineFilter.frequency.setTargetAtTime(250 + speed01 * 900, now, 0.1);
  }

  private burstNoise(duration: number, volume: number, filterFreq: number): void {
    if (!this.ctx) return;
    const bufferSize = Math.floor(this.ctx.sampleRate * duration);
    const buffer = this.ctx.createBuffer(1, bufferSize, this.ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < bufferSize; i++) {
      data[i] = (Math.random() * 2 - 1) * (1 - i / bufferSize);
    }
    const src = this.ctx.createBufferSource();
    src.buffer = buffer;

    const filter = this.ctx.createBiquadFilter();
    filter.type = "bandpass";
    filter.frequency.value = filterFreq;

    const gain = this.ctx.createGain();
    gain.gain.value = volume;

    src.connect(filter);
    filter.connect(gain);
    gain.connect(this.ctx.destination);
    src.start();
  }

  playCrash(): void {
    this.burstNoise(0.25, 0.35, 800);
  }

  playGlass(): void {
    this.burstNoise(0.35, 0.25, 3200);
  }

  playThud(): void {
    this.burstNoise(0.18, 0.3, 200);
  }

  playPumpBeep(): void {
    if (!this.ctx) return;
    const osc = this.ctx.createOscillator();
    osc.type = "square";
    osc.frequency.value = 880;
    const gain = this.ctx.createGain();
    gain.gain.value = 0.06;
    osc.connect(gain);
    gain.connect(this.ctx.destination);
    osc.start();
    osc.stop(this.ctx.currentTime + 0.08);
  }
}
