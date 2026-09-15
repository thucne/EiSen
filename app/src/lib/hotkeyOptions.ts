import type { HotkeyPreset } from "$lib/api";

export const MAC_HOTKEYS: HotkeyPreset[] = [
  "DoubleOption",
  "DoubleShift",
  "CmdShift4Mac",
  "CtrlShift4Mac",
  "PrtScMac",
];

export function supportedHotkeys(isWindows: boolean, current?: HotkeyPreset): HotkeyPreset[] {
  if (isWindows) return ["PrtScnWin"];
  return current === "PrtScnWin" ? [...MAC_HOTKEYS, current] : [...MAC_HOTKEYS];
}

export function normalizeHotkey(isWindows: boolean, preset: HotkeyPreset): HotkeyPreset {
  return isWindows && preset !== "PrtScnWin" ? "PrtScnWin" : preset;
}

export function isWindowsUserAgent(userAgent: string): boolean {
  return /\bWindows\b/i.test(userAgent);
}
