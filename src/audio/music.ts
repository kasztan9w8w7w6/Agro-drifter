import { getAudioContext, resumeAudioContext } from "./context";

interface ChordDef {
  root: number;
  third: number;
  fifth: number;
}

function note(freq: number, semitones: number): number {
  return freq * Math.pow(2, semitones / 12);
}

function buildChord(rootFreq: number, minor: boolean): ChordDef {
  return { root: rootFreq, third: note(rootFreq, minor ? 3 : 4), fifth: note(rootFreq, 7) };
}

function makeDistortionCurve(amount: number): Float32Array<ArrayBuffer> {
  const n = 44100;
  const curve = new Float32Array(n);
  const deg = Math.PI / 180;
  for (let i = 0; i < n; i++) {
    const x = (i * 2) / n - 1;
    curve[i] = ((3 + amount) * x * 20 * deg) / (Math.PI + amount * Math.abs(x));
  }
  return curve;
}

export interface StationProfile {
  name: string;
  bpm: number;
  progression: ChordDef[];
  beatsPerChord: number;
  kickEveryNBeats: number;
  hihatEveryNBeats: number;
  padWave: OscillatorType;
  bassWave: OscillatorType;
  distortionAmount: number;
  padFilterBase: number;
  bassFilterBase: number;
  padGainBase: number;
  bassGainBase: number;
}

/** Melancholic minor-key pad + heavily distorted sub-bass, sparse beat. */
export const STATION_MELANCHOLY: StationProfile = {
  name: "Melancholia",
  bpm: 78,
  progression: [
    buildChord(110.0, true), // Am
    buildChord(87.31, false), // F
    buildChord(130.81, false), // C
    buildChord(98.0, false), // G
  ],
  beatsPerChord: 8,
  kickEveryNBeats: 2,
  hihatEveryNBeats: 0,
  padWave: "sawtooth",
  bassWave: "sawtooth",
  distortionAmount: 220,
  padFilterBase: 600,
  bassFilterBase: 400,
  padGainBase: 0.06,
  bassGainBase: 0.08,
};

/** Brighter major-key, faster four-on-the-floor "disco polo"-adjacent station. */
export const STATION_DISCO: StationProfile = {
  name: "Disco",
  bpm: 124,
  progression: [
    buildChord(130.81, false), // C
    buildChord(196.0, false), // G
    buildChord(110.0, true), // Am
    buildChord(174.61, false), // F
  ],
  beatsPerChord: 4,
  kickEveryNBeats: 1,
  hihatEveryNBeats: 2,
  padWave: "square",
  bassWave: "square",
  distortionAmount: 60,
  padFilterBase: 1400,
  bassFilterBase: 700,
  padGainBase: 0.045,
  bassGainBase: 0.07,
};

export interface MusicMood {
  driving01: number; // overall energy, roughly current speed ratio
  drift01: number; // how hard we're currently sliding
  danger01: number; // low fuel / high damage tension
}

/**
 * A small generative music director for one radio station. `setMood` is
 * called every frame with the current driving state and only smoothly
 * nudges gains/filters/detune - it never touches the beat scheduling, so
 * tempo stays locked regardless of what's happening on screen. Multiple
 * instances (one per station) can run concurrently, each into its own
 * output gain node, so `Radio` can crossfade between them instead of
 * hard-cutting on station switch.
 */
export class MusicDirector {
  private ctx: AudioContext | null = null;
  private started = false;

  private padOscs: OscillatorNode[] = [];
  private padGain!: GainNode;
  private padFilter!: BiquadFilterNode;

  private bassOsc?: OscillatorNode;
  private bassGain!: GainNode;
  private bassFilter!: BiquadFilterNode;

  private masterGain!: GainNode;

  private chordIndex = 0;
  private beatCounter = 0;
  private nextNoteTime = 0;
  private schedulerTimer: number | undefined;

  constructor(private profile: StationProfile) {}

