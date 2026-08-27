// @vitest-environment jsdom
import { render } from "preact";
import { act } from "preact/test-utils";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  GroupEventProposals,
  portalSpeakerAssetPath,
} from "../../assets/ts/member-flows/portal/sections/management/GroupEventProposals";

const GROUP_ID = "10000000-0000-4000-8000-000000000001";
const EVENT_ID = "20000000-0000-4000-8000-000000000001";
const PROPOSAL_ID = "30000000-0000-4000-8000-000000000001";
let container: HTMLElement | null = null;

function json(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), { status, headers: { "content-type": "application/json" } });
}

const access = {
  eventPermissions: ["proposals:read"],
  canRead: true,
  canReview: false,
  canFinalize: false,
  canEditAcceptedAbstract: false,
  canCancelAcceptedProposal: false,
};

function proposal() {
  return {
    id: PROPOSAL_ID,
    event_id: EVENT_ID,
    proposer_user_id: "40000000-0000-4000-8000-000000000001",
    status: "submitted",
    proposal_type: "talk",
    title: "Read-only proposal",
    abstract: "A sufficiently long abstract for the program committee detail view.",
    review_round: 1,
    submitted_at: "2026-08-01T00:00:00.000Z",
    updated_at: "2026-08-01T00:00:00.000Z",
    proposer_email: "proposer@example.test",
    proposer_first_name: "Proposal",
    proposer_last_name: "Owner",
    decision_status: "accepted",
    decision_note: null,
    decision_decided_at: null,
    review_count: 0,
    average_review_score: null,
    recommendation_accept_count: 0,
    recommendation_needs_work_count: 0,
    recommendation_reject_count: 0,
  };
}

function speaker(userId: string, role: "proposer" | "speaker" = "speaker") {
  return {
    userId,
    role,
    status: "confirmed",
    email: `${userId}@example.test`,
    firstName: userId.endsWith("0001") ? "Proposal" : "Second",
    lastName: "Speaker",
    organizationName: "PKI Consortium",
    jobTitle: "Researcher",
    links: [],
    headshotUpdatedAt: null,
    headshotUrl: null,
    confirmedAt: "2026-08-01T00:00:00.000Z",
    declinedAt: null,
    declineReason: null,
    termsAcceptedAt: null,
    addedAt: "2026-08-01T00:00:00.000Z",
    biography: "A speaker biography.",
    profileComplete: false,
    hasHeadshot: false,
    hasBio: true,
  };
}

type RequestRecord = { url: string; method: string };

