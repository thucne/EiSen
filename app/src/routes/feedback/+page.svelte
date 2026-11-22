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
  const DRAG_THRESHOLD_PX = 8;
  const DIAGONAL_DIRECTION_LOCK_PX = 16;
  const SWIPE_DISMISS_THRESHOLD_PX = 50;
  const WHEEL_DISMISS_THRESHOLD_PX = 28;
  const WHEEL_GESTURE_IDLE_MS = 160;

  type Feedback = {
    id: number;
    message: string;
    kind: "ok" | "err";
    path: string | null;
    preview?: string | null;
    duration_ms?: number | null;
  };

  const t = $derived($i18n);
  let feedback = $state<Feedback | null>(null);
  let dismissTimer: ReturnType<typeof setTimeout> | undefined;
  let slideTimer: ReturnType<typeof setTimeout> | undefined;
  let wheelResetTimer: ReturnType<typeof setTimeout> | undefined;
  let feedbackRevision = 0;
  let activeDragRevision: number | null = null;
  let wheelDistance = 0;
  let wheelDirection = 0;
  let pressedAt: { x: number; y: number } | null = null;
  let suppressNextClick = false;
  let dragging = false;
  let swiping = $state(false);
  let swipeOffset = $state(0);
  let isSlidingOut = $state(false);

  function clearFeedbackTimers() {
    clearTimeout(dismissTimer);
    clearTimeout(slideTimer);
    dismissTimer = undefined;
    slideTimer = undefined;
  }

  function resetWheelGesture() {
    clearTimeout(wheelResetTimer);
    wheelResetTimer = undefined;
    wheelDistance = 0;
    wheelDirection = 0;
  }

  function dismiss() {
    const dismissedFeedback = feedback;
    if (!dismissedFeedback) return;
    clearFeedbackTimers();
    resetWheelGesture();
    feedbackRevision += 1;
    activeDragRevision = null;
    feedback = null;
    swiping = false;
    isSlidingOut = false;
    swipeOffset = 0;
    pressedAt = null;
    void hideFeedback(dismissedFeedback.id, dismissedFeedback.preview ?? null);
  }

  function dismissWithSlide() {
    if (isSlidingOut || !feedback) return;
    isSlidingOut = true;
    swiping = false;
    pressedAt = null;
    pauseDismiss();
    clearTimeout(slideTimer);
    const revision = feedbackRevision;
    const slideDelay = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ? 0 : 180;
    slideTimer = setTimeout(() => {
      if (revision === feedbackRevision) dismiss();
    }, slideDelay);
  }

  function pauseDismiss() {
    clearTimeout(dismissTimer);
    dismissTimer = undefined;
  }

  function scheduleDismiss() {
    pauseDismiss();
    if (!feedback || dragging || swiping || isSlidingOut) return;
    const delay = feedback.preview
      ? (feedback.duration_ms ?? DEFAULT_DISMISS_THUMBNAIL_MS)
      : feedback.path
        ? DISMISS_WITH_PATH_MS
        : DISMISS_MS;
    const revision = feedbackRevision;
    dismissTimer = setTimeout(() => {
      if (revision === feedbackRevision) dismiss();
    }, delay);
  }

  function showError(err: unknown) {
    if (!feedback) return;
    feedback = { ...feedback, message: String(err), kind: "err", path: null };
    scheduleDismiss();
  }

  async function reveal() {
    const path = feedback?.path;
    if (!path) return;
    const revision = feedbackRevision;
    try {
      await revealPath(path);
      if (revision !== feedbackRevision) return;
      dismiss();
    } catch (err) {
      if (revision === feedbackRevision) showError(err);
    }
  }

  function onPreviewPointerDown(e: PointerEvent) {
    if (e.button === 0) {
      pressedAt = { x: e.clientX, y: e.clientY };
      suppressNextClick = false;
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

    suppressNextClick = true;

    const absDy = Math.abs(dy);
    const movement = Math.hypot(dx, dy);
    const nearDiagonal = Math.abs(Math.abs(dx) - absDy) <= 3;
    if (nearDiagonal && movement < DIAGONAL_DIRECTION_LOCK_PX) return;

    if (dx > 0 && dx > absDy) {
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
    const revision = feedbackRevision;
    const currentFeedback = feedback;
    if (!currentFeedback?.preview) {
      dragging = false;
      scheduleDismiss();
      return;
    }
    activeDragRevision = revision;
    startPreviewDrag(currentFeedback.id, currentFeedback.preview).catch((err) => {
      if (revision !== feedbackRevision || activeDragRevision !== revision) return;
      activeDragRevision = null;
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
    if (isSlidingOut || e.ctrlKey) {
      resetWheelGesture();
      return;
    }

    const unit = e.deltaMode === WheelEvent.DOM_DELTA_LINE
      ? 16
      : e.deltaMode === WheelEvent.DOM_DELTA_PAGE
        ? window.innerHeight
        : 1;
    const deltaX = e.deltaX * unit;
    const deltaY = e.deltaY * unit;
    if (deltaX === 0 || Math.abs(deltaX) <= Math.abs(deltaY)) {
      resetWheelGesture();
      return;
    }

    const direction = Math.sign(deltaX);
    if (wheelDirection !== 0 && wheelDirection !== direction) wheelDistance = 0;
    wheelDirection = direction;
    wheelDistance += Math.abs(deltaX);
    clearTimeout(wheelResetTimer);
    wheelResetTimer = setTimeout(resetWheelGesture, WHEEL_GESTURE_IDLE_MS);

    if (wheelDistance >= WHEEL_DISMISS_THRESHOLD_PX) {
      resetWheelGesture();
      dismissWithSlide();
    }
  }

  async function openPreview() {
    pressedAt = null;
    if (suppressNextClick) {
      suppressNextClick = false;
      return;
    }
    const preview = feedback?.preview;
    if (!preview || dragging || swiping || isSlidingOut || swipeOffset > 0) return;
    const revision = feedbackRevision;
    try {
      await openInEditor(preview);
      if (revision !== feedbackRevision) return;
      dismiss();
    } catch (err) {
      if (revision === feedbackRevision) showError(err);
    }
  }

  onMount(() => {
    void initLang();
    const un = listen<Feedback>("feedback-show", (event) => {
      clearFeedbackTimers();
      resetWheelGesture();
      feedbackRevision += 1;
      activeDragRevision = null;
      feedback = event.payload;
      dragging = false;
      swiping = false;
      isSlidingOut = false;
      swipeOffset = 0;
      pressedAt = null;
      suppressNextClick = false;
      scheduleDismiss();
    });
    const unDrag = listen<number>("feedback-drag-ended", (event) => {
      if (
        event.payload !== feedback?.id ||
        activeDragRevision === null ||
        activeDragRevision !== feedbackRevision
      ) return;
      activeDragRevision = null;
      dragging = false;
      swiping = false;
      isSlidingOut = false;
      swipeOffset = 0;
      scheduleDismiss();
    });
    return () => {
      clearFeedbackTimers();
      resetWheelGesture();
      feedbackRevision += 1;
      activeDragRevision = null;
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

  @media (prefers-reduced-motion: reduce) {
    .thumbnail,
    .thumbnail.sliding-out {
      transition: none !important;
    }
  }

  .thumbnail-err .thumbnail-row {
    background: #b91c1c;
  }
</style>
