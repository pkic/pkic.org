// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
// @ts-expect-error Vite's raw-loader suffix is available to frontend tests.
import navbarSource from "../../assets/js/navbar.js?raw";

describe("navbar mega-menu state", () => {
  afterEach(() => {
    document.body.innerHTML = "";
    vi.resetModules();
  });

  it("clears the previous panel state before opening another panel and when closing", async () => {
    document.body.innerHTML = `
      <div id="pkicMegaBackdrop"></div>
      <div class="pkic-mega-trigger" id="first-trigger">
        <a class="nav-link"></a>
        <button class="pkic-mega-chevron" data-mega-target="first-panel" aria-expanded="false"></button>
      </div>
      <div class="pkic-mega-trigger" id="second-trigger">
        <a class="nav-link"></a>
        <button class="pkic-mega-chevron" data-mega-target="second-panel" aria-expanded="false"></button>
      </div>
      <div class="pkic-mega-panel" id="first-panel"></div>
      <div class="pkic-mega-panel" id="second-panel"></div>
    `;

    const moduleUrl = `data:text/javascript;charset=utf-8,${encodeURIComponent(navbarSource)}`;
    await import(/* @vite-ignore */ moduleUrl);

    document.querySelector<HTMLElement>("#first-trigger")?.dispatchEvent(new MouseEvent("mouseenter"));
    expect(document.querySelector("#first-panel")?.classList.contains("is-open")).toBe(true);

    document.querySelector<HTMLElement>("#second-trigger")?.dispatchEvent(new MouseEvent("mouseenter"));
    expect(document.querySelector("#first-panel")?.classList.contains("is-open")).toBe(false);
    expect(document.querySelector("#second-panel")?.classList.contains("is-open")).toBe(true);

    document.querySelector<HTMLElement>("#pkicMegaBackdrop")?.click();
    expect(document.querySelector("#second-panel")?.classList.contains("is-open")).toBe(false);
    expect(document.querySelector("#pkicMegaBackdrop")?.classList.contains("is-open")).toBe(false);
  });
});
