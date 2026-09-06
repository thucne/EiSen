import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { get } from "svelte/store";
import { beforeEach, describe, expect, it } from "vitest";
import { en } from "./i18n/en";
import { vi } from "./i18n/vi";
import { i18n, lang, setLang, uiLangFromConfig } from "./i18n";
import type { Tool } from "./editor/elements";

function keys(dict: object): string[] {
  return Object.keys(dict).sort();
}

function allKeys(dict: object): string[] {
  return Object.entries(dict).flatMap(([k, v]) =>
    typeof v === "object" && v !== null ? allKeys(v as object).map((s) => `${k}.${s}`) : [k],
  );
}

function svelteFilesUnder(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return svelteFilesUnder(path);
    return entry.name.endsWith(".svelte") ? [path] : [];
  });
}

beforeEach(() => {
  setLang("en");
});

describe("dictionaries", () => {
  it("en and vi expose the same key set", () => {
    expect(allKeys(en)).toEqual(allKeys(vi));
  });

  it("cover the required sections", () => {
    expect(keys(en.tools)).toContain("select");
    expect(keys(en.actions)).toContain("copyAndSave");
    expect(keys(en.toasts)).toContain("copied");
    expect(keys(en.settings)).toContain("launchAtLogin");
  });

  it("list every hotkey preset variant", () => {
    expect(keys(en.hotkeyNames).sort()).toEqual([
      "CmdShift4Mac",
      "CtrlShift4Mac",
      "DoubleOption",
      "DoubleShift",
      "PrtScMac",
      "PrtScnWin",
    ]);
  });

  it("route files contain no hardcoded feature-toast literals", () => {
    const editorSrc = readFileSync(
      new URL("../routes/editor/+page.svelte", import.meta.url),
      "utf8",
    );
    const banned = [
      /"No text detected/,
      /"Text copied to clipboard/,
      /`OCR error:/,
      /Copied \$\{loupeColorHex\}/,
    ];
    for (const re of banned) {
      expect(re.test(editorSrc)).toBe(false);
    }
  });

  it("labels every Tool variant", () => {
    const labels: Record<Tool, string> = en.tools;
    expect(Object.keys(labels).sort()).toEqual(
      [
        "arrow",
        "blur",
        "ellipse",
        "eraser",
        "eyedropper",
        "highlight",
        "pen",
        "penArrow",
        "rectangle",
        "select",
        "step",
        "text",
      ].sort(),
    );
  });

  it("bans hardcoded multi-word English title attributes in routes", () => {
    const routesDir = join(dirname(fileURLToPath(import.meta.url)), "../routes");
    const allowed = [/^#[0-9A-Fa-f]{3,8}$/, /^\d+px$/, /^\{n\}px$/];
    const titleAttr = /(?:title|data-tip|aria-label)="([^"]+)"/g;
    const offenders: string[] = [];
    for (const file of svelteFilesUnder(routesDir)) {
      const src = readFileSync(file, "utf8");
      for (const match of src.matchAll(titleAttr)) {
        const value = match[1];
        if (allowed.some((re) => re.test(value))) continue;
        if (/[A-Za-z]+ [A-Za-z]+/.test(value)) {
          offenders.push(`${file}: ${match[0]}`);
        }
      }
    }
    expect(offenders).toEqual([]);
  });
});

describe("uiLangFromConfig", () => {
  it("maps serialized config values onto the UI store", () => {
    expect(uiLangFromConfig("Vi")).toBe("vi");
    expect(uiLangFromConfig("vi")).toBe("vi");
    expect(uiLangFromConfig("En")).toBe("en");
    expect(uiLangFromConfig("en")).toBe("en");
    expect(uiLangFromConfig("fr")).toBe("en");
  });
});

describe("lang store", () => {
  it("defaults to English", () => {
    expect(get(lang)).toBe("en");
    expect(get(i18n).actions.copy).toBe("Copy");
  });

  it("switches the active dictionary", () => {
    setLang("vi");
    expect(get(lang)).toBe("vi");
    expect(get(i18n).actions.copy).toBe(vi.actions.copy);
    expect(get(i18n).actions.copy).not.toBe(en.actions.copy);
  });

  it("notifies subscribers when the language changes", () => {
    const seen: string[] = [];
    const un = i18n.subscribe((dict) => seen.push(dict.actions.copy));
    setLang("vi");
    setLang("en");
    un();
    expect(seen).toEqual([en.actions.copy, vi.actions.copy, en.actions.copy]);
  });
});
