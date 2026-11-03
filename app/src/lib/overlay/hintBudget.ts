const STORAGE_KEY = "eisen.overlayHintShown";

/** How many captures show the usage hint before the overlay stays clean. */
export const HINT_CAPTURES = 3;

type HintStorage = Pick<Storage, "getItem" | "setItem">;

function browserStorage(): HintStorage | null {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

/** Spends one showing of the hint. Without working storage the hint keeps
 *  showing: repeating it costs less than never teaching Esc. */
export function takeHintShowing(storage: HintStorage | null = browserStorage()): boolean {
  if (!storage) return true;
  try {
    const shown = Number.parseInt(storage.getItem(STORAGE_KEY) ?? "0", 10) || 0;
    if (shown >= HINT_CAPTURES) return false;
    storage.setItem(STORAGE_KEY, String(shown + 1));
    return true;
  } catch {
    return true;
  }
}
