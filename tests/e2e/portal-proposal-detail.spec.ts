/**
 * @covers proposal.4.1
 * @covers proposal.4.6
 */
import { expect, test } from "@playwright/test";
import { userAuthSessionResponseSchema } from "../../assets/shared/schemas/user-auth";
import { eventManagementDetailResponseSchema } from "../../assets/shared/schemas/event-management";
import { eventProposalsResponseSchema } from "../../assets/shared/schemas/event-proposals";
import { proposalSpeakersResponseSchema } from "../../assets/shared/schemas/proposal-speakers";
import { definitionFor } from "./helpers/definition-list";
import { tab } from "./helpers/tabs";

const adminSessionResponse = userAuthSessionResponseSchema.parse({
  success: true,
  identity: { id: "10000000000000000000000000000001", email: "admin@pkic.org" },
  staff: {
    id: "admin-1",
    email: "admin@pkic.org",
    role: "admin",
    scopes: [
      "proposals:read",
      "proposals:score",
      "proposals:manage",
      "proposals:edit_accepted_abstract",
      "proposals:cancel_accepted",
    ],
    grants: [],
    expiresAt: null,
  },
});

test("renders the portal proposal detail workflow with submission answers and operator actions", async ({ page }) => {
  const proposalId = "11111111111111111111111111111111";
  const proposerUserId = "22222222222222222222222222222222";
  const formId = "33333333333333333333333333333333";
  const fieldIds = {
    audience: "44444444444444444444444444444444",
    format: "55555555555555555555555555555555",
    tracks: "66666666666666666666666666666666",
    recording: "77777777777777777777777777777777",
  };
  let abstract = "A practical session on operating certificate platforms with clear failure domains.";
  let proposalStatus: "accepted" | "canceled" = "accepted";
  let canceledAt: string | null = null;
  let cancellationComment: string | null = null;
  const openedUrls: string[] = [];
  const consoleErrors: string[] = [];
  const auditOffsets: number[] = [];
  let adminUpload:
    | {
        contentType: string | undefined;
        fileName: string | undefined;
        fileSize: string | undefined;
        body: Buffer | null;
      }
    | undefined;

  page.on("console", (msg) => {
    if (msg.type() === "error") {
      const text = msg.text();
      if (!/\[vite\]|\[HMR\]|favicon|net::ERR_ABORTED/.test(text)) {
        consoleErrors.push(text);
      }
    }
  });

  await page.addInitScript(() => {
    (window as Window & { __openedUrls?: string[] }).__openedUrls = [];
    window.open = ((url?: string | URL) => {
      (window as Window & { __openedUrls?: string[] }).__openedUrls?.push(String(url ?? ""));
      return null;
    }) as typeof window.open;
  });

  // The staff sidebar fetches group feeds on boot; unmocked they hit the real
  // server unauthenticated, and the resulting 401 clears the mocked session.
  await page.route("**/api/v1/groups**", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ groups: [], page: { limit: 12, offset: 0, total: 0, hasMore: false } }),
    });
  });
  await page.route("**/api/v1/users/current/groups**", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ groups: [], page: { limit: 12, offset: 0, total: 0, hasMore: false } }),
    });
  });

  await page.route("**/api/v1/auth/session**", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(adminSessionResponse),
    });
  });

  // The standalone event views now resolve the owning group before
  // rendering; this mocked event has none, so the standalone surface stays.
  await page.route("**/api/v1/events/pqc-2026", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        event: {
          id: "pqc-2026-event-id",
          slug: "pqc-2026",
          name: "PQC 2026",
          timezone: "UTC",
          startsAt: null,
          endsAt: null,
          profileKey: null,
          sourceMode: null,
          registrationPolicy: "no_registration",
          visibility: "public",
          inviteLimitAttendee: 0,
          updatedAt: "2026-08-01T00:00:00.000Z",
          ownerGroupId: null,
          seriesId: null,
          basePath: null,
          userRetentionDays: null,
          venue: null,
          virtualUrl: null,
          heroImageUrl: null,
          location: null,
          sessionTypes: null,
          links: [],
          settings: {},
          capabilities: ["read", "write", "manage"],
        },
      }),
    });
  });

  await page.route(`**/api/v1/proposals/${proposalId}/access-links`, async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ manageUrl: "https://app.test/propose-manage/?event=pqc-2026&token=proposal-token" }),
    });
  });

  await page.route(`**/api/v1/proposals/${proposalId}/reviews**`, async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        proposalId,
        reviews: [
          {
            id: "88888888888888888888888888888881",
            proposal_id: proposalId,
            reviewer_user_id: "88888888888888888888888888888882",
            reviewer_email: "reviewer@pkic.org",
            reviewer_first_name: "Ada",
            reviewer_last_name: "Reviewer",
            review_round: 1,
            recommendation: "accept",
            score: 9,
            reviewer_comment: "Strong operational framing and practical guidance.",
            applicant_note: "Please keep the examples grounded in deployment constraints.",
            created_at: "2025-02-01T10:30:00.000Z",
            updated_at: "2025-02-01T10:30:00.000Z",
          },
        ],
        myReview: null,
        summary: {
          totalReviews: 1,
          averageScore: 9,
          acceptCount: 1,
          needsWorkCount: 0,
          rejectCount: 0,
          minReviewsRequired: 2,
          quorumMet: false,
        },
        page: { limit: 25, offset: 0, total: 1, hasMore: false },
      }),
    });
  });

  await page.route(`**/api/v1/proposals/${proposalId}/comments**`, async (route) => {
    const offset = Number(new URL(route.request().url()).searchParams.get("offset") ?? 0);
    const comments =
      offset === 0
        ? [
            {
              id: "88888888888888888888888888888888",
              proposal_id: proposalId,
              author_user_id: "99999999999999999999999999999999",
              comment: "Newest committee note",
              created_at: "2025-02-01T12:00:00.000Z",
              updated_at: "2025-02-01T12:00:00.000Z",
              author_email: "reviewer@pkic.org",
              author_first_name: "Ada",
              author_last_name: "Reviewer",
            },
          ]
        : [
            {
              id: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
              proposal_id: proposalId,
              author_user_id: "99999999999999999999999999999999",
              comment: "Older committee note",
              created_at: "2025-01-31T12:00:00.000Z",
              updated_at: "2025-01-31T12:00:00.000Z",
              author_email: "reviewer@pkic.org",
              author_first_name: "Ada",
              author_last_name: "Reviewer",
            },
          ];
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        comments,
        page: { limit: 25, offset, total: 2, hasMore: offset === 0 },
      }),
    });
  });

  await page.route(`**/api/v1/proposals/${proposalId}/audit-log**`, async (route) => {
    const url = new URL(route.request().url());
    const offset = Number(url.searchParams.get("offset") ?? 0);
    auditOffsets.push(offset);
    const firstPage = offset === 0;
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        auditLog: [
          {
            id: firstPage ? "audit-first" : "audit-last",
            actor_type: "admin",
            actor_id: "admin-1",
            actor_display: "Ada Reviewer",
            action: firstPage ? "proposal_edited" : "proposal_speaker_removed",
            entity_type: firstPage ? "proposal" : "proposal_speaker",
            entity_id: firstPage ? proposalId : "speaker-removed",
            details: firstPage ? { title: { from: "Old title", to: "Operational PKI at Internet Scale" } } : null,
            created_at: firstPage ? "2025-02-01T11:00:00.000Z" : "2025-01-01T11:00:00.000Z",
          },
        ],
        page: { limit: 50, offset, total: 51, hasMore: firstPage },
      }),
    });
  });

  await page.route(`**/api/v1/proposals/${proposalId}/speakers`, async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(
        proposalSpeakersResponseSchema.parse({
          proposal: {
            id: proposalId,
            title: "Operational PKI at Internet Scale",
            status: "accepted",
            presentationDeadline: null,
            presentationUploaded: false,
            presentationUploadedAt: null,
          },
          summary: {
            total: 1,
            confirmed: 1,
            pending: 0,
            declined: 0,
            profileComplete: 1,
            presentationUploaded: 0,
          },
          speakers: [
            {
              userId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
              role: "speaker",
              status: "confirmed",
              inviteExpiresAt: null,
              email: "speaker@pkic.org",
              firstName: "Sam",
              lastName: "Speaker",
              organizationName: "PKIC",
              jobTitle: "Principal Engineer",
              links: [],
              headshotUpdatedAt: null,
              headshotUrl: null,
              confirmedAt: "2025-02-01T09:00:00.000Z",
              declinedAt: null,
              declineReason: null,
              termsAcceptedAt: null,
              addedAt: "2025-01-30T12:00:00.000Z",
              biography: "Builds production-grade certificate systems for regulated environments.",
              profileComplete: true,
              hasHeadshot: false,
              hasBio: true,
            },
          ],
        }),
      ),
    });
  });

  await page.route(`**/api/v1/proposals/${proposalId}/presentations**`, async (route) => {
    if (route.request().method() === "POST") {
      const headers = route.request().headers();
      adminUpload = {
        contentType: headers["content-type"],
        fileName: headers["x-presentation-file-name"],
        fileSize: headers["x-presentation-file-size"],
        body: route.request().postDataBuffer(),
      };
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ success: true }),
      });
      return;
    }
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        versions: [],
        page: { limit: 25, offset: 0, total: 0, hasMore: false },
      }),
    });
  });

  await page.route(`**/api/v1/proposals/${proposalId}`, async (route) => {
    if (route.request().method() === "PATCH") {
      const body = route.request().postDataJSON() as { abstract?: string; title?: string };
      expect(body.title).toBeUndefined();
      abstract = body.abstract ?? abstract;
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          proposal: {
            id: proposalId,
            title: "Operational PKI at Internet Scale",
            abstract,
            updated_at: "2025-02-01T12:00:00.000Z",
          },
        }),
      });
      return;
    }
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        event: {
          startsAt: "2025-03-01T09:00:00.000Z",
          endsAt: "2025-03-01T17:00:00.000Z",
          timezone: "Europe/Amsterdam",
        },
        proposal: {
          id: proposalId,
          event_id: "event-1",
          proposer_user_id: proposerUserId,
          status: proposalStatus,
          proposal_type: "panel",
          title: "Operational PKI at Internet Scale",
          abstract,
          submitted_at: "2025-01-30T12:00:00.000Z",
          updated_at: "2025-02-01T11:00:00.000Z",
          canceled_at: canceledAt,
          cancellation_comment: cancellationComment,
          proposer_email: "speaker@pkic.org",
          proposer_first_name: "Sam",
          proposer_last_name: "Speaker",
          review_round: 1,
          review_count: 1,
          decision_status: "accepted",
          decision_note: null,
          decision_decided_at: "2025-02-01T11:00:00.000Z",
          details: {
            audience: "Platform operators",
            format: "panel",
            tracks: ["pki", "policy"],
            recordingConsent: true,
          },
        },
        access: {
          eventPermissions: ["review", "finalize"],
          canRead: true,
          canReview: true,
          canFinalize: true,
          canEditAcceptedAbstract: true,
          canCancelAcceptedProposal: true,
        },
        form: {
          id: formId,
          title: "CFP Form",
          description: "Structured submission answers for the review team.",
          fields: [
            {
              id: fieldIds.audience,
              key: "audience",
              label: "Target audience",
              fieldType: "text",
              required: true,
              options: null,
              optionSource: null,
              validation: null,
              sortOrder: 1,
              updatedAt: "2025-01-01T00:00:00.000Z",
              archivedAt: null,
            },
            {
              id: fieldIds.format,
              key: "format",
              label: "Preferred format",
              fieldType: "select",
              required: true,
              options: [
                { value: "talk", label: "Talk" },
                { value: "panel", label: "Panel discussion" },
              ],
              optionSource: null,
              validation: null,
              sortOrder: 2,
              updatedAt: "2025-01-01T00:00:00.000Z",
              archivedAt: null,
            },
            {
              id: fieldIds.tracks,
              key: "tracks",
              label: "Tracks",
              fieldType: "multi_select",
              required: false,
              options: [
                { value: "pki", label: "PKI" },
                { value: "policy", label: "Policy" },
              ],
              optionSource: null,
              validation: null,
              sortOrder: 3,
              updatedAt: "2025-01-01T00:00:00.000Z",
              archivedAt: null,
            },
            {
              id: fieldIds.recording,
              key: "recordingConsent",
              label: "Recording consent",
              fieldType: "boolean",
              required: false,
              options: null,
              optionSource: null,
              validation: null,
              sortOrder: 4,
              updatedAt: "2025-01-01T00:00:00.000Z",
              archivedAt: null,
            },
          ],
        },
        minReviewsRequired: 2,
        sessionTypes: [
          { label: "Panel", requiresPresentation: false },
          { label: "Talk", requiresPresentation: true },
        ],
      }),
    });
  });

  await page.route(`**/api/v1/proposals/${proposalId}/cancellations`, async (route) => {
    const body = route.request().postDataJSON() as { comment: string };
    expect(body.comment).toBe("The speaker is unavailable for the scheduled session.");
    proposalStatus = "canceled";
    canceledAt = "2025-02-01T13:00:00.000Z";
    cancellationComment = body.comment;
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        success: true,
        proposalId,
        status: "canceled",
        canceledAt,
        notifiedSpeakerCount: 1,
      }),
    });
  });

  await page.goto(`/portal/#/events/pqc-2026/proposals/detail/${proposalId}`);

  await expect(page.getByRole("heading", { name: "Operational PKI at Internet Scale" })).toBeVisible();

  // Submission tab is active by default — check abstract card + answer table
  const abstractCard = page.getByRole("heading", { name: "Abstract" }).locator("../..");
  await expect(abstractCard).toBeVisible();
  await abstractCard.getByRole("button", { name: "Edit" }).click();
  await abstractCard.getByRole("textbox").fill("A corrected accepted abstract for the published program.");
  await abstractCard.getByRole("button", { name: "Save" }).click();
  await expect(page.getByText("A corrected accepted abstract for the published program.")).toBeVisible();
  // The submission answers are a description list, not a table: one label and
  // one value each. Asserting the pair rather than the value alone also proves
  // each answer is filed under the question it answers.
  await expect(definitionFor(page, "Preferred format")).toHaveText("Panel discussion");
  await expect(definitionFor(page, "Target audience")).toHaveText("Platform operators");
  const tracks = definitionFor(page, "Tracks").getByRole("listitem");
  await expect(tracks).toHaveText(["PKI", "Policy"]);

  // Proposer name appears in the stat card header area
  await expect(page.getByText("Sam Speaker").first()).toBeVisible();

  // Review quorum shown in stat cards (always visible)
  await expect(page.getByText("1 / 2 required").first()).toBeVisible();

  await expect(page.getByText("Newest committee note")).toBeVisible();
  await page.getByRole("button", { name: "Load more comments" }).click();
  await expect(page.getByText("Older committee note")).toBeVisible();
  await expect(page.getByRole("button", { name: "Load more comments" })).toHaveCount(0);

  // Navigate to Reviews tab to see reviewer details
  await tab(page, /Reviews/).click();
  await expect(page.getByText("Ada Reviewer").first()).toBeVisible();
  await expect(page.getByText("Reviews are read-only after a proposal decision.")).toBeVisible();
  await expect(page.getByRole("button", { name: "Submit Review" })).toHaveCount(0);

  await page.getByRole("button", { name: "Open proposer manage page" }).click();
  await expect
    .poll(async () => page.evaluate(() => (window as Window & { __openedUrls?: string[] }).__openedUrls ?? []))
    .toContain("https://app.test/propose-manage/?event=pqc-2026&token=proposal-token");
  openedUrls.push(...(await page.evaluate(() => (window as Window & { __openedUrls?: string[] }).__openedUrls ?? [])));

  expect(openedUrls).toContain("https://app.test/propose-manage/?event=pqc-2026&token=proposal-token");

  await tab(page, "Audit Log").click();
  await expect(page.getByText("Proposal updated: title")).toBeVisible();
  // The pager is reached by its role and accessible name, and the page it is
  // showing by `aria-current` — `.adm-pager`/`.page-item` were Bootstrap class
  // names that outlived the markup they described.
  const auditPager = page.getByRole("navigation", { name: "Pagination" });
  await expect(auditPager).toContainText("1–1 of 51");
  await expect(auditPager.locator('button[aria-current="page"]')).toHaveText("1");
  await auditPager.getByRole("button", { name: "Next page" }).click();
  await expect(page.getByText("proposal speaker removed")).toBeVisible();
  await expect(auditPager).toContainText("51–51 of 51");
  await expect(auditPager.locator('button[aria-current="page"]')).toHaveText("2");
  expect(auditOffsets).toEqual([0, 50]);

  await tab(page, "Presentation").click();
  const fileChooserPromise = page.waitForEvent("filechooser");
  await page.getByRole("button", { name: /Upload on behalf of speaker/ }).click();
  const fileChooser = await fileChooserPromise;
  const pdfBody = Buffer.from("%PDF-1.7 admin upload");
  await fileChooser.setFiles({ name: "admin-upload.pdf", mimeType: "application/pdf", buffer: pdfBody });

  await expect.poll(() => adminUpload?.contentType).toBe("application/pdf");
  expect(adminUpload?.fileName).toBe("admin-upload.pdf");
  expect(adminUpload?.fileSize).toBe(String(pdfBody.byteLength));
  expect(adminUpload?.body).toEqual(pdfBody);

  await tab(page, "Decision").click();
  // The required marker is no longer part of the label's own words — it is the
  // control's `required` and a "(required)" the label carries for a screen
  // reader — so the field is named by its name and its requirement asserted.
  const speakerComment = page.getByLabel("Comment to speakers");
  await expect(speakerComment).toHaveAttribute("required", "");
  await speakerComment.fill("The speaker is unavailable for the scheduled session.");
  await page.getByLabel("I understand that every speaker linked to this proposal will be notified.").check();
  await page.getByRole("button", { name: "Cancel accepted session" }).click();
  await expect(page.getByText("Session canceled", { exact: true })).toBeVisible();
  await expect(page.getByText("The speaker is unavailable for the scheduled session.")).toBeVisible();

  expect(consoleErrors).toEqual([]);
});

