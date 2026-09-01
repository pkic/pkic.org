// @vitest-environment jsdom
import { render, type ComponentChildren } from "preact";
import { act } from "preact/test-utils";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  GroupOverview,
  GroupOverviewView,
} from "../../assets/ts/member-flows/portal/sections/management/GroupOverview";

vi.mock("wouter", () => ({
  Link: ({ children, href }: { children?: ComponentChildren; href: string }) => <a href={`#${href}`}>{children}</a>,
}));

const GROUP_ID = "10000000-0000-4000-8000-000000000001";

function json(value: unknown): Response {
  return new Response(JSON.stringify(value), { status: 200, headers: { "Content-Type": "application/json" } });
}

async function settle(): Promise<void> {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

afterEach(() => {
  document.body.replaceChildren();
  vi.unstubAllGlobals();
});

function groupEvent() {
  return {
    id: "e0000000-0000-4000-8000-000000000001",
    slug: "quarterly-summit",
    name: "Quarterly Summit",
    timezone: "Europe/Amsterdam",
    startsAt: "2999-12-01T09:00:00.000Z",
    endsAt: "2999-12-01T17:00:00.000Z",
    profileKey: null,
    sourceMode: null,
    registrationPolicy: "public" as const,
    visibility: "public" as const,
    inviteLimitAttendee: 0,
    updatedAt: "2026-08-01T00:00:00.000Z",
    ownerGroupId: GROUP_ID,
    seriesId: null,
    basePath: null,
    location: "Amsterdam",
    links: [],
    nextOccurrenceAt: null,
    capabilities: [],
    proposalAccess: null,
  };
}

function groupVote() {
  return {
    id: "b0000000-0000-4000-8000-000000000001",
    slug: "charter-motion",
    title: "Charter motion",
    description: "Adopt the charter.",
    voteType: "motion" as const,
    ownerGroupId: GROUP_ID,
    ownerGroupName: "CA Working Group",
    electorateMode: "per_member" as const,
    thresholdType: "simple_majority" as const,
    eligibleCategories: null,
    opensAt: "2026-08-01T00:00:00.000Z",
    closesAt: "2999-09-01T00:00:00.000Z",
    currentRound: 1,
    status: "open" as const,
    visibility: "private" as const,
    publicDetailLevel: "outcome_only" as const,
    createdAt: "2026-08-01T00:00:00.000Z",
    updatedAt: "2026-08-01T00:00:00.000Z",
    capabilities: ["view" as const],
    availableTransitions: [],
    questionFormId: null,
    quorumPercent: null,
    tieBreakMode: "none" as const,
    excludedMemberIds: [],
    cancellationReason: null,
  };
}

describe("GroupOverview", () => {
  it("surfaces upcoming events and open votes as links into their owning tabs", async () => {
    const container = document.createElement("div");
    document.body.append(container);
    await act(() =>
      render(
        <GroupOverviewView
          groupId={GROUP_ID}
          description="A test group."
          upcomingEvents={[groupEvent()]}
          openVotes={[groupVote()]}
        />,
        container,
      ),
    );

    const eventLink = container.querySelector(`a[href$="/groups/${GROUP_ID}/events/${groupEvent().id}"]`);
    expect(eventLink?.textContent).toContain("Quarterly Summit");
    const voteLink = container.querySelector(`a[href$="/groups/${GROUP_ID}/votes/${groupVote().id}"]`);
    // The link is named by the vote alone; when it closes is metadata beside
    // it, so a reader listing this panel's links hears five titles rather than
    // five titles each trailing a formatted date.
    expect(voteLink?.textContent).toBe("Charter motion");
    expect(voteLink?.closest("li")?.textContent).toContain("Closes");
    expect(container.textContent).toContain("A test group.");
  });

  it("names each feed list and panel so they are identifiable out of reading order", async () => {
    const container = document.createElement("div");
    document.body.append(container);
    await act(() =>
      render(
        <GroupOverviewView
          groupId={GROUP_ID}
          description="A test group."
          upcomingEvents={[groupEvent()]}
          openVotes={[groupVote()]}
        />,
        container,
      ),
    );

    expect(container.querySelector('ul[aria-label="Upcoming events"]')).not.toBeNull();
    expect(container.querySelector('ul[aria-label="Open votes"]')).not.toBeNull();
    // Each panel names itself with a real heading rather than a styled div, so
    // the page's outline lists the two feeds and the description block.
    expect([...container.querySelectorAll("h3")].map((heading) => heading.textContent)).toEqual([
      "Upcoming events",
      "Open votes",
      "About this group",
    ]);
  });

  it("says a feed failed rather than rendering it as empty", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        const url = new URL(String(input), location.origin);
        if (url.pathname.endsWith("/votes")) throw new Error("Votes are unavailable");
        return json({ events: [], page: { limit: 3, offset: 0, total: 0, hasMore: false } });
      }),
    );
    const container = document.createElement("div");
    document.body.append(container);
    await act(() =>
      render(
        <GroupOverview
          groupId={GROUP_ID}
          description={null}
          participantCount={3}
          representedMemberCount={2}
          childCount={0}
        />,
        container,
      ),
    );
    await settle();

    // An empty list would claim the group has no open votes, which is a
    // different statement from "we could not find out". The danger tone
    // carries role="alert", so the failure announces itself.
    const alert = container.querySelector('[role="alert"]');
    expect(alert?.textContent).toContain("Votes are unavailable");
    expect(container.querySelector('ul[aria-label="Open votes"]')).toBeNull();
    expect(container.textContent).not.toContain("Upcoming events");
  });

  it("queries bounded upcoming-event and open-vote feeds for the group", async () => {
    const urls: string[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        const url = new URL(String(input), location.origin);
        urls.push(url.pathname + url.search);
        const page = { limit: 3, offset: 0, total: 0, hasMore: false };
        return json(url.pathname.endsWith("/votes") ? { votes: [], page } : { events: [], page });
      }),
    );
    const container = document.createElement("div");
    document.body.append(container);
    await act(() =>
      render(
        <GroupOverview
          groupId={GROUP_ID}
          description={null}
          participantCount={3}
          representedMemberCount={2}
          childCount={0}
        />,
        container,
      ),
    );
    await settle();
    expect(urls.some((url) => url.includes(`/api/v1/groups/${GROUP_ID}/events?`) && url.includes("from="))).toBe(true);
    expect(urls).toContain(`/api/v1/groups/${GROUP_ID}/votes?status=open&limit=3`);
  });

  it("keeps the about card and shows no activity cards when both feeds are empty", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        const url = new URL(String(input), location.origin);
        const page = { limit: 3, offset: 0, total: 0, hasMore: false };
        return json(url.pathname.endsWith("/votes") ? { votes: [], page } : { events: [], page });
      }),
    );
    const container = document.createElement("div");
    document.body.append(container);
    await act(() =>
      render(
        <GroupOverview
          groupId={GROUP_ID}
          description={null}
          participantCount={3}
          representedMemberCount={2}
          childCount={0}
        />,
        container,
      ),
    );
    await settle();
    expect(container.textContent).not.toContain("Upcoming events");
    expect(container.textContent).not.toContain("Open votes");
    expect(container.textContent).toContain("No group description has been provided.");
  });
});
