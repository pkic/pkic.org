/**
 * Every participant gets their own link to the meeting — and it is only
 * their own.
 *
 * The consortium wanted to know who actually comes to a meeting, which one
 * address forwarded around a company cannot answer (#6). The stable personal
 * calendar link names the recipient, but a new browser still needs a fresh
 * member sign-in before it can join or remember that identity.
 *
 * @covers event.3.10
 */
import type { EventOccurrence } from "../../assets/shared/schemas/event-series";
import { expect, test } from "@playwright/test";
import { e2eAdminEmail } from "../helpers/e2e-admin";
import { acceptConfirmDialog } from "./helpers/confirm-dialog";
import { clientIpForIdentity, openEmailSignIn } from "./helpers/portal-auth";
import { signInAsE2eStaff } from "./helpers/staff-auth";
import { capturedEmailCount, extractEmailUrl, waitForCapturedEmail } from "./helpers/sendgrid";

const GROUP_ID = "20000000-0000-4000-8000-000000000003";

for (const broadcast of [false, true]) {
  test(`a manager sends a personal ${broadcast ? "broadcast" : "meeting"} link and the participant signs in to use it`, async ({
    browser,
    page,
  }) => {
    await signInAsE2eStaff(page, e2eAdminEmail("meeting-participant-links"));

    const unique = `${String(Date.now())}-${String(test.info().workerIndex)}`;
    const eventName = `E2E participant links ${unique}`;
    const startsAt = new Date(Date.now() + 3_600_000).toISOString();

    /*
     * A member of the consortium, seated in the meeting's group. Created here
     * rather than borrowed from the seeded governance rosters, which carry real
     * people: this test sends mail, and the only address it may send to is one
     * it invented.
     */
    const participantEmail = `participant-${unique}@participant-${unique}.test`;
    const created = await page.evaluate(
      async ({ groupId, eventName, unique, startsAt, participantEmail, broadcast }) => {
        async function post(path: string, body: unknown) {
          const response = await fetch(path, {
            method: "POST",
            credentials: "same-origin",
            headers: { "content-type": "application/json" },
            body: JSON.stringify(body),
          });
          return { status: response.status, body: (await response.json()) as Record<string, any> };
        }

        const organization = await post("/api/v1/organizations", {
          name: `E2E Participant Links Corp ${unique}`,
          membershipCategory: "F",
          memberSince: new Date().toISOString().slice(0, 10),
          identities: [{ name: "E2E Meeting Participant", email: participantEmail }],
          workingGroupSlugs: [],
          activationReason: "E2E: a participant to send a meeting link to",
        });
        const participantUserId = organization.body.organization?.identities?.[0]?.userId as string | undefined;
        if (!participantUserId) return { stage: "organization", ...organization };

        const seat = await post(`/api/v1/groups/${groupId}/memberships/${participantUserId}`, {
          capacitySelection: { mode: "all_eligible", confirmed: true },
        });
        if (seat.status !== 200) return { stage: "seat", ...seat };

        const series = await post(`/api/v1/groups/${groupId}/meetings/series`, {
          eventName,
          eventSlug: `e2e-participant-links-${unique}`,
          profileKey: broadcast ? "conference" : "meeting",
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
        });
        if (!series.body.series) return { stage: "series", ...series };

        const seriesId = series.body.series.id as string;
        const occurrencePath = `/api/v1/groups/${groupId}/meetings/series/${seriesId}/occurrences`;
        const generatedResponse = await fetch(occurrencePath, { credentials: "same-origin" });
        const generated = ((await generatedResponse.json()) as { occurrences: EventOccurrence[] }).occurrences[0];
        const configured = await fetch(`${occurrencePath}/${generated.id}`, {
          method: "PATCH",
          credentials: "same-origin",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            expectedUpdatedAt: generated.updatedAt,
            providerJoinUrl: broadcast
              ? "https://www.youtube.com/live/jfKfPfyJRdk"
              : `https://meet.example.test/${unique}`,
          }),
        });
        const occurrence = {
          status: configured.status,
          body: (await configured.json()) as { occurrence?: EventOccurrence },
        };
        if (!occurrence.body.occurrence) return { stage: "occurrence", ...occurrence };

        return {
          stage: "ready",
          status: occurrence.status,
          body: occurrence.body,
          seriesId,
          participantUserId,
          occurrenceId: occurrence.body.occurrence.id as string,
        };
      },
      { groupId: GROUP_ID, eventName, unique, startsAt, participantEmail, broadcast },
    );
    expect(created.stage, JSON.stringify(created.body)).toBe("ready");
    const occurrenceId = created.occurrenceId!;

    // The manager sends the round from the meeting itself, where they set it
    // up, through the occurrence's own routed record page.
    await page.goto(`/portal/#/groups/${GROUP_ID}/meetings/${created.seriesId!}/settings`);
    const settingsForm = page.locator("form").filter({ has: page.getByRole("button", { name: "Meeting actions" }) });
    await expect(settingsForm.locator("input")).toHaveCount(0);
    async function editSeries() {
      await page.getByRole("button", { name: "Meeting actions" }).click();
      await page.getByRole("menuitem", { name: "Edit settings" }).click();
    }
    await editSeries();
    await page.getByLabel("Meeting name").fill("");
    await page.getByRole("button", { name: "Save series", exact: true }).click();
    await expect(page.getByLabel("Meeting name")).toHaveAttribute("aria-invalid", "true");
    await page.getByRole("button", { name: "Cancel", exact: true }).click();
    await editSeries();
    await expect(page.getByLabel("Meeting name")).toHaveValue(eventName);
    for (const label of ["Time zone", "First occurrence", "Duration (minutes)"]) {
      await expect(page.getByLabel(label)).toBeDisabled();
    }
    await page.getByLabel("Physical location", { exact: true }).fill("Online meeting room");
    const savedSeries = page.waitForResponse(
      (response) =>
        response.url().endsWith(`/meetings/series/${created.seriesId!}`) && response.request().method() === "PATCH",
    );
    await page.getByRole("button", { name: "Save series", exact: true }).click();
    expect((await savedSeries).status()).toBe(200);
    await expect(page.getByLabel("Meeting name")).toHaveCount(0);
    await page.reload();
    await expect(page.getByText("Online meeting room", { exact: true })).toBeVisible();
    await editSeries();
    await expect(page.getByLabel("Physical location", { exact: true })).toHaveValue("Online meeting room");
    await page.getByRole("button", { name: "Cancel", exact: true }).click();

    await page.goto(`/portal/#/groups/${GROUP_ID}/meetings/${created.seriesId!}/occurrences`);
    const row = page.getByRole("row").filter({ hasText: "Scheduled" }).first();
    await expect(row).toBeVisible({ timeout: 15_000 });
    await row.getByRole("button", { name: /^Actions for / }).click();
    const downloadReady = page.waitForEvent("download");
    await page.getByRole("menuitem", { name: "Download calendar" }).click();
    const download = await downloadReady;
    expect(download.suggestedFilename()).toContain("e2e-participant-links");
    await expect(row.getByRole("checkbox")).toBeVisible();
    // The row opens the occurrence's own page (#126) — a record with its
    // commands in its menu — never an expansion under the row.
    await row.getByRole("link", { name: /^Open the occurrence starting / }).click();
    await expect(page).toHaveURL(new RegExp(`/meetings/${created.seriesId!}/occurrences/${occurrenceId}$`));
    await expect(page.getByText("No join links have been sent for this meeting yet")).toBeVisible({
      timeout: 15_000,
    });
    // Nothing opens in edit mode: the settings are read until asked for.
    await expect(page.getByRole("form", { name: "Edit occurrence" })).toHaveCount(0);

    const since = await capturedEmailCount();
    await page.getByRole("button", { name: "Occurrence actions" }).click();
    await page.getByRole("menuitem", { name: "Send join links…" }).click();
    await acceptConfirmDialog(page, "Send join links");
    await expect(page.locator(".my-toast", { hasText: /Join links queued for \d+ participants?/ })).toBeVisible();
    // The header says which round went out, so a manager deciding whether to
    // remind can see it without opening the audit log.
    await expect(page.getByText(/^Round 1 went out /)).toBeVisible({ timeout: 15_000 });
    await page.getByRole("button", { name: "Occurrence actions" }).click();
    await expect(page.getByRole("menuitem", { name: "Send join links again…" })).toBeVisible();
    await page.keyboard.press("Escape");
    // Who was invited, and that their calendar has not answered yet, is a
    // facet of the record.
    await page.getByRole("link", { name: "Invitations" }).click();
    await expect(page.getByRole("row").filter({ hasText: participantEmail })).toContainText("No answer");

    // The reused local server has no scheduled outbox drain. Process the bounded
    // synthetic backlog left by earlier journeys, as the scheduler does in preview.
    const drained = await page.request.post("/api/v1/email/outbox/process", { data: { limit: 100 } });
    expect(drained.status()).toBe(200);
    const invitation = await waitForCapturedEmail(participantEmail, eventName, { since: since - 1 });
    const joinUrl = extractEmailUrl(invitation, "/m/#token=m2.");
    expect(joinUrl).toMatch(/\/m\/#token=m2(?:\.[A-Za-z0-9_-]{22}){4}$/);
    expect(joinUrl).not.toContain(`occurrence=${occurrenceId}`);
    expect(joinUrl).not.toContain("meet.example.test");

    /*
     * The forwarded URL can identify the invitee, but cannot open the provider
     * without a separate member sign-in on this browser.
     */
    const forwarded = await browser.newContext({ storageState: undefined });
    const forwardedPage = await forwarded.newPage();
    try {
      await forwardedPage.goto(joinUrl);
      await expect(forwardedPage.getByRole("alert")).toContainText("Welcome, E2E Meeting Participant.", {
        timeout: 15_000,
      });
      await expect(forwardedPage.getByRole("button", { name: "Verify and continue" })).toBeVisible();
      await expect(forwardedPage.getByRole("heading", { name: eventName })).toHaveCount(0);
      await expect(forwardedPage.getByRole("button", { name: /join meeting/i })).toHaveCount(0);
      expect(await forwardedPage.content()).not.toContain("jfKfPfyJRdk");
      const anonymous = await forwardedPage.request.post(`/api/v1/meetings/occurrences/${occurrenceId}/join`, {
        data: { intentionalJoin: true, acceptedTerms: [], landingRevision: "a".repeat(64) },
      });
      expect(anonymous.status()).toBe(401);
      expect(await anonymous.text()).not.toContain("jfKfPfyJRdk");

      await forwardedPage.setExtraHTTPHeaders({ "cf-connecting-ip": clientIpForIdentity(participantEmail) });
      await forwardedPage.getByRole("button", { name: "Verify and continue" }).click();
      await openEmailSignIn(forwardedPage);
      await forwardedPage.getByLabel("Work email").fill(participantEmail);
      const signInSince = await capturedEmailCount();
      await forwardedPage.getByRole("button", { name: "Send sign-in link" }).click();
      const signInEmail = await waitForCapturedEmail(participantEmail, "sign-in link", { since: signInSince });
      await forwardedPage.goto(extractEmailUrl(signInEmail, "/portal/"));
      await forwardedPage.reload();
      await expect(forwardedPage).toHaveURL(/\/m\/#token=m2(?:\.[A-Za-z0-9_-]{22}){4}$/);
      await expect(forwardedPage.getByRole("heading", { name: eventName })).toBeVisible();
      await expect(forwardedPage.getByText("Preparing secure meeting entry…", { exact: true })).toHaveCount(0);
      await expect(forwardedPage.locator("iframe")).toHaveCount(0);
      await forwardedPage.goto("/portal/#/home");
      const personalMeeting = forwardedPage.getByRole("listitem").filter({ hasText: eventName });
      await expect(personalMeeting.getByRole("link", { name: "Download my personal calendar (.ics)" })).toBeVisible();
      await expect(
        forwardedPage.getByText("This calendar file contains your RSVP identity. Do not forward it."),
      ).toBeVisible();
      const personalDownloadReady = forwardedPage.waitForEvent("download");
      await personalMeeting.getByRole("link", { name: "Download my personal calendar (.ics)" }).click();
      const personalDownload = await personalDownloadReady;
      expect(personalDownload.suggestedFilename()).toContain("-personal.ics");
      await forwardedPage.goto(joinUrl);
      await expect(forwardedPage.getByRole("heading", { name: eventName })).toBeVisible();
      if (!broadcast) {
        await forwardedPage.route("https://meet.example.test/**", (route) =>
          route.fulfill({ contentType: "text/plain", body: "External meeting provider" }),
        );
        await forwardedPage.getByRole("button", { name: "Agree and join meeting" }).click();
        await expect(forwardedPage).toHaveURL(`https://meet.example.test/${unique}`);
      } else {
        // Deliberately block provider playback: the page must still offer a usable recovery path.
        await forwardedPage.route("https://www.youtube.com/**", (route) => route.abort());
        await forwardedPage.getByRole("button", { name: "Agree and join meeting" }).click();
        const player = forwardedPage.getByTitle(`${eventName} broadcast`);
        await expect(player).toHaveAttribute("src", "https://www.youtube.com/embed/jfKfPfyJRdk");
        await expect(forwardedPage.getByRole("link", { name: "Video not playing? Open on YouTube" })).toHaveAttribute(
          "href",
          "https://www.youtube.com/live/jfKfPfyJRdk",
        );
        await forwardedPage.getByRole("button", { name: "Reload player" }).click();
        await expect(player).toBeVisible();
        await forwardedPage.setViewportSize({ width: 390, height: 844 });
        const frame = await player.boundingBox();
        expect(frame!.width).toBeLessThanOrEqual(390);
        expect(await forwardedPage.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);

        await page.goto(`/portal/#/groups/${GROUP_ID}/members`);
        const participantRow = page.getByRole("row").filter({ hasText: participantEmail });
        await participantRow.getByRole("button", { name: /^Actions for/ }).click();
        await page.getByRole("menuitem", { name: "End participation" }).click();
        await acceptConfirmDialog(page, "End participation");
        await expect(participantRow).toHaveCount(0);
        await forwardedPage.evaluate(() => window.dispatchEvent(new Event("focus")));
        await expect(forwardedPage.getByRole("alert")).toContainText("viewing access could not be confirmed");
        await expect(player).toHaveCount(0);
        await forwardedPage.reload();
        await expect(forwardedPage.getByRole("alert")).toContainText("No eligible upcoming meeting");
        await expect(forwardedPage.locator("iframe")).toHaveCount(0);
      }
    } finally {
      await forwarded.close();
    }
    await page.goto(`/portal/#/groups/${GROUP_ID}/meetings/${created.seriesId!}/occurrences`);
    const cancelRow = page.getByRole("row").filter({ hasText: "Scheduled" }).first();
    await cancelRow.getByRole("checkbox").check();
    await page.getByRole("button", { name: "Cancel selected…" }).click();
    await acceptConfirmDialog(page, "Cancel selected meetings");
    await expect(page.getByRole("row").filter({ hasText: "Cancelled" })).toHaveCount(1);
    if (!broadcast) {
      const calendarName = `Forms review ${unique}`;
      const beforeCreation = await capturedEmailCount();
      await page.goto(`/portal/#/groups/${GROUP_ID}/meetings/new`);
      await expect(page.getByText(/Occurrences are generated automatically through year-end/)).toBeVisible();
      await page.getByRole("button", { name: "Create meeting", exact: true }).click();
      await expect(page.getByLabel("Meeting name")).toHaveAttribute("aria-invalid", "true");
      await page.getByLabel("Meeting name").fill(calendarName);
      const createdCalendar = page.waitForResponse(
        (response) =>
          response.url().endsWith(`/groups/${GROUP_ID}/meetings/series`) && response.request().method() === "POST",
      );
      await page.getByRole("button", { name: "Create meeting", exact: true }).click();
      const response = await createdCalendar;
      expect(response.status()).toBe(201);
      const { series } = await response.json();
      await expect(page).toHaveURL(new RegExp(`/meetings/${series.id}$`));
      const invitation = await waitForCapturedEmail(participantEmail, calendarName, {
        since: beforeCreation,
        timeoutMs: 30_000,
      });
      const attachments = invitation.payload.attachments as Array<{ filename: string; content: string }>;
      const calendars = attachments.filter((attachment) => attachment.filename.endsWith(".ics"));
      expect(calendars).toHaveLength(1);
      const calendar = Buffer.from(calendars[0].content, "base64").toString("utf8");
      expect(calendar).toContain(`UID:${series.id}@pkic.org`);
      expect(calendar).toContain("METHOD:REQUEST");
      expect(calendar).toContain("RRULE:");
      expect(calendar).toContain("BEGIN:VTIMEZONE");
      expect(calendar).toContain("RSVP=TRUE");
      expect(extractEmailUrl(invitation, "/m/#token=m2.")).toMatch(
        /\/m\/#token=m2(?:\.[A-Za-z0-9_-]{22}){2}\.0\.[A-Za-z0-9_-]{22}$/,
      );
      await page.goto(`/portal/#/groups/${GROUP_ID}/meetings/${series.id}/occurrences`);
      await expect(page.getByRole("row").filter({ hasText: "Scheduled" }).first()).toBeVisible();
    }
  });
}
