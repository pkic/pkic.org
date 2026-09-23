// @vitest-environment jsdom
/**
 * The event's proposals section: its tab strip and the two presentation
 * archive downloads above the catalogue. Downloads retain link semantics.
 */
import type { ComponentChildren } from "preact";
import { render } from "preact";
import { act } from "preact/test-utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { buildPageInfo } from "../../assets/shared/schemas/pagination";
import {
  eventProposalsResponseSchema,
  eventProposalSummarySchema,
  type EventProposalSummary,
} from "../../assets/shared/schemas/event-proposals";
import { Proposals } from "../../assets/ts/member-flows/portal/sections/events/detail/Proposals";

vi.mock("wouter/use-hash-location", () => ({ useHashLocation: () => ["", vi.fn()] }));
vi.mock("wouter", () => ({
  Link: ({ children, href, ...rest }: { children?: ComponentChildren; href: string } & Record<string, unknown>) => (
    <a href={`#${href}`} {...rest}>
      {children}
    </a>
  ),
}));

let container: HTMLDivElement | null = null;

const ACCESS = {
  eventPermissions: ["proposals:read"],
  canRead: true,
  canReview: false,
  canFinalize: false,
  canEditAcceptedAbstract: false,
  canCancelAcceptedProposal: false,
};

function proposalsBody(access: typeof ACCESS, proposals: EventProposalSummary[] = []) {
  return eventProposalsResponseSchema.parse({
    proposals,
    page: buildPageInfo(25, 0, proposals.length, proposals.length),
    event: { id: "11111111111111111111111111111111", slug: "spring-summit", name: "Spring Summit" },
    access,
    stats: { byStatus: {}, byRecommendation: {}, reviewedCount: 0, unreviewedCount: 0, total: 0 },
  });
}

function respond(access: typeof ACCESS, proposals: EventProposalSummary[] = []): void {
  vi.stubGlobal(
    "fetch",
    vi.fn(() =>
      Promise.resolve(
        new Response(JSON.stringify(proposalsBody(access, proposals)), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
      ),
    ),
  );
}

async function settle(): Promise<void> {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

async function mount(canWrite = true): Promise<HTMLDivElement> {
  container = document.createElement("div");
  document.body.append(container);
  await act(async () => {
    render(<Proposals slug="spring-summit" canWrite={canWrite} />, container!);
    await Promise.resolve();
  });
  await settle();
  await settle();
  return container;
}

beforeEach(() => {
  respond(ACCESS);
});

afterEach(() => {
  if (container) {
    void act(() => render(null, container!));
    container.remove();
    container = null;
  }
  vi.unstubAllGlobals();
});

describe("event Proposals section", () => {
  it("names its tab strip instead of leaving it as one more anonymous nav", async () => {
    const root = await mount();

    const nav = root.querySelector("nav.pk-tabs");
    expect(nav?.getAttribute("aria-label")).toBe("Proposal sections");
    expect([...root.querySelectorAll("nav.pk-tabs a")].map((link) => link.textContent)).toEqual([
      "Overview",
      "Responses",
      "Email",
    ]);
  });

  it("marks the current section with aria-current rather than a tint", async () => {
    const root = await mount();

    const current = root.querySelector('nav.pk-tabs a[aria-current="page"]');
    expect(current?.textContent).toBe("Overview");
  });

  it("offers current versions as the default download and both choices as links", async () => {
    const root = await mount();

    const group = root.querySelector('[role="group"][aria-label="Download event presentations"]');
    expect(group).not.toBeNull();

    const current = group?.querySelector<HTMLAnchorElement>(
      'a[aria-label="Download current presentations for all accepted proposals"]',
    );
    expect(current?.getAttribute("href")).toBe("/api/v1/events/spring-summit/presentations/archive");
    const menu = group?.querySelector<HTMLButtonElement>('button[aria-label="Presentation download options"]');
    expect(menu).not.toBeNull();
    await act(async () => menu?.click());
    const choices = [...document.querySelectorAll<HTMLAnchorElement>('a[role="menuitem"]')];
    expect(choices.map((item) => item.textContent)).toEqual(["Current presentations", "All presentation versions"]);
    expect(choices[1]?.getAttribute("href")).toContain("versions=all");
  });

  it("limits both archive choices to the selected proposal", async () => {
    const id = "30000000-0000-4000-8000-000000000001";
    const proposal = eventProposalSummarySchema.parse({
      id,
      event_id: "11111111111111111111111111111111",
      proposer_user_id: "20000000-0000-4000-8000-000000000002",
      status: "accepted",
      proposal_type: "session",
      title: "Selected session",
      abstract: "Abstract",
      review_round: 1,
      submitted_at: "2026-05-20T09:30:00.000Z",
      updated_at: "2026-05-20T09:30:00.000Z",
      proposer_email: "speaker@example.test",
      proposer_first_name: "Ada",
      proposer_last_name: "Speaker",
      decision_status: null,
      decision_note: null,
      decision_decided_at: null,
      review_count: 0,
      average_review_score: null,
      recommendation_accept_count: 0,
      recommendation_needs_work_count: 0,
      recommendation_reject_count: 0,
    });
    respond(ACCESS, [proposal]);
    const root = await mount();
    const row = root.querySelector<HTMLInputElement>(`input[aria-label="Selected session"]`);
    expect(row).not.toBeNull();
    await act(async () => row?.click());
    const current = root.querySelector<HTMLAnchorElement>(
      'a[aria-label="Download current presentations for selected proposals"]',
    );
    expect(new URL(current?.href ?? "", location.origin).searchParams.get("proposalIds")).toBe(id);
    const menu = root.querySelector<HTMLButtonElement>('button[aria-label="Presentation download options"]');
    await act(async () => menu?.click());
    const all = [...document.querySelectorAll<HTMLAnchorElement>('a[role="menuitem"]')].find(
      (item) => item.textContent === "All presentation versions",
    );
    const allUrl = new URL(all?.href ?? "", location.origin);
    expect(allUrl.searchParams.get("versions")).toBe("all");
    expect(allUrl.searchParams.get("proposalIds")).toBe(id);
  });

  it("hides the archive links from a reader who may not read proposals", async () => {
    respond({ ...ACCESS, canRead: false });
    const root = await mount();

    expect(root.querySelector('[role="group"][aria-label="Download event presentations"]')).toBeNull();
  });

  it("drops the email tab for a reader who cannot write", async () => {
    const root = await mount(false);

    expect([...root.querySelectorAll("nav.pk-tabs a")].map((link) => link.textContent)).toEqual([
      "Overview",
      "Responses",
    ]);
  });
});
