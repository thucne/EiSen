<script lang="ts">
  import { onMount } from "svelte";
  import { invoke, convertFileSrc } from "@tauri-apps/api/core";
  import { listen, type UnlistenFn } from "@tauri-apps/api/event";
  import { getCurrentWindow } from "@tauri-apps/api/window";
  import { Copy, Download, Edit3, ScanText, X } from "@lucide/svelte";
  import Toast from "$lib/components/Toast.svelte";
  import { i18n, initLang } from "$lib/i18n";
  import type { SaveResult } from "$lib/api";

  import {
    computeToolbarPosition,
    oppositeCorner,
    selectionRect,
    shiftRect,
    type Corner,
    type Point,
    type Rect,
  } from "$lib/overlay/geometry";

  /** Minimum confirmable selection. Below this, the drag is treated as a
   *  stray click: the selection resets but the capture session survives. */
  const MIN_SELECTION_PX = 10;

  type Interaction = "idle" | "drawing" | "moving" | "resizing";

  let imageSrc = $state<string | null>(null);
  let interaction = $state<Interaction>("idle");
  let resizeAnchor = $state<Point | null>(null);
  let selectionConfirmed = $state(false);
  let start = $state<Point>({ x: 0, y: 0 });
  let current = $state<Point>({ x: 0, y: 0 });
  let lastPointer = $state<Point>({ x: 0, y: 0 });
  let shiftDown = $state(false);
  let spaceDown = $state(false);

  const aspectLock = $derived(
    shiftDown && (interaction === "drawing" || interaction === "resizing"),
  );

  const activeRect = $derived.by(() => {
    if (interaction === "idle" && !selectionConfirmed) return null;
    return selectionRect(start, current, aspectLock);
  });

  const sizeLabel = $derived.by(() => {
    if (!activeRect) return "";
    return `${Math.round(activeRect.width)} × ${Math.round(activeRect.height)} px`;
  });

  let t = $derived($i18n);
  let toast = $state<{ message: string; kind: "ok" | "err" } | null>(null);
  let captureReadyAt = 0;
  let loggedFirstPointer = false;

  function logOverlayTiming(stage: string, extra = "") {
    if (!import.meta.env.DEV) return;
    console.log(`[eisen:timing] ${stage}${extra}`);
  }

  function showToast(message: string, kind: "ok" | "err") {
    toast = { message, kind };
  }

  const tooltipPos = $derived.by(() => {
    if (!activeRect) return { x: 0, y: 0 };
    return {
      x: Math.max(10, activeRect.left),
      y: Math.max(10, activeRect.top - 28),
    };
  });

  let toolbarEl = $state<HTMLElement | null>(null);
  let toolbarWidth = $state(320);

  const toolbarPos = $derived.by(() => {
    if (!activeRect) return { x: 0, y: 0, inside: false };
    const viewport = {
      width: typeof window !== "undefined" ? window.innerWidth : 1920,
      height: typeof window !== "undefined" ? window.innerHeight : 1080,
    };
    return computeToolbarPosition(activeRect, viewport, toolbarWidth);
  });

  async function hideOverlay() {
    imageSrc = null;
    selectionConfirmed = false;
    interaction = "idle";
    resizeAnchor = null;
    start = { x: 0, y: 0 };
    current = { x: 0, y: 0 };
    try {
      const w = getCurrentWindow();
      await w.hide();
    } catch (err) {
      console.error("hide failed:", err);
    }
  }

  /** Toast dwell before hiding, so the message is actually seen. Matches the
   *  Toast component's default 2200ms auto-dismiss minus a short tail. */
  const TOAST_DWELL_MS = 1200;

  function hideAfterToast() {
    setTimeout(() => void hideOverlay(), TOAST_DWELL_MS);
  }

  function basename(path: string): string {
    return path.split(/[\\/]/).pop() ?? path;
  }

  async function commit(rect: Rect, target: "editor" | "copy" | "save" | "ocr") {
    try {
      const openEditor = target === "editor";
      await invoke("cmd_commit_region", {
        rect,
        // Tauri matches command args by camelCase: Rust's `open_editor` reads
        // this key. A snake_case key here is silently dropped.
        openEditor: openEditor,
      });
      if (target === "copy") {
        await invoke("cmd_copy");
        showToast(t.toasts.copied, "ok");
        hideAfterToast();
      } else if (target === "save") {
        const r = await invoke<SaveResult>("cmd_save");
        showToast(`${t.toasts.saved}: ${basename(r.path)}`, "ok");
        hideAfterToast();
      } else if (target === "ocr") {
        const text = await invoke<string>("cmd_extract_text");
        if (text) {
          await navigator.clipboard.writeText(text);
          showToast(t.ocr.copied, "ok");
        } else {
          showToast(t.ocr.noText, "err");
        }
        hideAfterToast();
      } else {
        selectionConfirmed = false;
        interaction = "idle";
      }
    } catch (err) {
      showToast(`${t.overlay.actionFailed}: ${err}`, "err");
      hideAfterToast();
    }
  }

  async function cancelCapture() {
    try {
      await invoke("cmd_cancel_capture");
    } catch (err) {
      console.error("cmd_cancel_capture failed:", err);
    }
    await hideOverlay();
  }

  function viewport() {
    return {
      width: typeof window !== "undefined" ? window.innerWidth : 1920,
      height: typeof window !== "undefined" ? window.innerHeight : 1080,
    };
  }

  function panBy(dx: number, dy: number) {
    const r = selectionRect(start, current, false);
    const next = shiftRect(r, dx, dy, viewport());
    start = { x: next.left, y: next.top };
    current = { x: next.left + next.width, y: next.top + next.height };
  }

  function beginResize(e: PointerEvent, corner: Corner) {
    if (e.button !== 0 || !activeRect) return;
    e.stopPropagation();
    e.preventDefault();
    resizeAnchor = oppositeCorner(activeRect, corner);
    start = resizeAnchor;
    current = { x: e.clientX, y: e.clientY };
    interaction = "resizing";
    selectionConfirmed = true;
    lastPointer = { x: e.clientX, y: e.clientY };
  }

  function beginMove(e: PointerEvent) {
    if (e.button !== 0 || !selectionConfirmed) return;
    e.stopPropagation();
    e.preventDefault();
    interaction = "moving";
    lastPointer = { x: e.clientX, y: e.clientY };
  }

  function onPointerDown(e: PointerEvent) {
    if (!loggedFirstPointer && captureReadyAt > 0) {
      loggedFirstPointer = true;
      logOverlayTiming(
        "first pointerdown",
        ` ${Math.round(performance.now() - captureReadyAt)}ms after capture-ready`,
      );
    }
    if (e.button !== 0) {
      void cancelCapture();
      return;
    }
    if ((e.target as HTMLElement).closest(".floating-toolbar")) return;

    interaction = "drawing";
    selectionConfirmed = false;
    start = { x: e.clientX, y: e.clientY };
    current = { x: e.clientX, y: e.clientY };
    lastPointer = { x: e.clientX, y: e.clientY };
    shiftDown = e.shiftKey;
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
  }

  function onPointerMove(e: PointerEvent) {
    if (interaction === "idle") return;
    shiftDown = e.shiftKey;
    const dx = e.clientX - lastPointer.x;
    const dy = e.clientY - lastPointer.y;
    if (interaction === "moving" || spaceDown) {
      panBy(dx, dy);
    } else {
      current = { x: e.clientX, y: e.clientY };
    }
    lastPointer = { x: e.clientX, y: e.clientY };
  }

  function onPointerUp() {
    if (interaction === "idle") return;
    const wasDrawing = interaction === "drawing";
    const wasResizing = interaction === "resizing";
    if (wasDrawing || wasResizing) {
      const rect = selectionRect(start, current, aspectLock);
      start = { x: rect.left, y: rect.top };
      current = { x: rect.left + rect.width, y: rect.top + rect.height };
    }
    interaction = "idle";
    spaceDown = false;
    if (!wasDrawing) return;
    const rect = selectionRect(start, current, false);
    if (rect.width >= MIN_SELECTION_PX && rect.height >= MIN_SELECTION_PX) {
      selectionConfirmed = true;
    } else {
      selectionConfirmed = false;
      start = { x: 0, y: 0 };
      current = { x: 0, y: 0 };
    }
  }

  function onKeyDown(e: KeyboardEvent) {
    if (e.key === "Escape") {
      e.preventDefault();
      void cancelCapture();
      return;
    }
    if (e.key === " " && interaction === "drawing") {
      e.preventDefault();
      spaceDown = true;
      return;
    }
    if (selectionConfirmed && e.key.startsWith("Arrow")) {
      const step = e.shiftKey ? 10 : 1;
      const d =
        e.key === "ArrowLeft" ? { x: -step, y: 0 } :
        e.key === "ArrowRight" ? { x: step, y: 0 } :
        e.key === "ArrowUp" ? { x: 0, y: -step } :
        e.key === "ArrowDown" ? { x: 0, y: step } : null;
      if (d) {
        e.preventDefault();
        panBy(d.x, d.y);
        return;
      }
    }
    if (e.key === "Shift") {
      shiftDown = true;
    }
    if (activeRect && (selectionConfirmed || activeRect.width >= 10)) {
      const key = e.key.toLowerCase();
      if (key === "enter" || key === "c") {
        e.preventDefault();
        void commit(activeRect, "copy");
      } else if (key === "s") {
        e.preventDefault();
        void commit(activeRect, "save");
      } else if (key === "e") {
        e.preventDefault();
        void commit(activeRect, "editor");
      } else if (key === "o") {
        e.preventDefault();
        void commit(activeRect, "ocr");
      }
    }
  }

  function onKeyUp(e: KeyboardEvent) {
    if (e.key === "Shift") shiftDown = false;
    if (e.key === " ") spaceDown = false;
  }

  onMount(() => {
    let disposed = false;
    let unlisten: UnlistenFn | null = null;
    let unlistenFull: UnlistenFn | null = null;

    void initLang();

    void listen<string>("capture-ready", (event) => {
      captureReadyAt = performance.now();
      loggedFirstPointer = false;
      logOverlayTiming("capture-ready listener");
      imageSrc = convertFileSrc(event.payload);
      interaction = "idle";
      resizeAnchor = null;
      selectionConfirmed = false;
      start = { x: 0, y: 0 };
      current = { x: 0, y: 0 };
      toast = null;
    }).then((un) => {
      if (disposed) un();
      else unlisten = un;
    });

    // Fullscreen capture (Ctrl+Shift+3): auto-select the entire viewport and
    // show the toolbar immediately — no manual drag needed.
    void listen<null>("fullscreen-ready", () => {
      start = { x: 0, y: 0 };
      current = { x: window.innerWidth, y: window.innerHeight };
      interaction = "idle";
      selectionConfirmed = true;
    }).then((un) => {
      if (disposed) un();
      else unlistenFull = un;
    });

    return () => {
      disposed = true;
      unlisten?.();
      unlistenFull?.();
    };
  });
