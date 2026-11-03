import { describe, expect, it } from "vitest";
import { HINT_CAPTURES, takeHintShowing } from "./hintBudget";

function memoryStorage(initial: string | null = null) {
  let value = initial;
  return {
    getItem: () => value,
    setItem: (_key: string, next: string) => {
      value = next;
    },
  };
}

describe("takeHintShowing", () => {
  it("shows the hint for the first captures only", () => {
    const storage = memoryStorage();
    for (let i = 0; i < HINT_CAPTURES; i++) expect(takeHintShowing(storage)).toBe(true);
    expect(takeHintShowing(storage)).toBe(false);
  });

  it("starts over from a corrupt count", () => {
    expect(takeHintShowing(memoryStorage("not a number"))).toBe(true);
  });

  it("keeps showing without working storage", () => {
    const broken = {
      getItem: () => {
        throw new Error("blocked");
      },
      setItem: () => {},
    };
    expect(takeHintShowing(broken)).toBe(true);
    expect(takeHintShowing(null)).toBe(true);
  });
});
