import { runAgendaAction } from "./helpers/agenda-actions";
import { mkdir } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { expect, test } from "@playwright/test";
import {
  agendaOccurrenceCreateSchema,
  agendaOccurrencePatchSchema,
  agendaRevisionSchema,
  agendaRoomCreateSchema,
  agendaSnapshotSchema,
} from "../../assets/shared/schemas/event-agenda";
import { sitePublicationRequestListSchema } from "../../assets/shared/schemas/site-publication-requests";
import { e2eAdminEmail } from "../helpers/e2e-admin";
import { signInAsE2eStaff } from "./helpers/staff-auth";

const slug = "pqc-conference-amsterdam-nl";
const endpoint = `/api/v1/events/${slug}/agenda`;
const artifacts = process.env.AGENDA_SCREENSHOT_DIR ?? "test-results/agenda-preview";
test.use({ actionTimeout: 20_000 });

test("public preview shares the public layout, hides private content and preserves the frozen approved revision", async ({
  page,
}) => {
  test.setTimeout(120_000);
  await mkdir(artifacts, { recursive: true });
  await signInAsE2eStaff(page, e2eAdminEmail("portal-agenda-preview"));
  let snapshot = agendaSnapshotSchema.parse(await (await page.request.get(endpoint)).json());
  const suffix = randomUUID().slice(0, 8);
  const roomResponse = await page.request.post(`${endpoint}/rooms`, {
    data: agendaRoomCreateSchema.parse({
      expectedRevision: snapshot.revision,
      name: `Preview room ${suffix}`,
      capacity: 40,
    }),
  });
  expect(roomResponse.status(), await roomResponse.text()).toBe(200);
  snapshot = agendaSnapshotSchema.parse(await roomResponse.json());
  const roomId = snapshot.rooms.find((room) => room.name === `Preview room ${suffix}`)!.id;
  const publicTitle = `Public preview session ${suffix}`;
  const privateTitle = `Private planning session ${suffix}`;
  const unscheduledTitle = `Unscheduled planning session ${suffix}`;
  for (const [title, visibility, startAt, endAt] of [
    [publicTitle, "public", "2026-12-03T09:00:00.000Z", "2026-12-03T09:30:00.000Z"],
    [privateTitle, "private", "2026-12-03T09:30:00.000Z", "2026-12-03T10:00:00.000Z"],
    [unscheduledTitle, "public", null, null],
  ] as const) {
    const response = await page.request.post(`${endpoint}/occurrences`, {
      data: agendaOccurrenceCreateSchema.parse({
        expectedRevision: snapshot.revision,
        title,
        visibility,
        startAt,
        endAt,
        roomId,
      }),
    });
    expect(response.status(), await response.text()).toBe(200);
    snapshot = agendaSnapshotSchema.parse(await response.json());
  }
  const occurrenceId = snapshot.occurrences.find((row) => row.title === publicTitle)!.id;
  const approval = await page.request.post(`${endpoint}/publications`, {
    data: agendaRevisionSchema.parse({ expectedRevision: snapshot.revision }),
  });
  expect(approval.status(), await approval.text()).toBe(200);
  snapshot = agendaSnapshotSchema.parse(await approval.json());
  const approvedRevision = snapshot.publishedRevision;
  const draftTitle = `Revised public preview session ${suffix}`;
  const changed = await page.request.patch(`${endpoint}/occurrences/${occurrenceId}`, {
    data: agendaOccurrencePatchSchema.parse({ expectedRevision: snapshot.revision, title: draftTitle }),
  });
  expect(changed.status(), await changed.text()).toBe(200);
  const baseline = agendaSnapshotSchema.parse(await changed.json());
  const requestsBefore = sitePublicationRequestListSchema.parse(
    await (await page.request.get(`${endpoint}/publication-requests?limit=100&sort=-sequence`)).json(),
  );
  const previewWrites: string[] = [];
  page.on("request", (request) => {
    if (new URL(request.url()).pathname.startsWith(endpoint) && !["GET", "HEAD", "OPTIONS"].includes(request.method()))
      previewWrites.push(`${request.method()} ${new URL(request.url()).pathname}`);
  });
  await page.goto(`/portal/#/events/${slug}/agenda`);
  await runAgendaAction(page, "Public preview");
  await expect(page.getByRole("heading", { name: "Public agenda preview", exact: true })).toBeVisible();
  await page.locator('[data-agenda-tab="2026-12-03"]').click();
  await expect(page.getByRole("button", { name: `Open session details: ${draftTitle}`, exact: true })).toBeVisible();
  await expect(page.getByText(privateTitle, { exact: true })).toHaveCount(0);
  await expect(page.getByText(unscheduledTitle, { exact: true })).toHaveCount(0);
  await expect(page.locator("form")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "New session", exact: true })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Approve for publication", exact: true })).toHaveCount(0);
  await expect(page.getByRole("button", { name: /^Actions for / })).toHaveCount(0);
  await expect(page.getByText("Resize duration", { exact: true })).toHaveCount(0);
  await page.screenshot({ path: `${artifacts}/agenda-public-preview-desktop.png`, fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({ path: `${artifacts}/agenda-public-preview-phone.png`, fullPage: true });
  await page.getByRole("button", { name: "Approved revision", exact: true }).click();
  await page.locator('[data-agenda-tab="2026-12-03"]').click();
  await expect(page.getByRole("button", { name: `Open session details: ${publicTitle}`, exact: true })).toBeVisible();
  await expect(page.getByText(draftTitle, { exact: true })).toHaveCount(0);
  await expect(page.getByText(privateTitle, { exact: true })).toHaveCount(0);
  await page.screenshot({ path: `${artifacts}/agenda-approved-preview-phone.png`, fullPage: true });
  await page.getByRole("button", { name: "Current draft", exact: true }).click();
  await page.locator('[data-agenda-tab="2026-12-03"]').click();
  await expect(page.getByRole("button", { name: `Open session details: ${draftTitle}`, exact: true })).toBeVisible();
  const after = agendaSnapshotSchema.parse(await (await page.request.get(endpoint)).json());
  expect(after.revision).toBe(baseline.revision);
  expect(after.publishedRevision).toBe(approvedRevision);
  expect(after.occurrences).toEqual(baseline.occurrences);
  const requestsAfter = sitePublicationRequestListSchema.parse(
    await (await page.request.get(`${endpoint}/publication-requests?limit=100&sort=-sequence`)).json(),
  );
  expect(requestsAfter.page.total).toBe(requestsBefore.page.total);
  expect(requestsAfter.requests.map((row) => row.sequence)).toEqual(requestsBefore.requests.map((row) => row.sequence));
  expect(previewWrites).toEqual([]);
  await page.getByRole("button", { name: "Back to agenda", exact: true }).click();
  await expect(page.getByRole("tab", { name: "Agenda", exact: true })).toHaveAttribute("aria-selected", "true");
  await page.getByRole("button", { name: "Actions for Agenda", exact: true }).click();
  await expect(page.getByRole("menuitem", { name: "New session", exact: true })).toBeEnabled();
  await page.keyboard.press("Escape");
});