function stubFetch(calls: RequestRecord[], detailAccess = access): void {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      calls.push({ url, method: init?.method ?? "GET" });
      if (url.startsWith("/api/v1/me/proposal-programs")) {
        return json({
          programs: [
            {
              group: { id: GROUP_ID, slug: "working-group", name: "Working Group" },
              event: { id: EVENT_ID, slug: "event", name: "Program Event", startsAt: null },
              access: detailAccess,
            },
          ],
          page: { limit: 25, offset: 0, total: 1, hasMore: false },
        });
      }
      if (url.startsWith(`/api/v1/groups/${GROUP_ID}/events/${EVENT_ID}/proposals?`)) {
        return json({
          event: { id: EVENT_ID, slug: "event", name: "Program Event" },
          access: detailAccess,
          proposals: [proposal()],
          stats: {
            byStatus: { submitted: 1 },
            byRecommendation: {},
            reviewedCount: 0,
            unreviewedCount: 1,
            total: 1,
          },
          page: { limit: 25, offset: 0, total: 1, hasMore: false },
        });
      }
      if (url === `/api/v1/groups/${GROUP_ID}/events/${EVENT_ID}/proposals/${PROPOSAL_ID}`) {
        return json({
          proposal: { ...proposal(), details: null, canceled_at: null, cancellation_comment: null },
          access: detailAccess,
          form: null,
          minReviewsRequired: 2,
          sessionTypes: [{ label: "talk", requiresPresentation: true }],
        });
      }
      if (url === `/api/v1/groups/${GROUP_ID}/events/${EVENT_ID}/proposals/${PROPOSAL_ID}/speakers`) {
        return json({
          proposal: {
            id: PROPOSAL_ID,
            title: "Read-only proposal",
            status: "submitted",
            presentationDeadline: null,
            presentationUploaded: false,
            presentationUploadedAt: null,
          },
          summary: { total: 2, confirmed: 2, pending: 0, declined: 0, profileComplete: 0, presentationUploaded: 0 },
          speakers: [
            speaker("40000000-0000-4000-8000-000000000001", "proposer"),
            speaker("40000000-0000-4000-8000-000000000002"),
          ],
        });
      }
      if (url.startsWith(`/api/v1/groups/${GROUP_ID}/events/${EVENT_ID}/proposals/${PROPOSAL_ID}/audit-log`)) {
        return json({
          auditLog: [
            {
              id: "audit-1",
              created_at: "2026-08-21T12:00:00.000Z",
              actor_type: "admin",
              actor_id: "reviewer-1",
              actor_display: "Reviewer",
              action: "proposal_decision_recorded",
              entity_type: "proposal",
              entity_id: PROPOSAL_ID,
              details: { finalStatus: "accepted" },
            },
          ],
          page: { limit: 50, offset: 0, total: 1, hasMore: false },
        });
      }
      if (url.startsWith(`/api/v1/groups/${GROUP_ID}/events/${EVENT_ID}/proposals/${PROPOSAL_ID}/reviews`)) {
        return json({
          proposalId: PROPOSAL_ID,
          reviews: [],
          myReview: null,
          summary: {
            totalReviews: 0,
            averageScore: null,
            acceptCount: 0,
            needsWorkCount: 0,
            rejectCount: 0,
            minReviewsRequired: 2,
            quorumMet: false,
          },
          page: { limit: 25, offset: 0, total: 0, hasMore: false },
        });
      }
      if (url.startsWith(`/api/v1/groups/${GROUP_ID}/events/${EVENT_ID}/proposals/${PROPOSAL_ID}/comments`)) {
        return json({ comments: [], page: { limit: 25, offset: 0, total: 0, hasMore: false } });
      }
      return json({ error: { code: "UNEXPECTED", message: url } }, 500);
    }),
  );
}

