// @vitest-environment jsdom
/**
 * The mega-menu script against the header the site serves.
 *
 * `navbar.js` is an IIFE that binds to the header's ids and classes when it
 * loads, so it runs against `SiteHeader` rendered to a string, the way the
 * browser receives it, rather than against a hand-written copy that could
 * drift from the page.
 */
import { renderToString } from "preact-render-to-string";
import { afterEach, describe, expect, it, vi } from "vitest";
import navbarSource from "../../assets/js/navbar.js?raw";
import type { SiteNavigation } from "../../assets/shared/site-content";
import { SiteHeader } from "../../assets/ts/ui/SiteChrome";

const navigation: SiteNavigation = {
  footer: [],
  main: [
    {
      identifier: "working-groups",
      label: "Working Groups",
      href: "/wg/",
      children: [{ identifier: "pkimm", label: "PKI Maturity Model", href: "/wg/pkimm/", children: [] }],
    },
    { identifier: "members", label: "Members", href: "/members/", children: [] },
  ],
};

function mountHeader(memberCounts?: { organization: number; independent: number }): void {
  document.body.innerHTML = renderToString(
    <SiteHeader currentPath="/" navigation={navigation} memberCounts={memberCounts} />,
  );
}

/**
 * Evaluates the script from a data URL: it dynamically imports the Pagefind
 * bundle by absolute URL, which Vite refuses to resolve from a file in the
 * module graph, and a fresh URL per call re-runs the IIFE against the new DOM.
 */
async function loadNavbar(): Promise<void> {
  const moduleUrl = `data:text/javascript;charset=utf-8,${encodeURIComponent(navbarSource)}#${crypto.randomUUID()}`;
  await import(/* @vite-ignore */ moduleUrl);
}

function trigger(panelId: string): HTMLElement {
  const target = document.querySelector(`[data-mega-target="${panelId}"]`);
  const found = target?.closest<HTMLElement>(".pkic-mega-trigger");
  if (!found) throw new Error(`no mega trigger for ${panelId}`);
  return found;
}

function panelIsOpen(panelId: string): boolean {
  return document.getElementById(panelId)?.classList.contains("is-open") ?? false;
}

describe("navbar mega-menu state", () => {
  afterEach(() => {
    document.body.innerHTML = "";
    vi.unstubAllGlobals();
  });

  it("clears the previous panel state before opening another panel and when closing", async () => {
    mountHeader({ organization: 3, independent: 2 });
    await loadNavbar();

    trigger("pkic-wg-mega").dispatchEvent(new MouseEvent("mouseenter"));
    expect(panelIsOpen("pkic-wg-mega")).toBe(true);

    trigger("pkic-members-mega").dispatchEvent(new MouseEvent("mouseenter"));
    expect(panelIsOpen("pkic-wg-mega")).toBe(false);
    expect(panelIsOpen("pkic-members-mega")).toBe(true);

    document.getElementById("pkicMegaBackdrop")?.click();
    expect(panelIsOpen("pkic-members-mega")).toBe(false);
    expect(document.getElementById("pkicMegaBackdrop")?.classList.contains("is-open")).toBe(false);
  });

  it("hydrates empty member totals from D1 when the Members panel first opens", async () => {
    mountHeader();

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
    trigger("pkic-members-mega").dispatchEvent(new MouseEvent("mouseenter"));

    await vi.waitFor(() => {
      expect(document.querySelector('[data-member-count="organization"]')?.textContent).toBe("0");
      expect(document.querySelector('[data-member-count="independent"]')?.textContent).toBe("0");
    });
    expect(fetchMock).toHaveBeenCalledTimes(2);

    trigger("pkic-members-mega").dispatchEvent(new MouseEvent("mouseenter"));
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("leaves totals the page already carries alone instead of fetching them again", async () => {
    mountHeader({ organization: 3, independent: 2 });
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    await loadNavbar();
    trigger("pkic-members-mega").dispatchEvent(new MouseEvent("mouseenter"));

    expect(document.querySelector("[data-member-count]")).toBeNull();
    expect(document.getElementById("pkic-members-mega")?.textContent).toContain("3");
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
