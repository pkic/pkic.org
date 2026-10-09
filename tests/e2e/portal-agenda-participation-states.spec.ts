import { writeFile } from "node:fs/promises";
import { expect, test, type Locator, type Page, type TestInfo } from "@playwright/test";
import type { z } from "zod";
import { personalAgendaResponseSchema } from "../../assets/shared/schemas/event-personal-agenda";
import {
  sessionParticipationRequestSchema,
  sessionParticipationResponseSchema,
} from "../../assets/shared/schemas/event-participation-scanning";
import { e2eAdminEmail } from "../helpers/e2e-admin";
import { signInAsE2eStaff } from "./helpers/staff-auth";
import { signInToPortal } from "./helpers/portal-auth";
import { prepareParticipationStates, registerStateAttendee } from "./helpers/participation-state-fixture";

type Fixture = Awaited<ReturnType<typeof prepareParticipationStates>>;
type Occurrence = Fixture["agenda"]["occurrences"][number];
type Personal = z.infer<typeof personalAgendaResponseSchema>["sessions"][number];
type Participation = z.infer<typeof sessionParticipationRequestSchema>;

async function readSession(page: Page, fixture: Fixture, occurrence: Occurrence) {
  const response = await page.request.get(`${fixture.base}/participation`, { params: { occurrenceId: occurrence.id } });
  expect(response.status()).toBe(200);
  const parsed = personalAgendaResponseSchema.parse(await response.json());
  expect(parsed.sessions).toHaveLength(1);
  const session = parsed.sessions[0]!;
  expect(session.id).toBe(occurrence.id);
  expect(session.publishedRevision).toBe(fixture.agenda.publishedRevision);
  return session;
}

/** The live participation section inside the event app's session details. */
function participation(page: Page) {
  return page.getByRole("dialog").getByRole("region", { name: "My participation", exact: true });
}

/** Activate a control with the keyboard, as an assistive-technology user would. */
async function press(page: Page, control: Locator) {
  await control.focus();
  await expect(control).toBeFocused();
  await page.keyboard.press("Enter");
}

/** Follow the actual static link, using native keyboard activation rather than a portal shortcut. */
async function followPublic(page: Page, fixture: Fixture, occurrence: Occurrence, label: string) {
  const response = await page.goto(fixture.agenda.publicAgendaPath!);
  expect(response?.status()).toBe(200);
  expect(response?.headers()["x-pkic-publication"]).toBe(`static; snapshot=${fixture.release.snapshotId}`);
  const card = page.locator(`article[data-agenda-occurrence="${occurrence.id}"]`);
  await expect(card).toBeVisible();
  const link = card.getByRole("link", { name: label, exact: true });
  await expect(link).toHaveAttribute("href", `/portal/#/events/${fixture.slug}/agenda?session=${occurrence.id}`);
  await link.focus();
  await expect(link).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(
    new URL(`/portal/#/events/${fixture.slug}/agenda?session=${occurrence.id}`, page.url()).href,
  );
  // The deep link opens the session's own details over the whole programme.
  const dialog = page.getByRole("dialog", { name: occurrence.title, exact: true });
  await expect(dialog.getByRole("heading", { name: occurrence.title, exact: true })).toBeVisible();
  await expect(participation(page)).toBeVisible();
}

async function submit(page: Page, fixture: Fixture, occurrence: Occurrence, action: Participation["action"]) {
  const detail = participation(page);
  await detail.getByLabel("Participation", { exact: true }).selectOption(action);
  const update = detail.getByRole("button", { name: "Update", exact: true });
  await expect(update).toBeEnabled();
  await update.focus();
  await expect(update).toBeFocused();
  const received = page.waitForResponse(
    (response) =>
      new URL(response.url()).pathname === `${fixture.base}/${occurrence.id}/participation` &&
      response.request().method() === "PUT",
  );
  await page.keyboard.press("Enter");
  const response = await received;
  expect(response.status()).toBe(200);
  const body = sessionParticipationRequestSchema.parse(response.request().postDataJSON());
  expect(body.action).toBe(action);
  expect(body.attendanceMode).toBe("physical");
  expect(body.roomId).toBe(fixture.room.id);
  if (action === "reserve" || action === "request")
    expect(body.expectedPublishedRevision).toBe(fixture.agenda.publishedRevision);
  return { request: body, receipt: sessionParticipationResponseSchema.parse(await response.json()) };
}

