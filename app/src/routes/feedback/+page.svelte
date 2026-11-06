<script lang="ts">
  import { onMount } from "svelte";
  import { convertFileSrc } from "@tauri-apps/api/core";
  import { listen } from "@tauri-apps/api/event";
  import { FolderOpen, X } from "@lucide/svelte";
  import { hideFeedback, openInEditor, revealPath, startPreviewDrag } from "$lib/api";
  import { i18n, initLang } from "$lib/i18n";

  /** A save stays longer so there is time to reach "Show in folder". */
  const DISMISS_MS = 2200;
  const DISMISS_WITH_PATH_MS = 5000;
  const DEFAULT_DISMISS_THUMBNAIL_MS = 1500;
  const DRAG_THRESHOLD_PX = 4;
  const SWIPE_DISMISS_THRESHOLD_PX = 50;

  type Feedback = {
    message: string;
    kind: "ok" | "err";
    path: string | null;
    preview?: string | null;
    duration_ms?: number | null;
  };

  const t = $derived($i18n);
  let feedback = $state<Feedback | null>(null);
  let timer: ReturnType<typeof setTimeout> | undefined;
  let pressedAt: { x: number; y: number } | null = null;
  let dragging = false;
  let swiping = $state(false);
  let swipeOffset = $state(0);
  let isSlidingOut = $state(false);

  function dismiss() {
    clearTimeout(timer);
    feedback = null;
    swiping = false;
    isSlidingOut = false;
    swipeOffset = 0;
    pressedAt = null;
    void hideFeedback();
  }

  function dismissWithSlide() {
    if (isSlidingOut) return;
    isSlidingOut = true;
    swiping = false;
    pressedAt = null;
    pauseDismiss();
    setTimeout(dismiss, 180);
  }

  function pauseDismiss() {
    clearTimeout(timer);
  }

  function scheduleDismiss() {
    clearTimeout(timer);
    if (!feedback || dragging || swiping || isSlidingOut) return;
    const delay = feedback.preview
      ? (feedback.duration_ms ?? DEFAULT_DISMISS_THUMBNAIL_MS)
      : feedback.path
        ? DISMISS_WITH_PATH_MS
        : DISMISS_MS;
    timer = setTimeout(dismiss, delay);
  }

  function showError(err: unknown) {
    if (!feedback) return;
    feedback = { ...feedback, message: String(err), kind: "err", path: null };
    scheduleDismiss();
  }

  async function reveal() {
    if (!feedback?.path) return;
    try {
      await revealPath(feedback.path);
      dismiss();
    } catch (err) {
      showError(err);
    }
  }

  function onPreviewPointerDown(e: PointerEvent) {
    if (e.button === 0) {
      pressedAt = { x: e.clientX, y: e.clientY };
      swiping = false;
      swipeOffset = 0;
      try {
        (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
      } catch {
        // Ignored
      }
    } else {
      pressedAt = null;
    }
  }

  function onPreviewPointerMove(e: PointerEvent) {
    if (!pressedAt || isSlidingOut || dragging) return;
    const dx = e.clientX - pressedAt.x;
    const dy = e.clientY - pressedAt.y;

    if (swiping) {
      swipeOffset = Math.max(0, dx);
      if (swipeOffset >= SWIPE_DISMISS_THRESHOLD_PX) {
        dismissWithSlide();
      }
      return;
    }

    if (Math.hypot(dx, dy) < DRAG_THRESHOLD_PX) return;

    if (dx > 0 && dx > Math.abs(dy)) {
      swiping = true;
      swipeOffset = dx;
      pauseDismiss();
      if (swipeOffset >= SWIPE_DISMISS_THRESHOLD_PX) {
        dismissWithSlide();
      }
      return;
    }

    // Moving left, up, or diagonal: initiate file drag out to another app
    pressedAt = null;
    dragging = true;
    pauseDismiss();
    startPreviewDrag().catch((err) => {
      dragging = false;
      showError(err);
    });
  }

  function onPreviewPointerUp(e?: PointerEvent) {
    if (e) {
      try {
        (e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId);
      } catch {
        // Ignored
      }
    }
    if (swiping && !isSlidingOut) {
      if (swipeOffset >= SWIPE_DISMISS_THRESHOLD_PX) {
        dismissWithSlide();
      } else {
        swipeOffset = 0;
        swiping = false;
        scheduleDismiss();
      }
    }
    pressedAt = null;
  }

  function onWheel(e: WheelEvent) {
    if (e.deltaX > 20 && !isSlidingOut) {
      dismissWithSlide();
    }
  }

  async function openPreview() {
    pressedAt = null;
    if (!feedback?.preview || dragging || swiping || isSlidingOut || swipeOffset > 0) return;
    try {
      await openInEditor(feedback.preview);
      dismiss();
    } catch (err) {
      showError(err);
    }
  }

  onMount(() => {
    void initLang();
    const un = listen<Feedback>("feedback-show", (event) => {
      feedback = event.payload;
      dragging = false;
      swiping = false;
      isSlidingOut = false;
      swipeOffset = 0;
      pressedAt = null;
      scheduleDismiss();
    });
    const unDrag = listen("feedback-drag-ended", () => {
      dragging = false;
      swiping = false;
      isSlidingOut = false;
      swipeOffset = 0;
      scheduleDismiss();
    });
    return () => {
      clearTimeout(timer);
      void un.then((fn) => fn());
      void unDrag.then((fn) => fn());
    };
  });
</script>

{#if feedback?.preview}
  <div
    class="thumbnail thumbnail-{feedback.kind}"
    class:swiping={swiping}
    class:sliding-out={isSlidingOut}
    style={swipeOffset > 0 && !isSlidingOut ? `transform: translateX(${swipeOffset}px);` : undefined}
    role="status"
    onpointerenter={pauseDismiss}
    onpointerleave={scheduleDismiss}
    onwheel={onWheel}
  >
    <button
      type="button"
      class="preview"
      aria-label={t.feedback.openInEditor}
      title={t.feedback.openInEditor}
      onpointerdown={onPreviewPointerDown}
      onpointermove={onPreviewPointerMove}
      onpointerup={onPreviewPointerUp}
      onpointercancel={onPreviewPointerUp}
      onclick={openPreview}
    >
      <img src={convertFileSrc(feedback.preview)} alt="" draggable="false" />
    </button>
    <button type="button" class="close" aria-label={t.feedback.dismiss} onclick={dismiss}>
      <X size={14} />
    </button>
    <div class="thumbnail-row">
      <span class="message">{feedback.message}</span>
      {#if feedback.path}
        <button
          type="button"
          class="reveal icon-only"
          aria-label={t.feedback.reveal}
          title={t.feedback.reveal}
          onclick={reveal}
        >
          <FolderOpen size={14} />
        </button>
      {/if}
    </div>
  </div>
{:else if feedback}
  <div
    class="feedback feedback-{feedback.kind}"
    role="status"
    onpointerenter={pauseDismiss}
    onpointerleave={scheduleDismiss}
  >
    <span class="message">{feedback.message}</span>
    {#if feedback.path}
      <button type="button" class="reveal" onclick={reveal}>
        <FolderOpen size={14} />
        <span>{t.feedback.reveal}</span>
      </button>
    {/if}
  </div>
{/if}

<style>
  :global(html),
  :global(body) {
    background: transparent;
    overflow: hidden;
  }

  .feedback {
    position: fixed;
    inset: 6px;
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
    padding: 0 10px 0 16px;
    border-radius: 10px;
    border: 1px solid rgba(255, 255, 255, 0.14);
    background: rgba(15, 16, 21, 0.94);
    color: #ffffff;
    font-size: 13px;
    font-weight: 500;
    user-select: none;
  }

  .feedback-err {
    background: #b91c1c;
  }

  .message {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .reveal {
    display: inline-flex;
    flex-shrink: 0;
    align-items: center;
    gap: 6px;
    padding: 6px 10px;
    border: 0;
    border-radius: 7px;
    background: rgba(255, 255, 255, 0.14);
    color: inherit;
    font: inherit;
    font-size: 12px;
    cursor: pointer;
  }

  .reveal:hover {
    background: rgba(255, 255, 255, 0.24);
  }

  .reveal.icon-only {
    padding: 6px;
  }

  .thumbnail {
    position: fixed;
    inset: 6px;
    display: flex;
    flex-direction: column;
    overflow: hidden;
    border-radius: 10px;
    border: 1px solid rgba(255, 255, 255, 0.14);
    background: rgba(15, 16, 21, 0.94);
    color: #ffffff;
    font-size: 12px;
    font-weight: 500;
    user-select: none;
    transition: transform 0.2s cubic-bezier(0.16, 1, 0.3, 1), opacity 0.2s ease-out;
  }

  .thumbnail.swiping {
    transition: none;
  }

  .thumbnail.sliding-out {
    transform: translateX(120%) !important;
    opacity: 0 !important;
    transition: transform 0.18s cubic-bezier(0.16, 1, 0.3, 1), opacity 0.18s ease-out !important;
  }

  .preview {
    flex: 1;
    min-height: 0;
    padding: 0;
    border: 0;
    background: transparent;
    cursor: grab;
  }

  .preview img {
    display: block;
    width: 100%;
    height: 100%;
    object-fit: contain;
    pointer-events: none;
  }

  .close {
    position: absolute;
    top: 6px;
    right: 6px;
    display: inline-flex;
    padding: 4px;
    border: 0;
    border-radius: 999px;
    background: rgba(15, 16, 21, 0.72);
    color: inherit;
    cursor: pointer;
    opacity: 0;
  }

  .thumbnail:hover .close,
  .close:focus-visible {
    opacity: 1;
  }

  .thumbnail-row {
    display: flex;
    flex-shrink: 0;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
    height: 44px;
    padding: 0 8px 0 12px;
  }

  .thumbnail-err .thumbnail-row {
    background: #b91c1c;
  }
</style>
