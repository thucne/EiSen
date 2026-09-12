<script lang="ts">
  import { onMount } from "svelte";
  import { convertFileSrc, invoke } from "@tauri-apps/api/core";
  import { getCurrentWindow } from "@tauri-apps/api/window";
  import * as api from "$lib/api";
  import logoMark from "$lib/assets/eisen-mark-reversed.svg";
  import Toast from "$lib/components/Toast.svelte";
  import EyedropperLoupe from "$lib/editor/EyedropperLoupe.svelte";
  import TextMarker from "$lib/editor/TextMarker.svelte";
  import {
    arrowHeadPoints,
    arrowShaftEnd,
    bbox,
    clampTextPlacement,
    drawableStrokePoints,
    hitTest,
    isCompactInk,
    penArrowHead,
    stepBadgeAppearance,
    sweepErasePoints,
    TEXT_FONT_FAMILY,
    TEXT_MIN_WIDTH,
    textDisplayWidth,
    textBoxHeight,
    type DrawTool,
    type Element,
    type Point,
    type ResizeHandle,
    type TextElement,
    type Tool,
  } from "$lib/editor/elements";
  import {
    buildLoupeGrid,
    loupeSourceRect,
    getSamplingCanvas,
    type PixelBlock,
  } from "$lib/editor/loupe";
  import {
    renderAnnotatedPng,
  } from "$lib/editor/exportPipeline";
  import {
    neighborSize,
    resolveShortcut,
    sizeOptionsFor,
  } from "$lib/editor/keyboardShortcuts";
  import { createSessionLoader, watchFocusReload } from "$lib/editor/session";
  import {
    HANDLE_R,
    cornerHandles,
    deleteButtonPosition,
    handleAt as handleAtPoint,
    shouldBeginResize,
    sizeControlVisible,
    stampHitIntent,
    textBodyIntent,
    textDragArmed,
  } from "$lib/editor/pointer";
  import {
    beginDraw,
    beginErase,
    beginMove,
    beginResize,
    beginTextEdit,
    cancelMove,
    canRedo,
    canUndo,
    color,
    editingId,
    elements,
    endDraw,
    endErase,
    endMove,
    endResize,
    endTextEdit,
    eraseAt,
    extendDraw,
    moveTo,
    redo,
    remove,
    reset,
    resizeTo,
    select,
    selectedId,
    setColor,
    setStrokeSize,
    setTool,
    setText,
    nudgeSelection,
    strokeSize,
    tool,
    undo,
  } from "$lib/editor/store";
  import { i18n, initLang } from "$lib/i18n";
  import { Copy, CopyCheck, Download, ScanText, X } from "@lucide/svelte";
  import EditorToolbar from "./EditorToolbar.svelte";

  const t = $derived($i18n);

  let imageSrc = $state<string | null>(null);
  let canvasW = $state(0);
  let canvasH = $state(0);
  let exportScale = $state(1);
  let loadError = $state<string | null>(null);
  let toast = $state<{ message: string; kind: "ok" | "err" } | null>(null);
  let textHeights = $state<Record<number, number>>({});
  let textWidths = $state<Record<number, number>>({});
  let svgEl = $state<SVGSVGElement | undefined>();
  let containerEl = $state<HTMLDivElement | undefined>();
  let eraserBadge = $state<Point | null>(null);

  function purgeTextHeight(id: number) {
    let needH = id in textHeights;
    let needW = id in textWidths;
    if (needH) {
      const next = { ...textHeights };
      delete next[id];
      textHeights = next;
    }
    if (needW) {
      const nextW = { ...textWidths };
      delete nextW[id];
      textWidths = nextW;
    }
  }



  // OCR state
  let isExtractingText = $state(false);

  // Eyedropper Loupe state
  let loupeVisible = $state(false);
  let loupeClientPos = $state({ x: 0, y: 0 });
  let loupeColorHex = $state("#000000");
  let loupePixels = $state<string[][]>([]);
  let samplingCtx: CanvasRenderingContext2D | null = null;

  // Interactive popovers & collapse state
  let showColors = $state(false);
  let showSizes = $state(false);
  let isCollapsed = $state(false);

  type DragState =
    | { kind: "draw"; id: number }
    | { kind: "move"; id: number; start: Point; editIfClick?: boolean }
    | { kind: "resize"; id: number; handle: ResizeHandle; start: Point }
    | { kind: "erase"; last: Point }
    | { kind: "placeText"; start: Point };
  let drag = $state<DragState | null>(null);
  let lastPointer = $state<Point | null>(null);

  const selected = $derived($elements.find((e) => e.id === $selectedId) ?? null);
  const selectedBox = $derived(selected ? bbox(selected) : null);
  const sizeControl = $derived(sizeControlVisible($tool, selected?.kind));
  const sizeTool = $derived(
    selected?.kind === "text" || selected?.kind === "step"
      ? selected.kind
      : $tool
  );

  $effect(() => {
    if (!sizeControl) showSizes = false;
  });
  const editingTextEl = $derived(
    $editingId != null
      ? (($elements.find((e) => e.id === $editingId && e.kind === "text") as TextElement | undefined) ?? null)
      : null,
  );
  // Single source of truth for text frame size: measured width hugged via
  // textDisplayWidth, height = max(estimated wrap, measured). Used by both
  // the FO attrs and the handle overlay so editing/selected never jump.
  function textFrame(el: TextElement): { foW: number; foH: number } {
    const measuredW = textWidths[el.id] ?? 0;
    const foW = textDisplayWidth(measuredW, el.x, canvasW, el.width);
    const estimated = textBoxHeight(el.text, el.size, foW);
    const foH = textHeights[el.id] ?? estimated;
    return { foW, foH };
  }
  const handles = $derived.by(() => {
    const textEl = editingTextEl ?? (selected?.kind === "text" ? (selected as TextElement) : null);
    if (textEl) {
      const { foW, foH } = textFrame(textEl);
      return cornerHandles({ x: textEl.x, y: textEl.y, width: foW, height: foH });
    }
    if (
      selected &&
      selectedBox &&
      (selected.kind === "ellipse" || selected.kind === "rectangle" || selected.kind === "blur" || selected.kind === "step")
    ) {
      return cornerHandles(selectedBox);
    }
    return [];
  });
  // Same rect as the dashed frame + handles + delete, so they cannot drift apart.
  const chromeBox = $derived.by(() => {
    if (!selected) return null;
    if (selected.kind === "text") {
      const { foW, foH } = textFrame(selected);
      return { x: selected.x, y: selected.y, width: foW, height: foH };
    }
    return selectedBox;
  });
  const textChrome = $derived.by(() => {
    const textEl = editingTextEl ?? (selected?.kind === "text" ? (selected as TextElement) : null);
    if (!textEl) return null;
    const { foW, foH } = textFrame(textEl);
    return { id: textEl.id, x: textEl.x, y: textEl.y, width: foW, height: foH };
  });

  const loadSession = createSessionLoader({
    api,
    toFileSrc: convertFileSrc,
    onLoaded: ({ width, height, scale, fileSrc }) => {
      canvasW = width;
      canvasH = height;
      exportScale = scale;
      imageSrc = fileSrc;
      loadError = null;
      reset();
    },
    onError: (message) => {
      if (!imageSrc) loadError = message;
    },
  });

  onMount(() => {
    void initLang();
    void loadSession(true);
    const un = watchFocusReload(getCurrentWindow(), () => loadSession());
    return () => {
      void un.then((fn) => fn());
    };
  });

  async function prepareSampling(src: string, w: number, h: number) {
    const target = await getSamplingCanvas(src, w, h);
    if (target) samplingCtx = target.ctx;
  }

  function sampleLoupePixels(clientX: number, clientY: number, p: Point) {
    loupeClientPos = { x: clientX, y: clientY };
    if (!samplingCtx || canvasW === 0 || canvasH === 0) return;

    const px = Math.round(p.x);
    const py = Math.round(p.y);
    const radius = 5;

    const { sx, sy, sw, sh } = loupeSourceRect(px, py, radius, canvasW, canvasH);

    let block: PixelBlock | null = null;
    if (sw > 0 && sh > 0) {
      try {
        block = samplingCtx.getImageData(sx, sy, sw, sh);
      } catch {
        block = null;
      }
    }

    const grid = buildLoupeGrid(block, px, py, radius, canvasW, canvasH);

    if (px >= 0 && px < canvasW && py >= 0 && py < canvasH) {
      loupeColorHex = grid[radius][radius];
    }

    loupePixels = grid;
    loupeVisible = true;
  }

  async function copyExtractedText() {
    if (isExtractingText) return;
    isExtractingText = true;
    try {
      const text = await api.extractText();
      if (!text || text.trim().length === 0) {
        showToast(t.ocr.noText, "err");
      } else {
        await navigator.clipboard.writeText(text);
        showToast(t.ocr.copied, "ok");
      }
    } catch (err) {
      console.error("OCR extraction failed:", err);
      showToast(`${t.ocr.errorPrefix}: ${err}`, "err");
    } finally {
      isExtractingText = false;
    }
  }

  function applyAspectLock(shift: boolean) {
    if (!drag || !lastPointer) return;
    if (drag.kind === "draw") extendDraw(drag.id, lastPointer, shift);
    else if (drag.kind === "resize") resizeTo(drag.id, lastPointer, canvasW, shift);
  }

  function svgPoint(e: PointerEvent): Point {
    const rect = svgEl?.getBoundingClientRect();
    if (!rect || rect.width === 0) return { x: 0, y: 0 };
    const scaleX = canvasW / rect.width;
    const scaleY = canvasH / rect.height;
    return {
      x: (e.clientX - rect.left) * scaleX,
      y: (e.clientY - rect.top) * scaleY,
    };
  }

  function onHandlePointerDown(e: PointerEvent, handle: ResizeHandle) {
    if (e.button !== 0) return;
    e.stopPropagation();
    const target = editingTextEl ?? selected;
    if (
      !target ||
      !shouldBeginResize({ handle, tool: $tool, targetKind: target.kind })
    ) {
      return;
    }
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    const p = svgPoint(e);
    drag = { kind: "resize", id: target.id, handle, start: p };
    beginResize(target.id, handle, p);
  }

  function onPointerDown(e: PointerEvent) {
    if (e.button !== 0) return;
    const p = svgPoint(e);
    const handle = handleAtPoint(handles, p);
    const resizeTarget = editingTextEl ?? selected;
    if (
      handle &&
      resizeTarget &&
      shouldBeginResize({ handle, tool: $tool, targetKind: resizeTarget.kind })
    ) {
      (e.currentTarget as SVGSVGElement).setPointerCapture(e.pointerId);
      drag = { kind: "resize", id: resizeTarget.id, handle, start: p };
      beginResize(resizeTarget.id, handle, p);
      return;
    }
    // TextMarker stops pointerdown propagation for interior drags (caret,
    // text selection), so reaching here means a click outside the editing
    // surface. Guard the HTML overlay path, otherwise commit below.
    if (editingTextEl) {
      if ((e.target as HTMLElement | null)?.closest?.(".text-marker.editing")) return;
    }
    if ($editingId != null) {
      commitText();
      // Clicking outside a text edit returns to view mode (cursor back to
      // select) instead of staying in text-creation mode.
      if ($tool === "text") setTool("select");
    }

    showColors = false;
    showSizes = false;

    if ($tool === "eyedropper") {
      copyPickedColor();
      return;
    }

    if ($tool === "eraser") {
      (e.currentTarget as SVGSVGElement).setPointerCapture(e.pointerId);
      beginErase();
      const hit = hitTest($elements, p);
      if (hit) {
        eraseAt(hit.id);
        purgeTextHeight(hit.id);
      }
      // Pressing empty space erases nothing (no remove-last shortcut):
      // the gesture stays open so press-then-sweep still deletes markers
      // the pointer moves across. An empty gesture reclaims its snapshot.
      drag = { kind: "erase", last: p };
      return;
    }

    if ($tool === "select") {
      (e.currentTarget as SVGSVGElement).setPointerCapture(e.pointerId);
      const hit = hitTest($elements, p);
      if (hit) {
        drag = {
          kind: "move",
          id: hit.id,
          start: p,
          editIfClick: hit.kind === "text" && textBodyIntent($tool) != null,
        };
        beginMove(hit.id, p);
      } else {
        select(null);
      }
      return;
    }

    if ($tool === "text" || $tool === "step") {
      const hit = hitTest($elements, p);
      const intent = stampHitIntent($tool, hit?.kind ?? null);
      if (intent === "move" && hit) {
        (e.currentTarget as SVGSVGElement).setPointerCapture(e.pointerId);
        drag = {
          kind: "move",
          id: hit.id,
          start: p,
          editIfClick: hit.kind === "text",
        };
        beginMove(hit.id, p);
      } else if ($tool === "text") {
        e.preventDefault();
        (e.currentTarget as SVGSVGElement).setPointerCapture(e.pointerId);
        drag = { kind: "placeText", start: p };
      } else {
        (e.currentTarget as SVGSVGElement).setPointerCapture(e.pointerId);
        const id = beginDraw("step", p);
        drag = { kind: "draw", id };
      }
      return;
    }

    (e.currentTarget as SVGSVGElement).setPointerCapture(e.pointerId);
    const id = beginDraw($tool as DrawTool, p);
    drag = { kind: "draw", id };
  }

  function onPointerMove(e: PointerEvent) {
    const p = svgPoint(e);
    if ($tool === "eyedropper") {
      sampleLoupePixels(e.clientX, e.clientY, p);
      return;
    }
    if ($tool === "eraser") {
      const rect = containerEl?.getBoundingClientRect();
      eraserBadge = rect ? { x: e.clientX - rect.left, y: e.clientY - rect.top } : null;
    }
    lastPointer = p;
    if (!drag) return;
    if (drag.kind === "draw") extendDraw(drag.id, p, e.shiftKey);
    else if (drag.kind === "placeText") {
      // Pointer position tracked via lastPointer
    }
    else if (drag.kind === "move") {
      if (drag.editIfClick && !textDragArmed(drag.start, p)) return;
      if (drag.editIfClick) drag.editIfClick = false;
      moveTo(drag.id, p);
    }
    else if (drag.kind === "erase") {
      for (const q of sweepErasePoints(drag.last, p)) {
        const hit = hitTest($elements, q);
        if (hit) {
          eraseAt(hit.id);
          purgeTextHeight(hit.id);
        }
      }
      drag.last = p;
    }
    else resizeTo(drag.id, p, canvasW, e.shiftKey);
  }

  function onPointerUp(e?: PointerEvent) {
    if (!drag) return;
    if (drag.kind === "draw") endDraw(drag.id);
    else if (drag.kind === "placeText") {
      const p = e ? svgPoint(e) : (lastPointer ?? drag.start);
      const minX = Math.min(drag.start.x, p.x);
      const dragW = Math.abs(p.x - drag.start.x);
      const effectiveW = Math.max(TEXT_MIN_WIDTH, dragW);
      const bounds = clampTextPlacement({ x: minX, y: Math.min(drag.start.y, p.y) }, canvasW, effectiveW);
      beginDraw("text", { x: bounds.x, y: bounds.y }, bounds.width);
    }
    else if (drag.kind === "move") {
      if (drag.editIfClick) {
        const id = drag.id;
        cancelMove();
        beginTextEdit(id);
      } else {
        endMove();
      }
    }
    else if (drag.kind === "erase") endErase();
    else endResize();
    drag = null;
  }

  function cancelDrag() {
    if (!drag) return;
    if (drag.kind === "erase") {
      if (endErase()) undo();
    } else if (drag.kind === "placeText") {
      // Gesture cancelled before text creation
    } else if (drag.kind === "move" && drag.editIfClick) {
      cancelMove();
    } else {
      if (drag.kind === "move") endMove();
      else if (drag.kind === "resize") endResize();
      undo();
    }
    drag = null;
  }

  function commitText() {
    const id = $editingId;
    endTextEdit();
    if (id != null && !$elements.some((e) => e.id === id)) {
      purgeTextHeight(id);
    }
  }

  /** Toast dwell before hiding the editor. Long enough to read a short
   *  confirmation, short enough not to feel like lag. */
  const EXIT_DWELL_MS = 250;

  function closeEditor() {
    void getCurrentWindow().close();
  }

  function showToast(message: string, kind: "ok" | "err") {
    toast = { message, kind };
  }

  function exitSoon() {
    setTimeout(() => closeEditor(), EXIT_DWELL_MS);
  }

  function basename(path: string): string {
    return path.split(/[\\/]/).pop() ?? path;
  }

  async function exportRenderedBytes(): Promise<Uint8Array> {
    if (!imageSrc || !canvasW || !canvasH) throw new Error("Canvas image not ready");
    if ($editingId != null) commitText();
    return renderAnnotatedPng({
      imageSrc,
      canvasW,
      canvasH,
      exportScale,
      svgEl: svgEl ?? null,
      getElements: () => $elements,
    });
  }

  async function doAction(kind: "copy" | "save" | "copyAndSave") {
    try {
      if ($elements.length === 0) {
        if (kind === "copy") {
          await api.copy();
          showToast(t.toasts.copied, "ok");
          exitSoon();
        } else if (kind === "save") {
          const r = await api.save();
          showToast(`${t.toasts.saved}: ${basename(r.path)}`, "ok");
          exitSoon();
        } else if (kind === "copyAndSave") {
          const r = await api.copyAndSave();
          showToast(`${t.toasts.copiedAndSaved}: ${basename(r.path)}`, "ok");
          exitSoon();
        }
      } else {
        const bytes = await exportRenderedBytes();
        if (kind === "copy") {
          await api.copyBytes(bytes);
          showToast(t.toasts.copied, "ok");
          exitSoon();
        } else if (kind === "save") {
          const r = await api.saveBytes(bytes);
          showToast(`${t.toasts.saved}: ${basename(r.path)}`, "ok");
          exitSoon();
        } else if (kind === "copyAndSave") {
          const r = await api.copyAndSaveBytes(bytes);
          showToast(`${t.toasts.copiedAndSaved}: ${basename(r.path)}`, "ok");
          exitSoon();
        }
      }
    } catch (err) {
      showToast(String(err), "err");
    }
  }

  function onKeyDown(e: KeyboardEvent) {
    if (e.key === "Shift") applyAspectLock(true);
    const action = resolveShortcut(e, { tool: $tool, editing: $editingId != null });
    if (!action) return;
    switch (action.kind) {
      case "undo":
        e.preventDefault();
        if ($editingId != null) commitText();
        undo();
        break;
      case "redo":
        e.preventDefault();
        if ($editingId != null) commitText();
        redo();
        break;
      case "output":
        e.preventDefault();
        void doAction(action.output);
        break;
      case "pickEyedropperColor":
        e.preventDefault();
        copyPickedColor();
        break;
      case "escape": {
        e.preventDefault();
        if (showColors || showSizes) {
          showColors = false;
          showSizes = false;
          break;
        }
        if (drag) cancelDrag();
        else if ($editingId != null) commitText();
        else if ($selectedId != null) select(null);
        else closeEditor();
        break;
      }
      case "deleteSelection": {
        const id = $selectedId;
        if (id != null) {
          remove(id);
          purgeTextHeight(id);
        }
        break;
      }
      case "shrinkSize":
      case "growSize": {
        if (!sizeControl) break;
        e.preventDefault();
        const next = neighborSize(
          sizeOptionsFor($tool),
          $strokeSize,
          action.kind === "shrinkSize" ? -1 : 1,
        );
        if (next != null) pickSize(next);
        break;
      }
      case "selectTool":
        e.preventDefault();
        useTool(action.tool);
        break;
      case "nudge":
        e.preventDefault();
        nudgeSelection(action.dx, action.dy);
        break;
    }
  }

  function pickColor(c: string) {
    commitIfEditing();
    setColor(c);
  }

  function copyPickedColor() {
    pickColor(loupeColorHex);
    void navigator.clipboard.writeText(loupeColorHex);
    showToast(t.eyedropper.copied.replace("{hex}", loupeColorHex), "ok");
  }

  function pickSize(n: number) {
    commitIfEditing();
    setStrokeSize(n);
  }

  function useTool(t: Tool) {
    commitIfEditing();
    setTool(t);
    if (t === "eyedropper" && imageSrc && canvasW > 0 && canvasH > 0) {
      void prepareSampling(imageSrc, canvasW, canvasH);
    }
  }

  function commitIfEditing() {
    if ($editingId != null) commitText();
  }

  function onKeyUp(e: KeyboardEvent) {
    if (e.key === "Shift") applyAspectLock(false);
  }