test("offers event presentation archives only with proposal read access", async ({ page }) => {
  let canReadPresentations = false;
  // The staff sidebar fetches group feeds on boot; unmocked they hit the real
  // server unauthenticated, and the resulting 401 clears the mocked session.
  await page.route("**/api/v1/groups**", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ groups: [], page: { limit: 12, offset: 0, total: 0, hasMore: false } }),
    });
  });
  await page.route("**/api/v1/users/current/groups**", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ groups: [], page: { limit: 12, offset: 0, total: 0, hasMore: false } }),
    });
  });

  await page.route("**/api/v1/auth/session**", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(adminSessionResponse),
    });
  });
  await page.route("**/api/v1/events/pqc-2026", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(
        eventManagementDetailResponseSchema.parse({
          event: {
            id: "event-1",
            slug: "pqc-2026",
            name: "PQC Conference 2026",
            timezone: "Europe/Amsterdam",
            startsAt: "2026-11-01T09:00:00.000Z",
            endsAt: null,
            profileKey: "conference",
            sourceMode: "hugo",
            registrationPolicy: "public",
            visibility: "public",
            inviteLimitAttendee: 50,
            updatedAt: "2026-08-29T00:00:00.000Z",
            ownerGroupId: null,
            seriesId: null,
            basePath: null,
            userRetentionDays: null,
            venue: "Amsterdam",
            virtualUrl: null,
            heroImageUrl: null,
            location: "Amsterdam",
            sessionTypes: [],
            links: [],
            settings: {},
            capabilities: ["read", "write"],
          },
        }),
      ),
    });
  });
  await page.route("**/api/v1/events/pqc-2026/proposals**", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(
        eventProposalsResponseSchema.parse({
          proposals: [],
          page: { offset: 0, limit: 50, total: 0, hasMore: false },
          event: { id: "event-1", slug: "pqc-2026", name: "PQC Conference 2026" },
          access: {
            canReview: true,
            canRead: canReadPresentations,
            canFinalize: true,
            canEditAcceptedAbstract: true,
            canCancelAcceptedProposal: true,
            eventPermissions: canReadPresentations ? ["proposals:read", "review", "finalize"] : ["review", "finalize"],
          },
          stats: { byStatus: {}, byRecommendation: {}, reviewedCount: 0, unreviewedCount: 0, total: 0 },
        }),
      ),
    });
  });

  await page.goto("/portal/#/events/pqc-2026/proposals");

  const currentDownload = page.getByRole("link", { name: "Current presentations" });
  const allVersionsDownload = page.getByRole("link", { name: "All presentation versions" });
  await expect(currentDownload).toHaveCount(0);
  await expect(allVersionsDownload).toHaveCount(0);

  canReadPresentations = true;
  await page.reload();

  await expect(currentDownload).toBeVisible();
  await expect(currentDownload).toHaveAttribute("href", "/api/v1/events/pqc-2026/presentations/archive");

  await expect(allVersionsDownload).toBeVisible();
  await expect(allVersionsDownload).toHaveAttribute(
    "href",
    "/api/v1/events/pqc-2026/presentations/archive?versions=all",
  );
});
