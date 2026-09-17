let sharedCtx: AudioContext | null = null;

/** One AudioContext shared by the SFX engine and the music director, so
 * unlocking audio on the first user gesture unlocks both at once. */
export function getAudioContext(): AudioContext {
  if (!sharedCtx) sharedCtx = new AudioContext();
  return sharedCtx;
}

export function resumeAudioContext(): void {
  const ctx = getAudioContext();
  if (ctx.state === "suspended") void ctx.resume();
}
