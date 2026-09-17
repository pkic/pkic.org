// @vitest-environment jsdom
import { render } from "preact";
import { act } from "preact/test-utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { parseLookupParams, StatusSummary } from "../../assets/ts/member-flows/application-status-page";

/** A real database identifier: the status schema rejects anything else. */
const APPLICATION_ID = "0f7d1c1a4b7e4a1e9c2d3f4a5b6c7d8e";

describe("parseLookupParams", () => {
  it("reads id and token from the query string", () => {
    expect(parseLookupParams("?id=app-123&token=tok-abc")).toEqual({ id: "app-123", token: "tok-abc" });
  });

  it("returns null when either param is missing", () => {
    expect(parseLookupParams("?id=app-123")).toBeNull();
    expect(parseLookupParams("?token=tok-abc")).toBeNull();
    expect(parseLookupParams("")).toBeNull();
  });

  it("returns null for blank values", () => {
    expect(parseLookupParams("?id=&token=tok-abc")).toBeNull();
  });
});

describe("StatusSummary", () => {
  let container: HTMLDivElement | null = null;

  function mount(stage: string): HTMLDivElement {
    container = document.createElement("div");
    document.body.append(container);
    void act(() => {
      render(
        <StatusSummary
          data={{
            id: APPLICATION_ID,
            stage: stage as never,
            createdAt: "2026-02-01T10:00:00.000Z",
            stageEnteredAt: "2026-03-04T10:00:00.000Z",
          }}
        />,
        container!,
      );
    });
    return container;
  }

  afterEach(() => {
    if (!container) return;
    void act(() => render(null, container!));
    container.remove();
    container = null;
  });

  it("names the region with a real heading rather than a styled paragraph", () => {
    const root = mount("processing");

    const heading = root.querySelector("h2");
    expect(heading?.textContent).toBe("Application status");
    // The summary owns the base layer, so the heading is sized by the type
    // scale instead of a `h4` class borrowed from another framework.
    expect(root.querySelector(".pk")).not.toBeNull();
  });

  it("states the stage in words, so the tone is never the only signal", () => {
    const root = mount("processing");

    // The tone is drawn by a modifier class; the words beside it are what a
    // reader who cannot separate the hues actually gets.
    const badge = root.querySelector(".pk-badge");
    expect(badge?.textContent).toBe("Processing");
    expect(badge?.textContent).toBeTruthy();
  });

  it("reads no Bootstrap class names", () => {
    const root = mount("approved");

    for (const element of root.querySelectorAll<HTMLElement>("*")) {
      for (const name of element.classList) {
        expect(name.startsWith("pk")).toBe(true);
      }
    }
  });
});

describe("application status page", () => {
  function markup(): void {
    document.body.innerHTML = `
      <div data-application-status data-api-base="/api/v1">
        <div data-flow-status class="alert visually-hidden" role="alert" aria-live="polite" hidden></div>
        <div data-link-help>Open your confirmation email.</div>
        <div data-status-retry hidden><button type="button">Try again</button></div>
        <div data-status-result hidden></div>
      </div>`;
  }

  async function settle(): Promise<void> {
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
  }

  function region(selector: string): HTMLElement {
    const found = document.querySelector<HTMLElement>(selector);
    if (!found) throw new Error(`missing ${selector}`);
    return found;
  }

  async function bootPage(): Promise<void> {
    vi.resetModules();
    await import("../../assets/ts/member-flows/application-status-page");
    await settle();
  }

  beforeEach(() => {
    markup();
    history.replaceState({}, "", "/");
  });

  afterEach(() => {
    document.body.innerHTML = "";
    history.replaceState({}, "", "/");
    vi.unstubAllGlobals();
  });

  it("reveals the result and retires the lookup form once a status is found", async () => {
    history.replaceState({}, "", `/?id=${APPLICATION_ID}&token=tok-abc`);
    vi.stubGlobal(
      "fetch",
      vi.fn(() =>
        Promise.resolve(
          new Response(
            JSON.stringify({
              id: APPLICATION_ID,
              stage: "processing",
              createdAt: "2026-02-01T10:00:00.000Z",
              stageEnteredAt: "2026-03-04T10:00:00.000Z",
            }),
            { status: 200, headers: { "content-type": "application/json" } },
          ),
        ),
      ),
    );

    await bootPage();

    // Visibility is the platform attribute, not a class the script has to
    // keep in step with the template.
    expect(region("[data-status-result]").hidden).toBe(false);
    expect(region("[data-link-help]").hidden).toBe(true);
    expect(region("[data-status-result]").textContent).toContain("Processing");
  });

  it("returns the reader to the lookup form and announces why when the lookup fails", async () => {
    history.replaceState({}, "", `/?id=${APPLICATION_ID}&token=wrong`);
    vi.stubGlobal(
      "fetch",
      vi.fn(() =>
        Promise.resolve(
          new Response(JSON.stringify({ error: { code: "not_found", message: "No such application" } }), {
            status: 404,
            headers: { "content-type": "application/json" },
          }),
        ),
      ),
    );

    await bootPage();

    const status = region("[data-flow-status]");
    // The failure reaches a screen reader through the live region, and is
    // marked as an error by state rather than by colour alone.
    expect(status.getAttribute("role")).toBe("alert");
    expect(status.getAttribute("aria-live")).toBe("polite");
    expect(status.hidden).toBe(false);
    expect(status.dataset.state).toBe("error");
    expect(status.textContent).toContain("open the link from your confirmation email");

    expect(region("[data-link-help]").hidden).toBe(false);
    expect(region("[data-status-result]").hidden).toBe(true);
  });

  it("shows email guidance for an incomplete link without requesting IDs or tokens", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    history.replaceState({}, "", `/?id=${APPLICATION_ID}`);
    await bootPage();
    expect(fetchMock).not.toHaveBeenCalled();
    expect(region("[data-link-help]").hidden).toBe(false);
    expect(document.querySelector("input")).toBeNull();
  });

  it("offers a retry during an outage and clears the error after recovery", async () => {
    history.replaceState({}, "", `/?id=${APPLICATION_ID}&token=tok-abc`);
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ error: { code: "DEPENDENCY_UNAVAILABLE", message: "Try later" } }), {
          status: 503,
        }),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            id: APPLICATION_ID,
            stage: "on_hold",
            createdAt: "2026-02-01T10:00:00.000Z",
            stageEnteredAt: "2026-03-04T10:00:00.000Z",
          }),
          { headers: { "content-type": "application/json" } },
        ),
      );
    vi.stubGlobal("fetch", fetchMock);
    await bootPage();
    expect(region("[data-flow-status]").textContent).toContain("temporarily unavailable");
    expect(region("[data-status-retry]").hidden).toBe(false);
    region("[data-status-retry] button").click();
    await settle();
    expect(region("[data-flow-status]").hidden).toBe(true);
    expect(region("[data-status-result]").textContent).toContain("On hold");
  });
});
