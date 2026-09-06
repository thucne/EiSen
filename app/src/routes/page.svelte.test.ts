import { fireEvent, render, screen, waitFor } from "@testing-library/svelte";
import { tick } from "svelte";
import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  invoke: vi.fn(),
  listeners: new Map<string, (e: { payload: unknown }) => void>(),
}));

vi.mock("@tauri-apps/api/core", () => ({
  invoke: h.invoke,
  convertFileSrc: (p: string) => `asset://localhost/${encodeURIComponent(p)}`,
}));
vi.mock("@tauri-apps/api/event", () => ({
  listen: (event: string, cb: (e: { payload: unknown }) => void) => {
    h.listeners.set(event, cb);
    return Promise.resolve(() => h.listeners.delete(event));
  },
}));
vi.mock("$app/navigation", () => ({ goto: vi.fn().mockResolvedValue(undefined) }));

import HubPage from "./+page.svelte";
import { history } from "$lib/history";
import { en } from "$lib/i18n/en";

function configOk(cmd: string): boolean {
  return cmd === "cmd_get_config";
}

beforeEach(() => {
  h.invoke.mockReset();
  h.listeners.clear();
  h.invoke.mockImplementation((cmd: string) =>
    configOk(cmd)
      ? Promise.resolve({ lang: "En", save_dir: "/tmp", launch_at_login: false, hotkey: "DoubleOption" })
      : Promise.resolve(undefined),
  );
  history.set([]);
});

async function cardImageSrc(): Promise<string | null> {
  await waitFor(() => {
    expect(document.querySelectorAll(".history-card").length).toBeGreaterThan(0);
  });
  return document.querySelector(".history-card img")?.getAttribute("src") ?? null;
}

describe("hub history smoke", () => {
  it("renders one card per history entry and reports the count", async () => {
    render(HubPage);
    await tick();
    history.set(["/tmp/a.png", "/tmp/b.png"]);
    await waitFor(() => {
      expect(document.querySelectorAll(".history-card").length).toBe(2);
    });
    expect(screen.getByText(en.hub.itemCount.replace("{n}", "2"))).toBeInTheDocument();
  });
});

describe("hub thumbnails", () => {
  function emitHistory(payload: string[]) {
    h.listeners.get("history")?.({ payload });
  }

  it("renders card images from the cached thumbnail when available", async () => {
    h.invoke.mockImplementation((cmd: string, args?: { path?: string }) =>
      configOk(cmd)
        ? Promise.resolve({ lang: "En", save_dir: "/tmp", launch_at_login: false, hotkey: "DoubleOption" })
        : cmd === "cmd_get_thumbnail"
          ? Promise.resolve(`/thumbs/${args?.path}.thumb.png`)
          : Promise.resolve(undefined),
    );
    render(HubPage);
    await tick();
    emitHistory(["/tmp/a.png"]);
    expect(await cardImageSrc()).toBe(
      `asset://localhost/${encodeURIComponent("/thumbs//tmp/a.png.thumb.png")}`,
    );
  });

  it("renders a styled placeholder when the thumbnail fetch fails", async () => {
    h.invoke.mockImplementation((cmd: string) =>
      configOk(cmd)
        ? Promise.resolve({ lang: "En", save_dir: "/tmp", launch_at_login: false, hotkey: "DoubleOption" })
        : cmd === "cmd_get_thumbnail"
          ? Promise.reject(new Error("path not allowed"))
          : Promise.resolve(undefined),
    );
    render(HubPage);
    await tick();
    emitHistory(["/tmp/a.png"]);
    // Let the rejection settle: the card must show the styled placeholder —
    // never an asset URL pointing at the original save_dir path (outside the
    // webview asset scope, so it could never load).
    await tick();
    await tick();
    const card = document.querySelector(".history-card");
    expect(card?.querySelector(".thumb-placeholder")).toBeInTheDocument();
    expect(card?.querySelector("img")).toBeNull();
    expect(document.body.innerHTML).not.toContain(
      `asset://localhost/${encodeURIComponent("/tmp/a.png")}`,
    );
  });
});

