import { describe, expect, it } from "vitest";
import type { HotkeyPreset } from "$lib/api";
import { normalizeHotkey, supportedHotkeys } from "./hotkeyOptions";

describe("platform hotkey options", () => {
  it("exposes PrintScreen and the collision fallback on Windows", () => {
    expect(supportedHotkeys(true)).toEqual(["PrtScnWin", "CtrlShift5Win"]);
  });

  it("keeps the existing macOS preset order on macOS", () => {
    expect(supportedHotkeys(false)).toEqual([
      "DoubleOption",
      "DoubleShift",
      "CmdShift4Mac",
      "CtrlShift4Mac",
      "PrtScMac",
    ] satisfies HotkeyPreset[]);
  });

  it("normalizes an old macOS preset when it is loaded on Windows", () => {
    expect(normalizeHotkey(true, "DoubleShift")).toBe("PrtScnWin");
  });

  it("keeps the Windows fallback when it is already persisted", () => {
    expect(normalizeHotkey(true, "CtrlShift5Win" as HotkeyPreset)).toBe("CtrlShift5Win");
  });

  it("does not rewrite macOS configuration", () => {
    expect(normalizeHotkey(false, "DoubleShift")).toBe("DoubleShift");
  });
});
