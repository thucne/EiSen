import { describe, expect, it } from "vitest";
import {
  cropFromDrag,
  cropGesture,
  isValidCrop,
  MIN_CROP_SIZE,
  moveCrop,
  resizeCrop,
  storedCrop,
} from "./crop";

const R = { x: 100, y: 100, width: 200, height: 100 };

describe("crop geometry", () => {
  it("normalizes a drag in any direction, in whole points", () => {
    expect(cropFromDrag({ x: 300.4, y: 200.6 }, { x: 100.2, y: 50 }, 800, 600)).toEqual({
      x: 100,
      y: 50,
      width: 200,
      height: 151,
    });
  });

  it("keeps a drag inside the image", () => {
    expect(cropFromDrag({ x: -50, y: -50 }, { x: 900, y: 900 }, 800, 600)).toEqual({
      x: 0,
      y: 0,
      width: 800,
      height: 600,
    });
  });

  it("moves without changing size or leaving the image", () => {
    expect(moveCrop(R, 10, -20, 800, 600)).toEqual({ ...R, x: 110, y: 80 });
    expect(moveCrop(R, 5000, 5000, 800, 600)).toEqual({ ...R, x: 600, y: 500 });
    expect(moveCrop(R, -5000, -5000, 800, 600)).toEqual({ ...R, x: 0, y: 0 });
  });

  it("resizes against the opposite corner", () => {
    expect(resizeCrop(R, "se", { x: 400, y: 300 }, 800, 600)).toEqual({
      x: 100,
      y: 100,
      width: 300,
      height: 200,
    });
    expect(resizeCrop(R, "nw", { x: 50, y: 60 }, 800, 600)).toEqual({
      x: 50,
      y: 60,
      width: 250,
      height: 140,
    });
  });

  it("survives a corner dragged past its anchor", () => {
    expect(resizeCrop(R, "se", { x: 50, y: 50 }, 800, 600)).toEqual({
      x: 50,
      y: 50,
      width: 50,
      height: 50,
    });
  });

  it("rejects crops below the minimum size", () => {
    expect(isValidCrop({ x: 0, y: 0, width: MIN_CROP_SIZE, height: MIN_CROP_SIZE })).toBe(true);
    expect(isValidCrop({ x: 0, y: 0, width: MIN_CROP_SIZE - 1, height: 50 })).toBe(false);
    expect(isValidCrop({ x: 0, y: 0, width: 50, height: MIN_CROP_SIZE - 1 })).toBe(false);
  });

  it("stores a crop covering the whole image as no crop", () => {
    expect(storedCrop({ x: 0, y: 0, width: 800, height: 600 }, 800, 600)).toBe(null);
    expect(storedCrop(R, 800, 600)).toEqual(R);
  });

  it("picks the gesture from where the pointer lands", () => {
    expect(cropGesture(R, { x: 100, y: 100 })).toBe("nw");
    expect(cropGesture(R, { x: 300, y: 200 })).toBe("se");
    expect(cropGesture(R, { x: 200, y: 150 })).toBe("move");
    expect(cropGesture(R, { x: 700, y: 500 })).toBe("draw");
  });
});