</script>

<svelte:window onkeydowncapture={onKeyDown} onkeyup={onKeyUp} />

<!-- svelte-ignore a11y_no_static_element_interactions -->
<div
  class="overlay-viewport"
  onpointerdown={onPointerDown}
  onpointermove={onPointerMove}
  onpointerup={onPointerUp}
  oncontextmenu={(e) => {
    e.preventDefault();
    void cancelCapture();
  }}
>
  <!-- Single Full Screen Captured Image -->
  {#if imageSrc}
    <img
      class="full-screen-img"
      src={imageSrc}
      alt=""
      draggable="false"
      onload={() => {
        if (captureReadyAt > 0) {
          logOverlayTiming(
            "backdrop img onload",
            ` ${Math.round(performance.now() - captureReadyAt)}ms after capture-ready`,
          );
        }
      }}
    />
  {/if}

  <!-- Capture Mode Hint Banner -->
  {#if !activeRect}
    <div class="capture-hint animate-fade">
      <span>{t.overlay.hint}</span>
    </div>
  {/if}

  <!-- Dimming mask overlay around selection cutout -->
  {#if activeRect}
    <!-- Top Dimmer -->
    <div class="dimmer-box" style="top:0;left:0;width:100vw;height:{activeRect.top}px"></div>
    <!-- Bottom Dimmer -->
    <div class="dimmer-box" style="top:{activeRect.top + activeRect.height}px;left:0;width:100vw;bottom:0"></div>
    <!-- Left Dimmer -->
    <div class="dimmer-box" style="top:{activeRect.top}px;left:0;width:{activeRect.left}px;height:{activeRect.height}px"></div>
    <!-- Right Dimmer -->
    <div class="dimmer-box" style="top:{activeRect.top}px;left:{activeRect.left + activeRect.width}px;right:0;height:{activeRect.height}px"></div>

    <!-- Clear Crop Selection Frame & Handles -->
    <!-- svelte-ignore a11y_no_static_element_interactions -->
    <div
      class="crop-frame"
      style="left:{activeRect.left}px;top:{activeRect.top}px;width:{activeRect.width}px;height:{activeRect.height}px"
      onpointerdown={beginMove}
      ondblclick={() => commit(activeRect, "copy")}
    >
      <div class="handle nw" onpointerdown={(e) => beginResize(e, "nw")}></div>
      <div class="handle ne" onpointerdown={(e) => beginResize(e, "ne")}></div>
      <div class="handle sw" onpointerdown={(e) => beginResize(e, "sw")}></div>
      <div class="handle se" onpointerdown={(e) => beginResize(e, "se")}></div>
    </div>

    <!-- Dimension Tooltip Badge -->
    <div
      class="size-badge"
      style="left:{tooltipPos.x}px;top:{tooltipPos.y}px"
    >
      {sizeLabel}
    </div>

    <!-- Attached Floating Action Toolbar -->
    {#if selectionConfirmed || activeRect.width > 20}
      <!-- svelte-ignore a11y_no_static_element_interactions -->
      <div
        bind:this={toolbarEl}
        class="floating-toolbar animate-slide"
        class:toolbar-inside={toolbarPos.inside}
        style="left:{toolbarPos.x}px;top:{toolbarPos.y}px"
        onpointerdown={(e) => e.stopPropagation()}
      >
        <button
          type="button"
          class="action-btn danger"
          data-tip={`${t.actions.cancel} (Esc)`}
          aria-label={`${t.actions.cancel} (Esc)`}
          onclick={cancelCapture}
        >
          <X size={15} />
        </button>

        <div class="divider"></div>

        <button
          type="button"
          class="action-btn"
          data-tip={`${t.actions.extractText} (O)`}
          aria-label={`${t.actions.extractText} (O)`}
          onclick={() => commit(activeRect, "ocr")}
        >
          <ScanText size={15} />
        </button>

        <button
          type="button"
          class="action-btn"
          data-tip={`${t.actions.saveFile} (S)`}
          aria-label={`${t.actions.saveFile} (S)`}
          onclick={() => commit(activeRect, "save")}
        >
          <Download size={15} />
        </button>

        <button
          type="button"
          class="action-btn"
          data-tip={t.overlay.openEditor}
          aria-label={t.overlay.openEditor}
          onclick={() => commit(activeRect, "editor")}
        >
          <Edit3 size={15} />
          <span>{t.actions.edit}</span>
        </button>

        <button
          type="button"
          class="action-btn primary"
          data-tip={`${t.overlay.copyToClipboard} (Enter / DblClick)`}
          aria-label={`${t.overlay.copyToClipboard} (Enter / DblClick)`}
          onclick={() => commit(activeRect, "copy")}
        >
          <Copy size={15} />
          <span>{t.actions.copy}</span>
        </button>
      </div>
    {/if}
  {/if}

  {#if toast}
    <Toast message={toast.message} kind={toast.kind} onexpire={() => (toast = null)} />
  {/if}
</div>

<style>
  :global(html),
  :global(body) {
    margin: 0;
    padding: 0;
    width: 100vw;
    height: 100vh;
    overflow: hidden;
    background: transparent;
    user-select: none;
    -webkit-user-select: none;
  }

  .overlay-viewport {
    position: relative;
    width: 100vw;
    height: 100vh;
    cursor: crosshair;
    overflow: visible;
  }

  .capture-hint {
    position: absolute;
    top: 28px;
    left: 50%;
    transform: translateX(-50%);
    padding: 8px 18px;
    border-radius: 20px;
    background: rgba(15, 16, 21, 0.88);
    backdrop-filter: blur(12px);
    border: 1px solid rgba(255, 255, 255, 0.15);
    box-shadow: 0 8px 24px rgba(0, 0, 0, 0.4);
    color: #f8fafc;
    font-size: 13px;
    font-weight: 500;
    pointer-events: none;
    z-index: 100;
  }

  .full-screen-img {
    position: absolute;
    top: 0;
    left: 0;
    width: 100vw;
    height: 100vh;
    object-fit: fill;
    pointer-events: none;
  }

  .dimmer-box {
    position: absolute;
    background: rgba(0, 0, 0, 0.48);
    pointer-events: none;
  }

  .crop-frame {
    position: absolute;
    outline: 2px solid var(--accent-primary, #6366f1);
    outline-offset: -1px;
    cursor: move;
  }

  .handle {
    position: absolute;
    width: 10px;
    height: 10px;
    background: #ffffff;
    border: 1.5px solid var(--accent-primary, #6366f1);
    border-radius: 2px;
    pointer-events: auto;
  }
  .handle::before {
    content: "";
    position: absolute;
    inset: -6px;
  }
  .handle.nw { top: -5px; left: -5px; cursor: nwse-resize; }
  .handle.ne { top: -5px; right: -5px; cursor: nesw-resize; }
  .handle.sw { bottom: -5px; left: -5px; cursor: nesw-resize; }
  .handle.se { bottom: -5px; right: -5px; cursor: nwse-resize; }

  .size-badge {
    position: absolute;
    background: rgba(15, 16, 21, 0.92);
    color: #f8fafc;
    font-family: var(--font-mono, monospace);
    font-size: 11px;
    font-weight: 500;
    padding: 3px 8px;
    border-radius: 6px;
    border: 1px solid rgba(255, 255, 255, 0.12);
    box-shadow: 0 4px 12px rgba(0, 0, 0, 0.4);
    pointer-events: none;
    white-space: nowrap;
    z-index: 10;
  }

  .floating-toolbar {
    position: absolute;
    display: flex;
    align-items: center;
    gap: 4px;
    padding: 4px 6px;
    background: rgba(18, 20, 29, 0.92);
    backdrop-filter: blur(16px);
    -webkit-backdrop-filter: blur(16px);
    border: 1px solid rgba(255, 255, 255, 0.15);
    border-radius: 12px;
    box-shadow: 0 12px 32px rgba(0, 0, 0, 0.6);
    z-index: 20;
    cursor: default;
    overflow: visible;
    animation: toolbar-slide-in 0.15s ease-out both;
  }

  /* When the toolbar is rendered *inside* the crop area, give it a stronger
     border so it visually separates from the screenshot underneath */
  .floating-toolbar.toolbar-inside {
    border-color: rgba(99, 102, 241, 0.45);
    box-shadow: 0 12px 32px rgba(0, 0, 0, 0.8), 0 0 0 1px rgba(99, 102, 241, 0.25);
  }

  @keyframes toolbar-slide-in {
    from { opacity: 0; transform: translateY(6px) scale(0.97); }
    to   { opacity: 1; transform: translateY(0)  scale(1);    }
  }

  .divider {
    width: 1px;
    height: 16px;
    background: rgba(255, 255, 255, 0.15);
    margin: 0 8px 0 4px;
  }

  .action-btn {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: 6px;
    height: 28px;
    padding: 0 10px;
    border-radius: 8px;
    background: transparent;
    color: #cbd5e1;
    font-size: 12px;
    font-weight: 600;
    cursor: pointer;
    border: none;
  }

  .action-btn:hover {
    background: rgba(255, 255, 255, 0.1);
    color: #ffffff;
  }

  .action-btn.primary {
    background: var(--accent-gradient, linear-gradient(135deg, #6366f1 0%, #a855f7 100%));
    color: #ffffff;
    box-shadow: 0 4px 12px rgba(99, 102, 241, 0.35);
  }

  .action-btn.primary:hover {
    filter: brightness(1.1);
  }

  .action-btn.danger:hover {
    background: rgba(239, 68, 68, 0.2);
    color: #f87171;
  }
</style>
