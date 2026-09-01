// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
// @ts-expect-error Vite's raw-loader suffix is available to frontend tests.
import navbarSource from "../../assets/js/navbar.js?raw";
// @ts-expect-error Vite's raw-loader suffix is available to frontend tests.
import navbarTemplate from "../../layouts/partials/navbar.html?raw";

async function loadNavbar(): Promise<void> {
  const moduleUrl = `data:text/javascript;charset=utf-8,${encodeURIComponent(navbarSource)}#${crypto.randomUUID()}`;
  await import(/* @vite-ignore */ moduleUrl);
}

describe("navbar mega-menu state", () => {
  afterEach(() => {
    document.body.innerHTML = "";
    vi.unstubAllGlobals();
    vi.resetModules();
  });

  it("clears the previous panel state before opening another panel and when closing", async () => {
    document.body.innerHTML = `
      <div id="pkicMegaBackdrop"></div>
      <div class="pkic-mega-trigger" id="first-trigger">
        <a class="pkic-nav-link"></a>
        <button class="pkic-mega-chevron" data-mega-target="first-panel" aria-expanded="false"></button>
      </div>
      <div class="pkic-mega-trigger" id="second-trigger">
        <a class="pkic-nav-link"></a>
        <button class="pkic-mega-chevron" data-mega-target="second-panel" aria-expanded="false"></button>
      </div>
      <div class="pkic-mega-panel" id="first-panel"></div>
      <div class="pkic-mega-panel" id="second-panel"></div>
    `;

    await loadNavbar();

    document.querySelector<HTMLElement>("#first-trigger")?.dispatchEvent(new MouseEvent("mouseenter"));
    expect(document.querySelector("#first-panel")?.classList.contains("is-open")).toBe(true);

    document.querySelector<HTMLElement>("#second-trigger")?.dispatchEvent(new MouseEvent("mouseenter"));
    expect(document.querySelector("#first-panel")?.classList.contains("is-open")).toBe(false);
    expect(document.querySelector("#second-panel")?.classList.contains("is-open")).toBe(true);

    document.querySelector<HTMLElement>("#pkicMegaBackdrop")?.click();
    expect(document.querySelector("#second-panel")?.classList.contains("is-open")).toBe(false);
    expect(document.querySelector("#pkicMegaBackdrop")?.classList.contains("is-open")).toBe(false);
  });

  it("hydrates empty member totals from D1 when the Members panel first opens", async () => {
    document.body.innerHTML = `
      <div id="pkicMegaBackdrop"></div>
      <div class="pkic-mega-trigger" id="members-trigger">
        <a class="pkic-nav-link"></a>
        <button class="pkic-mega-chevron" data-mega-target="pkic-members-mega" aria-expanded="false"></button>
      </div>
      <div class="pkic-mega-panel" id="pkic-members-mega">
        <span data-member-count="organization">—</span>
        <span data-member-count="independent">—</span>
      </div>
    `;

    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = new URL(String(input), "https://pkic.org");
      expect(url.pathname).toBe("/api/v1/members");
      expect(url.searchParams.get("limit")).toBe("1");
      expect(["organization", "independent"]).toContain(url.searchParams.get("group"));
      return new Response(JSON.stringify({ members: [], page: { limit: 1, offset: 0, total: 0, hasMore: false } }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    });
    vi.stubGlobal("fetch", fetchMock);

    await loadNavbar();
    document.querySelector<HTMLElement>("#members-trigger")?.dispatchEvent(new MouseEvent("mouseenter"));

    await vi.waitFor(() => {
      expect(document.querySelector('[data-member-count="organization"]')?.textContent).toBe("0");
      expect(document.querySelector('[data-member-count="independent"]')?.textContent).toBe("0");
    });
    expect(fetchMock).toHaveBeenCalledTimes(2);

    document.querySelector<HTMLElement>("#members-trigger")?.dispatchEvent(new MouseEvent("mouseenter"));
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("does not bake YAML member totals into the public navigation", () => {
    const membersPanel = navbarTemplate.slice(navbarTemplate.indexOf("pkic-members-mega"));
    expect(membersPanel).not.toContain("hugo.Data.members");
    expect(membersPanel).toContain('data-member-count="organization"');
    expect(membersPanel).toContain('data-member-count="independent"');
  });
});
