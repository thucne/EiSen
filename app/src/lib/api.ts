import { invoke } from "@tauri-apps/api/core";

export type Lang = "En" | "Vi";

export type HotkeyPreset =
  | "DoubleOption"
  | "DoubleShift"
  | "CmdShift4Mac"
  | "CtrlShift4Mac"
  | "PrtScMac"
  | "PrtScnWin";

export interface AppConfig {
  lang: Lang;
  save_dir: string;
  launch_at_login: boolean;
  hotkey: HotkeyPreset;
}

export interface LogicalRect {
  left: number;
  top: number;
  width: number;
  height: number;
}

export interface CaptureSession {
  path: string;
  rect: LogicalRect;
  scale: number;
}

export interface SaveResult {
  path: string;
}

/**
 * Begin a new capture session and display the overlay.
 */
export function beginCapture(): Promise<string> {
  return invoke("cmd_begin_capture");
}

/**
 * Commit a selected region from the overlay.
 */
export function commitRegion(rect: LogicalRect, openEditor: boolean = false): Promise<CaptureSession> {
  return invoke("cmd_commit_region", { rect, openEditor });
}

/**
 * Cancel the active capture session and hide overlay.
 */
export function cancelCapture(): Promise<void> {
  return invoke("cmd_cancel_capture");
}

/**
 * Read the current app configuration.
 */
export function getConfig(): Promise<AppConfig> {
  return invoke("cmd_get_config");
}

/**
 * Save updated app configuration.
 */
export function setConfig(cfg: AppConfig): Promise<void> {
  return invoke("cmd_set_config", { cfg });
}

/**
 * Reset app configuration to factory defaults.
 */
export function resetConfig(): Promise<AppConfig> {
  return invoke("cmd_reset_config");
}

/**
 * Retrieve the last captured session.
 */
export function getLastCapture(): Promise<CaptureSession> {
  return invoke("cmd_get_last_capture");
}

/**
 * Open the captured image in the Editor window.
 */
export function openInEditor(path: string): Promise<void> {
  return invoke("cmd_open_in_editor", { path });
}

/**
 * Copy the raw capture to clipboard.
 */
export function copy(): Promise<void> {
  return invoke("cmd_copy");
}

/**
 * Save the raw capture to disk.
 */
export function save(): Promise<SaveResult> {
  return invoke("cmd_save");
}

/**
 * Copy and save the raw capture.
 */
export function copyAndSave(): Promise<SaveResult> {
  return invoke("cmd_copy_and_save");
}

/**
 * Copy rendered PNG byte array to system clipboard.
 */
export function copyBytes(bytes: Uint8Array): Promise<void> {
  return invoke("cmd_copy_bytes", { bytes });
}

/**
 * Save rendered PNG byte array to disk.
 */
export function saveBytes(bytes: Uint8Array): Promise<SaveResult> {
  return invoke("cmd_save_bytes", { bytes });
}

/**
 * Copy and save rendered PNG byte array simultaneously.
 */
export function copyAndSaveBytes(bytes: Uint8Array): Promise<SaveResult> {
  return invoke("cmd_copy_and_save_bytes", { bytes });
}

/**
 * Copy an allowed capture file to the clipboard (hub gallery cards).
 */
export function copyPath(path: string): Promise<void> {
  return invoke("cmd_copy_path", { path });
}

/**
 * Extract text from the active capture using native OCR.
 */
export function extractText(): Promise<string> {
  return invoke("cmd_extract_text");
}

/**
 * Get (and cache) a thumbnail path for a capture image.
 */
export function getThumbnail(path: string): Promise<string> {
  return invoke("cmd_get_thumbnail", { path });
}

/**
 * Remove a capture from the session gallery (the file on disk is untouched).
 */
export function removeHistory(path: string): Promise<void> {
  return invoke("cmd_remove_history", { path });
}

/**
 * Non-prompting macOS Screen Recording permission probe.
 */
export function screenPermission(): Promise<boolean> {
  return invoke("cmd_screen_permission");
}

/**
 * Open System Settings on Privacy & Security → Screen Recording.
 */
export function openScreenSettings(): Promise<void> {
  return invoke("cmd_open_screen_settings");
}
