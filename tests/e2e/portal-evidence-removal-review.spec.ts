import { expect, test } from "@playwright/test";
import { mkdir } from "node:fs/promises";
import { e2eAdminEmail } from "../helpers/e2e-admin";
import { signInAsE2eStaff } from "./helpers/staff-auth";
import { eventManagementDetailResponseSchema } from "../../assets/shared/schemas/event-management";
import {
  EVIDENCE_PURGE_TABLES,
  evidencePurgePreviewSchema,
  evidencePurgeReviewCreateSchema,
  evidencePurgeReviewResponseSchema,
} from "../../assets/shared/schemas/event-evidence-purge";
const slug = "pqc-conference-amsterdam-nl";
const artifacts = process.env.AGENDA_SCREENSHOT_DIR ?? "test-results/agenda-progress";
/** Synthetic count-only preview exercises presentation; native tests prove actual removal. */
test("organizers inspect a synthetic evidence removal review on desktop and phone without starting removal", async ({
  page,
}) => {
  await mkdir(artifacts, { recursive: true });
  await signInAsE2eStaff(page, e2eAdminEmail("default"));
  const detail = eventManagementDetailResponseSchema.parse(
    await (await page.request.get(`/api/v1/events/${slug}`)).json(),
  );
  const eventId = detail.event.id;
  const now = new Date().toISOString();
  const preview = evidencePurgePreviewSchema.parse({
    success: true,
    previewHash: "c".repeat(64),
    eventId,
    activeRunId: null,
    policyRevision: 1,
    sourceGeneration: 2000,
    publicationRevision: 1,
    timeZone: detail.event.timezone,
    counts: Object.fromEntries(
      EVIDENCE_PURGE_TABLES.map((table) => [table, table === "event_attendance_observations" ? 2000 : 12]),
    ),
    blockers: [],
    reconciliation: {
      scope: "event",
      coverage: "from_event_creation",
      coverageStartedAt: now,
      sourceState: "live",
      knownEpochs: 12,
      openEpochs: 0,
      closingEpochs: 0,
      closedEpochs: 12,
      unknownHighWaterEpochs: 0,
      missingDeclaredReceipts: 0,
      unprovenClosedEpochs: 0,
      untrackedAttempts: 0,
      unclosedGrants: 0,
      deviceBacklog: "complete",
    },
  });
  let reviews = 0;
  await page.route(`**/api/v1/retention/events/${eventId}/evidence`, (route) => route.fulfill({ json: preview }));
  await page.route(`**/api/v1/retention/events/${eventId}/reviews`, async (route) => {
    const body = evidencePurgeReviewCreateSchema.parse(route.request().postDataJSON());
    expect(body.expectedPreviewHash).toBe(preview.previewHash);
    expect(body.expectedGeneration).toBe(preview.sourceGeneration);
    reviews++;
    await route.fulfill({
      json: evidencePurgeReviewResponseSchema.parse({
        ...preview,
        reviewId: crypto.randomUUID(),
        reviewHash: preview.previewHash,
        reviewedAt: now,
        expiresAt: new Date(Date.now() + 15 * 60_000).toISOString(),
      }),
    });
  });
  await page.goto(`/portal/#/events/${slug}/settings/general`);
  const section = page.getByRole("region", { name: "Reviewed evidence removal" });
  await expect(section.getByRole("button", { name: "Review current evidence", exact: true })).toBeVisible();
  const disclosure = section.locator("summary").filter({ hasText: "All evidence included in this review" });
  await disclosure.focus();
  await disclosure.press("Enter");
  await expect(section.getByText("Badge credentials", { exact: true })).toBeVisible();
  const evidenceTable = section.getByRole("table", { name: "Evidence included in removal review" });
  await expect(evidenceTable.getByRole("columnheader", { name: "Records", exact: true })).toHaveClass(/pk-end/);
  await expect(
    evidenceTable.getByRole("columnheader", { name: "Records", exact: true }).locator(".pk-table__head-content"),
  ).toHaveCSS("justify-content", "flex-end");
  const titleBounds = await section.getByText("All evidence included in this review", { exact: true }).boundingBox();
  const rowBounds = await evidenceTable.getByText("Attendance import source links", { exact: true }).boundingBox();
  expect(titleBounds).not.toBeNull();
  expect(rowBounds).not.toBeNull();
  expect(Math.abs(titleBounds!.x - rowBounds!.x)).toBeLessThanOrEqual(1);
  const observations = evidenceTable.getByRole("row").filter({ hasText: "Attendance observations" });
  await expect(observations.getByRole("cell", { name: "2,000", exact: true })).toHaveClass(/pk-end/);
  await section.getByRole("button", { name: "Review current evidence", exact: true }).click();
  await expect(section.getByRole("checkbox")).not.toBeChecked();
  await expect(section.getByRole("button", { name: "Retire capture and start removal", exact: true })).toBeVisible();
  await page.setViewportSize({ width: 1280, height: 1200 });
  await section.evaluate((element) => element.scrollIntoView({ block: "start" }));
  await page.evaluate(() => window.scrollBy(0, -160));
  await section.screenshot({ path: `${artifacts}/evidence-review-desktop.png` });
  await page.setViewportSize({ width: 390, height: 844 });
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
  await section.getByText("All evidence included in this review", { exact: true }).click();
  await section.evaluate((element) => element.scrollIntoView({ block: "start" }));
  await page.evaluate(() => window.scrollBy(0, -110));
  await section.screenshot({ path: `${artifacts}/evidence-review-phone.png` });
  await section.getByText("All evidence included in this review", { exact: true }).click();
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
  await expect(evidenceTable.getByRole("columnheader", { name: "Records", exact: true })).toBeVisible();
  await expect(observations.getByRole("cell", { name: "2,000", exact: true })).toHaveCSS("display", "table-cell");
  const phoneTitle = await section.getByText("All evidence included in this review", { exact: true }).boundingBox();
  const phoneRow = await evidenceTable.getByText("Attendance import source links", { exact: true }).boundingBox();
  expect(phoneTitle).not.toBeNull();
  expect(phoneRow).not.toBeNull();
  expect(Math.abs(phoneTitle!.x - phoneRow!.x)).toBeLessThanOrEqual(1);
  await section.screenshot({ path: `${artifacts}/evidence-review-phone-expanded.png` });
  expect(reviews).toBe(1);
});