</script>

<svelte:window onkeydown={onKeyDown} onkeyup={onKeyUp} />

<main class="editor-layout">
  <!-- Glassmorphic Header with Output Actions -->
  <header class="editor-header">
    <div class="brand">
      <img src={logoMark} alt="EiSen Logo" class="app-logo" />
      <span class="title">EiSen {t.editor.title}</span>
      {#if canvasW > 0}
        <span class="dimensions">{Math.round(canvasW)} × {Math.round(canvasH)}</span>
      {/if}
    </div>

    <!-- Output Actions (Always Visible in Header) -->
    <div class="header-actions">
      <button
        class="tb-btn accent {isExtractingText ? 'loading' : ''}"
        title={`${t.actions.extractText} (OCR)`}
        disabled={isExtractingText}
        onclick={copyExtractedText}
      >
        <ScanText size={15} />
      </button>

      <button class="tb-btn accent" title={`${t.actions.copy} (Cmd+C)`} onclick={() => doAction("copy")}>
        <Copy size={15} />
      </button>

      <button
        class="tb-btn accent"
        title={t.actions.copyAndSave}
        onclick={() => doAction("copyAndSave")}
      >
        <CopyCheck size={15} />
      </button>

      <button class="tb-btn primary" title={`${t.actions.saveFile} (Cmd+S)`} onclick={() => doAction("save")}>
        <Download size={15} />
        <span>{t.actions.save}</span>
      </button>

      <div class="v-divider"></div>

      <button class="icon-btn close-btn" title={`${t.actions.close} (Esc)`} onclick={closeEditor}>
        <X size={16} />
      </button>
    </div>
  </header>

  <!-- Editor Canvas Area -->
  <div class="canvas-viewport">
    {#if loadError}
      <div class="load-error animate-fade">
        <p>{t.toasts.loadFailed}</p>
        <p class="detail">{loadError}</p>
        <button class="btn-primary" onclick={closeEditor}>{t.actions.dismiss}</button>
      </div>
    {:else if imageSrc}
      <div
        class="canvas-container"
        bind:this={containerEl}
        style="width:{canvasW}px;height:{canvasH}px"
        oncontextmenu={(e) => e.preventDefault()}
        role="img"
      >
        <svg
          bind:this={svgEl}
          class="canvas tool-{$tool}"
          width={canvasW}
          height={canvasH}
          viewBox="0 0 {canvasW} {canvasH}"
          onpointerdown={onPointerDown}
          onpointermove={onPointerMove}
          onpointerup={onPointerUp}
          onpointercancel={cancelDrag}
          onpointerleave={() => { loupeVisible = false; eraserBadge = null; }}
          role="img"
          aria-label={t.editor.canvasLabel}
        >
          <defs>
            <filter id="pixel-blur" x="0" y="0" width="100%" height="100%">
              <feGaussianBlur stdDeviation="8" />
            </filter>
          </defs>

          <!-- Captured Base Image -->
          <image class="bg-base-image" href={imageSrc} width={canvasW} height={canvasH} />

          <!-- Rendered Annotations -->
          {#each $elements as el (el.id)}
            {#if el.kind === "text"}
              {@const { foW, foH } = textFrame(el)}
              <foreignObject
                data-el-id={el.id}
                x={el.x}
                y={el.y}
                width={foW}
                height={foH}
                overflow="visible"
                pointer-events={el.id === $editingId ? "all" : "none"}
              >
                <div xmlns="http://www.w3.org/1999/xhtml" style="position: relative; width: 100%; height: 100%; overflow: visible;">
                  <TextMarker
                    element={el}
                    editing={el.id === $editingId}
                    oninputtext={(t) => {
                      setText(el.id, t);
                    }}
                    oncommit={() => {
                      commitText();
                      if ($tool === "text") setTool("select");
                    }}
                    onMeasure={({ width, height }) => {
                      if (textWidths[el.id] !== width) {
                        const nextW = { ...textWidths };
                        nextW[el.id] = width;
                        textWidths = nextW;
                      }
                      if (textHeights[el.id] !== height) textHeights[el.id] = height;
                    }}
                  />
                </div>
              </foreignObject>
            {:else if el.kind === "step"}
              {@const badge = stepBadgeAppearance(el)}
              <g data-el-id={el.id} transform="translate({el.x}, {el.y})">
                <circle
                  r={badge.r}
                  fill={el.color}
                  stroke={badge.ring}
                  stroke-width={badge.strokeWidth}
                />
                <text
                  class="step-digit"
                  x="0"
                  y={badge.textY}
                  text-anchor="middle"
                  dominant-baseline="alphabetic"
                  fill={badge.glyph}
                  font-size={badge.fontSize}
                  font-weight="700"
                  font-family={TEXT_FONT_FAMILY}
                  style="line-height:1;font-variant-numeric:lining-nums tabular-nums"
                  >{el.stepNumber}</text
                >
              </g>
            {:else if el.kind === "arrow"}
              {@const shaft = arrowShaftEnd(el)}
              <line
                data-el-id={el.id}
                x1={el.x1}
                y1={el.y1}
                x2={shaft.x}
                y2={shaft.y}
                stroke={el.color}
                stroke-width={el.size}
                stroke-linecap="round"
              />
              <polygon data-el-id={el.id} points={arrowHeadPoints(el)} fill={el.color} />
            {:else if el.kind === "ellipse"}
              <ellipse
                data-el-id={el.id}
                cx={el.x + el.width / 2}
                cy={el.y + el.height / 2}
                rx={Math.max(0.5, el.width / 2)}
                ry={Math.max(0.5, el.height / 2)}
                stroke={el.color}
                stroke-width={el.size}
                fill="none"
              />
            {:else if el.kind === "rectangle"}
              <rect
                data-el-id={el.id}
                x={el.x}
                y={el.y}
                width={el.width}
                height={el.height}
                stroke={el.color}
                stroke-width={el.size}
                fill="none"
                rx={4}
              />
            {:else if el.kind === "blur"}
              <g class="blur-group" clip-path="url(#clip-{el.id})">
                <clipPath id="clip-{el.id}">
                  <rect x={el.x} y={el.y} width={el.width} height={el.height} rx={4} />
                </clipPath>
                <svg
                  x={el.x}
                  y={el.y}
                  width={Math.max(1, el.width)}
                  height={Math.max(1, el.height)}
                  viewBox="{el.x} {el.y} {Math.max(1, el.width)} {Math.max(1, el.height)}"
                >
                  <image href={imageSrc} width={canvasW} height={canvasH} filter="url(#pixel-blur)" />
                </svg>
              </g>
              <rect
                data-el-id={el.id}
                x={el.x}
                y={el.y}
                width={el.width}
                height={el.height}
                stroke="rgba(255, 255, 255, 0.4)"
                stroke-width="1.5"
                stroke-dasharray="4 4"
                fill="none"
                rx={4}
              />
            {:else if el.kind === "pen"}
              <polyline
                data-el-id={el.id}
                points={drawableStrokePoints(el.points).map((p) => `${p.x},${p.y}`).join(" ")}
                stroke={el.color}
                stroke-width={el.size}
                stroke-linecap="round"
                stroke-linejoin="round"
                fill="none"
              />
            {:else if el.kind === "highlight"}
              <polyline
                data-el-id={el.id}
                points={drawableStrokePoints(el.points).map((p) => `${p.x},${p.y}`).join(" ")}
                stroke={el.color}
                stroke-width={el.size}
                stroke-linecap="round"
                stroke-linejoin="round"
                opacity={0.5}
                fill="none"
              />
            {:else if el.kind === "penArrow"}
              {@const head = penArrowHead(el)}
              {@const pts = drawableStrokePoints(head ? head.points : el.points)}
              <polyline
                data-el-id={el.id}
                points={pts.map((p) => `${p.x},${p.y}`).join(" ")}
                stroke={el.color}
                stroke-width={el.size}
                stroke-linecap="round"
                stroke-linejoin="round"
                fill="none"
              />
              {#if head}
                <polygon data-el-id={el.id} points={head.headPoints} fill={el.color} />
              {/if}
            {/if}
          {/each}

          <!-- Shape selection box only. Text chrome is HTML so the dashed
               frame, handles, and delete share one box (incl. while editing). -->
          {#if chromeBox && selected && selected.kind !== "text" && !isCompactInk(selected)}
            <rect
              class="selection-box"
              x={chromeBox.x}
              y={chromeBox.y}
              width={chromeBox.width}
              height={chromeBox.height}
            />
          {/if}
        </svg>

        {#if textChrome}
          <div
            class="text-chrome"
            style="left:{textChrome.x}px;top:{textChrome.y}px;width:{textChrome.width}px;height:{textChrome.height}px"
          >
            {#each cornerHandles({ x: 0, y: 0, width: textChrome.width, height: textChrome.height }) as h (h.handle)}
              <div
                class="handle-html {h.handle}"
                role="button"
                tabindex="-1"
                style="left:{h.x - HANDLE_R / 2}px;top:{h.y - HANDLE_R / 2}px;width:{HANDLE_R}px;height:{HANDLE_R}px"
                onpointerdown={(e) => onHandlePointerDown(e, h.handle)}
                onpointermove={onPointerMove}
                onpointerup={onPointerUp}
              ></div>
            {/each}
            <button
              class="el-delete"
              title={t.editor.deleteHint}
              onpointerdown={(e) => e.stopPropagation()}
              onclick={() => {
                const id = textChrome.id;
                remove(id);
                purgeTextHeight(id);
                endTextEdit();
                select(null);
              }}
            >
              <X size={10} strokeWidth={2.5} />
            </button>
          </div>
        {/if}

        {#if handles.length > 0 && !textChrome}
          {#each handles as h (h.handle)}
            <div
              class="handle-html {h.handle}"
              role="button"
              tabindex="-1"
              style="left:{h.x - HANDLE_R / 2}px;top:{h.y - HANDLE_R / 2}px;width:{HANDLE_R}px;height:{HANDLE_R}px"
              onpointerdown={(e) => onHandlePointerDown(e, h.handle)}
              onpointermove={onPointerMove}
              onpointerup={onPointerUp}
            ></div>
          {/each}
        {/if}

        {#if $tool === "eraser" && eraserBadge}
          <svg
            class="eraser-badge"
            style="left:{eraserBadge.x - 10}px;top:{eraserBadge.y - 10}px"
            width="20"
            height="20"
            viewBox="0 0 20 20"
            aria-hidden="true"
          >
            <path d="M17.6,10.2 L13.6,3.3 L2.4,9.8 L6.4,16.7 Z" fill="#f8fafc" stroke="#cbd5e1" stroke-width="1" />
            <path d="M17.6,10.2 L13.6,3.3 L9.1,5.9 L13.1,12.8 Z" fill="#f472b6" />
          </svg>
        {/if}
        <!-- Selection delete affordance: click to remove the selected marker -->
        {#if chromeBox && selected && selected.kind !== "text" && !isCompactInk(selected)}
          {@const del = deleteButtonPosition(chromeBox, { w: canvasW, h: canvasH })}
          <button
            class="el-delete"
            style="left:{del.left}px;top:{del.top}px"
            title={t.editor.deleteHint}
            onpointerdown={(e) => e.stopPropagation()}
            onclick={() => {
              if (selected) {
                const id = selected.id;
                remove(id);
                purgeTextHeight(id);
                select(null);
              }
            }}
          >
            <X size={10} strokeWidth={2.5} />
          </button>
        {/if}
      </div>
    {/if}
  </div>

  <!-- Toast Notification Popup -->
  {#if toast}
    <Toast message={toast.message} kind={toast.kind} onexpire={() => (toast = null)} />
  {/if}

  <!-- Sleek Fully Responsive & Collapsible Floating Toolbar -->
  <EditorToolbar
    tool={$tool}
    color={$color}
    strokeSize={$strokeSize}
    canUndo={$canUndo}
    canRedo={$canRedo}
    collapsed={isCollapsed}
    showColors={showColors}
    showSizes={showSizes}
    sizeControl={sizeControl}
    sizeTool={sizeTool}
    onselect={useTool}
    onpickcolor={(c) => { pickColor(c); showColors = false; }}
    onpicksize={(n) => { pickSize(n); showSizes = false; }}
    onundo={undo}
    onredo={redo}
    ontogglecolors={() => { showColors = !showColors; showSizes = false; }}
    ontogglesizes={() => { showSizes = !showSizes; showColors = false; }}
    ontogglecollapsed={(v) => { isCollapsed = v; showColors = false; showSizes = false; }}
  />

  <!-- Magnifying Eyedropper Loupe -->
  <EyedropperLoupe
    x={loupeClientPos.x}
    y={loupeClientPos.y}
    visible={loupeVisible && $tool === "eyedropper"}
    colorHex={loupeColorHex}
    pixels={loupePixels}
  />
</main>

<style>
  :global(html),
  :global(body) {
    margin: 0;
    padding: 0;
    background: #0b0c10;
    overflow: hidden;
    width: 100vw;
    height: 100vh;
  }

  .editor-layout {
    position: relative;
    display: flex;
    flex-direction: column;
    width: 100vw;
    height: 100vh;
    background: #0b0c10;
    overflow: hidden;
  }

  .editor-header {
    height: 44px;
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 0 14px;
    background: rgba(18, 20, 29, 0.85);
    backdrop-filter: blur(14px);
    border-bottom: 1px solid rgba(255, 255, 255, 0.08);
    z-index: 20;
    flex-shrink: 0;
  }

  .brand {
    display: flex;
    align-items: center;
    gap: 8px;
  }

  .app-logo {
    width: 22px;
    height: 22px;
    border-radius: 5px;
    object-fit: contain;
    filter: drop-shadow(0 2px 6px rgba(0, 0, 0, 0.4));
  }

  .title {
    font-size: 13px;
    font-weight: 600;
    color: #f8fafc;
  }

  .dimensions {
    font-family: var(--font-mono, monospace);
    font-size: 11px;
    color: #94a3b8;
    background: rgba(255, 255, 255, 0.06);
    padding: 2px 6px;
    border-radius: 4px;
  }

  .header-actions {
    display: flex;
    align-items: center;
    gap: 6px;
  }

  .icon-btn {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 28px;
    height: 28px;
    border-radius: 6px;
    background: transparent;
    color: #94a3b8;
  }

  .icon-btn:hover {
    background: rgba(255, 255, 255, 0.1);
    color: #ffffff;
  }

  .canvas-viewport {
    flex: 1;
    display: flex;
    flex-direction: column;
    align-items: center;
    overflow: auto;
    padding: 32px 32px 140px 32px;
    background: radial-gradient(circle at center, #151722 0%, #0b0c10 100%);
  }

  .canvas-container {
    position: relative;
    margin: 0 auto;
    box-shadow: 0 16px 40px rgba(0, 0, 0, 0.7), 0 0 0 1px rgba(255, 255, 255, 0.1);
    border-radius: 4px;
    overflow: hidden;
    flex-shrink: 0;
  }

  .canvas {
    display: block;
    touch-action: none;
  }

  .step-digit {
    line-height: 1;
    font-variant-numeric: lining-nums tabular-nums;
  }

  .canvas.tool-select { cursor: default; }
  .canvas.tool-eraser { cursor: none; }
  .canvas:not(.tool-select):not(.tool-eraser) { cursor: crosshair; }

  .selection-box {
    stroke: #6366f1;
    stroke-width: 1.5;
    fill: none;
    stroke-dasharray: 4 4;
    pointer-events: none;
  }

  .text-chrome {
    position: absolute;
    pointer-events: none;
    z-index: 14;
    outline: 1.5px dashed #6366f1;
    outline-offset: 0;
  }

  .text-chrome .el-delete {
    left: 50%;
    top: 0;
    transform: translate(-50%, -50%);
  }

  .handle-html {
    position: absolute;
    background: #6366f1;
    border: 1.5px solid #ffffff;
    border-radius: 2px;
    pointer-events: auto;
    touch-action: none;
    z-index: 15;
    box-shadow: 0 1px 4px rgba(0, 0, 0, 0.4);
    cursor: nwse-resize;
  }

  .handle-html.ne,
  .handle-html.sw {
    cursor: nesw-resize;
  }

  .el-delete {
    position: absolute;
    width: 18px;
    height: 18px;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    border-radius: 50%;
    background: #ef4444;
    color: #ffffff;
    border: 1.5px solid #ffffff;
    box-shadow: 0 2px 8px rgba(0, 0, 0, 0.5);
    z-index: 26;
    cursor: pointer;
    padding: 0;
  }

  .el-delete:hover {
    background: #dc2626;
  }

  .eraser-badge {
    position: absolute;
    pointer-events: none;
    z-index: 30;
    filter: drop-shadow(0 1px 2px rgba(0, 0, 0, 0.5));
  }

  /* Header-only button styles. The floating toolbar's full style set lives
   * in EditorToolbar.svelte; these copies stay scoped for the header row
   * (shared .tb-btn look, no global leakage). */
  .v-divider {
    width: 1px;
    height: 16px;
    background: rgba(255, 255, 255, 0.15);
    margin: 0 2px;
    flex-shrink: 0;
  }

  .tb-btn {
    width: 28px;
    height: 28px;
    padding: 0;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    border-radius: 6px;
    background: transparent;
    color: #cbd5e1;
    font-size: 12px;
    font-weight: 600;
    flex-shrink: 0;
  }

  .tb-btn:hover {
    background: rgba(255, 255, 255, 0.12);
    color: #ffffff;
  }

  .tb-btn.accent {
    background: rgba(255, 255, 255, 0.06);
    border: 1px solid rgba(255, 255, 255, 0.1);
  }
  .tb-btn.accent:hover {
    background: rgba(255, 255, 255, 0.15);
  }

  .tb-btn.primary {
    width: auto;
    padding: 0 12px;
    display: inline-flex;
    align-items: center;
    gap: 6px;
    background: var(--accent-gradient, linear-gradient(135deg, #6366f1, #a855f7));
    color: #ffffff;
    box-shadow: 0 4px 12px rgba(99, 102, 241, 0.35);
  }

  .tb-btn.primary:hover {
    filter: brightness(1.1);
  }
</style>
