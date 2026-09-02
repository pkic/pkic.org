// @vitest-environment jsdom
import { render } from "preact";
import type { ComponentChildren } from "preact";
import { act } from "preact/test-utils";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  sponsorshipCompaniesListResponseSchema,
  sponsorshipTierConfigResponseSchema,
  sponsorshipTierConfigUpdateSchema,
} from "../../assets/shared/schemas/sponsorship-management";
import { managedSponsorTiersResponseSchema } from "../../assets/shared/schemas/sponsors";
import { SponsorshipTierConfig } from "../../assets/ts/member-flows/portal/sections/sponsors/management/SponsorshipTierConfig";
import { Sponsorships } from "../../assets/ts/member-flows/portal/sections/sponsors/management";
import { SponsorWorkspace } from "../../assets/ts/member-flows/portal/sections/sponsors";

const mounted: HTMLElement[] = [];

function mount(node: ComponentChildren): HTMLElement {
  const container = document.createElement("div");
  document.body.append(container);
  mounted.push(container);
  void act(() => render(node, container));
  return container;
}

async function settle(): Promise<void> {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

const tiers = [
  {
    id: "00000000-0000-4000-8000-000000000001",
    sponsorType: "event" as const,
    tier: "Leader",
    currency: "usd",
    amountCents: 50000,
    active: true,
  },
];

afterEach(() => {
  for (const container of mounted.splice(0)) {
    void act(() => render(null, container));
    container.remove();
  }
  vi.unstubAllGlobals();
});

describe("portal sponsor management", () => {
  it("shows only creation controls to a writer without pipeline read access", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const container = mount(<Sponsorships canRead={false} canWrite />);
    await settle();

    expect(fetchMock).not.toHaveBeenCalled();
    expect(container.textContent).toContain("Create sponsorship");
    expect(container.textContent).not.toContain("Sponsorship tier pricing");
  });

  it("loads tier pricing for readers and hides mutation controls without write permission", async () => {
    const requests: URL[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        const url = new URL(
          typeof input === "string" ? input : input instanceof URL ? input.href : input.url,
          location.origin,
        );
        requests.push(url);
        return new Response(JSON.stringify(managedSponsorTiersResponseSchema.parse({ tiers, visibility: "all" })), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      }),
    );

    const container = mount(<SponsorshipTierConfig canWrite={false} />);
    await settle();

    expect(requests[0]?.pathname).toBe("/api/v1/sponsors/tiers");
    expect(container.textContent).toContain("Leader");
    expect(container.textContent).not.toContain("Save");
  });

  it("patches tier pricing through the canonical route when write permission is present", async () => {
    const requests: { method: string; url: URL; body: string }[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = new URL(
          typeof input === "string" ? input : input instanceof URL ? input.href : input.url,
          location.origin,
        );
        requests.push({ method: init?.method ?? "GET", url, body: typeof init?.body === "string" ? init.body : "" });
        if (init?.method === "PATCH") {
          return new Response(JSON.stringify(sponsorshipTierConfigResponseSchema.parse({ tier: tiers[0] })), {
            status: 200,
            headers: { "content-type": "application/json" },
          });
        }
        return new Response(JSON.stringify(managedSponsorTiersResponseSchema.parse({ tiers, visibility: "all" })), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      }),
    );

    const container = mount(<SponsorshipTierConfig canWrite />);
    await settle();
    const amount = container.querySelector('input[name="amountCents"]') as HTMLInputElement;
    amount.value = "75000";
    amount.dispatchEvent(new Event("input", { bubbles: true }));
    await act(async () => {
      (container.querySelector('button[type="submit"]') as HTMLButtonElement).click();
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    const patch = requests.find((request) => request.method === "PATCH");
    expect(patch?.url.pathname).toBe("/api/v1/sponsors/tiers/00000000-0000-4000-8000-000000000001");
    // Parsed through the shared update contract rather than compared field by
    // field, so the case fails when the contract moves.
    expect(sponsorshipTierConfigUpdateSchema.parse(JSON.parse(patch?.body ?? "{}"))).toEqual({
      amountCents: 75000,
      currency: "usd",
      active: true,
    });
  });

  it("names the pricing table and every editable cell, and titles the panel it sits in", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(JSON.stringify(managedSponsorTiersResponseSchema.parse({ tiers, visibility: "all" })), {
            status: 200,
            headers: { "content-type": "application/json" },
          }),
      ),
    );

    const container = mount(<SponsorshipTierConfig canWrite />);
    await settle();

    // A table with no caption is announced as "table"; several on one page are
    // announced as several tables.
    expect(container.querySelector("caption")?.textContent).toBe("Sponsorship tier pricing");
    expect(container.querySelector("section.pk-panel")?.getAttribute("aria-label")).toBe("Sponsorship tier pricing");

    // Each cell control is named after the tier it edits, so a column of
    // identical boxes is distinguishable when listed on its own.
    const amount = container.querySelector<HTMLInputElement>('input[name="amountCents"]');
    expect(amount?.getAttribute("aria-label")).toBe("Leader amount in cents");
    // The active switch is a full check block whose name is real label text,
    // hidden because the column header already carries it visually.
    const active = container.querySelector<HTMLLabelElement>("label.pk-check");
    expect(active?.querySelector("input.pk-check__input")).not.toBeNull();
    expect(active?.querySelector("span.pk-check__label")?.textContent).toBe("Leader active");
    expect(active?.querySelector("span.pk-check__label .pk-sr-only")?.textContent).toBe("Leader active");
    // The actions column is named for assistive technology even though its
    // header is not drawn.
    expect([...container.querySelectorAll("th")].map((th) => th.textContent)).toContain("Actions");
  });

  it("says the pricing catalog is empty in an announced region", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(JSON.stringify(managedSponsorTiersResponseSchema.parse({ tiers: [], visibility: "all" })), {
            status: 200,
            headers: { "content-type": "application/json" },
          }),
      ),
    );

    const container = mount(<SponsorshipTierConfig canWrite />);
    await settle();

    expect(container.querySelector("[role='status']")?.textContent).toContain("No tier pricing is configured.");
  });

  it("announces a failed pricing load as a sentence rather than an empty table", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(JSON.stringify({ error: "unavailable" }), {
            status: 503,
            headers: { "content-type": "application/json" },
          }),
      ),
    );

    const container = mount(<SponsorshipTierConfig canWrite />);
    await settle();

    const alert = container.querySelector("[role='alert']");
    expect(alert).not.toBeNull();
    expect(alert?.textContent).toContain("The service is temporarily unavailable.");
    // Nothing pretends to be a table the reader could act on.
    expect(container.querySelector("table")).toBeNull();
  });
});

