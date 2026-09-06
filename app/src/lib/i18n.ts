import { derived, writable } from "svelte/store";
import { en } from "./i18n/en";
import { vi } from "./i18n/vi";

export type UiLang = "en" | "vi";

export const lang = writable<UiLang>("en");

export const i18n = derived(lang, (l) => (l === "vi" ? vi : en));

export function setLang(l: UiLang): void {
  lang.set(l);
}

/** Config serializes language as `"En"` / `"Vi"`; the UI store uses `"en"` / `"vi"`. */
export function uiLangFromConfig(value: string): UiLang {
  return value === "Vi" || value === "vi" ? "vi" : "en";
}

export async function initLang(): Promise<void> {
  try {
    const { getConfig } = await import("$lib/api");
    const cfg = await getConfig();
    setLang(uiLangFromConfig(cfg.lang));
  } catch {
    // keep the default language when config is unavailable
  }
}

/** Load config language and follow live `lang` events from Settings. */
export async function watchLang(): Promise<() => void> {
  await initLang();
  try {
    const { listen } = await import("@tauri-apps/api/event");
    return listen<string>("lang", (e) => {
      setLang(uiLangFromConfig(e.payload));
    });
  } catch {
    return () => {};
  }
}
