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
      return { status: response.status, body: text ? JSON.parse(text) : null };
    },
    { path, method, body },
  );
}

function expectStatus(result: ApiResult, status: number): Record<string, unknown> {
  expect(result.status, JSON.stringify(result.body)).toBe(status);
  return result.body as Record<string, unknown>;
}

async function createPublicGroupEvent(page: Page, unique: string): Promise<{ id: string; slug: string; name: string }> {
  const slug = `portal-invitation-${unique}`;
  const name = `Portal invitation lifecycle ${unique}`;
  const base = `/api/v1/groups/${GROUP_ID}/events`;
  const created = expectStatus(
    await api(page, base, "POST", {
      slug,
      name,
      timezone: "Europe/Amsterdam",
      startsAt: "2027-08-10T09:00:00.000Z",
      endsAt: "2027-08-10T17:00:00.000Z",
      profileKey: "workshop",
      registrationPolicy: "no_registration",
      links: [],
    }),
    201,
  );
  const event = created.event as { id: string; updatedAt: string };

  const terms = expectStatus(
    await api(page, `${base}/${event.id}/terms`, "PUT", {
      expectedUpdatedAt: event.updatedAt,
      configuration: {
        attendee: [{ termKey: "e2e-invitation-terms", version: "1.0", required: true, displayText: "E2E terms" }],
        speaker: [],
        presentation: [],
      },
    }),
    200,
  );
  expectStatus(
    await api(page, `${base}/${event.id}/registration-settings`, "PUT", {
      expectedUpdatedAt: terms.eventUpdatedAt,
      registrationPolicy: "public",
      formId: null,
    }),
    200,
  );
  return { id: event.id, slug, name };
}

test("a selected-group manager manages an attendee invitation without admin APIs", async ({ page }) => {
  await signInToPortal(page, e2eAdminEmail("portal-event"));
  const unique = `${Date.now()}-${test.info().workerIndex}`;
  const event = await createPublicGroupEvent(page, unique);
  const inviteeEmail = `portal-invitee-${unique}@pkic.org`;

  const adminRequests: string[] = [];
  const groupInviteRequests: string[] = [];
  page.on("request", (request) => {
    const pathname = new URL(request.url()).pathname;
    if (pathname.startsWith("/api/v1/admin/")) adminRequests.push(`${request.method()} ${pathname}`);
    if (
      pathname === `/api/v1/groups/${GROUP_ID}/events/${event.id}/invites` ||
      pathname.startsWith(`/api/v1/groups/${GROUP_ID}/events/${event.id}/invites/`)
    ) {
      groupInviteRequests.push(`${request.method()} ${request.url()}`);
    }
  });

  await page.goto(`/portal/#/groups/${GROUP_ID}/events`);
  await page.getByPlaceholder("Search events…").fill(event.slug);
  await page.getByPlaceholder("Search events…").press("Enter");
  const eventRow = page.getByRole("row").filter({ hasText: event.name });
  await expect(eventRow).toBeVisible();
  await eventRow.getByRole("button", { name: "Details" }).click();

  const detail = page.getByRole("region", { name: `${event.name} details` });
  await expect(detail.getByRole("heading", { name: "Attendee invitations" })).toBeVisible();
  const invitations = detail.getByRole("region", { name: "Attendee invitations" });
  await invitations.getByRole("textbox", { name: /Paste emails and names/i }).fill(`Portal Invitee <${inviteeEmail}>`);
  await invitations.getByRole("button", { name: "Parse" }).click();
  await invitations.getByRole("button", { name: "Preview email" }).click();
  await expect(invitations.getByText("Review and confirm below.")).toBeVisible();
  await invitations.getByRole("checkbox").check();
  const created = page.waitForResponse(
    (response) => response.url().endsWith("/invites/attendees/bulk") && response.request().method() === "POST",
  );
  await invitations.getByRole("button", { name: "Send attendee invites" }).click();
  expect((await created).status()).toBe(200);
  await expect(invitations.getByText("Sent 1 invites")).toBeVisible();

  const invitationSearch = invitations.getByPlaceholder("Search invitations…");
  await invitationSearch.fill(inviteeEmail);
  await invitationSearch.press("Enter");
  const inviteRow = invitations.getByRole("row").filter({ hasText: inviteeEmail });
  await expect(inviteRow).toBeVisible();

  const resent = page.waitForResponse(
    (response) =>
      response.url().includes(`/events/${event.id}/invites/`) &&
      response.url().endsWith("/resend") &&
      response.request().method() === "POST",
  );
  await inviteRow.getByRole("button", { name: `Resend invitation to Portal Invitee` }).click();
  expect((await resent).status()).toBe(200);
  await expect(detail.getByText(`Invitation resent to Portal Invitee.`)).toBeVisible();

  page.once("dialog", (dialog) => void dialog.accept());
  const revoked = page.waitForResponse(
    (response) =>
      response.url().includes(`/events/${event.id}/invites/`) &&
      response.url().endsWith("/revoke") &&
      response.request().method() === "POST",
  );
  await inviteRow.getByRole("button", { name: `Revoke invitation for Portal Invitee` }).click();
  expect((await revoked).status()).toBe(200);
  await expect(detail.getByText(`Invitation revoked for Portal Invitee.`)).toBeVisible();
  await expect(inviteRow.getByText("Revoked", { exact: true })).toBeVisible();

  expect(adminRequests, "portal invitation lifecycle must not call admin APIs").toEqual([]);
  expect(groupInviteRequests).toEqual(
    expect.arrayContaining([
      expect.stringMatching(/^GET .*\/api\/v1\/groups\/.*\/events\/.*\/invites\?.*q=/),
      expect.stringMatching(/^POST .*\/api\/v1\/groups\/.*\/events\/.*\/invites\/attendees\/preview$/),
      expect.stringMatching(/^POST .*\/api\/v1\/groups\/.*\/events\/.*\/invites\/attendees\/bulk$/),
      expect.stringMatching(/^POST .*\/api\/v1\/groups\/.*\/events\/.*\/invites\/.*\/resend$/),
      expect.stringMatching(/^POST .*\/api\/v1\/groups\/.*\/events\/.*\/invites\/.*\/revoke$/),
    ]),
  );
});
