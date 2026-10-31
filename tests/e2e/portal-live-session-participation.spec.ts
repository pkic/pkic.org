import { expect, test, type Page } from "@playwright/test";
import {
  agendaOccurrenceCreateSchema,
  agendaRoomCreateSchema,
  agendaRevisionSchema,
  agendaSnapshotSchema,
} from "../../assets/shared/schemas/event-agenda";
import { e2eAdminEmail } from "../helpers/e2e-admin";
import { signInAsE2eStaff } from "./helpers/staff-auth";
import { signInToPortal } from "./helpers/portal-auth";
import { createRegistrationEvent, registerStateAttendee } from "./helpers/participation-state-fixture";
import { eventManagementDetailResponseSchema } from "../../assets/shared/schemas/event-management";
import { ownDomainEmail } from "./helpers/registration";

test.use({ actionTimeout: 20_000 });

async function captureRole(page: Page, path: (name: string) => string, role: string) {
  for (const [width, height] of [
    [375, 812],
    [820, 1180],
    [1440, 1000],
  ]) {
    await page.setViewportSize({ width: width!, height: height! });
    await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width!);
    await page.screenshot({ path: path(`${role}-${width}.png`), fullPage: false });
  }
}

/** The Time panel owns timer configuration and the complete composition survives a transition. */
async function stageTimers(page: Page, path: (name: string) => string) {
  await page.getByRole("tab", { name: "Stage", exact: true }).click();
  await page.getByRole("button", { name: "Add timer", exact: true }).click();
  const add = page.getByRole("dialog", { name: "Add a timer", exact: true });
  await add.getByLabel("Timer name", { exact: true }).fill("Pitch");
  await add.getByLabel("Counts", { exact: true }).selectOption("duration");
  await add.getByLabel("Minutes", { exact: true }).fill("3");
  await add.getByRole("button", { name: "Add timer", exact: true }).click();
  await page.getByRole("button", { name: "Pitch graphic settings", exact: true }).click();
  const settings = page.getByRole("dialog", { name: "Timer graphic", exact: true });
  await settings.getByLabel("Format", { exact: true }).selectOption("custom");
  await settings.getByLabel("Custom duration", { exact: true }).fill("{{minutes}} minutes and {{seconds}} seconds");
  await settings.getByLabel("Show logo", { exact: true }).uncheck();
  await settings.getByRole("button", { name: "Save", exact: true }).click();
  for (const name of ["Session", "Pitch"]) {
    const controls = page.getByRole("group", { name: `${name} controls`, exact: true });
    const preview = controls.getByRole("button", { name: "Show timer in preview", exact: true });
    await preview.click();
    await expect(preview).toHaveAttribute("aria-pressed", "true");
  }
  await page.getByRole("tab", { name: "Show", exact: true }).click();
  await page.getByRole("button", { name: "Transition", exact: true }).click();
  await page.getByRole("button", { name: "Full screen Program", exact: true }).first().click();
  const program = page.getByRole("dialog", { name: "Program", exact: true });
  await expect(program.getByText("Session", { exact: true })).toBeVisible();
  await expect(program.getByText("Pitch", { exact: true })).toBeVisible();
  await expect(program.getByText("3 minutes and 0 seconds", { exact: true })).toBeVisible();
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.screenshot({ path: path("studio-timers-1440.png") });
  await program.getByRole("button", { name: "Close Program", exact: true }).click();
  await page.setViewportSize({ width: 375, height: 812 });
  await page.getByRole("button", { name: "Program", exact: true }).click();
  await page.getByRole("button", { name: "Full screen Program", exact: true }).click();
  const phoneProgram = page.getByRole("dialog", { name: "Program", exact: true });
  await expect(phoneProgram.getByText("3 minutes and 0 seconds", { exact: true })).toBeVisible();
  await page.screenshot({ path: path("studio-timers-375.png") });
  await phoneProgram.getByRole("button", { name: "Close Program", exact: true }).click();
  await page.setViewportSize({ width: 1440, height: 1000 });
}

