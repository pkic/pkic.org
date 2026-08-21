import { expect, test } from "@playwright/test";

test("renders the admin proposal detail workflow with submission answers and operator actions", async ({ page }) => {
  const proposalId = "11111111111111111111111111111111";
  const proposerUserId = "22222222222222222222222222222222";
  const formId = "33333333333333333333333333333333";
  const fieldIds = {
    audience: "44444444444444444444444444444444",
    format: "55555555555555555555555555555555",
    tracks: "66666666666666666666666666666666",
    recording: "77777777777777777777777777777777",
  };
  const openedUrls: string[] = [];
  const consoleErrors: string[] = [];
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

  await page.route("**/api/v1/admin/auth/session", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        success: true,
        admin: {
          id: "admin-1",
          email: "admin@pkic.org",
          role: "admin",
          scopes: ["proposals:read", "proposals:score", "proposals:manage"],
          expiresAt: null,
        },
      }),
    });
  });

  await page.route(`**/api/v1/admin/proposals/${proposalId}/open-manage`, async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ manageUrl: "https://app.test/propose-manage/?event=pqc-2026&token=proposal-token" }),
    });
  });

  await page.route(`**/api/v1/admin/proposals/${proposalId}/reviews`, async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        reviews: [
          {
            id: "review-1",
            reviewer_user_id: "reviewer-1",
            reviewer_email: "reviewer@pkic.org",
            reviewer_first_name: "Ada",
            reviewer_last_name: "Reviewer",
            recommendation: "accept",
            score: 9,
            reviewer_comment: "Strong operational framing and practical guidance.",
            applicant_note: "Please keep the examples grounded in deployment constraints.",
            updated_at: "2025-02-01T10:30:00.000Z",
          },
        ],
      }),
    });
  });

  await page.route(`**/api/v1/admin/proposals/${proposalId}/comments`, async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ comments: [] }),
    });
  });

  await page.route(`**/api/v1/admin/proposals/${proposalId}/speakers`, async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        speakers: [
          {
            userId: "speaker-1",
            role: "speaker",
            status: "confirmed",
            email: "speaker@pkic.org",
            firstName: "Sam",
            lastName: "Speaker",
            organizationName: "PKIC",
            jobTitle: "Principal Engineer",
            biography: "Builds production-grade certificate systems for regulated environments.",
            headshotUrl: null,
            confirmedAt: "2025-02-01T09:00:00.000Z",
            declinedAt: null,
            declineReason: null,
            hasHeadshot: false,
            hasBio: true,
          },
        ],
      }),
    });
  });

  await page.route(`**/api/v1/admin/proposals/${proposalId}/presentation/versions`, async (route) => {
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
      body: JSON.stringify({ versions: [] }),
    });
  });

  await page.route(`**/api/v1/admin/proposals/${proposalId}`, async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        proposal: {
          id: proposalId,
          event_id: "event-1",
          proposer_user_id: proposerUserId,
          status: "accepted",
          proposal_type: "panel",
          title: "Operational PKI at Internet Scale",
          abstract: "A practical session on operating certificate platforms with clear failure domains.",
          submitted_at: "2025-01-30T12:00:00.000Z",
          updated_at: "2025-02-01T11:00:00.000Z",
          proposer_email: "speaker@pkic.org",
          proposer_first_name: "Sam",
          proposer_last_name: "Speaker",
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
          canReview: true,
          canFinalize: true,
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
              validation: null,
              sortOrder: 1,
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
              validation: null,
              sortOrder: 2,
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
              validation: null,
              sortOrder: 3,
            },
            {
              id: fieldIds.recording,
              key: "recordingConsent",
              label: "Recording consent",
              fieldType: "boolean",
              required: false,
              options: null,
              validation: null,
              sortOrder: 4,
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

  await page.goto(`/admin/#/events/pqc-2026/proposal/${proposalId}`);

  await expect(page.getByRole("heading", { name: "Operational PKI at Internet Scale" })).toBeVisible();

  // Submission tab is active by default — check abstract card + answer table
  await expect(page.getByRole("heading", { name: "Abstract" })).toBeVisible();
  await expect(page.getByRole("cell", { name: "Panel discussion" })).toBeVisible();
  await expect(page.getByText("Platform operators", { exact: true })).toBeVisible();
  await expect(page.locator("li").filter({ hasText: /^PKI$/ })).toBeVisible();
  await expect(page.locator("li").filter({ hasText: /^Policy$/ })).toBeVisible();

  // Proposer name appears in the stat card header area
  await expect(page.getByText("Sam Speaker").first()).toBeVisible();

  // Review quorum shown in stat cards (always visible)
  await expect(page.getByText("1 / 2 required").first()).toBeVisible();

  // Navigate to Reviews tab to see reviewer details
  await page.getByRole("tab", { name: /Reviews/ }).click();
  await expect(page.getByText("Ada Reviewer")).toBeVisible();

  await page.getByRole("button", { name: "Open Proposer Manage Page ↗" }).click();
  await expect
    .poll(async () => page.evaluate(() => (window as Window & { __openedUrls?: string[] }).__openedUrls ?? []))
    .toContain("https://app.test/propose-manage/?event=pqc-2026&token=proposal-token");
  openedUrls.push(...(await page.evaluate(() => (window as Window & { __openedUrls?: string[] }).__openedUrls ?? [])));

  expect(openedUrls).toContain("https://app.test/propose-manage/?event=pqc-2026&token=proposal-token");

  await page.getByRole("tab", { name: "Presentation" }).click();
  const fileChooserPromise = page.waitForEvent("filechooser");
  await page.getByRole("button", { name: /Upload on behalf of speaker/ }).click();
  const fileChooser = await fileChooserPromise;
  const pdfBody = Buffer.from("%PDF-1.7 admin upload");
  await fileChooser.setFiles({ name: "admin-upload.pdf", mimeType: "application/pdf", buffer: pdfBody });

  await expect.poll(() => adminUpload?.contentType).toBe("application/pdf");
  expect(adminUpload?.fileName).toBe("admin-upload.pdf");
  expect(adminUpload?.fileSize).toBe(String(pdfBody.byteLength));
  expect(adminUpload?.body).toEqual(pdfBody);
  expect(consoleErrors).toEqual([]);
});

