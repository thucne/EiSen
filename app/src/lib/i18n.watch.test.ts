import { get } from "svelte/store";
import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  getConfig: vi.fn(),
  listeners: new Map<string, (e: { payload: unknown }) => void>(),
}));

vi.mock("$lib/api", () => ({
  getConfig: (...args: unknown[]) => h.getConfig(...args),
}));
vi.mock("@tauri-apps/api/event", () => ({
  listen: (event: string, cb: (e: { payload: unknown }) => void) => {
    h.listeners.set(event, cb);
    return Promise.resolve(() => h.listeners.delete(event));
  },
}));

import { i18n, setLang, watchLang } from "./i18n";
import { en } from "./i18n/en";
import { vi as viDict } from "./i18n/vi";

const CFG = {
  lang: "En" as const,
  save_dir: "/tmp",
  launch_at_login: false,
  hotkey: "DoubleOption" as const,
};

beforeEach(() => {
  setLang("en");
  h.listeners.clear();
  h.getConfig.mockReset();
  h.getConfig.mockResolvedValue(CFG);
});

describe("watchLang", () => {
  it("loads config then follows lang events from other windows", async () => {
    h.getConfig.mockResolvedValue({ ...CFG, lang: "Vi" });
    const un = await watchLang();
    expect(get(i18n).settings.title).toBe(viDict.settings.title);
    h.listeners.get("lang")!({ payload: "En" });
    expect(get(i18n).settings.title).toBe(en.settings.title);
    un();
    expect(h.listeners.has("lang")).toBe(false);
  });
});
