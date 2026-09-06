import { describe, expect, it } from "vitest";
import { bbox, createElement } from "$lib/editor/elements";

describe("text handles", () => {
  it("text bbox grows with width", () => {
    const el = createElement("text", { x: 10, y: 10 }, "#000", 18) as any;
    el.text = "hello world hello world";
    el.width = 50;
    expect(bbox(el).width).toBe(50);
  });
});
