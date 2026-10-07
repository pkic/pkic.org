import { runAgendaAction } from "./helpers/agenda-actions";
import { runRowAction } from "./helpers/data-table";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { expect, test, type BrowserContext } from "@playwright/test";
import ICAL from "ical.js";
import { e2eAdminEmail } from "../helpers/e2e-admin";
import { agendaSnapshotSchema } from "../../assets/shared/schemas/event-agenda";
import { publishE2eSite } from "./helpers/site-publication";
import { startPublicAgendaOutage } from "./helpers/public-agenda-outage";
import { signInAsE2eStaff } from "./helpers/staff-auth";
import { conferenceProgramSchema } from "../../assets/shared/schemas/conference-program";
import { eventFormsResponseSchema } from "../../assets/shared/schemas/forms";
import { attendancePeopleExportQuerySchema } from "../../assets/shared/schemas/event-attendance-exports";
import { agendaOccurrenceRoomIds } from "../../assets/shared/event-agenda-rooms";
import { publicSessionCredits } from "../../assets/shared/session-public-credits";
import { publishedSessionRoute } from "../../assets/shared/session-public-route";
import { formatTimeRangeInZone } from "../../assets/shared/format-date";
import { dateTimeLocalToIso } from "../../assets/shared/timezone";
import { eventDetailResponseSchema } from "../../assets/shared/schemas/event-management";
import { groupEventCreateSchema, groupEventDetailResponseSchema } from "../../assets/shared/schemas/group-events";

import { commitScheduleCommand, expectUnclippedAgendaLink } from "./helpers/agenda-placement-interactions";

const artifacts = process.env.AGENDA_SCREENSHOT_DIR ?? "test-results/agenda-progress";

test.use({ actionTimeout: 20_000 });

