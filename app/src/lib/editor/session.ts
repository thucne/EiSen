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
  prepare?: (session: LoadedSession) => Promise<void>;
  onLoaded: (session: LoadedSession) => void | Promise<void>;
  onError: (message: string) => void;
}

/** Creates the editor's capture-session loader. The "same capture" dedup
 *  cache lives here so refocusing the window does not re-render an
 *  already-shown capture unless `force` is set. */
export function createSessionLoader(
  deps: SessionLoaderDeps,
): (force?: boolean) => Promise<void> {
  let loadedPath: string | null = null;
  let latestRequest = 0;
  return async function loadSession(force = false): Promise<void> {
    const request = ++latestRequest;
    try {
      const s = await deps.api.getLastCapture();
      if (request !== latestRequest || (!force && s.path === loadedPath)) return;
      const session = {
        path: s.path,
        width: Math.max(1, s.rect.width),
        height: Math.max(1, s.rect.height),
        scale: normalizeExportScale(s.scale),
        fileSrc: deps.toFileSrc(s.path),
      };
      if (deps.prepare) await deps.prepare(session);
      if (request !== latestRequest) return;
      loadedPath = s.path;
      await deps.onLoaded(session);
    } catch (err) {
      if (request === latestRequest) deps.onError(String(err));
    }
  };
}

export async function decodeEditorImage(fileSrc: string): Promise<void> {
  const image = new Image();
  image.src = fileSrc;
  let timeout: ReturnType<typeof setTimeout> | undefined;
  try {
    await Promise.race([
      image.decode(),
      new Promise<never>((_, reject) => {
        timeout = setTimeout(() => reject(new Error("image load timed out")), 5000);
      }),
    ]);
  } finally {
    clearTimeout(timeout);
  }
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
