<script lang="ts">
  import { onMount } from "svelte";
  import { goto } from "$app/navigation";
  import { listen } from "@tauri-apps/api/event";
  import { disable, enable } from "@tauri-apps/plugin-autostart";
  import { open } from "@tauri-apps/plugin-dialog";
  import * as api from "$lib/api";
  import logoMark from "$lib/assets/eisen-mark-reversed.svg";
  import Toast from "$lib/components/Toast.svelte";
  import { history } from "$lib/history";
  import { i18n, initLang, setLang, uiLangFromConfig } from "$lib/i18n";
  import {
    ArrowLeft,
    Check,
    Folder,
    Globe,
    Globe2,
    Keyboard,
    Power,
    RotateCcw,
    Settings,
    Volume2,
  } from "@lucide/svelte";

  const t = $derived($i18n);

  let cfg = $state<api.AppConfig | null>(null);
  let appVersion = $state<string>("0.1.1");
  let toast = $state<{
    message: string;
    kind: "ok" | "err";
    sticky: boolean;
  } | null>(null);

  function showToast(message: string, kind: "ok" | "err", sticky = false) {
    toast = { message, kind, sticky };
  }

  const MAC_HOTKEYS: api.HotkeyPreset[] = [
    "DoubleOption",
    "DoubleShift",
    "CmdShift4Mac",
    "CtrlShift4Mac",
    "PrtScMac",
  ];
  const hotkeyOptions = $derived(
    cfg?.hotkey === "PrtScnWin" ? [...MAC_HOTKEYS, "PrtScnWin" as const] : MAC_HOTKEYS,
  );
  const LANGS: api.Lang[] = ["En", "Vi"];

  function onKeydown(e: KeyboardEvent) {
    if (e.key === "Escape") {
      void goto("/");
    }
  }

  onMount(() => {
    void initLang();
    api.getAppVersion().then((v) => { if (v) appVersion = v; }).catch(() => {});
    const un = listen<string[]>("history", (e) => {
      history.set(e.payload);
      void goto("/");
    });
    void load();
    return () => {
      void un.then((fn) => fn());
    };
  });

  async function load() {
    try {
      cfg = await api.getConfig();
      setLang(uiLangFromConfig(cfg.lang));
    } catch (err) {
      showToast(String(err), "err", true);
    }
  }

  async function save(next: api.AppConfig) {
    const prev = cfg;
    cfg = next;
    try {
      await api.setConfig(next);
      showToast(t.settings.saved, "ok");
    } catch (err) {
      cfg = prev; // the binding did not change
      showToast(String(err), "err", true);
    }
  }

  async function onLangChange(e: Event) {
    const value = (e.target as HTMLSelectElement).value as api.Lang;
    if (!cfg || (value !== "En" && value !== "Vi")) return;
    const previous = cfg.lang;
    setLang(uiLangFromConfig(value));
    await save({ ...cfg, lang: value });
    if (cfg?.lang !== value) setLang(uiLangFromConfig(previous));
  }

  async function onHotkeyChange(e: Event) {
    if (!cfg) return;
    const hotkey = (e.target as HTMLSelectElement).value as api.HotkeyPreset;
    await save({ ...cfg, hotkey });
  }

  async function onChooseDir() {
    if (!cfg) return;
    try {
      const dir = await open({ directory: true, multiple: false });
      if (dir && typeof dir === "string") {
        await save({ ...cfg, save_dir: dir });
      }
    } catch (err) {
      showToast(String(err), "err", true);
    }
  }

  async function onLaunchToggle(e: Event) {
    if (!cfg) return;
    const on = (e.target as HTMLInputElement).checked;
    try {
      if (on) await enable();
      else await disable();
      await save({ ...cfg, launch_at_login: on });
    } catch (err) {
      showToast(String(err), "err", true);
      const el = e.target as HTMLInputElement;
      el.checked = !on;
    }
  }

  async function onPlaySoundsToggle(e: Event) {
    if (!cfg) return;
    const on = (e.target as HTMLInputElement).checked;
    await save({ ...cfg, play_sounds: on });
  }

  async function onReset() {
    try {
      await disable();
      cfg = await api.resetConfig();
      setLang(uiLangFromConfig(cfg.lang));
      showToast(t.settings.resetDone, "ok");
    } catch (err) {
      showToast(String(err), "err", true);
    }
  }
</script>

<svelte:window onkeydown={onKeydown} />