/** Canceling is a separate, confirmed command; the participation choice never offers it. */
async function cancelRegistration(page: Page, fixture: Fixture, occurrence: Occurrence) {
  const detail = participation(page);
  await expect(detail.getByLabel("Participation", { exact: true }).locator('option[value="cancel"]')).toHaveCount(0);
  const received = page.waitForResponse(
    (response) =>
      new URL(response.url()).pathname === `${fixture.base}/${occurrence.id}/participation` &&
      response.request().method() === "PUT",
  );
  await press(page, detail.getByRole("button", { name: "Cancel my session registration…", exact: true }));
  // The session details are themselves a dialog, so the destructive confirmation is reached by its own role.
  const confirmation = page.getByRole("alertdialog");
  await expect(confirmation).toContainText(`Cancel your registration for ${occurrence.title}?`);
  await confirmation.getByRole("button", { name: "Cancel registration", exact: true }).click();
  const response = await received;
  expect(response.status()).toBe(200);
  const body = sessionParticipationRequestSchema.parse(response.request().postDataJSON());
  expect(body.action).toBe("cancel");
  expect(body.attendanceMode).toBe("physical");
  expect(body.roomId).toBe(fixture.room.id);
  return { request: body, receipt: sessionParticipationResponseSchema.parse(await response.json()) };
}

async function capture(page: Page, info: TestInfo, name: string) {
  for (const [device, width, height] of [
    ["desktop", 1280, 900],
    ["phone", 390, 844],
  ] as const) {
    await page.setViewportSize({ width, height });
    await page.evaluate(() => window.scrollTo(0, 0));
    await expect.poll(() => page.evaluate(() => window.scrollY)).toBe(0);
    await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
    const panel = participation(page);
    const bounds = await panel.boundingBox();
    expect(bounds).not.toBeNull();
    for (const control of await panel.locator("select, button").all()) {
      if (!(await control.isVisible())) continue;
      const rect = await control.boundingBox();
      expect(rect).not.toBeNull();
      expect(rect!.x).toBeGreaterThanOrEqual(bounds!.x - 1);
      expect(rect!.x + rect!.width).toBeLessThanOrEqual(Math.min(width, bounds!.x + bounds!.width) + 1);
      expect(rect!.y + rect!.height).toBeLessThanOrEqual(bounds!.y + bounds!.height + 1);
    }
    await page.screenshot({ path: info.outputPath(`${name}-${device}.png`), fullPage: true, animations: "disabled" });
  }
  await page.setViewportSize({ width: 390, height: 844 });
}

const BOOKED: ReadonlyArray<Personal["status"]> = ["reserved", "waitlisted", "approval_pending"];

/** Both the session details and the event app's My agenda tab must expose the same state after reload. */
async function inspectState(
  page: Page,
  fixture: Fixture,
  occurrence: Occurrence,
  label: string,
  status: Personal["status"],
  info: TestInfo,
) {
  const before = await readSession(page, fixture, occurrence);
  expect(before.status).toBe(status);
  const panel = participation(page);
  // A booking is the reader's own status; without one the live availability is the state.
  const stateLabel =
    status === null
      ? panel.getByRole("status").getByText(label, { exact: true })
      : panel.getByText(label, { exact: true });
  await expect(panel).toContainText(label);
  await expect(stateLabel).toBeVisible();
  // Details opened from a card are not part of the URL; reload the session's own deep link.
  await page.goto(`/portal/#/events/${fixture.slug}/agenda?session=${occurrence.id}`);
  await page.reload();
  await expect(panel).toContainText(label);
  await expect(stateLabel).toBeVisible();
  const persisted = await readSession(page, fixture, occurrence);
  expect(persisted.status).toBe(status);
  await capture(page, info, label.toLowerCase().replaceAll(" ", "-"));
  const dialog = page.getByRole("dialog", { name: occurrence.title, exact: true });
  await press(page, dialog.getByRole("button", { name: "Close session details", exact: true }));
  await expect(dialog).toBeHidden();
  // Phones reach My agenda through the event app's bottom tabs.
  const tabs = page.getByRole("navigation", { name: "Event app", exact: true });
  await press(page, tabs.getByRole("link", { name: "My agenda", exact: true }));
  await expect(page).toHaveURL(new URL(`/portal/#/events/${fixture.slug}/agenda?mine=1`, page.url()).href);
  const card = page.locator(`article[data-agenda-occurrence="${occurrence.id}"]`);
  if (BOOKED.includes(status)) {
    await expect(card).toBeVisible();
    await expect(card).toContainText(label);
  } else {
    // Only starred and booked sessions are on My agenda; the whole programme still lists this one.
    await expect(card).toBeHidden();
    await press(page, tabs.getByRole("link", { name: "Agenda", exact: true }));
    await expect(page).toHaveURL(new URL(`/portal/#/events/${fixture.slug}/agenda`, page.url()).href);
    await expect(card).toBeVisible();
  }
  await press(page, card.getByLabel(`Open session details: ${occurrence.title}`, { exact: true }));
  await expect(dialog.getByRole("heading", { name: occurrence.title, exact: true })).toBeVisible();
  await expect(stateLabel).toBeVisible();
  return persisted;
}

