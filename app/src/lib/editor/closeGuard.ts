/** How long a warning stays armed; matches the default Toast duration. */
export const CLOSE_CONFIRM_WINDOW_MS = 2200;

/**
 * Decides whether the editor may close. With unsaved marks the first request
 * only warns, and a second one inside the window closes.
 */
export function createCloseGuard(now: () => number = Date.now) {
  let warnedAt: number | null = null;
  return {
    allowClose(unsaved: boolean): boolean {
      if (!unsaved) return true;
      const t = now();
      if (warnedAt != null && t - warnedAt <= CLOSE_CONFIRM_WINDOW_MS) return true;
      warnedAt = t;
      return false;
    },
  };
}
