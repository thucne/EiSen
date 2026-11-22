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
  /** Pointer swipe stays within ~26° of pure right; steeper drags start file D&D. */
  const SWIPE_MAX_SLOPE = 0.5;
  const SWIPE_CANCEL_VERTICAL_PX = 28;
  const SWIPE_CANCEL_MAX_HORIZONTAL_PX = 40;
  const SWIPE_DISMISS_RATIO = 0.42;
  const SWIPE_MIN_DISMISS_PX = 96;
  const SWIPE_FLICK_MIN_PX = 56;
  const SWIPE_FLICK_VELOCITY_PX_MS = 0.55;
  const SWIPE_FLICK_WINDOW_MS = 90;
  const WHEEL_IMMEDIATE_RATIO = 0.8;
  const WHEEL_IMMEDIATE_MIN_PX = 180;
  const WHEEL_GESTURE_IDLE_MS = 120;

  type Feedback = {
    id: number;
    message: string;
    kind: "ok" | "err";
    path: string | null;
    preview?: string | null;
    duration_ms?: number | null;
  };

  type PointerSample = { x: number; t: number };

  const t = $derived($i18n);
  let thumbnailEl = $state<HTMLDivElement | null>(null);
  let feedback = $state<Feedback | null>(null);
  let dismissTimer: ReturnType<typeof setTimeout> | undefined;
  let slideTimer: ReturnType<typeof setTimeout> | undefined;
  let wheelResetTimer: ReturnType<typeof setTimeout> | undefined;
  let feedbackRevision = 0;
  let activeDragRevision: number | null = null;
  let pressedAt: { x: number; y: number } | null = null;
  let pointerSamples: PointerSample[] = [];
  let suppressNextClick = false;
  let pointerHovered = false;
  let dragging = $state(false);
  let swiping = $state(false);
  let swipeOffset = $state(0);
  let isSlidingOut = $state(false);

  const swipeStyle = $derived.by(() => {
    if (swipeOffset <= 0 || isSlidingOut) return undefined;
    const width = Math.max(220, thumbnailWidth());
    const opacity = Math.max(0.25, 1 - (swipeOffset / width) * 0.6);
    return `transform: translateX(${swipeOffset}px); opacity: ${opacity.toFixed(3)};`;
  });

  function thumbnailWidth(): number {
    return thumbnailEl?.getBoundingClientRect().width || 0;
  }

  function swipeDismissThreshold(): number {
    return Math.max(SWIPE_MIN_DISMISS_PX, Math.round(thumbnailWidth() * SWIPE_DISMISS_RATIO));
  }

  function wheelImmediateDismissThreshold(): number {
    return Math.max(WHEEL_IMMEDIATE_MIN_PX, Math.round(thumbnailWidth() * WHEEL_IMMEDIATE_RATIO));
  }

  function clearFeedbackTimers() {
    clearTimeout(dismissTimer);
    clearTimeout(slideTimer);
    dismissTimer = undefined;
    slideTimer = undefined;
  }

  function resetWheelGesture() {
    clearTimeout(wheelResetTimer);
    wheelResetTimer = undefined;
  }

  function resetSwipe() {
    swiping = false;
    swipeOffset = 0;
  }

  function dismiss() {
    const dismissedFeedback = feedback;
    if (!dismissedFeedback) return;
    clearFeedbackTimers();
    resetWheelGesture();
    feedbackRevision += 1;
    activeDragRevision = null;
    feedback = null;
    dragging = false;
    pointerHovered = false;
    resetSwipe();
    isSlidingOut = false;
    pressedAt = null;
    pointerSamples = [];
    void hideFeedback(dismissedFeedback.id, dismissedFeedback.preview ?? null);
  }

  function dismissWithSlide() {
    if (isSlidingOut || !feedback) return;
    isSlidingOut = true;
    swiping = false;
    pressedAt = null;
    pointerSamples = [];
    pauseDismiss();
    resetWheelGesture();
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
    if (!feedback || pointerHovered || dragging || swiping || isSlidingOut) return;
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

  function onThumbnailPointerEnter() {
    pointerHovered = true;
    pauseDismiss();
  }

  function onThumbnailPointerLeave() {
    pointerHovered = false;
    scheduleDismiss();
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

  function releaseCapture(e?: PointerEvent) {
    if (!e) return;
    try {
      (e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId);
    } catch {
      // Ignored
    }
  }

  function recordPointerSample(x: number, t: number) {
    const cutoff = t - SWIPE_FLICK_WINDOW_MS;
    pointerSamples = pointerSamples.filter((sample) => sample.t >= cutoff);
    pointerSamples.push({ x, t });
  }

  function rightwardFlickVelocity(now: number): number {
    if (pointerSamples.length < 2) return 0;
    const last = pointerSamples[pointerSamples.length - 1];
    const prev = pointerSamples[pointerSamples.length - 2];
    if (now - last.t > SWIPE_FLICK_WINDOW_MS || last.x <= prev.x) return 0;
    const first = pointerSamples[0];
    const dt = last.t - first.t;
    if (dt <= 0) return 0;
    return (last.x - first.x) / dt;
  }

  function beginFileDrag(e: PointerEvent) {
    pressedAt = null;
    pointerSamples = [];
    resetSwipe();
    dragging = true;
    pauseDismiss();
    releaseCapture(e);
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
      suppressNextClick = false;
      showError(err);
    });
  }

  function onPreviewPointerDown(e: PointerEvent) {
    if (e.button === 0 && !isSlidingOut && !dragging) {
      pressedAt = { x: e.clientX, y: e.clientY };
      pointerSamples = [{ x: e.clientX, t: performance.now() }];
      suppressNextClick = false;
      resetWheelGesture();
      resetSwipe();
      pauseDismiss();
      try {
        (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
      } catch {
        // Ignored
      }
    } else {
      pressedAt = null;
      pointerSamples = [];
    }
  }

  function onPreviewPointerMove(e: PointerEvent) {
    if (!pressedAt || isSlidingOut || dragging) return;
    const dx = e.clientX - pressedAt.x;
    const dy = e.clientY - pressedAt.y;
    const absDy = Math.abs(dy);
    recordPointerSample(e.clientX, performance.now());

    if (swiping) {
      if (
        swipeOffset < SWIPE_CANCEL_MAX_HORIZONTAL_PX &&
        absDy > SWIPE_CANCEL_VERTICAL_PX &&
        absDy > Math.abs(dx)
      ) {
        beginFileDrag(e);
        return;
      }
      swipeOffset = Math.max(0, dx);
      return;
    }

    if (Math.hypot(dx, dy) < DRAG_THRESHOLD_PX) return;

    suppressNextClick = true;

    if (dx > 0 && absDy <= dx * SWIPE_MAX_SLOPE) {
      swiping = true;
      swipeOffset = dx;
      pauseDismiss();
      return;
    }

    beginFileDrag(e);
  }

  function onPreviewPointerUp(e?: PointerEvent) {
    releaseCapture(e);
    if (swiping && !isSlidingOut) {
      const flicked =
        swipeOffset >= SWIPE_FLICK_MIN_PX &&
        rightwardFlickVelocity(performance.now()) >= SWIPE_FLICK_VELOCITY_PX_MS;
      if (swipeOffset >= swipeDismissThreshold() || flicked) {
        dismissWithSlide();
      } else {
        resetSwipe();
        scheduleDismiss();
      }
    } else if (!dragging && !isSlidingOut) {
      scheduleDismiss();
    }
    pressedAt = null;
    pointerSamples = [];
  }

  function onPreviewPointerCancel(e?: PointerEvent) {
    releaseCapture(e);
    if (!pressedAt && !swiping) return;
    resetSwipe();
    pressedAt = null;
    pointerSamples = [];
    if (!dragging && !isSlidingOut) {
      scheduleDismiss();
    }
  }

  function settleWheelSwipe() {
    wheelResetTimer = undefined;
    if (isSlidingOut || !feedback) return;
    if (swipeOffset >= swipeDismissThreshold()) {
      dismissWithSlide();
    } else {
      resetSwipe();
      scheduleDismiss();
    }
  }

  function onWheel(e: WheelEvent) {
    if (isSlidingOut || dragging || pressedAt || e.ctrlKey) {
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
    if (deltaX === 0 || Math.abs(deltaX) <= Math.abs(deltaY)) return;

    const natural =
      (e as WheelEvent & { webkitDirectionInvertedFromDevice?: boolean })
        .webkitDirectionInvertedFromDevice === true;
    const fingerDeltaX = natural ? -deltaX : deltaX;
    if (swipeOffset === 0 && fingerDeltaX <= 0) return;

    const maxOffset = Math.max(thumbnailWidth(), WHEEL_IMMEDIATE_MIN_PX);
    const nextOffset = Math.min(maxOffset, Math.max(0, swipeOffset + fingerDeltaX));
    swipeOffset = nextOffset;

    if (nextOffset === 0) {
      resetSwipe();
      resetWheelGesture();
      scheduleDismiss();
      return;
    }

    swiping = true;
    pauseDismiss();

    if (nextOffset >= wheelImmediateDismissThreshold()) {
      resetWheelGesture();
      dismissWithSlide();
      return;
    }

    clearTimeout(wheelResetTimer);
    wheelResetTimer = setTimeout(settleWheelSwipe, WHEEL_GESTURE_IDLE_MS);
  }

  async function openPreview() {
    pressedAt = null;
    pointerSamples = [];
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
      resetSwipe();
      isSlidingOut = false;
      pressedAt = null;
      pointerSamples = [];
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
      resetSwipe();
      isSlidingOut = false;
      suppressNextClick = false;
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
    bind:this={thumbnailEl}
    class="thumbnail thumbnail-{feedback.kind}"
    class:swiping={swiping}
    class:sliding-out={isSlidingOut}
    style={swipeStyle}
    role="status"
    onpointerenter={onThumbnailPointerEnter}
    onpointerleave={onThumbnailPointerLeave}
    onwheel={onWheel}
  >
    <button
      type="button"
      class="preview"
      class:dragging={dragging || swiping}
      aria-label={t.feedback.openInEditor}
      title={t.feedback.openInEditor}
      onpointerdown={onPreviewPointerDown}
      onpointermove={onPreviewPointerMove}
      onpointerup={onPreviewPointerUp}
      onpointercancel={onPreviewPointerCancel}
      onlostpointercapture={() => onPreviewPointerCancel()}
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
    -webkit-user-select: none;
    user-select: none;
    transition: transform 0.22s cubic-bezier(0.22, 1, 0.36, 1), opacity 0.22s ease-out;
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
    touch-action: none;
    -webkit-user-select: none;
    user-select: none;
  }

  .preview.dragging {
    cursor: grabbing;
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