test("public session links expose all seven participation states through accessible mobile My agenda controls", async ({
  page: staff,
  browser,
}, info) => {
  test.setTimeout(480_000);
  await signInAsE2eStaff(staff, e2eAdminEmail("default"));
  const fixture = await prepareParticipationStates(staff);
  const [reservation, approval, invitation, closed] = fixture.agenda.occurrences;
  if (!reservation || !approval || !invitation || !closed)
    throw new Error("The state journey requires four canonical sessions");
  const contexts = await Promise.all(
    [0, 1].map(() =>
      browser.newContext({ baseURL: new URL(staff.url()).origin, viewport: { width: 390, height: 844 } }),
    ),
  );
  const evidence: unknown[] = [];
  try {
    const first = await contexts[0]!.newPage();
    const second = await contexts[1]!.newPage();
    for (const [index, attendee] of [first, second].entries()) {
      const email = `state-attendee-${index}-${crypto.randomUUID()}@example.test`;
      await registerStateAttendee(attendee, fixture, email);
      await signInToPortal(attendee, email);
    }

    await followPublic(first, fixture, reservation, "Register for session");
    const reserved = await submit(first, fixture, reservation, "reserve");
    expect(reserved.receipt.status).toBe("reserved");
    evidence.push({
      label: "Reserved",
      operation: reserved,
      personal: await inspectState(first, fixture, reservation, "Reserved", "reserved", info),
    });

    await followPublic(second, fixture, reservation, "Register for session");
    const full = await readSession(second, fixture, reservation);
    expect(full.availability).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          attendanceMode: "physical",
          roomId: fixture.room.id,
          state: "full",
          bookingAction: "reserve",
        }),
      ]),
    );
    const fullPanel = participation(second);
    await expect(fullPanel.getByLabel("Participation", { exact: true }).locator('option[value="reserve"]')).toHaveText(
      "Join waiting list",
    );
    await expect(fullPanel).toContainText("no place is reserved");
    evidence.push({ label: "Full", personal: await inspectState(second, fixture, reservation, "Full", null, info) });
    const waiting = await submit(second, fixture, reservation, "reserve");
    expect(waiting.receipt.status).toBe("waitlisted");
    evidence.push({
      label: "Waitlisted",
      operation: waiting,
      personal: await inspectState(second, fixture, reservation, "Waitlisted", "waitlisted", info),
    });

    await followPublic(second, fixture, approval, "Request approval");
    const pending = await submit(second, fixture, approval, "request");
    expect(pending.receipt.status).toBe("approval_pending");
    evidence.push({
      label: "Awaiting approval",
      operation: pending,
      personal: await inspectState(second, fixture, approval, "Awaiting approval", "approval_pending", info),
    });

    for (const [occurrence, label, publicLabel, state] of [
      [invitation, "Invitation required", "Invitation required", "invitation_required"],
      [closed, "Closed", "Register for session", "closed"],
    ] as const) {
      await followPublic(second, fixture, occurrence, publicLabel);
      const current = await readSession(second, fixture, occurrence);
      expect(current.availability).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            attendanceMode: "physical",
            roomId: fixture.room.id,
            state,
            bookingAction: null,
            canSave: true,
          }),
        ]),
      );
      const panel = participation(second);
      await expect(
        panel.getByLabel("Participation", { exact: true }).locator('option[value="reserve"]'),
      ).toBeDisabled();
      // Nothing can be booked, so the booking command stays unavailable while saving interest remains open.
      await expect(panel.getByRole("button", { name: "Update", exact: true })).toBeDisabled();
      await expect(
        second
          .getByRole("dialog", { name: occurrence.title, exact: true })
          .getByRole("button", { name: `Star ${occurrence.title}`, exact: true }),
      ).toBeEnabled();
      evidence.push({ label, personal: await inspectState(second, fixture, occurrence, label, null, info) });
    }

    // Release only after the full/waitlisted evidence: normal waitlist promotion must not invalidate that earlier proof.
    await followPublic(first, fixture, reservation, "Register for session");
    const canceled = await cancelRegistration(first, fixture, reservation);
    expect(canceled.receipt.status).toBe("canceled");
    evidence.push({
      label: "Canceled",
      operation: canceled,
      // A canceled registration leaves the reader's agenda; the session reads as not starred.
      personal: await inspectState(first, fixture, reservation, "Not starred", "canceled", info),
    });
    expect(evidence).toHaveLength(7);
    const receiptPath = info.outputPath("participation-states-receipt.json");
    await writeFile(
      receiptPath,
      JSON.stringify(
        {
          eventId: fixture.eventId,
          slug: fixture.slug,
          publicAgendaPath: fixture.agenda.publicAgendaPath,
          snapshotId: fixture.release.snapshotId,
          publishedRevision: fixture.agenda.publishedRevision,
          closedAt: fixture.closedAt,
          evidence,
          scope:
            "Synthetic current-policy Chromium desktop/390 journey; no physical-device or provider acceptance claim.",
        },
        null,
        2,
      ) + "\n",
    );
    await info.attach("participation-states-receipt", { path: receiptPath, contentType: "application/json" });
  } finally {
    for (const context of contexts) await context.close();
  }
});