test("offers an event-level presentation ZIP from the proposals overview", async ({ page }) => {
  await page.route("**/api/v1/admin/auth/session", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ success: true, admin: { email: "admin@pkic.org" } }),
    });
  });
  await page.route("**/api/v1/admin/events/pqc-2026", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        event: {
          id: "event-1",
          slug: "pqc-2026",
          name: "PQC Conference 2026",
          starts_at: "2026-11-01T09:00:00.000Z",
          venue: "Amsterdam",
        },
      }),
    });
  });
  await page.route("**/api/v1/admin/events/pqc-2026/proposals**", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        proposals: [],
        access: { canReview: true, canFinalize: true, eventPermissions: ["review", "finalize"] },
        stats: { byStatus: {}, byRecommendation: {}, reviewedCount: 0, unreviewedCount: 0, total: 0 },
        pagination: { offset: 0, limit: 50, total: 0, hasMore: false },
      }),
    });
  });

  await page.goto("/admin/#/events/pqc-2026/proposals");

  const currentDownload = page.getByRole("link", { name: "Current presentations" });
  await expect(currentDownload).toBeVisible();
  await expect(currentDownload).toHaveAttribute("href", "/api/v1/admin/events/pqc-2026/presentations/download");

  const allVersionsDownload = page.getByRole("link", { name: "All versions" });
  await expect(allVersionsDownload).toBeVisible();
  await expect(allVersionsDownload).toHaveAttribute(
    "href",
    "/api/v1/admin/events/pqc-2026/presentations/download?versions=all",
  );
});
