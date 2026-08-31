// @vitest-environment jsdom
import { render } from "preact";
import { act } from "preact/test-utils";
import { afterEach, describe, expect, it, vi } from "vitest";
vi.mock("wouter/use-hash-location", () => ({ useHashLocation: () => ["", vi.fn()] }));
import { ConfirmDialogHost } from "../../assets/ts/components/ConfirmDialog";
import { GroupEventProposals } from "../../assets/ts/member-flows/portal/sections/management/GroupEventProposals";
import { ProposalDetailPage } from "../../assets/ts/member-flows/portal/sections/events/detail/ProposalDetailPage";
import { proposalSpeakerAssetPath } from "../../assets/ts/member-flows/portal/sections/events/detail/proposal-detail/SpeakerCard";

const GROUP_ID = "10000000-0000-4000-8000-000000000001";
const EVENT_ID = "20000000-0000-4000-8000-000000000001";
const EVENT_SLUG = "event";
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
    inviteExpiresAt: null,
    termsAcceptedAt: null,
    addedAt: "2026-08-01T00:00:00.000Z",
    biography: "A speaker biography.",
    profileComplete: false,
    hasHeadshot: false,
    hasBio: true,
  };
}

type RequestRecord = { url: string; method: string };
type DetailAccess = typeof access | (() => typeof access);

const presentationVersion = {
  id: "50000000-0000-4000-8000-000000000001",
  proposalId: PROPOSAL_ID,
  versionNumber: 1,
  fileName: "presentation.pdf",
  fileSize: 1024,
  mimeType: "application/pdf",
  uploadedByUserId: "40000000-0000-4000-8000-000000000001",
  uploadedAt: "2026-08-02T00:00:00.000Z",
  isCurrent: true,
  deletedAt: null,
  latestReview: null,
};

