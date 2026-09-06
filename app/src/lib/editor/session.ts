import type { CaptureSession } from "../api";
import { normalizeExportScale } from "./exportPipeline";

/** Minimal IPC surface the session loader needs (injected for testability). */
export interface SessionApi {
  getLastCapture(): Promise<CaptureSession>;
}

/** One resolved capture session, ready for the editor page to render. */
export interface LoadedSession {
  /** Durable capture file path. */
  path: string;
  width: number;
  height: number;
  /** Capture scale factor, already normalized via `normalizeExportScale`. */
  scale: number;
  /** Asset URL for the capture image (`convertFileSrc` output). */
  fileSrc: string;
}

export interface SessionLoaderDeps {
  api: SessionApi;
  /** Converts a capture path into a loadable asset URL. */
  toFileSrc: (path: string) => string;
  onLoaded: (session: LoadedSession) => void;
  onError: (message: string) => void;
}

/** Creates the editor's capture-session loader. The "same capture" dedup
 *  cache lives here so refocusing the window does not re-render an
 *  already-shown capture unless `force` is set. */
export function createSessionLoader(
  deps: SessionLoaderDeps,
): (force?: boolean) => Promise<void> {
  let loadedPath: string | null = null;
  return async function loadSession(force = false): Promise<void> {
    try {
      const s = await deps.api.getLastCapture();
      if (!force && s.path === loadedPath) return;
      loadedPath = s.path;
      deps.onLoaded({
        path: s.path,
        width: Math.max(1, s.rect.width),
        height: Math.max(1, s.rect.height),
        scale: normalizeExportScale(s.scale),
        fileSrc: deps.toFileSrc(s.path),
      });
    } catch (err) {
      deps.onError(String(err));
    }
  };
}

interface FocusEventWindow {
  onFocusChanged(
    handler: (event: { payload: boolean }) => void,
  ): Promise<() => void>;
}

/** Reloads the capture session whenever the window regains focus. Returns
 *  the unlisten promise for cleanup in onMount teardown. */
export function watchFocusReload(
  win: FocusEventWindow,
  reload: () => void | Promise<void>,
): Promise<() => void> {
  return win.onFocusChanged(({ payload: focused }) => {
    if (focused) void reload();
  });
}
