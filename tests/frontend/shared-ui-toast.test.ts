// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { showToast } from "../../assets/ts/shared/ui";

let area: HTMLDivElement | null = null;

beforeEach(() => {
  vi.useFakeTimers();
  area = document.createElement("div");
  area.id = "portal-toast-area";
  document.body.append(area);
});

afterEach(() => {
  vi.useRealTimers();
  area?.remove();
  area = null;
});

function toasts(): HTMLElement[] {
  return [...document.querySelectorAll<HTMLElement>(".my-toast")];
}

describe("showToast", () => {
  it("announces the message politely rather than by colour alone", () => {
    showToast("portal-toast-area", "Passkey added", "success");

    const [toast] = toasts();
    expect(toast).toBeDefined();
    // The outcome has to reach a reader who never sees the tone: the element
    // is a live region, so the words are announced on their own.
    expect(toast.getAttribute("role")).toBe("status");
    expect(toast.textContent).toBe("Passkey added");
    // The tone dot is decoration and must not be read out beside the message.
    const dot = toast.querySelector(".pk-toast__dot");
    expect(dot?.getAttribute("aria-hidden")).toBe("true");
    expect(dot?.textContent).toBe("");
  });

  it("carries every tone as a design-system modifier and no Bootstrap class", () => {
    showToast("portal-toast-area", "Saved", "success");
    showToast("portal-toast-area", "Could not save", "error");
    showToast("portal-toast-area", "Working", "info");

    expect(toasts().map((toast) => toast.className)).toEqual([
      "my-toast pk pk-toast pk-toast--ok",
      "my-toast pk pk-toast pk-toast--danger",
      "my-toast pk pk-toast pk-toast--info",
    ]);
    for (const toast of toasts()) {
      expect(toast.className).not.toMatch(/\balert(-[a-z]+)?\b/);
    }
  });

  it("defaults to the informational tone when the caller does not pick one", () => {
    showToast("portal-toast-area", "Heads up");

    expect(toasts()[0].className).toContain("pk-toast--info");
  });

  it("retires the toast once its dwell time has passed", () => {
    showToast("portal-toast-area", "Passkey removed", "success");
    expect(toasts()).toHaveLength(1);

    vi.advanceTimersByTime(5000);

    expect(toasts()).toHaveLength(0);
  });

  it("does nothing when the target container is absent instead of throwing", () => {
    // The failure path: a caller naming a container this page does not render
    // must not take the surrounding flow down with it.
    expect(() => {
      showToast("no-such-container", "Passkey added", "success");
    }).not.toThrow();
    expect(toasts()).toHaveLength(0);
  });

  it("does not interpret the message as markup", () => {
    showToast("portal-toast-area", "<img src=x onerror=alert(1)>", "error");

    const [toast] = toasts();
    expect(toast.querySelector("img")).toBeNull();
    expect(toast.textContent).toBe("<img src=x onerror=alert(1)>");
  });
});
