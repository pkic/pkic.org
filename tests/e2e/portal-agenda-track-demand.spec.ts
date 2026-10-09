import { openOrganizerAgenda } from "./helpers/organizer-agenda";
import { runAgendaAction } from "./helpers/agenda-actions";
import { expect, test, type Page, type TestInfo, type Request } from "@playwright/test";
import { e2eAdminEmail } from "../helpers/e2e-admin";
import { signInAsE2eStaff } from "./helpers/staff-auth";
import { runRowAction } from "./helpers/data-table";
import { registerInBrowser } from "./helpers/registration";
import { signInToPortal } from "./helpers/portal-auth";
import { capturedEmailCount, extractEmailUrl, waitForCapturedEmail } from "./helpers/sendgrid";
import { registrationCreateSchema } from "../../assets/shared/schemas/registration";
import { sessionParticipationRequestSchema } from "../../assets/shared/schemas/event-participation-scanning";
import {
  agendaRevisionSchema,
  agendaSnapshotSchema,
  agendaRoomCreateSchema,
  agendaOccurrenceCreateSchema,
  agendaOccurrenceListSchema,
  agendaOccurrencePatchSchema,
} from "../../assets/shared/schemas/event-agenda";
import { personalAgendaResponseSchema } from "../../assets/shared/schemas/event-personal-agenda";
import { roomRecommendationsResponseSchema } from "../../assets/shared/schemas/event-room-recommendations";

async function capture(page: Page, info: TestInfo, name: string) {
  for (const [label, width, height] of [
    ["desktop", 1280, 900],
    ["phone", 390, 844],
  ] as const) {
    await page.setViewportSize({ width, height });
    await page.evaluate(() => window.scrollTo(0, 0));
    await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
    await page.screenshot({ path: info.outputPath(`${name}-${label}.png`), fullPage: true });
  }
  await page.setViewportSize({ width: 1280, height: 900 });
}

