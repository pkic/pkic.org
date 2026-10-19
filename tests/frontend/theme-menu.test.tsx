// @vitest-environment jsdom
import { render } from "preact";
import renderToString from "preact-render-to-string";
import { act } from "preact/test-utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ThemeToggle, installThemeToggles } from "../../assets/ts/ui/ThemeToggle";

import { memoryStorage } from "./helpers/browser-storage";

let container: HTMLDivElement;
beforeEach(() => vi.stubGlobal("localStorage", memoryStorage()));
async function click(element: Element | null) {
  expect(element).not.toBeNull();
  await act(async () => (element as HTMLElement).click());
}
afterEach(() => {
  if (container) {
    render(null, container);
    container.remove();
  }
  document.documentElement.removeAttribute("data-theme");
  localStorage.clear();
  vi.unstubAllGlobals();
});

describe("theme appearance menu", () => {
  it("offers recognizable icons, checked choices and persisted light/dark/auto selection", async () => {
    container = document.createElement("div");
    document.body.append(container);
    await act(async () => render(<ThemeToggle />, container));
    const trigger = () => container.querySelector('[aria-haspopup="menu"]');
    for (const [label, value] of [
      ["Dark", "dark"],
      ["Light", "light"],
      ["Auto", null],
    ] as const) {
      await click(trigger());
      const choices = [...container.querySelectorAll('[role="menuitemradio"]')];
      expect(choices.map((choice) => choice.textContent?.replace("✓", "").trim())).toEqual(["Light", "Dark", "Auto"]);
      expect(choices.every((choice) => choice.querySelector("svg"))).toBe(true);
      await click(choices.find((choice) => choice.textContent?.replace("✓", "").trim() === label) ?? null);
      expect(document.documentElement.getAttribute("data-theme")).toBe(value);
      expect(localStorage.getItem("pk-theme")).toBe(value);
      await click(trigger());
      expect(
        [...container.querySelectorAll('[aria-checked="true"]')].map((choice) =>
          choice.textContent?.replace("✓", "").trim(),
        ),
      ).toEqual([label]);
      await act(async () => {
        container
          .querySelector('[role="menu"]')
          ?.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
      });
    }
  });

  it("hydrates the public header once and selects a theme without cycling on open", async () => {
    container = document.createElement("div");
    container.innerHTML = renderToString(<ThemeToggle />);
    document.body.append(container);
    document.documentElement.setAttribute("data-theme", "dark");
    await act(async () => {
      installThemeToggles(container);
      installThemeToggles(container);
    });
    expect(container.querySelector('[aria-haspopup="menu"]')?.getAttribute("aria-label")).toContain("Dark");
    await click(container.querySelector('[aria-haspopup="menu"]'));
    expect(document.documentElement.getAttribute("data-theme")).toBe("dark");
    expect(container.querySelector('[aria-checked="true"]')?.textContent?.replace("✓", "").trim()).toBe("Dark");
    expect(container.querySelectorAll('[role="menu"]').length).toBe(1);
  });
});
