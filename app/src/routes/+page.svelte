<script lang="ts">
  import { onMount } from "svelte";
  import { goto } from "$app/navigation";
  import { convertFileSrc, invoke } from "@tauri-apps/api/core";
  import { listen } from "@tauri-apps/api/event";
  import * as api from "$lib/api";
  import logoMark from "$lib/assets/eisen-mark-reversed.svg";
  import { history } from "$lib/history";
  import { i18n, initLang } from "$lib/i18n";
  import Toast from "$lib/components/Toast.svelte";
  import {
    Camera,
    Copy,
    Edit3,
    History,
    ImageOff,
    Keyboard,
    Settings,
    Trash2,
  } from "@lucide/svelte";

  const t = $derived($i18n);

  let status = $state<string | null>(null);
  let cfg = $state<api.AppConfig | null>(null);
  let thumbs = $state<Record<string, string>>({});
  let toast = $state<{
    message: string;
    kind: "ok" | "err";
    sticky?: boolean;
  } | null>(null);
  let permissionOk = $state(true);
  let appVersion = $state<string>("0.1.1");

  function probePermission() {
    api.screenPermission()
      .then((ok) => {
        if (typeof ok === "boolean") permissionOk = ok;
      })
      .catch(() => {});
  }

  onMount(() => {
    void initLang();
    api.getConfig().then((c) => (cfg = c)).catch(() => {});
    api.getAppVersion().then((v) => { if (v) appVersion = v; }).catch(() => {});
    probePermission();
    const showHotkeyError = (detail: string) => {
      toast = {
        message: `${t.settings.hotkeyUnavailable}: ${detail}`,
        kind: "err",
        sticky: true,
      };
    };
    void invoke<string | null>("cmd_hotkey_error").then((msg) => {
      if (msg) showHotkeyError(msg);
    });
    const unHotkey = listen<string>("hotkey-error", (e) => {
      showHotkeyError(e.payload);
    });
    const unH = listen<string[]>("history", (e) => {
      history.set(e.payload);
      // Fire-and-forget: any failed fetch just leaves the card on the styled
      // placeholder below. Policy: the renderer only ever displays
      // server-managed temp/appcache artifacts — the original save_dir
      // path sits OUTSIDE the asset scope and must never be used as a URL.
      Promise.all(
        e.payload.map((p) =>
          api
            .getThumbnail(p)
            .then((t) => {
              thumbs[p] = t;
            })
            .catch(() => {}),
        ),
      );
    });
    const unS = listen("settings", () => {
      void goto("/settings");
    });
    return () => {
      void unH.then((fn) => fn());
      void unS.then((fn) => fn());
      void unHotkey.then((fn) => fn());
    };
  });

  function reopen(path: string) {
    status = null;
    api.openInEditor(path).catch((err) => {
      status = `${t.settings.reopenFailed}: ${String(err)}`;
    });
  }

  function showToast(message: string, kind: "ok" | "err") {
    toast = { message, kind };
  }

  async function copyCard(path: string) {
    try {
      await api.copyPath(path);
      showToast(t.toasts.copied, "ok");
    } catch (err) {
      showToast(String(err), "err");
    }
  }

  // Gallery-only removal: the PNG stays on disk. Optimistic update with
  // rollback so the card never lags behind the user's click.
  function removeCard(path: string) {
    status = null;
    const prev = $history;
    history.update((list) => list.filter((p) => p !== path));
    api.removeHistory(path).catch((err) => {
      history.set(prev);
      status = `${t.settings.removeFailed}: ${String(err)}`;
    });
  }

  function captureNow() {
    invoke("cmd_begin_capture").catch((err) => {
      status = String(err);
    });
  }

  function basename(path: string): string {
    return path.split(/[\\/]/).pop() ?? path;
  }
</script>

<svelte:window onfocus={probePermission} />

