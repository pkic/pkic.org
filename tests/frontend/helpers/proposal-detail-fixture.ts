/**
 * The proposal a detail page is mounted against: one read-only proposal with
 * every subresource the page can fetch, stubbed at the canonical proposal
 * routes. Shared by the detail suite and the routed-record suite so the two
 * describe the same record.
 */
import { act } from "preact/test-utils";
import { vi } from "vitest";

export const GROUP_ID = "10000000-0000-4000-8000-000000000001";
export const EVENT_ID = "20000000-0000-4000-8000-000000000001";
export const EVENT_SLUG = "event";
export const PROPOSAL_ID = "30000000-0000-4000-8000-000000000001";
export function json(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), { status, headers: { "content-type": "application/json" } });
}

export const access = {
  eventPermissions: ["proposals:read"],
  canRead: true,
  canReview: false,
  canFinalize: false,
  canEditAcceptedAbstract: false,
  canCancelAcceptedProposal: false,
};

export function proposal() {
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

export function speaker(userId: string, role: "proposer" | "speaker" = "speaker") {
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

export type RequestRecord = { url: string; method: string };
export type DetailAccess = typeof access | (() => typeof access);

export const presentationVersion = {
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

export function stubFetch(
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

export async function settle(): Promise<void> {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}
