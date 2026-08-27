import { expect, test, type Page } from "@playwright/test";
import { e2eAdminEmail } from "../helpers/e2e-admin";
import { signInToPortal } from "./helpers/portal-auth";

const GROUP_ID = "20000000-0000-4000-8000-000000000003";

type ApiResult = { status: number; body: unknown };

async function api(page: Page, path: string, method: string, body?: unknown): Promise<ApiResult> {
  return page.evaluate(
    async ({ path: requestPath, method: requestMethod, body: requestBody }) => {
      const response = await fetch(requestPath, {
        method: requestMethod,
        credentials: "same-origin",
        headers: requestBody === undefined ? undefined : { "content-type": "application/json" },
        body: requestBody === undefined ? undefined : JSON.stringify(requestBody),
      });
      const text = await response.text();
      let parsed: unknown;
      try {
        parsed = text ? JSON.parse(text) : null;
      } catch {
        parsed = text;
      }
      return { status: response.status, body: parsed };
    },
    { path, method, body },
  );
}

function expectStatus(result: ApiResult, status: number): Record<string, unknown> {
  expect(result.status, JSON.stringify(result.body)).toBe(status);
  return result.body as Record<string, unknown>;
}

test("portal proposal detail uses canonical me/groups routes without admin fallback", async ({ page }) => {
  await signInToPortal(page, e2eAdminEmail("portal-event"));
  const unique = `${Date.now()}-${test.info().workerIndex}`;
  const createdEvent = expectStatus(
    await api(page, `/api/v1/groups/${GROUP_ID}/events`, "POST", {
      slug: `portal-proposal-${unique}`,
      name: `Portal proposal ${unique}`,
      timezone: "Europe/Amsterdam",
      startsAt: "2027-09-10T09:00:00.000Z",
      endsAt: "2027-09-10T17:00:00.000Z",
      profileKey: "workshop",
      registrationPolicy: "no_registration",
      links: [],
    }),
    201,
  ).event as { id: string; slug: string; updatedAt: string };
  const terms = expectStatus(
    await api(page, `/api/v1/groups/${GROUP_ID}/events/${createdEvent.id}/terms`, "PUT", {
      expectedUpdatedAt: createdEvent.updatedAt,
      configuration: {
        attendee: [],
        speaker: [{ termKey: "e2e-proposal-terms", version: "1.0", required: true, displayText: "E2E proposal terms" }],
        presentation: [],
      },
    }),
    200,
  );
  const event = { ...createdEvent, updatedAt: terms.eventUpdatedAt as string };
  const created = expectStatus(
    await api(page, `/api/v1/events/${event.slug}/proposals`, "POST", {
      proposer: {
        firstName: "Portal",
        lastName: "Proposer",
        email: `portal-proposer-${unique}@pkic.org`,
        organizationName: "E2E Organization",
        jobTitle: "Engineer",
      },
      proposal: {
        type: "talk",
        title: "Canonical portal proposal journey",
        abstract:
          "A sufficiently detailed proposal abstract for verifying the real Worker and D1 portal proposal journey.",
      },
      consents: [{ termKey: "e2e-proposal-terms", version: "1.0" }],
    }),
    200,
  );
  const proposalId = created.proposalId as string;
  expect(proposalId).toBeTruthy();

  const adminRequests: string[] = [];
  const meRequests: string[] = [];
  const groupRequests: string[] = [];
  page.on("request", (request) => {
    const pathname = new URL(request.url()).pathname;
    if (pathname.startsWith("/api/v1/admin/")) adminRequests.push(`${request.method()} ${pathname}`);
    if (pathname.startsWith("/api/v1/me/")) meRequests.push(`${request.method()} ${pathname}`);
    if (pathname.startsWith(`/api/v1/groups/${GROUP_ID}/events/${event.id}/proposals`)) {
      groupRequests.push(`${request.method()} ${pathname}`);
    }
  });

  await page.goto(`/portal/#/groups/${GROUP_ID}/events/${event.id}/proposals`);
  await expect(page.getByRole("heading", { name: "Proposal program", exact: true })).toBeVisible();
  const row = page.getByRole("row").filter({ hasText: "Canonical portal proposal journey" });
  await expect(row).toBeVisible();
  await row.click();
  await expect(page.getByText("Canonical portal proposal journey", { exact: true })).toBeVisible();
  await expect(page.getByText("Audit log", { exact: true })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Speakers", exact: true })).toBeVisible();
  await expect(page.getByLabel("Proposal speakers").getByText("Portal Proposer", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Edit profile" }).click();
  await page.getByRole("textbox", { name: "Biography" }).fill("Updated through the canonical group portal.");
  await page.getByRole("button", { name: "Save profile" }).click();
  await expect(page.getByText("Updated through the canonical group portal.", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: /Profile reminder/ }).click();
  await expect(page.getByText("Profile reminder sent", { exact: true })).toBeVisible();

  const coSpeakerEmail = `portal-co-speaker-${unique}@pkic.org`;
  const coSpeakerDeadline = "2027-09-10T15:30";
  const coSpeakerInviteResponse = page.waitForResponse(
    (response) =>
      response.request().method() === "POST" &&
      response.url().includes(`/api/v1/groups/${GROUP_ID}/events/${event.id}/proposals/${proposalId}/speakers`),
  );
  const speakerPanel = page.getByLabel("Proposal speakers");
  await speakerPanel.getByLabel("Email address").fill(coSpeakerEmail);
  await speakerPanel.getByLabel("First name").fill("Portal");
  await speakerPanel.getByLabel("Last name").fill("Co Speaker");
  await speakerPanel.getByLabel("Proposal role").selectOption("co_speaker");
  await speakerPanel.getByLabel("Invitation deadline").fill(coSpeakerDeadline);
  await speakerPanel.getByRole("button", { name: "Invite co-speaker" }).click();
  const invitation = (await coSpeakerInviteResponse).json() as Promise<{
    email: string;
    expiresAt: string;
    role: string;
    queued: boolean;
  }>;
  await expect(speakerPanel.locator("strong").filter({ hasText: /^Portal Co Speaker$/ })).toBeVisible();
  await expect(speakerPanel.getByText(coSpeakerEmail, { exact: true })).toBeVisible();
  await expect(page.getByText(`Invitation queued for ${coSpeakerEmail}`, { exact: true })).toBeVisible();
  await expect(invitation).resolves.toEqual({
    success: true,
    email: coSpeakerEmail,
    role: "co_speaker",
    expiresAt: "2027-09-10T13:30:00.000Z",
    queued: true,
  });

  expect(adminRequests, "portal proposals must not call admin APIs").toEqual([]);
  expect(meRequests).toEqual(expect.arrayContaining(["GET /api/v1/me/proposal-programs"]));
  expect(groupRequests).toEqual(
    expect.arrayContaining([
      expect.stringMatching(/^GET \/api\/v1\/groups\/.*\/events\/.*\/proposals$/),
      expect.stringMatching(/^GET \/api\/v1\/groups\/.*\/events\/.*\/proposals\/.*$/),
      expect.stringMatching(/^GET \/api\/v1\/groups\/.*\/events\/.*\/proposals\/.*\/audit-log$/),
      expect.stringMatching(/^GET \/api\/v1\/groups\/.*\/events\/.*\/proposals\/.*\/speakers$/),
      expect.stringMatching(/^POST \/api\/v1\/groups\/.*\/events\/.*\/proposals\/.*\/speakers$/),
      expect.stringMatching(/^PATCH \/api\/v1\/groups\/.*\/events\/.*\/proposals\/.*\/speakers\/.*$/),
      expect.stringMatching(/^POST \/api\/v1\/groups\/.*\/events\/.*\/proposals\/.*\/speakers\/.*\/remind$/),
    ]),
  );
});