describe("portal sponsorship pipeline filters", () => {
  function companiesPage(companies: unknown[]): Response {
    return new Response(
      JSON.stringify(
        sponsorshipCompaniesListResponseSchema.parse({
          companies,
          page: { limit: 50, offset: 0, total: companies.length, hasMore: false },
        }),
      ),
      { status: 200, headers: { "content-type": "application/json" } },
    );
  }

  it("keeps both pipeline filters in their columns' menus, not in the toolbar", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => companiesPage([])),
    );

    const container = mount(<Sponsorships canWrite={false} />);
    await settle();

    // No selects in the toolbar: the stage filter is the Stages column's own
    // menu and the type filter the Sponsorships column's, each named after
    // the column it narrows.
    expect(container.querySelector('[role="toolbar"] select')).toBeNull();
    expect(container.querySelector('button[aria-label="Stages column options"]')).not.toBeNull();
    expect(container.querySelector('button[aria-label="Sponsorships column options"]')).not.toBeNull();
  });

  it("sends the chosen stage to the companies query", async () => {
    const requested: URL[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        requested.push(new URL(String(input), location.origin));
        return companiesPage([]);
      }),
    );

    const container = mount(<Sponsorships canWrite={false} />);
    await settle();

    const trigger = container.querySelector<HTMLButtonElement>('button[aria-label="Stages column options"]');
    if (!trigger) throw new Error("the stages column menu is not rendered");
    await act(async () => {
      trigger.click();
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    const contacted = [...container.querySelectorAll<HTMLButtonElement>('[role="menuitemradio"]')].find((item) =>
      item.textContent?.includes("Contacted"),
    );
    if (!contacted) throw new Error("the stage choices are not rendered");
    await act(async () => {
      contacted.click();
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    expect(requested.some((url) => url.searchParams.get("stage") === "contacted")).toBe(true);
  });

  it("states a failed companies query as a sentence in an alert, not as a status code", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(JSON.stringify({ error: "nope" }), {
            status: 403,
            headers: { "content-type": "application/json" },
          }),
      ),
    );

    const container = mount(<Sponsorships canWrite={false} />);
    await settle();

    const alert = container.querySelector('[role="alert"]');
    expect(alert?.textContent).toContain("You don't have access to this.");
    expect(alert?.textContent).not.toContain("HTTP 403");
  });

  it("renders nothing at all for a caller with neither read nor write access", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const container = mount(<Sponsorships canRead={false} canWrite={false} />);
    await settle();

    expect(container.textContent).toBe("");
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("portal sponsor workspace tabs", () => {
  function companiesResponse(): Response {
    return new Response(
      JSON.stringify(
        sponsorshipCompaniesListResponseSchema.parse({
          companies: [],
          page: { limit: 25, offset: 0, total: 0, hasMore: false },
        }),
      ),
      { status: 200, headers: { "content-type": "application/json" } },
    );
  }

  function tiersResponse(): Response {
    return new Response(JSON.stringify(managedSponsorTiersResponseSchema.parse({ tiers, visibility: "all" })), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  }

  it("keeps tier pricing out of the sponsors list and moves it to a Settings tab", async () => {
    const requests: URL[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        const url = new URL(
          typeof input === "string" ? input : input instanceof URL ? input.href : input.url,
          location.origin,
        );
        requests.push(url);
        return url.pathname === "/api/v1/sponsors/tiers" ? tiersResponse() : companiesResponse();
      }),
    );

    const container = mount(
      <SponsorWorkspace sponsors={[]} canRead canWrite detailId={undefined} onSessionExpired={vi.fn()} />,
    );
    await settle();

    expect(requests.some((url) => url.pathname === "/api/v1/sponsors/companies")).toBe(true);
    expect(requests.some((url) => url.pathname === "/api/v1/sponsors/tiers")).toBe(false);
    expect(container.textContent).not.toContain("Sponsorship tier pricing");

    const settingsTab = Array.from(container.querySelectorAll("button")).find(
      (button) => button.textContent === "Settings",
    );
    expect(settingsTab).toBeTruthy();
    await act(async () => {
      settingsTab!.click();
    });
    await settle();

    expect(requests.some((url) => url.pathname === "/api/v1/sponsors/tiers")).toBe(true);
    expect(container.textContent).toContain("Sponsorship tier pricing");
    expect(container.textContent).not.toContain("Sponsorships");
  });

  it("hides the Settings tab from a reader without the sponsorships write capability", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => companiesResponse()),
    );

    const container = mount(
      <SponsorWorkspace sponsors={[]} canRead canWrite={false} detailId={undefined} onSessionExpired={vi.fn()} />,
    );
    await settle();

    const tabButtons = Array.from(container.querySelectorAll('nav[aria-label="Sponsor workspace"] button')).map(
      (button) => button.textContent,
    );
    expect(tabButtons).not.toContain("Settings");
  });
});
