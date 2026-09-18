const SAVE_KEY = "agro-drifter-save";

export interface SaveData {
  /** 0..1, how far along the course the checkpoint was. */
  progress: number;
  savedAtStation: string;
  timestamp: number;
}

export function saveGame(data: SaveData): void {
  try {
    localStorage.setItem(SAVE_KEY, JSON.stringify(data));
  } catch {
    // Storage can be unavailable (private mode, quota) - non-fatal for a demo level.
  }
}

export function loadGame(): SaveData | null {
  try {
    const raw = localStorage.getItem(SAVE_KEY);
    return raw ? (JSON.parse(raw) as SaveData) : null;
  } catch {
    return null;
  }
}