<main class="hub-container animate-fade">
  {#if !permissionOk}
    <div class="permission-banner" role="alert">
      <h2 class="permission-title">{t.permission.title}</h2>
      <p class="permission-body">{t.permission.body}</p>
      <button class="btn-primary" type="button" onclick={() => void api.openScreenSettings()}>
        {t.permission.cta}
      </button>
      <p class="permission-after">{t.permission.afterGrant}</p>
    </div>
  {/if}
  <!-- Top Navigation Bar -->
  <header class="hub-header">
    <div class="brand">
      <img src={logoMark} alt="EiSen Logo" class="hub-logo" />
      <div>
        <div class="brand-title-row">
          <h1 class="brand-title">EiSen</h1>
          {#if appVersion}
            <span class="version-badge">v{appVersion}</span>
          {/if}
        </div>
        <p class="brand-sub">{t.hub.tagline}</p>
      </div>
    </div>

    <div class="header-actions">
      <button class="btn-primary" onclick={captureNow}>
        <Camera size={16} />
        <span>{t.settings.captureNow}</span>
      </button>
      <button class="btn-secondary" onclick={() => void goto("/settings")}>
        <Settings size={16} />
        <span>{t.settings.openSettings}</span>
      </button>
    </div>
  </header>

  <!-- Quick Shortcut Banner -->
  <section class="shortcut-banner animate-slide">
    <div class="banner-content">
      <Keyboard size={24} class="banner-icon" />
      <div>
        <h3>{t.hub.instantTitle}</h3>
        <p>{t.hub.instantBody}</p>
      </div>
    </div>
    <div class="shortcut-badge">
      {#if cfg}
        <span>{t.hotkeyNames[cfg.hotkey]}</span>
      {:else}
        <span>{t.hub.shortcutFallback}</span>
      {/if}
    </div>
  </section>

  <!-- History Gallery Section -->
  <section class="history-section">
    <div class="section-header">
      <div class="section-title">
        <History size={18} />
        <h2>{t.settings.historyTitle}</h2>
      </div>
      <span class="count-badge">{t.hub.itemCount.replace("{n}", String($history.length))}</span>
    </div>

    {#if $history.length > 0}
      <div class="history-grid">
        {#each $history as path (path)}
          <div class="history-card animate-slide">
            <button type="button" class="thumb-wrap" onclick={() => reopen(path)}>
              {#if thumbs[path]}
                <img src={convertFileSrc(thumbs[path])} alt="" />
              {:else}
                <div class="thumb-placeholder"><ImageOff size={28} /></div>
              {/if}
              <div class="overlay-hover">
                <Edit3 size={24} />
              </div>
            </button>
            <div class="card-info">
              <span class="filename" title={path}>{basename(path)}</span>
              <div class="card-actions">
                <button class="icon-btn" data-tip={t.hub.reopen} aria-label={t.hub.reopen} onclick={() => reopen(path)}>
                  <Edit3 size={14} />
                </button>
                <button class="icon-btn" data-tip={t.hub.copyToClipboard} aria-label={t.hub.copyToClipboard} onclick={() => copyCard(path)}>
                  <Copy size={14} />
                </button>
                <button
                  class="icon-btn"
                  data-tip={t.hub.removeFromGallery}
                  aria-label={t.hub.removeFromGallery}
                  onclick={() => removeCard(path)}
                >
                  <Trash2 size={14} />
                </button>
              </div>
            </div>
          </div>
        {/each}
      </div>
    {:else}
      <div class="empty-state">
        <Camera size={48} class="empty-icon" />
        <p class="empty-title">{t.settings.emptyHistory}</p>
        <p class="empty-desc">{t.hub.emptyDesc}</p>
      </div>
    {/if}

    {#if status}
      <div class="status-alert">{status}</div>
    {/if}
  </section>

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

  .hub-container {
    max-width: 860px;
    margin: 0 auto;
    padding: 40px 24px;
  }

  .permission-banner {
    margin-bottom: 20px;
    padding: 16px 18px;
    border-radius: var(--radius-md);
    border: 1px solid var(--warning);
    background: var(--bg-card);
    color: var(--text-main);
  }

  .permission-title {
    margin: 0;
    font-size: 15px;
    font-weight: 700;
  }

  .permission-body,
  .permission-after {
    margin: 8px 0 0;
    font-size: 13px;
    color: var(--text-muted);
  }

  .permission-banner .btn-primary {
    margin-top: 12px;
  }

  .hub-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding-bottom: 24px;
    border-bottom: 1px solid rgba(255, 255, 255, 0.08);
  }

  .brand {
    display: flex;
    align-items: center;
    gap: 14px;
  }

  .hub-logo {
    width: 44px;
    height: 44px;
    border-radius: 10px;
    object-fit: contain;
    filter: drop-shadow(0 8px 18px rgba(0, 0, 0, 0.5));
  }

  .brand-title-row {
    display: flex;
    align-items: center;
    gap: 8px;
  }

  .brand-title {
    font-size: 22px;
    font-weight: 700;
    margin: 0;
    letter-spacing: -0.02em;
  }

  .version-badge {
    font-size: 11px;
    font-weight: 600;
    font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
    padding: 2px 7px;
    border-radius: 6px;
    background: rgba(99, 102, 241, 0.15);
    color: #a5b4fc;
    border: 1px solid rgba(99, 102, 241, 0.3);
    line-height: 1.2;
    letter-spacing: 0.02em;
  }

  .brand-sub {
    font-size: 13px;
    color: #94a3b8;
    margin: 2px 0 0;
  }

  .header-actions {
    display: flex;
    align-items: center;
    gap: 10px;
  }

  .btn-primary {
    display: inline-flex;
    align-items: center;
    gap: 8px;
    height: 38px;
    padding: 0 16px;
    border-radius: 10px;
    background: var(--accent-gradient, linear-gradient(135deg, #6366f1, #a855f7));
    color: #ffffff;
    font-size: 13px;
    font-weight: 600;
    box-shadow: 0 4px 14px rgba(99, 102, 241, 0.35);
  }

  .btn-primary:hover {
    filter: brightness(1.1);
  }

  .btn-secondary {
    display: inline-flex;
    align-items: center;
    gap: 8px;
    height: 38px;
    padding: 0 16px;
    border-radius: 10px;
    background: rgba(255, 255, 255, 0.06);
    border: 1px solid rgba(255, 255, 255, 0.1);
    color: #f8fafc;
    font-size: 13px;
    font-weight: 600;
  }

  .btn-secondary:hover {
    background: rgba(255, 255, 255, 0.12);
  }

  .shortcut-banner {
    margin-top: 28px;
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 20px 24px;
    border-radius: 16px;
    background: rgba(22, 24, 34, 0.75);
    border: 1px solid rgba(255, 255, 255, 0.08);
    box-shadow: 0 12px 28px rgba(0, 0, 0, 0.3);
  }

  .banner-content {
    display: flex;
    align-items: center;
    gap: 16px;
  }

  :global(.banner-icon) {
    color: var(--accent-primary, #6366f1);
  }

  .shortcut-banner h3 {
    margin: 0;
    font-size: 15px;
    font-weight: 600;
  }

  .shortcut-banner p {
    margin: 4px 0 0;
    font-size: 13px;
    color: #94a3b8;
  }

  .shortcut-badge {
    padding: 8px 16px;
    border-radius: 10px;
    background: rgba(99, 102, 241, 0.12);
    border: 1px solid rgba(99, 102, 241, 0.3);
    color: #818cf8;
    font-family: var(--font-mono, monospace);
    font-size: 13px;
    font-weight: 600;
  }

  .history-section {
    margin-top: 36px;
  }

  .section-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    margin-bottom: 18px;
  }

  .section-title {
    display: flex;
    align-items: center;
    gap: 8px;
    color: #f8fafc;
  }

  .section-title h2 {
    font-size: 16px;
    font-weight: 600;
    margin: 0;
  }

  .count-badge {
    font-size: 12px;
    color: #64748b;
    background: rgba(255, 255, 255, 0.05);
    padding: 3px 10px;
    border-radius: 999px;
  }

  .history-grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(220px, 1fr));
    gap: 16px;
  }

  .history-card {
    border-radius: 12px;
    background: rgba(22, 24, 34, 0.75);
    border: 1px solid rgba(255, 255, 255, 0.08);
    overflow: hidden;
    transition: all 0.2s ease;
  }

  .history-card:hover {
    border-color: rgba(255, 255, 255, 0.2);
    transform: translateY(-2px);
    box-shadow: 0 8px 24px rgba(0, 0, 0, 0.4);
  }

  .thumb-wrap {
    position: relative;
    width: 100%;
    height: 130px;
    background: #000;
    cursor: pointer;
    overflow: hidden;
    border: none;
    padding: 0;
    display: block;
  }

  .thumb-wrap img {
    width: 100%;
    height: 100%;
    object-fit: cover;
  }

  .thumb-placeholder {
    width: 100%;
    height: 100%;
    display: flex;
    align-items: center;
    justify-content: center;
    color: #64748b;
    background: linear-gradient(135deg, rgba(99, 102, 241, 0.08), rgba(168, 85, 247, 0.12));
  }

  .overlay-hover {
    position: absolute;
    inset: 0;
    background: rgba(99, 102, 241, 0.4);
    backdrop-filter: blur(4px);
    display: flex;
    align-items: center;
    justify-content: center;
    color: #ffffff;
    opacity: 0;
    transition: opacity 0.18s ease;
  }

  .thumb-wrap:hover .overlay-hover {
    opacity: 1;
  }

  .card-info {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 10px 12px;
    background: rgba(18, 20, 29, 0.9);
  }

  .filename {
    flex: 1 1 auto;
    min-width: 0;
    margin-right: 8px;
    font-size: 12px;
    font-weight: 500;
    color: #cbd5e1;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .card-actions {
    display: inline-flex;
    align-items: center;
    gap: 2px;
    flex-shrink: 0;
  }

  .icon-btn {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 26px;
    height: 26px;
    border-radius: 6px;
    background: transparent;
    color: #94a3b8;
  }

  .icon-btn:hover {
    background: rgba(255, 255, 255, 0.1);
    color: #ffffff;
  }

  .empty-state {
    text-align: center;
    padding: 60px 20px;
    background: rgba(22, 24, 34, 0.4);
    border: 1px dashed rgba(255, 255, 255, 0.1);
    border-radius: 16px;
  }

  :global(.empty-icon) {
    color: #475569;
    margin-bottom: 12px;
  }

  .empty-title {
    font-size: 15px;
    font-weight: 600;
    color: #cbd5e1;
    margin: 0;
  }

  .empty-desc {
    font-size: 13px;
    color: #64748b;
    margin: 4px 0 0;
  }

  .status-alert {
    margin-top: 16px;
    padding: 10px 14px;
    border-radius: 8px;
    background: rgba(239, 68, 68, 0.15);
    border: 1px solid rgba(239, 68, 68, 0.3);
    color: #fca5a5;
    font-size: 13px;
  }
</style>
