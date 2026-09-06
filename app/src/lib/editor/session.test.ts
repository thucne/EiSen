import { describe, expect, it, vi } from "vitest";
import type { CaptureSession } from "../api";
import {
  createSessionLoader,
  watchFocusReload,
  type LoadedSession,
  type SessionApi,
} from "./session";

function sessionAt(path: string, width = 200, height = 100, scale = 1): CaptureSession {
  return { path, rect: { left: 0, top: 0, width, height }, scale };
}

function fakeApi(impl: () => Promise<CaptureSession>): SessionApi {
  return { getLastCapture: vi.fn(impl) };
}

describe("createSessionLoader", () => {
  it("emits clamped dimensions and the asset URL on success", async () => {
    const onLoaded = vi.fn();
    const load = createSessionLoader({
      api: fakeApi(() => Promise.resolve(sessionAt("/tmp/a.png", 0, -5))),
      toFileSrc: (p) => `asset://${p}`,
      onLoaded,
      onError: vi.fn(),
    });
    await load(true);
    expect(onLoaded).toHaveBeenCalledTimes(1);
    const s = onLoaded.mock.calls[0][0] as LoadedSession;
    expect(s.path).toBe("/tmp/a.png");
    expect(s.width).toBe(1);
    expect(s.height).toBe(1);
    expect(s.fileSrc).toBe("asset:///tmp/a.png");
  });

  it("propagates scale 2 while keeping logical width and height", async () => {
    const onLoaded = vi.fn();
    const load = createSessionLoader({
      api: fakeApi(() => Promise.resolve(sessionAt("/tmp/retina.png", 1280, 800, 2))),
      toFileSrc: (p) => p,
      onLoaded,
      onError: vi.fn(),
    });
    await load(true);
    const s = onLoaded.mock.calls[0][0] as LoadedSession;
    expect(s.scale).toBe(2);
    expect(s.width).toBe(1280);
    expect(s.height).toBe(800);
  });

  it("normalizes degenerate scales to 1", async () => {
    const onLoaded = vi.fn();
    const load = createSessionLoader({
      api: fakeApi(() => Promise.resolve(sessionAt("/tmp/a.png", 200, 100, 0))),
      toFileSrc: (p) => p,
      onLoaded,
      onError: vi.fn(),
    });
    await load(true);
    expect((onLoaded.mock.calls[0][0] as LoadedSession).scale).toBe(1);

    const onLoadedNan = vi.fn();
    const loadNan = createSessionLoader({
      api: fakeApi(() => Promise.resolve(sessionAt("/tmp/b.png", 200, 100, Number.NaN))),
      toFileSrc: (p) => p,
      onLoaded: onLoadedNan,
      onError: vi.fn(),
    });
    await loadNan(true);
    expect((onLoadedNan.mock.calls[0][0] as LoadedSession).scale).toBe(1);
  });

  it("skips the reload when the same capture is already shown", async () => {
    const onLoaded = vi.fn();
    const load = createSessionLoader({
      api: fakeApi(() => Promise.resolve(sessionAt("/tmp/a.png"))),
      toFileSrc: (p) => p,
      onLoaded,
      onError: vi.fn(),
    });
    await load(true);
    await load();
    await load();
    expect(onLoaded).toHaveBeenCalledTimes(1);
  });

  it("force reloads even when the path is unchanged", async () => {
    const onLoaded = vi.fn();
    const load = createSessionLoader({
      api: fakeApi(() => Promise.resolve(sessionAt("/tmp/a.png"))),
      toFileSrc: (p) => p,
      onLoaded,
      onError: vi.fn(),
    });
    await load(true);
    await load(true);
    expect(onLoaded).toHaveBeenCalledTimes(2);
  });

  it("reloads without force when a different capture arrives", async () => {
    let current = sessionAt("/tmp/a.png");
    const onLoaded = vi.fn();
    const load = createSessionLoader({
      api: fakeApi(() => Promise.resolve(current)),
      toFileSrc: (p) => p,
      onLoaded,
      onError: vi.fn(),
    });
    await load(true);
    current = sessionAt("/tmp/b.png");
    await load();
    expect(onLoaded).toHaveBeenCalledTimes(2);
    expect((onLoaded.mock.calls[1][0] as LoadedSession).path).toBe("/tmp/b.png");
  });

  it("routes failures to onError with the stringified error", async () => {
    const onLoaded = vi.fn();
    const onError = vi.fn();
    const load = createSessionLoader({
      api: fakeApi(() => Promise.reject(new Error("boom"))),
      toFileSrc: (p) => p,
      onLoaded,
      onError,
    });
    await load(true);
    expect(onError).toHaveBeenCalledWith("Error: boom");
    expect(onLoaded).not.toHaveBeenCalled();
  });
});

describe("watchFocusReload", () => {
  function fakeWindow() {
    const handlers: Array<(e: { payload: boolean }) => void> = [];
    return {
      win: {
        onFocusChanged: vi.fn((h: (e: { payload: boolean }) => void) => {
          handlers.push(h);
          return Promise.resolve(() => {
            handlers.splice(handlers.indexOf(h), 1);
          });
        }),
      },
      emit(focused: boolean) {
        for (const h of [...handlers]) h({ payload: focused });
      },
      count() {
        return handlers.length;
      },
    };
  }

  it("reloads only when focus is regained", async () => {
    const { win, emit } = fakeWindow();
    const reload = vi.fn();
    await watchFocusReload(win, reload);
    emit(false);
    expect(reload).not.toHaveBeenCalled();
    emit(true);
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it("returns an unlisten that detaches the handler", async () => {
    const { win, emit, count } = fakeWindow();
    const unlisten = await watchFocusReload(win, vi.fn());
    expect(count()).toBe(1);
    unlisten();
    expect(count()).toBe(0);
    emit(true);
  });
});