test("organizers build the shared agenda and browse a compact session table on desktop and phone", async ({
  page,
  browser,
}, testInfo) => {
  test.setTimeout(300_000);
  await mkdir(artifacts, { recursive: true });
  await signInAsE2eStaff(page, e2eAdminEmail("portal-agenda-platform"));
  const ownerResponse = await page.request.get("/api/v1/events/pqc-conference-amsterdam-nl");
  expect(ownerResponse.status(), await ownerResponse.text()).toBe(200);
  const ownerEvent = eventDetailResponseSchema.parse(await ownerResponse.json()).event;
  if (!("ownerGroupId" in ownerEvent) || !ownerEvent.ownerGroupId)
    throw new Error("The canonical conference has no owning group");
  const request = groupEventCreateSchema.parse({
    slug: `public-agenda-outage-${crypto.randomUUID()}`,
    name: "Synthetic public agenda outage conference",
    profileKey: "conference",
    visibility: "public",
    registrationPolicy: "no_registration",
    timezone: "Europe/Amsterdam",
    location: "Amsterdam, The Netherlands",
    startsAt: dateTimeLocalToIso("2026-12-01T09:00", "Europe/Amsterdam"),
    endsAt: dateTimeLocalToIso("2026-12-03T17:00", "Europe/Amsterdam"),
    links: [],
  });
  const createdResponse = await page.request.post(`/api/v1/groups/${ownerEvent.ownerGroupId}/events`, {
    data: request,
  });
  expect(createdResponse.status(), await createdResponse.text()).toBe(201);
  const createdEvent = groupEventDetailResponseSchema.parse(await createdResponse.json()).event;
  expect(createdEvent).toMatchObject({ ...request, ownerGroupId: ownerEvent.ownerGroupId });
  const slug = createdEvent.slug;
  await page.goto(`/portal/#/events/${slug}/agenda`);
  await expect(page.getByRole("button", { name: "Actions for Agenda", exact: true })).toBeVisible();
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({ path: `${artifacts}/agenda-empty.png`, fullPage: true });
  for (const [name, capacity] of [
    ["Main auditorium", "1200"],
    ["Workshop room", "80"],
    ["Community discussion room", "40"],
  ]) {
    await runAgendaAction(page, "New location");
    await page.getByRole("textbox", { name: /^Location name/ }).fill(name);
    await page.getByLabel("Physical capacity", { exact: true }).fill(capacity);
    await page.getByRole("button", { name: "Save location", exact: true }).click();
    await expect(page.getByRole("textbox", { name: /^Location name/ })).toHaveCount(0);
  }
  const sessions = [
    ["Opening: building trust together", "2026-12-01T09:00", "2026-12-01T09:45", "Main auditorium", "preference"],
    ["Hands-on post-quantum migration", "2026-12-01T09:00", "2026-12-01T10:30", "Workshop room", "reservation"],
    ["Coffee and conversations", "2026-12-01T09:45", "2026-12-01T10:15", "Main auditorium", "preference"],
    [
      "A practical roadmap for cryptographic agility: coordinating infrastructure, application teams, and standards through a multi-year transition",
      "2026-12-01T10:15",
      "2026-12-01T11:00",
      "Community discussion room",
      "preference",
    ],
    ["Deploying trust at scale", "2026-12-02T09:00", "2026-12-02T10:00", "Main auditorium", "preference"],
  ];
  for (const [title, start, end, room, policy] of sessions) {
    await runAgendaAction(page, "New session");
    const editor = page.getByRole("dialog", { name: "New session", exact: true });
    await editor.getByRole("textbox", { name: /^Session title/ }).fill(title);
    await editor.getByLabel("Starts", { exact: true }).fill(start);
    await editor.getByLabel("Ends", { exact: true }).fill(end);
    await editor.getByLabel("Locations", { exact: true }).selectOption({ label: room });
    await editor.getByRole("tab", { name: "Optional / settings", exact: true }).click();
    await editor.getByLabel("Admission", { exact: true }).selectOption(policy);
    await editor
      .getByLabel("Description", { exact: true })
      .fill("Explore practical approaches with the PKI community, with time for discussion and questions.");
    await editor.getByRole("button", { name: "Save session", exact: true }).click();
    await expect(editor).toBeHidden();
  }
  await expect(page.getByText(sessions[0][0], { exact: true }).first()).toBeVisible();
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({ path: `${artifacts}/agenda-desktop.png`, fullPage: true });
  await page.evaluate(() => document.documentElement.setAttribute("data-theme", "dark"));
  await page.screenshot({ path: `${artifacts}/agenda-desktop-dark.png`, fullPage: true });
  await page.evaluate(() => document.documentElement.setAttribute("data-theme", "light"));
  await page.getByRole("tab", { name: "Schedule", exact: true }).click();
  await expect(page.getByRole("row").filter({ hasText: sessions[4][0] })).toBeVisible();
  await expect(page.getByText(/Draft revision/)).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Approve for publication", exact: true })).toHaveCount(0);
  const sessionToolbar = page.getByRole("toolbar", { name: "Event sessions controls", exact: true });
  await expect(sessionToolbar.getByRole("button", { name: "Actions for Agenda", exact: true })).toHaveCount(0);
  await expect(
    page
      .getByRole("region", { name: `Agenda — ${createdEvent.name}`, exact: true })
      .getByRole("button", { name: "Actions for Agenda", exact: true }),
  ).toBeVisible();
  await expect(page.getByRole("button", { name: "Actions for Agenda", exact: true })).toHaveCount(1);
  await expect(
    page
      .getByRole("tabpanel", { name: "Schedule", exact: true })
      .getByRole("button", { name: "Actions for Agenda", exact: true }),
  ).toHaveCount(0);
  await expect(sessionToolbar.getByRole("button", { name: "New session", exact: true })).toBeVisible();
  await page.screenshot({ path: `${artifacts}/sessions-native-toolbar-desktop.png`, fullPage: true });
  await runAgendaAction(page, "Review for publication");
  await expect(page.getByRole("heading", { name: "Review for publication", exact: true })).toBeVisible();
  await expect(page.getByRole("table")).toHaveCount(0);
  await expect(page.getByText("Draft revision", { exact: true })).toBeVisible();
  await page.screenshot({ path: `${artifacts}/agenda-publication-review-desktop.png`, fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({ path: `${artifacts}/agenda-publication-review-phone.png`, fullPage: true });
  await page.getByRole("button", { name: "Back to agenda", exact: true }).click();
  await expect(page.getByRole("table")).toBeVisible();
  await expect(page.getByText(/Draft revision/)).toHaveCount(0);
  await page.screenshot({ path: `${artifacts}/sessions-native-toolbar-phone.png`, fullPage: true });
  await page.setViewportSize({ width: 1280, height: 900 });

  await page.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({ path: `${artifacts}/sessions-desktop.png`, fullPage: true });
  await page.getByRole("button", { name: "Conflicts column options", exact: true }).click();
  await page.getByRole("menuitem", { name: "Filter", exact: true }).click();
  const filtered = page.waitForResponse(
    (response) =>
      response.url().includes("/agenda/occurrences?") &&
      new URL(response.url()).searchParams.get("conflict") === "clear",
  );
  await page.getByRole("menuitemradio", { name: "No conflicts", exact: true }).click();
  expect((await filtered).status()).toBe(200);
  await expect(page.getByRole("row").filter({ hasText: sessions[0][0] })).toBeVisible();
  const beforeBulk = agendaSnapshotSchema.parse(await (await page.request.get(`/api/v1/events/${slug}/agenda`)).json());
  for (const title of [sessions[0][0], sessions[2][0]])
    await page.getByRole("checkbox", { name: title, exact: true }).check();
  await expect(page.getByText("2 of 5 selected", { exact: true })).toBeVisible();
  await page.setViewportSize({ width: 390, height: 844 });
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
  await page.screenshot({ path: `${artifacts}/sessions-bulk-phone.png`, fullPage: true });
  await page.getByRole("button", { name: "Move selected sessions", exact: true }).click();
  await page.locator('[name="bulkMode"]').selectOption("day");
  await page.getByLabel(/^New day/).fill("2026-12-03");
  const afterBulk = await commitScheduleCommand(page, slug, beforeBulk, async () => {
    await page.getByRole("button", { name: "Review selected sessions", exact: true }).click();
    await expect(page.getByRole("heading", { name: "Review schedule changes", exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: "Apply reviewed schedule", exact: true })).toBeEnabled();
    const reviewedBulk = agendaSnapshotSchema.parse(
      await (await page.request.get(`/api/v1/events/${slug}/agenda`)).json(),
    );
    expect(reviewedBulk).toEqual(beforeBulk);
    await page.screenshot({ path: `${artifacts}/sessions-bulk-review-phone.png`, fullPage: true });
    await page.getByRole("button", { name: "Apply reviewed schedule", exact: true }).click();
    await expect(page.getByRole("heading", { name: "Review schedule changes", exact: true })).toHaveCount(0);
  });
  expect(afterBulk.revision).toBe(beforeBulk.revision + 1);
  for (const title of [sessions[0][0], sessions[2][0]]) {
    const original = beforeBulk.occurrences.find((row) => row.title === title)!;
    const moved = afterBulk.occurrences.find((row) => row.id === original.id)!;
    expect(moved.startAt).toBe(original.startAt!.replace("2026-12-01", "2026-12-03"));
    expect(Date.parse(moved.endAt!) - Date.parse(moved.startAt!)).toBe(
      Date.parse(original.endAt!) - Date.parse(original.startAt!),
    );
  }
  await expect(page.getByText("2 of 5 selected", { exact: true })).toHaveCount(0);
  const undoneBulk = await commitScheduleCommand(page, slug, afterBulk, () =>
    runAgendaAction(page, "Undo last session edit"),
  );
  expect(undoneBulk.revision).toBe(beforeBulk.revision + 2);
  expect(undoneBulk.occurrences).toEqual(beforeBulk.occurrences);
  const beforeUnschedule = undoneBulk;
  const unscheduled = await commitScheduleCommand(page, slug, beforeUnschedule, () =>
    runRowAction(page, page.getByRole("row").filter({ hasText: sessions[0][0] }), "Unschedule session"),
  );
  await expect(page.getByRole("row").filter({ hasText: sessions[0][0] })).toHaveCount(0);
  await page.getByRole("button", { name: "Clear the Conflicts filter", exact: true }).click();
  await expect(page.getByRole("row").filter({ hasText: sessions[0][0] })).toContainText("Unscheduled");
  await page.screenshot({ path: `${artifacts}/session-unscheduled-phone.png`, fullPage: true });
  const originalOpening = beforeUnschedule.occurrences.find((row) => row.title === sessions[0][0])!;
  expect(unscheduled.occurrences.find((row) => row.id === originalOpening.id)).toEqual({
    ...originalOpening,
    startAt: null,
    endAt: null,
  });
  expect(unscheduled.revision).toBe(beforeUnschedule.revision + 1);
  const restored = await commitScheduleCommand(page, slug, unscheduled, () =>
    runAgendaAction(page, "Undo last session edit"),
  );
  expect(restored.occurrences).toEqual(beforeUnschedule.occurrences);
  expect(restored.revision).toBe(beforeUnschedule.revision + 2);
  await page.setViewportSize({ width: 1280, height: 900 });
  await runRowAction(page, page.getByRole("row").filter({ hasText: sessions[0][0] }), "Select for move");
  await expect(page.getByRole("button", { name: /Move selected session at/ }).first()).toBeVisible();
  await page.getByRole("tab", { name: "Schedule", exact: true }).click();
  await page.getByRole("tab", { name: "Agenda", exact: true }).click();
  await expect(page.getByRole("button", { name: /Move selected session at/ }).first()).toBeVisible();
  await page.getByRole("button", { name: "Cancel selection", exact: true }).click();
  await page.getByRole("tab", { name: "Shifts", exact: true }).click();
  const blockRoles = page.getByRole("tabpanel", { name: "Shifts", exact: true });
  const newBlock = blockRoles.getByRole("button", { name: "New shift", exact: true });
  await expect(newBlock).toBeVisible();
  await expect(newBlock).toBeEnabled();
  await page.keyboard.press("Escape");
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({ path: `${artifacts}/staffing-desktop.png`, fullPage: true });
  await page.getByRole("tab", { name: "Agenda", exact: true }).click();
  await page.setViewportSize({ width: 390, height: 844 });
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
  await page.evaluate(() => window.scrollTo(0, 0));
  await expect(page.getByRole("button", { name: /^(Move selected session|End selected session) at/ })).toHaveCount(0);
  const beforeMoveResponse = await page.request.get(`/api/v1/events/${slug}/agenda`);
  const beforeMove = agendaSnapshotSchema.parse(await beforeMoveResponse.json());
  const movedSession = beforeMove.occurrences.find((item) => item.title === sessions[0][0])!;
  await runRowAction(
    page,
    page.getByRole("article").filter({ hasText: sessions[0][0] }).first(),
    "Move to day / location",
  );
  const moveDialog = page.getByRole("dialog", { name: `Move ${movedSession.title}`, exact: true });
  await moveDialog.getByLabel(/^New day and start time/).fill("2026-12-01T12:00");
  await expect(moveDialog.getByRole("button", { name: "Move session", exact: true })).toBeEnabled();
  await page.screenshot({ path: `${artifacts}/agenda-phone-move-confirmation.png`, fullPage: true });
  const stillUnchanged = agendaSnapshotSchema.parse(
    await (await page.request.get(`/api/v1/events/${slug}/agenda`)).json(),
  );
  expect(stillUnchanged).toEqual(beforeMove);
  const afterMove = await commitScheduleCommand(page, slug, beforeMove, () =>
    moveDialog.getByRole("button", { name: "Move session", exact: true }).click(),
  );
  await expect(moveDialog).toBeHidden();
  expect(afterMove.revision).toBe(beforeMove.revision + 1);
  expect(afterMove.occurrences.find((item) => item.id === movedSession.id)?.startAt).toBe("2026-12-01T11:00:00.000Z");
  await page.screenshot({ path: `${artifacts}/agenda-phone.png`, fullPage: true });
  await page.getByRole("tab", { name: "Schedule", exact: true }).click();
  await runRowAction(page, page.getByRole("row").filter({ hasText: sessions[0][0] }), "Select for move");
  await expect(
    page.getByRole("button", { name: /Move selected session at.*Across all locations/ }).first(),
  ).toBeVisible();
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({ path: `${artifacts}/agenda-phone-move.png`, fullPage: true });
  await page.getByRole("button", { name: "Cancel selection", exact: true }).click();
  await expect(page.getByRole("button", { name: /^(Move selected session|End selected session) at/ })).toHaveCount(0);
  const beforeDuplicate = agendaSnapshotSchema.parse(
    await (await page.request.get(`/api/v1/events/${slug}/agenda`)).json(),
  );
  await runRowAction(page, page.getByRole("article").filter({ hasText: sessions[0][0] }).first(), "Duplicate session");
  const duplicateDialog = page.getByRole("dialog", { name: `Duplicate ${sessions[0][0]}`, exact: true });
  await expect(duplicateDialog).toBeVisible();
  await expect(duplicateDialog.getByText(/unscheduled, private occurrence/)).toBeVisible();
  expect(agendaSnapshotSchema.parse(await (await page.request.get(`/api/v1/events/${slug}/agenda`)).json())).toEqual(
    beforeDuplicate,
  );
  await page.screenshot({ path: `${artifacts}/session-duplicate-phone.png`, fullPage: true });
  await duplicateDialog.getByRole("button", { name: "Duplicate session", exact: true }).click();
  await expect(duplicateDialog).toHaveCount(0);
  const afterDuplicate = agendaSnapshotSchema.parse(
    await (await page.request.get(`/api/v1/events/${slug}/agenda`)).json(),
  );
  const repeated = afterDuplicate.occurrences.find(
    (row) => !beforeDuplicate.occurrences.some((before) => before.id === row.id),
  )!;
  const linkedOriginal = afterDuplicate.occurrences.find((row) => row.id === movedSession.id)!;
  expect(afterDuplicate.revision).toBe(beforeDuplicate.revision + 1);
  expect(afterDuplicate.occurrences).toHaveLength(beforeDuplicate.occurrences.length + 1);
  expect(repeated).toMatchObject({
    title: sessions[0][0],
    startAt: null,
    endAt: null,
    roomId: null,
    visibility: "private",
    admissionPolicy: "preference",
    contentId: linkedOriginal.contentId,
  });
  expect(repeated.contentId).not.toBeNull();
  expect(repeated.id).not.toBe(linkedOriginal.id);
  await runAgendaAction(page, "Review for publication");
  await page.getByRole("button", { name: "Approve for publication", exact: true }).click();
  await expect(page.getByRole("button", { name: "Approve for publication", exact: true })).toBeDisabled();
  await page.getByRole("button", { name: "Back to agenda", exact: true }).click();

  const response = await page.request.get(`/api/v1/events/${slug}/agenda`);
  expect(response.status()).toBe(200);
  const approved = agendaSnapshotSchema.parse(await response.json());
  const publicRoute = approved.publicAgendaPath!;
  const controlPath = `/api/v1/events/${slug}/forms/placements/event_registration`;
  const workingControl = await page.request.get(controlPath);
  expect(workingControl.status()).toBe(200);
  expect(eventFormsResponseSchema.parse(await workingControl.json()).event.slug).toBe(slug);
  const artifact = await publishE2eSite(page, publicRoute);
  const outage = await startPublicAgendaOutage(artifact);
  let publicContext: BrowserContext | undefined;
  try {
    publicContext = await browser.newContext({
      javaScriptEnabled: false,
      serviceWorkers: "block",
      baseURL: outage.url.href,
      viewport: { width: 1280, height: 900 },
    });
    for (const name of ["index.html", "data.json", "calendar.ics"]) {
      const path = `${publicRoute}${name}`.slice(1);
      expect(outage.release.files).toContain(path);
      expect(outage.release.integrity!.files[path]).toBeDefined();
    }
    const publicApiRequests: string[] = [];
    await publicContext.route("**/api/**", async (route) => {
      publicApiRequests.push(new URL(route.request().url()).pathname);
      await route.abort("failed");
    });
    const publicPage = await publicContext.newPage();
    // This new origin has had no HTML, export, CSS, or image requests before navigation.
    const firstVisit = await publicPage.goto(publicRoute);
    expect(firstVisit?.status()).toBe(200);
    expect(firstVisit?.headers()["x-pkic-publication"]).toBe(`static; snapshot=${artifact.snapshotId}`);
    const databaseControl = await outage.proveDatabaseUnavailable(slug);
    await writeFile(
      testInfo.outputPath("agenda-public-d1-control.json"),
      JSON.stringify(
        {
          snapshotId: artifact.snapshotId,
          firstVisitStatus: firstVisit?.status(),
          databaseControl,
        },
        null,
        2,
      ),
    );
    const publishedOccurrences = approved.occurrences.filter(
      (occurrence) => occurrence.visibility === "public" && occurrence.startAt && occurrence.endAt,
    );
    expect(publishedOccurrences).toHaveLength(sessions.length);
    const publicAgenda = publicPage.getByRole("region", { name: "Event agenda", exact: true });
    await expect(publicAgenda).toBeVisible();
    for (const occurrence of publishedOccurrences) {
      const article = publicAgenda.locator(`article[data-agenda-occurrence="${occurrence.id}"]`);
      await expect(article).toHaveCount(1);
      await expect(article.getByRole("heading", { name: occurrence.title, exact: true })).toBeVisible();
      await expect(article.locator(".pk-content-agenda__description")).toHaveText(occurrence.description);
      const roomNames = agendaOccurrenceRoomIds(occurrence).map(
        (id) => approved.rooms.find((room) => room.id === id)!.name,
      );
      await expect(article.locator(".pk-content-agenda__room")).toHaveText(roomNames.join(" / "));
      await expect(publicAgenda.locator(`time[datetime="${occurrence.startAt}"]`).first()).toBeVisible();
      for (const credit of publicSessionCredits(occurrence)) {
        await expect(article.getByText(credit.displayName, { exact: true }).first()).toBeVisible();
      }
      for (const url of [occurrence.presentationUrl, occurrence.recordingUrl].filter(Boolean)) {
        await expect(article.locator(`a[href="${url}"]`).first()).toBeVisible();
      }
      // Timeline cards can clip abstracts; their native link must work without the JS dialog.
      const sessionLink = article.getByRole("link", { name: `Open session details: ${occurrence.title}`, exact: true });
      await expect(sessionLink).toBeVisible();
      await expectUnclippedAgendaLink(sessionLink);
      const sessionPath = publishedSessionRoute(slug, occurrence)!;
      await expect(sessionLink).toHaveAttribute("href", sessionPath);
      const ownedSessionPath = `${sessionPath}index.html`.slice(1);
      expect(outage.release.files).toContain(ownedSessionPath);
      expect(outage.release.integrity!.files[ownedSessionPath]).toBeDefined();
      const detailNavigation = publicPage.waitForResponse(
        (result) => result.request().isNavigationRequest() && result.url() === new URL(sessionPath, outage.url).href,
      );
      await sessionLink.click();
      const detailResponse = await detailNavigation;
      expect(detailResponse.status()).toBe(200);
      expect(detailResponse.headers()["x-pkic-publication"]).toBe(`static; snapshot=${artifact.snapshotId}`);
      const details = publicPage.getByRole("article").filter({
        has: publicPage.getByRole("heading", {
          name: occurrence.title,
          exact: true,
          level: 1,
        }),
      });
      await expect(details.getByRole("heading", { name: occurrence.title, exact: true, level: 1 })).toBeVisible();
      await expect(details.getByText(occurrence.description, { exact: true })).toBeVisible();
      await expect(details.getByText(occurrence.description, { exact: true })).toHaveText(occurrence.description);
      const detailTime = details.locator("time").first();
      await expect(detailTime).toBeVisible();
      await expect(detailTime).toHaveAttribute("datetime", occurrence.startAt!);
      const timing = details.locator("p:has(time)");
      await expect(timing).toContainText(
        formatTimeRangeInZone(occurrence.startAt!, occurrence.endAt!, approved.timeZone),
      );
      await expect(timing).toContainText(approved.timeZone);
      for (const name of roomNames) await expect(timing).toContainText(name);
      for (const credit of publicSessionCredits(occurrence)) {
        await expect(details.getByText(credit.displayName, { exact: true }).first()).toBeVisible();
      }
      const fullAgenda = details.getByRole("link", { name: "Full agenda", exact: true });
      await expect(fullAgenda).toHaveAttribute("href", publicRoute);
      const returnNavigation = publicPage.waitForResponse(
        (result) => result.request().isNavigationRequest() && result.url() === new URL(publicRoute, outage.url).href,
      );
      await fullAgenda.click();
      const returnResponse = await returnNavigation;
      expect(returnResponse.status()).toBe(200);
      expect(returnResponse.headers()["x-pkic-publication"]).toBe(`static; snapshot=${artifact.snapshotId}`);
      await expect(publicAgenda).toBeVisible();
    }
    await expect(publicAgenda.locator(`article[data-agenda-occurrence="${repeated.id}"]`)).toHaveCount(0);
    await expect(publicPage.getByRole("button", { name: "New session", exact: true })).toHaveCount(0);
    await expect(
      publicPage.getByText(/Loading (?:agenda|schedule)|Sign in to (?:view|load) (?:agenda|schedule)/i),
    ).toHaveCount(0);
    // Verify the real linked static CSS, not a portal-inherited or stale build token.
    const canonicalTokens = await readFile("assets/design/tokens.agenda.generated.css", "utf8");
    const colors = [...canonicalTokens.matchAll(/(--pk-agenda-location-\d+):\s*([^;]+);/g)];
    expect(colors).toHaveLength(6);
    const stylesheetUrls = await publicPage
      .locator('link[rel="stylesheet"]')
      .evaluateAll((links) => links.map((link) => (link as HTMLLinkElement).href));
    const linkedStyles = await Promise.all(
      stylesheetUrls.map(async (url) => {
        const response = await publicPage.request.get(url);
        expect(response.status()).toBe(200);
        return response.text();
      }),
    );
    expect(linkedStyles.some((css) => css.includes("--pk-agenda-location-1:"))).toBe(true);
    for (const [, token, value] of colors) {
      expect(
        await publicPage.evaluate(
          (name) => getComputedStyle(document.documentElement).getPropertyValue(name).trim(),
          token,
        ),
      ).toBe(value.trim());
    }
    await publicPage.evaluate(() => window.scrollTo(0, 0));
    await expect.poll(() => publicPage.evaluate(() => window.scrollY)).toBe(0);
    await expect.poll(() => publicPage.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(1280);
    await publicPage.screenshot({
      path: testInfo.outputPath("agenda-public-no-d1-desktop.png"),
      fullPage: true,
      animations: "disabled",
    });
    const publicData = await publicPage.request.get(`${publicRoute}data.json`);
    expect(publicData.status()).toBe(200);
    const program = conferenceProgramSchema.parse(await publicData.json());
    const exportedSessions = Object.values(program.agenda).flatMap((slots) =>
      slots.flatMap((slot) => slot.sessions.map((session) => ({ slot, session }))),
    );
    expect(exportedSessions.map(({ session }) => session.id).sort()).toEqual(
      publishedOccurrences.map((occurrence) => occurrence.id).sort(),
    );
    const calendar = await publicPage.request.get(`${publicRoute}calendar.ics`);
    expect(calendar.status()).toBe(200);
    const calendarComponent = new ICAL.Component(ICAL.parse(await calendar.text()));
    expect(calendarComponent.name).toBe("vcalendar");
    const calendarEvents = calendarComponent
      .getAllSubcomponents("vevent")
      .map((component) => new ICAL.Event(component));
    expect(calendarEvents).toHaveLength(publishedOccurrences.length);
    for (const occurrence of publishedOccurrences) {
      const exported = exportedSessions.find(({ session }) => session.id === occurrence.id)!;
      expect(exported.slot.startsAt).toBe(occurrence.startAt);
      await expect(publicAgenda.locator(`time[datetime="${occurrence.startAt}"]`).first()).toHaveText(
        exported.slot.time,
      );
      expect(exported.session).toMatchObject({
        title: occurrence.title,
        description: occurrence.description,
        endsAt: occurrence.endAt,
        locations: agendaOccurrenceRoomIds(occurrence),
      });
      const item = calendarEvents.find((event) => event.uid === `agenda-${occurrence.id}@ics.pkic.org`)!;
      expect(item.summary).toBe(occurrence.title);
      expect(item.description).toContain(occurrence.description);
      expect(item.startDate.toJSDate().toISOString()).toBe(occurrence.startAt);
      expect(item.endDate.toJSDate().toISOString()).toBe(occurrence.endAt);
      expect(item.location).toBe(
        agendaOccurrenceRoomIds(occurrence)
          .map((id) => approved.rooms.find((room) => room.id === id)!.name)
          .join(", "),
      );
    }
    const draft = await page.request.patch(`/api/v1/events/${slug}/agenda/occurrences/${approved.occurrences[0].id}`, {
      data: { expectedRevision: approved.revision, title: "Unpublished private planning title" },
    });
    expect(draft.status()).toBe(200);
    await publicPage.reload();
    await expect(publicPage.getByText("Unpublished private planning title", { exact: true })).toHaveCount(0);
    await expect(publicPage.getByText(sessions[0][0], { exact: true }).first()).toBeVisible();
    await publicPage.setViewportSize({ width: 390, height: 844 });
    await expect(publicPage.getByText(sessions[0][0], { exact: true }).first()).toBeVisible();
    for (const occurrence of publishedOccurrences) {
      const article = publicAgenda.locator(`article[data-agenda-occurrence="${occurrence.id}"]`);
      const description = article.locator(".pk-content-agenda__description");
      await expect(description).toBeVisible();
      await expect(description).toHaveText(occurrence.description);
      await expectUnclippedAgendaLink(
        article.getByRole("link", { name: `Open session details: ${occurrence.title}`, exact: true }),
      );
    }
    await publicPage.evaluate(() => window.scrollTo(0, 0));
    await expect.poll(() => publicPage.evaluate(() => window.scrollY)).toBe(0);
    await expect.poll(() => publicPage.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
    await publicPage.screenshot({
      path: testInfo.outputPath("agenda-public-no-d1-phone.png"),
      fullPage: true,
      animations: "disabled",
    });
    expect(publicApiRequests).toEqual([]);
    await writeFile(
      testInfo.outputPath("agenda-public-outage-proof.json"),
      JSON.stringify(
        {
          snapshotId: artifact.snapshotId,
          approvedRevision: approved.publishedRevision,
          integrityDigest: outage.release.integrity!.digest,
          publicRoute,
          publicOccurrenceIds: publishedOccurrences.map((occurrence) => occurrence.id),
          visitorApiRequests: publicApiRequests,
          javaScriptEnabled: false,
          serviceWorkers: "block",
          browserCacheDisabledByRouting: true,
          firstVisitStatus: firstVisit?.status(),
          databaseControl,
          providerColdCacheAcceptance: "not verified by this local proof",
        },
        null,
        2,
      ),
    );
  } finally {
    try {
      await publicContext?.close();
    } finally {
      await outage.close();
    }
  }
  // The fixture activates a new built release; load its current portal entry too.
  await page.reload();
  await page.goto(`/portal/#/events/${slug}/attendance`);
  await expect(page.getByRole("heading", { name: "Attendance summary", exact: true })).toBeVisible();
  await page.getByRole("link", { name: "View reconciliation diagnostics", exact: true }).click();
  await expect(page.getByText(/Uploads accounted for/)).toBeVisible();
  await page
    .getByRole("navigation", { name: "Attendance sections", exact: true })
    .getByRole("link", { name: "Summary", exact: true })
    .click();
  const dayReport = page.waitForResponse(
    (result) =>
      result.url().includes("/attendance/summary?") &&
      new URL(result.url()).searchParams.get("dayDate") === "2026-12-01",
  );
  await page.getByLabel("Event day", { exact: true }).fill("2026-12-01");
  expect((await dayReport).status()).toBe(200);
  await page.getByRole("combobox", { name: "Session", exact: true }).click();
  await page.getByRole("option", { name: sessions[0][0], exact: true }).click();
  const summaryDownload = page.waitForEvent("download");
  await page.getByRole("link", { name: "Export attendance summary", exact: true }).click();
  const download = await summaryDownload;
  const downloadPath = await download.path();
  expect(downloadPath).not.toBeNull();
  const exported = await readFile(downloadPath!, "utf8");
  expect(exported).toContain("dayDate");
  expect(exported).toContain("2026-12-01");
  expect(exported).toContain("not_established");
  expect(exported).toContain("contactRetention.state");
  await page.getByRole("link", { name: "Observed people", exact: true }).click();
  const peopleExport = page.getByRole("link", { name: "Export observed people", exact: true });
  await expect(peopleExport).toBeVisible();
  const peopleUrl = new URL((await peopleExport.getAttribute("href"))!, page.url());
  expect(peopleUrl.pathname).toBe(`/api/v1/events/${slug}/attendance/people/exports`);
  expect(attendancePeopleExportQuerySchema.parse(Object.fromEntries(peopleUrl.searchParams))).toMatchObject({
    dayDate: "2026-12-01",
    occurrenceId: originalOpening.id,
  });
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({ path: `${artifacts}/attendance-phone.png`, fullPage: true });
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.screenshot({ path: `${artifacts}/attendance-desktop.png`, fullPage: true });
});
