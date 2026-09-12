import { fireEvent, render, screen, waitFor } from "@testing-library/svelte";
import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  invoke: vi.fn(),
  enable: vi.fn(),
  disable: vi.fn(),
}));

vi.mock("@tauri-apps/api/core", () => ({ invoke: h.invoke }));
vi.mock("@tauri-apps/api/event", () => ({
  listen: () => Promise.resolve(() => {}),
}));
vi.mock("@tauri-apps/plugin-autostart", () => ({
  enable: h.enable,
  disable: h.disable,
}));
vi.mock("@tauri-apps/plugin-dialog", () => ({
  open: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("$app/navigation", () => ({
  goto: vi.fn().mockResolvedValue(undefined),
}));

import { get } from "svelte/store";
import { i18n, setLang } from "$lib/i18n";
import { vi as viDict } from "$lib/i18n/vi";
import SettingsPage from "./+page.svelte";

const CFG = {
  lang: "En",
  save_dir: "/tmp/captures",
  launch_at_login: false,
  hotkey: "DoubleOption",
  play_sounds: true,
};

beforeEach(() => {
  setLang("en");
  h.invoke.mockReset();
  h.enable.mockReset().mockResolvedValue(undefined);
  h.disable.mockReset().mockResolvedValue(undefined);
  h.invoke.mockImplementation((cmd: string) => {
    if (cmd === "cmd_get_config") return Promise.resolve(CFG);
    return Promise.resolve(undefined); // cmd_set_config and initLang's call
  });
});

describe("settings autostart toggle contract", () => {
  it("enables autostart then persists launch_at_login=true", async () => {
    render(SettingsPage);
    const toggle = (await screen.findByRole("checkbox", { name: "Launch at login" })) as HTMLInputElement;
    toggle.checked = true;
    fireEvent.change(toggle);
    await waitFor(() => expect(h.enable).toHaveBeenCalledTimes(1));
    await waitFor(() => {
      expect(h.invoke).toHaveBeenCalledWith("cmd_set_config", {
        cfg: { ...CFG, launch_at_login: true },
      });
    });
    expect(h.disable).not.toHaveBeenCalled();
  });

  it("disables autostart then persists launch_at_login=false", async () => {
    render(SettingsPage);
    const toggle = (await screen.findByRole("checkbox", { name: "Launch at login" })) as HTMLInputElement;
    toggle.checked = false;
    fireEvent.change(toggle);
    await waitFor(() => expect(h.disable).toHaveBeenCalledTimes(1));
    await waitFor(() => {
      expect(h.invoke).toHaveBeenCalledWith("cmd_set_config", {
        cfg: { ...CFG, launch_at_login: false },
      });
    });
    expect(h.enable).not.toHaveBeenCalled();
  });

  it("toggles sound effects and persists play_sounds=false", async () => {
    render(SettingsPage);
    const toggle = (await screen.findByRole("checkbox", { name: "Sound effects" })) as HTMLInputElement;
    expect(toggle.checked).toBe(true);
    toggle.checked = false;
    fireEvent.change(toggle);
    await waitFor(() => {
      expect(h.invoke).toHaveBeenCalledWith("cmd_set_config", {
        cfg: { ...CFG, play_sounds: false },
      });
    });
  });
});

describe("hotkey save failures", () => {
  it("restores the previous selection when cmd_set_config rejects", async () => {
    h.invoke.mockImplementation((cmd: string) => {
      if (cmd === "cmd_get_config") return Promise.resolve(CFG);
      if (cmd === "cmd_set_config") {
        return Promise.reject("hotkey re-register failed: taken; restored previous shortcut");
      }
      return Promise.resolve(undefined);
    });
    render(SettingsPage);
    const selects = await screen.findAllByRole("combobox");
    const hotkeySelect = selects.find((el) =>
      [...(el as HTMLSelectElement).options].some((o) => o.value === "DoubleOption"),
    ) as HTMLSelectElement;
    expect(hotkeySelect.value).toBe("DoubleOption");
    await fireEvent.change(hotkeySelect, { target: { value: "CmdShift4Mac" } });
    await waitFor(() => {
      expect(hotkeySelect.value).toBe("DoubleOption");
    });
    expect(screen.getByRole("status")).toHaveTextContent(
      "hotkey re-register failed: taken; restored previous shortcut",
    );
  });

  it("keeps the new selection when cmd_set_config succeeds", async () => {
    render(SettingsPage);
    const selects = await screen.findAllByRole("combobox");
    const hotkeySelect = selects.find((el) =>
      [...(el as HTMLSelectElement).options].some((o) => o.value === "DoubleOption"),
    ) as HTMLSelectElement;
    await fireEvent.change(hotkeySelect, { target: { value: "CmdShift4Mac" } });
    await waitFor(() => {
      expect(h.invoke).toHaveBeenCalledWith("cmd_set_config", {
        cfg: { ...CFG, hotkey: "CmdShift4Mac" },
      });
    });
    expect(hotkeySelect.value).toBe("CmdShift4Mac");
    expect(screen.getByRole("status")).toHaveTextContent("Settings saved");
  });
});

describe("hotkey presets on macOS", () => {
  function hotkeySelect(): HTMLSelectElement {
    const selects = screen.getAllByRole("combobox");
    const found = selects.find((el) =>
      [...(el as HTMLSelectElement).options].some((o) => o.value === "DoubleOption"),
    );
    if (!found) throw new Error("hotkey select not found");
    return found as HTMLSelectElement;
  }

  it("does not list PrtScnWin on a default config", async () => {
    render(SettingsPage);
    const select = await waitFor(() => hotkeySelect());
    const values = [...select.options].map((o) => o.value);
    expect(values).not.toContain("PrtScnWin");
    expect(values).toContain("PrtScMac");
  });

  it("keeps PrtScnWin visible when it is already persisted", async () => {
    h.invoke.mockImplementation((cmd: string) => {
      if (cmd === "cmd_get_config") {
        return Promise.resolve({ ...CFG, hotkey: "PrtScnWin" });
      }
      return Promise.resolve(undefined);
    });
    render(SettingsPage);
    const select = await waitFor(() => hotkeySelect());
    expect(select.value).toBe("PrtScnWin");
    const values = [...select.options].map((o) => o.value);
    expect(values).toContain("PrtScnWin");
    expect(values).toContain("DoubleOption");
  });
});

describe("language", () => {
  function langSelect(): HTMLSelectElement {
    const selects = screen.getAllByRole("combobox");
    const found = selects.find((el) =>
      [...(el as HTMLSelectElement).options].some((o) => o.value === "Vi"),
    );
    if (!found) throw new Error("language select not found");
    return found as HTMLSelectElement;
  }

  it("persists Vi and switches the dictionary when Tiếng Việt is selected", async () => {
    render(SettingsPage);
    const select = await waitFor(() => langSelect());
    expect(select.value).toBe("En");
    await fireEvent.change(select, { target: { value: "Vi" } });
    await waitFor(() => {
      expect(h.invoke).toHaveBeenCalledWith("cmd_set_config", {
        cfg: { ...CFG, lang: "Vi" },
      });
    });
    expect(select.value).toBe("Vi");
    expect(get(i18n).settings.title).toBe(viDict.settings.title);
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("EiSen — Cài đặt");
    expect(screen.getByRole("status")).toHaveTextContent(viDict.settings.saved);
  });

  it("keeps English when cmd_set_config rejects a language change", async () => {
    h.invoke.mockImplementation((cmd: string) => {
      if (cmd === "cmd_get_config") return Promise.resolve(CFG);
      if (cmd === "cmd_set_config") return Promise.reject("persist failed");
      return Promise.resolve(undefined);
    });
    render(SettingsPage);
    const select = await waitFor(() => langSelect());
    await fireEvent.change(select, { target: { value: "Vi" } });
    await waitFor(() => {
      expect(select.value).toBe("En");
    });
    expect(get(i18n).settings.title).toBe("Settings");
    expect(screen.getByRole("status")).toHaveTextContent("persist failed");
  });

  it("applies cmd_reset_config lang instead of hardcoding English", async () => {
    h.invoke.mockImplementation((cmd: string) => {
      if (cmd === "cmd_get_config") return Promise.resolve(CFG);
      if (cmd === "cmd_reset_config") {
        return Promise.resolve({ ...CFG, lang: "Vi" });
      }
      return Promise.resolve(undefined);
    });
    render(SettingsPage);
    const reset = await screen.findByRole("button", { name: "Reset to defaults" });
    await fireEvent.click(reset);
    await waitFor(() => {
      expect(h.invoke).toHaveBeenCalledWith("cmd_reset_config");
    });
    expect(get(i18n).settings.title).toBe(viDict.settings.title);
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("EiSen — Cài đặt");
  });

  it("renders version information from cmd_get_app_version", async () => {
    h.invoke.mockImplementation((cmd: string) => {
      if (cmd === "cmd_get_config") return Promise.resolve(CFG);
      if (cmd === "cmd_get_app_version") return Promise.resolve("0.1.1");
      return Promise.resolve(undefined);
    });
    render(SettingsPage);
    await waitFor(() => {
      expect(screen.getByText("v0.1.1")).toBeInTheDocument();
      expect(screen.getByText(/EiSen v0\.1\.1/)).toBeInTheDocument();
    });
  });
});

