<script lang="ts">
  import {
    ChevronDown,
    ChevronUp,
    Circle,
    Eraser,
    EyeOff,
    Hash,
    Highlighter,
    MousePointer2,
    Pipette,
    Redo2,
    SlidersHorizontal,
    Square,
    Type,
    Undo2,
  } from "@lucide/svelte";
  import type { Tool } from "$lib/editor/elements";
  import { sizeOptionsFor } from "$lib/editor/keyboardShortcuts";
  import { i18n } from "$lib/i18n";

  let {
    tool,
    color,
    strokeSize,
    canUndo,
    canRedo,
    collapsed,
    showColors,
    showSizes,
    sizeControl = true,
    sizeTool,
    onselect,
    onpickcolor,
    onpicksize,
    onundo,
    onredo,
    ontogglecolors,
    ontogglesizes,
    ontogglecollapsed,
  }: {
    tool: Tool;
    color: string;
    strokeSize: number;
    canUndo: boolean;
    canRedo: boolean;
    collapsed: boolean;
    showColors: boolean;
    showSizes: boolean;
    sizeControl?: boolean;
    sizeTool?: Tool;
    onselect: (tool: Tool) => void;
    onpickcolor: (color: string) => void;
    onpicksize: (size: number) => void;
    onundo: () => void;
    onredo: () => void;
    ontogglecolors: () => void;
    ontogglesizes: () => void;
    ontogglecollapsed: (collapsed: boolean) => void;
  } = $props();

  const activeSizeTool = $derived(sizeTool ?? tool);

  const COLORS = [
    "#ef4444", // Red
    "#f97316", // Orange
    "#eab308", // Yellow
    "#10b981", // Emerald
    "#06b6d4", // Cyan
    "#6366f1", // Indigo
    "#a855f7", // Purple
    "#ec4899", // Pink
    "#ffffff", // White
    "#0f172a", // Dark
  ];

  function dotFor(n: number): number {
    return Math.min(16, Math.max(3, 2 + n * 0.5));
  }

  const t = $derived($i18n);

  function tip(label: string) {
    return { "data-tip": label, "aria-label": label };
  }

  /** Smooth 1.5-cycle wave (up, deep trough, up) — same path for Pen / Pen Arrow. */
  const PEN_STROKE = "M1.4 8.6C3.8 2.6 6.4 2.8 7.8 8.4C9.1 13.8 11.5 13.2 13.2 7";
  /** Large filled head at the rising tip, much wider than the stroke. */
  const PEN_ARROW_HEAD = "M13.78 4.88 L15.61 11.81 L8.67 9.91 Z";
</script>

