// @vitest-environment jsdom
/**
 * The public sponsor wall, mounted the way a page mounts it.
 *
 * The module runs `main()` at import and renders into every
 * `[data-sponsors-wall]` element, so each case builds the partial's markup,
 * stubs the network, then imports it. What is asserted is what the migration
 * changed and a visual review cannot check: the tier band is two named class
 * names rather than a Bootstrap grid, every logo link carries a real
 * alternative rather than only a `title`, and a failed fetch is announced as
 * an alert instead of drawn as a red sentence.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act } from "preact/test-utils";

const DISPLAY = "/api/v1/sponsors/display";

function json(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), { status, headers: { "content-type": "application/json" } });
}

function sponsor(name: string, weight: number): Record<string, unknown> {
  return {
    id: `00000000-0000-4000-8000-00000000000${String(weight)}`,
    name,
    website: `https://${name.toLowerCase()}.example`,
    logoUrl: `/img/${name.toLowerCase()}.svg`,
    tier: null,
    eventTier: null,
    effectiveTier: weight >= 7 ? "Diamond" : "Gold",
    weight,
  };
}

function display(): Record<string, unknown> {
  return {
    groups: [
      { weight: 7, tierName: "Diamond", sponsors: [sponsor("Alpha", 7)] },
      { weight: 5, tierName: "Gold", sponsors: [sponsor("Beta", 5), sponsor("Gamma", 5)] },
    ],
    page: { limit: 200, offset: 0, total: 3, count: 3, hasMore: false },
  };
}

function installApi(response: () => Response): void {
  vi.stubGlobal(
    "fetch",
    vi.fn((input: RequestInfo | URL) => {
      const url = new URL(String(input), location.origin);
      return Promise.resolve(url.pathname === DISPLAY ? response() : json({}));
    }),
  );
}

function mountShell(mode: string): HTMLElement {
  document.body.innerHTML = `<div data-sponsors-wall data-mode="${mode}" data-api-base="/api/v1" data-level="all"></div>`;
  const root = document.querySelector<HTMLElement>("[data-sponsors-wall]");
  if (!root) throw new Error("shell did not mount");
  return root;
}

async function settle(): Promise<void> {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

async function boot(): Promise<void> {
  await act(async () => {
    await import("../../assets/ts/member-flows/sponsors-wall");
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
  // The collection hook fetches from an effect, so the render that shows its
  // result lands a tick after the module's own promise chain.
  await settle();
  await settle();
}

beforeEach(() => {
  vi.resetModules();
});

afterEach(() => {
  vi.unstubAllGlobals();
  document.body.innerHTML = "";
});

describe("public sponsor wall", () => {
  it("draws each tier band from named classes rather than a Bootstrap grid", async () => {
    const root = mountShell("level");
    installApi(() => json(display()));

    await boot();

    const bands = [...root.querySelectorAll(".sponsors-tier")];
    expect(bands).toHaveLength(2);
    expect(bands.map((band) => band.querySelector(".sponsor-level")?.textContent)).toEqual(["Diamond", "Gold"]);
    // The row of logos is one flex container, not a `.row` of `.col` wrappers.
    expect(bands[1].querySelectorAll(".sponsors-tier-logos > a")).toHaveLength(2);
    expect(root.querySelector(".row")).toBeNull();
    expect(root.querySelector("[class*='col']")).toBeNull();
  });

  it("gives every logo an alternative that names the sponsor and its tier", async () => {
    const root = mountShell("level");
    installApi(() => json(display()));

    await boot();

    // A logo with an empty `alt` and a `title` says nothing at all: the title
    // is not surfaced on touch and is unreliable to a screen reader.
    const alts = [...root.querySelectorAll("img")].map((img) => img.alt);
    expect(alts).toEqual([
      "Alpha is a Diamond sponsor for the PKI Consortium",
      "Beta is a Gold sponsor for the PKI Consortium",
      "Gamma is a Gold sponsor for the PKI Consortium",
    ]);
    expect(alts.some((alt) => alt.length === 0)).toBe(false);
  });

  it("announces a failed fetch as an alert rather than a red sentence", async () => {
    const root = mountShell("level");
    installApi(() => json({ error: "unavailable" }, 503));

    await boot();

    const alert = root.querySelector("[role='alert']");
    expect(alert).not.toBeNull();
    expect(alert?.className).toContain("pk-alert--danger");
    expect(alert?.textContent).toContain("Sponsors could not be loaded");
    // Nothing is drawn from a Bootstrap tint any more.
    expect(root.querySelector("[class*='text-danger']")).toBeNull();
  });

  it("renders nothing at all when a tier query comes back empty", async () => {
    const root = mountShell("level");
    installApi(() => json({ groups: [], page: { limit: 200, offset: 0, total: 0, count: 0, hasMore: false } }));

    await boot();

    expect(root.textContent).toBe("");
  });

  it("centers the strip through the cluster utility, not five Bootstrap classes", async () => {
    document.body.innerHTML = `<div data-sponsors-wall data-mode="strip" data-api-base="/api/v1" data-min-weight="1" data-label="Our sponsors"></div>`;
    const root = document.querySelector<HTMLElement>("[data-sponsors-wall]")!;
    vi.stubGlobal(
      "fetch",
      vi.fn(() =>
        Promise.resolve(
          json({ sponsors: [sponsor("Alpha", 7)], page: { limit: 200, offset: 0, total: 1, hasMore: false } }),
        ),
      ),
    );

    await boot();

    expect(root.querySelector(".pk-cluster.pk-cluster--center")).not.toBeNull();
    expect(root.querySelector(".sponsor-strip-default-label")?.textContent).toBe("Our sponsors");
    expect(root.querySelector("[class*='d-flex']")).toBeNull();
    expect(root.querySelector("[class*='text-white']")).toBeNull();
  });
});
