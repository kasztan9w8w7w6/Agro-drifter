import { getAudioContext } from "./context";
import { MusicDirector, STATION_DISCO, STATION_MELANCHOLY, type MusicMood, type StationProfile } from "./music";

const CROSSFADE_S = 1.2;

const STATIONS: StationProfile[] = [STATION_MELANCHOLY, STATION_DISCO];

/**
 * Owns one `MusicDirector` per station, each always running into its own
 * gain node, and crossfades between those gain nodes on station switch
 * (`GainNode` ramp, never a hard cut - brief section 7). Physics stays
 * untouched by station choice in this MVP; only the music/ambient layer
 * changes.
 */
export class Radio {
  private directors: MusicDirector[] = [];
  private gains: GainNode[] = [];
  private current = 0;
  private started = false;

  get stationName(): string {
    return STATIONS[this.current].name;
  }

  start(): void {
    if (this.started) return;
    this.started = true;
    const ctx = getAudioContext();
    for (let i = 0; i < STATIONS.length; i++) {
      const gain = ctx.createGain();
      gain.gain.value = i === this.current ? 1 : 0;
      gain.connect(ctx.destination);
      const director = new MusicDirector(STATIONS[i]);
      director.start(gain);
      this.gains.push(gain);
      this.directors.push(director);
    }
  }

  next(): void {
    if (!this.started) return;
    const target = (this.current + 1) % STATIONS.length;
    const ctx = getAudioContext();
    const now = ctx.currentTime;

    const from = this.gains[this.current].gain;
    from.cancelScheduledValues(now);
    from.setValueAtTime(from.value, now);
    from.linearRampToValueAtTime(0, now + CROSSFADE_S);

    const to = this.gains[target].gain;
    to.cancelScheduledValues(now);
    to.setValueAtTime(to.value, now);
    to.linearRampToValueAtTime(1, now + CROSSFADE_S);

    this.current = target;
  }

  setMood(mood: MusicMood): void {
    for (const director of this.directors) director.setMood(mood);
  }
}
