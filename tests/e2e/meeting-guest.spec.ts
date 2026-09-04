/**
 * @covers event.3.5
 */
import { expect, test } from "@playwright/test";
import { e2eAdminEmail } from "../helpers/e2e-admin";
import { signInAsE2eStaff } from "./helpers/staff-auth";
import { capturedEmailCount, extractEmailUrl, extractVerificationCode, waitForCapturedEmail } from "./helpers/sendgrid";

const GROUP_ID = "20000000-0000-4000-8000-000000000003";

test("invited external guest verifies the separate mailbox code before meeting entry", async ({ browser, page }) => {
  await signInAsE2eStaff(page, e2eAdminEmail("meeting-guest"));
  const unique = `${Date.now()}-${test.info().workerIndex}`;
  const eventName = `E2E external guest meeting ${unique}`;
  const guestEmail = `meeting-guest-${unique}@example.test`;
  const startsAt = new Date(Date.now() + 3_600_000).toISOString();
  const endsAt = new Date(Date.now() + 7_200_000).toISOString();

  const created = await page.evaluate(
    async ({ groupId, eventName, unique, startsAt, endsAt, guestEmail }) => {
      const seriesResponse = await fetch(`/api/v1/groups/${groupId}/meetings/series`, {
        method: "POST",
        credentials: "same-origin",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          eventName,
          eventSlug: `e2e-external-guest-${unique}`,
          profileKey: "meeting",
          policy: {
            registrationPolicy: "no_registration",
            memberEligibility: "owner_group",
            guestPolicy: "occurrence_invitation",
          },
          startsAt,
          recurrenceRule: "FREQ=WEEKLY;COUNT=1",
          timezone: "UTC",
          durationMinutes: 60,
          location: "Online",
          providerType: "external_url",
        }),
      });
      const seriesBody = (await seriesResponse.json()) as { series?: { id: string }; error?: unknown };
      if (!seriesBody.series) return { stage: "series", status: seriesResponse.status, body: seriesBody };

      const occurrenceResponse = await fetch(
        `/api/v1/groups/${groupId}/meetings/series/${seriesBody.series.id}/occurrences`,
        {
          method: "POST",
          credentials: "same-origin",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            startsAt,
            endsAt,
            providerJoinUrl: `https://meet.example.test/${unique}`,
          }),
        },
      );
      const occurrenceBody = (await occurrenceResponse.json()) as {
        occurrence?: { id: string };
        error?: unknown;
      };
      if (!occurrenceBody.occurrence) {
        return { stage: "occurrence", status: occurrenceResponse.status, body: occurrenceBody };
      }

      const guestResponse = await fetch(
        `/api/v1/groups/${groupId}/meetings/series/${seriesBody.series.id}/occurrences/${occurrenceBody.occurrence.id}/guests`,
        {
          method: "POST",
          credentials: "same-origin",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            email: guestEmail,
            name: "E2E External Guest",
            affiliation: "E2E Guest Organization",
            expiresAt: new Date(Date.now() + 5_400_000).toISOString(),
          }),
        },
      );
      const guestBody = (await guestResponse.json()) as { guest?: { id: string }; error?: unknown };
      return {
        stage: "guest",
        status: guestResponse.status,
        body: guestBody,
        occurrenceId: occurrenceBody.occurrence.id,
      };
    },
    { groupId: GROUP_ID, eventName, unique, startsAt, endsAt, guestEmail },
  );
  expect(created.stage, JSON.stringify(created.body)).toBe("guest");
  expect(created.status, JSON.stringify(created.body)).toBe(201);
  const occurrenceId = created.occurrenceId!;

  const invitationSince = await capturedEmailCount();
  const invitation = await waitForCapturedEmail(guestEmail, "Invitation:", { since: invitationSince - 1 });
  const invitationUrl = extractEmailUrl(invitation, "/meetings/join/");
  expect(invitationUrl).toContain("#/verify?token=pkc1_");
  expect(invitationUrl).toContain(`occurrence=${occurrenceId}`);

  const guestContext = await browser.newContext({ storageState: undefined });
  const guestPage = await guestContext.newPage();
  try {
    const codeSince = await capturedEmailCount();
    await guestPage.goto(invitationUrl);
    await expect(guestPage).toHaveURL(new RegExp(`/meetings/join/\\?occurrence=${occurrenceId}$`));
    await expect(guestPage.getByRole("heading", { name: "Verify your invitation" })).toBeVisible();
    await expect(
      guestPage.getByText("Enter the code sent to the invited email address in this same browser."),
    ).toBeVisible();
    await expect(guestPage.getByText("example.test", { exact: false })).toHaveCount(0);
    await expect(guestPage.getByText("E2E External Guest", { exact: true })).toHaveCount(0);
    await expect(guestPage.getByText("E2E Guest Organization", { exact: true })).toHaveCount(0);

    const codeEmail = await waitForCapturedEmail(guestEmail, "verification code", { since: codeSince });
    // Located by its accessible name: the code input's id belongs to the
    // design system's Field now, and a name survives the next migration too.
    await guestPage.getByLabel("Verification code").fill(extractVerificationCode(codeEmail));
    await guestPage.getByRole("button", { name: "Verify invitation" }).click();

    await expect(guestPage.getByRole("heading", { name: eventName })).toBeVisible();
    await expect(guestPage.getByText("E2E External Guest", { exact: true })).toBeVisible();
    await expect(guestPage.getByText("E2E Guest Organization", { exact: true })).toBeVisible();
    await expect(guestPage.getByRole("button", { name: "Agree and join meeting" })).toBeEnabled();

    await guestPage.route(`https://meet.example.test/${unique}`, (route) =>
      route.fulfill({ status: 200, contentType: "text/html", body: "<h1>Provider reached</h1>" }),
    );
    await guestPage.getByRole("button", { name: "Agree and join meeting" }).click();
    await expect(guestPage).toHaveURL(`https://meet.example.test/${unique}`);
    await expect(guestPage.getByRole("heading", { name: "Provider reached" })).toBeVisible();

    // A verified occurrence-scoped guest capability is not a portal identity.
    const portalSession = await guestPage.request.get("/api/v1/auth/session");
    expect(portalSession.status()).toBe(401);
    await guestPage.goto(`/portal/#/groups/${GROUP_ID}/overview`);
    await expect(guestPage.getByLabel("Email")).toBeVisible();
  } finally {
    await guestContext.close();
  }
});
