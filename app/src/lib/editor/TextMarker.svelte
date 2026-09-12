<script lang="ts">
  import { tick } from "svelte";
  import {
    TEXT_FONT_FAMILY,
    TEXT_FONT_WEIGHT,
    TEXT_LINE_HEIGHT,
    type TextElement,
  } from "./elements";

  let {
    element,
    editing,
    oninputtext,
    oncommit,
    onresizeheight,
    onMeasure,
  }: {
    element: TextElement;
    editing: boolean;
    oninputtext: (text: string) => void;
    oncommit: () => void;
    onresizeheight?: (h: number) => void;
    onMeasure?: (dims: { width: number; height: number }) => void;
  } = $props();

  let root = $state<HTMLDivElement | undefined>(undefined);

  function reportMeasure(node: HTMLDivElement) {
    const h = Math.max(element.size, node.scrollHeight);
    const w = Math.ceil(node.scrollWidth);
    // Collapse dual measure: prefer unified onMeasure (width+height) to avoid
    // double-write of height. Keep onresizeheight as fallback for compat.
    if (onMeasure) onMeasure({ width: w, height: h });
    else onresizeheight?.(h);
  }

  function syncText(node: HTMLDivElement, text: string) {
    if (document.activeElement !== node && node.textContent !== text) {
      node.textContent = text;
    }
    reportMeasure(node);
    return {
      update(next: string) {
        if (document.activeElement !== node && node.textContent !== next) {
          node.textContent = next;
        }
        reportMeasure(node);
      },
    };
  }

  $effect(() => {
    if (!editing) return;
    const el = root;
    let cancelled = false;

    const focusCaret = () => {
      if (cancelled || !el) return;
      el.focus();
      const range = document.createRange();
      range.selectNodeContents(el);
      range.collapse(false);
      const sel = window.getSelection();
      sel?.removeAllRanges();
      sel?.addRange(range);
    };

    void tick().then(() => {
      if (cancelled || !el) return;
      focusCaret();
      if (typeof requestAnimationFrame === "function") {
        requestAnimationFrame(() => {
          if (!cancelled && el && document.activeElement !== el) {
            focusCaret();
          }
        });
      }
    });
    return () => {
      cancelled = true;
    };
  });

  function onPointerDown(e: PointerEvent) {
    // Keep interior drags (caret move, word/sentence selection) inside the
    // contenteditable so the canvas does not hijack them as element moves.
    e.stopPropagation();
  }

  function onInput() {
    if (!root) return;
    oninputtext(root.innerText.replace(/\r/g, ""));
    reportMeasure(root);
  }

  $effect(() => {
    // Re-measure when width/size change (e/se drag) so FO size updates.
    void element.width;
    void element.size;
    const el = root;
    if (!el) return;
    void tick().then(() => {
      if (root) reportMeasure(root);
    });
  });

  function onKeyDown(e: KeyboardEvent) {
    if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      oncommit();
    }
  }
</script>

<div
  bind:this={root}
  use:syncText={element.text}
  xmlns="http://www.w3.org/1999/xhtml"
  data-el-id={element.id}
  class="text-marker"
  class:editing
  contenteditable={editing ? "plaintext-only" : "false"}
  style="color:{element.color};font:{TEXT_FONT_WEIGHT} {element.size}px {TEXT_FONT_FAMILY};line-height:{TEXT_LINE_HEIGHT};pointer-events:{editing
    ? 'auto'
    : 'none'};"
  role="textbox"
  tabindex={editing ? 0 : -1}
  onpointerdown={onPointerDown}
  oninput={onInput}
  onkeydown={onKeyDown}
></div>

<style>
  .text-marker {
    margin: 0;
    padding: 6px 10px;
    width: 100%;
    min-height: 1em;
    background: transparent;
    white-space: pre-wrap;
    overflow-wrap: break-word;
    outline: none;
    box-sizing: border-box;
  }

  .text-marker.editing {
    background: transparent;
    caret-color: currentColor;
    padding: 6px 10px;
    cursor: text;
  }

  .text-marker.editing:empty::before {
    content: "Type…";
    color: rgba(148, 163, 184, 0.9);
    pointer-events: none;
  }
</style>
