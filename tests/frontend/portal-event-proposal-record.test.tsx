// @vitest-environment jsdom
import { render } from "preact";
import { act } from "preact/test-utils";
import { afterEach, describe, expect, it, vi } from "vitest";
vi.mock("wouter/use-hash-location", () => ({ useHashLocation: () => ["", vi.fn()] }));
vi.mock("wouter", () => ({
  Link: ({ children, href, ...rest }: { children?: ComponentChildren; href: string } & Record<string, unknown>) => (
    <a href={`#${href}`} {...rest}>
      {children}
    </a>
  ),
}));
import type { ComponentChildren } from "preact";
import { ProposalDetailPage } from "../../assets/ts/member-flows/portal/sections/events/detail/ProposalDetailPage";
import { isCurrentTab, tabs } from "./helpers/tabs";

import {
  EVENT_SLUG,
  PROPOSAL_ID,
  access,
  settle,
  stubFetch,
  type RequestRecord,
} from "./helpers/proposal-detail-fixture";
let container: HTMLElement | null = null;

afterEach(() => {
  if (container) {
    void act(() => render(null, container!));
    container.remove();
    container = null;
  }
  vi.unstubAllGlobals();
});

/**
 * Opens the record's actions menu and returns its items by label.
 *
 * The commands used to be eight block buttons in a sidebar panel; they are
 * one menu in the header now, reached the way a reader reaches it.
 */
async function openProposalActions(root: HTMLElement): Promise<HTMLButtonElement[]> {
  const trigger = root.querySelector<HTMLButtonElement>('button[aria-label="Proposal actions"]');
  if (!trigger) throw new Error("the proposal offers no actions menu");
  await act(async () => trigger.click());
  return [
    ...root.querySelectorAll<HTMLButtonElement>('[role="menu"][aria-label="Proposal actions"] [role="menuitem"]'),
  ];
}

/**
 * The proposal as a routed record: its facets are URL segments when the
 * caller routes them, an unavailable facet falls back to the submission, and
 * the operator's commands are one actions menu in the header.
 */
describe("proposal record routing and actions", () => {
  it("opens the facet the URL names when the caller routes the facets", async () => {
    const calls: RequestRecord[] = [];
    stubFetch(calls, { ...access, canReview: true, eventPermissions: ["proposals:score"] });
    container = document.createElement("div");
    document.body.append(container);
    await act(() =>
      render(
        <ProposalDetailPage
          slug={EVENT_SLUG}
          proposalId={PROPOSAL_ID}
          tab="reviews"
          tabHref={(key) => `/x/${PROPOSAL_ID}/${key}`}
        />,
        container!,
      ),
    );
    await settle();
    await settle();

    const activeTab = tabs(container).find(isCurrentTab);
    expect(activeTab?.textContent).toBe("Reviews (0)");
    // Routed facets are links, so a facet can be shared and opened in a new tab.
    expect(activeTab?.getAttribute("href")).toBe(`#/x/${PROPOSAL_ID}/reviews`);
  });

  it("opens the co-speaker invitation as a page under the Speakers facet when the URL names it", async () => {
    const calls: RequestRecord[] = [];
    stubFetch(calls, { ...access, canFinalize: true, eventPermissions: ["proposals:decide"] });
    container = document.createElement("div");
    document.body.append(container);
    await act(() =>
      render(
        <ProposalDetailPage
          slug={EVENT_SLUG}
          proposalId={PROPOSAL_ID}
          tab="speakers"
          segment="new"
          tabHref={(key) => `/x/${PROPOSAL_ID}/${key}`}
        />,
        container!,
      ),
    );
    await settle();
    await settle();

    // A create action is never loaded inline: the roster's "Invite co-speaker"
    // is a link to this address, and the page here is the form, with the
    // way back to the roster.
    const invite = container.querySelector('[aria-label="Invite a co-speaker"]');
    expect(invite).not.toBeNull();
    expect(invite?.querySelector('a[href="#/x/' + PROPOSAL_ID + '/speakers"]')?.textContent).toBe("Cancel");
    expect(container.querySelector('[aria-label="Proposal speakers"]')).toBeNull();
  });

  it("falls back to the submission when the URL names a facet the identity cannot see", async () => {
    const calls: RequestRecord[] = [];
    stubFetch(calls);
    container = document.createElement("div");
    document.body.append(container);
    await act(() =>
      render(
        <ProposalDetailPage
          slug={EVENT_SLUG}
          proposalId={PROPOSAL_ID}
          tab="reviews"
          tabHref={(key) => `/x/${PROPOSAL_ID}/${key}`}
        />,
        container!,
      ),
    );
    await settle();
    await settle();

    expect(container.textContent).toContain("Abstract");
    expect(tabs(container).find(isCurrentTab)?.textContent).toBe("Submission");
    expect(tabs(container).some((tab) => tab.textContent?.includes("Reviews"))).toBe(false);
    expect(tabs(container).some((tab) => tab.textContent?.includes("Audit log"))).toBe(false);
    expect(calls.some(({ url }) => url.includes("/reviews"))).toBe(false);
  });

  it("offers the operator's commands from one actions menu and sends reminders through the shared contract", async () => {
    const calls: RequestRecord[] = [];
    stubFetch(calls, { ...access, canReview: true, canFinalize: true, eventPermissions: ["proposals:manage"] });
    container = document.createElement("div");
    document.body.append(container);
    await act(() => render(<ProposalDetailPage slug={EVENT_SLUG} proposalId={PROPOSAL_ID} />, container!));
    await settle();
    await settle();

    // No block-button sidebar: the commands are one menu in the header.
    expect(container.textContent).not.toContain("Operator actions");
    const items = await openProposalActions(container);
    const labels = items.map((item) => item.textContent?.trim());
    expect(labels).toContain("Open proposer manage page");
    expect(labels).toContain("Email proposer");
    expect(labels).toContain("Remind speakers to complete their profile");
    // The proposal is accepted and a talk needs a presentation, so the
    // presentation reminder is offered; the moderation flags are not, because
    // a decided proposal cannot be flagged.
    expect(labels).toContain("Remind speakers to upload their presentation");
    expect(labels).not.toContain("Mark as spam");

    await act(async () =>
      items.find((item) => item.textContent?.trim() === "Remind speakers to complete their profile")?.click(),
    );
    await settle();
    const reminder = calls.find(({ url, method }) => method === "POST" && url.endsWith("/speakers/reminders"));
    expect(reminder).toBeDefined();
    expect(calls.some(({ url }) => url.includes("/api/v1/admin/"))).toBe(false);
  });
});