async function settle(): Promise<void> {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

afterEach(() => {
  if (container) {
    void act(() => render(null, container!));
    container.remove();
    container = null;
  }
  vi.unstubAllGlobals();
});

describe("group event proposal portal", () => {
  it("does not fetch private reviews or comments for a read-only program identity", async () => {
    const calls: RequestRecord[] = [];
    stubFetch(calls);
    container = document.createElement("div");
    document.body.append(container);
    void act(() => render(<GroupEventProposals groupId={GROUP_ID} eventId={EVENT_ID} />, container!));
    await settle();
    await settle();

    const row = container.querySelector<HTMLTableRowElement>("tbody tr");
    expect(row).not.toBeNull();
    await act(async () => row?.click());
    await settle();
    await settle();

    expect(container.textContent).toContain("Read-only proposal");
    expect(container.textContent).not.toContain("Reviews");
    expect(calls.some(({ url }) => url.includes("/reviews"))).toBe(false);
    expect(calls.some(({ url }) => url.includes("/comments"))).toBe(false);
    expect(calls.some(({ url }) => url.includes("/audit-log"))).toBe(false);
    expect(calls.some(({ url }) => url.includes("/finalize"))).toBe(false);
  });

  it("shows audit only to reviewers and never renders decision controls without finalize access", async () => {
    const calls: RequestRecord[] = [];
    stubFetch(calls, { ...access, canReview: true, eventPermissions: ["proposals:score"] });
    container = document.createElement("div");
    document.body.append(container);
    await act(() => render(<GroupEventProposals groupId={GROUP_ID} eventId={EVENT_ID} />, container!));
    await settle();
    await settle();
    const row = container.querySelector<HTMLTableRowElement>("tbody tr");
    await act(async () => row?.click());
    await settle();
    await settle();

    expect(container.textContent).toContain("Reviews");
    expect(container.textContent).toContain("Audit log");
    expect(container.textContent).not.toContain("Final decision");
    expect(calls.some(({ url }) => url.includes("/finalize-preview"))).toBe(false);
    expect(calls.some(({ url }) => url.includes("/finalize"))).toBe(false);
    expect(calls.some(({ url }) => url.includes("/audit-log"))).toBe(true);
  });

  it("loads speakers through the group route and keeps all speaker actions off admin paths", async () => {
    const calls: RequestRecord[] = [];
    stubFetch(calls, { ...access, canReview: true, canFinalize: true, eventPermissions: ["proposals:manage"] });
    container = document.createElement("div");
    document.body.append(container);
    await act(() => render(<GroupEventProposals groupId={GROUP_ID} eventId={EVENT_ID} />, container!));
    await settle();
    await settle();
    await act(async () => container!.querySelector<HTMLTableRowElement>("tbody tr")?.click());
    await settle();
    await settle();

    expect(container.textContent).toContain("Speakers");
    expect(calls.some(({ url }) => url.endsWith(`/proposals/${PROPOSAL_ID}/speakers`))).toBe(true);
    expect(calls.some(({ url }) => url.includes("/api/v1/admin/"))).toBe(false);

    const edit = Array.from(container.querySelectorAll<HTMLButtonElement>("button")).find((button) =>
      button.textContent?.includes("Edit profile"),
    );
    expect(edit).not.toBeNull();
    await act(async () => edit?.click());
    const form = edit?.closest(".card")?.querySelector("form");
    expect(form).not.toBeNull();
    await act(async () => {
      form?.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    });
    await settle();
    expect(
      calls.some(
        ({ url, method }) =>
          method === "PATCH" && url.endsWith(`/speakers/${encodeURIComponent("40000000-0000-4000-8000-000000000001")}`),
      ),
    ).toBe(true);

    const profileReminder = Array.from(container.querySelectorAll<HTMLButtonElement>("button")).find((button) =>
      button.textContent?.includes("Profile reminder"),
    );
    await act(async () => profileReminder?.click());
    await settle();
    expect(calls.some(({ url, method }) => method === "POST" && url.endsWith("/remind"))).toBe(true);

    const presentationReminder = Array.from(container.querySelectorAll<HTMLButtonElement>("button")).find((button) =>
      button.textContent?.includes("Presentation reminder"),
    );
    await act(async () => presentationReminder?.click());
    await settle();
    expect(calls.some(({ url, method }) => method === "POST" && url.endsWith("/remind-presentation"))).toBe(true);

    const gravatar = Array.from(container.querySelectorAll<HTMLButtonElement>("button")).find((button) =>
      button.textContent?.includes("Fetch from Gravatar"),
    );
    await act(async () => gravatar?.click());
    await settle();
    expect(calls.some(({ url, method }) => method === "POST" && url.endsWith("/gravatar"))).toBe(true);
    expect(
      portalSpeakerAssetPath(
        `/api/v1/groups/${GROUP_ID}/events/${EVENT_ID}/proposals/${PROPOSAL_ID}`,
        "speaker-1",
        "headshot",
      ),
    ).toContain("/speakers/speaker-1/headshot");

    const remove = container.querySelector<HTMLButtonElement>("[data-remove-proposal-speaker]");
    const replacement = container.querySelector<HTMLSelectElement>("[data-replacement-proposer]");
    if (replacement) {
      await act(async () => {
        replacement.value = "40000000-0000-4000-8000-000000000002";
        replacement.dispatchEvent(new Event("change", { bubbles: true }));
      });
    }
    vi.stubGlobal(
      "confirm",
      vi.fn(() => true),
    );
    await act(async () => remove?.click());
    await settle();
    expect(
      calls.some(({ url, method }) => method === "DELETE" && url.includes("/speakers/") && !url.endsWith("/speakers")),
    ).toBe(true);
    expect(calls.some(({ url }) => url.includes("/api/v1/admin/"))).toBe(false);
  });
});