<!-- Sleek Fully Responsive & Collapsible Floating Toolbar -->
{#if collapsed}
  <!-- Minimal Collapsed Pill Bar -->
  <nav class="floating-toolbar collapsed">
    <button
      class="tb-btn primary-trigger"
      {...tip(t.actions.expandToolbar)}
      onclick={() => ontogglecollapsed(false)}
    >
      <SlidersHorizontal size={14} />
    </button>
    <span class="active-dot" style="background: {color}"></span>
    <span class="tool-name">{t.tools[tool]}</span>
  </nav>
{:else}
  <!-- Main Floating Pill Bar -->
  <nav class="floating-toolbar">
    <!-- Interactive Color Popover Bar -->
    {#if showColors}
      <div
        class="popover-bar color-popover"
        role="presentation"
        onpointerdown={(e) => e.stopPropagation()}
      >
        {#each COLORS as c (c)}
          <button
            class="swatch {color === c ? 'active' : ''}"
            style="background:{c}"
            {...tip(c)}
            onclick={() => onpickcolor(c)}
          ></button>
        {/each}
        <input
          type="color"
          class="color-picker"
          value={color}
          oninput={(e) => onpickcolor((e.target as HTMLInputElement).value)}
        />
      </div>
    {/if}

    <!-- Interactive Size Popover Bar -->
    {#if showSizes && sizeControl}
      <div
        class="popover-bar size-popover"
        role="presentation"
        onpointerdown={(e) => e.stopPropagation()}
      >
        {#each sizeOptionsFor(activeSizeTool) as n (n)}
          <button
            class="size-pill {strokeSize === n ? 'active' : ''}"
            {...tip(`${n}px`)}
            onclick={() => onpicksize(n)}
          >
            <span class="dot" style="width:{dotFor(n)}px;height:{dotFor(n)}px"></span>
            <span class="size-val">{n}px</span>
          </button>
        {/each}
      </div>
    {/if}

    <!-- Annotation Tools -->
    <div class="tool-group">
      <button class="tb-btn {tool === 'select' ? 'active' : ''}" {...tip(`${t.tools.select} (V)`)} onclick={() => onselect("select")}><MousePointer2 size={15} /></button>
      <button class="tb-btn {tool === 'step' ? 'active' : ''}" {...tip(`${t.tools.step} (S)`)} onclick={() => onselect("step")}><Hash size={15} /></button>
      <button class="tb-btn {tool === 'rectangle' ? 'active' : ''}" {...tip(`${t.tools.rectangle} (R)`)} onclick={() => onselect("rectangle")}><Square size={15} /></button>
      <button class="tb-btn {tool === 'ellipse' ? 'active' : ''}" {...tip(`${t.tools.ellipse} (E)`)} onclick={() => onselect("ellipse")}><Circle size={15} /></button>
      <button class="tb-btn {tool === 'highlight' ? 'active' : ''}" {...tip(`${t.tools.highlight} (H)`)} onclick={() => onselect("highlight")}><Highlighter size={15} /></button>
      <button class="tb-btn {tool === 'blur' ? 'active' : ''}" {...tip(`${t.tools.blur} (B)`)} onclick={() => onselect("blur")}><EyeOff size={15} /></button>
      <button class="tb-btn {tool === 'arrow' ? 'active' : ''}" {...tip(`${t.tools.arrow} (A)`)} onclick={() => onselect("arrow")}>
        <svg viewBox="0 0 16 16" width="15" height="15" aria-hidden="true">
          <path d="M3 13 L11.2 4.6" fill="none" stroke="currentColor" stroke-width="2.3" stroke-linecap="round" stroke-linejoin="round" />
          <path d="M5.8 3.6 L13.2 2.6 L12.2 10 Z" fill="currentColor" stroke="currentColor" stroke-width="0.5" stroke-linejoin="round" />
        </svg>
      </button>
      <button class="tb-btn {tool === 'text' ? 'active' : ''}" {...tip(`${t.tools.text} (T)`)} onclick={() => onselect("text")}><Type size={15} /></button>
      <button class="tb-btn {tool === 'pen' ? 'active' : ''}" {...tip(`${t.tools.pen} (P)`)} onclick={() => onselect("pen")}>
        <svg viewBox="0 0 16 16" width="15" height="15" overflow="visible" aria-hidden="true">
          <path d={PEN_STROKE} fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" />
        </svg>
      </button>
      <button class="tb-btn {tool === 'penArrow' ? 'active' : ''}" {...tip(`${t.tools.penArrow} (F)`)} onclick={() => onselect("penArrow")}>
        <svg viewBox="0 0 16 16" width="15" height="15" overflow="visible" aria-hidden="true">
          <path d={PEN_STROKE} fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" />
          <path d={PEN_ARROW_HEAD} fill="currentColor" stroke="currentColor" stroke-width="0.4" stroke-linejoin="round" />
        </svg>
      </button>
      <button class="tb-btn {tool === 'eraser' ? 'active' : ''}" {...tip(`${t.tools.eraser} (X)`)} onclick={() => onselect("eraser")}><Eraser size={15} /></button>
    </div>

    <div class="v-divider"></div>

    <button class="tb-btn {tool === 'eyedropper' ? 'active' : ''}" {...tip(`${t.tools.eyedropper} (I)`)} onclick={() => onselect("eyedropper")}><Pipette size={15} /></button>

    <!-- Active Color Popover Trigger -->
    <button
      class="trigger-btn {showColors ? 'active' : ''}"
      {...tip(t.actions.colorPalette)}
      onclick={ontogglecolors}
    >
      <span class="color-badge" style="background: {color}"></span>
      <ChevronUp size={11} />
    </button>

    {#if sizeControl}
    <!-- Active Size Popover Trigger -->
    <button
      class="trigger-btn size-trigger {showSizes ? 'active' : ''}"
      {...tip(`${t.actions.strokeSize} ([ / ])`)}
      onclick={ontogglesizes}
    >
      <span class="size-text">{strokeSize}px</span>
      <ChevronUp size={11} />
    </button>
    {/if}

    <div class="v-divider"></div>

    <!-- Undo / Redo -->
    <div class="tool-group">
      <button class="tb-btn" {...tip(`${t.actions.undo} (Cmd+Z)`)} disabled={!canUndo} onclick={onundo}><Undo2 size={15} /></button>
      <button class="tb-btn" {...tip(`${t.actions.redo} (Cmd+Shift+Z)`)} disabled={!canRedo} onclick={onredo}><Redo2 size={15} /></button>
    </div>

    <div class="v-divider"></div>

    <!-- Collapse Action -->
    <button
      class="tb-btn collapse-btn"
      {...tip(t.actions.collapseToolbar)}
      onclick={() => ontogglecollapsed(true)}
    >
      <ChevronDown size={14} />
    </button>
  </nav>
{/if}

<style>
  @keyframes slideUpCentered {
    from { opacity: 0; transform: translate(-50%, 14px); }
    to { opacity: 1; transform: translate(-50%, 0); }
  }

  /* Floating Toolbar Base (Fixed Centered at Bottom of Window) */
  .floating-toolbar {
    position: fixed;
    bottom: 16px;
    left: 50%;
    transform: translate(-50%, 0);
    animation: slideUpCentered 0.25s cubic-bezier(0.16, 1, 0.3, 1) forwards;
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 4px;
    padding: 6px 12px;
    background: rgba(22, 24, 34, 0.94);
    backdrop-filter: blur(16px);
    -webkit-backdrop-filter: blur(16px);
    border: 1px solid rgba(255, 255, 255, 0.15);
    border-radius: 16px;
    box-shadow: 0 16px 40px rgba(0, 0, 0, 0.7);
    z-index: 100;
    overflow: visible;
    width: fit-content;
    max-width: calc(100vw - 32px);
    box-sizing: border-box;
  }

  .floating-toolbar.collapsed {
    padding: 4px 12px 4px 6px;
    gap: 8px;
  }

  .primary-trigger {
    background: var(--accent-gradient, linear-gradient(135deg, #6366f1, #a855f7)) !important;
    color: #ffffff !important;
  }

  .active-dot {
    width: 10px;
    height: 10px;
    border-radius: 50%;
    box-shadow: 0 0 8px currentColor;
  }

  .tool-name {
    font-size: 11px;
    font-weight: 600;
    text-transform: capitalize;
    color: #e2e8f0;
  }

  /* Popover Floating Cards */
  .popover-bar {
    position: absolute;
    bottom: 54px;
    left: 50%;
    transform: translate(-50%, 0);
    animation: slideUpCentered 0.2s cubic-bezier(0.16, 1, 0.3, 1) forwards;
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 6px 12px;
    background: rgba(18, 20, 29, 0.96);
    backdrop-filter: blur(16px);
    border: 1px solid rgba(255, 255, 255, 0.18);
    border-radius: 12px;
    box-shadow: 0 12px 30px rgba(0, 0, 0, 0.7);
    white-space: nowrap;
    z-index: 110;
    max-width: calc(100vw - 48px);
    box-sizing: border-box;
  }

  .tool-group {
    display: flex;
    align-items: center;
    gap: 2px;
    flex-shrink: 0;
  }

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

  .tb-btn.active {
    background: var(--accent-primary, #6366f1);
    color: #ffffff;
    box-shadow: 0 2px 8px rgba(99, 102, 241, 0.4);
  }

  .collapse-btn {
    color: #94a3b8;
  }
  .collapse-btn:hover {
    color: #ffffff;
  }

  /* Triggers for Popovers */
  .trigger-btn {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    height: 26px;
    padding: 0 6px;
    border-radius: 6px;
    background: rgba(255, 255, 255, 0.06);
    border: 1px solid rgba(255, 255, 255, 0.1);
    color: #94a3b8;
    cursor: pointer;
  }
  .trigger-btn:hover,
  .trigger-btn.active {
    background: rgba(255, 255, 255, 0.14);
    color: #ffffff;
  }

  .color-badge {
    width: 12px;
    height: 12px;
    border-radius: 50%;
    box-shadow: 0 0 4px rgba(0, 0, 0, 0.5);
  }

  .size-text {
    font-family: var(--font-mono, monospace);
    font-size: 10px;
    font-weight: 600;
    color: #cbd5e1;
  }

  .swatch {
    width: 16px;
    height: 16px;
    border-radius: 50%;
    border: 2px solid transparent;
    padding: 0;
    flex-shrink: 0;
  }
  .swatch.active {
    border-color: #ffffff;
    transform: scale(1.2);
  }

  .color-picker {
    width: 18px;
    height: 18px;
    border: none;
    border-radius: 50%;
    background: transparent;
    cursor: pointer;
    padding: 0;
    flex-shrink: 0;
  }

  .size-pill {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    height: 24px;
    padding: 0 8px;
    border-radius: 6px;
    background: transparent;
    color: #cbd5e1;
    font-size: 11px;
  }
  .size-pill:hover,
  .size-pill.active {
    background: rgba(99, 102, 241, 0.3);
    color: #ffffff;
  }

  .size-pill .dot {
    border-radius: 50%;
    background: currentColor;
  }
</style>
