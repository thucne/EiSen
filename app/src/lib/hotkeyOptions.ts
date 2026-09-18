import type { HotkeyPreset } from "$lib/api";

export const MAC_HOTKEYS: HotkeyPreset[] = [
  "DoubleOption",
  "DoubleShift",
  "CmdShift4Mac",
  "CtrlShift4Mac",
  "PrtScMac",
];

export const WINDOWS_HOTKEYS: HotkeyPreset[] = ["PrtScnWin", "CtrlShift5Win"];

export function supportedHotkeys(isWindows: boolean, current?: HotkeyPreset): HotkeyPreset[] {
  if (isWindows) return [...WINDOWS_HOTKEYS];
  return current === "PrtScnWin" || current === "CtrlShift5Win"
    ? [...MAC_HOTKEYS, current]
    : [...MAC_HOTKEYS];
}

export function normalizeHotkey(isWindows: boolean, preset: HotkeyPreset): HotkeyPreset {
  return isWindows && !WINDOWS_HOTKEYS.includes(preset) ? "PrtScnWin" : preset;
}

export function isWindowsUserAgent(userAgent: string): boolean {
  return /\bWindows\b/i.test(userAgent);
}
