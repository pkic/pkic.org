import { mkdir } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { expect, test } from "@playwright/test";
import { agendaOccurrenceCreateSchema, agendaSnapshotSchema } from "../../assets/shared/schemas/event-agenda";
import {
  sessionPresentationVersionResponseSchema,
  sessionPresentationReviewRequestSchema,
} from "../../assets/shared/schemas/session-presentation-versions";
import { sessionHistoryCorrectionSchema } from "../../assets/shared/schemas/event-session-history";
import { e2eAdminEmail } from "../helpers/e2e-admin";
import { signInAsE2eStaff } from "./helpers/staff-auth";
import { runRowAction } from "./helpers/data-table";
import { uploadThroughControl } from "./helpers/file-upload";
const slug = "pqc-conference-amsterdam-nl";
const artifacts = process.env.AGENDA_SCREENSHOT_DIR ?? "test-results/session-presentation";
test.use({ actionTimeout: 20_000 });

test("session without a proposal uploads, reviews and explicitly binds a private presentation release", async ({
  page,
  browser,
}) => {
  await mkdir(artifacts, { recursive: true });
  await signInAsE2eStaff(page, e2eAdminEmail("portal-session-presentation"));
  const before = agendaSnapshotSchema.parse(await (await page.request.get(`/api/v1/events/${slug}/agenda`)).json());
  const title = `Direct PDF session ${randomUUID().slice(0, 8)}`;
  const created = await page.request.post(`/api/v1/events/${slug}/agenda/occurrences`, {
    data: agendaOccurrenceCreateSchema.parse({
      expectedRevision: before.revision,
      title,
      description: "Synthetic direct session with no proposal.",
      startAt: null,
      endAt: null,
      roomId: null,
      speakerUserIds: [],
      visibility: "private",
    }),
  });
  expect(created.status(), await created.text()).toBe(200);
  const snapshot = agendaSnapshotSchema.parse(await created.json());
  const occurrence = snapshot.occurrences.find((row) => row.title === title)!;
  const endpoint = `/api/v1/events/${slug}/agenda/occurrences/${occurrence.id}/materials/presentations`;
  await page.goto(`/portal/#/events/${slug}/agenda`);
  await page
    .getByRole("tablist", { name: "Agenda views", exact: true })
    .getByRole("tab", { name: "All sessions", exact: true })
    .click();
  await page.getByPlaceholder("Search sessions…", { exact: true }).fill(title);
  await runRowAction(
    page,
    page
      .getByRole("table", { name: "Sessions across all days", exact: true })
      .getByRole("row")
      .filter({ hasText: title }),
    "Session archive / materials",
  );
  await page.getByRole("button", { name: "Session archive actions", exact: true }).click();
  await page.getByRole("menuitem", { name: "Manage presentation uploads", exact: true }).click();
  const versions = page.getByRole("region", { name: "Session presentation versions", exact: true });
  await expect(versions.getByText("No presentation uploaded yet.", { exact: true })).toBeVisible();
  const uploadResponse = page.waitForResponse(
    (response) => new URL(response.url()).pathname === endpoint && response.request().method() === "POST",
  );
  const pdf = Buffer.from("%PDF-1.7\n1 0 obj<</Type/Catalog>>endobj\ntrailer<</Root 1 0 R>>\n%%EOF\n");
  await versions.getByRole("button", { name: "Upload on behalf of speaker", exact: true }).click();
  await expect(versions.getByRole("table")).toHaveCount(0);
  await uploadThroughControl(page, versions.getByRole("button", { name: "Choose presentation file", exact: true }), {
    name: "direct-session.pdf",
    mimeType: "application/pdf",
    buffer: pdf,
  });
  const upload = await uploadResponse;
  expect(upload.status(), await upload.text()).toBe(200);
  const version = sessionPresentationVersionResponseSchema.parse(await upload.json()).version;
  expect(version.occurrenceId).toBe(occurrence.id);
  expect(version.latestReview).toBeNull();
  await expect(versions.getByText("Not reviewed", { exact: true })).toBeVisible();
  const privateUrl = `${endpoint}/${version.id}/content`;
  const anonymous = await browser.newContext({ baseURL: new URL(page.url()).origin });
  try {
    expect([401, 403]).toContain((await anonymous.request.get(privateUrl)).status());
  } finally {
    await anonymous.close();
  }
  const privateDownload = await page.request.get(privateUrl);
  expect(privateDownload.status()).toBe(200);
  expect(privateDownload.headers()["cache-control"]).toContain("no-store");
  expect(await privateDownload.body()).toEqual(pdf);
  await runRowAction(
    page,
    versions
      .getByRole("table", { name: "Presentation versions", exact: true })
      .getByRole("row")
      .filter({ hasText: "direct-session.pdf" }),
    "Review",
  );
  await expect(versions.locator("table")).toHaveCount(0);
  const reviewedResponse = page.waitForResponse(
    (response) =>
      new URL(response.url()).pathname === `${endpoint}/${version.id}/reviews` &&
      response.request().method() === "POST",
  );
  await versions.getByRole("button", { name: "Save review", exact: true }).click();
  const reviewed = await reviewedResponse;
  expect(sessionPresentationReviewRequestSchema.parse(reviewed.request().postDataJSON()).status).toBe("approved");
  expect(reviewed.status(), await reviewed.text()).toBe(200);
  await expect(versions.locator("[data-presentation-review-status]")).toContainText("Approved");
  let current = agendaSnapshotSchema.parse(await (await page.request.get(`/api/v1/events/${slug}/agenda`)).json());
  expect(current.occurrences.find((row) => row.id === occurrence.id)?.history?.materials ?? []).toEqual([]);
  expect(current.publishedRevision).toBe(snapshot.publishedRevision);
  await page.getByRole("button", { name: "Back to archive details", exact: true }).click();
  await page.getByRole("button", { name: "Add material release", exact: true }).click();
  await page.getByLabel("Material title", { exact: true }).fill("Direct session slides");
  const choice = page.getByLabel("Uploaded presentation version", { exact: true });
  await expect(choice.locator(`option[value="session:${version.id}"]`)).toContainText("approved");
  await choice.selectOption(`session:${version.id}`);
  const historicalLink = page.getByLabel("Historical download link", { exact: true });
  await expect(historicalLink).toHaveValue("");
  await expect(historicalLink.locator("option")).toHaveCount(1);
  await expect(historicalLink.locator("option:checked")).toHaveText("No historical download link");
  await expect(page.getByLabel("Public delivery URL", { exact: true })).toHaveCount(0);
  await page.getByLabel("Release status", { exact: true }).selectOption("approved");
  const refusedResponse = page.waitForResponse(
    (response) =>
      new URL(response.url()).pathname.endsWith(`/occurrences/${occurrence.id}/history`) &&
      response.request().method() === "POST",
  );
  await page.getByRole("button", { name: "Save archive details", exact: true }).click();
  expect([400, 409]).toContain((await refusedResponse).status());
  await expect(page.getByRole("button", { name: "Save archive details", exact: true })).toBeVisible();
  for (const label of ["Rights confirmed", "Speaker consent confirmed", "File and accessibility reviewed"])
    await page.getByLabel(label, { exact: true }).check();
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.getByRole("button", { name: "Session archive actions", exact: true }).click();
  await page.screenshot({ path: `${artifacts}/session-presentation-release-desktop.png`, fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.evaluate(() => window.scrollTo(0, 0));
  for (const label of ["Manage presentation uploads", "Historical representation overrides", "Close"]) {
    const item = page.getByRole("menuitem", { name: label, exact: true });
    await expect(item).toBeVisible();
    const bounds = await item.boundingBox();
    expect(bounds).not.toBeNull();
    expect(bounds!.x).toBeGreaterThanOrEqual(0);
    expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(390);
  }
  await page.screenshot({ path: `${artifacts}/session-presentation-release-phone.png`, fullPage: true });
  await page.getByRole("menuitem", { name: "Manage presentation uploads", exact: true }).click();
  for (const label of ["Back to archive details", "Close"]) {
    const button = page.getByRole("button", { name: label, exact: true });
    await expect(button).toBeVisible();
    const bounds = await button.boundingBox();
    expect(bounds).not.toBeNull();
    expect(bounds!.x).toBeGreaterThanOrEqual(0);
    expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(390);
  }
  await page.getByRole("button", { name: "Back to archive details", exact: true }).click();
  const savedResponse = page.waitForResponse(
    (response) =>
      new URL(response.url()).pathname.endsWith(`/occurrences/${occurrence.id}/history`) &&
      response.request().method() === "POST",
  );
  await page.getByRole("button", { name: "Save archive details", exact: true }).click();
  const saved = await savedResponse;
  const correction = sessionHistoryCorrectionSchema.parse(saved.request().postDataJSON());
  expect(correction.history.materials[0]).toMatchObject({
    presentationSource: "session",
    presentationVersionId: version.id,
    status: "approved",
    rightsConfirmed: true,
    consentConfirmed: true,
    validated: true,
  });
  expect(saved.status(), await saved.text()).toBe(200);
  current = agendaSnapshotSchema.parse(await saved.json());
  expect(current.publishedRevision).toBe(snapshot.publishedRevision);
  expect(current.occurrences.find((row) => row.id === occurrence.id)?.history?.materials[0]).toMatchObject({
    presentationSource: "session",
    presentationVersionId: version.id,
  });
});
