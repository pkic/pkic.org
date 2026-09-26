/**
 * @covers proposal.4.7
 */
import { expect, test, type Page } from "@playwright/test";
import { e2eAdminEmail } from "../helpers/e2e-admin";
import { openRow } from "./helpers/data-table";
import { signInToPortal } from "./helpers/portal-auth";
import { tab } from "./helpers/tabs";

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

test("portal proposal detail uses canonical proposal resources without admin fallback", async ({ page }) => {
  await signInToPortal(page, e2eAdminEmail("portal-event-proposals"));
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
  const proposalRequests: string[] = [];
  page.on("request", (request) => {
    const pathname = new URL(request.url()).pathname;
    if (pathname.startsWith("/api/v1/admin/")) adminRequests.push(`${request.method()} ${pathname}`);
    if (pathname.startsWith("/api/v1/proposals/") || pathname === `/api/v1/events/${event.slug}/proposals`) {
      proposalRequests.push(`${request.method()} ${pathname}`);
    }
  });

  await page.goto(`/portal/#/groups/${GROUP_ID}/events/${event.id}/proposals`);
  // The catalogue is the one list panel, not a titled panel restating the trail.
  await expect(page.getByRole("table", { name: "Event proposals" })).toBeVisible();
  const row = page.getByRole("row").filter({ hasText: "Canonical portal proposal journey" });
  await expect(row).toBeVisible();
  // A row is a link to the proposal's own page, so the address bar follows.
  await openRow(row, "Open Canonical portal proposal journey");
  await expect(page).toHaveURL(new RegExp(`#/groups/${GROUP_ID}/events/${event.id}/proposals/${proposalId}$`));
  await expect(page.getByRole("heading", { name: "Canonical portal proposal journey", exact: true })).toBeVisible();
  const auditResponse = page.waitForResponse(
    (response) =>
      response.request().method() === "GET" &&
      new URL(response.url()).pathname === `/api/v1/proposals/${proposalId}/audit-log`,
  );
  // Scoped to the proposal's own tab strip: the group workspace around it
  // carries an "Audit log" tab of its own, and an unscoped lookup names both.
  // The facets are URLs, so the strip is navigation rather than a tablist.
  const proposalTabs = page.getByRole("navigation", { name: "Proposal sections" });
  await tab(proposalTabs, "Audit log").click();
  expect((await auditResponse).status()).toBe(200);
  await expect(page).toHaveURL(/\/audit-log$/);
  await expect(page.getByRole("heading", { name: "Audit log", exact: true })).toBeVisible();
  await tab(proposalTabs, "Speakers").click();
  await expect(page.getByRole("heading", { name: "Speakers", exact: true })).toBeVisible();
  const speakerPanel = page.getByRole("region", { name: "Proposal speakers" });
  await expect(speakerPanel.getByText("Portal Proposer", { exact: true })).toBeVisible();
  // A speaker's commands sit behind the card's own menu; editing turns the
  // card's values into inputs in place.
  await page.getByRole("button", { name: "Actions for Portal Proposer" }).click();
  await page.getByRole("menuitem", { name: "Edit profile" }).click();
  await page.getByRole("textbox", { name: "Biography" }).fill("Updated through the canonical group portal.");
  await page.getByRole("button", { name: "Save profile" }).click();
  await expect(page.getByText("Updated through the canonical group portal.", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Actions for Portal Proposer" }).click();
  await page.getByRole("menuitem", { name: "Send profile reminder" }).click();
  await expect(page.getByText("Profile reminder sent", { exact: true })).toBeVisible();

  const coSpeakerEmail = `portal-co-speaker-${unique}@pkic.org`;
  const coSpeakerDeadline = "2027-09-10T15:30";
  const coSpeakerInviteResponse = page.waitForResponse(
    (response) =>
      response.request().method() === "POST" && response.url().includes(`/api/v1/proposals/${proposalId}/speakers`),
  );
  // Inviting is a page of its own under the roster, with its own address.
  await speakerPanel.getByRole("link", { name: "Invite co-speaker" }).click();
  await expect(page).toHaveURL(/\/speakers\/new$/);
  const invitePage = page.getByRole("region", { name: "Invite a co-speaker" });
  await invitePage.getByLabel("Email address").fill(coSpeakerEmail);
  await invitePage.getByLabel("First name").fill("Portal");
  await invitePage.getByLabel("Last name").fill("Co Speaker");
  await invitePage.getByLabel("Proposal role").selectOption("co_speaker");
  await invitePage.getByLabel("Invitation deadline").fill(coSpeakerDeadline);
  await invitePage.getByRole("button", { name: "Invite co-speaker" }).click();
  const invitation = (await coSpeakerInviteResponse).json() as Promise<{
    email: string;
    expiresAt: string;
    role: string;
    queued: boolean;
  }>;
  await expect(page.getByText(`Invitation queued for ${coSpeakerEmail}`, { exact: true })).toBeVisible();
  // Sending returns to the roster, which now lists the invitee.
  await expect(page).toHaveURL(/\/speakers$/);
  await expect(speakerPanel.locator("strong").filter({ hasText: /^Portal Co Speaker$/ })).toBeVisible();
  await expect(speakerPanel.getByText(coSpeakerEmail, { exact: true })).toBeVisible();
  await expect(invitation).resolves.toEqual({
    success: true,
    email: coSpeakerEmail,
    role: "co_speaker",
    expiresAt: "2027-09-10T13:30:00.000Z",
    queued: true,
  });

  expect(adminRequests, "portal proposals must not call admin APIs").toEqual([]);
  expect(proposalRequests).toEqual(
    expect.arrayContaining([
      `GET /api/v1/events/${event.slug}/proposals`,
      `GET /api/v1/proposals/${proposalId}`,
      `GET /api/v1/proposals/${proposalId}/audit-log`,
      `GET /api/v1/proposals/${proposalId}/speakers`,
      `POST /api/v1/proposals/${proposalId}/speakers`,
      expect.stringMatching(new RegExp(`^PATCH /api/v1/proposals/${proposalId}/speakers/`)),
      expect.stringMatching(new RegExp(`^POST /api/v1/proposals/${proposalId}/speakers/.*/reminders$`)),
    ]),
  );
});