test("organizers preserve exact track filters and inspect canonical demand outside the session editor", async ({
  page,
  browser,
}, info) => {
  test.setTimeout(240_000);
  const slug = "pqc-conference-amsterdam-nl";
  const suffix = crypto.randomUUID();
  const title = `Track demand workshop ${suffix}`;
  const track = `Cryptography ${suffix}`;
  const roomName = `Track workshop hall ${suffix}`;
  const template = await registerInBrowser(page, `track-template-${suffix}@example.test`);
  const attendeeEmail = `track-attendee-${suffix}@example.test`;
  const since = await capturedEmailCount();
  const registration = await page.request.post(`/api/v1/events/${slug}/registrations`, {
    data: registrationCreateSchema.parse({
      ...template.request,
      email: attendeeEmail,
      attendanceType: "in_person",
      dayAttendance: template.request.dayAttendance?.map((day) => ({ ...day, attendanceType: "in_person" })),
    }),
  });
  expect(registration.status(), await registration.text()).toBe(200);
  const confirmation = await waitForCapturedEmail(attendeeEmail, "Confirm your registration", { since });
  await page.goto(extractEmailUrl(confirmation, "/register/confirm"));
  await page.getByRole("button", { name: /Confirm my registration/i }).click();
  await waitForCapturedEmail(attendeeEmail, "registration is confirmed", { since });
  await signInAsE2eStaff(page, e2eAdminEmail("portal-agenda-track-demand"));
  const base = `/api/v1/events/${slug}/agenda`;
  let snapshot = agendaSnapshotSchema.parse(await (await page.request.get(base)).json());
  const room = await page.request.post(`${base}/rooms`, {
    data: agendaRoomCreateSchema.parse({ expectedRevision: snapshot.revision, name: roomName, capacity: 20 }),
  });
  expect(room.status(), await room.text()).toBe(200);
  snapshot = agendaSnapshotSchema.parse(await room.json());
  const roomId = snapshot.rooms.find((item) => item.name === roomName)!.id;
  await openOrganizerAgenda(page, slug);
  await runAgendaAction(page, "New session");
  const creation = page.getByRole("dialog", { name: "New session", exact: true });
  await creation.getByRole("textbox", { name: /^Session title/ }).fill(title);
  await creation.getByLabel("Track", { exact: true }).fill(`  ${track}  `);
  await creation
    .getByRole("textbox", { name: "Description", exact: true })
    .fill("A substantive workshop on operational cryptography and program planning.");
  await creation.getByRole("tab", { name: "Schedule", exact: true }).click();
  await creation.getByLabel("Starts", { exact: true }).fill("2026-12-01T10:00");
  await creation.getByLabel("Ends", { exact: true }).fill("2026-12-01T11:00");
  await creation.getByRole("checkbox", { name: roomName, exact: true }).check();
  await creation.getByRole("tab", { name: "Participation", exact: true }).click();
  await creation.getByLabel("Admission", { exact: true }).selectOption("reservation");
  await creation.getByRole("button", { name: "Save session", exact: true }).click();
  await expect(creation).toBeHidden();
  snapshot = agendaSnapshotSchema.parse(await (await page.request.get(base)).json());
  const occurrence = snapshot.occurrences.find((item) => item.title === title)!;
  expect(occurrence.track).toBe(track);
  const other = await page.request.post(`${base}/occurrences`, {
    data: agendaOccurrenceCreateSchema.parse({
      expectedRevision: snapshot.revision,
      title: `Different program track ${suffix}`,
      track: `${track} operations`,
      description: "A separate track that must not match the exact filter.",
      startAt: "2026-12-01T11:00:00.000Z",
      endAt: "2026-12-01T12:00:00.000Z",
      roomId,
    }),
  });
  expect(other.status(), await other.text()).toBe(200);
  snapshot = agendaSnapshotSchema.parse(await other.json());
  const publication = await page.request.post(`${base}/publications`, {
    data: agendaRevisionSchema.parse({ expectedRevision: snapshot.revision }),
  });
  expect(publication.status(), await publication.text()).toBe(200);
  const attendeeContext = await browser.newContext({ baseURL: new URL(page.url()).origin });
  try {
    const attendee = await attendeeContext.newPage();
    await signInToPortal(attendee, attendeeEmail);
    const personalResponse = await attendee.request.get(`${base}/participation`, {
      params: { occurrenceId: occurrence.id },
    });
    expect(personalResponse.status(), await personalResponse.text()).toBe(200);
    const personalAgenda = personalAgendaResponseSchema.parse(await personalResponse.json());
    expect(personalAgenda.sessions).toHaveLength(1);
    const displayedSession = personalAgenda.sessions[0]!;
    expect(displayedSession.id).toBe(occurrence.id);
    const reservation = await attendee.request.put(`${base}/${occurrence.id}/participation`, {
      data: sessionParticipationRequestSchema.parse({
        action: "reserve",
        attendanceMode: "physical",
        roomId,
        expectedPublishedRevision: displayedSession.publishedRevision,
      }),
    });
    expect(reservation.status(), await reservation.text()).toBe(200);
  } finally {
    await attendeeContext.close();
  }
  await page.reload();
  await page.getByRole("tab", { name: "Schedule", exact: true }).click();
  await page.getByRole("button", { name: "Choose columns", exact: true }).click();
  await page.getByRole("menuitemradio", { name: "Track", exact: true }).click();
  await page.getByRole("button", { name: "Track column options", exact: true }).click();
  await page.getByRole("menuitem", { name: "Filter this column…", exact: true }).click();
  const trackFilter = page.getByRole("textbox", { name: "Filter track Matches the exact session track.", exact: true });
  await expect(trackFilter).toBeVisible();
  const filtered = page.waitForResponse(
    (response) =>
      new URL(response.url()).pathname === `${base}/occurrences` &&
      new URL(response.url()).searchParams.get("track") === track,
  );
  const [filterResponse] = await Promise.all([filtered, trackFilter.fill(track)]);
  expect(filterResponse.status(), await filterResponse.text()).toBe(200);
  const list = agendaOccurrenceListSchema.parse(await filterResponse.json());
  expect(list.occurrences.map((item) => item.id)).toEqual([occurrence.id]);
  await page.getByRole("button", { name: "Done", exact: true }).click();
  for (const column of ["Pending approval", "Waitlisted"]) {
    await page.getByRole("button", { name: "Choose columns", exact: true }).click();
    await page.getByRole("menuitemradio", { name: column, exact: true }).click();
  }
  const demand = roomRecommendationsResponseSchema.parse(
    await (await page.request.get(`${base}/occurrences/${occurrence.id}/room-recommendations`)).json(),
  ).demand;
  expect(demand.physical.confirmed).toBe(1);
  expect(demand.remote.confirmed).toBe(0);
  const table = page.getByRole("table", { name: "Event sessions", exact: true });
  const row = table.getByRole("row").filter({ hasText: occurrence.title });
  const headings = await table.getByRole("columnheader").allTextContents();
  for (const [status, label] of [
    ["confirmed", "Reserved"],
    ["pending", "Pending approval"],
    ["waitlisted", "Waitlisted"],
  ] as const) {
    const index = headings.findIndex((heading) => heading.includes(label));
    expect(index).toBeGreaterThanOrEqual(0);
    const cell = row.getByRole("cell").nth(index);
    const meaning =
      status === "confirmed"
        ? "reservations"
        : status === "pending"
          ? "reservations awaiting approval"
          : "waitlisted participants";
    await expect(
      cell.getByRole("img", { name: `In-person ${meaning}: ${demand.physical[status]}`, exact: true }),
    ).toHaveText(String(demand.physical[status]));
    await expect(
      cell.getByRole("img", { name: `Remote ${meaning}: ${demand.remote[status]}`, exact: true }),
    ).toHaveText(String(demand.remote[status]));
  }
  await expect(table.getByRole("row").filter({ hasText: "Different program track" })).toHaveCount(0);
  await capture(page, info, "track-filter-demand-table");
  await page.getByRole("tab", { name: "Agenda", exact: true }).click();
  await page.getByRole("button", { name: `Open session details: ${occurrence.title}`, exact: true }).click();
  const details = page.getByRole("dialog", { name: occurrence.title, exact: true });
  await expect(details).toBeVisible();
  await runRowAction(page, details, "Edit session");
  await expect(details).toBeHidden();
  const editor = page.getByRole("dialog", { name: "Edit session", exact: true });
  await expect(editor).toBeVisible();
  await expect(page.getByRole("dialog")).toHaveCount(1);
  await expect(editor.locator("form")).toHaveCount(1);
  await expect(editor.getByLabel("Track", { exact: true })).toHaveValue(track);
  // Demand is a statistic shown in the Sessions table and event statistics, never in the edit view.
  await editor.getByRole("tab", { name: "Participation", exact: true }).click();
  await expect(editor.getByRole("table", { name: "Current session demand", exact: true })).toHaveCount(0);
  await capture(page, info, "track-modal-editor");
  await editor.getByRole("tab", { name: "Session", exact: true }).click();
  const beforeDraft = agendaSnapshotSchema.parse(await (await page.request.get(base)).json());
  const mutations: string[] = [];
  const recordMutation = (request: Request) => {
    if (
      ["POST", "PATCH", "PUT", "DELETE"].includes(request.method()) &&
      new URL(request.url()).pathname.startsWith(base)
    )
      mutations.push(request.url());
  };
  page.on("request", recordMutation);
  await editor.getByLabel("Track", { exact: true }).fill("");
  await expect(editor.getByLabel("Track", { exact: true })).toHaveValue("");
  await expect(editor.getByRole("button", { name: /^Actions for / })).toHaveCount(0);
  expect(agendaSnapshotSchema.parse(await (await page.request.get(base)).json())).toEqual(beforeDraft);
  await editor.getByRole("button", { name: "Cancel", exact: true }).click();
  await expect(editor).toBeHidden();
  expect(agendaSnapshotSchema.parse(await (await page.request.get(base)).json())).toEqual(beforeDraft);
  expect(mutations).toEqual([]);
  await page.getByRole("button", { name: `Open session details: ${occurrence.title}`, exact: true }).click();
  await runRowAction(page, details, "Edit session");
  await expect(details).toBeHidden();
  await expect(editor.getByLabel("Track", { exact: true })).toHaveValue(track);
  await editor.getByLabel("Track", { exact: true }).fill("");
  expect(mutations).toEqual([]);
  page.off("request", recordMutation);
  const clearedTrack = page.waitForResponse(
    (response) =>
      new URL(response.url()).pathname === `${base}/occurrences/${occurrence.id}` &&
      response.request().method() === "PATCH",
  );
  await editor.getByRole("button", { name: "Save session", exact: true }).click();
  const clearedResponse = await clearedTrack;
  expect(clearedResponse.status(), await clearedResponse.text()).toBe(200);
  const patch = agendaOccurrencePatchSchema.parse(clearedResponse.request().postDataJSON());
  expect(patch.expectedRevision).toBe(beforeDraft.revision);
  expect(patch.track).toBeNull();
  snapshot = agendaSnapshotSchema.parse(await clearedResponse.json());
  expect(snapshot.revision).toBe(beforeDraft.revision + 1);
  await expect(editor).toBeHidden();
  expect(snapshot.occurrences.find((item) => item.id === occurrence.id)?.track).toBeNull();
  await page.getByRole("tab", { name: "Schedule", exact: true }).click();
  await expect(page.getByRole("button", { name: "Clear the Track filter", exact: true })).toBeVisible();
  await expect(page.getByRole("row").filter({ hasText: occurrence.title })).toHaveCount(0);
});