function stubFetch(
  calls: RequestRecord[],
  detailAccess: DetailAccess = access,
  presentationVersions: (typeof presentationVersion)[] = [],
): void {
  const currentAccess = () => (typeof detailAccess === "function" ? detailAccess() : detailAccess);
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      calls.push({ url, method: init?.method ?? "GET" });
      if (url.startsWith("/api/v1/proposals/programs")) {
        return json({
          programs: [
            {
              group: { id: GROUP_ID, slug: "working-group", name: "Working Group" },
              event: { id: EVENT_ID, slug: "event", name: "Program Event", startsAt: null },
              access: currentAccess(),
            },
          ],
          page: { limit: 25, offset: 0, total: 1, hasMore: false },
        });
      }
      if (url.startsWith(`/api/v1/events/${EVENT_SLUG}/proposals?`)) {
        return json({
          event: { id: EVENT_ID, slug: "event", name: "Program Event" },
          access: currentAccess(),
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
      if (url === `/api/v1/proposals/${PROPOSAL_ID}`) {
        return json({
          event: {
            startsAt: "2026-09-01T09:00:00.000Z",
            endsAt: "2026-09-01T17:00:00.000Z",
            timezone: "UTC",
          },
          proposal: { ...proposal(), details: null, canceled_at: null, cancellation_comment: null },
          access: currentAccess(),
          form: null,
          minReviewsRequired: 2,
          sessionTypes: [{ label: "talk", requiresPresentation: true }],
        });
      }
      if (url === `/api/v1/proposals/${PROPOSAL_ID}/speakers`) {
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
      if (url.startsWith(`/api/v1/proposals/${PROPOSAL_ID}/audit-log`)) {
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
      if (url.startsWith(`/api/v1/proposals/${PROPOSAL_ID}/reviews`)) {
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
      if (url.startsWith(`/api/v1/proposals/${PROPOSAL_ID}/comments`)) {
        return json({ comments: [], page: { limit: 25, offset: 0, total: 0, hasMore: false } });
      }
      if (url.startsWith(`/api/v1/proposals/${PROPOSAL_ID}/presentations`)) {
        return json({
          versions: presentationVersions,
          page: { limit: 25, offset: 0, total: presentationVersions.length, hasMore: false },
        });
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

/**
 * Opens a proposal the way a person does.
 *
 * These used to dispatch a click at the `<tr>`, which matched the old
 * implementation's handler on the row — an affordance no keyboard could reach.
 * The row's control is now a real button; clicking that is both what a mouse
 * does and what Enter does.
 */
function rowControl(container: HTMLElement): HTMLElement {
  const control = container.querySelector<HTMLElement>("tbody .pk-table__row-link");
  if (!control) throw new Error("the table row offers no control to activate");
  return control;
}

describe("group event proposal portal", () => {
  it("uses the same canonical detail implementation from the event route", async () => {
    const calls: RequestRecord[] = [];
    stubFetch(calls, access, [presentationVersion]);
    container = document.createElement("div");
    document.body.append(container);
    await act(() => render(<ProposalDetailPage slug={EVENT_SLUG} proposalId={PROPOSAL_ID} />, container!));
    await settle();
    await settle();

    expect(container.textContent).toContain("Read-only proposal");
    expect(calls.some(({ url }) => url === `/api/v1/proposals/${PROPOSAL_ID}`)).toBe(true);
    expect(calls.some(({ url }) => url.includes("/api/v1/admin/"))).toBe(false);
    expect(
      Array.from(container.querySelectorAll<HTMLButtonElement>("button")).some((button) =>
        button.textContent?.includes("Reviews"),
      ),
    ).toBe(false);
    expect(container.textContent).not.toContain("Edit");
    expect(container.textContent).not.toContain("Operator Actions");
    expect(container.textContent).not.toContain("Open Proposer Manage Page");
    expect(calls.filter(({ url }) => url === `/api/v1/proposals/${PROPOSAL_ID}/speakers`)).toHaveLength(0);
    const speakersTab = Array.from(container.querySelectorAll<HTMLButtonElement>("button")).find((button) =>
      button.textContent?.includes("Speakers"),
    );
    await act(async () => speakersTab?.click());
    await settle();
    expect(calls.filter(({ url }) => url === `/api/v1/proposals/${PROPOSAL_ID}/speakers`)).toHaveLength(1);

    const presentationTab = Array.from(container.querySelectorAll<HTMLButtonElement>("button")).find((button) =>
      button.textContent?.includes("Presentation"),
    );
    await act(async () => presentationTab?.click());
    await settle();
    expect(container.textContent).toContain("presentation.pdf");
    expect(container.textContent).toContain("Download");
    expect(container.textContent).not.toContain("Upload on behalf of speaker");
    expect(
      Array.from(container.querySelectorAll<HTMLButtonElement>("button")).some(
        (button) => button.textContent?.trim() === "Review",
      ),
    ).toBe(false);
    expect(
      Array.from(container.querySelectorAll<HTMLButtonElement>("button")).some(
        (button) => button.textContent?.trim() === "Delete",
      ),
    ).toBe(false);
  });

  it("opens the tab named in a preset hash query instead of the default submission tab", async () => {
    const previousHash = window.location.hash;
    window.location.hash = "#/x?proposalTab=reviews";
    try {
      const calls: RequestRecord[] = [];
      stubFetch(calls, { ...access, canReview: true, eventPermissions: ["proposals:score"] });
      container = document.createElement("div");
      document.body.append(container);
      await act(() => render(<ProposalDetailPage slug={EVENT_SLUG} proposalId={PROPOSAL_ID} />, container!));
      await settle();
      await settle();

      const activeTab = container.querySelector(".nav-link.active");
      expect(activeTab?.textContent).toBe("Reviews (0)");
    } finally {
      window.location.hash = previousHash;
    }
  });

  it("does not fetch private reviews or comments for a read-only program identity", async () => {
    const calls: RequestRecord[] = [];
    stubFetch(calls);
    container = document.createElement("div");
    document.body.append(container);
    void act(() => render(<GroupEventProposals groupId={GROUP_ID} eventId={EVENT_ID} />, container!));
    await settle();
    await settle();

    await act(async () => rowControl(container!).click());
    await settle();
    await settle();

    expect(container.textContent).toContain("Read-only proposal");
    expect(container.textContent).not.toContain("Internal Comments");
    expect(calls.some(({ url }) => url.includes("/reviews"))).toBe(false);
    expect(calls.some(({ url }) => url.includes("/comments"))).toBe(false);
    expect(calls.some(({ url }) => url.includes("/audit-log"))).toBe(false);
    expect(calls.some(({ url }) => url.includes("/decisions"))).toBe(false);
    expect(calls.some(({ url }) => url.endsWith(`/proposals/${PROPOSAL_ID}/speakers`))).toBe(false);
  });

  it("shows audit only to reviewers and never renders decision controls without finalize access", async () => {
    const calls: RequestRecord[] = [];
    stubFetch(calls, { ...access, canReview: true, eventPermissions: ["proposals:score"] });
    container = document.createElement("div");
    document.body.append(container);
    await act(() => render(<GroupEventProposals groupId={GROUP_ID} eventId={EVENT_ID} />, container!));
    await settle();
    await settle();
    await act(async () => rowControl(container!).click());
    await settle();
    await settle();

    expect(container.textContent).toContain("Reviews");
    const auditTab = Array.from(container.querySelectorAll<HTMLButtonElement>("button")).find((button) =>
      button.textContent?.includes("Audit Log"),
    );
    expect(auditTab).not.toBeNull();
    await act(async () => auditTab?.click());
    await settle();
    expect(container.textContent).toContain("Audit Log");
    expect(container.textContent).not.toContain("Final decision");
    expect(calls.some(({ url }) => url.includes("/decisions"))).toBe(false);
    expect(calls.some(({ url }) => url.includes("/audit-log"))).toBe(true);
  });

  it("returns to submission when live reviewer access is removed", async () => {
    let currentAccess: typeof access = { ...access, canReview: true, eventPermissions: ["proposals:score"] };
    const calls: RequestRecord[] = [];
    stubFetch(calls, () => currentAccess);
    container = document.createElement("div");
    document.body.append(container);
    await act(() => render(<ProposalDetailPage slug={EVENT_SLUG} proposalId={PROPOSAL_ID} />, container!));
    await settle();
    await settle();

    const reviewsTab = Array.from(container.querySelectorAll<HTMLButtonElement>("button")).find((button) =>
      button.textContent?.includes("Reviews"),
    );
    await act(async () => reviewsTab?.click());
    expect(container.textContent).toContain("Reviews");

    currentAccess = { ...access };
    const refresh = Array.from(container.querySelectorAll<HTMLButtonElement>("button")).find((button) =>
      button.textContent?.includes("Refresh"),
    );
    await act(async () => refresh?.click());
    await settle();
    await settle();

    expect(container.textContent).toContain("Abstract");
    expect(
      Array.from(container.querySelectorAll<HTMLButtonElement>("button")).some((button) =>
        button.textContent?.includes("Reviews"),
      ),
    ).toBe(false);
    expect(
      Array.from(container.querySelectorAll<HTMLButtonElement>("button")).some((button) =>
        button.textContent?.includes("Audit Log"),
      ),
    ).toBe(false);
  });

  it("loads speakers through the canonical proposal resource and keeps all actions off admin paths", async () => {
    const calls: RequestRecord[] = [];
    stubFetch(calls, { ...access, canReview: true, canFinalize: true, eventPermissions: ["proposals:manage"] });
    container = document.createElement("div");
    document.body.append(container);
    await act(() =>
      render(
        <>
          <GroupEventProposals groupId={GROUP_ID} eventId={EVENT_ID} />
          <ConfirmDialogHost />
        </>,
        container!,
      ),
    );
    await settle();
    await settle();
    await act(async () => rowControl(container!).click());
    await settle();
    await settle();

    expect(container.textContent).toContain("Speakers");
    expect(container.textContent).toContain("Operator Actions");
    expect(container.textContent).toContain("Open Proposer Manage Page");
    expect(calls.some(({ url }) => url.includes("/api/v1/admin/"))).toBe(false);

    const speakersTab = Array.from(container.querySelectorAll<HTMLButtonElement>("button")).find((button) =>
      button.textContent?.includes("Speakers"),
    );
    await act(async () => speakersTab?.click());
    await settle();
    expect(calls.filter(({ url }) => url.endsWith(`/proposals/${PROPOSAL_ID}/speakers`))).toHaveLength(1);

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
    expect(calls.some(({ url, method }) => method === "POST" && url.endsWith("/reminders"))).toBe(true);

    const presentationReminder = Array.from(container.querySelectorAll<HTMLButtonElement>("button")).find((button) =>
      button.textContent?.includes("Presentation reminder"),
    );
    await act(async () => presentationReminder?.click());
    await settle();
    expect(calls.filter(({ url, method }) => method === "POST" && url.endsWith("/reminders"))).toHaveLength(2);

    const gravatar = Array.from(container.querySelectorAll<HTMLButtonElement>("button")).find((button) =>
      button.textContent?.includes("Fetch from Gravatar"),
    );
    await act(async () => gravatar?.click());
    await settle();
    expect(calls.some(({ url, method }) => method === "POST" && url.endsWith("/headshot"))).toBe(true);
    expect(proposalSpeakerAssetPath(PROPOSAL_ID, "speaker-1", "headshot")).toContain("/speakers/speaker-1/headshot");

    const remove = container.querySelector<HTMLButtonElement>("[data-remove-proposal-speaker]");
    const replacement = container.querySelector<HTMLSelectElement>("[data-replacement-proposer]");
    if (replacement) {
      await act(async () => {
        replacement.value = "40000000-0000-4000-8000-000000000002";
        replacement.dispatchEvent(new Event("change", { bubbles: true }));
      });
    }
    await act(async () => remove?.click());
    await settle();
    const removeDialog = document.querySelector('[role="alertdialog"]');
    expect(removeDialog).not.toBeNull();
    await act(async () => {
      Array.from(removeDialog?.querySelectorAll("button") ?? [])
        .find((candidate) => candidate.textContent === "Remove speaker")
        ?.click();
    });
    await settle();
    expect(
      calls.some(({ url, method }) => method === "DELETE" && url.includes("/speakers/") && !url.endsWith("/speakers")),
    ).toBe(true);
    expect(calls.some(({ url }) => url.includes("/api/v1/admin/"))).toBe(false);
  });
});