  start(outputNode: AudioNode): void {
    resumeAudioContext();
    if (this.started) return;
    this.started = true;
    const ctx = getAudioContext();
    this.ctx = ctx;
    const p = this.profile;

    this.masterGain = ctx.createGain();
    this.masterGain.gain.value = 0.5;
    this.masterGain.connect(outputNode);

    this.padFilter = ctx.createBiquadFilter();
    this.padFilter.type = "lowpass";
    this.padFilter.frequency.value = p.padFilterBase;
    this.padGain = ctx.createGain();
    this.padGain.gain.value = p.padGainBase;
    this.padFilter.connect(this.padGain);
    this.padGain.connect(this.masterGain);

    const chord = p.progression[0];
    const detunes = [-6, 4, 9];
    [chord.root, chord.third, chord.fifth].forEach((freq, i) => {
      const osc = ctx.createOscillator();
      osc.type = p.padWave;
      osc.frequency.value = freq / 2; // pad sits an octave down
      osc.detune.value = detunes[i];
      osc.connect(this.padFilter);
      osc.start();
      this.padOscs.push(osc);
    });

    const bassShaper = ctx.createWaveShaper();
    bassShaper.curve = makeDistortionCurve(p.distortionAmount);
    bassShaper.oversample = "4x";
    this.bassFilter = ctx.createBiquadFilter();
    this.bassFilter.type = "lowpass";
    this.bassFilter.frequency.value = p.bassFilterBase;
    this.bassGain = ctx.createGain();
    this.bassGain.gain.value = p.bassGainBase;

    this.bassOsc = ctx.createOscillator();
    this.bassOsc.type = p.bassWave;
    this.bassOsc.frequency.value = chord.root / 2;
    this.bassOsc.connect(bassShaper);
    bassShaper.connect(this.bassFilter);
    this.bassFilter.connect(this.bassGain);
    this.bassGain.connect(this.masterGain);
    this.bassOsc.start();

    this.nextNoteTime = ctx.currentTime + 0.1;
    this.schedulerTimer = window.setInterval(() => this.scheduler(), 25);
  }

  stop(): void {
    if (this.schedulerTimer !== undefined) window.clearInterval(this.schedulerTimer);
  }

  setMood(mood: MusicMood): void {
    if (!this.started || !this.ctx) return;
    const p = this.profile;
    const now = this.ctx.currentTime;
    const intensity = Math.min(1, mood.driving01 * 0.6 + mood.drift01 * 0.7);

    this.bassGain.gain.setTargetAtTime(p.bassGainBase + intensity * 0.14, now, 0.3);
    this.bassFilter.frequency.setTargetAtTime(p.bassFilterBase - 180 + intensity * 900, now, 0.3);

    this.padGain.gain.setTargetAtTime(p.padGainBase - 0.01 + mood.danger01 * 0.06, now, 0.5);
    this.padFilter.frequency.setTargetAtTime(p.padFilterBase - 100 + mood.danger01 * 1200 - intensity * 80, now, 0.5);

    this.padOscs[2]?.detune.setTargetAtTime(9 + mood.danger01 * 22, now, 0.6);
  }

  private scheduler(): void {
    if (!this.ctx) return;
    const secPerBeat = 60 / this.profile.bpm;
    while (this.nextNoteTime < this.ctx.currentTime + 0.12) {
      this.scheduleBeat(this.nextNoteTime);
      this.nextNoteTime += secPerBeat;
      this.beatCounter++;
    }
  }

  private scheduleBeat(time: number): void {
    const p = this.profile;
    if (this.beatCounter % p.beatsPerChord === 0) {
      this.chordIndex = (this.chordIndex + 1) % p.progression.length;
      this.glideToChord(p.progression[this.chordIndex], time);
    }
    if (p.kickEveryNBeats > 0 && this.beatCounter % p.kickEveryNBeats === 0) {
      this.scheduleKick(time);
    }
    if (p.hihatEveryNBeats > 0 && this.beatCounter % p.hihatEveryNBeats === 0) {
      this.scheduleHihat(time);
    }
  }

  private glideToChord(chord: ChordDef, time: number): void {
    const freqs = [chord.root, chord.third, chord.fifth];
    this.padOscs.forEach((osc, i) => osc.frequency.setTargetAtTime(freqs[i] / 2, time, 0.4));
    this.bassOsc?.frequency.setTargetAtTime(chord.root / 2, time, 0.25);
  }

  private scheduleKick(time: number): void {
    if (!this.ctx) return;
    const ctx = this.ctx;
    const osc = ctx.createOscillator();
    osc.type = "sine";
    const gain = ctx.createGain();
    osc.frequency.setValueAtTime(150, time);
    osc.frequency.exponentialRampToValueAtTime(38, time + 0.15);
    gain.gain.setValueAtTime(0.22, time);
    gain.gain.exponentialRampToValueAtTime(0.001, time + 0.28);
    osc.connect(gain);
    gain.connect(this.masterGain);
    osc.start(time);
    osc.stop(time + 0.3);
  }

  private scheduleHihat(time: number): void {
    if (!this.ctx) return;
    const ctx = this.ctx;
    const bufferSize = ctx.sampleRate * 0.05;
    const buffer = ctx.createBuffer(1, bufferSize, ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < bufferSize; i++) data[i] = Math.random() * 2 - 1;
    const noise = ctx.createBufferSource();
    noise.buffer = buffer;
    const filter = ctx.createBiquadFilter();
    filter.type = "highpass";
    filter.frequency.value = 6000;
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0.06, time);
    gain.gain.exponentialRampToValueAtTime(0.001, time + 0.04);
    noise.connect(filter);
    filter.connect(gain);
    gain.connect(this.masterGain);
    noise.start(time);
    noise.stop(time + 0.05);
  }
}