/** Native UI commands, real registrations and mounted live transport; no intercepted channels. */
test("attendees ask, upvote, reply, accept answers and restore participation after reconnect", async ({
  page: moderator,
  browser,
}, info) => {
  test.setTimeout(300_000);
  await signInAsE2eStaff(moderator, e2eAdminEmail("portal-live-session-participation"));
  // Clamp the live slot to this event's UTC day, including runs near midnight.
  const now = new Date();
  const fixture = await createRegistrationEvent(moderator, "live-participation", {
    date: now.toISOString().slice(0, 10),
    startTime: "00:00",
    endTime: "23:59",
  });
  const api = `/api/v1/events/${fixture.slug}/agenda`;
  let agenda = agendaSnapshotSchema.parse(await (await moderator.request.get(api)).json());
  const roomResponse = await moderator.request.post(`${api}/rooms`, {
    data: agendaRoomCreateSchema.parse({
      expectedRevision: agenda.revision,
      name: "Synthetic participation room",
      capacity: 20,
    }),
  });
  expect(roomResponse.status()).toBe(200);
  agenda = agendaSnapshotSchema.parse(await roomResponse.json());
  const created = await moderator.request.post(`${api}/occurrences`, {
    data: agendaOccurrenceCreateSchema.parse({
      expectedRevision: agenda.revision,
      title: "Synthetic live participation",
      startAt: new Date(
        Math.max(Date.parse(`${now.toISOString().slice(0, 10)}T00:00:00Z`), now.getTime() - 60_000),
      ).toISOString(),
      endAt: new Date(
        Math.min(Date.parse(`${now.toISOString().slice(0, 10)}T23:59:00Z`), now.getTime() + 20 * 60_000),
      ).toISOString(),
      roomId: agenda.rooms[0]!.id,
      admissionPolicy: "preference",
      accessPolicy: "open",
      speakerUserIds: [],
    }),
  });
  expect(created.status()).toBe(200);
  agenda = agendaSnapshotSchema.parse(await created.json());
  const occurrence = agenda.occurrences[0]!;
  const published = await moderator.request.post(`${api}/publications`, {
    data: agendaRevisionSchema.parse({ expectedRevision: agenda.revision }),
  });
  expect(published.status(), await published.text()).toBe(200);
  const detail = eventManagementDetailResponseSchema.parse(
    await (await moderator.request.get(`/api/v1/events/${fixture.slug}`)).json(),
  ).event;
  if (!detail.ownerGroupId) throw new Error("Synthetic event needs its real organizer workspace");
  const contexts = await Promise.all([0, 1].map(() => browser.newContext({ baseURL: info.project.use.baseURL })));
  try {
    const attendees = await Promise.all(contexts.map((context) => context.newPage()));
    for (const attendee of attendees) {
      const email = ownDomainEmail("live-attendee");
      await registerStateAttendee(attendee, fixture, email, { staticRelease: false });
      await signInToPortal(attendee, email);
      await attendee.goto(`/portal/#/events/${fixture.slug}/agenda?session=${occurrence.id}`);
      await expect(attendee.getByLabel("Your question", { exact: true })).toBeVisible();
      await expect(attendee.getByLabel("Your question", { exact: true })).toBeEnabled();
    }
    const [first, second] = attendees as [Page, Page];
    await moderator.goto(`/portal/#/groups/${detail.ownerGroupId}/events/${fixture.eventId}/live/${occurrence.id}`);
    await stageTimers(moderator, (name) => info.outputPath(name));
    await expect(moderator.getByRole("button", { name: "New poll", exact: true })).toBeEnabled();
    const question = "Which migration step should we prioritize?";
    await first.getByLabel("Your question", { exact: true }).fill("Which certificates should we inventory first?");
    const anonymous = first.getByRole("checkbox", {
      name: "Ask anonymously Other attendees will not see your name. Moderators always can.",
      exact: true,
    });
    await anonymous.check();
    await expect(anonymous).toBeChecked();
    await first.getByRole("button", { name: "Ask", exact: true }).click();
    await first.getByRole("button", { name: "Your question actions", exact: true }).click();
    await first.getByRole("menuitem", { name: "Edit question", exact: true }).click();
    const ownEditor = first.getByRole("dialog", { name: "Edit your question", exact: true });
    await ownEditor.getByLabel("Your question", { exact: true }).fill(question);
    await captureRole(first, (name) => info.outputPath(name), "author-question-editor");
    await ownEditor.getByRole("button", { name: "Save changes", exact: true }).click();
    await expect(ownEditor).toHaveCount(0);
    const pending = moderator.getByRole("listitem").filter({ hasText: question });
    await expect(pending.getByRole("button", { name: "Approve", exact: true })).toBeEnabled();
    await expect(second.getByText(question, { exact: true })).toHaveCount(0);
    await pending.getByRole("button", { name: "Approve", exact: true }).click();
    const firstQuestion = first.getByRole("listitem").filter({ hasText: question });
    const secondQuestion = second.getByRole("listitem").filter({ hasText: question });
    await expect(secondQuestion).toContainText("Anonymous");
    await firstQuestion.getByRole("button", { name: "Vote: 0 votes", exact: true }).click();
    await expect(secondQuestion.getByRole("button", { name: "Vote: 1 vote", exact: true })).toBeVisible();
    await firstQuestion.getByRole("button", { name: "Remove your vote: 1 vote", exact: true }).click();
    await firstQuestion.getByRole("button", { name: "Vote: 0 votes", exact: true }).click();
    await expect(secondQuestion.getByRole("button", { name: "Vote: 1 vote", exact: true })).toBeVisible();
    await secondQuestion.getByRole("button", { name: "Vote: 1 vote", exact: true }).click();
    await expect(firstQuestion.getByRole("button", { name: "Remove your vote: 2 votes", exact: true })).toBeVisible();

    await secondQuestion.getByRole("button", { name: "Show answers", exact: true }).click();
    const answer = "Start with an inventory of certificates and their owners.";
    await secondQuestion.getByLabel("Your answer", { exact: true }).fill(answer);
    await secondQuestion.getByRole("button", { name: "Post answer", exact: true }).click();
    await expect(secondQuestion.getByText(answer, { exact: true })).toBeVisible();
    await expect(secondQuestion.getByLabel("Your answer", { exact: true })).toHaveValue("");
    await expect(secondQuestion.getByRole("button", { name: "Accept answer", exact: true })).toHaveCount(0);
    await firstQuestion.getByRole("button", { name: "Show answers", exact: true }).click();
    await expect(firstQuestion.getByText(answer, { exact: true })).toBeVisible();
    await firstQuestion.getByRole("button", { name: "Accept answer", exact: true }).click();
    await expect(firstQuestion.getByRole("button", { name: "Remove acceptance", exact: true })).toBeVisible();
    await expect(secondQuestion.getByText("Accepted by the question author", { exact: true })).toBeVisible();
    await captureRole(first, (name) => info.outputPath(name), "accepted-question-answer");
    // Organizers use the same session Questions section to review and accept attendee replies. The attendee
    // agenda offers it to registered viewers, so the organizer registers under their own verified address.
    await registerStateAttendee(moderator, fixture, e2eAdminEmail("portal-live-session-participation"));
    await moderator.goto(`/portal/#/events/${fixture.slug}/agenda?session=${occurrence.id}`);
    const moderatorQuestion = moderator.getByRole("listitem").filter({ hasText: question });
    await moderatorQuestion.getByRole("button", { name: "Show answers", exact: true }).click();
    await moderatorQuestion.getByRole("button", { name: "Remove acceptance", exact: true }).click();
    await expect(secondQuestion.getByText("Accepted by the question author", { exact: true })).toHaveCount(0);
    await moderatorQuestion.getByRole("button", { name: "Accept answer", exact: true }).click();
    await expect(secondQuestion.getByText(/^Accepted by /u)).toBeVisible();
    await expect(secondQuestion.getByText("Accepted by the question author", { exact: true })).toHaveCount(0);
    await moderator.goto(`/portal/#/groups/${detail.ownerGroupId}/events/${fixture.eventId}/live/${occurrence.id}`);

    await moderator.getByRole("button", { name: "New poll", exact: true }).click();
    const editor = moderator.getByRole("dialog", { name: "New poll", exact: true });
    const pollTitle = "Which rollout comes first?";
    await editor.getByRole("textbox", { name: "Question", exact: true }).fill(pollTitle);
    await editor.getByLabel("Choice 1", { exact: true }).fill("Inventory");
    await editor.getByLabel("Choice 2", { exact: true }).fill("Pilot");
    await editor.getByRole("button", { name: "Add poll", exact: true }).click();
    const poll = moderator.getByRole("listitem").filter({ hasText: pollTitle });
    await poll.getByRole("button", { name: "Open voting", exact: true }).click();
    const firstPoll = first.getByRole("region", { name: "Poll", exact: true });
    const secondPoll = second.getByRole("region", { name: "Poll", exact: true });
    await firstPoll.getByRole("radio", { name: "Inventory", exact: true }).check();
    await firstPoll.getByRole("button", { name: "Send answer", exact: true }).click();
    await expect(poll.getByText(/^1 answer(?: ·|$)/u)).toBeVisible();
    await firstPoll.getByRole("radio", { name: "Pilot", exact: true }).check();
    await firstPoll.getByRole("button", { name: "Change answer", exact: true }).click();
    await expect(poll.getByText(/^1 answer(?: ·|$)/u)).toBeVisible();
    await secondPoll.getByRole("radio", { name: "Inventory", exact: true }).check();
    await secondPoll.getByRole("button", { name: "Send answer", exact: true }).click();
    await expect(poll.getByText(/^2 answers(?: ·|$)/u)).toBeVisible();
    await poll.getByRole("button", { name: `Poll actions, ${pollTitle}`, exact: true }).click();
    await moderator.getByRole("menuitem", { name: "Close voting", exact: true }).click();
    for (const attendee of attendees) {
      await expect(attendee.getByRole("heading", { name: `Poll results: ${pollTitle}`, exact: true })).toBeVisible();
      await expect(attendee.getByText("2 people answered", { exact: true })).toBeVisible();
      const results = attendee.getByRole("region", { name: "Poll", exact: true });
      for (const choice of ["Inventory", "Pilot"])
        await expect(results.getByRole("meter", { name: `${choice}: 50%`, exact: true })).toBeVisible();
    }
    await captureRole(first, (name) => info.outputPath(name), "attendee-results");
    await captureRole(moderator, (name) => info.outputPath(name), "moderator-results");
    // Leaving the room unmounts its native socket; returning joins with a fresh authoritative snapshot.
    await second.goto(`/portal/#/events/${fixture.slug}`);
    await expect(second.getByLabel("Your question", { exact: true })).toHaveCount(0);
    await second.goto(`/portal/#/events/${fixture.slug}/agenda?session=${occurrence.id}`);
    await expect(second.getByLabel("Your question", { exact: true })).toBeEnabled();
    await expect(second.getByText("2 people answered", { exact: true })).toBeVisible();
    await expect(secondQuestion.getByRole("button", { name: "Remove your vote: 2 votes", exact: true })).toBeVisible();
    await secondQuestion.getByRole("button", { name: "Show answers", exact: true }).click();
    await expect(secondQuestion.getByText(answer, { exact: true })).toBeVisible();
    await expect(secondQuestion.getByText(/^Accepted by /u)).toBeVisible();
    await expect(secondQuestion.getByRole("button", { name: "Accept answer", exact: true })).toHaveCount(0);
    await captureRole(second, (name) => info.outputPath(name), "attendee-reconnected");
    await firstQuestion.getByRole("button", { name: "Your question actions", exact: true }).click();
    await first.getByRole("menuitem", { name: "Withdraw question", exact: true }).click();
    const withdrawDialog = first.getByRole("alertdialog", { name: "Withdraw question?", exact: true });
    await withdrawDialog.getByRole("button", { name: "Withdraw question", exact: true }).click();
    await expect(firstQuestion.getByText("Withdrawn", { exact: true })).toBeVisible();
    await expect(secondQuestion).toHaveCount(0);
    await captureRole(first, (name) => info.outputPath(name), "withdrawn-question");
  } finally {
    await Promise.all(contexts.map((context) => context.close()));
  }
});
