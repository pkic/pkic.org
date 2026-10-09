import { enableAgendaEditing, openOrganizerAgenda } from "./helpers/organizer-agenda";
import { writeFile } from "node:fs/promises";
import { expect, test } from "@playwright/test";
import { e2eAdminEmail } from "../helpers/e2e-admin";
import { signInAsE2eStaff } from "./helpers/staff-auth";
import { submitProposal, decideProposal } from "./helpers/proposals";
import { runAgendaAction } from "./helpers/agenda-actions";
import { runRowAction } from "./helpers/data-table";
import { agendaImportSchema, agendaSnapshotSchema } from "../../assets/shared/schemas/event-agenda";
import { formatTimeRangeInZone } from "../../assets/shared/format-date";
import {
  completeAcceptedPlacement,
  commitAcceptedPlacement,
  openSessionSources,
  movePlacedSession,
  readPlacementAgenda,
  startPlacementDrag,
} from "./helpers/agenda-placement-interactions";
test.use({ hasTouch: false, viewport: { width: 1280, height: 900 }, actionTimeout: 20_000 });
const group = "20000000-0000-4000-8000-000000000003";
test("accepted sources place and move between times and rooms through native pointer, keyboard and touch", async ({
  page,
  browser,
}) => {
  test.setTimeout(240_000);
  await signInAsE2eStaff(page, e2eAdminEmail("portal-agenda-accepted-placement"));
  const unique = `${Date.now()}-${test.info().workerIndex}`;
  const slug = `accepted-placement-${unique}`;
  const created = await page.request.post(`/api/v1/groups/${group}/events`, {
    data: {
      slug,
      name: "Accepted placement browser journey",
      timezone: "UTC",
      startsAt: "2027-09-10T09:00:00.000Z",
      endsAt: "2027-09-10T17:00:00.000Z",
      profileKey: "workshop",
      registrationPolicy: "no_registration",
      links: [],
    },
  });
  expect(created.status(), await created.text()).toBe(201);
  const event = (await created.json()).event;
  const terms = await page.request.put(`/api/v1/groups/${group}/events/${event.id}/terms`, {
    data: {
      expectedUpdatedAt: event.updatedAt,
      configuration: {
        attendee: [
          { termKey: "e2e-attendee-terms", version: "1.0", required: true, displayText: "E2E attendee terms" },
        ],
        speaker: [{ termKey: "e2e-proposal-terms", version: "1.0", required: true, displayText: "E2E proposal terms" }],
        presentation: [],
      },
    },
  });
  expect(terms.status(), await terms.text()).toBe(200);
  const registration = await page.request.put(`/api/v1/groups/${group}/events/${event.id}/registration-settings`, {
    data: {
      expectedUpdatedAt: (await terms.json()).eventUpdatedAt,
      registrationPolicy: "public",
    },
  });
  expect(registration.status(), await registration.text()).toBe(200);
  for (let index = 1; index <= 4; index++) {
    const proposal = await submitProposal(page, {
      eventSlug: slug,
      proposerEmail: `accepted-placement-${unique}-${index}@example.test`,
      firstName: "Synthetic",
      lastName: `Speaker ${index}`,
      title: `Accepted placement ${index}`,
      abstract: "A sufficiently detailed abstract describing a synthetic session to verify accepted source scheduling.",
    });
    expect(await decideProposal(page, proposal.proposalId, "accepted")).toBe(200);
  }
  await openOrganizerAgenda(page, slug);
  for (const name of ["Workshop", "Second workshop"]) {
    await runAgendaAction(page, "New location");
    await page.getByRole("textbox", { name: /^Location name/ }).fill(name);
    await page.getByLabel("Physical capacity", { exact: true }).fill("40");
    await page.getByRole("button", { name: "Save location", exact: true }).click();
  }
  const endpoint = `/api/v1/events/${slug}/agenda`;
  const workshop = (await readPlacementAgenda(page, endpoint)).rooms.find((value) => value.name === "Workshop")!;
  expect(workshop).toBeDefined();
  await runAgendaAction(page, "Scheduling rules");
  const rules = page.getByRole("dialog", { name: "Scheduling rules", exact: true });
  await rules.getByLabel(/^Default session duration/).fill("60");
  await rules.getByRole("button", { name: "Save rules", exact: true }).click();
  await expect(rules).toBeHidden();
  await enableAgendaEditing(page);
  await openSessionSources(page);
  await page.evaluate(() => {
    const journal: unknown[] = [];
    Object.assign(window, { acceptedPlacementDragJournal: journal });
    for (const type of ["dragstart", "dragenter", "dragover", "drop", "dragend"]) {
      document.addEventListener(
        type,
        (event) => {
          const drag = event as DragEvent;
          const target = event.target instanceof Element ? event.target : null;
          const entry = {
            type,
            target: target?.tagName,
            label: target?.getAttribute("aria-label") ?? target?.textContent?.slice(0, 120),
            types: Array.from(drag.dataTransfer?.types ?? []),
            payload: drag.dataTransfer?.getData("application/x-pkic-accepted-proposal"),
            sessionPayload: drag.dataTransfer?.getData("text/plain"),
            effectAllowed: drag.dataTransfer?.effectAllowed,
            dropEffect: drag.dataTransfer?.dropEffect,
            clientX: drag.clientX,
            clientY: drag.clientY,
            defaultPrevented: event.defaultPrevented,
            hit: document.elementFromPoint(drag.clientX, drag.clientY)?.outerHTML.slice(0, 400),
          };
          journal.push(entry);
          queueMicrotask(() => {
            entry.defaultPrevented = event.defaultPrevented;
          });
        },
        true,
      );
    }
  });
  const imports: ReturnType<typeof agendaImportSchema.parse>[] = [];
  page.on("request", (request) => {
    if (request.method() === "POST" && new URL(request.url()).pathname.endsWith("/agenda/imports"))
      imports.push(agendaImportSchema.parse(request.postDataJSON()));
  });
  for (let index = 1; index <= 2; index++) {
    const before = await readPlacementAgenda(page, endpoint);
    const title = page
      .getByRole("complementary", { name: "Session sources", exact: true })
      .getByRole("heading", { name: `Accepted placement ${index}`, exact: true });
    const startAt = `2027-09-10T${index === 1 ? "09" : "10"}:00:00.000Z`;
    const endAt = `2027-09-10T${index === 1 ? "10" : "11"}:00:00.000Z`;
    await startPlacementDrag(page, title);
    const destination = page
      .getByRole("button", {
        name: `Schedule selected proposal at ${formatTimeRangeInZone(startAt, undefined, before.timeZone)} in ${workshop.name}`,
        exact: true,
      })
      .first();
    await expect(destination).toBeVisible();
    await destination.scrollIntoViewIfNeeded();
    const target = await destination.boundingBox();
    expect(target).not.toBeNull();
    expect(
      await destination.evaluate((element) => {
        const rect = element.getBoundingClientRect();
        return element.contains(document.elementFromPoint(rect.x + rect.width / 2, rect.y + rect.height / 2));
      }),
      "The visible drop control must own its pointer destination",
    ).toBe(true);
    await page.mouse.move(target!.x + target!.width / 2, target!.y + target!.height / 2, { steps: 12 });
    await page.mouse.move(target!.x + target!.width / 2 + 1, target!.y + target!.height / 2 + 1);
    expect(imports.filter((value) => !value.dryRun)).toHaveLength(index - 1);
    await commitAcceptedPlacement(page, endpoint, `Accepted placement ${index}`, startAt, endAt, before, () =>
      page.mouse.up(),
    );
    await expect(page.getByRole("dialog", { name: /placement/i })).toHaveCount(0);
  }
  const row = page
    .getByRole("complementary", { name: "Session sources", exact: true })
    .getByRole("article")
    .filter({ has: page.getByRole("heading", { name: "Accepted placement 3", exact: true }) });
  await runRowAction(page, row, "Choose a calendar slot");
  await page.getByRole("button", { name: "Cancel selection", exact: true }).press("Enter");
  const snapshot = agendaSnapshotSchema.parse(await (await page.request.get(`/api/v1/events/${slug}/agenda`)).json());
  expect(snapshot.occurrences).toHaveLength(2);
  expect(imports.filter((value) => !value.dryRun)).toHaveLength(2);
  await completeAcceptedPlacement(
    page,
    endpoint,
    "Accepted placement 3",
    "2027-09-10T12:00:00.000Z",
    "2027-09-10T13:00:00.000Z",
    "keyboard",
  );
  await movePlacedSession(page, endpoint, "Accepted placement 1", "2027-09-10T11:00:00.000Z", "pointer");
  await movePlacedSession(page, endpoint, "Accepted placement 2", "2027-09-10T12:00:00.000Z", "keyboard");
  // Transfer the real authenticated browser state in memory only; touch keeps its own input context.
  const touchContext = await browser.newContext({
    baseURL: new URL(page.url()).origin,
    storageState: await page.context().storageState(),
    viewport: { width: 390, height: 844 },
    hasTouch: true,
    isMobile: true,
  });
  touchContext.setDefaultTimeout(20_000);
  try {
    const touchPage = await touchContext.newPage();
    touchPage.on("request", (request) => {
      if (request.method() === "POST" && new URL(request.url()).pathname === `${endpoint}/imports`)
        imports.push(agendaImportSchema.parse(request.postDataJSON()));
    });
    expect(await readPlacementAgenda(touchPage, endpoint)).toEqual(await readPlacementAgenda(page, endpoint));
    await openOrganizerAgenda(touchPage, slug);
    await enableAgendaEditing(touchPage, (control) => control.tap());
    await openSessionSources(touchPage);
    await completeAcceptedPlacement(
      touchPage,
      endpoint,
      "Accepted placement 4",
      "2027-09-10T14:00:00.000Z",
      "2027-09-10T15:00:00.000Z",
      "touch",
    );
    await movePlacedSession(touchPage, endpoint, "Accepted placement 3", "2027-09-10T13:00:00.000Z", "touch");
    await expect.poll(() => touchPage.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
    await touchPage.evaluate(async () => {
      window.scrollTo(0, 0);
      await document.fonts.ready;
      await new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
    });
    await touchPage.screenshot({ path: test.info().outputPath("accepted-placement-phone.png"), fullPage: true });
  } finally {
    await touchContext.close();
  }
  expect(imports.filter((value) => !value.dryRun)).toHaveLength(4);
  expect(imports.every((value) => value.proposalPlacement && value.proposalIds?.length === 1)).toBe(true);
  await page.reload();
  await expect(page.getByRole("heading", { name: "Accepted placement 4", exact: true })).toBeVisible();
  await page.evaluate(async () => {
    window.scrollTo(0, 0);
    await document.fonts.ready;
    await new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
  });
  await page.screenshot({ path: test.info().outputPath("accepted-placement-desktop.png"), fullPage: true });
});

test.afterEach(async ({ page }, testInfo) => {
  if (testInfo.status === testInfo.expectedStatus) return;
  const journal = await page.evaluate(() => Reflect.get(window, "acceptedPlacementDragJournal") ?? []).catch(() => []);
  await writeFile(testInfo.outputPath("accepted-placement-native-drag-journal.json"), JSON.stringify(journal, null, 2));
  await testInfo.attach("accepted-placement-native-drag-journal", {
    body: JSON.stringify(journal, null, 2),
    contentType: "application/json",
  });
});
