// @vitest-environment jsdom
/**
 * The event promoter leaderboard and its referral codes.
 *
 * What is asserted here is what a visual review cannot see. The leaderboard
 * used to be a column of cards whose figures were labelled "Sent", "Rate" and
 * "lbl", and whose top three places were marked by a gold/silver/bronze tint
 * — a rank carried by colour alone. It is now a captioned table where every
 * number has a column header and the rank is a number, and the tests cover
 * that naming, the two empty regions, and the failure path where a refused
 * request used to leave a blank panel.
 */
import { render, type ComponentChildren } from "preact";
import { act } from "preact/test-utils";
import { afterEach, describe, expect, it, vi } from "vitest";

import { eventPromotersListResponseSchema } from "../../assets/shared/schemas/event-promoters";
import { Promoters } from "../../assets/ts/member-flows/portal/sections/events/detail/Promoters";

vi.mock("wouter/use-hash-location", () => ({ useHashLocation: () => ["", vi.fn()] }));

vi.mock("wouter", () => ({
  Link: ({ children, href, ...rest }: { children?: ComponentChildren; href: string } & Record<string, unknown>) => (
    <a href={`#${href}`} {...rest}>
      {children}
    </a>
  ),
}));

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

afterEach(() => {
  for (const container of mounted.splice(0)) {
    void act(() => render(null, container));
    container.remove();
  }
  vi.unstubAllGlobals();
});

const PROMOTER = {
  userId: "00000000-0000-4000-8000-000000000001",
  email: "ada@example.test",
  firstName: "Ada",
  lastName: "Lovelace",
  organization: "Analytical Engines",
  jobTitle: "Engineer",
  headshotUrl: null,
  invitesSent: 8,
  invitesAccepted: 6,
  invitesDeclined: 1,
  invitesExpired: 1,
  inviteConversionRate: 75,
  lastInviteAt: null,
  referralCodesIssued: 2,
  referralClicks: 40,
  referralConversions: 9,
  impactScore: 17,
};

const REFERRAL_CODE = {
  code: "ADA-2026",
  ownerType: "user",
  ownerId: "00000000-0000-4000-8000-000000000001",
  effectiveUserId: "00000000-0000-4000-8000-000000000001",
  ownerEmail: "ada@example.test",
  ownerFirstName: "Ada",
  ownerLastName: "Lovelace",
  channelHint: null,
  clicks: 40,
  conversions: 9,
  createdAt: "2026-02-01T00:00:00.000Z",
};

function body(overrides: Record<string, unknown> = {}) {
  return eventPromotersListResponseSchema.parse({
    eventSlug: "summit",
    view: "promoters",
    promoters: [PROMOTER],
    referralCodes: [REFERRAL_CODE],
    page: { limit: 50, offset: 0, total: 1, hasMore: false },
    summary: {
      activePromoters: 1,
      promotersWithRegistrations: 1,
      totalInvitesSent: 8,
      totalInvitesAccepted: 6,
      totalReferralClicks: 40,
      totalReferralConversions: 9,
      referralCodeCount: 1,
    },
    ...overrides,
  });
}

function stub(response: () => Response) {
  vi.stubGlobal(
    "fetch",
    vi.fn(() => Promise.resolve(response())),
  );
}

function json(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), { status, headers: { "content-type": "application/json" } });
}

describe("the event promoter leaderboard", () => {
  it("names the table and every figure in it through a column header", async () => {
    stub(() => json(body()));
    const container = mount(<Promoters slug="summit" />);
    await settle();

    // A page holding several tables announces several anonymous ones without
    // this; and the rank is a number, not a gold tint.
    expect(container.querySelector("caption")?.textContent).toBe("Promoters, ranked by impact");
    expect([...container.querySelectorAll("th")].map((cell) => cell.textContent)).toEqual([
      "Rank",
      "Promoter",
      "Invites sent",
      "Invites accepted",
      "Invite conversion",
      "Declined",
      "Expired",
      "Link clicks",
      "Link registrations",
      "Impact",
    ]);
    expect(container.querySelector("tbody tr")?.textContent).toContain("Ada Lovelace");
    expect(container.textContent).toContain("Engineer · Analytical Engines");
  });

  it("gives the conversion bar a value and a name rather than a bare fill", async () => {
    stub(() => json(body()));
    const container = mount(<Promoters slug="summit" />);
    await settle();

    const meter = container.querySelector('[role="meter"]');
    expect(meter?.getAttribute("aria-label")).toBe("75% invite conversion for Ada Lovelace");
    expect(meter?.getAttribute("aria-valuenow")).toBe("75");
    // The figure is also written out, so the bar is never the only carrier.
    expect(meter?.textContent).toContain("75%");
  });

  it("reaches the promoter by a real link rather than a clickable cell", async () => {
    stub(() => json(body()));
    const container = mount(<Promoters slug="summit" />);
    await settle();

    const mailto = container.querySelector<HTMLAnchorElement>('a[href^="mailto:"]');
    expect(mailto?.getAttribute("href")).toBe("mailto:ada@example.test");
  });

  it("says why the leaderboard is empty instead of showing a blank table", async () => {
    stub(() =>
      json(
        body({
          promoters: [],
          summary: {
            activePromoters: 0,
            promotersWithRegistrations: 0,
            totalInvitesSent: 0,
            totalInvitesAccepted: 0,
            totalReferralClicks: 0,
            totalReferralConversions: 0,
            referralCodeCount: 0,
          },
        }),
      ),
    );
    const container = mount(<Promoters slug="summit" />);
    await settle();

    const status = container.querySelector('[role="status"]');
    expect(status?.textContent).toContain("No promoter activity yet");
    // With no promoters there is nothing to summarize, so the stat row is not
    // rendered as a row of zeroes.
    expect(container.querySelector(".pk-stat-card")).toBeNull();
  });

  it("names the referral-code table separately from the leaderboard", async () => {
    stub(() => json(body({ view: "codes" })));
    const container = mount(<Promoters slug="summit" subTab="codes" />);
    await settle();

    expect(container.querySelector("caption")?.textContent).toBe("Referral codes");
    expect(container.textContent).toContain("ADA-2026");
  });

  it("states a refused request as a sentence rather than rendering an empty region", async () => {
    stub(() => json({ error: { code: "FORBIDDEN", message: "You cannot read this event's promoters." } }, 403));
    const container = mount(<Promoters slug="summit" />);
    await settle();

    // Announced where it appears: the danger tone carries role="alert".
    const alert = container.querySelector('[role="alert"]');
    expect(alert?.textContent).toContain("You cannot read this event's promoters.");
    expect(container.querySelector("table")).toBeNull();
    expect(container.textContent).not.toContain("HTTP 403");
  });

  it("announces the wait instead of miming it with a grey rectangle", () => {
    stub(() => json(body()));
    const container = mount(<Promoters slug="summit" />);

    expect(container.querySelector('[role="status"]')?.textContent).toContain("Loading promoters…");
  });
});
