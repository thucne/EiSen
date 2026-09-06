import { describe, expect, it, vi } from "vitest";
import {
  buildLoupeGrid,
  getSamplingCanvas,
  loupeSourceRect,
  prepareSamplingCanvas,
  resetSamplingCanvasCache,
  type PixelBlock,
  type SamplingTarget,
} from "./loupe";

type RGBA = readonly [number, number, number, number];

function block(w: number, h: number, fill: RGBA): PixelBlock {
  const data = new Uint8ClampedArray(w * h * 4);
  for (let i = 0; i < w * h; i++) {
    data[i * 4] = fill[0];
    data[i * 4 + 1] = fill[1];
    data[i * 4 + 2] = fill[2];
    data[i * 4 + 3] = fill[3];
  }
  return { data, width: w, height: h };
}

const RED: RGBA = [255, 0, 0, 255];

describe("Editor Loupe Plan 023", () => {
  it("samples the center pixel of a uniform canvas into every grid cell", () => {
    const blk = block(11, 11, RED);
    const grid = buildLoupeGrid(blk, 16, 16, 5, 32, 32);
    expect(grid.length).toBe(11);
    expect(grid.every((row) => row.length === 11)).toBe(true);
    expect(grid[5][5]).toBe("#FF0000");
    expect(grid.flat().every((cell) => cell === "#FF0000")).toBe(true);
  });

  it("clamps at the top-left corner and keeps outside cells black", () => {
    const blk = block(6, 6, RED);
    const grid = buildLoupeGrid(blk, 0, 0, 5, 32, 32);
    expect(grid.length).toBe(11);
    expect(grid.every((row) => row.length === 11)).toBe(true);
    for (let row = 0; row < 11; row++) {
      for (let col = 0; col < 11; col++) {
        if (col < 5 || row < 5) {
          expect(grid[row][col]).toBe("#000000");
        } else {
          expect(grid[row][col]).toBe("#FF0000");
        }
      }
    }
  });

  it("returns an all-black grid when the cursor is fully out of bounds", () => {
    const blk = block(1, 1, RED);
    const grid = buildLoupeGrid(blk, -10, -10, 5, 32, 32);
    expect(grid.length).toBe(11);
    expect(grid.every((row) => row.length === 11)).toBe(true);
    expect(grid.flat().every((cell) => cell === "#000000")).toBe(true);
  });

  it("maps block indices back to distinct canvas pixels on a mixed fixture", () => {
    const blk = block(3, 3, [0, 0, 7, 255]);
    for (let y = 0; y < 3; y++) {
      for (let x = 0; x < 3; x++) {
        const i = (y * 3 + x) * 4;
        blk.data[i] = x * 30;
        blk.data[i + 1] = y * 30;
        blk.data[i + 2] = 7;
      }
    }
    const grid = buildLoupeGrid(blk, 10, 10, 1, 20, 20);
    expect(grid.length).toBe(3);
    expect(grid.every((row) => row.length === 3)).toBe(true);
    expect(grid[0][0]).toBe("#000007");
    expect(grid[0][2]).toBe("#3C0007");
    expect(grid[2][0]).toBe("#003C07");
    expect(grid[1][1]).toBe("#1E1E07");
    expect(grid[2][2]).toBe("#3C3C07");
  });

  it("falls back to an all-black grid when the image data is null", () => {
    const grid = buildLoupeGrid(null, 16, 16, 5, 32, 32);
    expect(grid.length).toBe(11);
    expect(grid.every((row) => row.length === 11)).toBe(true);
    expect(grid.flat().every((cell) => cell === "#000000")).toBe(true);
  });
});

describe("loupeSourceRect", () => {
  it("returns the full unclamped block for an interior point", () => {
    expect(loupeSourceRect(16, 16, 5, 32, 32)).toEqual({
      sx: 11,
      sy: 11,
      sw: 11,
      sh: 11,
    });
  });

  it("clamps at the top-left corner", () => {
    expect(loupeSourceRect(0, 0, 5, 32, 32)).toEqual({
      sx: 0,
      sy: 0,
      sw: 6,
      sh: 6,
    });
  });

  it("clamps at the bottom-right corner", () => {
    expect(loupeSourceRect(31, 31, 5, 32, 32)).toEqual({
      sx: 26,
      sy: 26,
      sw: 6,
      sh: 6,
    });
  });

  it("yields a non-positive size when fully outside the canvas", () => {
    expect(loupeSourceRect(-10, -10, 5, 32, 32).sw).toBeLessThanOrEqual(0);
    expect(loupeSourceRect(-10, -10, 5, 32, 32).sh).toBeLessThanOrEqual(0);
    const beyond = loupeSourceRect(40, 40, 5, 32, 32);
    expect(beyond.sw).toBeLessThanOrEqual(0);
    expect(beyond.sh).toBeLessThanOrEqual(0);
  });

  it("clamps independently per axis", () => {
    expect(loupeSourceRect(2, 30, 5, 32, 32)).toEqual({
      sx: 0,
      sy: 25,
      sw: 8,
      sh: 7,
    });
  });
});

describe("prepareSamplingCanvas guards", () => {
  it("resolves null when no DOM is available (node environment)", async () => {
    await expect(prepareSamplingCanvas("asset:///tmp/a.png", 10, 10)).resolves.toBe(null);
  });

  it("resolves null for invalid dimensions before touching the DOM", async () => {
    await expect(prepareSamplingCanvas("", 10, 10)).resolves.toBe(null);
  });
});

describe("getSamplingCanvas", () => {
  function fakeTarget(id: string): SamplingTarget {
    return { canvas: { id } as unknown as HTMLCanvasElement, ctx: null };
  }

  it("does not decode until requested", async () => {
    resetSamplingCanvasCache();
    const prepare = vi.fn(async () => fakeTarget("a"));
    expect(prepare).not.toHaveBeenCalled();
    await getSamplingCanvas("src-a", 1, 1, prepare);
    expect(prepare).toHaveBeenCalledTimes(1);
  });

  it("memoizes the canvas for the same source", async () => {
    resetSamplingCanvasCache();
    const prepare = vi.fn(async () => fakeTarget("a"));
    const first = await getSamplingCanvas("src-a", 1, 1, prepare);
    const second = await getSamplingCanvas("src-a", 1, 1, prepare);
    expect(first).not.toBe(null);
    expect(second?.canvas).toBe(first?.canvas);
    expect(prepare).toHaveBeenCalledTimes(1);
  });

  it("invalidates the cache when the source changes", async () => {
    resetSamplingCanvasCache();
    const prepare = vi
      .fn()
      .mockResolvedValueOnce(fakeTarget("a"))
      .mockResolvedValueOnce(fakeTarget("b"));
    const first = await getSamplingCanvas("src-a", 1, 1, prepare);
    const second = await getSamplingCanvas("src-b", 1, 1, prepare);
    expect(first).not.toBe(null);
    expect(second).not.toBe(null);
    expect(second?.canvas).not.toBe(first?.canvas);
    expect(prepare).toHaveBeenCalledTimes(2);
  });
});