describe("hub card actions", () => {
  function emitHistory(payload: string[]) {
    h.listeners.get("history")?.({ payload });
  }

  async function renderTwoCards() {
    render(HubPage);
    await tick();
    emitHistory(["/tmp/a.png", "/tmp/b.png"]);
    await waitFor(() =>
      expect(document.querySelectorAll(".history-card").length).toBe(2),
    );
  }

  it("trash removes via cmd_remove_history with arg name path", async () => {
    await renderTwoCards();
    fireEvent.click(screen.getAllByRole("button", { name: en.hub.removeFromGallery })[0]);
    await waitFor(() =>
      expect(h.invoke).toHaveBeenCalledWith("cmd_remove_history", {
        path: "/tmp/a.png",
      }),
    );
  });

  it("trash is optimistic and rolls back when the backend rejects", async () => {
    let rejectRemove!: (e: unknown) => void;
    h.invoke.mockImplementation((cmd: string) =>
      cmd === "cmd_remove_history"
        ? new Promise((_resolve, reject) => {
            rejectRemove = reject;
          })
        : configOk(cmd)
          ? Promise.resolve({ lang: "En", save_dir: "/tmp", launch_at_login: false, hotkey: "DoubleOption" })
          : Promise.resolve(undefined),
    );
    await renderTwoCards();
    fireEvent.click(screen.getAllByRole("button", { name: en.hub.removeFromGallery })[0]);
    await tick(); // flush the optimistic store update
    // Optimistic: the card vanishes while the IPC is still pending.
    expect(document.querySelectorAll(".history-card").length).toBe(1);
    // Rollback after rejection: both cards return and an error surfaces.
    rejectRemove(new Error("boom"));
    await waitFor(() =>
      expect(document.querySelectorAll(".history-card").length).toBe(2),
    );
    expect(await screen.findByText(/Could not remove capture/)).toBeInTheDocument();
  });
});

describe("permission banner", () => {
  const CFG = { lang: "En", save_dir: "/tmp", launch_at_login: false, hotkey: "DoubleOption" };

  function mockPermission(result: boolean | "reject") {
    h.invoke.mockImplementation((cmd: string) => {
      if (cmd === "cmd_get_config") return Promise.resolve(CFG);
      if (cmd === "cmd_screen_permission") {
        return result === "reject"
          ? Promise.reject(new Error("probe failed"))
          : Promise.resolve(result);
      }
      return Promise.resolve(undefined);
    });
  }

  it("shows no banner when Screen Recording is granted", async () => {
    mockPermission(true);
    render(HubPage);
    await waitFor(() => {
      expect(h.invoke).toHaveBeenCalledWith("cmd_screen_permission");
    });
    expect(screen.queryByText(en.permission.title)).not.toBeInTheDocument();
  });

  it("shows the banner when Screen Recording is denied", async () => {
    mockPermission(false);
    render(HubPage);
    expect(
      await screen.findByText(en.permission.title),
    ).toBeInTheDocument();
    expect(screen.getByText(en.permission.body)).toBeInTheDocument();
    expect(screen.getByText(en.permission.afterGrant)).toBeInTheDocument();
  });

  it("invokes cmd_open_screen_settings from the CTA", async () => {
    mockPermission(false);
    render(HubPage);
    fireEvent.click(await screen.findByRole("button", { name: en.permission.cta }));
    await waitFor(() => {
      expect(h.invoke).toHaveBeenCalledWith("cmd_open_screen_settings");
    });
  });

  it("shows no banner when the permission probe fails", async () => {
    mockPermission("reject");
    render(HubPage);
    await waitFor(() => {
      expect(h.invoke).toHaveBeenCalledWith("cmd_screen_permission");
    });
    expect(screen.queryByText(en.permission.title)).not.toBeInTheDocument();
  });
});
