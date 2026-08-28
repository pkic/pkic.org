// @vitest-environment jsdom
import { render } from "preact";
import type { ComponentChildren } from "preact";
import { act } from "preact/test-utils";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  sponsorshipTierConfigListResponseSchema,
  sponsorshipTierConfigResponseSchema,
} from "../../assets/shared/schemas/sponsorship-management";
import { SponsorshipTierConfig } from "../../assets/ts/member-flows/portal/sections/system-sponsorships/SponsorshipTierConfig";
import { Sponsorships } from "../../assets/ts/member-flows/portal/sections/system-sponsorships";

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

describe("portal system sponsorships", () => {
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
        return new Response(JSON.stringify(sponsorshipTierConfigListResponseSchema.parse({ tiers })), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      }),
    );

    const container = mount(<SponsorshipTierConfig canWrite={false} />);
    await settle();

    expect(requests[0]?.pathname).toBe("/api/v1/sponsorships/tier-config");
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
        return new Response(JSON.stringify(sponsorshipTierConfigListResponseSchema.parse({ tiers })), {
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
    expect(patch?.url.pathname).toBe("/api/v1/sponsorships/tier-config/00000000-0000-4000-8000-000000000001");
    expect(JSON.parse(patch?.body ?? "{}")).toMatchObject({ amountCents: 75000, currency: "usd", active: true });
  });
});
