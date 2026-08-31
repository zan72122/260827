import type { FlowerRecord } from './FlowerRecord';
import type { SeatId } from './CakeState';

/**
 * Saving is a convenience, never a dependency: every call is wrapped so that a
 * private window, a full quota or a browser that refuses storage cannot stop
 * the game.
 */

const KEY = 'kurukuru-flower-birthday/v1';

export interface SavedSession {
  seat: SeatId;
  flowers: FlowerRecord[];
  savedAt: number;
}

export function saveSession(data: SavedSession): boolean {
  try {
    localStorage.setItem(KEY, JSON.stringify(data));
    return true;
  } catch {
    return false;
  }
}

export function loadSession(): SavedSession | null {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as SavedSession;
    if (!parsed || !Array.isArray(parsed.flowers)) return null;
    return parsed;
  } catch {
    return null;
  }
}

export function clearSession(): void {
  try {
    localStorage.removeItem(KEY);
  } catch {
    /* nothing to do; the game does not depend on it */
  }
}
