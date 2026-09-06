<script lang="ts">
  import { i18n } from "$lib/i18n";

  interface Props {
    x: number;
    y: number;
    visible: boolean;
    colorHex: string;
    pixels: string[][]; // 2D grid of hex/rgb strings (e.g. 11x11)
    viewportWidth?: number;
    viewportHeight?: number;
  }

  let {
    x = 0,
    y = 0,
    visible = false,
    colorHex = "#000000",
    pixels = [],
    viewportWidth = 1920,
    viewportHeight = 1080,
  }: Props = $props();

  const LOUPE_SIZE = 136;
  const OFFSET = 24;

  // Compute position offset from cursor so it doesn't get obscured by the mouse pointer
  const loupePos = $derived.by(() => {
    let lx = x + OFFSET;
    let ly = y + OFFSET;

    // Flip to top-left if colliding with right/bottom screen boundary
    if (lx + LOUPE_SIZE > viewportWidth - 10) {
      lx = x - LOUPE_SIZE - OFFSET;
    }
    if (ly + LOUPE_SIZE + 32 > viewportHeight - 10) {
      ly = y - LOUPE_SIZE - OFFSET;
    }

    return {
      x: Math.max(10, lx),
      y: Math.max(10, ly),
    };
  });

  const gridSize = $derived(pixels.length);
  const centerIdx = $derived(Math.floor(gridSize / 2));
  const t = $derived($i18n);
</script>

{#if visible && pixels.length > 0}
  <div
    class="eyedropper-loupe-container animate-fade-in"
    style="left: {loupePos.x}px; top: {loupePos.y}px;"
  >
    <!-- Circular Magnifier Ring -->
    <div class="loupe-circle" style="width: {LOUPE_SIZE}px; height: {LOUPE_SIZE}px;">
      <div
        class="pixel-grid"
        style="grid-template-columns: repeat({gridSize}, 1fr); grid-template-rows: repeat({gridSize}, 1fr);"
      >
        {#each pixels as row, rIndex}
          {#each row as pxColor, cIndex}
            <div
              class="pixel-cell {rIndex === centerIdx && cIndex === centerIdx ? 'center-cell' : ''}"
              style="background-color: {pxColor};"
            ></div>
          {/each}
        {/each}
      </div>

      <!-- Center Crosshair Target -->
      <div class="crosshair-target"></div>
    </div>

    <!-- Hex Label Pill -->
    <div class="color-badge">
      <span class="color-swatch" style="background-color: {colorHex};"></span>
      <span class="color-hex">{colorHex}</span>
      <span class="shortcut-tip">{t.eyedropper.clickHint}</span>
    </div>
  </div>
{/if}

<style>
  .eyedropper-loupe-container {
    position: fixed;
    z-index: 9999;
    pointer-events: none;
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 8px;
    user-select: none;
  }

  .loupe-circle {
    position: relative;
    border-radius: 50%;
    overflow: hidden;
    box-shadow:
      0 0 0 3px rgba(255, 255, 255, 0.85),
      0 0 0 4px rgba(0, 0, 0, 0.4),
      0 12px 32px rgba(0, 0, 0, 0.6);
    background: #1e1e2e;
    display: flex;
    align-items: center;
    justify-content: center;
  }

  .pixel-grid {
    width: 100%;
    height: 100%;
    display: grid;
  }

  .pixel-cell {
    width: 100%;
    height: 100%;
    box-sizing: border-box;
    border: 0.5px solid rgba(255, 255, 255, 0.05);
  }

  .pixel-cell.center-cell {
    border: 1px solid rgba(255, 255, 255, 0.6);
  }

  .crosshair-target {
    position: absolute;
    top: 50%;
    left: 50%;
    transform: translate(-50%, -50%);
    width: 14px;
    height: 14px;
    border: 1.5px solid #ffffff;
    box-shadow: 0 0 2px rgba(0, 0, 0, 0.9), inset 0 0 2px rgba(0, 0, 0, 0.9);
    border-radius: 2px;
    pointer-events: none;
  }

  .color-badge {
    display: flex;
    align-items: center;
    gap: 6px;
    background: rgba(18, 20, 29, 0.92);
    backdrop-filter: blur(12px);
    border: 1px solid rgba(255, 255, 255, 0.2);
    border-radius: 9999px;
    padding: 3px 10px;
    box-shadow: 0 6px 16px rgba(0, 0, 0, 0.4);
    font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
    font-size: 11px;
    color: #ffffff;
    font-weight: 600;
  }

  .color-swatch {
    width: 10px;
    height: 10px;
    border-radius: 50%;
    border: 1px solid rgba(255, 255, 255, 0.4);
  }

  .color-hex {
    letter-spacing: 0.5px;
  }

  .shortcut-tip {
    font-size: 9px;
    color: #94a3b8;
    background: rgba(255, 255, 255, 0.1);
    padding: 1px 5px;
    border-radius: 4px;
    margin-left: 2px;
    font-family: system-ui, sans-serif;
  }

  .animate-fade-in {
    animation: fadeIn 0.1s ease-out;
  }

  @keyframes fadeIn {
    from {
      opacity: 0;
      transform: scale(0.95);
    }
    to {
      opacity: 1;
      transform: scale(1);
    }
  }
</style>