<main class="settings-container animate-fade">
  <header class="settings-header">
    <button class="back-btn" onclick={() => void goto("/")}>
      <ArrowLeft size={16} />
      <span>{t.actions.back}</span>
    </button>
    <div class="header-brand">
      <img src={logoMark} alt="EiSen Logo" class="settings-logo" />
      <h1 class="header-title">EiSen — {t.settings.title}</h1>
    </div>
  </header>

  {#if cfg}
    <div class="settings-card animate-slide">
      <!-- Language -->
      <div class="setting-row">
        <div class="row-label">
          <Globe2 size={18} class="row-icon" />
          <div>
            <h3>{t.settings.language}</h3>
            <p>{t.settings.languageHelp}</p>
          </div>
        </div>
        <select class="custom-select" value={cfg.lang} onchange={onLangChange}>
          {#each LANGS as l (l)}
            <option value={l}>{t.langNames[l === "En" ? "en" : "vi"]}</option>
          {/each}
        </select>
      </div>

      <!-- Hotkey -->
      <div class="setting-row">
        <div class="row-label">
          <Keyboard size={18} class="row-icon" />
          <div>
            <h3>{t.settings.hotkey}</h3>
            <p>{t.settings.hotkeyHelp}</p>
          </div>
        </div>
        <select class="custom-select" value={cfg.hotkey} onchange={onHotkeyChange}>
          {#each hotkeyOptions as h (h)}
            <option value={h}>{t.hotkeyNames[h]}</option>
          {/each}
        </select>
      </div>

      <!-- Output Directory -->
      <div class="setting-row">
        <div class="row-label">
          <Folder size={18} class="row-icon" />
          <div>
            <h3>{t.settings.saveDir}</h3>
            <p class="dir-path" title={cfg.save_dir}>{cfg.save_dir}</p>
          </div>
        </div>
        <button class="btn-secondary" onclick={onChooseDir}>
          {t.settings.choose}
        </button>
      </div>

      <!-- Launch at login -->
      <div class="setting-row">
        <div class="row-label">
          <Power size={18} class="row-icon" />
          <div>
            <h3>{t.settings.launchAtLogin}</h3>
            <p>{t.settings.launchHelp}</p>
          </div>
        </div>
        <label class="toggle-switch">
          <input type="checkbox" aria-label={t.settings.launchAtLogin} checked={cfg.launch_at_login} onchange={onLaunchToggle} />
          <span class="slider"></span>
        </label>
      </div>

      <!-- Sound effects -->
      <div class="setting-row">
        <div class="row-label">
          <Volume2 size={18} class="row-icon" />
          <div>
            <h3>{t.settings.playSounds}</h3>
            <p>{t.settings.playSoundsHelp}</p>
          </div>
        </div>
        <label class="toggle-switch">
          <input type="checkbox" aria-label={t.settings.playSounds} checked={cfg.play_sounds} onchange={onPlaySoundsToggle} />
          <span class="slider"></span>
        </label>
      </div>

      <!-- Reset defaults -->
      <div class="setting-row">
        <div class="row-label">
          <RotateCcw size={18} class="row-icon danger" />
          <div>
            <h3>{t.settings.resetTitle}</h3>
            <p>{t.settings.resetHelp}</p>
          </div>
        </div>
        <button class="btn-danger" onclick={onReset}>
          {t.settings.resetDefaults}
        </button>
      </div>

      <!-- Version & System Info -->
      <div class="setting-row no-border">
        <div class="row-label">
          <Settings size={18} class="row-icon" />
          <div>
            <h3>{t.settings.version}</h3>
            <p class="version-sub">EiSen v{appVersion} • macOS Apple Silicon (aarch64)</p>
          </div>
        </div>
        <span class="version-tag">v{appVersion}</span>
      </div>
    </div>
  {:else}
    <p class="loading-state">{t.settings.loading}</p>
  {/if}

  {#if toast}
    <Toast
      message={toast.message}
      kind={toast.kind}
      duration={toast.sticky ? null : undefined}
      onexpire={() => (toast = null)}
    />
  {/if}
</main>

<style>
  :global(html),
  :global(body) {
    margin: 0;
    padding: 0;
    background: #0f1015;
    color: #f8fafc;
    overflow-y: auto;
  }

  .settings-container {
    max-width: 680px;
    margin: 0 auto;
    padding: 36px 24px;
  }

  .settings-header {
    display: flex;
    align-items: center;
    gap: 16px;
    margin-bottom: 24px;
  }

  .header-brand {
    display: flex;
    align-items: center;
    gap: 10px;
  }

  .settings-logo {
    width: 24px;
    height: 24px;
    border-radius: 6px;
    object-fit: contain;
    filter: drop-shadow(0 4px 10px rgba(0, 0, 0, 0.4));
  }

  .back-btn {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    height: 32px;
    padding: 0 12px;
    border-radius: 8px;
    background: rgba(255, 255, 255, 0.06);
    border: 1px solid rgba(255, 255, 255, 0.1);
    color: #cbd5e1;
    font-size: 13px;
    font-weight: 500;
  }

  .back-btn:hover {
    background: rgba(255, 255, 255, 0.12);
    color: #ffffff;
  }

  .header-title {
    font-size: 18px;
    font-weight: 700;
    margin: 0;
  }

  .settings-card {
    border-radius: 16px;
    background: rgba(22, 24, 34, 0.75);
    border: 1px solid rgba(255, 255, 255, 0.08);
    box-shadow: 0 12px 28px rgba(0, 0, 0, 0.3);
    padding: 8px 20px;
  }

  .setting-row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 18px 0;
    border-bottom: 1px solid rgba(255, 255, 255, 0.06);
  }
  .setting-row.no-border {
    border-bottom: none;
  }

  .row-label {
    display: flex;
    align-items: center;
    gap: 14px;
    flex: 1;
    padding-right: 16px;
  }

  :global(.row-icon) {
    color: var(--accent-primary, #6366f1);
    flex-shrink: 0;
  }
  :global(.row-icon.danger) {
    color: #ef4444;
  }

  .row-label h3 {
    margin: 0;
    font-size: 14px;
    font-weight: 600;
  }

  .row-label p {
    margin: 3px 0 0;
    font-size: 12px;
    color: #94a3b8;
  }

  .dir-path {
    font-family: var(--font-mono, monospace);
    font-size: 11px !important;
    word-break: break-all;
  }

  .custom-select {
    font-family: var(--font-sans), system-ui, sans-serif;
    font-size: 13px;
    padding: 8px 12px;
    border-radius: 8px;
    background: rgba(15, 16, 21, 0.9);
    border: 1px solid rgba(255, 255, 255, 0.12);
    color: #f8fafc;
    outline: none;
    cursor: pointer;
  }

  .btn-secondary {
    display: inline-flex;
    align-items: center;
    height: 34px;
    padding: 0 14px;
    border-radius: 8px;
    background: rgba(255, 255, 255, 0.08);
    border: 1px solid rgba(255, 255, 255, 0.12);
    color: #f8fafc;
    font-size: 13px;
    font-weight: 500;
  }

  .btn-secondary:hover {
    background: rgba(255, 255, 255, 0.15);
  }

  .btn-danger {
    display: inline-flex;
    align-items: center;
    height: 34px;
    padding: 0 14px;
    border-radius: 8px;
    background: rgba(239, 68, 68, 0.15);
    border: 1px solid rgba(239, 68, 68, 0.3);
    color: #fca5a5;
    font-size: 13px;
    font-weight: 500;
  }

  .btn-danger:hover {
    background: rgba(239, 68, 68, 0.25);
  }

  /* Toggle Switch */
  .toggle-switch {
    position: relative;
    display: inline-block;
    width: 44px;
    height: 24px;
  }

  .toggle-switch input {
    opacity: 0;
    width: 0;
    height: 0;
  }

  .slider {
    position: absolute;
    cursor: pointer;
    inset: 0;
    background-color: rgba(255, 255, 255, 0.15);
    transition: 0.2s;
    border-radius: 24px;
  }

  .slider:before {
    position: absolute;
    content: "";
    height: 18px;
    width: 18px;
    left: 3px;
    bottom: 3px;
    background-color: white;
    transition: 0.2s;
    border-radius: 50%;
  }

  input:checked + .slider {
    background: var(--accent-primary, #6366f1);
  }

  input:checked + .slider:before {
    transform: translateX(20px);
  }

  .version-tag {
    font-size: 11px;
    font-weight: 600;
    font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
    padding: 3px 8px;
    border-radius: 6px;
    background: rgba(99, 102, 241, 0.15);
    color: #a5b4fc;
    border: 1px solid rgba(99, 102, 241, 0.3);
  }

  .version-sub {
    font-size: 12px;
    color: #94a3b8;
    margin: 2px 0 0;
  }
</style>
