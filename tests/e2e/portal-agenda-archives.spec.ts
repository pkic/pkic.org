import { runAgendaAction } from "./helpers/agenda-actions";
import { runRowAction } from "./helpers/data-table";
import { mkdir, readFile } from "node:fs/promises";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { expect, test } from "@playwright/test";
import { JSDOM } from "jsdom";
import { e2eAdminEmail } from "../helpers/e2e-admin";
import { signInAsE2eStaff } from "./helpers/staff-auth";
import { publishE2eSite } from "./helpers/site-publication";
import {
  agendaSnapshotSchema,
  agendaOccurrenceCreateSchema,
  agendaRoomCreateSchema,
} from "../../assets/shared/schemas/event-agenda";
import { apiErrorPayloadSchema } from "../../assets/shared/schemas/api-common";
import { userAuthSessionResponseSchema } from "../../assets/shared/schemas/user-auth";
import {
  sessionAppearanceChoicesSchema,
  sessionHistoryCorrectionSchema,
} from "../../assets/shared/schemas/event-session-history";
const slug = "pqc-conference-amsterdam-nl";
const title = "Historic cryptographic operations and practical migration lessons";
const media = {
  recording: { title: "Reviewed session recording", url: "https://www.youtube.com/watch?v=AbCdEf12345&start=90" },
  captions: { title: "Reviewed session captions", url: "https://example.test/archive-reviewed-captions.vtt" },
  transcript: { title: "Reviewed session transcript", url: "https://example.test/archive-reviewed-transcript.html" },
  draft: { title: "Unreleased draft recording", url: "https://example.test/archive-draft-recording" },
  failed: { title: "Failed recording review", url: "https://example.test/archive-failed-recording" },
};
const rawRecording = "https://example.test/archive-raw-recording-candidate";
const artifacts = process.env.AGENDA_SCREENSHOT_DIR ?? "test-results/agenda-archives";
test.use({ actionTimeout: 20_000 });
test("approved archive corrections and promotion exports remain tied to a frozen public revision", async ({
  page,
  browser,
}, testInfo) => {
  test.setTimeout(300_000);
  await mkdir(artifacts, { recursive: true });
  await signInAsE2eStaff(page, e2eAdminEmail("default"));
  const identity = userAuthSessionResponseSchema.parse(
    await (await page.request.get("/api/v1/auth/session")).json(),
  ).identity;
  let snapshot = agendaSnapshotSchema.parse(await (await page.request.get(`/api/v1/events/${slug}/agenda`)).json());
  for (const name of ["Archive hall", "Archive overflow"]) {
    const room = await page.request.post(`/api/v1/events/${slug}/agenda/rooms`, {
      data: agendaRoomCreateSchema.parse({ expectedRevision: snapshot.revision, name, capacity: 100 }),
    });
    expect(room.status()).toBe(200);
    snapshot = agendaSnapshotSchema.parse(await room.json());
  }
  const roomId = snapshot.rooms.find((room) => room.name === "Archive hall")!.id;
  const overflowId = snapshot.rooms.find((room) => room.name === "Archive overflow")!.id;
  const create = await page.request.post(`/api/v1/events/${slug}/agenda/occurrences`, {
    data: agendaOccurrenceCreateSchema.parse({
      expectedRevision: snapshot.revision,
      title,
      description:
        "**Explore operational lessons** behind cryptographic migration, with practical examples and community discussion.\n\n- Certificate lifecycle boundaries\n- Observable migration controls",
      startAt: "2026-12-02T12:00:00.000Z",
      endAt: "2026-12-02T13:00:00.000Z",
      roomId,
      recordingUrl: rawRecording,
      additionalRoomIds: [overflowId],
      speakerUserIds: [identity.id],
      speakerPlacements: { [identity.id]: { attendanceMode: "physical", roomId } },
    }),
  });
  expect(create.status()).toBe(200);
  snapshot = agendaSnapshotSchema.parse(await create.json());
  const occurrence = snapshot.occurrences.find((item) => item.title === title)!;
  const reviewedOldPath = `/events/${slug}/sessions/previous-archive-title-${occurrence.id}/`;
  const attendancePages = [
    {
      id: occurrence.id,
      policyLabel: "No session registration",
      action: "Save favorite",
      message: "Saving interest does not reserve a place. Admission remains first come, first served.",
    },
  ];
  for (const policy of [
    {
      admissionPolicy: "optional_reservation",
      accessPolicy: "open",
      hour: "08",
      policyLabel: "Registration optional",
      action: "Register if you wish",
    },
    {
      admissionPolicy: "reservation",
      accessPolicy: "open",
      hour: "09",
      policyLabel: "Registration required",
      action: "Register for session",
    },
    {
      admissionPolicy: "preference",
      accessPolicy: "invitation",
      hour: "10",
      policyLabel: "Invitation required",
      action: "Invitation required",
    },
    {
      admissionPolicy: "approval",
      accessPolicy: "open",
      hour: "11",
      policyLabel: "Approval required",
      action: "Request approval",
    },
  ] as const) {
    const policyTitle = `Archive attendance · ${policy.policyLabel}`;
    const created = await page.request.post(`/api/v1/events/${slug}/agenda/occurrences`, {
      data: agendaOccurrenceCreateSchema.parse({
        expectedRevision: snapshot.revision,
        title: policyTitle,
        description: "A substantive public session explaining cryptographic operations and its attendance policy.",
        startAt: `2026-12-02T${policy.hour}:00:00.000Z`,
        endAt: `2026-12-02T${policy.hour}:30:00.000Z`,
        roomId,
        admissionPolicy: policy.admissionPolicy,
        accessPolicy: policy.accessPolicy,
      }),
    });
    expect(created.status()).toBe(200);
    snapshot = agendaSnapshotSchema.parse(await created.json());
    attendancePages.push({
      id: snapshot.occurrences.find((item) => item.title === policyTitle)!.id,
      policyLabel: policy.policyLabel,
      action: policy.action,
      message:
        policy.accessPolicy === "invitation"
          ? "Sign in to check your invitation and current session availability."
          : "Sign in to check current availability and your session registration.",
    });
  }

  const privateTitle = "Private archive planning notes";
  const privateCreate = await page.request.post(`/api/v1/events/${slug}/agenda/occurrences`, {
    data: agendaOccurrenceCreateSchema.parse({
      expectedRevision: snapshot.revision,
      title: privateTitle,
      description: "Private organizer planning notes that must never appear in public archive discovery.",
      startAt: "2026-12-02T14:00:00.000Z",
      endAt: "2026-12-02T15:00:00.000Z",
      roomId,
      visibility: "private",
    }),
  });
  expect(privateCreate.status()).toBe(200);
  snapshot = agendaSnapshotSchema.parse(await privateCreate.json());
  const privateOccurrence = snapshot.occurrences.find((item) => item.title === privateTitle)!;
  await page.goto(`/portal/#/events/${slug}/agenda`);
  const agendaViews = page.getByRole("tablist", { name: "Agenda views", exact: true });
  await agendaViews.getByRole("tab", { name: "Schedule", exact: true }).click();
  const sessions = page.getByRole("table", { name: "Event sessions", exact: true });
  const sessionRow = sessions.getByRole("row").filter({ hasText: title });
  await runRowAction(page, sessionRow, "Session archive / materials");
  await expect(page.getByRole("heading", { name: `Session archive · ${title}`, exact: true })).toBeVisible();
  await expect(sessions).toHaveCount(0);
  const choices = sessionAppearanceChoicesSchema.parse(
    await (
      await page.request.get(
        `/api/v1/events/${slug}/agenda/occurrences/${occurrence.id}/history/identities?limit=200&offset=0&userId=${encodeURIComponent(identity.id)}`,
      )
    ).json(),
  );
  const representation = choices.identities.find((choice) => choice.userId === identity.id)!;
  expect(representation).toBeDefined();
  await page
    .getByRole("combobox", { name: "Representation at this event", exact: true })
    .selectOption(representation.id);
  await page
    .getByRole("textbox", { name: /^Prerequisites/ })
    .fill("Familiarity with certificate lifecycle management.");
  await page.getByLabel("Display name", { exact: true }).fill("Synthetic Archive Speaker");
  await page.getByLabel("Organization at this event", { exact: true }).fill("Historical Example Organization");
  await page.getByLabel("Role at this event", { exact: true }).fill("Cryptographic engineer");
  await page
    .getByLabel("Approved biography", { exact: true })
    .fill("An approved historical representation for this synthetic conference appearance.");
  await page.getByRole("button", { name: "Approve representation for Synthetic Archive Speaker", exact: true }).click();
  await expect(page.getByText("Representation approved", { exact: true })).toBeVisible();
  await page.getByRole("textbox", { name: /^Legacy session URLs/ }).fill(reviewedOldPath);
  for (const [key, material] of Object.entries(media)) {
    await page.getByRole("button", { name: "Add material release", exact: true }).click();
    await page
      .getByRole("group", { name: "New material", exact: true })
      .last()
      .getByLabel("Material title", { exact: true })
      .fill(material.title);
    const fields = page.getByRole("group", { name: material.title, exact: true });
    await fields
      .getByLabel("Material type", { exact: true })
      .selectOption(key === "captions" || key === "transcript" ? key : "recording");
    await fields
      .getByLabel(`${key === "captions" ? "Captions" : key === "transcript" ? "Transcript" : "Recording"} link`, {
        exact: true,
      })
      .fill(material.url);
    if (key !== "draft" && key !== "failed") {
      if (key !== "recording")
        await fields.getByLabel("We have permission to publish this material", { exact: true }).check();
      await fields.getByLabel("Speaker has agreed to publication", { exact: true }).check();
      await fields.getByLabel("File and accessibility have been reviewed", { exact: true }).check();
      await fields.getByLabel("Release status", { exact: true }).selectOption("approved");
    } else if (key === "failed") {
      await fields.getByLabel("Release status", { exact: true }).selectOption("failed");
    }
  }
  const historyPath = `/api/v1/events/${slug}/agenda/occurrences/${occurrence.id}/history`;
  const refusedSave = page.waitForResponse(
    (response) => new URL(response.url()).pathname === historyPath && response.request().method() === "POST",
  );
  await page.getByRole("button", { name: "Save archive details", exact: true }).click();
  const refusal = await refusedSave;
  expect(refusal.status()).toBe(400);
  expect(apiErrorPayloadSchema.parse(await refusal.json()).error.code).toBe("MATERIAL_RELEASE_INCOMPLETE");
  const refusedBody = sessionHistoryCorrectionSchema.parse(refusal.request().postDataJSON());
  expect(refusedBody.history.materials).toEqual(
    expect.arrayContaining([
      expect.objectContaining({ title: media.recording.title, status: "approved", rightsConfirmed: false }),
    ]),
  );
  const afterRefusal = agendaSnapshotSchema.parse(
    await (await page.request.get(`/api/v1/events/${slug}/agenda`)).json(),
  );
  expect(afterRefusal.revision).toBe(snapshot.revision);
  expect(afterRefusal.occurrences.find((item) => item.id === occurrence.id)?.history?.materials ?? []).toEqual(
    occurrence.history?.materials ?? [],
  );
  await expect(page.getByRole("alert")).toContainText("Confirm rights, consent and validation");
  await page
    .getByRole("group", { name: media.recording.title, exact: true })
    .getByLabel("We have permission to publish this material", { exact: true })
    .check();
  await page.screenshot({ path: `${artifacts}/archive-editor-desktop.png`, fullPage: true });
  const historySaved = page.waitForResponse(
    (response) =>
      response.url().endsWith(`/agenda/occurrences/${occurrence.id}/history`) && response.request().method() === "POST",
  );
  await page.getByRole("button", { name: "Save archive details", exact: true }).click();
  const savedHistory = await historySaved;
  expect(savedHistory.status()).toBe(200);
  const correctionBody = sessionHistoryCorrectionSchema.parse(savedHistory.request().postDataJSON());
  expect(correctionBody.history.legacyPaths).toContain(reviewedOldPath);
  expect(correctionBody.history.materials).toEqual(
    expect.arrayContaining(
      [media.recording, media.captions, media.transcript].map((material) =>
        expect.objectContaining({
          ...material,
          status: "approved",
          rightsConfirmed: true,
          consentConfirmed: true,
          validated: true,
        }),
      ),
    ),
  );
  expect(correctionBody.history.appearances).toEqual([
    expect.objectContaining({
      userId: identity.id,
      actingIdentityId: representation.id,
      displayName: "Synthetic Archive Speaker",
      organizationName: "Historical Example Organization",
      jobTitle: "Cryptographic engineer",
    }),
  ]);
  await expect(page.getByRole("textbox", { name: /^Prerequisites/ })).toHaveCount(0);
  await expect(sessions).toBeVisible();
  await runRowAction(page, sessionRow, "Speaker promotion kit");
  await expect(page.getByRole("heading", { name: `Promotion kit · ${title}`, exact: true })).toBeVisible();
  await page
    .getByRole("textbox", { name: /^Why attend/ })
    .fill(
      "Learn how migration teams can preserve trust while replacing cryptographic components and operational processes.",
    );
  await page
    .getByRole("textbox", { name: /^Key questions \/ takeaways/ })
    .fill("Choose observable cryptographic migration controls\nReview practical certificate lifecycle boundaries");
  const promotionSaved = page.waitForResponse(
    (response) =>
      response.url().endsWith(`/agenda/occurrences/${occurrence.id}/promotion`) &&
      response.request().method() === "POST",
  );
  await page.getByRole("button", { name: "Approve promotion copy", exact: true }).click();
  expect((await promotionSaved).status()).toBe(200);
  await page.getByRole("button", { name: "Close", exact: true }).click();
  await agendaViews.getByRole("tab", { name: "Agenda", exact: true }).click();
  await runAgendaAction(page, "Review for publication");
  await expect(page.getByRole("heading", { name: "Review for publication", exact: true })).toBeVisible();
  await expect(sessions).toHaveCount(0);
  await page.getByRole("button", { name: "Approve for publication", exact: true }).click();
  await expect(page.getByRole("button", { name: "Approve for publication", exact: true })).toBeDisabled();
  await page.getByRole("button", { name: "Back to agenda", exact: true }).click();

  snapshot = agendaSnapshotSchema.parse(await (await page.request.get(`/api/v1/events/${slug}/agenda`)).json());
  const approved = agendaSnapshotSchema.parse(
    await (await page.request.get(`/api/v1/events/${slug}/agenda/previews?revision=approved`)).json(),
  );
  expect(approved.approvedAt).toBeDefined();
  const sessionPath = `/events/${slug}/sessions/${occurrence.id}/`;
  await publishE2eSite(page, sessionPath);
  const publicContext = await browser.newContext({ javaScriptEnabled: false, baseURL: new URL(page.url()).origin });
  const publicApiRequests: string[] = [];
  await publicContext.route("**/api/**", async (route) => {
    publicApiRequests.push(route.request().url());
    await route.abort();
  });
  const sitemapResponse = await publicContext.request.get("/en/sitemap.xml");
  expect(sitemapResponse.status()).toBe(200);
  const sitemap = new JSDOM(await sitemapResponse.text(), { contentType: "text/xml" }).window.document;
  const archiveDates = new Map(
    [...sitemap.querySelectorAll("url")].map((entry) => [
      new URL(entry.querySelector("loc")!.textContent!).pathname,
      entry.querySelector("lastmod")?.textContent,
    ]),
  );
  const personPath = `/people/${encodeURIComponent(identity.id)}/`;
  expect(archiveDates.get(sessionPath)).toBe(approved.approvedAt);
  expect(archiveDates.get(personPath)).toBe(approved.approvedAt);
  expect(archiveDates.has(`/events/${slug}/sessions/${privateOccurrence.id}/`)).toBe(false);
  const redirect = await publicContext.request.get(reviewedOldPath, { maxRedirects: 0 });
  expect(redirect.status(), await redirect.text()).toBe(301);
  expect(new URL(redirect.headers()["location"]!, page.url()).pathname).toBe(sessionPath);
  const target = await publicContext.request.get(sessionPath);
  expect(target.status(), await target.text()).toBe(200);
  expect(target.headers()["x-pkic-publication"]).toMatch(/^static; snapshot=/);
  for (const expected of attendancePages) {
    const response = await publicContext.request.get(`/events/${slug}/sessions/${expected.id}/`);
    expect(response.status()).toBe(200);
    expect(response.headers()["x-pkic-publication"]).toMatch(/^static; snapshot=/);
    const document = new JSDOM(await response.text()).window.document;
    if (expected.id !== occurrence.id) {
      expect([...document.querySelectorAll("section h2")].map((heading) => heading.textContent)).not.toContain(
        "Speakers",
      );
    }
    const attendance = [...document.querySelectorAll("section")].find(
      (section) => section.querySelector("h2")?.textContent === "Attendance",
    );
    expect(attendance).toBeDefined();
    expect([...attendance!.querySelectorAll("p")].map((p) => p.textContent)).toEqual([
      expected.policyLabel,
      expected.message,
    ]);
    const action = attendance!.querySelector("a")!;
    expect(action.textContent).toBe(expected.action);
    expect(action.getAttribute("href")).toBe(`/portal/#/events/${slug}/agenda?session=${expected.id}`);
  }
  const publicPage = await publicContext.newPage();
  const followed = await publicPage.goto(reviewedOldPath);
  expect(followed!.status()).toBe(200);
  await expect(publicPage).toHaveURL(new URL(sessionPath, page.url()).href);

  for (const material of [media.recording, media.captions, media.transcript]) {
    await expect(publicPage.getByRole("link", { name: material.title, exact: true })).toHaveAttribute(
      "href",
      material.url,
    );
  }
  for (const material of [media.draft, media.failed]) {
    await expect(publicPage.getByRole("link", { name: material.title, exact: true })).toHaveCount(0);
    expect(await publicPage.content()).not.toContain(material.url);
  }
  expect(await publicPage.content()).not.toContain(rawRecording);
  await expect(publicPage.locator('link[rel="canonical"]')).toHaveAttribute("href", new RegExp(`${sessionPath}$`));
  const captureMedia = async (name: string, width: number, height: number) => {
    await publicPage.setViewportSize({ width, height });
    await publicPage.evaluate(() => window.scrollTo(0, 0));
    await expect.poll(() => publicPage.evaluate(() => window.scrollY)).toBe(0);
    await expect.poll(() => publicPage.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
    await publicPage.screenshot({ path: testInfo.outputPath(name), fullPage: true, animations: "disabled" });
  };
  await captureMedia("archive-approved-media-desktop.png", 1280, 900);
  await captureMedia("archive-approved-media-phone.png", 390, 844);
  await publicPage.setViewportSize({ width: 1280, height: 900 });
  await expect(publicPage.getByRole("heading", { name: title, exact: true })).toBeVisible();
  await expect(publicPage.getByText(/13:00.*14:00.*Europe\/Amsterdam/)).toBeVisible();
  await expect(publicPage.getByText(/Archive hall \/ Archive overflow/)).toBeVisible();
  await expect(publicPage.getByText("Historical Example Organization", { exact: false })).toBeVisible();
  await expect(
    publicPage.getByText("Familiarity with certificate lifecycle management.", { exact: true }),
  ).toBeVisible();
  await expect(publicPage.getByText("Explore operational lessons", { exact: true })).toBeVisible();
  await expect(publicPage.getByRole("listitem").filter({ hasText: "Certificate lifecycle boundaries" })).toBeVisible();
  await publicPage.screenshot({ path: `${artifacts}/archive-public-desktop.png`, fullPage: true });
  await publicPage.setViewportSize({ width: 390, height: 844 });
  await publicPage.screenshot({ path: `${artifacts}/archive-public-phone.png`, fullPage: true });
  await publicPage.getByRole("link", { name: "Synthetic Archive Speaker", exact: true }).click();
  await expect(publicPage.getByRole("heading", { name: "Speaking history", exact: true })).toBeVisible();
  await expect(publicPage).toHaveURL(new URL(personPath, publicPage.url()).href);
  await expect(publicPage.getByRole("link", { name: title, exact: true })).toBeVisible();
  const breadcrumb = publicPage.getByRole("navigation", { name: "Breadcrumb", exact: true });
  for (const viewport of [
    { width: 1440, height: 1000 },
    { width: 390, height: 844 },
  ]) {
    await publicPage.setViewportSize(viewport);
    await expect(breadcrumb).toBeVisible();
    await expect(breadcrumb.getByRole("link", { name: "Session archive", exact: true })).toHaveAttribute(
      "href",
      "/sessions/",
    );
    await expect(breadcrumb.locator('[aria-current="page"]')).toHaveText("Speaking history");
    expect(
      await breadcrumb.evaluate((trail) => trail.scrollWidth <= trail.clientWidth),
      `Breadcrumb fits ${viewport.width}px viewport`,
    ).toBe(true);
  }
  await publicPage.screenshot({ path: `${artifacts}/speaker-history-phone.png`, fullPage: true });
  await breadcrumb.getByRole("link", { name: "Session archive", exact: true }).click();
  await expect(publicPage.getByRole("heading", { name: "Session archive", exact: true })).toBeVisible();
  await expect(publicPage.getByRole("link", { name: title, exact: true })).toHaveAttribute("href", sessionPath);
  await expect(publicPage.getByText(privateTitle, { exact: true })).toHaveCount(0);
  expect(publicApiRequests).toEqual([]);
  await agendaViews.getByRole("tab", { name: "Schedule", exact: true }).click();
  await runRowAction(page, sessionRow, "Speaker promotion kit");
  await expect(page.getByRole("heading", { name: `Promotion kit · ${title}`, exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Prepare published kit", exact: true }).click();
  const pdf = page.getByRole("link", { name: "LinkedIn carousel PDF", exact: true });
  await expect(pdf).toBeVisible({ timeout: 120_000 });
  const renderDiagnostics = async (name: string) => {
    const state = process.env.E2E_PREPARED_STATE_DIR ?? (await readFile("test-results/e2e-state-dir", "utf8")).trim();
    const result = await promisify(execFile)(
      "pnpm",
      [
        "exec",
        "wrangler",
        "d1",
        "execute",
        "pkic-db-local",
        "--env",
        "local",
        "--local",
        `--persist-to=${state}`,
        "--json",
        "--command",
        `SELECT format,status,attempts,next_attempt_at,last_error FROM event_agenda_promotion_render_jobs WHERE occurrence_id='${occurrence.id}' ORDER BY format`,
      ],
      { maxBuffer: 1024 * 1024 },
    );
    await testInfo.attach(name, { body: result.stdout, contentType: "application/json" });
  };
  await renderDiagnostics("promotion-render-first-attempt");
  // Local Wrangler does not run the production cron. A normal authorized
  // artifact request executes the same due-time and lease guarded retry path.
  const previewUrl = `/api/v1/events/${slug}/agenda/occurrences/${occurrence.id}/promotion/artifact?format=landscape&revision=${snapshot.publishedRevision}&download=false`;
  try {
    await expect
      .poll(
        async () => {
          const preview = await page.request.get(previewUrl);
          if (preview.status() === 409) return false;
          expect(preview.status(), await preview.text()).toBe(200);
          expect(preview.headers()["content-type"]).toBe("image/png");
          const bytes = await preview.body();
          return [137, 80, 78, 71, 13, 10, 26, 10].every((byte, index) => bytes[index] === byte);
        },
        { timeout: 120_000, intervals: [1000, 2000, 5000] },
      )
      .toBe(true);
    await expect(
      page.getByRole("img", { name: `First landscape promotion card for ${title}`, exact: true }),
    ).toBeVisible({ timeout: 20_000 });
  } finally {
    await renderDiagnostics("promotion-render-final-attempt");
  }
  await page.screenshot({ path: `${artifacts}/promotion-preview-desktop.png`, fullPage: true });
  const response = await page.request.get((await pdf.getAttribute("href"))!);
  expect(response.status()).toBe(200);
  expect(response.headers()["content-type"]).toContain("application/pdf");
  expect((await response.body()).subarray(0, 5).toString()).toBe("%PDF-");
  await page.setViewportSize({ width: 390, height: 844 });
  const preview = page.getByRole("img", { name: `First landscape promotion card for ${title}`, exact: true });
  await expect
    .poll(async () =>
      preview.evaluate((image) => {
        const box = image.getBoundingClientRect();
        return Math.abs(box.width / box.height - 1200 / 630);
      }),
    )
    .toBeLessThan(0.02);
  await page.screenshot({ path: `${artifacts}/promotion-preview-phone.png`, fullPage: true });
  const correction = await page.request.patch(`/api/v1/events/${slug}/agenda/occurrences/${occurrence.id}`, {
    data: { expectedRevision: snapshot.revision, title: `${title} · correction` },
  });
  expect(correction.status()).toBe(200);
  const next = agendaSnapshotSchema.parse(await correction.json());
  const correctedPublication = await page.request.post(`/api/v1/events/${slug}/agenda/publications`, {
    data: { expectedRevision: next.revision },
  });
  expect(correctedPublication.status()).toBe(200);
  const correctedApproved = agendaSnapshotSchema.parse(await correctedPublication.json());
  expect((await page.request.get((await pdf.getAttribute("href"))!)).status()).toBe(409);

  await page.goto(`/portal/#/events/${slug}/agenda`);
  await agendaViews.getByRole("tab", { name: "Schedule", exact: true }).click();
  await runRowAction(
    page,
    sessions.getByRole("row").filter({ hasText: `${title} · correction` }),
    "Session archive / materials",
  );
  for (const material of [media.recording, media.captions, media.transcript]) {
    await page
      .getByRole("group", { name: material.title, exact: true })
      .getByLabel("Release status", { exact: true })
      .selectOption("withdrawn");
  }
  const withdrawing = page.waitForResponse(
    (result) => new URL(result.url()).pathname === historyPath && result.request().method() === "POST",
  );
  await page.getByRole("button", { name: "Save archive details", exact: true }).click();
  const withdrawn = await withdrawing;
  expect(withdrawn.status()).toBe(200);
  const withdrawnBody = sessionHistoryCorrectionSchema.parse(withdrawn.request().postDataJSON());
  expect(withdrawnBody.history.materials).toEqual(
    expect.arrayContaining(
      [media.recording, media.captions, media.transcript].map((material) =>
        expect.objectContaining({
          title: material.title,
          url: material.url,
          status: "withdrawn",
          approvedAt: null,
        }),
      ),
    ),
  );
  const withdrawnAgenda = agendaSnapshotSchema.parse(await withdrawn.json());
  expect(withdrawnAgenda.revision).toBe(correctedApproved.revision + 1);
  expect(withdrawnAgenda.publishedRevision).toBe(correctedApproved.publishedRevision);
  expect(withdrawnAgenda.occurrences.find((item) => item.id === occurrence.id)?.recordingUrl).toBeNull();
  await publishE2eSite(page, sessionPath);
  await publicPage.goto(sessionPath);
  await expect(publicPage.getByRole("heading", { name: `${title} · correction`, exact: true })).toBeVisible();
  await expect(publicPage.locator('link[rel="canonical"]')).toHaveAttribute("href", new RegExp(`${sessionPath}$`));
  for (const material of Object.values(media)) {
    await expect(publicPage.getByRole("link", { name: material.title, exact: true })).toHaveCount(0);
    expect(await publicPage.content()).not.toContain(material.url);
  }
  expect(await publicPage.content()).not.toContain(rawRecording);
  await captureMedia("archive-withdrawn-media-phone.png", 390, 844);
  const publicAgenda = await publicPage.goto(approved.publicAgendaPath ?? `/events/${slug}/agenda/`);
  expect(publicAgenda?.status()).toBe(200);
  expect(await publicPage.content()).toContain(`${title} · correction`);
  for (const url of [rawRecording, ...Object.values(media).map((material) => material.url)]) {
    expect(await publicPage.content()).not.toContain(url);
  }
  expect(publicApiRequests).toEqual([]);
  await publicContext.close();
});
