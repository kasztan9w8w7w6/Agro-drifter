import { getAudioContext, resumeAudioContext } from "./context";

const BPM = 78;
const SEC_PER_BEAT = 60 / BPM;
const BEATS_PER_CHORD = 8; // two bars of 4
const SCHEDULE_AHEAD = 0.12;
const LOOKAHEAD_MS = 25;

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

// A minor - F major - C major - G major: a classic melancholic i-VI-III-VII
// loop, played slow and legato rather than strummed.
const PROGRESSION: ChordDef[] = [
  buildChord(110.0, true), // Am
  buildChord(87.31, false), // F
  buildChord(130.81, false), // C
  buildChord(98.0, false), // G
];

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

export interface MusicMood {
  driving01: number; // overall energy, roughly current speed ratio
  drift01: number; // how hard we're currently sliding
  danger01: number; // low fuel / high damage tension
}

/**
 * A small generative music director: a melancholic minor-key pad loop with
 * a heavily distorted sub-bass underneath, scheduled with a classic
 * look-ahead sequencer so timing stays sample-accurate even if the game's
 * render loop stutters. `setMood` is called every frame with the current
 * driving state and only smoothly nudges gains/filters/detune - it never
 * touches the beat scheduling, so the music keeps its tempo regardless of
 * what's happening on screen.
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

  start(): void {
    resumeAudioContext();
    if (this.started) return;
    this.started = true;
    const ctx = getAudioContext();
    this.ctx = ctx;

    this.masterGain = ctx.createGain();
    this.masterGain.gain.setValueAtTime(0, ctx.currentTime);
    this.masterGain.gain.linearRampToValueAtTime(0.5, ctx.currentTime + 2);
    this.masterGain.connect(ctx.destination);

    this.padFilter = ctx.createBiquadFilter();
    this.padFilter.type = "lowpass";
    this.padFilter.frequency.value = 600;
    this.padGain = ctx.createGain();
    this.padGain.gain.value = 0.06;
    this.padFilter.connect(this.padGain);
    this.padGain.connect(this.masterGain);

    const chord = PROGRESSION[0];
    const detunes = [-6, 4, 9];
    [chord.root, chord.third, chord.fifth].forEach((freq, i) => {
      const osc = ctx.createOscillator();
      osc.type = "sawtooth";
      osc.frequency.value = freq / 2; // pad sits an octave down, melancholic register
      osc.detune.value = detunes[i];
      osc.connect(this.padFilter);
      osc.start();
      this.padOscs.push(osc);
    });

    const bassShaper = ctx.createWaveShaper();
    bassShaper.curve = makeDistortionCurve(220);
    bassShaper.oversample = "4x";
    this.bassFilter = ctx.createBiquadFilter();
    this.bassFilter.type = "lowpass";
    this.bassFilter.frequency.value = 400;
    this.bassGain = ctx.createGain();
    this.bassGain.gain.value = 0.08;

    this.bassOsc = ctx.createOscillator();
    this.bassOsc.type = "sawtooth";
    this.bassOsc.frequency.value = chord.root / 2;
    this.bassOsc.connect(bassShaper);
    bassShaper.connect(this.bassFilter);
    this.bassFilter.connect(this.bassGain);
    this.bassGain.connect(this.masterGain);
    this.bassOsc.start();

    this.nextNoteTime = ctx.currentTime + 0.1;
    this.schedulerTimer = window.setInterval(() => this.scheduler(), LOOKAHEAD_MS);
  }

  stop(): void {
    if (this.schedulerTimer !== undefined) window.clearInterval(this.schedulerTimer);
  }

  setMood(mood: MusicMood): void {
    if (!this.started || !this.ctx) return;
    const now = this.ctx.currentTime;
    const intensity = Math.min(1, mood.driving01 * 0.6 + mood.drift01 * 0.7);

    this.bassGain.gain.setTargetAtTime(0.08 + intensity * 0.14, now, 0.3);
    this.bassFilter.frequency.setTargetAtTime(220 + intensity * 900, now, 0.3);

    this.padGain.gain.setTargetAtTime(0.05 + mood.danger01 * 0.06, now, 0.5);
    this.padFilter.frequency.setTargetAtTime(500 + mood.danger01 * 1200 - intensity * 80, now, 0.5);

    // Danger detunes the top voice further out of tune for a dissonant,
    // uneasy beating instead of a clean chord.
    this.padOscs[2]?.detune.setTargetAtTime(9 + mood.danger01 * 22, now, 0.6);
  }

  private scheduler(): void {
    if (!this.ctx) return;
    while (this.nextNoteTime < this.ctx.currentTime + SCHEDULE_AHEAD) {
      this.scheduleBeat(this.nextNoteTime);
      this.nextNoteTime += SEC_PER_BEAT;
      this.beatCounter++;
    }
  }

  private scheduleBeat(time: number): void {
    if (this.beatCounter % BEATS_PER_CHORD === 0) {
      this.chordIndex = (this.chordIndex + 1) % PROGRESSION.length;
      this.glideToChord(PROGRESSION[this.chordIndex], time);
    }
    // A sparse pulse (skips every other beat) reads as melancholic rather
    // than a driving four-on-the-floor beat.
    if (this.beatCounter % 2 === 0) {
      this.scheduleKick(time);
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
}
